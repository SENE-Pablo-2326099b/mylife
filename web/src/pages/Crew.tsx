import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { addWeeks, evaluatePacte, localToday, myPacteValues, PACTE_KINDS, SHAREABLE_STATS, STATS, weekStart, type CrewEntry, type PacteKind, type StatId, type StatsByApp } from '../vendor/lumen';
import { parseSpaceInvite, type Space } from '../vendor/mylife-sync';
import { CREW_URL, client, loadBoard, loadCrews, monthXp, publishPacteValues, publishScore, useCrews, type CrewBoard } from '../crew';
import { Icon } from '../ui/icons';
import { Badge, Button, Card, Disclosure, EmptyState, Reveal, SectionTitle, SelectField, TextField, ToggleRow } from '../ui/index';
import { formatCents } from '../ui/money';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';
import { crewShare, setCrewShare, useCharacter, useStatsInput } from '../ui/stats';
import { toast } from '../ui/toastStore';

/**
 * Le Crew : entre amis, chacun voit le niveau, le titre, la série et l'XP du mois des autres (et les
 * stats que chacun choisit de montrer). Discret et facultatif : rien n'est partagé tant qu'on n'a pas
 * créé ou rejoint un Crew. Chiffré de bout en bout (espaces partagés : server/space.ts).
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MONTH = (m: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date(`${m}-15T12:00:00`));
const nf = new Intl.NumberFormat('fr-FR');
const STAT_NAME = new Map(STATS.map((s) => [s.id, s.name]));
/** Or, argent, bronze : la couleur du trophée des trois premiers. */
const MEDAL = ['var(--gold)', '#C0C6D4', '#C98A55'];

function defaultPseudo(login: string | undefined): string {
  return login ? login.charAt(0).toUpperCase() + login.slice(1) : '';
}

async function shareLink(link: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Rejoins mon Crew MyLife', text: 'Rejoins mon Crew sur MyLife', url: link });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast({ message: 'Lien copié : envoie-le à tes amis', tone: 'gold' });
  } catch {
    toast({ message: 'Copie impossible : sélectionne le lien affiché' });
  }
}

function Privacy() {
  return (
    <Card>
      <p className="t-body-strong flex items-center gap-2">
        <Icon name="lock" size={16} className="text-accent" /> Ce que tes amis voient
      </p>
      <p className="t-small mt-1 text-secondary">Ton niveau, ton titre, ta série et tes XP du mois. Le niveau de tes stats seulement si tu le choisis. Jamais tes montants, tes séances ni tes données : elles restent chiffrées, à toi.</p>
    </Card>
  );
}

/** /crew : mes Crews, en créer un, en rejoindre un avec un lien. */
export function CrewListPage() {
  const session = useSession();
  const crews = useCrews();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [pseudo, setPseudo] = useState(defaultPseudo(session?.login));
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadCrews();
  }, []);

  const create = async () => {
    const c = client();
    if (!c || !crews.uid) return;
    setBusy(true);
    try {
      const space = await c.create('crew', name.trim(), pseudo.trim() || defaultPseudo(session?.login), crews.uid);
      await loadCrews();
      navigate(`/crew/${space.id}?inviter=1`);
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const parsed = parseSpaceInvite(link);
    if (!parsed) return toast({ message: 'Ce n’est pas un lien d’invitation de Crew.' });
    navigate(`/rejoindre${link.slice(link.indexOf('#'))}`);
  };

  return (
    <Screen stack title="Ton Crew" kicker="Entre amis, en toute discrétion" mood="today" back="/personnage">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Privacy />
        </Reveal>

        {crews.status === 'loading' && crews.crews.length === 0 && <p className="t-small px-1 text-muted">Chargement…</p>}
        {crews.error && crews.crews.length === 0 && <p className="t-small px-1 text-danger">{crews.error}</p>}

        {crews.crews.length > 0 && (
          <Reveal index={1}>
            <SectionTitle>Tes Crews</SectionTitle>
            <div className="flex flex-col gap-2">
              {crews.crews.map((c) => (
                <Card key={c.id} to={`/crew/${c.id}`} label={`Crew ${c.name}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-white" style={{ background: 'linear-gradient(150deg, var(--accent-g0), var(--gold))' }} aria-hidden>
                      <Icon name="people-fill" size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="t-body-strong block truncate">{c.name}</span>
                      <span className="t-small block text-secondary">
                        {c.members} membre{c.members > 1 ? 's' : ''}
                        {c.role === 'admin' ? ' · tu l’administres' : ''}
                      </span>
                    </span>
                    <Icon name="chevron-forward" className="text-muted" />
                  </div>
                </Card>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal index={2}>
          <SectionTitle>Créer un Crew</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3">
              <TextField label="Nom du Crew" value={name} onChange={setName} placeholder="La bande, Team salle…" />
              <TextField label="Ton pseudo dans ce Crew" value={pseudo} onChange={setPseudo} placeholder="Comment tes amis te voient" />
              <Button icon="people" disabled={busy || !name.trim() || !crews.uid} onClick={() => void create()}>
                {busy ? 'Création…' : 'Créer le Crew'}
              </Button>
            </div>
          </Card>
        </Reveal>

        <Reveal index={3}>
          <SectionTitle>Rejoindre un Crew</SectionTitle>
          <Card>
            <div className="flex flex-col gap-3">
              <TextField label="Lien d’invitation" value={link} onChange={setLink} placeholder="Colle le lien reçu" />
              <Button variant="secondary" icon="link" disabled={!link.trim()} onClick={join}>
                Rejoindre
              </Button>
            </div>
          </Card>
        </Reveal>
      </div>
    </Screen>
  );
}

/** /rejoindre#espace=… (Crew ou Sortie) : « Rejoindre la bande ? » puis le pseudo. */
export function CrewJoinPage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const invite = useMemo(() => parseSpaceInvite(location.hash), [location.hash]);
  const [info, setInfo] = useState<{ sid: string; kind: string; name: string; member: boolean } | null>(null);
  const target = (sid: string, kind: string) => (kind === 'sortie' ? `/sorties/${sid}` : kind === 'liste' ? '/chef' : `/crew/${sid}`);
  const what = info?.kind === 'sortie' ? 'une Sortie' : info?.kind === 'liste' ? 'un foyer' : 'un Crew';
  const [error, setError] = useState<string | null>(invite ? null : 'Ce lien d’invitation est incomplet. Demande-le à nouveau.');
  const [pseudo, setPseudo] = useState(defaultPseudo(session?.login));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = client();
    if (!invite || !c) return;
    c.peek(invite).then(
      (r) => (r.member ? navigate(target(r.sid, r.kind), { replace: true }) : setInfo(r)),
      (e: unknown) => setError(errorText(e)),
    );
  }, [invite, navigate]);

  const join = async () => {
    const c = client();
    if (!c || !invite || !info) return;
    setBusy(true);
    try {
      const { uid } = await c.list();
      await c.join(invite, info.sid, pseudo.trim() || defaultPseudo(session?.login), uid);
      await loadCrews();
      toast({ message: `Bienvenue dans « ${info.name} »`, tone: 'gold' });
      navigate(target(info.sid, info.kind), { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen stack title={`Rejoindre ${what}`} mood="today" back="/">
      <div className="flex flex-col gap-3">
        {error && (
          <Card>
            <p className="t-body text-danger">{error}</p>
          </Card>
        )}
        {!error && !info && <p className="t-small px-1 text-muted">Lecture du lien…</p>}
        {info && (
          <>
            <Card level="raised" glow>
              <p className="t-label text-gold">{info.kind === 'sortie' ? 'Invitation à une sortie' : info.kind === 'liste' ? 'Invitation à rejoindre un foyer' : 'Invitation à un Crew'}</p>
              <p className="t-title">Rejoindre « {info.name} » ?</p>
              <div className="mt-3 flex flex-col gap-3">
                <TextField label={info.kind === 'sortie' ? 'Ton pseudo pour cette sortie' : info.kind === 'liste' ? 'Ton pseudo dans ce foyer' : 'Ton pseudo dans ce Crew'} value={pseudo} onChange={setPseudo} />
                <Button icon="people" disabled={busy} onClick={() => void join()}>
                  {busy ? 'Un instant…' : 'Rejoindre'}
                </Button>
              </div>
            </Card>
            {info.kind === 'sortie' ? (
              <Card>
                <p className="t-small text-secondary">Réponses, planning, budget et liste sont chiffrés : seuls les membres de la sortie les voient, pas même le serveur.</p>
              </Card>
            ) : info.kind === 'liste' ? (
              <Card>
                <p className="t-small text-secondary">Liste de courses, dépenses communes, corvées et factures sont chiffrées : seuls les membres du foyer les voient, pas même le serveur.</p>
              </Card>
            ) : (
              <Privacy />
            )}
          </>
        )}
      </div>
    </Screen>
  );
}

function EntryRow({ e }: { e: CrewEntry }) {
  const s = e.score;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="num flex w-8 shrink-0 justify-center font-display text-[20px] font-bold" aria-label={`${e.rank}ᵉ`}>
        {e.monthXp > 0 && e.rank <= 3 ? <span style={{ color: MEDAL[e.rank - 1] }}>
            <Icon name="trophy" size={22} />
          </span> : e.rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="t-body-strong truncate">
          {e.pseudo}
          {e.me ? <span className="t-small text-muted"> · toi</span> : null}
        </p>
        {s ? (
          <p className="t-small text-secondary">
            Niv. {s.level} · {s.title}
            {s.streak > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {' · '}
                <Icon name="flame" size={12} className="text-gold" /> {s.streak}
              </span>
            )}
          </p>
        ) : (
          <p className="t-small text-muted">Pas encore de score</p>
        )}
        {s && Object.keys(s.stats).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.entries(s.stats) as [StatId, number][]).map(([id, lvl]) => (
              <Badge key={id}>
                {STAT_NAME.get(id)} {lvl}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <span className="num t-body-strong shrink-0">{nf.format(e.monthXp)} XP</span>
    </div>
  );
}

const dayLabel = (d: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`));

/** Les pactes du Crew : en créer, en rejoindre, suivre les semaines et la cagnotte. */
function Pactes({ space, uid, board, stats, rest, onChange }: { space: Space; uid: string; board: CrewBoard; stats: StatsByApp; rest: readonly string[]; onChange: () => void }) {
  const today = localToday();
  const [kind, setKind] = useState<PacteKind>('sessions');
  const [target, setTarget] = useState('3');
  const [stake, setStake] = useState('5');
  const [weeks, setWeeks] = useState('4');
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const pseudo = new Map(board.members.map((m) => [m.uid, m.pseudo]));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      toast({ message: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const c = client();
      if (!c) return;
      const t = Math.round(Number(target));
      const max = PACTE_KINDS[kind].max;
      if (!(t >= 1 && t <= max)) throw new Error(`Objectif entre 1 et ${max}.`);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
      const start = startNow ? weekStart(today) : addWeeks(weekStart(today), 1);
      const pacte = { kind, target: t, stakeCents: Math.max(0, Math.round(Number(stake.replace(',', '.')) * 100) || 0), start, weeks: Math.min(26, Math.max(1, Math.round(Number(weeks)) || 4)), title: '' };
      // Le créateur participe d'office : ses valeurs sont publiées tout de suite.
      await c.sync(space, Number.MAX_SAFE_INTEGER, [
        { tbl: 'pacte', rid: id, row: pacte },
        { tbl: 'pacte_week', rid: `${id}:${uid}`, row: { weeks: {} } },
      ]);
      const fresh = await loadBoard(space, uid, today.slice(0, 7));
      await publishPacteValues(space, uid, fresh, stats, rest);
      toast({ message: 'Pacte lancé : il se valide tout seul, semaine après semaine', tone: 'gold' });
    });

  const join = (id: string) =>
    run(async () => {
      const c = client();
      if (!c) return;
      const p = board.pactes.find((x) => x.pacte.id === id);
      if (!p) return;
      await c.sync(space, Number.MAX_SAFE_INTEGER, [{ tbl: 'pacte_week', rid: `${id}:${uid}`, row: { weeks: myPacteValues(p.pacte, stats, today, rest) } }]);
      toast({ message: 'Tu es dans le pacte' });
    });

  const leave = (id: string) =>
    run(async () => {
      await client()?.sync(space, Number.MAX_SAFE_INTEGER, [{ tbl: 'pacte_week', rid: `${id}:${uid}`, row: null }]);
    });

  return (
    <div className="flex flex-col gap-3">
      {board.pactes.map(({ pacte, values }) => {
        const participants = [...values.keys()].filter((u) => pseudo.has(u));
        const r = evaluatePacte(pacte, participants, values, today);
        const inIt = values.has(uid);
        const k = PACTE_KINDS[pacte.kind];
        return (
          <Card key={pacte.id} level="raised">
            <div className="flex flex-wrap items-center gap-2">
              <p className="t-headline min-w-0 flex-1">{pacte.title}</p>
              <Badge tone={r.status === 'en_cours' ? 'success' : 'neutral'}>{r.status === 'avant' ? `Dès le ${dayLabel(pacte.start)}` : r.status === 'en_cours' ? 'En cours' : 'Terminé'}</Badge>
            </div>
            <p className="t-small mt-1 text-secondary">
              {k.label} ({k.app}) · {pacte.weeks} semaine{pacte.weeks > 1 ? 's' : ''} · {formatCents(pacte.stakeCents)} par semaine ratée
            </p>
            {participants.length > 0 && r.weeks.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="t-small w-full border-separate" style={{ borderSpacing: '0 6px' }}>
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="font-normal">Qui</th>
                      {r.weeks.map((w) => (
                        <th key={w.week} className="text-center font-normal">
                          {dayLabel(w.week)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {participants.map((u) => (
                      <tr key={u}>
                        <td className="t-body-strong pr-2">{pseudo.get(u)}{u === uid ? ' (toi)' : ''}</td>
                        {r.weeks.map((w) => {
                          const x = w.results[u]!;
                          return (
                            <td key={w.week} className="num text-center" aria-label={`${pseudo.get(u)}, semaine du ${dayLabel(w.week)} : ${x.value} sur ${pacte.target}`}>
                              {w.finished ? (x.ok ? '✓' : '✗') : `${x.value}/${pacte.target}`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="t-body mt-2">
              Cagnotte : <strong>{formatCents(r.pot)}</strong>
              {r.status === 'termine' && r.perfect.length > 0 ? ` · sans faute : ${r.perfect.map((u) => pseudo.get(u)).join(', ')}` : ''}
            </p>
            {r.status === 'termine' && r.pot > 0 && <p className="t-caption text-muted">À dépenser ensemble : la prochaine Sortie est toute trouvée.</p>}
            <div className="mt-3">
              {inIt ? (
                r.status !== 'termine' && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void leave(pacte.id)}>
                    Quitter le pacte
                  </Button>
                )
              ) : (
                r.status !== 'termine' && (
                  <Button size="sm" icon="flame" disabled={busy} onClick={() => void join(pacte.id)}>
                    Je m’engage
                  </Button>
                )
              )}
            </div>
          </Card>
        );
      })}
      <Disclosure title="Lancer un pacte" summary="Un engagement à plusieurs, validé tout seul">
        <div className="flex flex-col gap-3">
          <SelectField
            label="Sur quoi"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setTarget(v === 'budget' ? '5' : v === 'quests' ? '2' : '3');
            }}
            options={(Object.keys(PACTE_KINDS) as PacteKind[]).map((k) => ({ value: k, label: `${PACTE_KINDS[k].label} (${PACTE_KINDS[k].app})` }))}
          />
          <div className="grid grid-cols-3 gap-2">
            <TextField label="Objectif" value={target} onChange={setTarget} inputMode="numeric" />
            <TextField label="Mise (€)" value={stake} onChange={setStake} inputMode="decimal" />
            <TextField label="Semaines" value={weeks} onChange={setWeeks} inputMode="numeric" />
          </div>
          <ToggleRow label="Commencer cette semaine" hint="Sinon lundi prochain" checked={startNow} onChange={setStartNow} />
          <Button icon="flame" disabled={busy} onClick={() => void create()}>
            Lancer le pacte
          </Button>
          <p className="t-caption text-muted">Chaque semaine finie se valide toute seule avec ce que calculent les apps. Une semaine ratée met la mise dans la cagnotte : un compteur, pas de vrai virement.</p>
        </div>
      </Disclosure>
    </div>
  );
}

/** /crew/:id : classement du mois, inviter, ce que je partage, pseudo, quitter. */
export function CrewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const crews = useCrews();
  const character = useCharacter();
  const { stats, rest } = useStatsInput();
  const space: Space | undefined = crews.crews.find((c) => c.id === id);
  const [board, setBoard] = useState<CrewBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [share, setShare] = useState<StatId[]>(() => (id ? crewShare(id) : []));
  const [pseudo, setPseudo] = useState('');
  const [leaving, setLeaving] = useState(false);
  const month = localToday().slice(0, 7);

  useEffect(() => {
    if (crews.status === 'idle') void loadCrews();
  }, [crews.status]);

  const refresh = async (sp: Space, uid: string) => {
    try {
      await publishScore(sp, uid, character, monthXp(stats, rest));
      const b = await loadBoard(sp, uid, month);
      setBoard(b);
      setPseudo((p) => p || b.members.find((m) => m.uid === uid)?.pseudo || '');
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    if (space && crews.uid) void refresh(space, crews.uid);
  }, [space?.id, crews.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async () => {
    const c = client();
    if (!c || !space) return;
    try {
      const r = await c.invite(space, CREW_URL());
      setLink(r.link);
      await shareLink(r.link);
    } catch (e) {
      toast({ message: errorText(e) });
    }
  };

  useEffect(() => {
    if (space && new URLSearchParams(location.search).get('inviter') === '1' && !link) void invite();
  }, [space?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (stat: StatId, on: boolean) => {
    if (!space || !crews.uid) return;
    const next = on ? [...new Set([...share, stat])] : share.filter((s) => s !== stat);
    setShare(next);
    setCrewShare(space.id, next);
    await publishScore(space, crews.uid, character, monthXp(stats, rest), true).catch(() => undefined);
    setBoard(await loadBoard(space, crews.uid, month).catch(() => board));
  };

  const savePseudo = async () => {
    const c = client();
    if (!c || !space || !crews.uid || !pseudo.trim()) return;
    await c.setPseudo(space, crews.uid, pseudo.trim()).then(
      () => toast({ message: 'Pseudo enregistré' }),
      (e: unknown) => toast({ message: errorText(e) }),
    );
    void refresh(space, crews.uid);
  };

  const leave = async () => {
    const c = client();
    if (!c || !space) return;
    if (!leaving) return setLeaving(true);
    await c.leave(space).then(
      async () => {
        await loadCrews();
        toast({ message: `Tu as quitté « ${space.name} » : ton score y est effacé` });
        navigate('/crew', { replace: true });
      },
      (e: unknown) => toast({ message: errorText(e) }),
    );
  };

  if (!space) {
    return (
      <Screen stack title="Crew" mood="today" back="/crew">
        {crews.status === 'ready' ? <EmptyState icon="people" title="Crew introuvable" body="Tu n’en fais peut-être plus partie." /> : <p className="t-small px-1 text-muted">Chargement…</p>}
      </Screen>
    );
  }

  const alone = board !== null && board.members.length <= 1;
  return (
    <Screen stack title={space.name} kicker={`Classement de ${MONTH(month)}`} mood="today" back="/crew">
      <div className="flex flex-col gap-3">
        <Reveal index={0}>
          <Card level="raised" glow>
            {board === null && !error && <p className="t-small text-muted">Chargement du classement…</p>}
            {error && <p className="t-small text-danger">{error}</p>}
            {board && (
              <div className="divide-y divide-line">
                {board.entries.map((e) => (
                  <EntryRow key={e.uid} e={e} />
                ))}
              </div>
            )}
          </Card>
          <p className="t-caption mt-2 px-1 text-muted">Classé sur les XP gagnés ce mois-ci (le niveau départage). Remis à zéro chaque mois.</p>
        </Reveal>

        {board && crews.uid && (
          <Reveal index={1}>
            <SectionTitle>Pactes</SectionTitle>
            <Pactes space={space} uid={crews.uid} board={board} stats={stats} rest={rest} onChange={() => void refresh(space, crews.uid!)} />
          </Reveal>
        )}

        <Reveal index={1}>
          <Card>
            <p className="t-body-strong">{alone ? 'Personne d’autre pour l’instant' : 'Inviter des amis'}</p>
            <p className="t-small mt-1 text-secondary">Un lien valable 7 jours. La clé du Crew voyage dans le lien : le serveur ne peut rien lire.</p>
            <Button className="mt-3 w-full" icon="share" onClick={() => void invite()}>
              Inviter
            </Button>
            {link && <p className="t-caption mt-2 select-all break-all text-muted">{link}</p>}
          </Card>
        </Reveal>

        <Reveal index={2}>
          <SectionTitle>Ce que tu montres en plus</SectionTitle>
          <Card>
            {SHAREABLE_STATS.map((stat) => (
              <ToggleRow key={stat} label={`Niveau ${STAT_NAME.get(stat)}`} checked={share.includes(stat)} onChange={(on) => void toggle(stat, on)} />
            ))}
            <p className="t-caption mt-1 text-muted">Toujours visibles : niveau, titre, série et XP du mois.</p>
          </Card>
        </Reveal>

        <Reveal index={3}>
          <Disclosure title="Pseudo et départ" summary="Gérer ta place dans ce Crew">
            <div className="flex flex-col gap-3">
              <TextField label="Ton pseudo" value={pseudo} onChange={setPseudo} />
              <Button variant="secondary" disabled={!pseudo.trim()} onClick={() => void savePseudo()}>
                Enregistrer le pseudo
              </Button>
              <Button variant="ghost" icon="logout" onClick={() => void leave()}>
                {leaving ? 'Confirmer : quitter et effacer mon score' : 'Quitter le Crew'}
              </Button>
            </div>
          </Disclosure>
        </Reveal>
      </div>
    </Screen>
  );
}
