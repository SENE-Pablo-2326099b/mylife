import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localToday, musicPeriod, titleFor, type Recap } from '../vendor/lumen';
import { setDockHidden } from '../ui/dockStore';
import { Icon, type IconName } from '../ui/icons';
import { Button } from '../ui/index';
import { haptic, springs } from '../ui/motion';
import { useMusic, useStatsInput } from '../ui/stats';
import { useTheme } from '../ui/themeRuntime';
import { toast } from '../ui/toastStore';
import { useGoBack } from '../ui/useGoBack';
import { drawWrapped, shareImage } from '../wrappedImage';
import { periodName, periodRecap } from '../recapText';

/**
 * Le Wrapped : ton mois ou ton année en « stories » plein écran (toucher à droite : suivante, à gauche :
 * précédente, appui long : pause), puis une image à partager, dessinée sur l'appareil. Que des nombres.
 */

const SLIDE_MS = 6000;
const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n: number) => nf.format(Math.round(n));
const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);

interface Slide {
  id: string;
  icon: IconName;
  kicker: string;
  big: string;
  unit: string;
  lines: string[];
}

function slidesFor(r: Recap, name: string, topArtist: string | null): Slide[] {
  const out: Slide[] = [];
  out.push({ id: 'intro', icon: 'sparkles', kicker: 'Wrapped', big: name.charAt(0).toUpperCase() + name.slice(1), unit: `${r.weeks} ${plural(r.weeks, 'semaine')} de ta vraie vie`, lines: ['Prêt ? Touche pour avancer.'] });
  if (r.apps.perf) {
    out.push({
      id: 'force',
      icon: 'barbell',
      kicker: 'Force',
      big: fmt(r.sessions),
      unit: plural(r.sessions, 'séance'),
      lines: [r.records > 0 ? `${fmt(r.records)} ${plural(r.records, 'record')} ${plural(r.records, 'battu')}` : 'Pas de record cette fois : la prochaine sera la bonne', `Objectif tenu ${fmt(r.goalWeeks)} ${plural(r.goalWeeks, 'semaine')} sur ${fmt(r.weeks)}`],
    });
  }
  if (r.apps.finances) {
    const pct = r.tracked > 0 ? Math.round((r.under / r.tracked) * 100) : 0;
    out.push({
      id: 'discipline',
      icon: 'diamond-fill',
      kicker: 'Discipline',
      big: fmt(r.under),
      unit: `${plural(r.under, 'jour')} sous ton budget`,
      lines: [`${pct} % des jours suivis`, r.saved > 0 ? `Épargne tenue sur ${fmt(r.saved)} ${plural(r.saved, 'cycle')}` : 'L’épargne du cycle : le défi du prochain'],
    });
  }
  if (r.apps.raveloc) {
    out.push({
      id: 'social',
      icon: 'people-fill',
      kicker: 'Social',
      big: fmt(r.socialWeeks),
      unit: `${plural(r.socialWeeks, 'semaine')} avec ta bande`,
      lines: r.friends > 0 ? [`Jusqu’à ${fmt(r.friends)} ${plural(r.friends, 'ami')} réunis`] : [],
    });
  }
  if (r.apps.music && r.listenMinutes > 0) {
    const h = r.listenMinutes / 60;
    out.push({
      id: 'culture',
      icon: 'sparkles',
      kicker: 'Culture',
      big: h >= 2 ? fmt(h) : fmt(r.listenMinutes),
      unit: h >= 2 ? 'heures de musique' : 'minutes de musique',
      lines: [topArtist ? `Ton artiste n°1 : ${topArtist}` : '', r.discoveries > 0 ? `${fmt(r.discoveries)} ${plural(r.discoveries, 'artiste découvert', 'artistes découverts')}` : ''].filter(Boolean),
    });
  }
  out.push({
    id: 'personnage',
    icon: 'flame',
    kicker: 'Ton personnage',
    big: `+${fmt(r.xp)}`,
    unit: 'XP gagnés',
    lines: [
      r.levelEnd > r.levelStart ? `Niveau ${r.levelStart} → ${r.levelEnd} : ${titleFor(r.levelEnd)}` : `Niveau ${r.levelEnd} : ${titleFor(r.levelEnd)}`,
      r.bestStreak > 0 ? `Plus longue série : ${fmt(r.bestStreak)} ${plural(r.bestStreak, 'semaine')}` : `${fmt(r.goodWeeks)} ${plural(r.goodWeeks, 'semaine')} ${plural(r.goodWeeks, 'réussie')}`,
    ],
  });
  out.push({ id: 'final', icon: 'trophy', kicker: 'À partager', big: '', unit: '', lines: [] });
  return out;
}

function useReducedMotion() {
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return reduced;
}

function Segments({ count, index, paused, auto, onEnd }: { count: number; index: number; paused: boolean; auto: boolean; onEnd: () => void }) {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }}>
          {i < index && <span className="block h-full w-full rounded-full bg-white" />}
          {i === index && (
            <span
              key={`${index}-${auto}`}
              className="block h-full rounded-full bg-white"
              style={auto ? { width: '100%', transformOrigin: 'left', animation: `wrapped-fill ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' } : { width: '100%' }}
              onAnimationEnd={onEnd}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function Final({ r, name, onReplay }: { r: Recap; name: string; onReplay: () => void }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const blocks = [
    r.apps.perf && { value: fmt(r.sessions), label: plural(r.sessions, 'séance') },
    r.apps.perf && r.records > 0 && { value: fmt(r.records), label: plural(r.records, 'record') },
    r.apps.finances && { value: fmt(r.under), label: 'jours sous le budget' },
    r.apps.raveloc && r.socialWeeks > 0 && { value: fmt(r.socialWeeks), label: 'semaines avec ma bande' },
    r.apps.music && r.listenMinutes >= 60 && { value: fmt(r.listenMinutes / 60), label: 'heures de musique' },
    { value: fmt(r.goodWeeks), label: plural(r.goodWeeks, 'semaine réussie', 'semaines réussies') },
    { value: `+${fmt(r.xp)}`, label: 'XP' },
  ].filter((b): b is { value: string; label: string } => !!b);
  const level = r.levelEnd > r.levelStart ? `Niveau ${r.levelStart} → ${r.levelEnd} · ${titleFor(r.levelEnd)}` : `Niveau ${r.levelEnd} · ${titleFor(r.levelEnd)}`;

  const share = async () => {
    setBusy(true);
    try {
      const blob = await drawWrapped({ title: `Mon ${name.replace(/^l’/, '')}`, subtitle: `${r.weeks} ${plural(r.weeks, 'semaine')} de ma vraie vie`, blocks: blocks.slice(0, 4), level, footer: 'Le RPG de ma vraie vie · MyLife' }, t);
      const out = await shareImage(blob, `mylife-wrapped-${r.from.slice(0, 7)}.png`, `Mon Wrapped MyLife`);
      if (out === 'downloaded') toast({ message: 'Image enregistrée', tone: 'gold' });
      haptic('success');
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Image impossible à créer.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4" onClick={(e) => e.stopPropagation()}>
      <p className="t-label text-gold">Ton {name.replace(/^l’/, '')} en bref</p>
      <div className="grid grid-cols-2 gap-2.5">
        {blocks.slice(0, 4).map((b) => (
          <div key={b.label} className="glass glass-raised rounded-lg p-4">
            <p className="num font-display text-[34px] font-bold leading-none">{b.value}</p>
            <p className="t-small mt-1 text-secondary">{b.label}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg p-4 font-display text-[19px] font-bold" style={{ background: 'linear-gradient(120deg, var(--accent-g0), var(--accent-g1))', color: 'var(--on-accent)' }}>
        {level}
      </div>
      <Button size="lg" icon="share" disabled={busy} onClick={() => void share()}>
        {busy ? 'Préparation…' : 'Partager l’image'}
      </Button>
      <Button variant="ghost" icon="repeat" onClick={onReplay}>
        Revoir
      </Button>
      <p className="t-caption text-center text-muted">L’image est créée sur ton téléphone : aucun montant, aucun nom de compte.</p>
    </div>
  );
}

export function WrappedPage() {
  const { stats, rest, today } = useStatsInput();
  const [params] = useSearchParams();
  const goBack = useGoBack('/');
  const reduced = useReducedMotion();
  const asked = params.get('periode') ?? '';
  const period = /^\d{4}(-\d{2})?$/.test(asked) ? asked : localToday().slice(0, 7);
  const name = periodName(period);
  const r = useMemo(() => periodRecap(stats, today, period, rest), [stats, rest, today, period]);
  const music = useMusic();
  const topArtist = music ? (musicPeriod(music, period).artists[0]?.[0] ?? null) : null;
  const slides = useMemo(() => slidesFor(r, name, topArtist), [r, name, topArtist]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slide = slides[Math.min(index, slides.length - 1)]!;
  const last = index >= slides.length - 1;

  useEffect(() => {
    setDockHidden(true);
    return () => setDockHidden(false);
  }, []);

  const next = () => {
    if (!last) {
      haptic('tap');
      setIndex((i) => Math.min(slides.length - 1, i + 1));
    }
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const empty = r.weeks === 0 || r.xp === 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex select-none flex-col overflow-hidden"
      style={{ background: 'linear-gradient(170deg, var(--field-0), var(--field-1) 55%, var(--field-2))', paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Wrapped de ${name}`}
    >
      <style>{'@keyframes wrapped-fill { from { transform: scaleX(0) } to { transform: scaleX(1) } }'}</style>
      <div aria-hidden className="pointer-events-none absolute -left-24 top-10 h-[420px] w-[420px] rounded-full opacity-60 blur-3xl" style={{ background: 'var(--accent-glow)' }} />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-24 h-[420px] w-[420px] rounded-full opacity-50 blur-3xl" style={{ background: 'var(--gold-halo, var(--accent-glow))' }} />

      <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col gap-3 px-4">
        {!empty && <Segments count={slides.length} index={index} paused={paused} auto={!reduced && !last} onEnd={next} />}
        <div className="flex items-center justify-between">
          <span className="t-label text-secondary">MyLife · Wrapped</span>
          <button type="button" onClick={goBack} className="flex h-10 w-10 items-center justify-center rounded-full text-ink" aria-label="Fermer le Wrapped">
            <Icon name="close" size={22} />
          </button>
        </div>
      </div>

      {empty ? (
        <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-3 px-6">
          <p className="t-large">Pas encore de Wrapped pour {name}</p>
          <p className="t-body text-secondary">Il se remplit tout seul avec tes séances, ton budget et tes sorties. Reviens à la fin du mois.</p>
          <Button className="mt-2 self-start" variant="secondary" onClick={goBack}>
            Retour
          </Button>
        </div>
      ) : (
        <div
          className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 items-center px-6"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          onClick={(e) => {
            if (last) return;
            const box = e.currentTarget.getBoundingClientRect();
            if (e.clientX - box.left < box.width / 3) prev();
            else next();
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={slide.id}
              className="w-full"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -18 }}
              transition={springs.soft}
              aria-live="polite"
            >
              {slide.id === 'final' ? (
                <Final r={r} name={name} onReplay={() => setIndex(0)} />
              ) : (
                <SlideBody slide={slide} />
              )}
            </m.div>
          </AnimatePresence>
        </div>
      )}
      {!empty && !last && <p className="t-caption relative z-10 text-center text-muted">Touche pour avancer · appui long pour faire pause</p>}
    </div>
  );
}

function SlideBody({ slide }: { slide: Slide }): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <span className="flex h-14 w-14 items-center justify-center rounded-[18px] text-white" style={{ background: 'linear-gradient(150deg, var(--accent-g0), var(--gold))', boxShadow: '0 10px 30px var(--accent-glow)' }} aria-hidden>
        <Icon name={slide.icon} size={28} />
      </span>
      <p className="t-label text-gold">{slide.kicker}</p>
      <p className={`num font-display font-bold leading-[0.95] ${slide.id === 'intro' ? 'text-[56px]' : 'text-[96px]'}`}>{slide.big}</p>
      <p className="t-title">{slide.unit}</p>
      {slide.lines.map((l) => (
        <p key={l} className="t-body text-secondary">
          {l}
        </p>
      ))}
    </div>
  );
}
