import { Button, Card, Reveal, toast } from '../ui/index';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { promptInstall, useInstallState } from '../install';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="t-body flex items-start gap-3">
      <span className="liquid flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold">{n}</span>
      <span className="pt-0.5">{children}</span>
    </p>
  );
}

/** Installer MyLife : une seule app pour toutes (les raccourcis de l'icône mènent à chacune). */
export function InstallPage() {
  const state = useInstallState();
  return (
    <Screen stack title="Installer MyLife" mood="focus" back="/">
      <Reveal index={0}>
        <Card level="raised" glow className="flex flex-col items-center gap-3 text-center">
          <img src="/pwa-192x192.png" alt="" width={84} height={84} className="rounded-[22px]" />
          <p className="t-title">Une app, toutes tes apps</p>
          <p className="t-small text-secondary">MyFinances, MyPerf et MyRave dans une seule icône. Un appui long dessus mène directement à chacune.</p>
        </Card>
      </Reveal>
      <Reveal index={1} className="mt-3">
        <Card className="flex flex-col gap-3">
          {state === 'installed' && (
            <p className="t-body flex items-center gap-2">
              <Icon name="check-circle" className="text-success" /> MyLife est installée sur cet appareil.
            </p>
          )}
          {state === 'prompt' && (
            <Button size="lg" icon="download" onClick={() => void promptInstall().then((ok) => ok && toast({ message: 'MyLife est installée', tone: 'gold' }))}>
              Installer MyLife
            </Button>
          )}
          {state === 'ios' && (
            <>
              <Step n={1}>
                Touche <Icon name="share" size={17} className="mx-0.5 inline align-[-3px] text-accent" /> <strong>Partager</strong> dans Safari.
              </Step>
              <Step n={2}>
                Choisis <strong>Sur l’écran d’accueil</strong>.
              </Step>
              <Step n={3}>
                Touche <strong>Ajouter</strong>.
              </Step>
            </>
          )}
          {state === 'android-menu' && (
            <>
              <Step n={1}>Ouvre le menu du navigateur (⋮ en haut à droite).</Step>
              <Step n={2}>
                Choisis <strong>Installer l’application</strong> (ou <strong>Ajouter à l’écran d’accueil</strong>).
              </Step>
            </>
          )}
          {state === 'desktop-menu' && <Step n={1}>Dans la barre d’adresse, clique sur l’icône d’installation (écran avec une flèche), ou menu ⋮ → Installer MyLife.</Step>}
          {state === 'unsupported' && <p className="t-small text-secondary">Ce navigateur ne sait pas installer d’app web. Ouvre MyLife dans Chrome, Edge ou Safari.</p>}
        </Card>
      </Reveal>
      <Reveal index={2} className="mt-3">
        <Card>
          <p className="t-body-strong">Tu avais installé une app seule ?</p>
          <p className="t-small mt-1 text-secondary">MyFinances, MyPerf ou MyRave installées à part peuvent être désinstallées : MyLife les contient, avec les mêmes données (elles restent sur l’appareil).</p>
        </Card>
      </Reveal>
    </Screen>
  );
}
