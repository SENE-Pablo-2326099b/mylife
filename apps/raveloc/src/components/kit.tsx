import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useObservable } from '../lib/observable';
import { app } from '../state/app';
import { formatAge } from '../domain/status';
import { hueOf, initial } from '../lib/format';
import { MYLIFE_APPS } from '../vendor/lumen';
import { Card } from '../ui/index';
import { Icon, type IconName } from '../ui/icons';
import { SkeletonCard } from '../ui/extras';
import { useTabActive } from '../ui/tabActive';

/**
 * Briques propres à MyRave, faites des briques communes de MyLife (src/ui) : avatars des amis,
 * bandeaux d'état du réseau, actions protégées, horloge d'affichage.
 */

/** Couleurs d'identité de MyRave (registre MyLife), les mêmes dans tous les thèmes. */
export const BRAND = MYLIFE_APPS.find((a) => a.id === 'raveloc')!.colors;

/** Balise de l'app : un point lumineux et ses ondes, aux couleurs de MyRave. */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND[0]} />
          <stop offset="1" stopColor={BRAND[1]} />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="none" stroke="url(#bm)" strokeWidth="2" opacity="0.45" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="url(#bm)" strokeWidth="2" opacity="0.75" />
      <path d="M20 9l6.5 17L20 22.2 13.5 26z" fill="url(#bm)" />
    </svg>
  );
}

export function Avatar({ uid, name, size = 44 }: { uid: string; name: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-[#0B0719]"
      style={{ width: size, height: size, fontSize: size * 0.42, background: hueOf(uid), boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)' }}
      aria-hidden
    >
      {initial(name)}
    </span>
  );
}

export type BannerTone = 'warning' | 'danger' | 'success' | 'info';

/** Bandeau d'état : une icône, une phrase, éventuellement une action. */
export function Banner({ tone, icon, children, action }: { tone: BannerTone; icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <Card tone={tone} className="flex items-start gap-3" padded>
      <span role="status" className="contents">
        <Icon name={icon} size={20} className={`mt-0.5 text-${tone}`} />
        <span className="t-small min-w-0 flex-1">{children}</span>
      </span>
      {action}
    </Card>
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
export function Pending({ rows = 2, label }: { rows?: number; label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {shown && Array.from({ length: rows }, (_, i) => <SkeletonCard key={i} lines={2} />)}
    </div>
  );
}

/**
 * État du réseau, toujours visible quand il pose problème : hors ligne, serveur injoignable, erreur
 * serveur, reprise. Les données affichées restent, avec leur âge.
 */
export function NetBanner() {
  const { net, sessionExpired } = useObservable(app);
  // Un onglet gardé en arrière-plan ne le montre pas : un seul bandeau à l'écran.
  const visible = useTabActive();
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
  if (sessionExpired || !visible) return null;
  const since = net.okAt ? ` Dernier échange réussi ${formatAge(now - net.okAt)}.` : '';
  if (!net.online)
    return (
      <Banner tone="warning" icon="offline">
        Hors ligne. Les positions affichées ne bougent plus et vieillissent.{since}
      </Banner>
    );
  if (net.unreachable)
    return (
      <Banner tone="warning" icon="offline">
        Réseau instable : nouvelle tentative automatique.{since}
      </Banner>
    );
  if (net.serverDown || net.failures > 1)
    return (
      <Banner tone="danger" icon="warning">
        {net.error ?? 'Erreur du serveur.'} Nouvelle tentative automatique.{since}
      </Banner>
    );
  if (recovered)
    return (
      <Banner tone="success" icon="check-circle">
        Connexion rétablie.
      </Banner>
    );
  return null;
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="t-small text-danger" role="alert">
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
