import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useObservable } from '../lib/observable';
import { app } from '../state/app';
import { formatAge } from '../domain/status';
import { hueOf, initial } from './format';

/** Glyphes (traits 2 px, 24 × 24) : peu nombreux, dessinés ici plutôt qu'une bibliothèque entière. */
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M16 3.13a3.5 3.5 0 010 6.75',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  pause: 'M9 5v14M15 5v14',
  stop: 'M6 6h12v12H6z',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  share: 'M12 3v12M7 8l5-5 5 5M5 14v5h14v-5',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 017 0M5 12.9a10 10 0 015.2-2.8M19 12.9a10 10 0 00-2.3-1.7M2 8.8a15 15 0 014.2-2.6M22 8.8A15 15 0 0010.7 5M12 20h.01',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  check: 'M5 12l5 5L20 7',
  chevron: 'M9 6l6 6-6 6',
  compass: 'M12 22a10 10 0 100-20 10 10 0 000 20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3z',
  refresh: 'M4 4v5h5M20 20v-5h-5M5 15a7 7 0 0012.6 2.3M19 9A7 7 0 006.4 6.7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Balise de l'app : un point lumineux et ses ondes, aux couleurs de myRaveLoc. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-a)" />
          <stop offset="1" stopColor="var(--brand-b)" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="none" stroke="url(#bm)" strokeWidth="2" opacity="0.45" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="url(#bm)" strokeWidth="2" opacity="0.75" />
      <path d="M20 9l6.5 17L20 22.2 13.5 26z" fill="url(#bm)" />
    </svg>
  );
}

export function Avatar({ uid, name }: { uid: string; name: string | null }) {
  return (
    <span className="avatar" style={{ background: hueOf(uid) }} aria-hidden>
      {initial(name)}
    </span>
  );
}

/** Rafraîchit le rendu toutes les `ms` (âges affichés), seulement quand l'app est visible. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const startTick = () => {
      if (id == null) id = setInterval(() => setNow(Date.now()), ms);
    };
    const stopTick = () => {
      if (id != null) clearInterval(id);
      id = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        startTick();
      } else stopTick();
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopTick();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
  return now;
}

/** Rien pendant 150 ms, puis un squelette : jamais un faux écran vide, jamais un clignotement. */
export function Pending({ rows = 3, label }: { rows?: number; label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {shown && Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="veil" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grab" aria-hidden />
        <div className="row">
          <h2 className="h2 grow">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * État du réseau, toujours visible quand il pose problème : hors ligne, serveur injoignable, erreur
 * serveur, reprise. Les données affichées restent, avec leur âge.
 */
export function NetBanner() {
  const { net, sessionExpired } = useObservable(app);
  const now = useNow(5000);
  const [recovered, setRecovered] = useState(false);
  const wasDown = useRef(false);
  const down = !net.online || net.unreachable || net.serverDown || net.failures > 1;
  useEffect(() => {
    if (down) wasDown.current = true;
    else if (wasDown.current) {
      wasDown.current = false;
      setRecovered(true);
      const t = setTimeout(() => setRecovered(false), 3500);
      return () => clearTimeout(t);
    }
  }, [down]);
  if (sessionExpired) return null;
  const since = net.okAt ? ` Dernier échange réussi ${formatAge(now - net.okAt)}.` : '';
  if (!net.online)
    return (
      <div className="banner warn" role="status">
        <Icon name="wifiOff" />
        <span>Hors ligne. Les positions affichées ne bougent plus et vieillissent.{since}</span>
      </div>
    );
  if (net.unreachable)
    return (
      <div className="banner warn" role="status">
        <Icon name="wifiOff" />
        <span>Réseau instable : nouvelle tentative automatique.{since}</span>
      </div>
    );
  if (net.serverDown || net.failures > 1)
    return (
      <div className="banner danger" role="status">
        <Icon name="alert" />
        <span>
          {net.error ?? 'Erreur du serveur.'} Nouvelle tentative automatique.{since}
        </span>
      </div>
    );
  if (recovered)
    return (
      <div className="banner ok" role="status">
        <Icon name="check" />
        <span>Connexion rétablie.</span>
      </div>
    );
  return null;
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="danger small" role="alert" style={{ margin: 0 }}>
      {error}
    </p>
  );
}

/** Action asynchrone protégée : double toucher ignoré, erreur affichée au lieu d'être avalée. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
