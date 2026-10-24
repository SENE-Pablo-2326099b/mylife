import { AccountForms } from '../ui/account';
import { BrandMark, Banner } from '../components/kit';

/**
 * Pas encore connecté : le compte MyLife (le même que l'accueil, MyFinances et MyPerf). Déjà connecté
 * dans une autre app sur ce navigateur ? Cet écran n'apparaît pas.
 */
export function AuthScreen({ expired, invited }: { expired: boolean; invited: boolean }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col gap-3 px-4" style={{ paddingTop: 'calc(var(--safe-top) + 28px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
      <div className="flex items-center gap-3">
        <BrandMark size={52} />
        <div>
          <h1 className="t-large">MyRave</h1>
          <p className="t-small text-secondary">Retrouver ses amis dans la foule.</p>
        </div>
      </div>
      {expired && (
        <Banner tone="warning" icon="warning">
          Session expirée : reconnecte-toi. Ton partage de position est suspendu en attendant.
        </Banner>
      )}
      {invited && (
        <Banner tone="info" icon="people">
          Tu as reçu une invitation. Crée ton compte MyLife ou connecte-toi pour rejoindre le groupe.
        </Banner>
      )}
      <AccountForms initial={expired ? 'login' : 'create'} />
    </main>
  );
}
