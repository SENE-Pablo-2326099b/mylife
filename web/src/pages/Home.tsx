import { m } from 'framer-motion';
import { useState } from 'react';
import { HOME_APPS, MYLIFE_APPS, type MyLifeApp } from '../vendor/lumen';
import { RecoveryReminder } from '../ui/account';
import { openMyLifeApp } from '../ui/app';
import { useGlance } from '../ui/glance';
import { HeaderActions } from '../ui/HeaderActions';
import { Icon, type IconName } from '../ui/icons';
import { haptic, springs } from '../ui/motion';
import { Button, Card, IconButton, Reveal } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Tilt } from '../ui/Tilt';
import { useSession } from '../ui/session';
import { useInstallState } from '../install';
import { CharacterCard } from './Character';
import { WeekRecapCard, WrappedCard } from './Recap';

const APP_ICON: Record<MyLifeApp['id'], IconName> = { finances: 'diamond-fill', perf: 'barbell', raveloc: 'navigate' };

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir';
}

const today = () => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

/** Une app : sa tuile de couleur, son nom, et ce qu'elle a à dire maintenant (aperçu déposé par l'app). */
function AppRow({ app, index, entering, onOpen }: { app: MyLifeApp; index: number; entering: string | null; onOpen: () => void }) {
  const glance = useGlance(app.id);
  const zooming = entering === app.id;
  const tone = glance?.tone && glance.tone !== 'accent' ? `var(--${glance.tone})` : undefined;
  return (
    <m.button
      type="button"
      onClick={onOpen}
      className="glass glass-raised relative flex w-full items-center gap-4 overflow-hidden rounded-xl p-4 text-left"
      initial={{ y: 18, opacity: 0 }}
      animate={zooming ? { scale: 1.06, opacity: 0 } : { y: 0, opacity: 1, scale: 1 }}
      transition={zooming ? { duration: 0.32, ease: [0.7, 0, 0.84, 0] } : { ...springs.soft, delay: 0.05 + index * 0.06 }}
      whileTap={{ scale: 0.98 }}
      aria-label={`Ouvrir ${app.name}${glance ? ` : ${glance.title}` : ''}`}
    >
      <span
        aria-hidden
        className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[18px] text-white"
        style={{ background: `linear-gradient(150deg, ${app.colors[0]}, ${app.colors[1]})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), 0 8px 22px ${app.colors[1]}55` }}
      >
        <Icon name={APP_ICON[app.id]} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-title block">{app.name}</span>
        {glance ? (
          <>
            <span className="t-body-strong mt-0.5 block" style={tone ? { color: tone } : undefined}>
              {glance.title}
            </span>
            {glance.detail && <span className="t-small block truncate text-secondary">{glance.detail}</span>}
          </>
        ) : (
          <span className="t-small mt-0.5 block text-secondary">{app.tagline}</span>
        )}
      </span>
      <Icon name="chevron-forward" size={20} className="text-muted" />
    </m.button>
  );
}

export function HomePage() {
  const session = useSession();
  const install = useInstallState();
  const [entering, setEntering] = useState<string | null>(null);
  const name = session ? session.login.charAt(0).toUpperCase() + session.login.slice(1) : null;

  const open = (app: MyLifeApp) => {
    haptic('success');
    setEntering(app.id);
    setTimeout(() => openMyLifeApp(app.path), 260);
  };

  return (
    <Screen
      title={name ? `${greeting()} ${name}` : greeting()}
      kicker={today()}
      mood="today"
      right={<HeaderActions appAction={<IconButton icon="person" label="Compte MyLife" to="/compte" glass />} accountPath="/compte" />}
    >
      <div className="flex flex-col gap-3">
        {!session && (
          <Reveal index={0}>
            <Tilt>
            <Card level="raised" glow>
              <p className="t-title">Un compte pour toutes tes apps</p>
              <p className="t-small mt-1 text-secondary">Retrouve tout sur ton téléphone et ton ordinateur. Tes données sont chiffrées avant de quitter l’appareil : personne d’autre ne peut les lire.</p>
              <div className="mt-4 flex flex-col gap-2">
                <Button size="lg" icon="person-add" to="/compte">
                  Créer mon compte
                </Button>
                <Button variant="ghost" to="/compte?mode=login">
                  J’ai déjà un compte
                </Button>
              </div>
            </Card>
            </Tilt>
          </Reveal>
        )}
        <RecoveryReminder />

        {session && (
          <Reveal index={1}>
            <div className="flex flex-col gap-3">
              <WrappedCard />
              <CharacterCard />
              <Card to="/copilot" label="Copilot : une IA pour toutes tes apps">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-white" style={{ background: 'linear-gradient(150deg, var(--accent-g0), var(--gold))' }} aria-hidden>
                    <Icon name="sparkles" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-body-strong block">Copilot</span>
                    <span className="t-small block truncate text-secondary">« Je peux me payer ce billet ? » : une IA qui connaît toutes tes apps</span>
                  </span>
                  <Icon name="chevron-forward" className="text-muted" />
                </div>
              </Card>
              <WeekRecapCard />
              {/* Les apps de l'accueil, dans l'ordre du registre (contrat d'app : packages/lumen/src/homeApps.ts). */}
              <div className="grid grid-cols-2 gap-3">
                {HOME_APPS.filter((a) => !a.wide).map((a) => (
                  <Card key={a.id} to={a.path} label={`${a.name} : ${a.tagline}`}>
                    <Icon name={a.icon as IconName} className="text-gold" />
                    <p className="t-body-strong mt-1">{a.name}</p>
                    <p className="t-caption text-muted">{a.tagline}</p>
                  </Card>
                ))}
              </div>
              {HOME_APPS.filter((a) => a.wide).map((a) => (
                <Card key={a.id} to={a.path} label={`${a.name} : ${a.tagline}`}>
                  <div className="flex items-center gap-3">
                    <Icon name={a.icon as IconName} className="text-gold" />
                    <span className="min-w-0 flex-1">
                      <span className="t-body-strong block">{a.name}</span>
                      <span className="t-small block truncate text-secondary">{a.tagline}</span>
                    </span>
                    <Icon name="chevron-forward" className="text-muted" />
                  </div>
                </Card>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal index={2}>
          <p className="t-label px-0.5 pb-1 pt-2 text-muted">Tes apps</p>
          <div className="flex flex-col gap-3">
            {MYLIFE_APPS.map((a, i) => (
              <AppRow key={a.id} app={a} index={i} entering={entering} onOpen={() => open(a)} />
            ))}
          </div>
        </Reveal>

        {install !== 'installed' && install !== 'unsupported' && (
          <Reveal index={3}>
            <Card to="/installer" className="flex items-center gap-3" label="Installer MyLife sur cet appareil">
              <Icon name="phone" className="text-accent" />
              <span className="min-w-0 flex-1">
                <span className="t-body-strong block">Installe MyLife</span>
                <span className="t-small block text-secondary">Une icône, toutes tes apps, même hors ligne.</span>
              </span>
              <Icon name="chevron-forward" className="text-muted" />
            </Card>
          </Reveal>
        )}

        <p className="t-caption px-1 pt-2 text-center text-muted">Aucune publicité, aucun traceur. Tes données restent à toi.</p>
      </div>
    </Screen>
  );
}
