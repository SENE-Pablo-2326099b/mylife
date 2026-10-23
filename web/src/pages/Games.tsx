import { useMemo, useState } from 'react';
import { addManual, addSnapshot, addWeeks, emptyGames, gameTotals, gameWeeks, localToday, monthWeeks, removeManual, timeSplit, weekStart, type SteamGameTotals } from '../vendor/lumen';
import { currentSession, webPlatform } from '../vendor/mylife-sync/web';
import { ColumnChart } from '../ui/charts';
import { Icon, type IconName } from '../ui/icons';
import { Button, Card, Disclosure, Reveal, Segmented, SectionTitle, TextField } from '../ui/index';
import { Screen } from '../ui/Screen';
import { saveGames, useGames, useMusic, useStatsInput } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * MyGames : tes heures de jeu (Steam par le relais du serveur, ou à la main), et « Où va ton temps ? » :
 * sport, musique, jeu, côte à côte. Le jeu ne rapporte pas d'XP au Personnage. Logique : packages/lumen/src/games.ts.
 */

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmtHours = (min: number) => (min >= 60 ? `${nf.format(Math.round(min / 6) / 10)} h` : `${Math.round(min)} min`);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dayLabel = (d: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`));

type Period = 'semaine' | 'mois' | 'tout';

function range(period: Period, today: string): { from: string; to: string; label: string } {
  if (period === 'semaine') return { from: weekStart(today), to: weekStart(today), label: 'cette semaine' };
  if (period === 'mois') return { ...monthWeeks(today.slice(0, 7)), label: 'ce mois-ci' };
  return { from: '0000-01-01', to: weekStart(today), label: 'depuis le début' };
}

export function GamesPage() {
  const data = useGames() ?? emptyGames();
  const today = localToday();
  const [profile, setProfile] = useState(data.steamProfile ?? '');
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<Period>('semaine');
  const [game, setGame] = useState('');
  const [minutes, setMinutes] = useState('');
  const r = range(period, today);
  const totals = useMemo(() => gameTotals(data, r.from, r.to), [data, r.from, r.to]);
  const weeks = useMemo(() => gameWeeks(data), [data]);
  const chart = Array.from({ length: 8 }, (_, i) => addWeeks(weekStart(today), i - 7)).map((w) => ({ label: dayLabel(w), value: Math.round(Object.values(weeks[w] ?? {}).reduce((a, b) => a + b, 0) / 6) / 10 }));
  const last = data.snapshots[data.snapshots.length - 1];
  const known = [...new Set(Object.values(data.names))].slice(0, 30);

  const steam = async () => {
    const session = currentSession();
    if (!session || !profile.trim()) return;
    setBusy(true);
    try {
      const res = await webPlatform.api.call<{ steamId: string; games: SteamGameTotals[] }>('/api/games', { action: 'steam', profile: profile.trim() }, session.token);
      saveGames(addSnapshot(data, today, res.games, profile.trim()));
      toast({ message: `${res.games.length} jeux Steam à jour`, tone: 'gold' });
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const addPlay = () => {
    const m = Math.round(Number(minutes.replace(',', '.')));
    if (!game.trim() || !(m > 0) || m > 24 * 60) return toast({ message: 'Indique un jeu et une durée en minutes.' });
    saveGames(addManual(data, { id: crypto.randomUUID(), game: game.trim(), day: today, minutes: m }));
    setMinutes('');
    toast({ message: `${fmtHours(m)} de ${game.trim()} notées` });
  };

  const top = totals.filter((t) => (period === 'tout' ? t.total : t.period) > 0).slice(0, 10);
  const maxTop = Math.max(1, ...top.map((t) => (period === 'tout' ? t.total : t.period)));

  return (
    <Screen stack title="MyGames" kicker="Tes heures de jeu" mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised">
            <p className="t-headline">Steam</p>
            <p className="t-small mt-1 text-secondary">Ton temps de jeu, mis à jour quand tu veux. Ton profil doit montrer ses jeux (Steam → Profil → Confidentialité → « Détails des jeux : Public »).</p>
            <div className="mt-3 flex flex-col gap-2">
              <TextField label="Ton profil Steam" value={profile} onChange={setProfile} placeholder="steamcommunity.com/id/… ou ton nom de profil" />
              <Button icon="sync" disabled={busy || !profile.trim()} onClick={() => void steam()}>
                {busy ? 'Mise à jour…' : 'Mettre à jour depuis Steam'}
              </Button>
              {last && <p className="t-caption text-muted">Dernière mise à jour : {dayLabel(last.day)}. Chaque mise à jour ajoute une photo : les heures de chaque semaine en découlent.</p>}
            </div>
          </Card>
        </Reveal>

        <Reveal index={1}>
          <Disclosure title="Noter une partie" summary="Console, mobile, hors Steam">
            <div className="flex flex-col gap-2">
              <TextField label="Jeu" value={game} onChange={setGame} placeholder="Mario Kart, FIFA…" />
              {known.length > 0 && !game && (
                <div className="flex flex-wrap gap-1.5">
                  {known.slice(0, 8).map((n) => (
                    <button key={n} type="button" className="t-caption rounded-pill border px-2.5 py-1" style={{ borderColor: 'var(--border)' }} onClick={() => setGame(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
              <TextField label="Durée aujourd’hui (minutes)" value={minutes} onChange={setMinutes} inputMode="numeric" placeholder="45" />
              <Button icon="add" variant="secondary" disabled={!game.trim() || !minutes.trim()} onClick={addPlay}>
                Noter
              </Button>
            </div>
          </Disclosure>
        </Reveal>

        <Segmented<Period>
          options={[
            { value: 'semaine', label: 'Semaine' },
            { value: 'mois', label: 'Mois' },
            { value: 'tout', label: 'Tout' },
          ]}
          value={period}
          onChange={setPeriod}
          label="Période"
        />

        <Reveal index={2}>
          <Card>
            <div className="flex items-baseline justify-between">
              <p className="t-headline">Tes jeux</p>
              <p className="t-small text-secondary">{r.label}</p>
            </div>
            {top.length === 0 && <p className="t-small mt-2 text-muted">Rien sur cette période. Mets à jour depuis Steam ou note une partie.</p>}
            <div className="mt-3 flex flex-col gap-2.5">
              {top.map((t) => {
                const v = period === 'tout' ? t.total : t.period;
                return (
                  <div key={t.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="t-body-strong truncate">{t.name}</span>
                      <span className="num t-small shrink-0 text-secondary">{fmtHours(v)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-alt)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (v / maxTop) * 100)}%`, background: 'linear-gradient(90deg, var(--accent-g0), var(--gold))' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Reveal>

        <Reveal index={3}>
          <SectionTitle>Tes 8 dernières semaines</SectionTitle>
          <Card>
            <ColumnChart data={chart} format={(v) => `${nf.format(v)}h`} label="Heures de jeu par semaine, les 8 dernières" />
          </Card>
        </Reveal>

        {data.manual.length > 0 && (
          <Reveal index={4}>
            <Disclosure title="Parties notées" summary={`${data.manual.length} au total`}>
              <div className="divide-y divide-line">
                {[...data.manual]
                  .reverse()
                  .slice(0, 15)
                  .map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-2">
                      <span className="t-body min-w-0 flex-1 truncate">{m.game}</span>
                      <span className="num t-small text-secondary">
                        {dayLabel(m.day)} · {fmtHours(m.minutes)}
                      </span>
                      <button type="button" className="text-muted" aria-label={`Supprimer ${m.game} du ${dayLabel(m.day)}`} onClick={() => saveGames(removeManual(data, m.id))}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  ))}
              </div>
            </Disclosure>
          </Reveal>
        )}

        <Card to="/temps" label="Où va ton temps ?">
          <div className="flex items-center gap-3">
            <Icon name="time" className="text-gold" />
            <span className="t-body-strong min-w-0 flex-1">Où va ton temps ?</span>
            <Icon name="chevron-forward" className="text-muted" />
          </div>
        </Card>
        <p className="t-caption px-1 text-center text-muted">Le jeu ne rapporte pas de points à ton personnage : ici, on regarde, on ne récompense pas le temps d’écran.</p>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------- Où va ton temps ?

const ROWS: { key: 'sport' | 'music' | 'games'; label: string; icon: IconName; to: string; color: string }[] = [
  { key: 'sport', label: 'Sport', icon: 'barbell', to: '/perf/', color: 'var(--accent)' },
  { key: 'music', label: 'Musique', icon: 'sparkles', to: '/musique', color: 'var(--gold)' },
  { key: 'games', label: 'Jeu', icon: 'play', to: '/jeux', color: 'var(--success)' },
];

export function TimePage() {
  const { stats } = useStatsInput();
  const games = useGames();
  const music = useMusic();
  const today = localToday();
  const [period, setPeriod] = useState<'semaine' | 'quatre' | 'mois'>('semaine');
  const from = period === 'semaine' ? weekStart(today) : period === 'quatre' ? addWeeks(weekStart(today), -3) : monthWeeks(today.slice(0, 7)).from;
  const split = timeSplit(stats, games, from, weekStart(today));
  const total = split.sport + split.music + split.games;
  const max = Math.max(1, split.sport, split.music, split.games);
  const top = ROWS.reduce((a, b) => (split[b.key] > split[a.key] ? b : a));
  const label = period === 'semaine' ? 'Cette semaine' : period === 'quatre' ? 'Ces 4 semaines' : 'Ce mois-ci';
  const musicLag = music?.to && music.to < from;

  return (
    <Screen stack title="Où va ton temps ?" kicker="Sport, musique, jeu" mood="today" back="/jeux">
      <div className="flex flex-col gap-3">
        <Segmented
          options={[
            { value: 'semaine', label: 'Semaine' },
            { value: 'quatre', label: '4 semaines' },
            { value: 'mois', label: 'Mois' },
          ]}
          value={period}
          onChange={setPeriod}
          label="Période"
        />
        <Reveal index={0}>
          <Card level="raised" glow>
            <p className="t-label text-gold">{label}</p>
            <p className="num font-display text-[36px] font-bold leading-none">{fmtHours(total)}</p>
            <p className="t-small mt-1 text-secondary">{total > 0 ? `surtout en ${top.label.toLowerCase()} (${fmtHours(split[top.key])})` : 'Rien de mesuré sur cette période pour l’instant.'}</p>
            <div className="mt-4 flex flex-col gap-3">
              {ROWS.map((r) => (
                <a key={r.key} href={r.to} className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="t-body-strong inline-flex items-center gap-2">
                      <span style={{ color: r.color }}>
                        <Icon name={r.icon} size={16} />
                      </span>
                      {r.label}
                    </span>
                    <span className="num t-small text-secondary">{fmtHours(split[r.key])}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-alt)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(split[r.key] / max) * 100}%`, background: r.color }} />
                  </div>
                </a>
              ))}
            </div>
          </Card>
        </Reveal>
        <Card>
          <p className="t-small text-secondary">
            Sport : la durée de tes séances terminées dans MyPerf. Musique : ton historique Spotify (MyMusique)
            {musicLag ? ', qui s’arrête avant cette période : refais ton export pour la voir' : ''}. Jeu : Steam et tes parties notées (MyGames).
          </p>
        </Card>
      </div>
    </Screen>
  );
}
