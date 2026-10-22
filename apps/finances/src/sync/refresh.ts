import { refreshQuotes } from '../domain/wealthDb';
import { toast } from '../ui/toastStore';
import { runSync, useSyncState } from './store';

/** Tirer pour actualiser : banques puis cours des placements, avec un mot sur ce qui est arrivé. */
export async function refreshEverything(): Promise<void> {
  const reports = await runSync();
  await refreshQuotes({ force: true }).catch(() => undefined);
  if (reports) {
    const added = reports.reduce((s, r) => s + r.added, 0);
    toast({ message: added ? `${added} nouvelle${added > 1 ? 's' : ''} opération${added > 1 ? 's' : ''}` : 'Tout est à jour' });
  }
}

export { useSyncState };
