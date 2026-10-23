import { useState } from 'react';
import { MYLIFE_APPS, XP, DISCIPLINE_TARGET, type Character, type Quest, type StatId, type StatState } from '../vendor/lumen';
import { ColumnChart, Ring } from '../ui/charts';
import { Icon, type IconName } from '../ui/icons';
import { Badge, Button, Card, Disclosure, ProgressBar, Reveal, SectionTitle } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { canRest, readCharacterPrefs, setRestWeek, useCharacter } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Le Personnage : un RPG de la vraie vie. Les stats montent toutes seules avec ce que tu fais dans
 * MyPerf (Force), MyFinances (Discipline) et myRaveLoc (Social) ; la Constance récompense les semaines
 * réussies d'affilée. Calcul : packages/lumen/src/character.ts.
 */

const ICON: Record<StatId, IconName> = { force: 'barbell', discipline: 'diamond-fill', social: 'people-fill', constance: 'flame', culture: 'sparkles' };
const APP_OF: Partial<Record<StatId, string>> = { force: 'perf', discipline: 'finances', social: 'raveloc' };

const nf = new Intl.NumberFormat('fr-FR');
const fmt = (n: number) => nf.format(Math.round(n));

/** Couleur d'une stat : celle de l'app qui la nourrit (dégradé de sa tuile). */
function statColor(id: StatId): string {
  const app = MYLIFE_APPS.find((a) => a.id === APP_OF[id]);
  if (app) return app.colors[1];
  return id === 'constance' ? 'var(--gold)' : 'var(--text-muted)';
}

function StatIcon({ id, size = 18 }: { id: StatId; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[10px]" style={{ width: size + 14, height: size + 14, color: statColor(id), background: 'var(--surface-alt)' }} aria-hidden>
      <Icon name={ICON[id]} size={size} />
    </span>
  );
}

function weeksLabel(n: number) {
  return `${n} semaine${n > 1 ? 's' : ''}`;
}

/** La carte de l'accueil : niveau, titre, avancée, les stats en un coup d'œil, les quêtes de la semaine. */
export function CharacterCard() {
  const c = useCharacter();
  if (c.empty) {
    return (
      <Card to="/personnage" level="raised" label="Ton personnage MyLife">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] text-accent" style={{ background: 'var(--surface-alt)' }} aria-hidden>
            <Icon name="sparkles" size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="t-body-strong block">Ton personnage t’attend</span>
            <span className="t-small block text-secondary">Il monte tout seul avec tes séances, ton budget et tes sorties.</span>
          </span>
          <Icon name="chevron-forward" className="text-muted" />
        </div>
      </Card>
    );
  }
  const quests = c.quests.filter((q) => q.id !== 'full');
  const done = quests.filter((q) => q.done).length;
  return (
    <Tilt>
      <Card to="/personnage" level="raised" glow label={`Ton personnage : niveau ${c.level}, ${c.title}`}>
        <div className="flex items-center gap-4">
          <Ring value={c.progress} size={78} stroke={8} label={`Niveau ${c.level}, ${Math.round(c.progress * 100)} % vers le suivant`}>
            <span className="flex h-full flex-col items-center justify-center leading-none">
              <span className="t-caption text-muted">Niv.</span>
              <span className="num font-display text-[26px] font-bold">{c.level}</span>
            </span>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="t-label text-gold">Ton personnage</p>
            <p className="t-title truncate">{c.title}</p>
            <p className="t-small text-secondary">
              {fmt(c.nextXp - c.xp)} XP avant le niveau {c.level + 1}
              {c.weekXp > 0 ? ` · +${fmt(c.weekXp)} cette semaine` : ''}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {c.stats
            .filter((s) => !s.locked)
            .map((s) => (
              <div key={s.id} className="flex min-w-0 flex-col items-center gap-1 text-center">
                <StatIcon id={s.id} size={16} />
                <span className="num t-body-strong leading-none">{s.level}</span>
                <span className="t-caption w-full truncate text-secondary">{s.name}</span>
              </div>
            ))}
        </div>
        {quests.length > 0 && (
          <p className="t-small mt-3 flex flex-wrap items-center gap-x-2 text-secondary">
            <span>
              Quêtes : <strong className="text-ink">{done}/{quests.length}</strong>
            </span>
            {c.streak > 0 && (
              <span className="inline-flex items-center gap-1">
                · <Icon name="flame" size={13} className="text-gold" /> {weeksLabel(c.streak)} d’affilée
              </span>
            )}
          </p>
        )}
      </Card>
    </Tilt>
  );
}

function QuestRow({ q }: { q: Quest }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <StatIcon id={q.stat} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`t-body-strong ${q.done ? 'text-success' : ''}`}>{q.title}</span>
          {q.bonus && <Badge>Bonus</Badge>}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProgressBar value={q.progress} max={q.target} tone={q.done ? 'success' : 'accent'} height={6} label={`${q.title} : ${q.progress} sur ${q.target}`} />
          </div>
          <span className="num t-caption shrink-0 text-secondary">
            {q.progress}/{q.target}
          </span>
        </div>
      </div>
      <span className={`num t-small shrink-0 font-semibold ${q.done ? 'text-success' : 'text-muted'}`}>
        {q.done ? <Icon name="check-circle" size={18} /> : `+${q.xp}`}
      </span>
    </div>
  );
}

function StatRow({ s }: { s: StatState }) {
  return (
    <div className="flex items-start gap-3 py-2.5" style={s.locked ? { opacity: 0.55 } : undefined}>
      <StatIcon id={s.id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-body-strong">{s.name}</span>
          <span className="num t-small shrink-0 text-secondary">{s.locked ? 'Bientôt' : `Niv. ${s.level}`}</span>
        </div>
        {!s.locked && (
          <div className="mt-1.5">
            <ProgressBar value={s.progress} max={1} height={6} label={`${s.name} : ${Math.round(s.progress * 100)} % vers le niveau ${s.level + 1}`} />
          </div>
        )}
        <p className="t-caption mt-1 text-muted">
          {s.source}
          {!s.locked && s.week > 0 ? ` · +${fmt(s.week)} cette semaine` : ''}
        </p>
      </div>
    </div>
  );
}

function RestWeek({ c }: { c: Character }) {
  const [, refresh] = useState(0);
  const resting = readCharacterPrefs().rest.includes(c.week);
  const allowed = resting || canRest();
  const toggle = () => {
    setRestWeek(!resting);
    refresh((n) => n + 1);
    toast({ message: resting ? 'Semaine de repos annulée' : 'Semaine de repos : ta série est gelée jusqu’à lundi' });
  };
  return (
    <Card className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-accent" style={{ background: 'var(--surface-alt)' }} aria-hidden>
        <Icon name="moon" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="t-body-strong">{resting ? 'Semaine de repos' : 'Besoin d’une pause ?'}</p>
        <p className="t-small text-secondary">
          {resting
            ? 'Ta série est gelée : elle ne casse pas cette semaine. Rien n’est gagné en Constance.'
            : allowed
              ? 'Malade, en vacances, en déload : déclare une semaine de repos, ta série ne casse pas. Une toutes les quatre semaines.'
              : 'Une semaine de repos toutes les quatre semaines : la prochaine sera bientôt possible.'}
        </p>
        <Button variant={resting ? 'ghost' : 'secondary'} size="sm" className="mt-2" disabled={!allowed} onClick={toggle}>
          {resting ? 'Annuler le repos' : 'Déclarer une semaine de repos'}
        </Button>
      </div>
    </Card>
  );
}

const shortWeek = (w: string) => `${Number(w.slice(8, 10))}/${w.slice(5, 7)}`;

export function CharacterPage() {
  const c = useCharacter();
  const quests = c.quests;
  return (
    <Screen stack title="Ton personnage" kicker="Le RPG de ta vraie vie" mood="today" back="/">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised" glow className="flex flex-col items-center text-center">
            <Ring value={c.progress} size={150} stroke={12} label={`Niveau ${c.level}, ${Math.round(c.progress * 100)} % vers le suivant`}>
              <span className="flex h-full flex-col items-center justify-center leading-none">
                <span className="t-small text-muted">Niveau</span>
                <span className="num font-display text-[52px] font-bold">{c.level}</span>
              </span>
            </Ring>
            <p className="t-large mt-3">{c.title}</p>
            <p className="t-small text-secondary">
              {fmt(c.xp)} XP · encore {fmt(c.nextXp - c.xp)} XP pour le niveau {c.level + 1}
            </p>
            {c.streak > 0 && (
              <p className="t-small mt-2 inline-flex items-center gap-1.5 text-ink">
                <Icon name="flame" size={16} className="text-gold" /> Série de {weeksLabel(c.streak)} réussies
              </p>
            )}
          </Card>
        </Reveal>

        {c.empty && (
          <Reveal index={1}>
            <Card>
              <p className="t-body-strong">Ton personnage démarre ici</p>
              <p className="t-small mt-1 text-secondary">
                Il monte tout seul : une séance terminée dans MyPerf, une journée sous ton budget dans MyFinances, une sortie avec ta bande dans myRaveLoc. Ouvre une de tes apps pour lui donner ses premiers points.
              </p>
            </Card>
          </Reveal>
        )}

        {quests.length > 0 && (
          <Reveal index={1}>
            <SectionTitle>Quêtes de la semaine</SectionTitle>
            <Card className="divide-y divide-line">
              {quests.map((q) => (
                <QuestRow key={q.id} q={q} />
              ))}
            </Card>
            <p className="t-caption mt-2 px-1 text-muted">Une semaine est réussie quand tes quêtes principales sont faites (deux suffisent si tu en as trois). Elles se renouvellent chaque lundi.</p>
          </Reveal>
        )}

        <Reveal index={2}>
          <SectionTitle>Tes stats</SectionTitle>
          <Card className="divide-y divide-line">
            {c.stats.map((s) => (
              <StatRow key={s.id} s={s} />
            ))}
          </Card>
        </Reveal>

        {!c.empty && (
          <Reveal index={3}>
            <SectionTitle>Tes 12 dernières semaines</SectionTitle>
            <Card>
              <ColumnChart
                data={c.history.map((h) => ({ label: shortWeek(h.week), value: h.xp, lit: h.good || h.week === c.week, tone: h.rest ? 'gold' : 'accent' }))}
                format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : String(Math.round(v)))}
                label="Points gagnés par semaine, les 12 dernières"
              />
              <p className="t-caption mt-2 text-muted">En clair : semaines réussies. En doré : semaines de repos.</p>
            </Card>
          </Reveal>
        )}

        {!c.empty && (
          <Reveal index={4}>
            <div className="grid grid-cols-2 gap-2">
              <Card to="/bilan" label="Ta semaine en détail">
                <Icon name="calendar" className="text-gold" />
                <p className="t-body-strong mt-1">Ta semaine</p>
                <p className="t-caption text-muted">et les précédentes</p>
              </Card>
              <Card to="/wrapped" label="Ton Wrapped du mois">
                <Icon name="sparkles" className="text-gold" />
                <p className="t-body-strong mt-1">Ton Wrapped</p>
                <p className="t-caption text-muted">le mois en images</p>
              </Card>
            </div>
            <Card to="/crew" className="mt-2" label="Ton Crew : ton classement entre amis">
              <div className="flex items-center gap-3">
                <Icon name="people-fill" className="text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="t-body-strong block">Ton Crew</span>
                  <span className="t-caption block text-muted">Ton niveau face à tes amis, discret et facultatif</span>
                </span>
                <Icon name="chevron-forward" className="text-muted" />
              </div>
            </Card>
          </Reveal>
        )}

        {!c.empty && (
          <Reveal index={4}>
            <RestWeek c={c} />
          </Reveal>
        )}

        <Reveal index={5}>
          <Disclosure title="Comment ça monte" summary="Le barème, sans surprise">
            <ul className="t-small flex flex-col gap-1.5 text-secondary">
              <li>
                <strong className="text-ink">Force</strong> : {XP.session} par séance terminée, {XP.record} par record battu, {XP.quest.force} pour la quête de la semaine (ton objectif de séances dans MyPerf).
              </li>
              <li>
                <strong className="text-ink">Discipline</strong> : {XP.underDay} par jour sous ton budget du jour, {XP.savedCycle} par cycle où l’épargne prévue est tenue, {XP.quest.discipline} pour {DISCIPLINE_TARGET} jours sous le budget dans la semaine.
              </li>
              <li>
                <strong className="text-ink">Social</strong> : {XP.group} par groupe actif, {XP.friend} par ami retrouvé, {XP.quest.social} pour la quête (un bonus : jamais obligatoire).
              </li>
              <li>
                <strong className="text-ink">Constance</strong> : {XP.goodWeek} par semaine réussie, plus {XP.streakStep} par semaine de série (jusqu’à {XP.streakCap}), {XP.fullWeek} pour une semaine complète.
              </li>
              <li>Chaque semaine est plafonnée : une semaine hors norme ne fait pas tout. Ton niveau global se calcule sur le total.</li>
            </ul>
          </Disclosure>
        </Reveal>

        <p className="t-caption px-1 pt-1 text-center text-muted">
          Calculé sur ton appareil à partir de nombres par semaine : aucun montant, aucun détail. Chiffré dans ton compte, le même sur tous tes appareils.
        </p>
      </div>
    </Screen>
  );
}
