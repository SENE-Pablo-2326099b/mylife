import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useObservable } from '../lib/observable';
import { app, loadGroups, pollNow, resume, setScreen, share, SHARE_DURATIONS, type Group } from '../state/app';
import { location, needLocation, retryLocation } from '../services/location';
import { formatAge } from '../domain/status';
import { describe, sortFriends, TONE } from '../lib/describe';
import { remaining, when } from '../lib/format';
import { Avatar, Banner, ErrorLine, NetBanner, Pending, useAction, useNow } from '../components/kit';
import { RavelocHeader } from '../components/Header';
import { RecoveryReminder } from '../ui/account';
import { Badge, Button, Card, Chip, EmptyState, Reveal, SectionTitle, Sheet } from '../ui/index';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { useTabActive } from '../ui/tabActive';

/** Écran principal : le groupe actif, mes amis, et une seule grande action — en retrouver un. */
export function Home() {
  const s = useObservable(app);
  const loc = useObservable(location);
  const now = useNow(1000);
  const navigate = useNavigate();
  const active = useTabActive();
  const group = s.groups.list.find((g) => g.id === s.activeId) ?? null;
  const live = s.live?.gid === group?.id ? s.live : null;

  useEffect(() => {
    if (active) setScreen('group');
  }, [active]);

  const friends = useMemo(() => (live ? sortFriends(live.members.filter((m) => !m.me).map((m) => ({ m, line: describe(m, loc.fix, now) }))) : []), [live, loc.fix, now]);
  const someoneLocated = friends.some((f) => f.m.fix);

  // Distances : notre position sert au calcul (sans être partagée) dès que le site y a déjà droit.
  const [wantDistances, setWantDistances] = useState(false);
  const autoLocate = active && someoneLocated && (loc.permission === 'granted' || wantDistances);
  useEffect(() => (autoLocate ? needLocation('home', 'share') : undefined), [autoLocate]);

  const title = group ? (group.name ?? 'Groupe (nom illisible)') : 'Retrouver';
  const kicker = group ? `Groupe · fin ${remaining(group.expiresAt, now)}` : 'myRaveLoc';

  if (s.groups.status === 'loading' || s.groups.status === 'idle')
    return (
      <Screen title={title} kicker={kicker} mood="focus" right={<RavelocHeader />}>
        <Pending label="Chargement de tes groupes" />
      </Screen>
    );

  if (s.groups.status === 'error' && !s.groups.list.length)
    return (
      <Screen title={title} kicker={kicker} mood="focus" right={<RavelocHeader />}>
        <NetBanner />
        <EmptyState
          icon="alert-circle"
          title="Impossible de charger tes groupes"
          body={<ErrorLine error={s.groups.error} />}
          action={
            <Button variant="secondary" icon="sync" onClick={() => void loadGroups()}>
              Réessayer
            </Button>
          }
        />
      </Screen>
    );

  if (!group)
    return (
      <Screen title={title} kicker={kicker} mood="focus" right={<RavelocHeader />} onRefresh={loadGroups}>
        <div className="flex flex-col gap-3">
          <NetBanner />
          <RecoveryReminder />
          {s.groups.error && (
            <Banner tone="warning" icon="warning">
              {s.groups.error}
            </Banner>
          )}
          <Reveal index={0}>
            <Card level="raised" glow>
              <EmptyState
                icon="navigate"
                title="Aucun groupe pour l’instant"
                body="Crée un groupe pour ta soirée, ton festival ou ton concert, puis invite tes amis avec un lien."
                action={
                  <Button size="lg" icon="add" to="/groupes/nouveau">
                    Créer un groupe
                  </Button>
                }
              />
              <p className="t-caption text-center text-muted">On t’a envoyé un lien ? Ouvre-le simplement sur ce téléphone.</p>
            </Card>
          </Reveal>
        </div>
      </Screen>
    );

  return (
    <Screen title={title} kicker={kicker} mood="focus" right={<RavelocHeader />} onRefresh={() => pollNow(group.id)}>
      <div className="flex flex-col gap-3">
        <NetBanner />
        <RecoveryReminder />
        <Reveal index={0}>
          <Tilt>
            <ShareCard group={group} now={now} />
          </Tilt>
        </Reveal>

        <Reveal index={1}>
          <SectionTitle action={live?.syncedAt ? <span className="t-caption text-muted">mis à jour {formatAge(now - live.syncedAt)}</span> : undefined}>Retrouver un ami</SectionTitle>
          {!live || live.status === 'loading' ? (
            <Pending label="Chargement du groupe" />
          ) : live.status === 'error' && !live.syncedAt ? (
            <Card>
              <p className="t-body">Le groupe n’a pas pu être chargé.</p>
              <ErrorLine error={live.error} />
              <Button className="mt-3" variant="secondary" icon="sync" onClick={() => void pollNow(group.id)}>
                Réessayer
              </Button>
            </Card>
          ) : friends.length === 0 ? (
            <Card>
              <EmptyState
                icon="people"
                title="Personne d’autre ici"
                body="Invite tes amis : un lien suffit, ils arrivent directement dans ce groupe."
                action={
                  <Button icon="link" to="/groupe">
                    Inviter des amis
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {someoneLocated && !autoLocate && loc.permission !== 'denied' && (
                <Button variant="secondary" icon="pin" onClick={() => setWantDistances(true)}>
                  Afficher les distances
                </Button>
              )}
              {someoneLocated && loc.status === 'denied' && (
                <Banner
                  tone="warning"
                  icon="warning"
                  action={
                    <Button size="sm" variant="secondary" onClick={retryLocation}>
                      Réessayer
                    </Button>
                  }
                >
                  Localisation refusée : distances et direction impossibles. Autorise-la dans les réglages du site.
                </Banner>
              )}
              {friends.map(({ m, line }) => (
                <Card
                  key={m.uid}
                  onClick={() => navigate(`/ami/${m.uid}`)}
                  label={`Retrouver ${m.name ?? 'ce membre'} — ${line.text}${line.distance ? ` — ${line.distance}` : ''}`}
                  className={`flex items-center gap-3 ${line.state === 'not-sharing' ? 'opacity-70' : ''}`}
                >
                  <Avatar uid={m.uid} name={m.name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="t-body-strong truncate">{m.name ?? 'Membre'}</span>
                      {m.role === 'admin' && <span className="t-caption text-muted">admin</span>}
                    </span>
                    <span className="t-small flex items-baseline gap-1.5" style={{ color: TONE[line.tone] }}>
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${line.state === 'live' && line.freshness === 'live' ? 'live-dot' : ''}`}
                        style={{ background: TONE[line.tone], boxShadow: `0 0 8px ${TONE[line.tone]}` }}
                        aria-hidden
                      />
                      <span>{line.text}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-right">
                    <span className="num font-display text-[17px] font-semibold">{line.distance ?? '—'}</span>
                    <span className="t-caption max-w-[110px] text-muted">{line.distance ? 'à vol d’oiseau' : (line.noDistance ?? '')}</span>
                  </span>
                  <Icon name="chevron-forward" size={18} className="text-muted" />
                </Card>
              ))}
            </div>
          )}
        </Reveal>

        <Reveal index={2}>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" icon="link" to="/groupe">
              Inviter
            </Button>
            <Button variant="secondary" icon="options" to="/groupe">
              Gérer
            </Button>
          </div>
        </Reveal>
      </div>
    </Screen>
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
      <Card>
        <p className="t-headline">Ta position n’est pas partagée</p>
        <p className="t-small mt-1 text-secondary">Tu vois tes amis qui partagent. Pour qu’ils te trouvent, partage la tienne avec ce groupe, pour une durée limitée.</p>
        <Button className="mt-3 w-full" icon="pin" onClick={() => setOpen(true)}>
          Partager ma position
        </Button>
        <ShareSheet open={open} group={group} audience={audience} onClose={() => setOpen(false)} />
      </Card>
    );

  const paused = group.sharing === 'paused';
  const blocked = !paused ? (tx?.blocked ?? null) : null;
  return (
    <Card level="raised" tone={paused ? 'warning' : blocked ? 'danger' : 'success'} glow={!paused && !blocked}>
      <div className="flex items-center gap-2">
        <Badge tone={paused ? 'warning' : blocked ? 'danger' : 'success'}>{paused ? 'Partage en pause' : 'Partage actif'}</Badge>
        <span className="flex-1" />
        {group.shareUntil && <span className="t-caption text-muted">jusqu’à {when(group.shareUntil, now)}</span>}
      </div>
      <p className="t-small mt-2">
        {paused ? (
          <span className="text-warning">Plus rien n’est envoyé. Tes amis voient ta dernière position, figée et datée.</span>
        ) : blocked ? (
          <span className="text-danger">{blocked}</span>
        ) : tx?.sentAt ? (
          <span className="text-success">Position transmise {formatAge(now - tx.sentAt)}.</span>
        ) : (
          <span className="text-info">{loc.status === 'ok' ? 'Envoi en cours…' : 'En attente du GPS…'}</span>
        )}{' '}
        <span className="text-secondary">Visible par {audience}.</span>
      </p>
      {!paused && <p className="t-caption mt-1 text-muted">Garde l’app ouverte : un navigateur n’envoie rien quand l’écran est éteint ou l’app en arrière-plan.</p>}
      <ErrorLine error={action.error} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {paused ? (
          <Button icon="play" disabled={action.busy} onClick={() => void action.run(() => resume(group.id))}>
            Reprendre
          </Button>
        ) : (
          <Button variant="secondary" icon="pause" disabled={action.busy} onClick={() => void action.run(() => share(group.id, 'paused'))}>
            Pause
          </Button>
        )}
        <Button variant="danger" icon="stop" disabled={action.busy} onClick={() => void action.run(() => share(group.id, 'off'))}>
          Arrêter
        </Button>
      </div>
    </Card>
  );
}

function ShareSheet({ open, group, audience, onClose }: { open: boolean; group: Group; audience: string; onClose: () => void }) {
  const [choice, setChoice] = useState<number | null>(SHARE_DURATIONS[1].ms);
  const action = useAction();
  const until = choice ? Math.min(Date.now() + choice, group.expiresAt) : group.expiresAt;
  return (
    <Sheet
      open={open}
      title="Partager ma position"
      onClose={onClose}
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await share(group.id, 'on', choice);
              onClose();
            })
          }
        >
          {action.busy ? 'Activation…' : 'Partager'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="t-body text-secondary">
          Visible par <strong className="text-ink">{audience}</strong> de « {group.name ?? 'ce groupe'} », et par personne d’autre. Chiffrée sur ton téléphone : le serveur ne peut pas la lire.
        </p>
        <p className="t-label text-muted">Pendant</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Durée du partage">
          {SHARE_DURATIONS.map((d) => (
            <Chip key={d.label} selected={choice === d.ms} onClick={() => setChoice(d.ms)}>
              {d.label}
            </Chip>
          ))}
        </div>
        <p className="t-small text-muted">Jusqu’à {when(until)}. Pause ou arrêt à tout moment ; à l’arrêt, ta position est effacée du serveur.</p>
        <p className="t-small text-muted">Ton téléphone va demander l’accès à ta position. Elle n’est envoyée que pendant que myRaveLoc est ouvert.</p>
        <ErrorLine error={action.error} />
      </div>
    </Sheet>
  );
}
