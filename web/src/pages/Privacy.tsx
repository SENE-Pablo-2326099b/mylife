import { useNavigate } from 'react-router-dom';
import { HOME_APPS } from '../vendor/lumen';
import { Icon } from '../ui/icons';
import { Button, Card } from '../ui/index';
import { useSession } from '../ui/session';

/**
 * Confidentialité et mentions légales, lisibles sans compte (/confidentialite). Écrite à partir de ce que le
 * serveur stocke réellement (server/*.ts) ; à relire par l'éditeur avant l'ouverture au public.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="t-headline">{title}</h2>
      <div className="t-small mt-2 flex flex-col gap-2 text-secondary">{children}</div>
    </Card>
  );
}

export function PrivacyPage() {
  const navigate = useNavigate();
  const session = useSession();
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4" style={{ paddingTop: 'calc(var(--safe-top) + 20px)', paddingBottom: 'calc(var(--safe-bottom) + 32px)' }}>
      <button type="button" onClick={() => navigate(session ? '/' : '/bienvenue')} className="flex h-11 w-11 items-center justify-center rounded-full" aria-label="Retour">
        <Icon name="chevron-back" size={22} />
      </button>
      <p className="t-label text-gold">Confidentialité</p>
      <h1 className="t-large">Tes données restent à toi</h1>
      <p className="t-body text-secondary">MyLife chiffre tes données sur ton appareil avant qu’elles le quittent. Le serveur ne range que des blocs illisibles : personne d’autre que toi ne peut les lire, pas même nous.</p>

      <Section title="Ce que le serveur garde">
        <p>
          <strong className="text-ink">Ton compte</strong> : ton identifiant (en clair, pour te reconnaître), la date de création, des empreintes de ton mot de passe et de ta clé de secours (jamais le mot de passe lui-même) et ta clé de données « emballée » (illisible sans ton mot de passe ou ta clé de secours).
        </p>
        <p>
          <strong className="text-ink">Tes données</strong> (budget, séances, réglages, Personnage, {HOME_APPS.filter((a) => !('spaces' in a.sync)).map((a) => a.privacy).join(', ')}) : chiffrées en AES-256-GCM sur ton appareil. Le serveur voit seulement leur taille, leur date et à quelle app elles appartiennent.
        </p>
        <p>
          <strong className="text-ink">Groupes, Crews et Sorties</strong> : noms, pseudos, positions, scores, réponses, dépenses sont chiffrés avec une clé de groupe qui voyage dans le lien d’invitation (jamais envoyée au serveur). Le serveur sait seulement qui est membre de quoi. Les positions de MyRave sont effacées à l’arrêt du partage (12 h au plus) ; un groupe expiré est effacé entièrement.
        </p>
        <p>
          <strong className="text-ink">Garde-fous contre les abus</strong> : des compteurs de tentatives (connexion, inscription), dont une empreinte de ton adresse réseau (pas l’adresse elle-même), effacés au bout de deux jours.
        </p>
        <p>
          <strong className="text-ink">Messages au support</strong> : si tu nous écris, ton message est lisible par l’équipe MyLife (il n’est pas chiffré), lié à ton compte, et effacé une fois traité (90 jours au plus).
        </p>
      </Section>

      <Section title="Ce qui reste sur ton appareil">
        <p>Ta session, tes clés, les aperçus de l’accueil, ta conversation avec Copilot, ta clé d’API Anthropic, le contenu de tes exports. Rien de tout ça n’est envoyé. Si un autre compte se connecte sur l’appareil, tout est effacé.</p>
      </Section>

      <Section title="Services utilisés">
        <p>
          <strong className="text-ink">Vercel</strong> (hébergement de l’app et du serveur) et <strong className="text-ink">Neon</strong> (base de données) : ils ne reçoivent que ce que le serveur garde, décrit plus haut.
        </p>
        <p>
          <strong className="text-ink">Anthropic</strong> (assistant de MyFinances, coach de MyPerf, Copilot) : seulement si tu utilises une de ces fonctions, avec ta propre clé, directement depuis ton appareil. Ta question et les résumés utiles partent alors chez Anthropic.
        </p>
        <p>
          <strong className="text-ink">Enable Banking</strong> (synchronisation bancaire de MyFinances, en lecture seule) et <strong className="text-ink">Steam</strong> (MyGames) : seulement si tu les actives. Le relais Steam ne garde rien.
        </p>
        <p>Ton export Spotify est lu sur ton appareil : il n’est envoyé nulle part.</p>
      </Section>

      <Section title="Aucun pistage">
        <p>Pas de publicité, pas de traceur, pas d’analytique, pas de cookie publicitaire. Le stockage du navigateur sert seulement à faire marcher l’app (aucun bandeau de consentement n’est donc nécessaire).</p>
      </Section>

      <Section title="Tes droits">
        <p>
          <strong className="text-ink">Voir et emporter</strong> : « Mes données » exporte ce que MyLife sait de toi, en fichiers lisibles. <strong className="text-ink">Corriger</strong> : directement dans les apps. <strong className="text-ink">Effacer</strong> : « Supprimer mon compte » efface tout ce que le serveur garde, tout de suite.
        </p>
        <p>Une question sur tes données : écris-nous depuis l’app (Compte → « Un problème, une idée ? »). Tu peux aussi saisir la CNIL (cnil.fr).</p>
        <p>Conservation : tant que ton compte existe. Un compte supprimé est effacé immédiatement ; les sauvegardes de l’hébergeur suivent son propre cycle.</p>
      </Section>

      <Section title="Mentions légales">
        <p>Éditeur : un particulier ; son identité est communiquée à l’hébergeur (article 6, III, 2° de la loi pour la confiance dans l’économie numérique).</p>
        <p>Hébergeur : Vercel Inc., États-Unis (vercel.com).</p>
      </Section>

      {!session && (
        <Button className="mt-2" onClick={() => navigate('/bienvenue')}>
          Retour à l’accueil
        </Button>
      )}
    </main>
  );
}
