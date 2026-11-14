import type { ReactNode } from 'react';
import { Button, Glass } from '@mylife/kit';
import { useLogin } from '../store';

/**
 * Confidentialité et mentions légales, lisibles sans compte. Écrites à partir de ce que le serveur stocke
 * réellement (server/*.ts) ; à relire par l’éditeur à chaque nouveau type de donnée.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Glass as="section" className="pad stack">
      <h2 className="panel-title">{title}</h2>
      <div className="t-small muted stack" style={{ gap: 8 }}>{children}</div>
    </Glass>
  );
}

const Strong = ({ children }: { children: ReactNode }) => <strong style={{ color: 'var(--ink)' }}>{children}</strong>;

export function PrivacyPage() {
  const login = useLogin();
  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <span className="t-label" style={{ color: 'var(--tone, var(--ink-2))' }}>Confidentialité</span>
        <h1 className="t-screen">Tes données restent à toi</h1>
        <p className="t-body muted" style={{ margin: 0 }}>MyLife chiffre tes données sur ton appareil avant qu’elles le quittent. Le serveur ne range que des blocs illisibles : personne d’autre que toi ne peut les lire, pas même nous.</p>
      </div>
      <Section title="Ce que le serveur garde">
        <p style={{ margin: 0 }}><Strong>Ton compte</Strong> : ton identifiant (en clair, pour te reconnaître), la date de création, des empreintes de ton mot de passe et de ta clé de secours (jamais le mot de passe lui-même) et ta clé de données « emballée » (illisible sans ton mot de passe ou ta clé de secours).</p>
        <p style={{ margin: 0 }}><Strong>Tes données</Strong> (budget, séances, réglages) : chiffrées en AES-256-GCM sur ton appareil. Le serveur voit seulement leur taille, leur date et à quel module elles appartiennent.</p>
        <p style={{ margin: 0 }}><Strong>Groupes et Sorties</Strong> : noms, pseudos, positions, réponses, dépenses sont chiffrés avec une clé de groupe qui voyage dans le lien d’invitation (jamais envoyée au serveur). Le serveur sait seulement qui est membre de quoi. Les positions de MyRave sont effacées à l’arrêt du partage (12 h au plus) ; un groupe expiré est effacé entièrement.</p>
        <p style={{ margin: 0 }}><Strong>Garde-fous contre les abus</Strong> : des compteurs de tentatives (connexion, inscription), dont une empreinte de ton adresse réseau (pas l’adresse elle-même), effacés au bout de deux jours.</p>
        <p style={{ margin: 0 }}><Strong>Messages au support</Strong> : si tu nous écris, ton message est lisible par l’équipe MyLife (il n’est pas chiffré), lié à ton compte, et effacé une fois traité (90 jours au plus).</p>
      </Section>
      <Section title="Ce qui reste sur ton appareil">
        <p style={{ margin: 0 }}>Ta session, tes clés, les aperçus de l’accueil, ta conversation avec Copilot, ta clé d’API Anthropic, le contenu de tes exports. Rien de tout ça n’est envoyé. Si un autre compte se connecte sur l’appareil, tout est effacé.</p>
      </Section>
      <Section title="Services utilisés">
        <p style={{ margin: 0 }}><Strong>Vercel</Strong> (hébergement de l’app et du serveur) et <Strong>Neon</Strong> (base de données) : ils ne reçoivent que ce que le serveur garde, décrit plus haut.</p>
        <p style={{ margin: 0 }}><Strong>Anthropic</Strong> (assistant de MyFinances, coach de MyPerf, Copilot) : seulement si tu utilises une de ces fonctions, avec ta propre clé, directement depuis ton appareil. Ta question et les résumés utiles partent alors chez Anthropic.</p>
        <p style={{ margin: 0 }}><Strong>Enable Banking</Strong> (synchronisation bancaire de MyFinances, en lecture seule) : seulement si tu l’actives.</p>
      </Section>
      <Section title="Aucun pistage">
        <p style={{ margin: 0 }}>Pas de publicité, pas de traceur, pas d’analytique, pas de cookie publicitaire. Le stockage du navigateur sert seulement à faire marcher l’app (aucun bandeau de consentement n’est donc nécessaire).</p>
      </Section>
      <Section title="Tes droits">
        <p style={{ margin: 0 }}><Strong>Voir et emporter</Strong> : « Tes données » exporte ce que MyLife sait de toi, en fichiers lisibles. <Strong>Corriger</Strong> : directement dans les modules. <Strong>Effacer</Strong> : « Supprimer mon compte » efface tout ce que le serveur garde, tout de suite.</p>
        <p style={{ margin: 0 }}>Une question sur tes données : écris-nous depuis l’app (Tes données → « Un problème, une idée ? »). Tu peux aussi saisir la CNIL (cnil.fr).</p>
        <p style={{ margin: 0 }}>Conservation : tant que ton compte existe. Un compte supprimé est effacé immédiatement ; les sauvegardes de l’hébergeur suivent leur propre cycle.</p>
      </Section>
      <Section title="Mentions légales">
        <p style={{ margin: 0 }}>Éditeur : un particulier ; son identité est communiquée à l’hébergeur (article 6, III, 2° de la loi pour la confiance dans l’économie numérique).</p>
        <p style={{ margin: 0 }}>Hébergeur : Vercel Inc., États-Unis (vercel.com).</p>
      </Section>
      {!login && <Button href="/bienvenue">Retour à l’accueil</Button>}
    </>
  );
}
