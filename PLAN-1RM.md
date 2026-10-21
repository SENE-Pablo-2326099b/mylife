# Plan — 1RM saisi par l'utilisateur, S4 plus lourde, volume par muscle

Document de cadrage. **Implémenté le 13 oct. 2026** (voir la section « Réalisé » à la fin).

Trois demandes :

1. La dernière semaine de travail (S4) doit avoir un top set plus lourd : 90-92,5 % × 2 ou 95 % × 1. Les backoffs ne changent pas.
2. La formule d'Epley ne doit plus décider seule du 1RM de référence : on peut l'afficher, choisir de s'en servir, et surtout **saisir son propre 1RM**.
3. Le 1RM estimé est faux (≈ 70 kg de lest affichés, ressenti 55-60 kg), et le volume par muscle compte les composés comme du travail de bras.

---

## 1. Ce qui existe aujourd'hui

### 1.1 Les charges des lifts principaux

- Fichiers : `src/domain/reference.ts` (référence), `src/domain/prescription.ts` (charges), `src/domain/mesocycle.ts` et `mesoTypes.ts` (structure des semaines).
- Une charge de top set ou de backoff = **% du 1RM de référence**, sur la masse totale (poids de corps + lest) pour les exercices lestés. Cette partie n'utilise **pas** Epley : `loadAt(ref, pourcentage)`.
- Le 1RM de référence est **déduit de l'historique** par `referenceAt()`, avec ces étapes :
  1. **Amorçage :** meilleur e1RM Epley (`charge × (1 + reps/30)`) des 12 dernières semaines, sur les séries de 6 reps ou moins.
  2. **Référence provisoire :** si seules des séries de 7 à 8 reps existent, elles servent, avec le badge « provisoire ».
  3. **Recalage :** les premiers top sets du cycle recalent une référence provisoire.
  4. **Test :** une série « Test » de 6 reps ou moins remplace la référence.
  5. **Calibration S4 :** réussie, +2,5 % ; ratée, baisse proportionnelle.
  6. **Plafond :** +2,5 % de hausse maximum par cycle.
- Il n'y a **aucun endroit pour saisir un 1RM**. Le seul levier est de « tricher » en loggant une série Test.
- Epley sert aussi à :
  - lire une série contre son plan (`againstPlan`) ;
  - la table de charges par nombre de reps (`loadTable`, écran fiche exercice et stats) ;
  - les courbes e1RM des stats.

### 1.2 La structure d'un cycle d'accumulation (valeurs pré-remplies)

| Semaine | Top set | Backoffs |
|---|---|---|
| S1 | 1×5 à 80 % | 4×6 à 70 % |
| S2 | 1×4 à 83 % | 4×6 à 73 % |
| S3 | 1×4 à 85 % | 3×6 à 75 % |
| S4 | **1×3 à 88 %** | 3×5 à 78 % |
| Deload | 1×3 à 65 % | 2×5 à 55 % |

- Ces valeurs sont à deux endroits : `DEFAULT_SCHEME_4` (`mesocycle.ts`) et le preset `accumulation` (`mesoTypes.ts`).
- Chaque cycle **enregistre sa propre copie** de la structure à sa création, et chaque semaine est modifiable par exercice.
- Un cycle déjà créé ne change donc pas si on modifie les valeurs par défaut.

### 1.3 Le volume par muscle

- Fichier : `src/domain/analytics.ts`, `weeklyVolume()`.
  - Une série compte **1** pour chaque muscle principal de l'exercice et **0,5** pour chaque muscle secondaire.
- Conséquences observées :
  - Dips : triceps en principal, donc 1 série de triceps pour chaque série de dips.
  - Pull-up et rowings : biceps en secondaire, donc 0,5.
  - Développé militaire : triceps en secondaire.
  - Les cibles de réglage (triceps ~9, biceps ~13) sont donc atteintes en partie grâce aux composés, alors que tu veux suivre le **travail direct** des bras.

---

## 2. Ce que je vais implémenter, comment et pourquoi

### 2.1 S4 plus lourde

- **Quoi :** le top set de S4 passe de 1×3 à 88 % à **1×2 à 92,5 %**. Les backoffs de S4 restent à 3×5 à 78 %.
- **Où :** `DEFAULT_SCHEME_4`, le preset `accumulation`, et l'interpolation de `generateScheme` pour les cycles qui ne font pas 4 semaines. Elle va aujourd'hui de 80 % à 88 % et finira à 92,5 %, avec le top set qui descend de 5 à 2 reps.
- **Variantes :** 90 % × 2 et 95 % × 1 se règlent déjà semaine par semaine dans l'éditeur de cycle. Je vérifie que le plafond du champ pourcentage autorise 95 %, et que les règles de reps restent respectées (top set 1 à 5 reps).
- **Cycles existants :**
  - Je ne réécris pas un cycle déjà créé en silence.
  - Le cycle du 12 oct. n'a pas encore atteint S4. Si sa structure est encore **exactement** l'ancienne par défaut (jamais modifiée), je mets S4 à jour. Si tu l'as modifiée, je n'y touche pas.
- **Pourquoi :** pour que la semaine de calibration fasse un vrai test de force lourd. 88 % × 3 est trop proche des semaines précédentes pour dire quoi que ce soit sur ton max.
- **À valider :** le saut S3 → S4 devient 85 % × 4 → 92,5 % × 2. Si tu préfères une montée plus douce, je propose S3 à 87,5 % × 3. Ce n'est pas demandé, donc je ne le change pas sans accord.

### 2.2 1RM saisi par l'utilisateur, Epley en option

**Nouveau comportement, par lift principal :**

- **Mode du 1RM de référence**, au choix par exercice :
  - **Manuel :** tu saisis ton 1RM. C'est la valeur qui sert de base à toutes les charges.
  - **Estimé :** le calcul actuel à partir de l'historique. Il reste disponible, mais ce n'est plus le défaut dès que tu as saisi une valeur.
- **Saisie :**
  - Tu saisis ton **1RM tel que tu le notes**. Aux dips et aux tractions, c'est la charge ajoutée (ex. « +57,5 kg » : ton max de lest). Pour le squat, c'est la barre.
  - Ce n'est pas le lest d'une série : c'est le max de l'exercice. Les % s'appliquent à ce max.
  - **Poids de corps :** l'appli l'ajoute pour obtenir la masse totale sur laquelle les % sont calculés.
    - Elle prend le poids de corps **de la séance** (celui que tu renseignes déjà), donc l'écart lest / masse totale reste toujours juste.
    - Exemple : 1RM +57,5 et poids de corps 69,5 → masse totale 127 kg.
    - S4 à 92,5 % → 117,5 kg de masse totale → +48 kg de lest (arrondi à l'incrément).
- **Où :**
  - Sur la fiche de l'exercice (carte « 1RM de référence »).
  - Dans l'éditeur de cycle, via un raccourci.
  - Le champ affiche la valeur Epley estimée à côté, comme repère.
- **Epley affiché, jamais imposé :**
  - La carte montre « Estimation de l'historique : X kg » avec la série qui la produit.
  - Un bouton « Utiliser l'estimation » copie cette valeur dans le champ manuel.
- **S4 et tests en mode manuel :**
  - Ils ne modifient plus ta valeur automatiquement.
  - Après une S4 réussie ou un test supérieur, l'appli propose « +2,5 % ? » ou « nouveau 1RM : X ? », avec un bouton Appliquer. Elle ne change rien sans ton accord.
  - Le plafond de +2,5 % par cycle devient un simple avertissement.
- **En mode estimé :** le comportement actuel est conservé, sauf que la hausse automatique reste plafonnée.
- **Historique :**
  - Chaque séance garde la référence utilisée (`workout_exercises.reference_e1rm`), ce qui ne change pas.
  - Les anciennes séances restent lisibles.

**Technique :**

- **Stockage :** une nouvelle migration, par exemple une table `exercise_one_rm` (exercice, 1RM tel que saisi, date, mode). Pas de poids de corps stocké : il est lu sur la séance. Elle s'ajoute à `TABLES` dans `src/db/backup.ts`, donc elle est exportée et restaurée.
- **Domaine :** `referenceAt()` reçoit cette valeur en entrée. En mode manuel, elle devient la référence, avec une base « Saisie le … ». Le calcul actuel reste inchangé en mode estimé et sert de repère d'affichage.
- **Service :** `referenceFor()` (`workoutService.ts`) lit la valeur manuelle et la passe au domaine.
- **UI :** `ReferenceCard` gagne le champ de saisie, le sélecteur de mode et les propositions de mise à jour.

**À propos du « 70 kg de lest » :**

- Je n'ai pas encore pu reproduire ce chiffre : la base est sur ton téléphone.
- Epley surestime facilement dès 6-8 reps. Avec le programme réel (dips +35 × 7), le calcul donne autour de +58 kg de lest, donc le 70 vient d'une autre série ou d'un autre poids de corps.
- Je vais afficher clairement **quelle série produit l'estimation**, pour que tu voies d'où vient l'écart et que tu puisses corriger le chiffre.

**Pourquoi :**

- Epley est une approximation de population. Elle n'a aucune raison d'être juste pour toi sur des dips lestés à 7 reps.
- Tu connais ton max mieux que la formule.
- Une référence fausse décale **toutes** les charges du cycle.

**Ce que je ne fais pas :** je ne supprime pas Epley (affichage, courbes, repère) et je ne change pas la logique « % du 1RM ». Seule la source du 1RM change.

### 2.3 Volume par muscle : direct et indirect

- **Règle :** pour les muscles des bras (biceps et triceps), les séries de composés ne comptent plus dans le total « direct ».
  - Sont directs : les exercices d'isolation (curls, barre au front, pushdown, extensions).
  - Sont indirects : les composés qui sollicitent le muscle (dips, développés, tractions, rowings).
- **Affichage :** « 9 directes + 6 indirectes ». Les deux chiffres sont visibles, comme tu le demandes (« ou alors indiquer les deux »).
- **Barre de cible :**
  - Elle compare le **direct** aux cibles de Réglages (triceps ~9, biceps ~13).
  - Les indirects sont affichés à côté sans entrer dans la jauge.
- **Autres muscles :** inchangés (principal 1, secondaire 0,5).
- **Où :** `weeklyVolume()` et ses appelants (stats : `VolumeTargets`, détail d'un muscle, carte musculaire).
  - La structure du résultat passe de « total » à « direct + indirect ».
  - Les tests existants sont adaptés.
- **Pourquoi :**
  - Aujourd'hui les dips comptent 1 série de triceps à part entière.
  - Un cycle sans aucune isolation paraîtrait quand même couvrir la cible.
  - Séparer les deux donne un suivi utile pour adapter le volume d'isolation.

---

## 3. Ordre de travail et vérifications

1. Structure S4 + tests de `mesocycle` / `mesoTypes`.
2. Migration + stockage du 1RM manuel + domaine `referenceAt` avec le mode manuel, et tests (manuel prioritaire, estimation seulement affichée, propositions S4 / test).
3. UI : saisie du 1RM, sélecteur de mode, bouton « Utiliser l'estimation », propositions de mise à jour.
4. Volume direct / indirect : domaine, tests, écrans de stats.
5. Mise à jour de `data/programme-reel.md`, `README.md`, `CLAUDE.md` et `AMELIORATIONS.md` (la règle « Epley inversé » et la structure de S4 changent).
6. Vérifications : `npx tsc --noEmit`, `npx expo lint`, `npm test`, puis contrôle visuel sur l'aperçu web (clair et sombre, 320 et 390 px).

## 4. Risques

- **Données :** la migration est additive (nouvelle table), elle ne touche pas aux données existantes. Sans 1RM saisi, tout fonctionne comme avant.
- **Cycle en cours :** je ne modifie pas ses charges, sauf la mise à jour de S4 si la structure est restée celle par défaut.
- **Poids de corps :** le 1RM saisi (lest) garde la même valeur quand ton poids change. La masse totale, elle, suit le poids de corps de la séance. Si tu prends beaucoup de poids (69,5 → 72 kg), les charges de lest montent donc un peu, car la masse totale monte. C'est le comportement voulu pour garder l'écart correct ; si ton vrai max ne suit pas, tu le corriges à la main.

---

## 5. Réalisé (13 oct. 2026)

- **S4 :** pré-remplie 1×2 @ 92,5 % + 3×5 @ 78 % (accumulation 4 semaines et courbe des autres durées). Les cycles encore sur l'ancienne S4 par défaut et dont la S4 n'a pas commencé sont mis à jour une fois au lancement (`upgradeLegacyS4`). La S4 des dips du Cycle 1 (1 × 2 à +47,5 kg, réglage demandé) n'est pas touchée.
- **% à la demi-unité :** affichés « 92,5 % » ; les réglages de % avancent par pas de 2,5 et se calent sur la grille (83 % → 85 %).
- **1RM saisi :** carte « 1RM de référence » (fiche exercice et plan du cycle) avec champ de saisie, sélecteur Mon 1RM / Estimation, estimation Epley affichée avec la série qui la produit et bouton « Utiliser », propositions Appliquer / Garder après une S4 ou un test. Migration 6 (`exercise_one_rm`), incluse dans les sauvegardes et conservée par « Recharger mon programme ».
- **Volume des bras :** direct = isolations ; composés en « indirect », affiché à part dans Stats (cibles et liste) et dans la fiche muscle de la carte.
- **Coach :** prompt et outils au courant (1RM saisi prioritaire, S4 92,5 %, volume direct/indirect).
- **Tests :** 171 (dont 13 nouveaux) ; tsc et lint propres.
