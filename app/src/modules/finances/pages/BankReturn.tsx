import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button, EmptyState, Notice, ScreenHeader } from '@mylife/kit';
import { completeBankConnection, parseCallback } from '../bank/connect';
import { canUseRelay, Relay } from '../bank/relay';
import { runBankSync } from '../bank/sync';
import { bankSettings } from '../data/facts';

/**
 * Les anciennes adresses de MyFinances (`/finances/…`), depuis que l'app d'avant est retirée. Une seule a encore un
 * rôle : `/finances/connexion/retour`, l'adresse de retour déclarée auprès d'Enable Banking. La banque y renvoie avec
 * un code ; on termine la connexion ici, puis on part sur l'écran Banques. Toutes les autres renvoient au module.
 */
export function LegacyFinances() {
  const { pathname } = useLocation();
  if (/^\/finances\/connexion\/retour\/?$/.test(pathname)) return <BankReturn />;
  return <Navigate to={pathname.includes('patrimoine') ? '/argent/patrimoine' : '/argent'} replace />;
}

function BankReturn() {
  const [state, setState] = useState<{ status: 'busy' | 'error' | 'done'; message?: string; count?: number }>({ status: 'busy' });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { code, state: authState, error } = parseCallback(window.location.href);
      if (error) return setState({ status: 'error', message: `La banque a refusé ou annulé la connexion (${error}).` });
      if (!code) return setState({ status: 'error', message: 'Ce lien ne contient pas de code de connexion. Relance la connexion depuis l’écran Banques.' });
      try {
        const settings = await bankSettings();
        if (!canUseRelay(settings)) throw new Error('Le relais bancaire n’est pas configuré sur cet appareil. Ouvre MyFinances → Réglages → Banques, puis colle ce lien.');
        const added = await completeBankConnection(new Relay(settings), code, authState);
        setState({ status: 'done', count: added.length });
        void runBankSync().catch(() => undefined);
      } catch (e) {
        setState({ status: 'error', message: (e as Error).message });
      }
    })();
  }, []);
  if (state.status === 'done') return <Navigate to="/argent/banques" replace />;
  return (
    <>
      <ScreenHeader kicker="MyFinances" title="Connexion bancaire" />
      {state.status === 'busy' ? (
        <span className="t-small muted">Connexion à ta banque en cours…</span>
      ) : (
        <>
          <Notice tone="bad">{state.message}</Notice>
          <EmptyState title="La connexion n’a pas abouti" body="Si cette page s’est ouverte dans le navigateur au lieu de l’app installée, copie ce lien, ouvre MyFinances, puis Réglages → Banques → « La banque m’a renvoyé dans le navigateur »." action={<Button href="/argent/banques">Ouvrir Banques</Button>} />
        </>
      )}
    </>
  );
}
