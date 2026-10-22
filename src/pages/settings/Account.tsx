import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../../hooks';
import { formatDateTime, relativeTime } from '../../ui/relative';
import { cloudAccountStatus, cloudJoin, downloadLocalCopy, localItemCount, syncCloud, useCloud } from '../../sync/cloud';
import { AccountForms, AccountOverview } from '../../ui/account';
import { errorText, useSession } from '../../ui/session';
import { Button, Card, Reveal, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';

/** Première synchro de cet appareil : envoyer ses données, ou prendre celles du compte. */
function JoinCard() {
  const [status, setStatus] = useState<{ count: number; lastUpdated: number | null } | null>(null);
  const [local, setLocal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cloudAccountStatus().then(setStatus, (e: unknown) => setError(errorText(e)));
    void localItemCount().then(setLocal);
  }, []);
  // L'appareil le plus complet est proposé en premier : on ne remplace jamais de vraies données par du vide.
  const deviceRicher = status !== null && local !== null && local > status.count;

  const run = async (mode: 'auto' | 'useAccount' | 'useDevice') => {
    setBusy(true);
    setError(null);
    try {
      if (mode !== 'useDevice' && status && status.count > 0) await downloadLocalCopy();
      const r = await cloudJoin(mode);
      toast({ message: r.action === 'uploaded' ? `Données envoyées (chiffrées) : ${r.count} éléments` : `Données du compte récupérées : ${r.count} éléments`, tone: 'gold' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="raised">
      <p className="t-headline">Synchroniser cet appareil</p>
      {!status && !error && <p className="t-small mt-2 text-secondary">Lecture du compte…</p>}
      {status && status.count === 0 && (
        <>
          <p className="t-small mt-2 text-secondary">Ton compte ne contient encore rien pour MyFinances : les données de cet appareil vont y être envoyées, chiffrées. Tes autres appareils les récupéreront.</p>
          <Button className="mt-3 w-full" icon="upload" disabled={busy} onClick={() => void run('auto')}>
            {busy ? 'Envoi…' : 'Envoyer mes données'}
          </Button>
        </>
      )}
      {status && status.count > 0 && (
        <>
          <p className="t-small mt-2 text-secondary">
            <strong className="text-ink">Cet appareil : {local ?? '…'} éléments · ton compte : {status.count} éléments</strong>
            {status.lastUpdated ? ` (modifiés le ${formatDateTime(new Date(status.lastUpdated).toISOString())})` : ''}. Un seul des deux est gardé, puis tous tes appareils le partagent.
          </p>
          {deviceRicher ? (
            <>
              <p className="t-small mt-2 text-secondary">Cet appareil a plus de données que le compte : garde-les (elles remplaceront celles du compte).</p>
              <Button className="mt-3 w-full" icon="upload" disabled={busy} onClick={() => void run('useDevice')}>
                {busy ? 'Envoi…' : 'Garder les données de cet appareil'}
              </Button>
              <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => void run('useAccount')}>
                Prendre quand même celles du compte (copie de sécurité téléchargée)
              </Button>
            </>
          ) : (
            <>
              <Button className="mt-3 w-full" icon="download" disabled={busy} onClick={() => void run('useAccount')}>
                {busy ? 'Récupération…' : 'Récupérer les données du compte'}
              </Button>
              <p className="t-caption mt-1 text-muted">Une copie des données de cet appareil est d’abord téléchargée, par sécurité.</p>
              <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => void run('useDevice')}>
                Garder plutôt celles de cet appareil (remplace le compte)
              </Button>
            </>
          )}
        </>
      )}
      {error && <p className="t-small mt-2 text-danger">{error}</p>}
    </Card>
  );
}

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
