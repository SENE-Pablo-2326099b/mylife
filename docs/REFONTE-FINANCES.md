# Refonte de MyFinances : journal

Harmoniser le fonctionnement de MyFinances : un seul modèle d'argent, des écrans qui disent la même chose, une
navigation rangée. Une étape à la fois, avec un arrêt pour tester après chacune.

| Étape | État |
|---|---|
| 1. Filet de sécurité (points de restauration) | **fait** (24/10/2026) |
| 2. Un seul modèle d'argent (cycle, argent libre, épargne) | **fait** (24/10/2026) |
| 3. Une seule liste de récurrents (revenus, charges, abonnements, investissements) | **fait** (24/10/2026) |
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

---

## Étape 2 : un seul modèle d'argent

### Pourquoi
Ton cas du 22 octobre : un « déficit » rouge de 60 € avec 300 € libres sur le compte, 130 € d'épargne réservés alors que
le BTC était sauté ce mois, et un loyer affiché mais pas compté. Trois causes : trois définitions de l'épargne, une
enveloppe qui ignore l'argent déjà sur le compte, et une charge sans jour de prélèvement invisible pour le calcul.

### Comment (décisions)
- **Un seul module** (`src/domain/budgetEngine.ts`) : Aujourd'hui, Budget (cycles passés), alertes, Personnage
  (Discipline), assistant, Patrimoine, Indépendance financière et l'accueil lisent les mêmes fonctions.
- **Épargne du cycle** (`cycleSavings`) : **prévue** = le réglage (montant fixe, ou plans et objectifs ; une seule
  définition, `plannedSavings`, partout) ; **versée** = opérations du cycle classées « Épargne & investissement ».
  L'enveloppe retire **le plus grand des deux** : l'argent prévu pour l'épargne ne se dépense pas, et ce qui a été versé
  en plus est bien sorti. Reste à verser = prévu − versé, réservé sur l'argent réel.
- **« C'est tout pour ce cycle »** (détail du calcul, sous la ligne Épargne) : seul le versé compte, plus rien n'est
  réservé. Pour un achat occasionnel sauté ce mois (ton BTC). Annulable, synchronisé entre appareils (`savingsClosed`).
  L'étape 3 permettra de sauter un plan précis.
- **Charges fixes** : une charge des réglages pas encore débitée est **toujours réservée**, même sans jour de prélèvement
  (« d'ici la paie »), sauf si la prévision la compte déjà (même montant à 20 % près, ou libellé qui la cite).
- **Enveloppe dépassée mais argent libre** (choix du 24/10) : l'enveloppe reste le repère (budget du jour à 0 €), mais ce
  n'est plus un « déficit ». Pas de rouge : « Au-delà de l'enveloppe » et « il te reste X € réellement libres d'ici la
  paie, charges et épargne mises de côté ». Le rouge reste quand l'argent réel manque vraiment.
- **Argent du début de cycle** : le détail dit ce que tes comptes du quotidien contenaient déjà au début du cycle, ce qui
  explique un argent libre plus haut que l'enveloppe.
- **Discipline** (Personnage) : « épargne tenue » = versé ≥ prévu, même règle que le budget.

### Fichiers
| Fichier | Rôle |
|---|---|
| `src/domain/budgetEngine.ts` | `cycleSavings`, enveloppe avec l'épargne du cycle, charges sans jour réservées, `overrun.covered`, `cash.atStart` |
| `src/domain/useBudget.ts` | `savingsClosed` (« c'est tout pour ce cycle »), comptes du quotidien passés au moteur |
| `src/sync/cloud/dexieStore.ts` | `savingsClosed` synchronisé |
| `src/domain/rpgStats.ts`, `useRpgStats.ts`, `alerts.ts`, `useAlerts.ts` | Même modèle (épargne tenue, enveloppe des cycles) |
| `src/pages/Today.tsx` | Dépassement couvert sans rouge, aperçu de l'accueil, fiche Copilot (épargne prévue, versée, restante) |
| `src/components/BudgetExplainer.tsx` | Épargne prévue et versée, « C'est tout pour ce cycle », charges « d'ici la paie », argent du début de cycle |
| `src/assistant/tools.ts`, `pages/Assistant.tsx`, `pages/wealth/Wealth.tsx`, `pages/insights/Fire.tsx`, `pages/Onboarding.tsx` | Une seule définition de l'épargne prévue ; l'assistant voit l'épargne du cycle, l'argent libre et les réservations |

### Tests
- `tests/budgetEngine.test.ts` (+5), **ton cas réel** (paie 1 700 €, loyer 255 € sans jour, 500 € prévus dont 370 €
  versés, 1 005,26 € dépensés, 437,69 € sur le compte, 3 jours avant la paie) :
  - le loyer est réservé, l'épargne restante (130 €) aussi : 52,69 € réellement libres ; enveloppe dépassée de 60,26 €
    mais couverte, état « presque », pas rouge ;
  - « c'est tout pour ce cycle » : enveloppe de 1 075 €, 69,74 € de reste, 23,24 € par jour, plus de dépassement ;
  - l'argent du début de cycle est retrouvé ; une charge déjà dans la prévision n'est pas comptée deux fois, une charge
    débitée ne l'est plus ; une épargne versée au-delà du prévu est retirée telle quelle et notée « tenue ».
- De bout en bout (3 tailles) : le détail montre l'épargne du cycle, sans débordement.
- Totaux MyFinances : 346 unitaires, 49 étapes de bout en bout : tout vert.

### Comment tester
1. Aujourd'hui → touche l'anneau → « Comment c'est calculé » : sous « Épargne du cycle », le prévu et le déjà versé.
2. Si le BTC est sauté ce mois : « C'est tout pour ce cycle ». L'enveloppe et le budget du jour remontent.
3. « Réellement libre d'ici la paie » : le loyer apparaît « d'ici la paie » tant qu'il n'est pas débité.
4. Un cycle où tu dépasses l'enveloppe en ayant de l'argent de côté : plus de « Déficit du cycle » rouge.

### Limites connues
- Une charge déjà payée mais dont le libellé et le montant ne ressemblent pas à la ligne des réglages reste réservée :
  l'étape 3 (une seule liste de récurrents, confirmés) le règlera.

---

## Étape 3 : une seule liste de récurrents

### Pourquoi
Trois détecteurs de la même chose (récurrents détectés, lignes des réglages, plans d'investissement), chacun avec ses
règles de rapprochement (10 % + 1 € et 5 jours pour la prévision, 20 % et mots-clés pour le budget) : d'où des doublons
(un virement Trade Republic compté à côté du plan) ou des oublis (un loyer saisi sans jour, invisible pour la prévision).

### Comment (décisions)
- **Une liste** (`src/domain/recurringList.ts`, `buildRecurringList`) : revenus et charges des réglages, investissements
  programmés, puis ce qui est détecté dans les opérations. Un détecté qui correspond à une ligne ou à un plan **ne fait
  qu'un** avec elle : il lui donne son jour (un loyer saisi sans jour prend celui vu à la banque), son rythme réel, et dit
  s'il est déjà passé ce cycle. Un détecté seul reste dans la liste, « à confirmer ».
- **Une règle de rapprochement** (`sameFlow`) : même montant à 10 % près (plus 1 €) au même moment du mois (5 jours) quand
  les deux jours sont connus, ou un libellé qui cite l'autre. Le budget s'en sert aussi pour ne pas réserver deux fois
  une charge.
- **La prévision lit la liste** : chaque flux n'y a qu'une échéance, au rythme vu à la banque, sinon au jour saisi ou
  selon le plan. Un revenu versé directement à un tiers (APL au CROUS) n'y est plus compté comme une entrée d'argent.
- **« Sauter ce mois »** (fiche d'un récurrent) : pour une charge, un abonnement ou un investissement, jusqu'à la paie.
  Il sort de la prévision ; une charge des réglages sort de l'enveloppe et n'est plus réservée ; un investissement sauté
  baisse l'épargne prévue du cycle (ton BTC). Gardé par cycle (24 cycles), synchronisé (`recurringSkips`) ; les cycles
  passés gardent leurs sauts.
- **Écran Abonnements et récurrents** : sections Revenus, Charges, Abonnements, Épargne et investissements ; pour chaque
  ligne, d'où elle vient (« Réglages · vu à la banque », « Plan programmé », « Détecté · à confirmer »), si elle est déjà
  passée ce cycle, sautée, ou quand elle tombe. Fiche : « Prendre le jour constaté » ou saisir le jour d'une ligne des
  réglages, sauter ce mois, confirmer ou écarter un détecté.

### Fichiers
| Fichier | Rôle |
|---|---|
| `src/domain/recurringList.ts` | **Nouveau** : liste unique, `sameFlow`, échéances, montants sautés par cycle |
| `src/domain/forecast.ts` | Prévision construite sur la liste ; sauts du cycle en cours |
| `src/domain/budgetEngine.ts` | Sauts : enveloppe (charges des réglages), épargne prévue, réservations ; `sameFlow` pour les charges |
| `src/domain/useInsights.ts` | `useRecurringList` (liste, cycle, sauts) ; `useForecast` sur la liste |
| `src/domain/useBudget.ts`, `sync/cloud/dexieStore.ts` | `setRecurringSkip`, sauts passés au moteur, synchronisés |
| `src/domain/alerts.ts`, `rpgStats.ts` (+ hooks) | Même enveloppe, sauts compris |
| `src/pages/insights/Recurring.tsx` | L'écran de la liste unique et sa fiche |

### Tests
- `tests/recurringList.test.ts` (5) : paie, loyer sans jour, virement Trade Republic, plan BTC, abonnement détecté, APL
  versée directement : chaque flux une seule fois, le loyer prend le jour vu à la banque et sait qu'il est passé, le
  virement rejoint le plan ; la règle de rapprochement ; BTC sauté (épargne prévue 400 € au lieu de 500 €, toujours prévu
  au cycle suivant) ; loyer sauté (hors de l'enveloppe et des réservations ce cycle, pas le précédent) ; APL hors de la
  prévision.
- `tests/insights.test.ts` : une ligne saisie déjà vue à la banque n'a qu'une échéance, au jour et au montant constatés.
- De bout en bout (3 tailles) : l'écran des récurrents, sections et fiche.
- Totaux MyFinances : 351 unitaires, 52 étapes de bout en bout : tout vert.

### Comment tester
1. Budget → Abonnements et récurrents : ton loyer, ta paie et ton virement Trade Republic n'apparaissent qu'une fois,
   avec « vu à la banque ».
2. Touche le plan BTC (ou ce qui le représente) → « Sauter ce mois » : sur Aujourd'hui, l'épargne prévue du cycle baisse
   de son montant, et le détail du calcul ne le réserve plus.
3. Une ligne des réglages sans jour : « Prendre le jour constaté ».

### Limites connues
- Un même commerçant qui prélève deux montants différents chaque mois est vu comme un seul récurrent (comme avant).
- Pour un détecté seul (pas dans les réglages), « sauter ce mois » le retire de la prévision et des réservations, mais
  pas de l'enveloppe (qui ne compte que les charges des réglages).

