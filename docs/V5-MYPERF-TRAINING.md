# MyPerf V5 : l'architecture de `packages/training` (validée le 22/11/2026 ; P1 fait)

Réponse aux retours du 22/11 sur le plan de la phase 4 (`docs/V5-MYPERF-PHASE4.pdf`). L'architecture technique
(SQLite WebAssembly, synchro chiffrée `perf`, écran allumé, minuteur à heure de fin + Web Push, Copilot, rien de
personnel livré) est **validée**. Ce qui change : le métier ne connaît plus aucune méthode d'entraînement. La méthode
de l'utilisateur (streetlifting par blocs, top set + backoffs au % du 1RM, calibration S4) devient **un modèle
parmi d'autres**, reproduit à l'identique, jamais une règle du moteur.

Rien n'est codé avant validation de ce document et des maquettes (canevas « MyPerf V5 — P0 révisé »).

**Interface : uniquement le kit MyLife** (décision du 22/11). Le module n'invente ni composant ni palette : verre
(`.glass`, listes, feuilles, barre du bas), fond atmosphérique, boutons d'action (dégradé violet-cyan du kit),
champs, pastilles, notices et jetons de couleur de `packages/kit` ; l'effet Liquid Glass suit le réglage d'intensité
de MyLife. La couleur du module (`tone-perf`) ne sert qu'aux repères discrets (libellé de module, pastille de
navigation), comme pour MyFinances. Les maquettes chargent la feuille du kit telle quelle.

## 1. Le principe : un programme est une composition de quatre choix indépendants

Chaque créneau d'une séance (« squat, lundi ») est décrit par quatre axes qui ne se connaissent pas :

| Axe | Répond à | Exemples |
|---|---|---|
| **Exercice** | Quoi ? | Squat, tractions lestées, gainage, rameur |
| **Format** | Comment on l'exécute et ce qu'on note ? | Séries × reps × charge ; EMOM 10 min ; AMRAP 12 min ; 3 × 45 s au temps ; pour le temps ; circuit |
| **Progression** | Que prescrire la prochaine fois ? | % du 1RM, double progression, linéaire, libre, RPE/RIR (facultatif) |
| **Structure** | Quand, et dans quel contexte de semaine ? | Routine hebdomadaire sans fin ; cycle libre (nom, durée, logique) ; mésocycles périodisés |

Un **modèle** (preset) n'est qu'un jeu de ces choix, enregistré comme des données : « Streetlifting par blocs »
(le sien), « Routine simple en double progression », « Linéaire 5 × 5 », « Hypertrophie au RIR », « Callisthénie :
EMOM et au temps »… Un utilisateur choisit un modèle au départ ou part de zéro, et peut tout changer créneau par
créneau. Le moteur, lui, n'a aucun `if (streetlifting)`.

```
packages/training/
  exercise/     exercices, muscles, modèle de charge (externe, lesté, poids du corps, assisté)
  metrics/      les grandeurs suivies (charge, reps, temps, distance, tours, RPE, RIR, vitesse) et leurs unités
  format/       formats d'exécution (données) + minuteurs ; groupes (superset, circuit)
  progression/  stratégies de progression (une interface, plusieurs implémentations)
  reference/    référence 1RM : saisie, estimation, politique de calibration (paramètres)
  structure/    routine, cycle libre, périodisation → contexte du jour (bloc, semaine, décharge, modificateurs)
  presets/      les modèles livrés (données) ; jamais son programme réel
  engine/       planSession, reviewSession, capabilities : les trois portes d'entrée, pures
  analytics/    volume par muscle (direct/indirect), records par grandeur, plateaux, régularité
  import/       schéma JSON canonique, validation bornée, prompt pour une IA
```

Tout est du TypeScript pur, sans base ni écran ; testé avec Vitest.

## 2. Les grandeurs suivies (`metrics`)

Une grandeur = un identifiant, une unité, une saisie, un sens de progrès :

| Grandeur | Unité | Saisie | Mieux si |
|---|---|---|---|
| `load` | kg (lest net pour un lesté) | clavier intégré, ± incrément | plus |
| `reps` | reps | clavier | plus |
| `time` | s | minuteur ou clavier | plus (gainage) / moins (pour le temps) |
| `distance` | m | clavier | plus |
| `rounds` | tours | compteur | plus |
| `rpe` / `rir` | 1–10 / 0–5 | échelle | facultatif, jamais imposé |
| `speed` | 1–5 | échelle | **indicatif seulement, hors de tout calcul** |

Une série enregistrée porte les valeurs des grandeurs de son format (colonnes dédiées en base, voir § 8).
La vitesse de barre passe de 3 à **5 niveaux** ; les anciennes valeurs sont reprises (lente → 1, normale → 3,
rapide → 5).

## 3. Les formats (`format`)

Un format est une donnée, pas du code :

```ts
interface Format {
  id: string;
  name: string;                       // « Séries », « EMOM », « Gainage au temps », ou un format à soi
  metrics: MetricId[];                // ce qu'on note par série : ['load', 'reps'], ['time'], ['reps']…
  scheme: 'sets' | 'interval' | 'amrap' | 'hold' | 'for_time';
  timer: TimerSpec;                   // comportement du minuteur pendant la séance
}
type TimerSpec =
  | { kind: 'rest'; after: 'set' }                          // repos à la validation (classique)
  | { kind: 'interval'; everySec: number; totalSec: number } // EMOM / E2MOM : un top toutes les N s
  | { kind: 'countdown'; workSec: number }                  // gainage : décompte pendant l'effort
  | { kind: 'cap'; capSec: number }                         // AMRAP : temps limite, on compte les tours
  | { kind: 'stopwatch' };                                  // pour le temps : chrono qui monte
```

**Groupes** : un créneau peut appartenir à un groupe `superset` (A1/A2 alternés) ou `circuit` (N exercices, M
tours, repos entre les tours). Le repos se déclenche à la fin du groupe, pas de chaque exercice.

L'utilisateur crée ses formats dans l'éditeur (grandeurs à cocher, minuteur à choisir) : aucun code à toucher.
Les formats livrés sont des données d'exemple.

## 4. Les progressions (`progression`)

Une seule interface ; chaque stratégie déclare ses paramètres (l'éditeur se construit dessus) et ce dont elle a
besoin :

```ts
interface ProgressionStrategy<P> {
  id: 'percent_reference' | 'double_progression' | 'linear' | 'free' | 'autoregulated' | string;
  params: ParamSchema<P>;             // décrit les réglages : l'éditeur de créneau les affiche sans code dédié
  requires: Capability[];             // ex. ['reference'] pour le % du 1RM
  metric: MetricId;                   // la grandeur qui progresse : charge, reps, temps…
  prescribe(ctx: PlanContext, params: P): PlannedSet[];             // pur
  review(done: DoneSet[], planned: PlannedSet[], params: P): Suggestion[]; // « ↑ +2,5 kg », « mettre à jour le 1RM ? »
}
```

| Stratégie | Paramètres | Pour qui |
|---|---|---|
| `percent_reference` | séries par rôle (top, backoff…) : nombre, reps, % ; arrondi | lui (lifts principaux), powerlifting |
| `double_progression` | fourchette de reps, séries, incrément | accessoires, hypertrophie |
| `linear` | incrément par séance ou par semaine, échecs avant recul | débutants, 5 × 5 ; aussi sur `time` (+5 s) ou `reps` |
| `free` | aucun : on montre « dernière fois » | saisie libre |
| `autoregulated` | reps cibles @ RPE ou RIR ; charge suggérée depuis l'historique | ceux qui le veulent ; **jamais par défaut** |

Les règles de l'utilisateur sont des **paramètres** de ces stratégies : « une rep de moins → la charge suivante ne
change pas », « seules les séries ≤ 6 reps comptent pour la référence », « +2,5 % au plus par cycle à la S4 ».
Elles vivent dans son modèle, avec des tests qui les gardent.

## 5. La référence 1RM (`reference`)

Service à part, utilisé **seulement** si un créneau actif en a besoin (`requires: ['reference']`) :

- sources : 1RM saisi par l'utilisateur, sinon estimation (formule et seuil de reps en paramètres) ;
- politique de calibration (paramètres) : quand proposer une mise à jour (après un test, une S4…), plafond par
  cycle ; toujours une **proposition** (Appliquer / Garder), jamais automatique ;
- lestés : la masse totale (poids du corps + lest) sert **uniquement en interne**, pour la précision des %.
  À l'écran, en séance comme sur les fiches et dans les progrès, le 1RM de référence, les records et la saisie sont
  **toujours en lest net** (« 1RM réf. +50,8 kg »), jamais en masse totale ; le poids du corps n'apparaît qu'en petit
  repère modifiable à côté de la saisie (décision du 22/11).

Sans créneau au % du 1RM, la référence n'existe pas pour l'interface (aucune carte, aucune table de %).

## 6. La structure dans le temps (`structure`)

Trois formes, une seule sortie :

| Structure | Description |
|---|---|
| `routine` | semaine type répétée sans fin ; pas de bloc, pas de semaine numérotée |
| `cycle` | cycle libre : nom, durée en semaines ou en séances, répété ou non, modificateurs par semaine facultatifs |
| `periodized` | suite de blocs typés (accumulation, transmutation, réalisation, transition, ou type libre), semaines de travail + décharge, réglages par exercice et par semaine |

Chacune produit, pour une date, un **contexte du jour** que les stratégies lisent sans savoir d'où il vient :

```ts
interface DayContext {
  block: { name: string; kind: string; index: number; total: number } | null; // null pour une routine
  week: { index: number; of: number; deload: boolean } | null;
  modifiers: WeekModifiers;  // % de la semaine, facteurs de décharge (charge, volume), réglages par exercice
}
```

## 7. L'interface adaptative : les capacités (`engine/capabilities`)

C'est ce qui garantit « jamais de composant vide ni de concept étranger ». Le moteur calcule, pour le programme
actif et pour chaque créneau, l'ensemble des **capacités** réellement utilisées :

```ts
type Capability =
  | 'blocks' | 'weeks' | 'deload'                 // structure
  | 'reference' | 'percentages' | 'plates'        // % du 1RM, disques (barre + charge)
  | 'weighted'                                    // un lesté : lest net + poids du corps
  | 'rpe' | 'rir' | 'speed'                       // facultatifs, activés par l'utilisateur
  | 'metric:load' | 'metric:reps' | 'metric:time' | 'metric:distance' | 'metric:rounds'
  | 'timer:rest' | 'timer:interval' | 'timer:countdown' | 'timer:cap' | 'timer:stopwatch'
  | 'groups';                                     // supersets, circuits

capabilities(program, date): Set<Capability>      // pour les écrans (Jour, Programme, Progrès)
slotCapabilities(slot): Set<Capability>           // pour une carte d'exercice en séance (colonnes de la ligne)
```

Règle d'écriture des écrans : **chaque composant déclare la capacité qu'il exige** et ne s'affiche que si elle est
présente. Exemples :

| Composant | Exige | Sans elle |
|---|---|---|
| Frise des blocs, pastille « S3 · Accumulation » | `blocks` | rien (une routine montre la semaine type) |
| Colonne % sur une ligne de série, table de charges | `percentages` | la ligne montre kg · reps, ou les grandeurs du format |
| Carte « 1RM de référence », courbe e1RM | `reference` | records par grandeur (meilleure série, meilleur temps, tonnage) |
| Disques par côté | `plates` | rien |
| Lest net + poids du corps en repère | `weighted` | saisie de charge simple |
| Échelle RPE / RIR | `rpe` / `rir` | rien |
| Minuteur d'intervalle, décompte, chrono | `timer:*` | bandeau de repos classique |

Tests : pour chaque modèle livré, la liste exacte des capacités est figée (un modèle « routine » ne doit jamais
faire apparaître `blocks`), et un parcours de bout en bout vérifie qu'aucun écran ne montre de carte vide.

## 8. Les trois portes du moteur (`engine`)

```ts
planSession(program, date, history): SessionPlan   // la séance prescrite : groupes, créneaux, séries prévues, minuteurs
reviewSession(plan, done): SessionReview           // bilan : par créneau, par rapport au plan, et propositions
capabilities(program, date): Set<Capability>
```

Le module (écrans, stockage) n'appelle que ces trois fonctions et l'analytique.

**Garantie pour lui** : un test « golden » compare, semaine par semaine sur un programme fictif complet, la
prescription du modèle « Streetlifting par blocs » à celle du moteur actuel de MyPerf. Mêmes charges, mêmes séries,
même calibration, à la décimale près. Tant qu'il ne passe pas, P1 n'est pas fini.

## 9. Les données (base SQLite, synchro `perf`)

Évolution **additive** du schéma actuel (rien n'est renommé ni supprimé, migrations en ajout) :

- `exercises` : + modèle de charge (externe, lesté, poids du corps, assisté) et format par défaut ;
- `formats` (nouvelle) : les formats créés par l'utilisateur (définition en JSON validé) ;
- `template_exercises` (créneaux) : + format, stratégie et ses paramètres (JSON validé), groupe (superset/circuit) ;
  un créneau sans stratégie se lit comme aujourd'hui (top set + backoff ou double progression) ;
- `sets` : + `duration_s`, `distance_m`, `rounds`, `rpe`, `rir`, `speed` (1–5) ; `weight` et `reps` inchangés ;
- structure : les mésocycles actuels sont la forme `periodized` ; un réglage choisit la structure active ; table
  des cycles libres en plus.

Ses données existantes se lisent sans conversion : elles deviennent son modèle, à l'identique.

Transition : l'ancienne version web (`/perf/`) ignore les nouvelles colonnes. Tant qu'elle reste ouverte sur les
mêmes données, ne pas l'utiliser pour modifier une séance faite avec un nouveau format (elle réécrirait la ligne
sans les nouvelles valeurs). Elle est retirée à la bascule (P8), comme prévu.

## 10. Stockage local sûr (iPhone compris)

- **SQLite WebAssembly avec le système de fichiers « pool d'accès synchrones » (OPFS SAH Pool), dans un Worker** :
  ce mode **n'exige pas** les en-têtes COOP/COEP (seul le mode OPFS « classique » a besoin de `SharedArrayBuffer`).
  MyLife n'a donc pas à s'isoler (ce qui casserait d'autres choses) ; vérifié dès P1 sur Vercel et en parcours de
  bout en bout.
- **`navigator.storage.persist()`** demandé à la première ouverture ; l'état est visible dans les réglages
  (« Stockage protégé » ou non). Sur iPhone, l'app installée sur l'écran d'accueil échappe à l'effacement après
  7 jours d'inactivité de Safari : MyLife le rappelle tant qu'elle n'est pas installée.
- Repli : IndexedDB si OPFS manque (navigateur ancien).
- **Synchro chiffrée déclenchée à la fin de chaque séance** (et quand l'app passe en arrière-plan), en plus de la
  synchro habituelle.

## 11. Import universel

- **Schéma JSON canonique ouvert** `mylife.training.program/v1` : exercices, formats, structure, séances, créneaux
  avec leur format et leur stratégie. Documenté, versionné, validé strictement avec des bornes (taille, nombre de
  lignes, longueur des textes : les leçons du lot C).
- **« Copier le prompt »** dans l'app : un texte prêt pour n'importe quelle IA (le schéma + les consignes) ; on
  colle la réponse, l'app la valide.
- **Import assisté par Copilot** : coller un programme en texte libre ; Copilot le convertit au schéma canonique ;
  **écran de prévisualisation** (séances, exercices reconnus ou nouveaux, formats, progression) ; rien n'est écrit
  avant « Valider ».
- Le partage d'un programme exporte ce même schéma, sans historique ni donnée personnelle.

## 12. Les autres retours, intégrés au plan (sans maquette dans ce lot)

- **Aujourd'hui (3.2)** : « Démarrer la séance » toujours visible sans défiler, avec « Autre séance / Séance libre »
  à côté ; alerte d'agenda (MyRave) sur une ligne.
- **Bouton « + » de MyPerf** : un mini-menu prévisible (Séance libre, Poids du jour, Nouvel exercice) au lieu
  d'une action qui change selon l'onglet.
- **Fiche exercice (3.4)** : le 1RM de référence (celui qui pilote les charges) au moins au niveau du 1RM estimé ;
  filtre de période 1M / 3M / 6M / Tout sur la courbe ; sans référence (autre progression), records par grandeur.
- **Remplacer en séance** : « Uniquement aujourd'hui » ou « Mettre à jour le programme », toujours demandé.
- **Plateau voulu** : une alerte de plateau se masque (par exercice, jusqu'à la fin du cycle ou pour toujours).

## 13. Effet sur les étapes

| Étape | Change |
|---|---|
| P1 | + le moteur composable (axes, capacités, modèles), le golden test de son modèle, le schéma additif, `persist()`, OPFS SAH Pool sans COOP/COEP |
| P2 | + formats (séries, intervalle, au temps, AMRAP, pour le temps), supersets et circuits, bandeau de repos compact, clavier au toucher d'une cellule, lest net, vitesse 1–5, remplacer avec choix, synchro en fin de séance |
| P4 | + l'interface adaptative de Programme, l'éditeur de créneau (format, grandeurs, progression), l'import universel et Copilot |
| P5 | + carte anatomique réelle interactive, records par grandeur, plateau masquable, filtre de période |

Le reste du plan (P3, P6 à P8, risques, transition) est inchangé.
