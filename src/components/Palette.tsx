import { useNavigate } from 'react-router-dom';
import { useObservable } from '../lib/observable';
import { app, setActive } from '../state/app';
import { CommandPalette } from '../ui/CommandPalette';
import { foldText, rankItems, usePaletteQuery, type PaletteItem } from '../ui/palette';
import { setPaletteOpen } from '../ui/paletteStore';
import { setBeacon } from './Beacon';

/** Les entrées de myRaveLoc dans la palette commune : écrans, actions, amis et groupes. */
export function RavelocPalette() {
  const navigate = useNavigate();
  const s = useObservable(app);
  const q = foldText(usePaletteQuery().trim());
  const go = (to: string) => () => {
    setPaletteOpen(false);
    navigate(to);
  };
  const actions: PaletteItem[] = [
    { id: 'r-find', group: 'Actions', icon: 'navigate', title: 'Retrouver un ami', keywords: 'fleche distance position', run: go('/') },
    { id: 'r-new', group: 'Actions', icon: 'add', title: 'Nouveau groupe', keywords: 'creer festival soiree concert', run: go('/groupes/nouveau') },
    { id: 'r-invite', group: 'Actions', icon: 'link', title: 'Inviter des amis', keywords: 'lien partager invitation', run: go('/groupe') },
    {
      id: 'r-beacon',
      group: 'Actions',
      icon: 'beacon',
      title: 'Mode phare',
      keywords: 'lumiere ecran reperer foule',
      run: () => {
        setPaletteOpen(false);
        setBeacon(true);
      },
    },
    { id: 'r-groups', group: 'Aller à', icon: 'people', title: 'Mes groupes', keywords: 'liste rejoindre', run: go('/groupes') },
    { id: 'r-account', group: 'Aller à', icon: 'person', title: 'Compte MyLife', keywords: 'connexion deconnexion cle secours', run: go('/compte') },
  ];
  const friends: PaletteItem[] =
    s.live?.members
      .filter((m) => !m.me)
      .map((m) => ({ id: `f-${m.uid}`, group: 'Amis', icon: 'person', title: m.name ?? 'Membre', hint: 'Retrouver avec la flèche', run: go(`/ami/${m.uid}`) })) ?? [];
  const groups: PaletteItem[] = s.groups.list.map((g) => ({
    id: `g-${g.id}`,
    group: 'Groupes',
    icon: 'people',
    title: g.name ?? 'Groupe',
    hint: `${g.members} membre${g.members > 1 ? 's' : ''}`,
    run: () => {
      setActive(g.id);
      go('/')();
    },
  }));
  const items = q ? rankItems([...actions, ...friends, ...groups], q) : actions;
  return <CommandPalette items={items} placeholder="Chercher un ami, un groupe, agir…" />;
}
