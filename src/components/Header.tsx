import { useObservable } from '../lib/observable';
import { app } from '../state/app';
import { HeaderActions } from '../ui/HeaderActions';
import { IconButton } from '../ui/index';
import type { SpaceRow } from '../ui/Spaces';
import { setBeacon } from './Beacon';

/**
 * En-tête commun de MyLife avec ce qui est propre à myRaveLoc : le mode phare à gauche, et dans les
 * Espaces l'état de mon partage de position.
 */
export function RavelocHeader() {
  const s = useObservable(app);
  const sharing = s.groups.list.filter((g) => g.sharing !== 'off');
  const on = sharing.filter((g) => g.sharing === 'on');
  const blocked = on.some((g) => s.transmission[g.id]?.blocked);
  const row: SpaceRow = {
    id: 'share',
    label: 'Ma position',
    detail: on.length ? `Partagée avec ${on.length > 1 ? `${on.length} groupes` : (on[0]!.name ?? 'un groupe')}` : sharing.length ? 'Partage en pause' : 'Pas partagée',
    state: blocked ? 'error' : on.length ? 'ok' : 'off',
    to: '/',
  };
  return (
    <HeaderActions
      appAction={<IconButton icon="beacon" label="Mode phare" glass onClick={() => setBeacon(true)} />}
      rows={[row]}
      shortcuts={[
        { label: 'Groupes', icon: 'people', to: '/groupes' },
        { label: 'Nouveau', icon: 'add', to: '/groupes/nouveau' },
        { label: 'Compte', icon: 'person', to: '/compte' },
      ]}
      accountPath="/compte"
    />
  );
}
