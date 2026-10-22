// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import type { ReactNode } from 'react';
import { MYLIFE_APPS } from '../vendor/lumen';
import { AccountForms } from './account';
import { kitApp } from './app';
import { Icon, type IconName } from './icons';
import { useSession } from './session';

const ICON: Record<string, IconName> = { finances: 'diamond-fill', perf: 'barbell', raveloc: 'navigate' };

/**
 * Pas de compte, pas d'app : tant qu'aucune session MyLife n'est ouverte, l'app n'affiche que la création
 * de compte (ou la connexion). Même règle dans les quatre parties de MyLife : un nouvel utilisateur n'a pas
 * d'autre choix que de créer son compte, et ne voit jamais les données de quelqu'un d'autre. La session est
 * gardée sur l'appareil : une fois connecté, l'app s'ouvre ensuite sans réseau.
 */
export function AccountGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session) return <>{children}</>;
  const app = kitApp();
  const meta = MYLIFE_APPS.find((a) => a.id === app.id);
  return (
    <main id="contenu" className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col gap-4 px-4" style={{ paddingTop: 'calc(var(--safe-top) + 28px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
      <div className="flex items-center gap-3">
        <span
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[16px] text-white"
          style={{ background: `linear-gradient(150deg, ${meta?.colors[0] ?? '#F5C451'}, ${meta?.colors[1] ?? '#8B5CFF'})` }}
          aria-hidden
        >
          <Icon name={ICON[app.id] ?? 'sparkles'} size={28} />
        </span>
        <div>
          <h1 className="t-large">{app.name}</h1>
          <p className="t-small text-secondary">{app.tagline}</p>
        </div>
      </div>
      <AccountForms initial="create" />
    </main>
  );
}
