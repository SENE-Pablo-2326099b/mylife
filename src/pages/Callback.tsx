import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, PageTitle } from '../components/ui';
import { getSettings } from '../db/seed';
import { completeBankConnection, getPendingAuth, parseCallback } from '../sync/connect';
import { EbClient } from '../sync/ebClient';
import { runSync } from '../sync/store';

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
    if (!settings.bridgePassword) return setPhase({ kind: 'foreign' });
    try {
      const accounts = await completeBankConnection(new EbClient(settings.bridgePassword), code, state);
      window.history.replaceState(null, '', '/connexion/retour');
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
    <div className="space-y-4">
      <PageTitle>Connexion bancaire</PageTitle>
      {phase.kind === 'working' && <Card>Finalisation de la connexion…</Card>}
      {phase.kind === 'done' && <Card>{phase.count} compte(s) connecté(s). Première synchronisation en cours…</Card>}
      {phase.kind === 'error' && (
        <Card>
          <p className="text-bad">{phase.message}</p>
          <Link to="/synchro" className="mt-3 inline-block text-accent underline">
            Retour à la synchronisation
          </Link>
        </Card>
      )}
      {phase.kind === 'foreign' && (
        <Card>
          <p>Cette page s’est ouverte dans un autre contexte que celui où tu as lancé la connexion (souvent : navigateur au lieu de l’app installée).</p>
          <p className="mt-2 text-sm text-muted">Copie ce lien, ouvre Budget Dodge, puis Synchro → « La banque m’a renvoyé dans le navigateur » et colle-le.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
              }}
            >
              {copied ? 'Lien copié ✓' : 'Copier le lien'}
            </Button>
            <Button variant="ghost" onClick={() => void finish()}>
              Terminer dans ce navigateur
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
