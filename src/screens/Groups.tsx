import { useEffect, useState } from 'react';
import { useObservable } from '../lib/observable';
import { inviteParts, parseInvite } from '../lib/groupCrypto';
import { app, createGroup, GROUP_DURATIONS, joinGroup, lastPseudo, previewInvite, regulars, forgetRegulars, setActive, setScreen, signOut } from '../state/app';
import { back, go, replace } from '../state/nav';
import { MYLIFE_APPS } from '../vendor/lumen';
import { remaining } from '../ui/format';
import { Avatar, ErrorLine, Icon, NetBanner, Pending, useAction, useNow } from '../ui/kit';

/** Mes groupes : passer de l'un à l'autre, en créer, en rejoindre ; compte et autres apps MyLife. */
export function Groups() {
  const s = useObservable(app);
  const now = useNow(60_000);
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [known, setKnown] = useState(regulars);
  const out = useAction();

  useEffect(() => setScreen('list'), []);

  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={back} aria-label="Revenir">
          <Icon name="back" />
        </button>
        <h1 className="h2 grow">Mes groupes</h1>
      </header>
      <NetBanner />

      {s.groups.status !== 'ready' && !s.groups.list.length ? (
        s.groups.status === 'error' ? <ErrorLine error={s.groups.error} /> : <Pending rows={2} label="Chargement des groupes" />
      ) : s.groups.list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Aucun groupe. Crée le premier, ou ouvre le lien qu’un ami t’a envoyé.
        </p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {s.groups.list.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="friend"
                aria-current={g.id === s.activeId}
                style={g.id === s.activeId ? { borderColor: 'var(--brand-a)' } : undefined}
                onClick={() => {
                  setActive(g.id);
                  replace({ name: 'home' });
                }}
              >
                <span className="grow" style={{ flex: 1, minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block', fontSize: 17 }}>
                    {g.name ?? 'Groupe (nom illisible)'}
                  </b>
                  <span className="faint small">
                    {g.members} membre{g.members > 1 ? 's' : ''} · fin {remaining(g.expiresAt, now)}
                    {g.role === 'admin' ? ' · admin' : ''}
                  </span>
                </span>
                {g.sharing !== 'off' && <span className={`pill ${g.sharing === 'on' ? 'ok' : 'warn'}`}>{g.sharing === 'on' ? 'Tu partages' : 'En pause'}</span>}
                <Icon name="chevron" className="faint" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn primary block big" onClick={() => go({ name: 'create' })}>
        <Icon name="plus" /> Nouveau groupe
      </button>

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          const inv = inviteParts(paste);
          if (!inv || !parseInvite(paste)) return setPasteError('Ce n’est pas un lien d’invitation myRaveLoc complet.');
          setPasteError(null);
          setPaste('');
          go({ name: 'join', token: inv.token, key: inv.key });
        }}
      >
        <label className="field">
          <span className="label">Rejoindre avec un lien</span>
          <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Colle le lien reçu" autoCapitalize="none" spellCheck={false} />
        </label>
        <ErrorLine error={pasteError} />
        {paste && (
          <button type="submit" className="btn">
            Continuer
          </button>
        )}
      </form>

      {known.length > 0 && (
        <section className="card stack">
          <span className="label">Tes habitués</span>
          <p className="faint tiny" style={{ margin: 0 }}>
            Les personnes croisées dans tes groupes, gardées sur ce téléphone seulement. Cela ne donne accès à aucune position : pour se voir, il faut être dans le même groupe et partager.
          </p>
          {known.slice(0, 8).map((r) => (
            <div key={r.uid} className="row small">
              <Avatar uid={r.uid} name={r.name} />
              <span className="grow" style={{ flex: 1 }}>
                {r.name}
                <br />
                <span className="faint">
                  {r.groups.length} groupe{r.groups.length > 1 ? 's' : ''} ensemble
                </span>
              </span>
            </div>
          ))}
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              forgetRegulars();
              setKnown([]);
            }}
          >
            Oublier cette liste
          </button>
        </section>
      )}

      <section className="card stack">
        <span className="label">MyLife</span>
        <div className="chips">
          {MYLIFE_APPS.filter((a) => a.id !== 'raveloc').map((a) => (
            <a key={a.id} className="chip" href={a.path} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              {a.name}
            </a>
          ))}
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          Connecté en tant que <b>{s.session?.login}</b> (compte MyLife).
        </p>
        <ErrorLine error={out.error} />
        <button type="button" className="btn small" disabled={out.busy} onClick={() => void out.run(signOut)}>
          Se déconnecter (arrête tous tes partages)
        </button>
      </section>
    </main>
  );
}

const SUGGESTIONS = ['Festival du week-end', 'Rave de ce soir', 'Soirée entre amis', 'Concert de demain'];

export function CreateGroup() {
  const [name, setName] = useState('');
  const [duration, setDuration] = useState<number>(GROUP_DURATIONS[0].ms);
  const [pseudo, setPseudo] = useState(() => lastPseudo() ?? app.get().session?.login ?? '');
  const action = useAction();
  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={back} aria-label="Revenir">
          <Icon name="back" />
        </button>
        <h1 className="h2 grow">Nouveau groupe</h1>
      </header>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await createGroup({ name, pseudo, durationMs: duration });
            replace({ name: 'home' });
            go({ name: 'manage' });
          });
        }}
      >
        <label className="field">
          <span className="label">Nom du groupe</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="Ex. Festival du week-end" />
        </label>
        <div className="chips">
          {SUGGESTIONS.map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={name === x} onClick={() => setName(x)}>
              {x}
            </button>
          ))}
        </div>
        <span className="label" style={{ marginTop: 8 }}>
          Durée de vie
        </span>
        <div className="chips" role="group" aria-label="Durée de vie du groupe">
          {GROUP_DURATIONS.map((d) => (
            <button key={d.label} type="button" className="chip" aria-pressed={duration === d.ms} onClick={() => setDuration(d.ms)}>
              {d.label} <span className="faint">· {d.hint}</span>
            </button>
          ))}
        </div>
        <span className="faint small">À la fin, le groupe et toutes ses positions sont effacés.</span>
        <label className="field" style={{ marginTop: 8 }}>
          <span className="label">Ton pseudo</span>
          <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={24} required />
        </label>
        <ErrorLine error={action.error} />
        <button type="submit" className="btn primary block big" disabled={action.busy || !name.trim() || !pseudo.trim()}>
          {action.busy ? 'Création…' : 'Créer et inviter'}
        </button>
        <p className="faint small" style={{ margin: 0 }}>
          Ta position ne sera partagée que lorsque tu l’activeras.
        </p>
      </form>
    </main>
  );
}

/** Ouverture d'un lien d'invitation : on montre le groupe, puis on rejoint (partage coupé par défaut). */
export function Join({ token, keyText }: { token: string; keyText: string }) {
  const inv = parseInvite(`rejoindre=${token}.${keyText}`);
  const [preview, setPreview] = useState<{ gid: string; name: string | null; expiresAt: number; member: boolean } | null>(null);
  const [pseudo, setPseudo] = useState(() => lastPseudo() ?? app.get().session?.login ?? '');
  const look = useAction();
  const join = useAction();
  const now = useNow(60_000);

  useEffect(() => {
    if (inv) void look.run(async () => setPreview(await previewInvite(inv.token, inv.key)));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="screen">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => replace({ name: 'home' })} aria-label="Annuler">
          <Icon name="close" />
        </button>
        <h1 className="h2 grow">Invitation</h1>
      </header>
      <NetBanner />
      {!inv ? (
        <div className="card empty">
          <Icon name="alert" size={32} className="danger" />
          <p style={{ margin: 0 }}>Ce lien d’invitation est incomplet ou abîmé. Demande-en un nouveau.</p>
        </div>
      ) : look.error ? (
        <div className="card empty">
          <Icon name="alert" size={32} className="danger" />
          <ErrorLine error={look.error} />
          <button type="button" className="btn" onClick={() => void look.run(async () => setPreview(await previewInvite(inv.token, inv.key)))}>
            <Icon name="refresh" /> Réessayer
          </button>
        </div>
      ) : !preview ? (
        <Pending rows={1} label="Vérification de l’invitation" />
      ) : preview.name === null ? (
        <div className="card empty">
          <Icon name="alert" size={32} className="danger" />
          <p style={{ margin: 0 }}>La clé contenue dans ce lien ne correspond pas au groupe. Le lien a peut-être été tronqué : demande-en un nouveau.</p>
        </div>
      ) : preview.member ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>
            Tu fais déjà partie de « <b>{preview.name}</b> ».
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setActive(preview.gid);
              replace({ name: 'home' });
            }}
          >
            Ouvrir le groupe
          </button>
        </div>
      ) : (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            void join.run(async () => {
              await joinGroup(inv.token, inv.key, preview.gid, pseudo);
              replace({ name: 'home' });
            });
          }}
        >
          <span className="label">Rejoindre</span>
          <h2 className="title">{preview.name}</h2>
          <span className="faint small">Groupe actif jusqu’à sa fin, {remaining(preview.expiresAt, now)}.</span>
          <label className="field">
            <span className="label">Ton pseudo</span>
            <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={24} required />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            En rejoignant, tu vois les membres qui partagent leur position. La tienne reste privée tant que tu n’actives pas le partage.
          </p>
          <ErrorLine error={join.error} />
          <button type="submit" className="btn primary block big" disabled={join.busy || !pseudo.trim()}>
            {join.busy ? 'Connexion au groupe…' : 'Rejoindre le groupe'}
          </button>
        </form>
      )}
    </main>
  );
}
