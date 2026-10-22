// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { Component, type ReactNode } from 'react';
import { isStaleChunk, logError, reloadForNewVersion } from './errorLog';
import { Button, EmptyState } from './primitives';

/**
 * Un écran qui plante n'emporte pas l'app : message, retour possible, erreur gardée dans le journal local.
 * `resetKey` (l'adresse) efface l'erreur quand on change d'écran.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    if (isStaleChunk(error) && reloadForNewVersion()) return;
    logError('écran', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunk(error);
    return (
      <div className="mx-auto max-w-content px-4 pt-16">
        <EmptyState
          icon="alert-circle"
          title={stale ? 'Une nouvelle version est arrivée' : 'Cet écran a rencontré un problème'}
          body={stale ? 'Recharge pour la charger.' : 'Tes données ne sont pas touchées. L’erreur est notée dans Réglages → Sauvegarde et données.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => location.reload()}>Recharger</Button>
              {!stale && (
                <Button variant="secondary" onClick={() => history.back()}>
                  Retour
                </Button>
              )}
            </div>
          }
        />
      </div>
    );
  }
}
