# Refonte de MyFinances : journal

Harmoniser le fonctionnement de MyFinances : un seul modèle d'argent, des écrans qui disent la même chose, une
navigation rangée. Une étape à la fois, avec un arrêt pour tester après chacune.

| Étape | État |
|---|---|
| 1. Filet de sécurité (points de restauration) | **fait** (24/10/2026) |
| 2. Un seul modèle d'argent (cycle, argent libre, épargne) | à faire |
| 3. Une seule liste de récurrents (revenus, charges, abonnements, investissements) | à faire |
| 4. Navigation et réglages remis en ordre | à faire |
| 5. Vocabulaire et affichage cohérents | à faire |

## Ce qui ne va pas (constat de départ)
1. **Trois définitions de l'épargne** : montant fixe des réglages, plans et objectifs, virements détectés. Budget,
   prévision et patrimoine ne s'accordent pas (ex. : 500 € prévus, 370 € versés, BTC sauté ce mois : 130 € « à
   verser » réservés à tort, enveloppe trop serrée).
2. **Deux « argent disponible »** qui se contredisent : l'enveloppe ne regarde que les revenus déclarés du cycle,
   pas l'argent déjà sur le compte au début du cycle ; d'où un « déficit » rouge avec 300 € libres.
3. **Charges fixes** : affichées dans le détail du budget mais ignorées par le calcul sans jour de prélèvement (le
   loyer s'affichait sans être compté).
4. **Trois détecteurs de la même chose** (récurrents détectés, lignes des réglages, plans), chacun avec ses règles de
   rapprochement : doublons ou oublis.
5. **Navigation** : Prévision et Récurrents cachés dans Budget ; Banques, Alertes, Assistant, import Trade Republic
   rangés dans Réglages ; le compte à deux endroits.

Choix retenus (24/10/2026) : enveloppe dépassée mais argent libre → l'enveloppe reste le repère, sans rouge ni
« déficit », avec « il te reste X € réellement libres » ; 5 onglets gardés, Prévision et Récurrents visibles dans
Budget, Banques hors des Réglages ; cas réel : virement mensuel vers Trade Republic, BTC occasionnel (« sauter ce
mois »), loyer avec son jour.

---

## Correctif préalable : app figée après avoir reclassé une opération (PC)
- **Cause** : une feuille qui se ferme continuait de capter clics et clavier pendant sa sortie ; une sortie qui
  n'aboutit pas (deux feuilles qui se croisent : opération ouverte depuis le détail du budget) laissait une couche
  invisible sur toute l'app.
- **Correction** (`packages/ui/src/Sheet.tsx`, toutes les apps) : dès le début de la sortie, plus de clics, plus de
  clavier, défilement rendu.
- **Test** : le parcours de MyFinances tourne aussi à 1366 px, avec l'opération ouverte depuis le détail du budget.

## Étape 1 : filet de sécurité

### Pourquoi
Une restauration de sauvegarde ancienne remplaçait tout, avec quelques secondes pour annuler. Avant de toucher au
cœur du calcul, aucun geste ne doit pouvoir perdre des données.

### Comment
- **Points de restauration** (`src/domain/restorePoints.ts`) : copie complète de la base (même format qu'une
  sauvegarde) prise juste avant : restauration d'une sauvegarde, « Tout effacer », suppression de la démo, données du
  compte reprises à la place de celles de l'appareil, retour à un autre point. Rien n'est pris d'une base vide.
- Base à part (`myfinances-restore`) : jamais synchronisée, jamais dans une sauvegarde, effacée quand un autre compte
  se connecte (`forget`). Les 5 plus récents.
- Réglages → Sauvegarde et données → **Points de restauration** : « Revenir ici » (second toucher pour confirmer ; l'état
  d'avant devient lui-même un point), suppression d'un point. Le texte de « Tout effacer » dit qu'une copie reste.

### Fichiers
| Fichier | Rôle |
|---|---|
| `apps/finances/src/domain/restorePoints.ts` | Points : créer, lister, revenir, supprimer |
| `apps/finances/src/pages/settings/RestorePoints.tsx`, `Data.tsx` | Section de la page Données ; points avant chaque remplacement |
| `apps/finances/src/sync/cloud/dexieStore.ts` | Point avant les données du compte ; effacés pour un autre compte |

### Tests
- `tests/restorePoints.test.ts` (4) : sauvegarde ancienne rattrapée (opérations et réglages récents revenus, mot de passe
  du relais de l'appareil gardé), base vide, 5 points au plus, suppression, « Tout effacer » puis retour, synchro
  (point avant reprise, effacés pour un autre compte).
- De bout en bout (3 tailles) : la démo supprimée revient par un point.
- Totaux MyFinances : 341 unitaires, 46 étapes de bout en bout : tout vert.

### Comment tester
Réglages → Sauvegarde et données : exporte une sauvegarde, importe-la, puis « Points de restauration » → « Revenir
ici ».
