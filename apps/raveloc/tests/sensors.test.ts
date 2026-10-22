import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Capteurs et autorisations, avec un faux navigateur : on vérifie que l'app ne prétend jamais avoir
 * une boussole ou une position qu'elle n'a pas, et qu'elle éteint ce qu'elle allume.
 */
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function orientationEvent(type: string, props: Record<string, unknown>) {
  const e = new Event(type);
  Object.assign(e, props);
  return e;
}

describe('boussole', () => {
  let win: EventTarget & Record<string, unknown>;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    win = Object.assign(new EventTarget(), { ondeviceorientationabsolute: null }) as unknown as EventTarget & Record<string, unknown>;
    setGlobal('window', win);
    setGlobal('DeviceOrientationEvent', class {});
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const g of ['window', 'DeviceOrientationEvent']) Reflect.deleteProperty(globalThis, g);
  });

  it('aucun cap absolu reçu : « indisponible », jamais une flèche inventée', async () => {
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    expect(o.compass.get().status).toBe('starting');
    vi.advanceTimersByTime(2600);
    expect(o.compass.get().status).toBe('unavailable');
    expect(o.currentHeading()).toBeNull();
    release();
  });

  it('Chrome Android : cap absolu, lissé, publié', async () => {
    const o = await import('../src/services/orientation');
    const seen: number[] = [];
    o.onHeading((h) => seen.push(h));
    const release = o.holdCompass();
    win.dispatchEvent(orientationEvent('deviceorientationabsolute', { alpha: 270, beta: 0, gamma: 0, absolute: true }));
    expect(o.compass.get()).toMatchObject({ status: 'ok', source: 'absolute' });
    expect(seen[0]).toBeCloseTo(90, 5);
    release();
    expect(o.compass.get().status).toBe('off');
    // Écouteur retiré : plus rien n'arrive.
    win.dispatchEvent(orientationEvent('deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0, absolute: true }));
    expect(seen).toHaveLength(1);
  });

  it('orientation seulement relative (gyroscope) : ignorée', async () => {
    delete win.ondeviceorientationabsolute;
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    win.dispatchEvent(orientationEvent('deviceorientation', { alpha: 10, beta: 0, gamma: 0, absolute: false }));
    expect(o.currentHeading()).toBeNull();
    vi.advanceTimersByTime(2600);
    expect(o.compass.get().status).toBe('unavailable');
    release();
  });

  it('iOS : autorisation par un geste, puis cap de la boussole et sa précision', async () => {
    delete win.ondeviceorientationabsolute;
    const requestPermission = vi.fn(async () => 'granted' as const);
    setGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    expect(o.compass.get().status).toBe('starting');
    vi.advanceTimersByTime(2600); // rien sans geste : on propose le bouton
    expect(o.compass.get().status).toBe('needs-permission');
    await o.requestCompassPermission();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(o.compass.get().status).toBe('starting');
    win.dispatchEvent(orientationEvent('deviceorientation', { webkitCompassHeading: 123, webkitCompassAccuracy: 10, alpha: 5 }));
    expect(o.compass.get()).toMatchObject({ status: 'ok', source: 'ios', accuracy: 10 });
    expect(o.currentHeading()).toBeCloseTo(123, 5);
    win.dispatchEvent(orientationEvent('deviceorientation', { webkitCompassHeading: 124, webkitCompassAccuracy: -1 }));
    expect(o.compass.get().status).toBe('unstable'); // précision invalide : calibration nécessaire
    release();
  });

  it('Chrome récent : requestPermission présent mais inutile, le cap arrive sans geste', async () => {
    setGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission: async () => 'granted' as const }));
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    win.dispatchEvent(orientationEvent('deviceorientationabsolute', { alpha: 0, beta: 0, gamma: 0, absolute: true }));
    vi.advanceTimersByTime(2600);
    expect(o.compass.get().status).toBe('ok');
    release();
  });

  it('autorisation accordée mais aucun capteur : indisponible (pas de bouton en boucle)', async () => {
    setGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission: async () => 'granted' as const }));
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    vi.advanceTimersByTime(2600);
    expect(o.compass.get().status).toBe('needs-permission');
    await o.requestCompassPermission();
    vi.advanceTimersByTime(2600);
    expect(o.compass.get().status).toBe('unavailable');
    release();
  });

  it('iOS : autorisation refusée', async () => {
    setGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission: async () => 'denied' as const }));
    const o = await import('../src/services/orientation');
    const release = o.holdCompass();
    await o.requestCompassPermission();
    expect(o.compass.get().status).toBe('denied');
    release();
    expect(o.compass.get().status).toBe('denied'); // le refus reste affiché
  });

  it('navigateur sans API d’orientation', async () => {
    Reflect.deleteProperty(globalThis, 'DeviceOrientationEvent');
    const o = await import('../src/services/orientation');
    o.holdCompass();
    expect(o.compass.get().status).toBe('unavailable');
  });
});

describe('géolocalisation', () => {
  let watch: { ok: PositionCallback; err: PositionErrorCallback; opts: PositionOptions } | null;
  const clearWatch = vi.fn();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  beforeEach(() => {
    vi.resetModules();
    watch = null;
    clearWatch.mockClear();
    doc.visibilityState = 'visible';
    setGlobal('document', doc);
    setGlobal('window', { isSecureContext: true });
    setGlobal('navigator', {
      geolocation: {
        watchPosition: (ok: PositionCallback, err: PositionErrorCallback, opts: PositionOptions) => {
          watch = { ok, err, opts };
          return 7;
        },
        clearWatch,
      },
    });
  });
  afterEach(() => {
    for (const g of ['document', 'window', 'navigator']) Reflect.deleteProperty(globalThis, g);
  });
  const fixAt = (lat: number, acc = 8) => ({ coords: { latitude: lat, longitude: 2.35, accuracy: acc, heading: null, speed: null }, timestamp: Date.now() }) as unknown as GeolocationPosition;

  it('GPS éteint tant que personne n’en a besoin, haute précision ensuite', async () => {
    const l = await import('../src/services/location');
    expect(watch).toBeNull();
    expect(l.location.get().status).toBe('off');
    const release = l.needLocation('share:g', 'share');
    expect(watch!.opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 10_000 });
    expect(l.location.get().status).toBe('locating');
    watch!.ok(fixAt(48.85));
    expect(l.location.get()).toMatchObject({ status: 'ok', fix: { lat: 48.85, acc: 8 } });
    release();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(l.location.get().status).toBe('off');
  });

  it('navigation : mesures plus rapprochées', async () => {
    const l = await import('../src/services/location');
    const a = l.needLocation('share:g', 'share');
    const b = l.needLocation('navigate', 'navigate');
    expect(watch!.opts.maximumAge).toBe(2000);
    b();
    expect(watch!.opts.maximumAge).toBe(10_000);
    a();
  });

  it('autorisation refusée : état explicite, GPS coupé', async () => {
    const l = await import('../src/services/location');
    l.needLocation('navigate', 'navigate');
    watch!.err({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError);
    expect(l.location.get()).toMatchObject({ status: 'denied', permission: 'denied' });
    expect(clearWatch).toHaveBeenCalled();
  });

  it('délai dépassé : on garde la dernière position (avec son âge) et on continue', async () => {
    const l = await import('../src/services/location');
    l.needLocation('navigate', 'navigate');
    watch!.ok(fixAt(48.85));
    watch!.err({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError);
    expect(l.location.get()).toMatchObject({ status: 'ok', fix: { lat: 48.85 } });
  });

  it('app en arrière-plan : GPS coupé ; retour : relancé', async () => {
    const l = await import('../src/services/location');
    l.needLocation('share:g', 'share');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(clearWatch).toHaveBeenCalled();
    watch = null;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(watch).not.toBeNull();
  });

  it('page non sécurisée (http) : refus explicite', async () => {
    setGlobal('window', { isSecureContext: false });
    const l = await import('../src/services/location');
    l.needLocation('navigate', 'navigate');
    expect(l.location.get().status).toBe('insecure');
    expect(watch).toBeNull();
  });
});
