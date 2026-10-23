import { useMemo, useState } from 'react';
import { lastMonth, listeningStreak, localToday, musicPeriod, parseSpotifyFile, peakHour, summarizeMusic, trimMusicWeeks, type MusicSummary, type Play } from '../vendor/lumen';
import { ColumnChart } from '../ui/charts';
import { Icon } from '../ui/icons';
import { Button, Card, Disclosure, Reveal, Segmented, SectionTitle } from '../ui/index';
import { Screen } from '../ui/Screen';
import { publishStats, saveMusic, useMusic } from '../ui/stats';
import { toast } from '../ui/toastStore';
import { listZip } from '../zip';

/**
 * MyMusique : tes stats d'écoute Spotify, à partir de ton export de données (l'API de Spotify est fermée
 * aux nouvelles apps). Le fichier est lu sur l'appareil ; seul un résumé est gardé, chiffré dans ton compte.
 * Il alimente la stat Culture du Personnage. Logique : packages/lumen/src/music.ts.
 */

const nf = new Intl.NumberFormat('fr-FR');
const hours = (min: number) => (min >= 120 ? `${nf.format(Math.round(min / 60))} h` : `${nf.format(Math.round(min))} min`);
const monthName = (m: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00`));
const dayName = (d: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00`));
const HISTORY = /(Streaming_History|StreamingHistory)[^/]*\.json$/i;
const KEEP_MONTHS = 36;

/** Lit les fichiers choisis (.zip de l'export ou .json qu'il contient) et garde le résumé. */
async function importFiles(files: File[]): Promise<{ plays: number; files: number }> {
  const plays: Play[] = [];
  let read = 0;
  for (const f of files) {
    const sources: { name: string; read: () => Promise<string> }[] = f.name.toLowerCase().endsWith('.zip') ? (await listZip(f)).filter((e) => HISTORY.test(e.name)) : [{ name: f.name, read: () => f.text() }];
    for (const src of sources) {
      try {
        plays.push(...parseSpotifyFile(JSON.parse(await src.read())));
        read += 1;
      } catch {
        /* fichier illisible ou d'un autre type : ignoré */
      }
    }
  }
  if (!plays.length) return { plays: 0, files: read };
  const { summary, weeks } = summarizeMusic(plays);
  const months = Object.keys(summary.months).sort().slice(-KEEP_MONTHS);
  saveMusic({ ...summary, months: Object.fromEntries(months.map((m) => [m, summary.months[m]!])) });
  publishStats('music', { weeks: trimMusicWeeks(weeks, localToday()) });
  return { plays: plays.length, files: read };
}

function Importer({ again }: { again: boolean }) {
  const [busy, setBusy] = useState(false);
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.zip,.json,application/zip,application/json';
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      setBusy(true);
      importFiles(files)
        .then(
          (r) => toast({ message: r.plays ? `${nf.format(r.plays)} écoutes lues dans ${r.files} fichier${r.files > 1 ? 's' : ''}` : 'Aucune écoute trouvée : choisis le .zip de ton export Spotify (ou ses fichiers Streaming_History…json).', tone: r.plays ? 'gold' : undefined }),
          (e: unknown) => toast({ message: e instanceof Error ? e.message : String(e) }),
        )
        .finally(() => setBusy(false));
    };
    input.click();
  };
  return (
    <Card level={again ? 'pane' : 'raised'} glow={!again}>
      {!again && (
        <>
          <p className="t-title">Tes stats Spotify, chez toi</p>
          <ol className="t-small mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-secondary">
            <li>Sur spotify.com : Compte → Confidentialité → « Télécharger tes données ». Coche l’historique de streaming étendu (le plus complet) et/ou les données de compte.</li>
            <li>Spotify t’envoie un e-mail avec un fichier .zip (en quelques jours).</li>
            <li>Ouvre ce fichier ici : c’est tout.</li>
          </ol>
        </>
      )}
      <Button className={again ? 'w-full' : 'mt-4 w-full'} variant={again ? 'secondary' : 'primary'} icon="download" disabled={busy} onClick={pick}>
        {busy ? 'Lecture…' : again ? 'Mettre à jour avec un nouvel export' : 'Ouvrir mon export Spotify'}
      </Button>
      <p className="t-caption mt-2 text-muted">Le fichier est lu sur ton téléphone. On ne garde qu’un résumé (artistes, titres, durées) : pas d’adresse IP, pas de pays, rien d’autre. Chiffré dans ton compte.</p>
    </Card>
  );
}

type View = 'mois' | 'annee' | 'tout';

function Dashboard({ s }: { s: MusicSummary }) {
  const last = lastMonth(s) ?? localToday().slice(0, 7);
  const [view, setView] = useState<View>('mois');
  const period = view === 'mois' ? last : view === 'annee' ? last.slice(0, 4) : '';
  const p = useMemo(() => musicPeriod(s, period), [s, period]);
  const streak = listeningStreak(s.days, s.to || localToday());
  const peak = peakHour(s);
  const obsession = musicPeriod(s, last).tracks.reduce<[string, string, number, number] | null>((best, t) => (!best || t[3] > best[3] ? t : best), null);
  const buckets = Array.from({ length: 8 }, (_, i) => ({ label: `${i * 3}h`, value: s.hours.slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0) }));
  const maxBucket = Math.max(...buckets.map((b) => b.value));
  const months = Object.keys(s.months).sort().slice(-6);
  const maxArtist = p.artists[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <Reveal index={0}>
        <Card level="raised" glow>
          <p className="t-label text-gold">Depuis le {s.from ? dayName(s.from) : '…'}</p>
          <p className="num font-display text-[40px] font-bold leading-none">{hours(s.totalMinutes)}</p>
          <p className="t-small mt-1 text-secondary">
            d’écoute · {nf.format(s.artistsCount)} artistes · historique jusqu’au {s.to ? dayName(s.to) : '…'}
          </p>
          {obsession && (
            <p className="t-body mt-3 flex items-start gap-1.5">
              <span className="mt-[3px] text-gold">
                <Icon name="flame" size={16} />
              </span>
              <span>
                Obsession de {monthName(last).split(' ')[0]} : <strong>{obsession[0]}</strong> · {obsession[1]} ({obsession[3]} écoutes)
              </span>
            </p>
          )}
        </Card>
      </Reveal>

      <Segmented<View>
        options={[
          { value: 'mois', label: monthName(last).split(' ')[0]!.replace(/^./, (c) => c.toUpperCase()) },
          { value: 'annee', label: last.slice(0, 4) },
          { value: 'tout', label: 'Tout' },
        ]}
        value={view}
        onChange={setView}
        label="Période"
      />

      <Reveal index={1}>
        <Card>
          <div className="flex items-baseline justify-between">
            <p className="t-headline">Tes artistes</p>
            <p className="t-small text-secondary">
              {hours(p.minutes)} · {nf.format(p.plays)} écoutes
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {p.artists.map(([a, m], i) => (
              <div key={a}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-body-strong truncate">
                    <span className="num text-muted">{i + 1}.</span> {a}
                  </span>
                  <span className="num t-small shrink-0 text-secondary">{hours(m)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, (m / maxArtist) * 100)}%`, background: 'linear-gradient(90deg, var(--accent-g0), var(--gold))' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <Reveal index={2}>
        <Card>
          <p className="t-headline">Tes morceaux</p>
          <div className="mt-2 divide-y divide-line">
            {p.tracks.map(([t, a, m, n], i) => (
              <div key={`${t}${a}`} className="flex items-center gap-3 py-2">
                <span className="num t-small w-5 shrink-0 text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block truncate">{t}</span>
                  <span className="t-caption block truncate text-muted">{a}</span>
                </span>
                <span className="num t-small shrink-0 text-secondary">
                  {n}× · {hours(m)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      <Reveal index={3}>
        <SectionTitle>Tes habitudes</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <p className="num font-display text-[28px] font-bold">{peak === null ? '–' : `${peak}h`}</p>
            <p className="t-caption text-muted">ton heure d’écoute</p>
          </Card>
          <Card>
            <p className="num font-display text-[28px] font-bold">{streak.best} j</p>
            <p className="t-caption text-muted">plus longue série de jours</p>
          </Card>
        </div>
        <Card className="mt-2">
          <ColumnChart data={buckets.map((b) => ({ label: b.label, value: Math.round(b.value / 60), lit: b.value === maxBucket }))} format={(v) => `${v}h`} label="Heures d’écoute selon le moment de la journée" />
        </Card>
      </Reveal>

      <Reveal index={4}>
        <SectionTitle>Tes découvertes</SectionTitle>
        <Card>
          <ColumnChart data={months.map((m) => ({ label: monthName(m).slice(0, 4), value: s.months[m]!.newArtists }))} format={(v) => String(v)} label="Nouveaux artistes par mois, les six derniers" />
          <p className="t-caption mt-2 text-muted">Artistes écoutés pour la première fois de ton historique. Ils font monter ta stat Culture.</p>
        </Card>
      </Reveal>

      <Reveal index={5}>
        <Disclosure title="Mettre à jour" summary="Un export plus récent, ou l’effacer">
          <div className="flex flex-col gap-3">
            <Importer again />
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => {
                saveMusic({ v: 1, at: Date.now(), from: '', to: '', totalMinutes: 0, artistsCount: 0, months: {}, hours: Array(24).fill(0), weekdays: Array(7).fill(0), days: [] });
                publishStats('music', { weeks: {} });
                toast({ message: 'Données d’écoute effacées (sur tous tes appareils)' });
              }}
            >
              Effacer mes données d’écoute
            </Button>
          </div>
        </Disclosure>
      </Reveal>
    </div>
  );
}

export function MusicPage() {
  const s = useMusic();
  return (
    <Screen stack title="MyMusique" kicker="Ce que tu écoutes, en chiffres" mood="today" back="/">
      {s && s.totalMinutes > 0 ? <Dashboard s={s} /> : <Importer again={false} />}
    </Screen>
  );
}
