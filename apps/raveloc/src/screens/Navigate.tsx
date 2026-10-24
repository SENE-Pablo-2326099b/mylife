import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useObservable } from '../lib/observable';
import { app, setScreen, type Member } from '../state/app';
import { location, needLocation } from '../services/location';
import { compass, compassNeedsGesture, currentHeading, onHeading, requestCompassPermission, holdCompass } from '../services/orientation';
import { arrowRotationDeg, cardinal, formatDistance } from '../domain/geo';
import { ageOf, formatAge, freshness, guidance, THRESHOLDS, type Fix, type Guidance } from '../domain/status';
import { describe, TONE, usableMe } from '../lib/describe';
import { Avatar, Banner, BRAND, NetBanner, useNow } from '../components/kit';
import { setBeacon } from '../components/Beacon';
import { Button, Card } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { LocationHelp } from '../components/LocationHelp';

type DialMode = 'compass' | 'course' | 'north';

/**
 * Navigation vers un ami : une flèche, une distance, et la vérité sur la qualité des données.
 * La flèche suit la boussole à chaque image sans passer par React (pas de rendu inutile).
 */
export function Navigate() {
  const uid = useParams().uid ?? '';
  const navigate = useNavigate();
  const back = () => navigate('/');
  const s = useObservable(app);
  const loc = useObservable(location);
  const cmp = useObservable(compass);
  const now = useNow(1000);
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
    <Screen stack title={member?.name ?? 'Ami'} kicker={line?.text} mood="focus" back="/">
      <div className="flex flex-col gap-3" style={{ ['--brand-a' as string]: BRAND[0], ['--brand-b' as string]: BRAND[1] }}>
        {member && <span className="sr-only">{line?.text}</span>}
        <NetBanner />

        {!live || live.status === 'loading' ? (
          <div className="nav-stage" role="status">
            <p className="t-body text-secondary">Chargement du groupe…</p>
          </div>
        ) : !member ? (
          <div className="nav-stage">
            <p className="t-body">Cette personne ne fait plus partie du groupe.</p>
            <Button variant="secondary" onClick={back}>
              Revenir au groupe
            </Button>
          </div>
        ) : (
          <Stage g={g!} member={member} me={me} mode={mode} course={course} now={now} />
        )}

        {member && g && (g.kind === 'ok' || g.kind === 'uncertain') && <CompassHelp mode={mode} />}

        {member && (
          <Tilt>
          <Card className="flex flex-col gap-2" label="Qualité des données">
            <div className="flex items-center gap-3">
              <Avatar uid={member.uid} name={member.name} size={36} />
              <span className="t-small min-w-0 flex-1" style={{ color: line ? TONE[line.tone] : undefined }}>
                {line?.text}
              </span>
            </div>
            <Fact label="Sa position" value={member.fix ? `${formatAge(ageOf(member.fix, now))} · ± ${Math.round(member.fix.acc)} m` : 'inconnue'} tone={member.fix ? (freshness(ageOf(member.fix, now)) === 'live' ? 'ok' : 'warn') : 'muted'} />
            <Fact label="Ta position" value={loc.fix ? `${formatAge(Math.max(0, now - loc.fix.at))} · ± ${Math.round(loc.fix.acc)} m` : loc.status === 'denied' ? 'refusée' : 'en cours…'} tone={me ? (me.acc > THRESHOLDS.impreciseM ? 'warn' : 'ok') : 'warn'} />
            <Fact label="Orientation" value={modeLabel(mode, cmp.status)} tone={mode === 'compass' ? (cmp.status === 'unstable' ? 'warn' : 'ok') : 'warn'} />
          </Card>
          </Tilt>
        )}

        <Button size="lg" variant="secondary" icon="beacon" onClick={() => setBeacon(true)}>
          Mode phare
        </Button>
      </div>
    </Screen>
  );
}

function modeLabel(mode: DialMode, status: string): string {
  if (mode === 'compass') return status === 'unstable' ? 'boussole perturbée' : 'boussole';
  if (mode === 'course') return 'direction de ta marche (GPS)';
  return 'pas de boussole : nord en haut';
}

function Fact({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className="t-small flex items-baseline justify-between gap-3 border-t border-line pt-2">
      <span className="text-muted">{label}</span>
      <span className="text-right" style={{ color: TONE[tone] }}>
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
        ? `${name} ne partage pas sa position. Demande-lui d’activer le partage dans MyRave.`
        : g.state === 'paused'
          ? `${name} a mis son partage en pause.`
          : `${name} partage, mais sa position n’est pas encore arrivée (GPS en cours, ou autorisation refusée sur son téléphone).`;
    return (
      <div className="nav-stage">
        <Dial bearing={null} spread={0} mode="north" course={null} dim />
        <p className="t-body max-w-[340px] text-secondary">{msg}</p>
      </div>
    );
  }

  const age = member.fix ? ageOf(member.fix, now) : 0;
  const fr = freshness(age);
  const stale = fr === 'old' || fr === 'stale';
  const staleNote = stale ? (
    <Banner tone={fr === 'stale' ? 'danger' : 'warning'} icon="warning">
      Dernière position {formatAge(age)} : {name} a pu bouger depuis. La flèche vise cette dernière position connue.
    </Banner>
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
          <p className="t-small mt-1.5 text-secondary">
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
          <p className="t-small mt-1.5 text-warning">
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
        <p className="t-small mt-1 text-secondary">
          à vol d’oiseau, vers le {cardinal(g.bearing)} · les obstacles ne sont pas pris en compte
        </p>
      </div>
      {staleNote}
      {me && me.acc > THRESHOLDS.impreciseM && <p className="t-small text-warning">Ta position est imprécise (± {Math.round(me.acc)} m).</p>}
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
          <p className="t-body text-danger">Localisation refusée : impossible de calculer la direction.</p>
          <div className="max-w-[340px]">
            <LocationHelp />
          </div>
        </>
      ) : reason === 'unavailable' ? (
        <p className="t-body max-w-[340px] text-danger">{loc.error ?? 'Localisation indisponible sur cet appareil.'}</p>
      ) : (
        <>
          <p className="t-body" role="status">
            On cherche ta position…
          </p>
          {slow && (
            <p className="t-small max-w-[340px] text-secondary">
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
      <Banner
        tone="info"
        icon="compass"
        action={
          <Button size="sm" onClick={() => void requestCompassPermission()}>
            Activer
          </Button>
        }
      >
        Pour que la flèche suive ton téléphone, autorise l’accès à la boussole.
      </Banner>
    );
  if (cmp.status === 'starting') return <p className="t-small text-center text-muted">Activation de la boussole…</p>;
  if (cmp.status === 'unstable')
    return (
      <Banner tone="warning" icon="warning">
        Boussole perturbée : éloigne-toi du métal et des enceintes, puis fais un « 8 » avec le téléphone.
      </Banner>
    );
  if (mode === 'compass') return <p className="t-small text-center text-muted">Tiens le téléphone à plat, devant toi.</p>;
  const why =
    cmp.status === 'denied'
      ? compassNeedsGesture()
        ? 'Accès à la boussole refusé (pour le rétablir sur iPhone : ferme l’onglet et rouvre MyRave).'
        : 'Accès à la boussole refusé.'
      : 'Pas de boussole disponible sur cet appareil ou ce navigateur.';
  return (
    <Banner tone="warning" icon="compass">
      {mode === 'course' ? `${why} La flèche suit ta direction de marche : continue d’avancer.` : `${why} La flèche est orientée nord en haut : repère le nord avant de la suivre.`}
    </Banner>
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
          <circle r="112" fill="none" stroke="var(--border-strong, var(--border))" strokeWidth="2" />
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
            <path d="M0 -92 L34 30 L0 12 L-34 30 Z" fill="url(#arrow-g)" stroke="var(--bg)" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
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
