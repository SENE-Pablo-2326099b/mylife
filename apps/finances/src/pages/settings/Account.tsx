import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../../hooks';
import { relativeTime } from '../../ui/relative';
import { syncCloud, useCloud } from '../../sync/cloud';
import { JoinCard } from '../../components/JoinCard';
import { AccountForms, AccountOverview } from '../../ui/account';
import { useSession } from '../../ui/session';
import { Button, Reveal } from '../../ui/index';
import { Screen } from '../../ui/Screen';

export default function AccountPage() {
  const session = useSession();
  const cloud = useCloud();
  const { onboarded } = useSettings();
  const [params] = useSearchParams();

  const syncLine = cloud.error
    ? cloud.error
    : cloud.syncing
      ? 'Synchro en cours…'
      : !cloud.joined
        ? 'Appareil en cours de liaison…'
        : `${cloud.lastSyncAt ? `Synchronisé ${relativeTime(cloud.lastSyncAt)}` : 'Pas encore synchronisé'}${cloud.pending > 0 ? ` · ${cloud.pending} modification${cloud.pending > 1 ? 's' : ''} à envoyer` : ''}`;

  return (
    <Screen stack title="Compte MyLife" kicker="Un compte pour toutes tes apps" mood="settings" back={onboarded ? '/reglages' : '/bienvenue'}>
      <Reveal index={0}>
        {!session ? (
          <AccountForms initial={params.get('mode') === 'login' ? 'login' : 'create'} />
        ) : cloud.choice ? (
          <JoinCard />
        ) : (
          <AccountOverview
            session={session}
            // Les dernières modifications partent avant la déconnexion : un autre compte connecté ensuite efface l'appareil.
            beforeSignOut={() => syncCloud().then(() => undefined)}
            rows={[
              {
                label: 'MyFinances',
                detail: syncLine,
                state: cloud.error ? 'error' : cloud.syncing || !cloud.joined ? 'busy' : 'ok',
                action: cloud.joined ? { label: 'Synchroniser', onClick: () => void syncCloud() } : undefined,
              },
            ]}
          />
        )}
      </Reveal>

      {/* Venu de l'accueil avec un compte : on reprend la configuration là où elle en était. */}
      {session && cloud.joined && !onboarded && (
        <Reveal index={1} className="mt-3">
          <Button size="lg" className="w-full" to="/bienvenue?etape=income">
            Continuer la configuration
          </Button>
        </Reveal>
      )}
    </Screen>
  );
}
