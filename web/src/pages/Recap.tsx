import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addWeeks, recap, recapWeekFor, timeline, weekStart, wrappedFor, type Quest, type Recap } from '../vendor/lumen';
import { periodName, periodRecap, weekRange } from '../recapText';
import { Icon, type IconName } from '../ui/icons';
import { Badge, Button, Card, IconButton, Reveal, SectionTitle, ToggleRow } from '../ui/index';
import { toast } from '../ui/toastStore';
import { pushSupported, setWeekly, weeklyStatus } from '../push';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { markSeen, useStatsInput, wasSeen } from '../ui/stats';
import { STAT_ICON } from '../ui/statIcons';

/**
 * Bilans : « Ta semaine » (carte du dimanche et du lundi sur l'accueil, page /bilan pour parcourir les
 * semaines) et l'entrée du Wrapped (mois, année). Que des nombres : séances, jours, groupes, points.
 */

const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n: number) => nf.format(Math.round(n));

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n > 1 ? many : one}`;

function hasActivity(r: Recap) {
  return r.xp > 0 || r.sessions > 0 || r.tracked > 0 || r.socialWeeks > 0;
}

/**
 * « Rappel du dimanche » : une notification le dimanche soir pour aller voir son bilan. Le serveur n'envoie
 * qu'un texte fixe (il ne connaît pas tes chiffres) ; caché si l'appareil ou le serveur ne sait pas faire.
 */
function WeeklyReminder() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    weeklyStatus()
      .then((s) => live && setOn(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (on === null) return null;
  const change = async (v: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await setWeekly(v);
      setOn(v);
      toast({ message: v ? 'Rappel activé : à dimanche !' : 'Rappel désactivé', tone: v ? 'gold' : undefined });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <ToggleRow label="Rappel du dimanche" hint="Une notification le dimanche soir pour voir ta semaine. Rien d’autre." checked={on} onChange={(v) => void change(v)} />
    </Card>
  );
}

/** Carte « Ta semaine » de l'accueil : dimanche (la semaine qui s'achève) et lundi (celle qui vient de finir). */
export function WeekRecapCard() {
  const { stats, rest, today } = useStatsInput();
  const week = recapWeekFor(today);
  const r = useMemo(() => (week ? recap(stats, today, week, week, rest) : null), [stats, rest, today, week]);
  if (!week || !r || !hasActivity(r) || wasSeen(`week:${week}`)) return null;
  const parts = [r.apps.perf && plural(r.sessions, 'séance'), r.apps.finances && `${plural(r.under, 'jour')} sous le budget`, r.apps.raveloc && r.socialWeeks > 0 && 'une sortie avec ta bande'].filter(Boolean);
  return (
    <div className="relative">
      <Card to={`/bilan?semaine=${week}`} level="raised" label={`Ta semaine ${weekRange(week)} : +${fmt(r.xp)} XP`} onClick={() => markSeen(`week:${week}`)}>
        <div className="flex items-start gap-3 pr-9">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-gold" style={{ background: 'var(--surface-alt)' }} aria-hidden>
            <Icon name="calendar" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="t-label text-gold">{week === weekStart(today) ? 'Ta semaine, en bref' : 'Ta semaine est bouclée'}</p>
            <p className="t-body-strong">
              +{fmt(r.xp)} XP{r.goodWeeks > 0 ? ' · semaine réussie' : ''}
              {r.levelEnd > r.levelStart ? ` · niveau ${r.levelEnd} !` : ''}
            </p>
            {parts.length > 0 && <p className="t-small text-secondary">{parts.join(' · ')}</p>}
          </div>
        </div>
      </Card>
      <div className="absolute right-1.5 top-1.5">
        <IconButton icon="close" size={18} label="Masquer le bilan de la semaine" onClick={() => markSeen(`week:${week}`)} />
      </div>
    </div>
  );
}

/** Carte « Ton Wrapped est prêt » : début de mois (le mois fini), fin et début d'année (l'année). */
export function WrappedCard() {
  const { stats, rest, today } = useStatsInput();
  const w = wrappedFor(today);
  const r = useMemo(() => (w ? periodRecap(stats, today, w.period, rest) : null), [stats, rest, today, w?.period]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w || !r || !hasActivity(r) || wasSeen(`wrapped:${w.period}`)) return null;
  return (
    <Tilt>
      <Card to={`/wrapped?periode=${w.period}`} level="raised" glow label={`Ton Wrapped de ${periodName(w.period)} est prêt`} onClick={() => markSeen(`wrapped:${w.period}`)}>
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] text-white"
            style={{ background: 'linear-gradient(150deg, var(--accent-g0), var(--gold))', boxShadow: '0 8px 22px var(--accent-glow)' }}
            aria-hidden
          >
            <Icon name="sparkles" size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="t-label text-gold">Wrapped</p>
            <p className="t-title">Ton {w.kind === 'year' ? `année ${w.period}` : periodName(w.period)} en images</p>
            <p className="t-small text-secondary">+{fmt(r.xp)} XP · à regarder et à partager</p>
          </div>
          <Icon name="chevron-forward" className="text-muted" />
        </div>
      </Card>
    </Tilt>
  );
}

const QUEST_ICON: Record<Quest['stat'], IconName> = STAT_ICON;

function Delta({ now, before, unit }: { now: number; before: number | null; unit: string }) {
  if (before === null) return null;
  const d = now - before;
  if (d === 0) return <span className="t-caption text-muted">comme la semaine d’avant</span>;
  return (
    <span className={`t-caption ${d > 0 ? 'text-success' : 'text-muted'}`}>
      {d > 0 ? '+' : '−'}
      {plural(Math.abs(d), unit)} vs la semaine d’avant
    </span>
  );
}

function Block({ icon, color, title, children }: { icon: IconName; color: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ color, background: 'var(--surface-alt)' }} aria-hidden>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="t-label text-muted">{title}</p>
        {children}
      </div>
    </Card>
  );
}

export function RecapPage() {
  const { stats, rest, today } = useStatsInput();
  const [params, setParams] = useSearchParams();
  const current = weekStart(today);
  const asked = params.get('semaine');
  const week = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && weekStart(asked) <= current ? weekStart(asked) : (recapWeekFor(today) ?? current);
  const r = useMemo(() => recap(stats, today, week, week, rest), [stats, rest, today, week]);
  const before = useMemo(() => recap(stats, today, addWeeks(week, -1), addWeeks(week, -1), rest), [stats, rest, today, week]);
  const tl = useMemo(() => timeline(stats, today, rest), [stats, rest, today]);
  const thisWeek = tl.find((w) => w.week === week);
  const first = tl[0]?.week ?? current;
  const go = (n: number) => setParams({ semaine: addWeeks(week, n) }, { replace: true });
  const prevWeek = before.weeks > 0 ? before : null;
  const status = thisWeek?.good ? 'Semaine réussie' : week === current ? 'En cours' : thisWeek?.rest ? 'Semaine de repos' : r.weeks > 0 ? 'Semaine ratée' : null;

  return (
    <Screen stack title="Ta semaine" kicker={weekRange(week)} mood="today" back="/">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon="chevron-back" disabled={week <= first} onClick={() => go(-1)}>
            Avant
          </Button>
          {week !== current && (
            <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
              Cette semaine
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={week >= current} onClick={() => go(1)}>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              Après <Icon name="chevron-forward" size={16} />
            </span>
          </Button>
        </div>

        <Reveal index={0}>
          <Card level="raised" glow className="text-center">
            <p className="num font-display text-[44px] font-bold leading-none">+{fmt(r.xp)}</p>
            <p className="t-small mt-1 text-secondary">XP gagnés</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {status && <Badge tone={status === 'Semaine réussie' ? 'success' : status === 'Semaine ratée' ? 'warning' : 'neutral'}>{status}</Badge>}
              {r.levelEnd > r.levelStart && <Badge tone="gold">Niveau {r.levelEnd} atteint</Badge>}
              {(thisWeek?.streak ?? 0) > 1 && <Badge icon="flame">Série de {thisWeek!.streak}</Badge>}
            </div>
          </Card>
        </Reveal>

        {r.weeks === 0 && (
          <Card>
            <p className="t-small text-secondary">Rien à raconter cette semaine : tes apps n’avaient encore rien publié.</p>
          </Card>
        )}

        {r.apps.perf || prevWeek?.apps.perf ? (
          <Reveal index={1}>
            <Block icon="barbell" color="var(--accent)" title="Force">
              <p className="t-body-strong">
                {plural(r.sessions, 'séance')}
                {r.records > 0 ? ` · ${plural(r.records, 'record')}` : ''}
              </p>
              <Delta now={r.sessions} before={prevWeek ? prevWeek.sessions : null} unit="séance" />
            </Block>
          </Reveal>
        ) : null}

        {r.apps.finances || prevWeek?.apps.finances ? (
          <Reveal index={2}>
            <Block icon="diamond-fill" color="var(--gold)" title="Discipline">
              <p className="t-body-strong">
                {plural(r.under, 'jour')} sous ton budget{r.tracked > 0 ? ` sur ${r.tracked}` : ''}
                {r.saved > 0 ? ' · épargne du cycle tenue' : ''}
              </p>
              <Delta now={r.under} before={prevWeek ? prevWeek.under : null} unit="jour" />
            </Block>
          </Reveal>
        ) : null}

        {r.apps.raveloc || prevWeek?.apps.raveloc ? (
          <Reveal index={3}>
            <Block icon="people-fill" color="var(--success)" title="Social">
              <p className="t-body-strong">{r.socialWeeks > 0 ? `Sortie avec ta bande${r.friends > 0 ? ` · ${plural(r.friends, 'ami')}` : ''}` : 'Pas de groupe cette semaine'}</p>
            </Block>
          </Reveal>
        ) : null}

        {thisWeek && thisWeek.quests.length > 0 && (
          <Reveal index={4}>
            <SectionTitle>Quêtes</SectionTitle>
            <Card className="divide-y divide-line">
              {thisWeek.quests.map((q) => (
                <div key={q.id} className="flex items-center gap-3 py-2.5">
                  <Icon name={QUEST_ICON[q.stat]} size={18} className={q.done ? 'text-success' : 'text-muted'} />
                  <span className={`t-body min-w-0 flex-1 ${q.done ? '' : 'text-secondary'}`}>{q.title}</span>
                  <span className="num t-small shrink-0 text-secondary">{q.done ? <Icon name="check-circle" size={18} className="text-success" /> : `${q.progress}/${q.target}`}</span>
                </div>
              ))}
            </Card>
          </Reveal>
        )}

        <Reveal index={5}>
          <SectionTitle>Wrapped</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Card to={`/wrapped?periode=${week.slice(0, 7)}`} label={`Wrapped de ${periodName(week.slice(0, 7))}`}>
              <Icon name="sparkles" className="text-gold" />
              <p className="t-body-strong mt-1">Ton {periodName(week.slice(0, 7))}</p>
              <p className="t-caption text-muted">en images</p>
            </Card>
            <Card to={`/wrapped?periode=${week.slice(0, 4)}`} label={`Wrapped de l’année ${week.slice(0, 4)}`}>
              <Icon name="trophy" className="text-gold" />
              <p className="t-body-strong mt-1">Ton année {week.slice(0, 4)}</p>
              <p className="t-caption text-muted">depuis janvier</p>
            </Card>
          </div>
        </Reveal>

        <Reveal index={6}>
          <WeeklyReminder />
        </Reveal>

        <p className="t-caption px-1 pt-1 text-center text-muted">Calculé sur ton appareil : des nombres par semaine, aucun montant.</p>
      </div>
    </Screen>
  );
}
