import { useEffect, useState } from 'react';
import { Navigate as Redirect, useLocation, useNavigate } from 'react-router-dom';
import { useObservable } from '../lib/observable';
import { inviteParts, parseInvite } from '../lib/groupCrypto';
import { app, createGroup, forgetRegulars, GROUP_DURATIONS, joinGroup, lastPseudo, previewInvite, regulars, setActive, setScreen } from '../state/app';
import { remaining } from '../lib/format';
import { Avatar, ErrorLine, NetBanner, Pending, useAction, useNow } from '../components/kit';
import { RavelocHeader } from '../components/Header';
import { RecoveryReminder } from '../ui/account';
import { Badge, Button, Card, Chip, EmptyState, Reveal, SectionTitle, TextField } from '../ui/index';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { useTabActive } from '../ui/tabActive';

/** Mes groupes : passer de l'un à l'autre, en créer, en rejoindre. */
export function Groups() {
  const s = useObservable(app);
  const now = useNow(60_000);
  const navigate = useNavigate();
  const active = useTabActive();
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [known, setKnown] = useState(regulars);

  useEffect(() => {
    if (active) setScreen('list');
  }, [active]);

  return (
    <Screen title="Groupes" kicker="Tes sorties" mood="activity" right={<RavelocHeader />}>
      <div className="flex flex-col gap-3">
        <NetBanner />
        <Reveal index={0}>
          {s.groups.status !== 'ready' && !s.groups.list.length ? (
            s.groups.status === 'error' ? <ErrorLine error={s.groups.error} /> : <Pending label="Chargement des groupes" />
          ) : s.groups.list.length === 0 ? (
            <Card>
              <EmptyState icon="people" title="Aucun groupe" body="Crée le premier, ou ouvre le lien qu’un ami t’a envoyé." />
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {s.groups.list.map((g) => {
                const current = g.id === s.activeId;
                return (
                  <Card
                    key={g.id}
                    level={current ? 'raised' : 'pane'}
                    tone={current ? 'accent' : undefined}
                    label={`${g.name ?? 'Groupe'}${current ? ' (groupe actif)' : ''}`}
                    onClick={() => {
                      setActive(g.id);
                      navigate('/');
                    }}
                    className="flex items-center gap-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="t-body-strong block truncate">{g.name ?? 'Groupe (nom illisible)'}</span>
                      <span className="t-small block text-secondary">
                        {g.members} membre{g.members > 1 ? 's' : ''} · fin {remaining(g.expiresAt, now)}
                        {g.role === 'admin' ? ' · admin' : ''}
                      </span>
                    </span>
                    {g.sharing !== 'off' && <Badge tone={g.sharing === 'on' ? 'success' : 'warning'}>{g.sharing === 'on' ? 'Tu partages' : 'En pause'}</Badge>}
                    <Icon name="chevron-forward" size={18} className="text-muted" />
                  </Card>
                );
              })}
            </div>
          )}
        </Reveal>

        <Reveal index={1}>
          <Button size="lg" icon="add" className="w-full" to="/groupes/nouveau">
            Nouveau groupe
          </Button>
        </Reveal>

        <Reveal index={2}>
          <Card>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const inv = inviteParts(paste);
                if (!inv || !parseInvite(paste)) return setPasteError('Ce n’est pas un lien d’invitation MyRave complet.');
                setPasteError(null);
                setPaste('');
                navigate('/rejoindre', { state: inv });
              }}
            >
              <TextField label="Rejoindre avec un lien" value={paste} onChange={setPaste} placeholder="Colle le lien reçu" plain error={pasteError} />
              {paste && (
                <Button type="submit" variant="secondary">
                  Continuer
                </Button>
              )}
            </form>
          </Card>
        </Reveal>

        {known.length > 0 && (
          <Reveal index={3}>
            <SectionTitle>Tes habitués</SectionTitle>
            <Card className="flex flex-col gap-3">
              <p className="t-caption text-muted">Les personnes croisées dans tes groupes, gardées sur ce téléphone seulement. Cela ne donne accès à aucune position : pour se voir, il faut être dans le même groupe et partager.</p>
              {known.slice(0, 8).map((r) => (
                <div key={r.uid} className="flex items-center gap-3">
                  <Avatar uid={r.uid} name={r.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="t-body-strong block truncate">{r.name}</span>
                    <span className="t-caption block text-muted">
                      {r.groups.length} groupe{r.groups.length > 1 ? 's' : ''} ensemble
                    </span>
                  </span>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  forgetRegulars();
                  setKnown([]);
                }}
              >
                Oublier cette liste
              </Button>
            </Card>
          </Reveal>
        )}
      </div>
    </Screen>
  );
}

const SUGGESTIONS = ['Festival du week-end', 'Rave de ce soir', 'Soirée entre amis', 'Concert de demain'];

export function CreateGroup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [duration, setDuration] = useState<number>(GROUP_DURATIONS[0].ms);
  const [pseudo, setPseudo] = useState(() => lastPseudo() ?? app.get().session?.login ?? '');
  const action = useAction();
  const ready = !!name.trim() && !!pseudo.trim() && !action.busy;
  const submit = () =>
    void action.run(async () => {
      await createGroup({ name, pseudo, durationMs: duration });
      navigate('/', { replace: true });
      navigate('/groupe');
    });
  return (
    <Screen
      stack
      title="Nouveau groupe"
      mood="activity"
      back="/groupes"
      footer={
        <Button size="lg" className="w-full" disabled={!ready} onClick={submit}>
          {action.busy ? 'Création…' : 'Créer et inviter'}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) submit();
        }}
      >
        <Card className="flex flex-col gap-3">
          <TextField label="Nom du groupe" value={name} onChange={(v) => setName(v.slice(0, 40))} placeholder="Ex. Festival du week-end" autoFocus />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((x) => (
              <Chip key={x} small selected={name === x} onClick={() => setName(x)}>
                {x}
              </Chip>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="t-label text-muted">Durée de vie</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Durée de vie du groupe">
            {GROUP_DURATIONS.map((d) => (
              <Chip key={d.label} selected={duration === d.ms} onClick={() => setDuration(d.ms)}>
                {d.label} · {d.hint}
              </Chip>
            ))}
          </div>
          <p className="t-small text-muted">À la fin, le groupe et toutes ses positions sont effacés.</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <TextField label="Ton pseudo" value={pseudo} onChange={(v) => setPseudo(v.slice(0, 24))} hint="Ce que les membres du groupe voient de toi." />
        </Card>
        <ErrorLine error={action.error} />
        <p className="t-small px-1 text-muted">Ta position ne sera partagée que lorsque tu l’activeras.</p>
      </form>
    </Screen>
  );
}

/** Ouverture d'un lien d'invitation : on montre le groupe, puis on rejoint (partage coupé par défaut). */
export function Join() {
  const state = useLocation().state as { token?: string; key?: string } | null;
  if (!state?.token || !state.key) return <Redirect to="/groupes" replace />;
  return <JoinInvite token={state.token} keyText={state.key} />;
}

function JoinInvite({ token, keyText }: { token: string; keyText: string }) {
  const navigate = useNavigate();
  const inv = parseInvite(`rejoindre=${token}.${keyText}`);
  const [preview, setPreview] = useState<{ gid: string; name: string | null; expiresAt: number; member: boolean } | null>(null);
  const [pseudo, setPseudo] = useState(() => lastPseudo() ?? app.get().session?.login ?? '');
  const look = useAction();
  const join = useAction();
  const now = useNow(60_000);
  const home = () => navigate('/', { replace: true });

  useEffect(() => {
    if (inv) void look.run(async () => setPreview(await previewInvite(inv.token, inv.key)));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen stack title="Invitation" mood="activity" back="/">
      <div className="flex flex-col gap-3">
        <NetBanner />
        <RecoveryReminder />
        {!inv ? (
          <Card>
            <EmptyState icon="alert-circle" title="Lien incomplet" body="Ce lien d’invitation est incomplet ou abîmé. Demande-en un nouveau." />
          </Card>
        ) : look.error ? (
          <Card>
            <EmptyState
              icon="alert-circle"
              title="Invitation introuvable"
              body={<ErrorLine error={look.error} />}
              action={
                <Button variant="secondary" icon="sync" onClick={() => void look.run(async () => setPreview(await previewInvite(inv.token, inv.key)))}>
                  Réessayer
                </Button>
              }
            />
          </Card>
        ) : !preview ? (
          <Pending rows={1} label="Vérification de l’invitation" />
        ) : preview.name === null ? (
          <Card>
            <EmptyState icon="alert-circle" title="Clé incorrecte" body="La clé contenue dans ce lien ne correspond pas au groupe. Le lien a peut-être été tronqué : demande-en un nouveau." />
          </Card>
        ) : preview.member ? (
          <Card level="raised">
            <p className="t-body">
              Tu fais déjà partie de « <strong>{preview.name}</strong> ».
            </p>
            <Button
              className="mt-3 w-full"
              onClick={() => {
                setActive(preview.gid);
                home();
              }}
            >
              Ouvrir le groupe
            </Button>
          </Card>
        ) : (
          <Card level="raised" glow>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void join.run(async () => {
                  await joinGroup(inv.token, inv.key, preview.gid, pseudo);
                  home();
                });
              }}
            >
              <p className="t-label text-gold">Rejoindre</p>
              <p className="t-large">{preview.name}</p>
              <p className="t-small text-secondary">Groupe actif jusqu’à sa fin, {remaining(preview.expiresAt, now)}.</p>
              <TextField label="Ton pseudo" value={pseudo} onChange={(v) => setPseudo(v.slice(0, 24))} />
              <p className="t-small text-secondary">En rejoignant, tu vois les membres qui partagent leur position. La tienne reste privée tant que tu n’actives pas le partage.</p>
              <ErrorLine error={join.error} />
              <Button type="submit" size="lg" className="w-full" disabled={join.busy || !pseudo.trim()}>
                {join.busy ? 'Connexion au groupe…' : 'Rejoindre le groupe'}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </Screen>
  );
}
