# Rapport de livraison : MyFinances (V2)

État au 19/10/2026. Le détail des changements, leur raison et les notes des 5 idées issues de la recherche sont dans **[V2.md](V2.md)**. Les hypothèses (65) sont dans [ASSUMPTIONS.md](ASSUMPTIONS.md).

## Vérifié en fin de travail

| Commande | Résultat |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | 0 erreur, 0 avertissement |
| `npm test` | **224 tests, 19 fichiers**, tous verts |
| `npm run build` | OK (JS 685 Ko, 222 Ko gzip ; polices et icônes en cache hors ligne) |
| `npm run screenshots` | Accueil guidé et tous les écrans avec la démo, thèmes **Nuit** et **Perle**, **320 / 390 / 430 px** + 1 280 px : aucune erreur console, aucun débordement horizontal ; lien d'évitement en premier au clavier ; rechargement hors ligne OK |

## Ce qui est fait

1. **Design system Lumen** repris de MyPerf (jetons, 8 thèmes, verre en 4 niveaux, fond animé à halos, ressorts, composants, graphiques), appliqué à tous les écrans. Thème choisi dans Réglages → Apparence, avec aperçus et « Suivre le téléphone ». Contrastes testés.
2. **Personnalisation complète** : accueil guidé, revenus et charges en listes, titulaires, épargne calculée, règles génériques, n'importe quelle banque, démo fictive. Migration automatique de la V1 sans perte.
3. **Patrimoine et placements** : patrimoine net et historique, portefeuilles (Trade Republic, Bitstack, PEA…), PRU, plus-values, investissements programmés, cours automatiques via le relais, biens et dettes.
4. **Les 5 idées** : prévision de trésorerie, abonnements et récurrents, objectifs d'épargne, patrimoine unifié, indépendance financière.

## Ce qui n'est pas fait / limites

1. **Aucun essai avec une vraie banque ni de déploiement réel** (comme en V1 : il faut ton compte Enable Banking).
2. **Trade Republic et Bitstack** se suivent par saisie des positions et des plans programmés : aucune des deux n'a d'API publique.
3. **Cours** : les endpoints Yahoo Finance sont non officiels et peuvent changer ; la saisie manuelle reste possible.
4. Pas de verrouillage de l'app ni de chiffrement local, pas de notifications.
5. JavaScript non découpé par écran (685 Ko).

## Lancer l'app

```bash
npm install
npm run dev                  # http://localhost:5173 → accueil guidé → « Essayer avec la démo »
npm test                     # 224 tests
npm run build && npm run preview
npm run screenshots          # captures dans screenshots/ (après build)
```

## Les 5 améliorations que je ferais ensuite

1. **Premier essai réel** : synchro BNP / Revolut en *restricted production* ; ajuster le nettoyage des libellés et les règles.
2. **Import des relevés Trade Republic (PDF / CSV) et de l'export fiscal Bitstack**, pour remplacer la saisie des placements.
3. **Verrouillage** : code ou biométrie (WebAuthn) et chiffrement d'IndexedDB.
4. **Prévision avec fourchette** (dépenses quotidiennes basse / haute) et alerte « découvert probable avant la paie ».
5. **Découpage du JavaScript par écran** (chargement à la demande des écrans Patrimoine et Réglages).
