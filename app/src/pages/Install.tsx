import { Button, EmptyState, Glass, ScreenHeader } from '@mylife/kit';
import { promptInstall, useInstallState, type InstallState } from '../install';

/**
 * Installer MyLife (une seule icône pour tout). Chrome et Edge proposent une invitation qu'on garde pour la déclencher
 * d'un bouton ; Safari (iPhone) s'installe par Partager → « Sur l'écran d'accueil » ; Firefox sur ordinateur ne sait pas.
 */
const HOW: Record<Exclude<InstallState, 'installed' | 'prompt'>, string[]> = {
  ios: ['Dans Safari, touche le bouton Partager (le carré avec une flèche).', 'Choisis « Sur l’écran d’accueil », puis « Ajouter ».'],
  'android-menu': ['Ouvre le menu du navigateur (les trois points).', 'Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».'],
  'desktop-menu': ['Clique sur l’icône d’installation dans la barre d’adresse, ou ouvre le menu du navigateur.', 'Choisis « Installer MyLife ».'],
  unsupported: ['Ce navigateur ne sait pas installer les apps web. Essaie avec Chrome, Edge ou Safari.'],
};

export function InstallPage() {
  const state = useInstallState();
  return (
    <>
      <ScreenHeader kicker="Une icône, tout MyLife" title="Installer" />
      {state === 'installed' ? (
        <EmptyState title="MyLife est installée" body="Tu l'ouvres depuis son icône, et elle marche même sans réseau." />
      ) : state === 'prompt' ? (
        <Glass className="pad stack">
          <span className="t-strong">Installe MyLife sur cet appareil</span>
          <span className="t-small muted">Une icône sur l'écran d'accueil, plein écran, et l'app s'ouvre même hors ligne.</span>
          <Button variant="action" block onClick={() => void promptInstall()}>
            Installer
          </Button>
        </Glass>
      ) : (
        <Glass className="pad stack">
          <span className="t-strong">Comment faire</span>
          <ol className="t-body muted" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {HOW[state].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Glass>
      )}
    </>
  );
}
