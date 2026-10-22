import { stopAllSharing } from '../state/app';
import { AccountForms, AccountOverview } from '../ui/account';
import { Reveal } from '../ui/index';
import { Screen } from '../ui/Screen';
import { useSession } from '../ui/session';

/** Le compte MyLife, depuis myRaveLoc : se déconnecter ou supprimer le compte coupe d'abord tous les partages. */
export function AccountScreen() {
  const session = useSession();
  return (
    <Screen stack title="Compte MyLife" kicker="Un compte pour toutes tes apps" mood="settings" back="/groupes">
      <Reveal index={0}>
        {session ? (
          <AccountOverview session={session} beforeSignOut={stopAllSharing} rows={[{ label: 'myRaveLoc', detail: 'Groupes et positions chiffrés de bout en bout', state: 'ok' }]} />
        ) : (
          <AccountForms initial="login" />
        )}
      </Reveal>
    </Screen>
  );
}
