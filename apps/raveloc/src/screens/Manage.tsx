import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useObservable } from '../lib/observable';
import { api, app, createInvite, deleteGroup, leaveGroup, removeMember, renameMe, setRole, setScreen, type Member } from '../state/app';
import type { InviteInfo } from '../lib/api';
import { remaining, when } from '../lib/format';
import { Avatar, ErrorLine, NetBanner, Pending, useAction, useNow } from '../components/kit';
import { Button, Card, Chip, EmptyState, Reveal, SectionTitle, TextField, toast } from '../ui/index';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';

const INVITE_TTL = [
  { label: '1 h', ms: 3_600_000 },
  { label: '24 h', ms: 24 * 3_600_000 },
  { label: 'Jusqu’à la fin', ms: 7 * 86_400_000 },
] as const;

/** Gestion du groupe : moi, invitations, membres, règles de visibilité, départ. */
export function Manage() {
  const s = useObservable(app);
  const now = useNow(30_000);
  const group = s.groups.list.find((g) => g.id === s.activeId) ?? null;
  const live = s.live?.gid === group?.id ? s.live : null;
  const me = live?.members.find((m) => m.me) ?? null;
  const admin = group?.role === 'admin';

  useEffect(() => setScreen('group'), []);

  if (!group)
    return (
      <Screen stack title="Gérer le groupe" mood="activity" back="/">
        <EmptyState
          icon="people"
          title="Aucun groupe sélectionné"
          action={
            <Button variant="secondary" to="/groupes">
              Mes groupes
            </Button>
          }
        />
      </Screen>
    );

  return (
    <Screen stack title={group.name ?? 'Groupe'} kicker="Gérer le groupe" mood="activity" back="/">
      <div className="flex flex-col gap-3">
        <NetBanner />
        <Reveal index={0}>
          <Tilt>
          <Card>
            <p className="t-small text-secondary">
              Se termine {when(group.expiresAt, now)} ({remaining(group.expiresAt, now)}). Ensuite, le groupe, ses membres et toutes les positions sont effacés du serveur.
            </p>
          </Card>
          </Tilt>
        </Reveal>

        <Reveal index={1}>
          {admin ? (
            <Invites gid={group.id} />
          ) : (
            <Card>
              <p className="t-headline">Inviter</p>
              <p className="t-small mt-1 text-secondary">
                Seuls les admins du groupe créent des liens d’invitation. Demande à {live?.members.filter((m) => m.role === 'admin' && !m.me).map((m) => m.name ?? 'un admin').join(', ') || 'un admin'}.
              </p>
            </Card>
          )}
        </Reveal>

        {me && (
          <Reveal index={2}>
            <Pseudo gid={group.id} current={me.name ?? ''} />
          </Reveal>
        )}

        <Reveal index={3}>
          <SectionTitle>Membres{live ? ` (${live.members.length})` : ''}</SectionTitle>
          <Card className="flex flex-col gap-4">
            {!live || live.status === 'loading' ? <Pending label="Chargement des membres" /> : live.members.map((m) => <MemberRow key={m.uid} gid={group.id} m={m} admin={admin} />)}
          </Card>
        </Reveal>

        <Reveal index={4}>
          <SectionTitle>Qui voit quoi</SectionTitle>
          <Card>
            <ul className="t-small flex list-disc flex-col gap-1.5 pl-5 text-secondary">
              <li>Ta position n’est visible que par les membres de ce groupe, et seulement pendant que tu la partages.</li>
              <li>Être dans le même groupe ne donne aucun accès permanent : à l’arrêt du partage, ta position est effacée.</li>
              <li>Noms, pseudos et positions sont chiffrés sur les téléphones : le serveur ne peut pas les lire.</li>
              <li>Un membre retiré ou parti perd l’accès immédiatement.</li>
            </ul>
          </Card>
        </Reveal>

        <Reveal index={5}>
          <Danger gid={group.id} admin={admin} />
        </Reveal>
      </div>
    </Screen>
  );
}

function Pseudo({ gid, current }: { gid: string; current: string }) {
  const [value, setValue] = useState(current);
  const action = useAction();
  useEffect(() => setValue(current), [current]);
  return (
    <Card>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await renameMe(gid, value);
            toast({ message: 'Pseudo enregistré' });
          });
        }}
      >
        <TextField label="Ton pseudo dans ce groupe" value={value} onChange={(v) => setValue(v.slice(0, 24))} />
        <ErrorLine error={action.error} />
        {value.trim() !== current && (
          <Button type="submit" variant="secondary" disabled={action.busy || !value.trim()}>
            Enregistrer
          </Button>
        )}
      </form>
    </Card>
  );
}

function Invites({ gid }: { gid: string }) {
  const [ttl, setTtl] = useState<number>(INVITE_TTL[1].ms);
  const [single, setSingle] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [list, setList] = useState<InviteInfo[] | null>(null);
  const create = useAction();
  const load = useAction();
  const now = useNow(30_000);

  const refresh = () => void load.run(async () => setList((await api.invites({ gid })).invites));
  useEffect(refresh, [gid]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (l: string) => void navigator.clipboard?.writeText(l).then(() => toast({ message: 'Lien copié' }), () => undefined);
  const shareLink = async (l: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'myRaveLoc', text: 'Rejoins mon groupe sur myRaveLoc pour qu’on se retrouve :', url: l });
        return;
      } catch {
        /* partage annulé : on propose la copie */
      }
    }
    copy(l);
  };

  return (
    <Card level="raised" className="flex flex-col gap-3">
      <p className="t-headline">Inviter des amis</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Validité du lien">
        {INVITE_TTL.map((t) => (
          <Chip key={t.label} selected={ttl === t.ms} onClick={() => setTtl(t.ms)}>
            {t.label}
          </Chip>
        ))}
        <Chip selected={single} onClick={() => setSingle(!single)}>
          Une seule personne
        </Chip>
      </div>
      <ErrorLine error={create.error} />
      <Button
        icon="share"
        disabled={create.busy}
        onClick={() =>
          void create.run(async () => {
            const r = await createInvite(gid, ttl, single ? 1 : null);
            setLink(r.link);
            refresh();
            await shareLink(r.link).catch(() => undefined);
          })
        }
      >
        Créer et partager un lien
      </Button>
      {link && (
        <div className="flex flex-col gap-2">
          <code className="t-caption break-all rounded-md p-3 font-mono" style={{ background: 'var(--surface-alt)' }}>
            {link}
          </code>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" icon="share" onClick={() => void shareLink(link)}>
              Partager
            </Button>
            <Button variant="secondary" size="sm" icon="copy" onClick={() => copy(link)}>
              Copier
            </Button>
          </div>
        </div>
      )}
      <p className="t-caption text-muted">Le lien contient la clé du groupe : envoie-le seulement à tes amis. Tu peux le révoquer à tout moment.</p>
      {load.error ? (
        <ErrorLine error={load.error} />
      ) : list === null ? null : list.length === 0 ? (
        <p className="t-small text-muted">Aucun lien actif.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((i) => (
            <InviteRow key={i.id} gid={gid} invite={i} now={now} onRevoked={refresh} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function InviteRow({ gid, invite, now, onRevoked }: { gid: string; invite: InviteInfo; now: number; onRevoked: () => void }) {
  const action = useAction();
  return (
    <li className="flex items-center gap-3 border-t border-line pt-3">
      <Icon name="link" size={18} className="text-muted" />
      <span className="t-small min-w-0 flex-1">
        Lien créé {when(invite.createdAt, now)} · expire {remaining(invite.expiresAt, now)}
        <span className="block text-muted">
          {invite.uses} utilisation{invite.uses > 1 ? 's' : ''}
          {invite.maxUses ? ` sur ${invite.maxUses}` : ''}
        </span>
        <ErrorLine error={action.error} />
      </span>
      <Button
        variant="danger"
        size="sm"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api.revoke({ gid, inviteId: invite.id });
            onRevoked();
          })
        }
      >
        Révoquer
      </Button>
    </li>
  );
}

function MemberRow({ gid, m, admin }: { gid: string; m: Member; admin: boolean }) {
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const sharing = m.sharing === 'on' ? 'partage sa position' : m.sharing === 'paused' ? 'partage en pause' : 'ne partage pas';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar uid={m.uid} name={m.name} />
        <span className="min-w-0 flex-1">
          <span className="t-body-strong block truncate">
            {m.name ?? 'Membre'}
            {m.me && <span className="font-normal text-muted"> (toi)</span>}
          </span>
          <span className="t-small block text-secondary">
            {m.role === 'admin' ? 'admin · ' : ''}
            {sharing}
          </span>
        </span>
      </div>
      {admin && !m.me && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled={action.busy} onClick={() => void action.run(() => setRole(gid, m.uid, m.role === 'admin' ? 'member' : 'admin'))}>
            {m.role === 'admin' ? 'Retirer admin' : 'Rendre admin'}
          </Button>
          <Button variant="danger" size="sm" disabled={action.busy} onClick={() => (confirm ? void action.run(() => removeMember(gid, m.uid)) : setConfirm(true))}>
            {confirm ? 'Confirmer' : 'Retirer'}
          </Button>
        </div>
      )}
      <ErrorLine error={action.error} />
    </div>
  );
}

function Danger({ gid, admin }: { gid: string; admin: boolean }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const action = useAction();
  const done = () => navigate('/', { replace: true });
  return (
    <Card className="flex flex-col gap-2">
      <p className="t-headline">Partir</p>
      <ErrorLine error={action.error} />
      <Button variant="danger" disabled={action.busy} onClick={() => (confirm === 'leave' ? void action.run(async () => (await leaveGroup(gid), done())) : setConfirm('leave'))}>
        {confirm === 'leave' ? 'Confirmer : quitter et effacer ma position' : 'Quitter le groupe'}
      </Button>
      {admin && (
        <Button variant="danger" disabled={action.busy} onClick={() => (confirm === 'delete' ? void action.run(async () => (await deleteGroup(gid), done())) : setConfirm('delete'))}>
          {confirm === 'delete' ? 'Confirmer : supprimer pour tout le monde' : 'Supprimer le groupe'}
        </Button>
      )}
    </Card>
  );
}
