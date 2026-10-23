import { useNavigate } from 'react-router-dom';
import { CommandPalette } from './ui/CommandPalette';
import { rankItems, usePaletteQuery, foldText, type PaletteItem } from './ui/palette';
import { setPaletteOpen } from './ui/paletteStore';

/** Les entrées de l'accueil dans la palette commune ; la palette y ajoute les apps et leurs écrans. */
export function HomePalette() {
  const navigate = useNavigate();
  const q = foldText(usePaletteQuery().trim());
  const go = (to: string) => () => {
    setPaletteOpen(false);
    navigate(to);
  };
  const items: PaletteItem[] = [
    { id: 'h-account', group: 'Aller à', icon: 'person', title: 'Compte MyLife', keywords: 'connexion mot de passe cle secours deconnexion supprimer', run: go('/compte') },
    { id: 'h-look', group: 'Aller à', icon: 'palette', title: 'Apparence', keywords: 'theme couleurs sombre clair identite', run: go('/apparence') },
    { id: 'h-miniapps', group: 'Aller à', icon: 'apps', title: 'Mes apps', keywords: 'creer app sans code suivi habitude lecture sommeil eau humeur tracker modele ia', run: go('/mes-apps') },
    { id: 'h-miniapp-new', group: 'Aller à', icon: 'add', title: 'Créer une app', keywords: 'nouvelle app sans code modele ia', run: go('/mes-apps/nouvelle') },
    { id: 'h-data', group: 'Aller à', icon: 'shield', title: 'Mes données', keywords: 'export rgpd telecharger effacer supprimer support', run: go('/donnees') },
    { id: 'h-privacy', group: 'Aller à', icon: 'lock', title: 'Confidentialité', keywords: 'vie privee mentions legales chiffrement donnees', run: go('/confidentialite') },
    { id: 'h-install', group: 'Aller à', icon: 'phone', title: 'Installer MyLife', keywords: 'telephone ecran accueil application', run: go('/installer') },
  ];
  return <CommandPalette items={q ? rankItems(items, q) : items} />;
}
