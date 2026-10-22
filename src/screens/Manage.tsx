import { useEffect, useState } from 'react';
import { useObservable } from '../lib/observable';
import { api, app, createInvite, deleteGroup, leaveGroup, removeMember, renameMe, setRole, setScreen } from '../state/app';
import { back, replace } from '../state/nav';
import type { InviteInfo } from '../lib/api';
import { remaining, when } from '../ui/format';
import { Avatar, ErrorLine, Icon, NetBanner, Pending, useAction, useNow } from '../ui/kit';

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
      <main className="screen">
        <Top />
        <p className="muted">Aucun groupe sélectionné.</p>
      </main>
    );

  return (
    <main className="screen">
      <Top />
      <NetBanner />
      <section className="card stack">
        <span className="label">Groupe</span>
        <h1 className="h2">{group.name ?? 'Nom illisible'}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Se termine {when(group.expiresAt, now)} ({remaining(group.expiresAt, now)}). Ensuite, le groupe, ses membres et toutes les positions sont effacés du serveur.
        </p>
      </section>

      {me && <Pseudo gid={group.id} current={me.name ?? ''} />}

      {admin ? <Invites gid={group.id} /> : (
        <section className="card stack">
          <span className="label">Inviter</span>
          <p className="muted small" style={{ margin: 0 }}>
            Seuls les admins du groupe créent des liens d’invitation. Demande à {live?.members.filter((m) => m.role === 'admin' && !m.me).map((m) => m.name ?? 'un admin').join(', ') || 'un admin'}.
          </p>
        </section>
      )}

      <section className="card stack" aria-labelledby="members-title">
        <h2 id="members-title" className="label">
          Membres{live ? ` (${live.members.length})` : ''}
        </h2>
        {!live || live.status === 'loading' ? <Pending rows={2} label="Chargement des membres" /> : live.members.map((m) => <MemberRow key={m.uid} gid={group.id} m={m} admin={admin} />)}
      </section>

      <section className="card stack small">
        <span className="label">Qui voit quoi</span>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Ta position n’est visible que par les membres de ce groupe, et seulement pendant que tu la partages.</li>
          <li>Être dans le même groupe ne donne aucun accès permanent : à l’arrêt du partage, ta position est effacée.</li>
          <li>Noms, pseudos et positions sont chiffrés sur les téléphones : le serveur ne peut pas les lire.</li>
          <li>Un membre retiré ou parti perd l’accès immédiatement.</li>
        </ul>
      </section>

      <Danger gid={group.id} admin={admin} />
    </main>
  );
}

function Top() {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={back} aria-label="Revenir">
        <Icon name="back" />
      </button>
      <h1 className="h2 grow">Gérer le groupe</h1>
    </header>
  );
}

function Pseudo({ gid, current }: { gid: string; current: string }) {
  const [value, setValue] = useState(current);
  const action = useAction();
  const [done, setDone] = useState(false);
  useEffect(() => setValue(current), [current]);
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(false);
        void action.run(async () => {
          await renameMe(gid, value);
          setDone(true);
        });
      }}
    >
      <label className="field">
        <span className="label">Ton pseudo dans ce groupe</span>
        <input value={value} maxLength={24} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <ErrorLine error={action.error} />
      {value.trim() !== current && (
        <button type="submit" className="btn" disabled={action.busy || !value.trim()}>
          Enregistrer
        </button>
      )}
      {done && value.trim() === current && <span className="ok small">Enregistré.</span>}
    </form>
  );
}

function Invites({ gid }: { gid: string }) {
  const [ttl, setTtl] = useState<number>(INVITE_TTL[1].ms);
  const [single, setSingle] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [list, setList] = useState<InviteInfo[] | null>(null);
  const create = useAction();
  const load = useAction();
  const now = useNow(30_000);

  const refresh = () => void load.run(async () => setList((await api.invites({ gid })).invites));
  useEffect(refresh, [gid]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareLink = async (l: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'myRaveLoc', text: 'Rejoins mon groupe sur myRaveLoc pour qu’on se retrouve :', url: l });
        return;
      } catch {
        /* partage annulé : on propose la copie */
      }
    }
    await navigator.clipboard?.writeText(l);
    setCopied(true);
  };

  return (
    <section className="card stack" aria-labelledby="invite-title">
      <h2 id="invite-title" className="label">
        Inviter des amis
      </h2>
      <div className="chips" role="group" aria-label="Validité du lien">
        {INVITE_TTL.map((t) => (
          <button key={t.label} type="button" className="chip" aria-pressed={ttl === t.ms} onClick={() => setTtl(t.ms)}>
            {t.label}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={single} onClick={() => setSingle(!single)}>
          Une seule personne
        </button>
      </div>
      <ErrorLine error={create.error} />
      <button
        type="button"
        className="btn primary block"
        disabled={create.busy}
        onClick={() =>
          void create.run(async () => {
            const r = await createInvite(gid, ttl, single ? 1 : null);
            setLink(r.link);
            setCopied(false);
            refresh();
            await shareLink(r.link).catch(() => undefined);
          })
        }
      >
        <Icon name="share" /> Créer et partager un lien
      </button>
      {link && (
        <div className="stack">
          <code className="key" style={{ fontSize: 12.5 }}>
            {link}
          </code>
          <div className="row">
            <button type="button" className="btn small" style={{ flex: 1 }} onClick={() => void shareLink(link)}>
              <Icon name="share" size={18} /> Partager
            </button>
            <button type="button" className="btn small" style={{ flex: 1 }} onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => undefined)}>
              <Icon name="copy" size={18} /> {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>
      )}
      <p className="faint tiny" style={{ margin: 0 }}>
        Le lien contient la clé du groupe : envoie-le seulement à tes amis. Tu peux le révoquer à tout moment.
      </p>
      {load.error ? (
        <ErrorLine error={load.error} />
      ) : list === null ? null : list.length === 0 ? (
        <p className="faint small" style={{ margin: 0 }}>
          Aucun lien actif.
        </p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map((i) => (
            <InviteRow key={i.id} gid={gid} invite={i} now={now} onRevoked={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteRow({ gid, invite, now, onRevoked }: { gid: string; invite: InviteInfo; now: number; onRevoked: () => void }) {
  const action = useAction();
  return (
    <li className="row small">
      <Icon name="link" size={18} className="faint" />
      <span className="grow" style={{ flex: 1 }}>
        Lien créé {when(invite.createdAt, now)} · expire {remaining(invite.expiresAt, now)}
        <br />
        <span className="faint">
          {invite.uses} utilisation{invite.uses > 1 ? 's' : ''}
          {invite.maxUses ? ` sur ${invite.maxUses}` : ''}
        </span>
        <ErrorLine error={action.error} />
      </span>
      <button
        type="button"
        className="btn small danger"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await api.revoke({ gid, inviteId: invite.id });
            onRevoked();
          })
        }
      >
        Révoquer
      </button>
    </li>
  );
}

function MemberRow({ gid, m, admin }: { gid: string; m: NonNullable<ReturnType<typeof app.get>['live']>['members'][number]; admin: boolean }) {
  const action = useAction();
  const [confirm, setConfirm] = useState(false);
  const sharing = m.sharing === 'on' ? 'partage sa position' : m.sharing === 'paused' ? 'partage en pause' : 'ne partage pas';
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <Avatar uid={m.uid} name={m.name} />
        <span className="grow" style={{ flex: 1, minWidth: 0 }}>
          <b className="ellipsis">{m.name ?? 'Membre'}</b>
          {m.me && <span className="faint"> (toi)</span>}
          <br />
          <span className="faint small">
            {m.role === 'admin' ? 'admin · ' : ''}
            {sharing}
          </span>
        </span>
      </div>
      {admin && !m.me && (
        <div className="row">
          <button type="button" className="btn small" disabled={action.busy} onClick={() => void action.run(() => setRole(gid, m.uid, m.role === 'admin' ? 'member' : 'admin'))}>
            {m.role === 'admin' ? 'Retirer admin' : 'Rendre admin'}
          </button>
          <button type="button" className="btn small danger" disabled={action.busy} onClick={() => (confirm ? void action.run(() => removeMember(gid, m.uid)) : setConfirm(true))}>
            {confirm ? 'Confirmer le retrait' : 'Retirer du groupe'}
          </button>
        </div>
      )}
      <ErrorLine error={action.error} />
    </div>
  );
}

function Danger({ gid, admin }: { gid: string; admin: boolean }) {
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const action = useAction();
  const done = () => replace({ name: 'home' });
  return (
    <section className="card stack">
      <span className="label">Partir</span>
      <ErrorLine error={action.error} />
      <button type="button" className="btn danger block" disabled={action.busy} onClick={() => (confirm === 'leave' ? void action.run(async () => (await leaveGroup(gid), done())) : setConfirm('leave'))}>
        {confirm === 'leave' ? 'Confirmer : quitter et effacer ma position' : 'Quitter le groupe'}
      </button>
      {admin && (
        <button type="button" className="btn danger block" disabled={action.busy} onClick={() => (confirm === 'delete' ? void action.run(async () => (await deleteGroup(gid), done())) : setConfirm('delete'))}>
          {confirm === 'delete' ? 'Confirmer : supprimer pour tout le monde' : 'Supprimer le groupe'}
        </button>
      )}
    </section>
  );
}
