import type { Space } from './vendor/mylife-sync';
import { CREW_URL, client, loadCrews } from './crew';
import { forgetSpace } from './spaceSync';
import { toast } from './ui/toastStore';

/**
 * Le foyer : un espace chiffré de genre « liste », partagé par MyChef (la liste de courses) et MyFoyer (dépenses
 * communes, corvées, factures). Un seul par compte (le premier), créé ici, rejoint par un lien d'invitation.
 */
export async function createFoyer(uid: string, login: string): Promise<Space> {
  const c = client();
  if (!c) throw new Error('Connecte-toi d’abord.');
  const pseudo = login.charAt(0).toUpperCase() + login.slice(1);
  const space = await c.create('liste', 'Foyer', pseudo, uid);
  await loadCrews();
  return space;
}

export async function inviteFoyer(space: Space): Promise<string> {
  const c = client();
  if (!c) throw new Error('Connecte-toi d’abord.');
  const r = await c.invite(space, CREW_URL());
  await shareInvite(r.link);
  return r.link;
}

export async function leaveFoyer(space: Space): Promise<void> {
  const c = client();
  if (!c) return;
  await c.leave(space);
  forgetSpace(space.id);
  await loadCrews();
}

async function shareInvite(link: string): Promise<void> {
  if (navigator.share) {
    try {
      return await navigator.share({ title: 'Notre foyer sur MyLife', text: 'Rejoins notre foyer : courses, dépenses communes, corvées', url: link });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast({ message: 'Lien copié : envoie-le à ton foyer', tone: 'gold' });
  } catch {
    toast({ message: 'Copie impossible : sélectionne le lien affiché' });
  }
}
