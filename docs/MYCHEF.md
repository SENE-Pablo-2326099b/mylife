# MyChef : la quatrième vraie app de MyLife

> **Remplacé le 13/11/2026 par `docs/VISION.md`** (V5). Gardé pour l'historique.

> Rapport et plan, avant de coder. Rien n'est commencé : chaque étape attend ton feu vert.

## Le changement de cap

Tu veux peu d'apps, mais des vraies : **quatre à six apps hyper utiles**, faites une par une, et aucune nouvelle tant que
la précédente n'est pas finie. Les petites apps de l'accueil (MyGames, MyMusique, MyObjectifs, MyAgenda, MyFoyer,
« Mes apps ») partent. MyChef reste, mais devient **une app à part entière**, au niveau de MyFinances et MyPerf : son
propre écran d'accueil, sa navigation, ses réglages, sa démo, ses tests, et beaucoup plus de profondeur.

Ce plan remplace la suite de `docs/ROADMAP-V4.md` (phases C à F). Ce qui a été construit pour la V4 et qui sert encore
reste (synchro chiffrée, rappels écrits par l'appareil, actions validées, kit d'interface) ; le reste part avec les
petites apps.

---

## 1. Le ménage (avant MyChef)

### Ce qui part

| App de l'accueil | Ce qui disparaît |
|---|---|
| MyGames (+ « Ton temps ») | Écrans `/jeux` et `/temps`, ses lignes `games` |
| MyMusique | Écran `/musique`, ses lignes `music` (et le Wrapped s'il ne sert qu'à elle) |
| MyObjectifs | Écran, collection `objectifs`, outil Copilot `get_objectives` |
| MyAgenda | Écran, relais ICS (`/api/calendar`), collection `calendrier` |
| MyFoyer | Écran ; le foyer reste comme simple **partage de la liste de courses** dans MyChef |
| Mes apps | Créateur d'apps sans code, saisies, rappels par app, collection `miniapps` |

Avec elles partent leurs stats dans le Personnage (Savoir, Foyer…), leurs entrées dans la palette, l'export, la page
Confidentialité, et le générateur `npm run new-app` (fait pour fabriquer des petites apps en série).

### Leurs données
Les données sont chiffrées sur ton compte (et celui de tes éventuels testeurs). Je propose :
1. elles restent dans l'export « Mes données » le temps d'une version, pour que tu puisses les récupérer ;
2. à la version suivante, le serveur les efface (retrait de `SYNC_APPS`, purge des lignes de ces apps).

L'effacement est **définitif** : je ne le fais qu'après ton accord explicite.

### Ce qui reste à trancher (voir la fin du document)
L'accueil contient aussi des choses qui ne sont pas des « apps » au sens strict : **Sorties et Crew** (liés à MyRave),
le **Personnage** (le jeu par-dessus tes apps), le **Bilan**, **Copilot**. Je ne touche à rien de tout ça sans ta
réponse.

**Effort** : M (une session). **Tests** : toutes les suites, plus un parcours qui vérifie que l'accueil ne montre plus
que les vraies apps.

---

## 2. MyChef, l'architecture

### Une app à part, comme MyFinances
- **Nouveau dossier `apps/chef`** (React, Vite, le kit `packages/ui`), servi à l'adresse **`/chef/`** de MyLife par
  une réécriture, exactement comme `/finances/` et `/raveloc/`. Depuis la PWA de MyLife, on y entre d'un toucher et
  on revient à l'accueil comme pour MyFinances.
- **Sa propre navigation** : une barre d'onglets en bas (5 onglets, voir plus bas), ses réglages, son thème (mêmes
  composants que les autres apps, une couleur et une ambiance à elle : chaude, cuisine).
- **Hors ligne d'abord** : base locale sur l'appareil (IndexedDB, comme MyFinances), synchronisée chiffrée avec le
  compte MyLife (app de synchro `chef`, déjà déclarée côté serveur).
- **Tes données actuelles suivent** : MyChef lit la même app de synchro `chef` ; garde-manger, liste, recettes,
  planning et prix déjà saisis se retrouvent dans la nouvelle app sans rien faire.
- **Le partage avec le foyer** (liste de courses commune) passe dans un paquet partagé (`packages/`) pour que
  `apps/chef` s'en serve : aujourd'hui ce code vit dans l'accueil.
- **Le moteur** déjà écrit et testé (`chef.ts`, `recipes.ts`, `mealplan.ts`, `ticket.ts` : ~800 lignes et leurs
  tests) est repris tel quel : on ne repart pas de zéro, on change d'échelle sur l'interface.
- Un **compte neuf part de zéro** (règle « rien de personnel ») ; une **démo** chargeable comme dans MyFinances, pour
  tester et pour les captures.

### Côté déploiement
Un projet Vercel de plus (`mychef`), créé automatiquement au premier `npm run deploy:all` (je l'ajoute au script). Rien
d'autre à faire de ton côté.

---

## 3. MyChef, l'app

Cinq onglets. Pour chacun : ce qui existe déjà (dans l'écran actuel de l'accueil) et ce qu'il devient.

### Onglet 1 · Aujourd'hui (l'accueil de MyChef)
Ce que tu vois en ouvrant l'app, pensé pour répondre à « on mange quoi ? » en trois secondes.
- **Les repas du jour** (midi, soir) tirés du planning, avec « J'ai cuisiné », « On a mangé autre chose », « Restes ».
- **« Ce soir avec ce que j'ai »** : les trois meilleures recettes faisables tout de suite, celles qui sauvent un
  aliment qui périme en premier.
- **À finir vite** : ce qui périme dans les 3 jours, avec une idée de recette pour chacun.
- **À sortir du congélateur** pour demain.
- **Les courses** : combien d'articles, le coût estimé, un bouton « Je pars faire les courses ».
- **Ta semaine en un coup d'œil** : la bande des 7 jours, les trous à remplir.

### Onglet 2 · Courses
- **Plusieurs listes** (supermarché, marché, drive) et **tes magasins** : les rayons dans l'ordre de *ton* magasin
  (tu réordonnes une fois, c'est retenu par magasin).
- **Mode magasin** : plein écran, gros boutons, écran qui reste allumé, rayon par rayon, ce qui est pris glisse en bas ;
  le total estimé qui se met à jour.
- **Ajout rapide** : reconnaissance tolérante (déjà là), quantités, suggestions (ce que tu achètes souvent, ce qui
  manque pour la semaine, les indispensables bientôt finis).
- **Prix** : ceux de tes tickets, par magasin ; coût estimé de la liste, alerte « plus cher que d'habitude ».
- **Ticket de caisse** (déjà là) : collé ou photo → rangé au placard, retiré de la liste, prix retenus.
- **Historique des courses** : ce que tu as dépensé par semaine et par mois, par magasin ; les dépenses de courses
  peuvent remonter dans MyFinances (catégorie Alimentation), avec ton accord.
- **Partage avec le foyer** (déjà là) : une liste commune, ce que l'un coche entre dans le placard de l'autre.

### Onglet 3 · Placard
- **Par lieu** : frigo, congélateur, placard, (cave, autre) ; recherche et filtres.
- **Niveau simple ou quantité précise** (déjà là), dates de péremption proposées (déjà là), « à finir vite ».
- **Scan de code-barres** à la caméra : le produit est reconnu (base libre Open Food Facts : seul le code-barres part,
  rien d'autre) avec son nom, son rayon, sa photo ; et sa date de péremption saisie en un geste.
- **Inventaire rapide** : on passe le frigo en revue, un toucher par article (encore là / fini / presque fini).
- **Ce qui part à la poubelle** : noté en un toucher, avec un bilan du gaspillage par mois (et ce qu'il t'a coûté).
- **Restes** : un plat cuisiné devient un article du frigo, avec sa date.

### Onglet 4 · Recettes
- **Ta bibliothèque** : recherche, filtres (temps, faisable maintenant, à 1-2 ingrédients près, végé, sans four,
  batch), favoris, collections (« semaine », « invités »…), photo.
- **Import par lien** : colle l'adresse d'une recette (Marmiton, 750g, blogs…) → lue par le serveur de MyLife comme les
  agendas l'étaient (la plupart des sites publient la recette dans un format standard), sans IA, sans rien garder.
- **Import collé et par IA gratuite** (déjà là), **saisie à la main** avec un vrai éditeur (ingrédients, étapes,
  minuteurs détectés).
- **Fiche recette** : portions ajustables, ingrédients cochés selon ton placard, « ajouter les manquants », coût par
  portion (avec tes prix), tes notes (« moins de sel »), historique « cuisinée le… », note sur 5.
- **Mode cuisine** (déjà là) : une étape par écran, minuteurs multiples, écran allumé.
- **Une sélection de départ** plus large (une trentaine de recettes simples), pas les tiennes : un compte neuf a une
  bibliothèque utile sans rien de personnel.

### Onglet 5 · Semaine
- **Grille 7 jours** midi et soir, **glisser-déposer** d'une case à l'autre, déplacer ou échanger deux repas.
- **« Proposer ma semaine »** (déjà là) : sauve ce qui périme, varie, prévoit des restes ; garde ce que tu as déjà posé.
- **Batch cooking** : « je cuisine dimanche pour trois jours » → une seule session, les portions réparties.
- **Combien on est** à chaque repas (invités, enfants une semaine sur deux) : les quantités suivent.
- **Courses de la semaine** (déjà là) : tout ce qui manque, additionné, vers la liste.
- **Les soirs pris** : une sortie ou un rendez-vous (depuis MyRave / ton agenda) laisse le soir vide ; un jour de séance
  MyPerf met en avant les recettes riches en protéines.

### Partout
- **Réglages** : régime (végé, sans porc, sans gluten…), allergies (jamais proposées), nombre de personnes, jours de
  courses, magasins, unités.
- **Rappels** (déjà là, F2) : sortir du congélateur, ce qui périme demain, le jour des courses.
- **Copilot** (déjà là, F1) : il lit ta cuisine et propose ; tu valides, MyChef exécute.
- **Personnage** : la stat Vitalité (repas faits maison) continue de monter.

### Plus tard (pas dans cette version)
Nutrition (calories, protéines par repas, avec une table publique), suggestion de recettes par une IA à partir de ton
placard, partage d'une recette à un ami.

---

## 4. L'ordre de travail

Chaque étape : codée, testée (unitaires, de bout en bout, 320 px), notée dans `docs/V4.md`, commitée et poussée. Puis
**je m'arrête** pour que tu essaies avant de passer à la suivante (sauf si tu me dis d'enchaîner).

| # | Étape | Effort | Tu peux tester |
|---|---|---|---|
| 0 | **Ménage** : retirer les petites apps (données gardées dans l'export une version) | M | L'accueil épuré |
| 1 | **Squelette** : `apps/chef`, navigation 5 onglets, synchro `chef`, tes données actuelles reprises, ancien écran retiré, déploiement | L | MyChef s'ouvre comme MyFinances, avec tes données |
| 2 | **Courses** : listes et magasins, mode magasin, prix et historique, ticket, foyer | L | Une vraie course au supermarché |
| 3 | **Placard** : lieux, code-barres, inventaire rapide, gaspillage, restes | L | Ranger les courses en scannant |
| 4 | **Recettes** : bibliothèque, filtres, import par lien, éditeur, fiche, mode cuisine | L+ | Importer tes recettes préférées |
| 5 | **Semaine** : grille glisser-déposer, batch cooking, convives, liens MyRave et MyPerf | L | Planifier une vraie semaine |
| 6 | **Aujourd'hui et finitions** : l'écran d'accueil de l'app, réglages et régimes, rappels, démo, accessibilité, MyFinances | M | L'app complète, au quotidien |

Ordre choisi : le squelette d'abord (tout le reste s'y branche), puis ce qui sert **chaque semaine** (courses,
placard), puis ce qui donne envie (recettes, semaine), et l'écran Aujourd'hui en dernier parce qu'il résume tous les
autres.

---

## 5. Ce que j'ai besoin que tu tranches

1. **Sorties et Crew** (inviter des amis à une soirée, planning, budget, sac commun ; niveaux entre amis) : on les
   garde dans l'accueil, on les rattache à MyRave, ou ils partent aussi ?
2. **Personnage et Bilan** (le jeu de stats par-dessus tes apps, le bilan de la semaine) : on garde ?
3. **Copilot** (l'assistant qui lit tes apps et propose des actions) : on garde ?
4. **Les données des apps retirées** : export une version puis effacement (ma proposition), ou effacement tout de suite ?
5. **Arrêt après chaque étape** pour que tu testes (ma proposition), ou j'enchaîne les étapes de MyChef ?
