# MyFinances V5 : repensé de A à Z (étapes 3.1 et 3.2)

> 14/11/2026, deuxième version. La première proposait de garder le modèle et de refaire les écrans : refusée. Tes
> retours : tu aimes suivre tes dépenses facilement et suivre ton patrimoine et tes investissements ; la page
> Opérations est brouillonne et pauvre ; le classement et la gestion des dépenses marchent mal ; l'indépendance
> financière n'apporte rien sous sa forme actuelle ; les alertes servent peu ; et surtout **les comptes, les dépenses,
> leur gestion et la planification ne sont pas unifiés**. Les banques se synchronisent bien ; le patrimoine sert vraiment.

## 1. Pourquoi ça ne marche pas aujourd'hui (le modèle, pas les écrans)

| Défaut du modèle actuel | Ce que tu en vois |
|---|---|
| **Tout est une « catégorie »**, même ce qui n'est pas une dépense : « Transferts internes », « Épargne & investissement », « Entre amis » sont des catégories « exclues » | Classer oblige à choisir entre des choses de nature différente ; un virement mal reconnu devient une dépense |
| **Trois mondes de comptes** : comptes bancaires (synchronisés), placements (saisis), biens et dettes (saisis). Un livret peut exister deux fois | Le patrimoine et le budget ne se parlent pas ; un virement vers un placement est une « dépense exclue » d'un côté, un achat saisi ou deviné par mot-clé de l'autre |
| **La planification vit à cinq endroits** : revenus et charges des réglages, récurrents détectés, plans d'investissement, objectifs d'épargne, objectifs de catégorie ; plus une épargne « auto ou manuelle » et une enveloppe « calculée ou forcée » | On ne sait pas où régler quoi ; la liste des récurrents doit recoller les morceaux |
| **Classement par mots-clés, opération par opération** : pas de notion de marchand | La file « à classer » se vide une par une ; corriger une opération ne corrige pas les autres ; les règles sont illisibles |
| **Opérations = une liste** : pas de sélection multiple, pas de ventilation, pas de saisie, pas de fiche marchand | « Brouillon et manque de fonctionnalités » |

## 2. Le nouveau modèle : quatre notions, pas plus

### Compte
**Tout endroit où il y a de l'argent, ou une dette.** Un seul concept, cinq familles :

| Famille | Exemples | Alimenté par |
|---|---|---|
| Quotidien | compte courant, carte | la banque (ou à la main) |
| Épargne | livrets | la banque (ou à la main) |
| Placements | PEA, compte-titres, crypto | relevé du courtier, virements reconnus, cours |
| Biens | voiture, logement | valeur saisie |
| Dettes | prêt | valeur saisie |

Le **patrimoine** est la somme des comptes. Le **budget** regarde les comptes du quotidien. Plus de doublon, plus de
« portefeuille » à côté des « comptes ».

### Mouvement
Chaque opération a une **nature**, décidée avant toute catégorie :

- **Dépense** : la seule nature qui porte une catégorie de dépense.
- **Revenu** : salaire, aides, exceptionnel.
- **Virement** : entre deux de tes comptes. Vers un livret ou un placement, c'est de l'**épargne** : elle se voit dans
  le budget (« mis de côté ») et dans le patrimoine (apport), sans rien ressaisir.
- **Remboursement** : rattaché à la dépense qu'il rembourse (ou à une personne), il la réduit.

Une opération peut être **ventilée** (un ticket, deux catégories) et **notée à la main** (espèces, ou avant que la
banque l'envoie : elle est rapprochée à l'arrivée, jamais comptée deux fois).

### Marchand
Le libellé bancaire brut (« CB CARREFOUR MKT 1234 PARIS ») devient un **marchand** propre (« Carrefour »). On classe
**le marchand, une fois** : ses opérations passées et futures suivent. « À classer » regroupe donc par marchand
(« Carrefour · 9 opérations » : un geste). Les règles par mots-clés restent pour les cas tordus, cachées.

### Prévu
**Une seule liste** de ce qui revient : revenus, charges, épargne (versements programmés, objectifs). Chaque ligne a un
montant, un rythme, un compte. L'app **détecte** les lignes dans l'historique et te les **propose** ; tu confirmes d'un
geste. Tout le reste en découle :

```
reste à vivre du cycle = revenus prévus − charges prévues − épargne prévue
à dépenser aujourd'hui = (reste à vivre − déjà dépensé) ÷ jours restants
```

Les budgets par catégorie sont facultatifs et vivent au même endroit. Plus de réglage « auto ou manuel ».

## 3. Les écrans : quatre onglets, un par question

| Onglet | Question | Contenu |
|---|---|---|
| **Jour** | Combien je peux dépenser aujourd'hui ? | Le chiffre ; la jauge du cycle ; les dépenses du jour ; ce qui tombe bientôt ; « à classer » s'il y en a |
| **Opérations** | Où est passé mon argent ? | Tous les comptes dans une seule liste ; recherche ; filtres en pastilles (compte, nature, catégorie, montant, période) ; total par jour ; sélection multiple (classer, changer de nature) ; ventiler ; ajouter ; fiche marchand (historique, moyenne, catégorie) ; « à classer » groupé par marchand |
| **Plan** | Je finis le mois dans le vert ? | Revenus, charges, épargne prévus (reçu / payé / à venir) ; budgets par catégorie ; où tu finiras le cycle ; cycles précédents |
| **Patrimoine** | Combien j'ai, et ça progresse ? | Total et courbe ; comptes par famille ; placements (valeur, plus-value, lignes) ; objectifs ; **projection** : « à ce rythme, dans 1, 5, 10 ans » |

**Retiré** : la page Alertes (deux alertes génériques restent, dans « À faire » de la coquille) ; l'assistant propre
(Copilot le remplace) ; la page Indépendance financière (remplacée par la projection du patrimoine, qui répond à la
vraie question : « où je vais à ce rythme ? ») ; les statistiques rarement lues de l'ancienne page Budget.

## 4. Tes données

Le modèle change, donc **une migration**, rejouable et testée sur une copie de tes données réelles (sur ton appareil,
jamais livrée), avec point de restauration avant :

- comptes bancaires, placements, biens et dettes → **comptes** ;
- opérations → nature déduite de leur catégorie actuelle (transferts → virement, épargne → virement vers un compte
  d'épargne ou de placement, entre amis → remboursement) ; tes corrections manuelles sont gardées ;
- règles et libellés → **marchands** avec leur catégorie ;
- lignes de revenus et de charges, récurrents confirmés, plans d'investissement, objectifs → **prévu** ;
- mouvements de placements, cours, historique du patrimoine : repris tels quels.

Les calculs éprouvés (cycle de paie, détection des récurrents, prévision, valorisation, lecture du relevé Trade
Republic, synchro bancaire) sont **réutilisés** quand ils restent justes dans le nouveau modèle ; le reste est réécrit
avec ses tests. L'ancienne app reste en ligne à `/finances/` jusqu'à la bascule.

## 5. Les étapes

| Étape | Contenu | Tu testes |
|---|---|---|
| 3.1 | Ce document | Le modèle te paraît-il logique ? |
| 3.2 | Maquettes des écrans clés | Tu valides ou tu corriges |
| 3.3 | Le nouveau modèle (comptes, mouvements, marchands, prévu), ses tests, la migration | Tes données dans le nouveau modèle, vérifiées |
| 3.4 | **Opérations** : liste unifiée, filtres, sélection multiple, ventilation, saisie, marchands, à classer | Classer une semaine entière |
| 3.5 | **Jour** et **Plan** ; cartes d'accueil, ajout rapide | Ton budget au quotidien |
| 3.6 | **Patrimoine** : comptes, placements, objectifs, projection ; banques et relevés | Tes comptes et placements |
| 3.7 | Premier lancement, réglages, Copilot, export ; bascule de `/finances/` | Deux semaines d'usage réel |
