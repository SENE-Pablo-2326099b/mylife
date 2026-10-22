import { useEffect, useState } from 'react';
import { formatDateTime } from '../ui/relative';
import { cloudAccountStatus, cloudJoin, downloadLocalCopy, localItemCount, syncCloud, useCloud } from '../sync/cloud';
import { errorText } from '../ui/session';
import { Button, Card, toast } from '../ui/index';

/**
 * Première synchro d'un appareil qui a déjà des données saisies hors de tout compte. Compte neuf : partir
 * de zéro (proposé d'abord : un compte neuf ne reprend rien de l'appareil sans qu'on le demande) ou y mettre
 * ces données. Compte rempli : garder l'un ou l'autre (jamais de fusion). Une copie de sécurité est
 * téléchargée avant d'effacer quoi que ce soit.
 */
export function JoinCard() {
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

  const run = async (mode: 'useAccount' | 'useDevice') => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'useAccount') await downloadLocalCopy();
      const r = await cloudJoin(mode);
      toast({
        message: r.action === 'uploaded' ? `Données envoyées (chiffrées) : ${r.count} éléments` : r.count === 0 ? 'C’est parti, de zéro' : `Données du compte récupérées : ${r.count} éléments`,
        tone: 'gold',
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="raised">
      {!status && !error && (
        <>
          <p className="t-headline">Synchroniser cet appareil</p>
          <p className="t-small mt-2 text-secondary">Lecture du compte…</p>
        </>
      )}
      {status && status.count === 0 && (
        <>
          <p className="t-headline">Ton compte est neuf</p>
          <p className="t-small mt-2 text-secondary">
            Cet appareil contient déjà des données MyFinances ({local ?? '…'} éléments), reliées à aucun compte. Ton compte part de zéro, sauf si ces données sont les tiennes.
          </p>
          <Button className="mt-3 w-full" icon="sparkles" disabled={busy} onClick={() => void run('useAccount')}>
            {busy ? 'Préparation…' : 'Partir de zéro'}
          </Button>
          <p className="t-caption mt-1 text-muted">Les données de cet appareil sont effacées (s’il y a des opérations, une copie de sécurité est d’abord téléchargée).</p>
          <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => void run('useDevice')}>
            Ce sont les miennes : les mettre dans mon compte
          </Button>
        </>
      )}
      {status && status.count > 0 && (
        <>
          <p className="t-headline">Synchroniser cet appareil</p>
          <p className="t-small mt-2 text-secondary">
            <strong className="text-ink">
              Cet appareil : {local ?? '…'} éléments · ton compte : {status.count} éléments
            </strong>
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

/** Connecté, appareil pas encore relié au compte : préparation (ou erreur), ou le choix des données à garder. */
export function Linking() {
  const cloud = useCloud();
  if (cloud.choice) return <JoinCard />;
  return (
    <Card level="raised" aria-live="polite">
      <p className="t-headline">{cloud.error ? 'Ton espace n’est pas prêt' : 'Préparation de ton espace…'}</p>
      <p className="t-small mt-2 text-secondary">{cloud.error ?? `Connecté en tant que ${cloud.session?.login ?? ''}. Récupération de tes données, chiffrées.`}</p>
      {cloud.error && (
        <Button className="mt-3 w-full" icon="sync" disabled={cloud.syncing} onClick={() => void syncCloud()}>
          {cloud.syncing ? 'Nouvel essai…' : 'Réessayer'}
        </Button>
      )}
    </Card>
  );
}
