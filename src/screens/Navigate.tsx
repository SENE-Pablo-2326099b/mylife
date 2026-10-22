import { useEffect, useRef, useState } from 'react';
import { useObservable } from '../lib/observable';
import { app, setScreen, type Member } from '../state/app';
import { back } from '../state/nav';
import { location, needLocation, retryLocation } from '../services/location';
import { compass, compassNeedsGesture, currentHeading, onHeading, requestCompassPermission, holdCompass } from '../services/orientation';
import { arrowRotationDeg, cardinal, formatDistance } from '../domain/geo';
import { ageOf, formatAge, freshness, guidance, THRESHOLDS, type Fix, type Guidance } from '../domain/status';
import { describe, usableMe } from '../ui/describe';
import { Avatar, Icon, NetBanner, useNow } from '../ui/kit';

type DialMode = 'compass' | 'course' | 'north';

/**
 * Navigation vers un ami : une flèche, une distance, et la vérité sur la qualité des données.
 * La flèche suit la boussole à chaque image sans passer par React (pas de rendu inutile).
 */
export function Navigate({ uid }: { uid: string }) {
  const s = useObservable(app);
  const loc = useObservable(location);
  const cmp = useObservable(compass);
  const now = useNow(1000);
  const [beacon, setBeacon] = useState(false);

  useEffect(() => setScreen('navigate'), []);
  useEffect(() => needLocation('navigate', 'navigate'), []);
  useEffect(() => holdCompass(), []);
  useWakeLock();

  const live = s.live;
  const member = live?.members.find((m) => m.uid === uid) ?? null;
  const me = usableMe(loc.fix, now);
  const meStatus = loc.status === 'ok' ? (me ? 'ok' : 'locating') : loc.status === 'denied' ? 'denied' : loc.status === 'unavailable' || loc.status === 'insecure' ? 'unavailable' : 'locating';
  const line = member ? describe(member, loc.fix, now) : null;
  const g: Guidance | null = member ? guidance(me, meStatus, member.unreadable ? null : member.fix, line!.state) : null;

  // Cap : boussole si elle répond ; sinon direction de marche GPS si l'on marche ; sinon nord en haut.
  const compassUp = cmp.status === 'ok' || cmp.status === 'unstable';
  const course = !compassUp && me?.heading != null && (me.speed ?? 0) > 0.8 ? me.heading : null;
  const mode: DialMode = compassUp ? 'compass' : course != null ? 'course' : 'north';

  return (
    <main className="screen" style={{ gap: 12 }}>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={back} aria-label="Revenir au groupe">
          <Icon name="back" />
        </button>
        {member && <Avatar uid={member.uid} name={member.name} />}
        <div className="grow">
          <h1 className="h2 ellipsis">{member?.name ?? 'Ami'}</h1>
          {line && <span className={`small ${line.tone}`}>{line.text}</span>}
        </div>
      </header>
      <NetBanner />

      {!live || live.status === 'loading' ? (
        <div className="nav-stage" role="status">
          <p className="muted">Chargement du groupe…</p>
        </div>
      ) : !member ? (
        <div className="nav-stage">
          <p>Cette personne ne fait plus partie du groupe.</p>
          <button type="button" className="btn" onClick={back}>
            Revenir au groupe
          </button>
        </div>
      ) : (
        <Stage g={g!} member={member} me={me} mode={mode} course={course} now={now} />
      )}

      {member && g && (g.kind === 'ok' || g.kind === 'uncertain') && <CompassHelp mode={mode} />}

      {member && (
        <section className="card stack small" aria-label="Qualité des données">
          <Fact label="Sa position" value={member.fix ? `${formatAge(ageOf(member.fix, now))} · ± ${Math.round(member.fix.acc)} m` : 'inconnue'} tone={member.fix ? (freshness(ageOf(member.fix, now)) === 'live' ? 'ok' : 'warn') : 'muted'} />
          <Fact label="Ta position" value={loc.fix ? `${formatAge(Math.max(0, now - loc.fix.at))} · ± ${Math.round(loc.fix.acc)} m` : loc.status === 'denied' ? 'refusée' : 'en cours…'} tone={me ? (me.acc > THRESHOLDS.impreciseM ? 'warn' : 'ok') : 'warn'} />
          <Fact label="Orientation" value={modeLabel(mode, cmp.status)} tone={mode === 'compass' ? (cmp.status === 'unstable' ? 'warn' : 'ok') : 'warn'} />
        </section>
      )}

      <div className="row">
        <button type="button" className="btn" style={{ flex: 1 }} onClick={back}>
          <Icon name="back" /> Groupe
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setBeacon(true)}>
          Mode phare
        </button>
      </div>
      {beacon && <Beacon onClose={() => setBeacon(false)} />}
    </main>
  );
}

function modeLabel(mode: DialMode, status: string): string {
  if (mode === 'compass') return status === 'unstable' ? 'boussole perturbée' : 'boussole';
  if (mode === 'course') return 'direction de ta marche (GPS)';
  return 'pas de boussole : nord en haut';
}

function Fact({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span className="faint">{label}</span>
      <span className={tone} style={{ textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

function Stage({ g, member, me, mode, course, now }: { g: Guidance; member: Member; me: Fix | null; mode: DialMode; course: number | null; now: number }) {
  const name = member.name ?? 'Ton ami';
  if (g.kind === 'no-me') return <NoMe reason={g.reason} />;

  if (g.kind === 'no-friend') {
    const msg = member.unreadable
      ? 'Sa position est arrivée mais reste illisible : la clé du groupe ne correspond pas. Demande-lui un nouveau lien d’invitation.'
      : g.state === 'not-sharing'
        ? `${name} ne partage pas sa position. Demande-lui d’activer le partage dans myRaveLoc.`
        : g.state === 'paused'
          ? `${name} a mis son partage en pause.`
          : `${name} partage, mais sa position n’est pas encore arrivée (GPS en cours, ou autorisation refusée sur son téléphone).`;
    return (
      <div className="nav-stage">
        <Dial bearing={null} spread={0} mode="north" course={null} dim />
        <p className="muted" style={{ maxWidth: 340 }}>
          {msg}
        </p>
      </div>
    );
  }

  const age = member.fix ? ageOf(member.fix, now) : 0;
  const fr = freshness(age);
  const stale = fr === 'old' || fr === 'stale';
  const staleNote = stale ? (
    <div className={`banner ${fr === 'stale' ? 'danger' : 'warn'}`} role="status" style={{ textAlign: 'left' }}>
      <Icon name="alert" />
      <span>
        Dernière position {formatAge(age)} : {name} a pu bouger depuis. La flèche vise cette dernière position connue.
      </span>
    </div>
  ) : null;

  if (g.kind === 'near')
    return (
      <div className="nav-stage">
        <div className="dial near-rings" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div>
          <div className="distance">Tout proche</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            À moins de ~{formatDistance(Math.max(THRESHOLDS.nearM, g.uncertainty))} : à cette distance le GPS ne sait plus donner de direction. Regarde autour de toi, lève le bras, ou passe en mode phare.
          </p>
        </div>
        {staleNote}
      </div>
    );

  const dist = `≈ ${formatDistance(g.distance, g.uncertainty)}`;
  if (g.kind === 'uncertain')
    return (
      <div className="nav-stage">
        <Dial bearing={g.bearing} spread={60} mode={mode} course={course} dim />
        <div>
          <div className="distance">{dist}</div>
          <p className="warn" style={{ margin: '6px 0 0' }}>
            Direction incertaine : les positions sont trop imprécises (± {Math.round(g.uncertainty)} m) pour cette distance. Plutôt vers le {cardinal(g.bearing)}.
          </p>
        </div>
        {staleNote}
      </div>
    );

  return (
    <div className="nav-stage">
      <Dial bearing={g.bearing} spread={g.spread} mode={mode} course={course} />
      <div>
        <div className="distance" aria-live="polite">
          {dist}
        </div>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          à vol d’oiseau, vers le {cardinal(g.bearing)} · les obstacles ne sont pas pris en compte
        </p>
      </div>
      {staleNote}
      {me && me.acc > THRESHOLDS.impreciseM && <p className="warn small" style={{ margin: 0 }}>Ta position est imprécise (± {Math.round(me.acc)} m).</p>}
    </div>
  );
}

function NoMe({ reason }: { reason: 'locating' | 'denied' | 'unavailable' }) {
  const loc = useObservable(location);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="nav-stage">
      <Dial bearing={null} spread={0} mode="north" course={null} dim />
      {reason === 'denied' ? (
        <>
          <p className="danger" style={{ margin: 0 }}>
            Localisation refusée : impossible de calculer la direction.
          </p>
          <p className="muted small" style={{ margin: 0, maxWidth: 340 }}>
            Autorise la localisation pour ce site (icône de cadenas dans la barre d’adresse, ou Réglages → Safari → Localisation sur iPhone), puis réessaie.
          </p>
          <button type="button" className="btn" onClick={retryLocation}>
            <Icon name="refresh" /> Réessayer
          </button>
        </>
      ) : reason === 'unavailable' ? (
        <p className="danger" style={{ margin: 0, maxWidth: 340 }}>
          {loc.error ?? 'Localisation indisponible sur cet appareil.'}
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }} role="status">
            On cherche ta position…
          </p>
          {slow && (
            <p className="muted small" style={{ margin: 0, maxWidth: 340 }}>
              Le GPS capte mal sous les structures et à l’intérieur. Sors à découvert si tu peux.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CompassHelp({ mode }: { mode: DialMode }) {
  const cmp = useObservable(compass);
  if (cmp.status === 'needs-permission')
    return (
      <div className="banner info" role="status">
        <Icon name="compass" />
        <span>Pour que la flèche suive ton téléphone, autorise l’accès à la boussole.</span>
        <button type="button" className="btn small primary" onClick={() => void requestCompassPermission()}>
          Activer
        </button>
      </div>
    );
  if (cmp.status === 'starting') return <p className="faint small" style={{ margin: 0, textAlign: 'center' }}>Activation de la boussole…</p>;
  if (cmp.status === 'unstable')
    return (
      <div className="banner warn" role="status">
        <Icon name="alert" />
        <span>Boussole perturbée : éloigne-toi du métal et des enceintes, puis fais un « 8 » avec le téléphone.</span>
      </div>
    );
  if (mode === 'compass') return <p className="faint small" style={{ margin: 0, textAlign: 'center' }}>Tiens le téléphone à plat, devant toi.</p>;
  const why =
    cmp.status === 'denied'
      ? compassNeedsGesture()
        ? 'Accès à la boussole refusé (pour le rétablir sur iPhone : ferme l’onglet et rouvre myRaveLoc).'
        : 'Accès à la boussole refusé.'
      : 'Pas de boussole disponible sur cet appareil ou ce navigateur.';
  return (
    <div className="banner warn" role="status">
      <Icon name="compass" />
      <span>{mode === 'course' ? `${why} La flèche suit ta direction de marche : continue d’avancer.` : `${why} La flèche est orientée nord en haut : repère le nord avant de la suivre.`}</span>
    </div>
  );
}

/**
 * Le cadran. En mode boussole, la rose (N) et la flèche tournent à chaque image selon le cap lissé ;
 * sinon elles sont posées une fois (nord en haut, ou cap de marche GPS).
 */
function Dial({ bearing, spread, mode, course, dim }: { bearing: number | null; spread: number; mode: DialMode; course: number | null; dim?: boolean }) {
  const arrow = useRef<HTMLDivElement>(null);
  const rose = useRef<HTMLDivElement>(null);
  const target = useRef({ bearing, mode, course });
  target.current = { bearing, mode, course };

  useEffect(() => {
    let raf = 0;
    let shown = NaN;
    const paint = () => {
      raf = 0;
      const t = target.current;
      const heading = t.mode === 'compass' ? currentHeading() : t.mode === 'course' ? t.course : 0;
      const h = heading ?? 0;
      const key = (t.bearing ?? -1) * 1000 + h;
      if (key === shown) return;
      shown = key;
      if (rose.current) rose.current.style.transform = `rotate(${-h}deg)`;
      if (arrow.current && t.bearing != null) arrow.current.style.transform = `rotate(${arrowRotationDeg(t.bearing, h)}deg)`;
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    const off = onHeading(request);
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [bearing, mode, course]);

  const wedge = Math.min(80, Math.max(4, spread));
  const a = (wedge * Math.PI) / 180;
  const wx = 100 * Math.sin(a);
  const wy = 100 * Math.cos(a);

  return (
    <div className={`dial${dim ? ' dim' : ''}`} role="img" aria-label={bearing == null ? 'Direction inconnue' : mode === 'north' ? 'Flèche orientée nord en haut' : 'Flèche vers ton ami'}>
      <div className="rotor" ref={rose}>
        <svg viewBox="-120 -120 240 240" aria-hidden>
          <circle r="112" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
          {Array.from({ length: 36 }, (_, i) => (
            <line key={i} x1="0" y1={-112} x2="0" y2={i % 9 === 0 ? -98 : -105} stroke={i === 0 ? 'var(--danger)' : 'var(--line-strong)'} strokeWidth={i % 9 === 0 ? 3 : 1.5} transform={`rotate(${i * 10})`} />
          ))}
          <text x="0" y="-80" textAnchor="middle" dominantBaseline="middle" fill="var(--danger)" fontFamily="var(--font-display)" fontWeight="800" fontSize="18">
            N
          </text>
        </svg>
      </div>
      {bearing != null && (
        <div className="rotor" ref={arrow}>
          <svg viewBox="-120 -120 240 240" aria-hidden>
            <defs>
              <linearGradient id="arrow-g" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="var(--brand-b)" />
                <stop offset="1" stopColor="var(--brand-a)" />
              </linearGradient>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            {/* Cône d'incertitude : plus il est large, moins la direction est sûre. */}
            <path d={`M0 0 L${-wx} ${-wy} A100 100 0 0 1 ${wx} ${-wy} Z`} fill="var(--brand-a)" opacity="0.13" />
            <path d="M0 -92 L34 30 L0 12 L-34 30 Z" fill="var(--brand-a)" opacity="0.55" filter="url(#glow)" />
            <path d="M0 -92 L34 30 L0 12 L-34 30 Z" fill="url(#arrow-g)" stroke="#04140f" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

/** Écran plein de lumière qui pulse : lever le téléphone pour être repéré dans la foule. */
function Beacon({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Quitter le mode phare"
      className="beacon"
    >
      Lève ton téléphone · touche pour quitter
    </button>
  );
}

/** Garde l'écran allumé pendant la navigation (sinon le téléphone se verrouille et tout s'arrête). */
function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let alive = true;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      nav.wakeLock!.request('screen').then(
        (l) => {
          if (alive) lock = l;
          else void l.release();
        },
        () => undefined,
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}
