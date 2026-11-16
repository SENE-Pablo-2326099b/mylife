import { useState } from 'react';
import { Button, EmptyState } from '@mylife/kit';
import type { Engine } from '../data/engineStore';
import { addAccount } from '../engine/state';
import { AccountSheet } from './sheets';

/** Premier lancement : rien sur cet appareil ni dans le compte. Deux façons de commencer. */
export function Welcome({ engine }: { engine: Engine }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EmptyState
        title="Bienvenue dans MyFinances"
        body="Relie ta banque : tes opérations arrivent toutes seules. Ou commence à la main, avec un compte dont tu saisis le solde."
        action={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="action" href="/argent/banques">
              Relier ma banque
            </Button>
            <Button onClick={() => setCreating(true)}>Commencer à la main</Button>
          </div>
        }
      />
      <AccountSheet
        value={creating ? 'new' : null}
        onClose={() => setCreating(false)}
        onPatch={() => undefined}
        onCreate={(a) => {
          setCreating(false);
          void engine.begin((s) => addAccount(s, a));
        }}
      />
    </>
  );
}
