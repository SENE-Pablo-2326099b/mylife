import { useEffect, useMemo, useState } from 'react';
import { useObservable } from '../lib/observable';
import { app, loadGroups, pollNow, resume, setScreen, share, SHARE_DURATIONS, type Group } from '../state/app';
import { go } from '../state/nav';
import { location, needLocation, retryLocation } from '../services/location';
import { formatAge } from '../domain/status';
import { describe, sortFriends } from '../ui/describe';
import { remaining, when } from '../ui/format';
import { Avatar, BrandMark, ErrorLine, Icon, NetBanner, Pending, Sheet, useAction, useNow } from '../ui/kit';

/** Écran principal : le groupe actif, mes amis, et une seule grande action — en retrouver un. */
export function Home() {
  const s = useObservable(app);
  const loc = useObservable(location);
  const now = useNow(1000);
  const group = s.groups.list.find((g) => g.id === s.activeId) ?? null;
  const live = s.live?.gid === group?.id ? s.live : null;

  useEffect(() => setScreen('group'), []);

  const friends = useMemo(() => (live ? sortFriends(live.members.filter((m) => !m.me).map((m) => ({ m, line: describe(m, loc.fix, now) }))) : []), [live, loc.fix, now]);
  const someoneLocated = friends.some((f) => f.m.fix);

  // Distances : notre position sert au calcul (sans être partagée) dès que le site y a déjà droit.
  const [wantDistances, setWantDistances] = useState(false);
  const autoLocate = someoneLocated && (loc.permission === 'granted' || wantDistances);
  useEffect(() => (autoLocate ? needLocation('home', 'share') : undefined), [autoLocate]);

  if (s.groups.status === 'loading' || s.groups.status === 'idle')
    return (
      <main className="screen">
        <Header group={null} />
        <Pending label="Chargement de tes groupes" />
      </main>
    );

  if (s.groups.status === 'error' && !s.groups.list.length)
    return (
      <main className="screen">
        <Header group={null} />
        <NetBanner />
        <div className="card empty">
          <Icon name="alert" size={32} className="danger" />
          <p style={{ margin: 0 }}>Impossible de charger tes groupes.</p>
          <ErrorLine error={s.groups.error} />
          <button type="button" className="btn" onClick={() => void loadGroups()}>
            <Icon name="refresh" /> Réessayer
          </button>
        </div>
      </main>
    );

  if (!group)
    return (
      <main className="screen">
        <Header group={null} />
        <NetBanner />
        {s.groups.error && (
          <div className="banner warn" role="status">
            <Icon name="alert" />
            <span>{s.groups.error}</span>
          </div>
        )}
        <div className="card empty">
          <BrandMark size={64} />
          <h1 className="h2">Aucun groupe pour l’instant</h1>
          <p className="muted" style={{ margin: 0 }}>
            Crée un groupe pour ta soirée, ton festival ou ton concert, puis invite tes amis avec un lien.
          </p>
          <button type="button" className="btn primary block big" onClick={() => go({ name: 'create' })}>
            <Icon name="plus" /> Créer un groupe
          </button>
          <p className="faint small" style={{ margin: 0 }}>
            On t’a envoyé un lien ? Ouvre-le simplement sur ce téléphone.
          </p>
        </div>
      </main>
    );

  return (
    <main className="screen">
      <Header group={group} />
      <NetBanner />
      <ShareCard group={group} now={now} />

      <section className="stack" aria-labelledby="friends-title">
        <div className="row">
          <h2 id="friends-title" className="label grow">
            Retrouver un ami
          </h2>
          {live?.syncedAt && <span className="faint tiny">mis à jour {formatAge(now - live.syncedAt)}</span>}
        </div>

        {!live || live.status === 'loading' ? (
          <Pending rows={2} label="Chargement du groupe" />
        ) : live.status === 'error' && !live.syncedAt ? (
          <div className="card empty">
            <p style={{ margin: 0 }}>Le groupe n’a pas pu être chargé.</p>
            <ErrorLine error={live.error} />
            <button type="button" className="btn" onClick={() => void pollNow(group.id)}>
              <Icon name="refresh" /> Réessayer
            </button>
          </div>
        ) : friends.length === 0 ? (
          <div className="card empty">
            <Icon name="users" size={32} className="muted" />
            <p style={{ margin: 0 }}>Personne d’autre dans ce groupe pour l’instant.</p>
            <button type="button" className="btn primary" onClick={() => go({ name: 'manage' })}>
              <Icon name="link" /> Inviter des amis
            </button>
          </div>
        ) : (
          <>
            {someoneLocated && !autoLocate && loc.permission !== 'denied' && (
              <button type="button" className="btn block" onClick={() => setWantDistances(true)}>
                <Icon name="pin" /> Afficher les distances
                <span className="faint tiny">(ta position reste sur ce téléphone)</span>
              </button>
            )}
            {someoneLocated && loc.status === 'denied' && (
              <div className="banner warn" role="status">
                <Icon name="alert" />
                <span>Localisation refusée : distances et direction impossibles. Autorise-la dans les réglages du site.</span>
                <button type="button" className="btn small" onClick={retryLocation}>
                  Réessayer
                </button>
              </div>
            )}
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {friends.map(({ m, line }) => (
                <li key={m.uid}>
                  <button type="button" className={`friend${line.state === 'not-sharing' ? ' dim' : ''}`} onClick={() => go({ name: 'navigate', uid: m.uid })} aria-label={`Retrouver ${m.name ?? 'ce membre'} — ${line.text}${line.distance ? ` — ${line.distance}` : ''}`}>
                    <Avatar uid={m.uid} name={m.name} />
                    <span className="grow" style={{ minWidth: 0, flex: 1 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <b className="ellipsis" style={{ fontSize: 17 }}>
                          {m.name ?? 'Membre'}
                        </b>
                        {m.role === 'admin' && <span className="faint tiny">admin</span>}
                      </span>
                      <span className={`row small ${line.tone}`} style={{ gap: 6, alignItems: 'baseline' }}>
                        <span className={`dot${line.state === 'live' && line.freshness === 'live' ? ' live' : ''}`} style={{ transform: 'translateY(-1px)' }} />
                        <span>{line.text}</span>
                      </span>
                    </span>
                    <span className="dist">
                      {line.distance ? <b>{line.distance}</b> : <b className="faint">—</b>}
                      <span className="faint tiny">{line.distance ? 'à vol d’oiseau' : (line.noDistance ?? '')}</span>
                    </span>
                    <Icon name="chevron" className="faint" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="spacer" />
      <div className="row">
        <button type="button" className="btn grow" style={{ flex: 1 }} onClick={() => go({ name: 'manage' })}>
          <Icon name="link" /> Inviter
        </button>
        <button type="button" className="btn grow" style={{ flex: 1 }} onClick={() => go({ name: 'manage' })}>
          <Icon name="gear" /> Gérer
        </button>
      </div>
    </main>
  );
}

function Header({ group }: { group: Group | null }) {
  const now = useNow(60_000);
  return (
    <header className="topbar">
      <BrandMark />
      <button type="button" className="grow" onClick={() => go({ name: 'groups' })} style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, minHeight: 48 }} aria-label="Changer de groupe">
        <span className="label">{group ? 'Groupe' : 'myRaveLoc'}</span>
        <span className="row" style={{ gap: 4 }}>
          <span className="h2 ellipsis">{group ? (group.name ?? 'Groupe (nom illisible)') : 'Mes groupes'}</span>
          <Icon name="chevron" size={18} className="faint" />
        </span>
        {group && <span className="faint tiny">fin {remaining(group.expiresAt, now)}, puis tout est effacé</span>}
      </button>
      <button type="button" className="icon-btn" onClick={() => go({ name: 'groups' })} aria-label="Mes groupes">
        <Icon name="users" />
      </button>
    </header>
  );
}

/** Mon partage : actif, en pause ou coupé ; avec qui ; transmis ou non, et quand. */
function ShareCard({ group, now }: { group: Group; now: number }) {
  const s = useObservable(app);
  const loc = useObservable(location);
  const [open, setOpen] = useState(false);
  const action = useAction();
  const tx = s.transmission[group.id];
  const others = Math.max(0, group.members - 1);
  const audience = others === 0 ? 'personne d’autre pour l’instant' : others === 1 ? 'l’autre membre du groupe' : `les ${others} autres membres du groupe`;

  if (group.sharing === 'off')
    return (
      <section className="card stack" aria-label="Partage de ma position">
        <div className="row">
          <span className="dot faint" />
          <b className="grow">Ta position n’est pas partagée</b>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Tu peux voir tes amis qui partagent. Pour qu’ils te trouvent, partage la tienne avec ce groupe, pour une durée limitée.
        </p>
        <button type="button" className="btn primary block" onClick={() => setOpen(true)}>
          <Icon name="pin" /> Partager ma position
        </button>
        {open && <ShareSheet group={group} audience={audience} onClose={() => setOpen(false)} />}
      </section>
    );

  const paused = group.sharing === 'paused';
  const blocked = !paused ? (tx?.blocked ?? null) : null;
  return (
    <section className="card raised stack" aria-label="Partage de ma position" style={{ borderColor: paused ? 'var(--warn)' : blocked ? 'var(--danger)' : 'var(--brand-a)' }}>
      <div className="row">
        <span className={`dot ${paused ? 'warn' : blocked ? 'danger' : 'ok live'}`} />
        <b className="grow">{paused ? 'Partage en pause' : 'Partage actif'}</b>
        {group.shareUntil && <span className="faint small">jusqu’à {when(group.shareUntil, now)}</span>}
      </div>
      <p className="small" style={{ margin: 0 }}>
        {paused ? (
          <span className="warn">Plus rien n’est envoyé. Tes amis voient ta dernière position, figée et datée.</span>
        ) : blocked ? (
          <span className="danger">{blocked}</span>
        ) : tx?.sentAt ? (
          <span className="ok">Position transmise {formatAge(now - tx.sentAt)}.</span>
        ) : (
          <span className="info">{loc.status === 'ok' ? 'Envoi en cours…' : 'En attente du GPS…'}</span>
        )}{' '}
        <span className="muted">Visible par {audience}.</span>
      </p>
      {!paused && <p className="faint tiny" style={{ margin: 0 }}>Garde l’app ouverte : un navigateur n’envoie rien quand l’écran est éteint ou l’app en arrière-plan.</p>}
      <ErrorLine error={action.error} />
      <div className="row">
        {paused ? (
          <button type="button" className="btn primary" style={{ flex: 1 }} disabled={action.busy} onClick={() => void action.run(() => resume(group.id))}>
            <Icon name="pin" /> Reprendre
          </button>
        ) : (
          <button type="button" className="btn" style={{ flex: 1 }} disabled={action.busy} onClick={() => void action.run(() => share(group.id, 'paused'))}>
            <Icon name="pause" /> Pause
          </button>
        )}
        <button type="button" className="btn danger" style={{ flex: 1 }} disabled={action.busy} onClick={() => void action.run(() => share(group.id, 'off'))}>
          <Icon name="stop" /> Arrêter
        </button>
      </div>
    </section>
  );
}

function ShareSheet({ group, audience, onClose }: { group: Group; audience: string; onClose: () => void }) {
  const [choice, setChoice] = useState<number | null>(SHARE_DURATIONS[1].ms);
  const action = useAction();
  const until = choice ? Math.min(Date.now() + choice, group.expiresAt) : group.expiresAt;
  return (
    <Sheet title="Partager ma position" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        Visible par <b style={{ color: 'var(--text)' }}>{audience}</b> de « {group.name ?? 'ce groupe'} », et par personne d’autre. Chiffrée sur ton téléphone : le serveur ne peut pas la lire.
      </p>
      <div className="stack">
        <span className="label">Pendant</span>
        <div className="chips" role="group" aria-label="Durée du partage">
          {SHARE_DURATIONS.map((d) => (
            <button key={d.label} type="button" className="chip" aria-pressed={choice === d.ms} onClick={() => setChoice(d.ms)}>
              {d.label}
            </button>
          ))}
        </div>
        <span className="faint small">Jusqu’à {when(until)}. Pause ou arrêt à tout moment ; à l’arrêt, ta position est effacée du serveur.</span>
      </div>
      <p className="faint small" style={{ margin: 0 }}>
        Ton téléphone va demander l’accès à ta position. Elle n’est envoyée que pendant que myRaveLoc est ouvert.
      </p>
      <ErrorLine error={action.error} />
      <button
        type="button"
        className="btn primary block big"
        disabled={action.busy}
        onClick={() =>
          void action.run(async () => {
            await share(group.id, 'on', choice);
            onClose();
          })
        }
      >
        {action.busy ? 'Activation…' : 'Partager'}
      </button>
    </Sheet>
  );
}
