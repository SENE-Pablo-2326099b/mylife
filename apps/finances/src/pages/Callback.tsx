import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings } from '../db/seed';
import { BASE_PATH } from '../lib/app';
import { completeBankConnection, getPendingAuth, parseCallback } from '../sync/connect';
import { canUseRelay, ebClientFor } from '../sync/ebClient';
import { runSync } from '../sync/store';
import { Button, Card, EmptyState } from '../ui/index';
import { Orb } from '../ui/extras';
import { Screen } from '../ui/Screen';

type Phase = { kind: 'working' } | { kind: 'error'; message: string } | { kind: 'foreign' } | { kind: 'done'; count: number };

export default function CallbackPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const finish = async () => {
    const { code, state, error } = parseCallback(window.location.href);
    if (error) return setPhase({ kind: 'error', message: `La banque a refusé ou annulé l’accès (${error}).` });
    if (!code) return setPhase({ kind: 'error', message: 'Aucun code d’autorisation dans le lien de retour.' });
    const settings = await getSettings();
    if (!canUseRelay(settings)) return setPhase({ kind: 'foreign' });
    try {
      const accounts = await completeBankConnection(ebClientFor(settings), code, state);
      window.history.replaceState(null, '', `${BASE_PATH}/connexion/retour`);
      setPhase({ kind: 'done', count: accounts.length });
      await runSync();
      navigate('/synchro', { replace: true });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // Si la connexion n'a pas été lancée depuis ce navigateur (ex. app installée sur iPhone),
      // on ne consomme pas le code ici : il doit être collé dans l'app.
      const pending = await getPendingAuth();
      const { state } = parseCallback(window.location.href);
      if (!pending || (state && pending.state !== state)) return setPhase({ kind: 'foreign' });
      await finish();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen stack title="Connexion bancaire" mood="focus" back="/synchro">
      <Card level="raised">
        {phase.kind === 'working' && <EmptyState icon="sync" title="Finalisation de la connexion…" />}
        {phase.kind === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Orb trigger={phase.count} />
            <p className="t-title">{phase.count} compte(s) connecté(s)</p>
            <p className="t-body text-secondary">Première synchronisation en cours…</p>
          </div>
        )}
        {phase.kind === 'error' && <EmptyState icon="alert-circle" title="Connexion impossible" body={phase.message} action={<Button to="/synchro" variant="secondary">Retour aux banques</Button>} />}
        {phase.kind === 'foreign' && (
          <EmptyState
            icon="swap"
            title="Ouvert hors de l’app"
            body="Cette page s’est ouverte dans un autre contexte que celui de la connexion (souvent : le navigateur au lieu de l’app installée). Copie ce lien, ouvre l’app, puis Banques → « La banque m’a renvoyé dans le navigateur »."
            action={
              <>
                <Button onClick={() => void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true))}>{copied ? 'Lien copié' : 'Copier le lien'}</Button>
                <Button variant="secondary" onClick={() => void finish()}>
                  Terminer ici
                </Button>
              </>
            }
          />
        )}
      </Card>
    </Screen>
  );
}
