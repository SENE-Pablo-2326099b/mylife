# MyPerf — suivi d'entraînement (force / street lifting)

App mobile offline-first de suivi de musculation : saisie de séance ultra-rapide, mésocycles avec rampe top set + backoff, double progression, stats e1RM.

## Lancer

```bash
npm install
npx expo start          # puis Expo Go (Android/iOS) ou un dev build
npm test                # tests métier + base de données (Jest)
npm run typecheck       # TypeScript strict
npm run lint
```

`npx expo start --web` ouvre un **aperçu navigateur** (voir « Web » plus bas) — la cible réelle est iOS/Android.

## Stack — et pourquoi

| Choix | Raison |
|---|---|
| **Expo SDK 57 / React Native 0.86**, React Compiler | Standard actuel, build sans Xcode/Android Studio (EAS), perfs natives. |
| **expo-router** (onglets JS personnalisés) | Navigation par fichiers ; barre d'onglets custom pour y loger le timer de repos et le clavier numérique. |
| **expo-sqlite, API synchrone** | Chaque action est écrite sur disque *avant* que l'UI avance → aucune perte si l'app est tuée en pleine séance. WAL + écritures d'une ligne : < 1 ms. |
| **zustand** | État de la séance en cours : mises à jour immuables ciblées → seules les lignes touchées re-rendent. |
| **@shopify/flash-list** | Listes longues (bibliothèque) virtualisées. |
| **react-native-svg** | Graphiques maison légers (courbe e1RM, colonnes par cycle, sparklines), halos lumineux du fond. |
| **Reanimated 4 + Gesture Handler** | Animations à ressort sur le thread UI (pression, sheets glissables, timer liquide). |
| **expo-blur, expo-linear-gradient, Sora + Inter** | Matières « Liquid Glass » et typographie du design system Lumen. |
| **Jest + better-sqlite3** | Les dépôts SQL et le service de séance sont testés contre un vrai SQLite en mémoire. |

## Architecture

```
src/
  domain/      Logique métier PURE (aucun import RN/DB) + tests
               math (Epley, backoff, arrondi), mesocycle (phases, rampe), prescription
               (top set/backoff, double progression), sets (auto-détection des types, recalcul
               live des backoffs), analytics (stagnation, volume, PRs), planning, rest
  db/          Accès données : contrat Db synchrone, migrations versionnées, dépôts, seed,
               sauvegarde/restauration ; drivers expo-sqlite (natif) et sql.js (aperçu web)
  services/    Cas d'usage : démarrer/terminer une séance, stats, planning, export, notifications
  state/       Stores zustand : séance(s) affichée(s), saisie clavier, timer de repos, réglages, toasts
  features/    Composants métier (écran de saisie : SetRow, ExerciseCard, Keypad, RestTimerBar…)
  ui/          Thèmes (8 palettes, Nuit par défaut), primitives, graphiques, hook useLive
  app/         Routes expo-router (onglets Accueil (Aujourd’hui) / Planning / Exercices / Stats / Réglages + écrans poussés)
```

Règles : le domaine ne dépend de rien ; l'UI ne fait jamais de SQL directement (dépôts/services) ; pas de `any`, `as` limité aux deux adaptateurs de driver.

## Décisions métier documentées

- **e1RM** : Epley `poids × (1 + reps/30)`, une série de 1 rep vaut son poids. Jamais stocké. Pas de RPE ni de RIR, nulle part.
- **Exercices lestés** (tractions, dips, muscle-up) : on saisit le **lest** ; e1RM et % se calculent sur la **masse totale** (poids de corps + lest). Le poids de corps utilisé est le dernier saisi (snapshot à chaque séance) : changer de poids change le lest proposé, pas la référence.
- **Fiabilité (lifts principaux)** : seules les séries de **6 reps ou moins** servent à la référence ; au-delà c'est du volume : affichées en « estimation peu fiable » (cercles orange sur la courbe), jamais utilisées pour les charges.
- **1RM de référence** (`src/domain/reference.ts`) : la base de toutes les charges des lifts principaux.
  - *Mon 1RM* (prioritaire) : saisi sur la fiche de l'exercice (carte « 1RM de référence », table `exercise_one_rm`). Pour un lesté on saisit son max de **lest** ; l'app ajoute le poids de corps de la séance pour calculer les % sur la masse totale. Après une S4 réussie / ratée ou un test, l'app **propose** une mise à jour (Appliquer / Garder), jamais automatique. Un sélecteur « Mon 1RM / Estimation » permet de revenir à l'estimation ci-dessous, qui reste affichée comme repère.
  - *Amorçage* : meilleure série ≤ 6 reps des 12 dernières semaines. S'il n'y en a pas, ou si une série récente à 7-8 reps fait mieux (séries ≤ 6 anciennes), on la prend avec le badge **« Référence provisoire »** (squat 80 × 8, dips +35 × 7 en fin de Bloc 1).
  - *Recalage* : les premières séries prévues ≤ 6 reps d'un cycle remplacent une référence provisoire. Elles sont lues **par rapport au plan** (snapshot de la référence sur la séance) : fait comme prévu = confirmée, plus = monte, moins = baisse.
  - *Calibration S4* : à la fin de chaque cycle, le top set de S4 sert d'indicateur — réussi (ou dépassé) → **+2,5 %**, raté → baisse d'autant. Une série marquée **Test** (≤ 6 reps, effort max) est prise comme vérité. Hausse plafonnée à **+2,5 % par cycle**, baisses non plafonnées.
- **Top set + backoff** : top set **1 à 5 reps**, backoffs **3 à 6 reps**, charges en **% du 1RM de référence**. Valeurs pré-remplies d'un cycle d'accumulation : S1 1×5 @80 % + 4×6 @70 % · S2 1×4 @83 % + 4×6 @73 % · S3 1×4 @85 % + 3×6 @75 % · S4 1×2 @92,5 % + 3×5 @78 % · deload 1×3 @65 % + 2×5 @55 %. Un top set « Rapide » ajoute un incrément la séance suivante.
- **Types de mésocycle** (`src/domain/mesoTypes.ts`, périodisation par blocs) : Accumulation, Transmutation, Réalisation (test du max en dernière semaine), Transition, Personnalisé. Choisir un type pré-remplit les semaines et la structure top set/backoff (mêmes fourchettes de reps) ; la frise Planning → Programme montre l'enchaînement des blocs.
- **Carte musculaire** (onglet Exercices → Corps) : face/dos, couleur = séries effectives par semaine (7 ou 28 jours, secondaire = ½, bras : isolations seulement, composés en indirect) ; toucher un muscle → séries vs objectif, 8 semaines, dernière séance, exercices ciblés puis secondaires.
- **Tout est réglable par exercice et par semaine** (Planning → Programme → cycle → « Par exercice et par semaine ») : nombre de top sets et de backoffs, reps, % et charge imposée. « Auto » revient au calcul. Ce sont des valeurs pré-remplies, jamais des règles (seules les fourchettes de reps sont bornées).
- **Deload** : lifts principaux selon la semaine de deload du cycle (ci-dessus) ; accessoires charge −40 %, volume −50 % (réglables par cycle).
- **Progression par créneau** : un même exercice peut être en top set un jour et en double progression un autre (dips lourds mardi / volume samedi) ; l'historique de référence (ghost, suggestions) suit le créneau de même progression.
- **Double progression** : quand toutes les séries atteignent le haut de la fourchette → badge « ↑ charge » et proposition à +1 incrément en repartant du bas. Volume constant sur le cycle.
- **Stagnation** : pas de gain d'e1RM > 0,5 % sur 2 cycles consécutifs (lifts principaux : séries ≤ 6 reps) → alerte non bloquante.
- **Volume** : séries effectives (hors échauffement) ; muscle principal = 1, secondaire = ½. **Bras** (biceps, triceps, avant-bras) : seules les isolations comptent en direct (et dans la cible) ; les composés (dips, tirages, développés) sont affichés à part en « indirect ».
- **Types de série** auto-détectés à la validation (échauffement / top set / backoff / série / drop) ; toucher le badge pour forcer.
- **Repos** : max(valeur de l'intention, plancher de la catégorie : 5 min principaux, 3 min polyarticulaires, 2 min isolation). Démarrage auto à la validation.
- Le plan est une **suggestion** : rien ne bloque, tout écart est simplement enregistré.

## Saisie de séance (UX)

- Les valeurs **grises** sont la prescription : **✓ les accepte telles quelles** (1 tap si on suit le plan).
- Toucher un poids ouvre le **clavier intégré** (pas le clavier système) : chiffres, ±incrément, « Reps → », ✓.
- L'accueil montre la séance du jour telle qu'elle sera prescrite : charge du top set des lifts principaux, volume des accessoires (deload compris).
- Colonne « Préc. » = la séance précédente (ghost). Bulle sur une série = note (« genou sensible », « prise large »…), gardée dans l'historique. Appui long sur une série = menu note / suppression (avec annuler).
- Sous un top set : vitesse de barre (facultative) et **Test** (série d'effort max qui calibre la référence).
- Aucune popup de confirmation : les actions destructives proposent « Annuler » dans un toast (séries, exercices, séances planifiées, mesures, exercices d'une séance type, séance type archivée, mésocycle supprimé).
- **Remplacer en pleine séance** : bouton ⇄ sur l'exercice → ce que tu as déjà fait à la place apparaît en premier, puis les exos des mêmes muscles ; « Nouvelle variante » crée la version machine en un geste (charges et stats séparées). Option pour remplacer aussi dans la séance type.

## Coach IA

- API Claude avec ta clé (coffre du téléphone). « Réponse rapide » (Sonnet) par défaut, « Analyse poussée » (Opus) d'un toucher ; cache des prompts pour réduire le coût.
- Il lit tes données avec des outils (programme, cycles, historique, volume, poids, séance prévue avec ses charges) et propose des changements que tu valides ou refuses.
- Accessible depuis l'accueil (✦), une fiche exercice, le bilan de séance et les alertes de stagnation : la question arrive pré-remplie, rien n'est envoyé sans toi.

## Fiche exercice

- Lifts principaux : 1RM de référence, table de charges, top sets par semaine.
- Accessoires : carte « Prochaine séance » (charge, fourchette, quand la charge monte).

## Interface — design system « Lumen » (Liquid Glass)

Tout vit dans `src/ui` ; les écrans n'utilisent que ces briques.

- **Fond** (`Backdrop`) : un champ lumineux unique derrière toute l'app (dégradé + 4 halos SVG qui dérivent lentement, parallaxe au scroll). Chaque section a son ambiance (`mood` sur `Screen` : today, session, planning, library, stats, settings).
- **Verre** (`Glass`) : 4 niveaux (`pane` < `raised` < `float` < `lens`). Chaque niveau = remplissage translucide + reflet (sheen) + bord lumineux + liseré spéculaire + ombre. Flou réel (`BlurView`) seulement sur les couches flottantes et sur iOS/web (`LIVE_BLUR`) ; sur Android et dans les listes, le verre est simulé (plus dense) au-dessus d'un fond déjà diffus → pas de coût GPU au scroll.
- **Tokens** (`theme.ts`) : une `Palette` de jetons (fond, surfaces, texte / secondaire / discret, accent, succès, or, alerte, danger, info, bordure, puits de saisie, carte musculaire…), `space`, `radius`, `family` (Sora pour titres/chiffres, Inter pour le texte), variantes de `Text` (hero → caption). Aucun écran n'écrit de couleur : tout passe par `useTheme()`.
- **Thèmes** (`themes.ts`) : 8 thèmes — sombres : Nuit (défaut), Océan, Braise, Graphite ; clairs : Perle, Glacier, Sable, Craie. Nuit et Perle sont les palettes Lumen d'origine ; les autres sont construits par les mêmes règles à partir d'une graine. Réglages → Apparence (aperçu miniature, appliqué tout de suite) ; « Suivre le téléphone » bascule sur l'équivalent clair/sombre de chaque thème. Contrastes vérifiés par `src/ui/__tests__/themes-test.ts`.
- **Mouvement** (`motion.ts`) : ressorts `snappy` / `soft` / `liquid`. `Tap` = pression élastique + survol web (option `magnetic`). `Reveal` = entrée échelonnée des blocs. Tout respecte « réduire les animations ».
- **Responsive** (`responsive.ts`) : `compact` < 640 px (dock flottant en bas), `medium`, `expanded` ≥ 1024 px (sidebar à gauche, `Columns` en plusieurs colonnes, panneau latéral clavier/plan en séance, sheets en dialogue centré).
- **Primitives** : `Screen` (grand titre qui se condense en barre de verre ; `stack` = écran poussé, `modal` ; `footer` = action principale fixée en bas, sous le pouce), `Card`, `Disclosure` (section repliée : l'info rare à un tap), `Button`, `IconButton`, `Chip`, `Badge`, `Row`/`Group`, `Field`, `Stepper`, `Segmented`, `Toggle`, `Sheet`/`ActionSheet`, `EmptyState`, `Skeleton`, `ProgressRing`, `Metric`, graphiques (`charts.tsx`).
- **Web / clavier** (desktop) : chiffres, `↑↓` ± charge, `Tab` reps → série suivante, `Entrée` valide, `Échap` ferme.

## Ergonomie

Un écran = un objectif ; l'info utile maintenant en haut, le reste à un tap (feuille, section repliée, écran de détail). Audit et plan : `ERGONOMIE.md`.
- **Séance** : seul l'exercice en cours est déplié, les autres tiennent sur une ligne. Ligne de série = numéro · précédent · kg · reps · ✓. Toucher le numéro (ou appui long) ouvre la feuille de la série : type, vitesse de barre, test, note, suppression. La vitesse de barre n'est demandée qu'une fois le top set validé. Menu ⋯ par exercice (remplacer, échauffement, note, ordre, historique, retirer). « Repos » et « Terminer » en bas.
- **Accueil** : la séance du jour et « Démarrer » ; dessous, la semaine du cycle, la prochaine et la dernière séance. Les autres séances types : « Autre séance ».
- **Stats** : 3 chiffres, lifts principaux en lignes, volume vs cibles ; le reste replié.

## Mon programme (import)

`data/programme-reel.md` est la source de vérité, transcrite dans `src/import/personalProgram.ts` (exercices, 5 séances types, semaine type, Bloc 1 + 3 cycles, poids de corps). L'historique `data/historique-seances.csv` est embarqué via `npm run gen:import` (→ `src/import/historyCsv.ts`, à relancer si le CSV change).
Les commentaires du carnet sont appliqués par `src/import/carnetCorrections.ts` (chaque correction cite sa ligne) : exercices faits à la place d'un autre (variantes séparées, stats séparées), séries perdues par l'export CSV (« pdc », charges converties en dates par Excel), reps corrigées (rep ratée, reps assistées), notes.
Au premier lancement (base vide), tout est chargé automatiquement ; sinon Réglages → « Recharger mon programme » (remplace les données, atomique). Le rapport d'import (fusions de noms, anomalies du carnet) est vérifié par `src/import/__tests__/import-test.ts`.

## Données

Tout reste sur le téléphone (SQLite). Réglages → Export JSON (sauvegarde complète, ré-importable) ou CSV des séries. La séance en cours et le timer survivent à un kill de l'app.

## Web

L'aperçu navigateur utilise **sql.js** en mémoire (sauvegardé dans `localStorage`) car l'API synchrone d'expo-sqlite sur le web est en alpha. Utile pour développer l'UI ; pas une cible de production.
