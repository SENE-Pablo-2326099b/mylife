# MyLife : la vision (V5)

> Document de référence, décidé le 13/11/2026. Il remplace la suite de la feuille de route V4 et le plan
> MyChef (archivés dans `docs/archives/`). Toute nouvelle décision importante s'ajoute ici (section « Décisions »).

## Pourquoi ce document

En cinq semaines, MyLife a grandi vite : environ 95 000 lignes, trois apps, un accueil et une vingtaine de fonctions
empilées (Personnage, Wrapped, Crew, Pacte, MyGames, MyMusique, Objectifs, Agenda, Foyer, Chef, « Mes apps »…).
Aucune n'a été utilisée assez longtemps pour savoir si elle sert. MyFinances, MyPerf et MyRave ne sont pas terminées :
le visuel est soigné, mais l'ergonomie n'est pas au niveau d'une app qu'on a envie d'ouvrir chaque jour.

On change d'approche : **moins, mais excellent**. On réfléchit avant de coder, on termine avant d'ajouter.

---

## 1. Ce qu'est MyLife

**Ton environnement numérique personnel, pour des années.** Un accueil qui répond à « qu'est-ce qui compte
maintenant ? », et quelques modules profonds, chacun excellent dans son domaine.

- **Pour toi d'abord, ouvert aux autres** : chacun crée son compte, choisit ses modules, et part de zéro.
- **Sans but commercial** : ni publicité, ni traceur, ni analytique. Juste utile, durable et agréable.
- **Évolutif** : un nouveau module doit pouvoir s'ajouter dans cinq ou dix ans aussi simplement qu'aujourd'hui, sans
  refonte générale.

### Ce que MyLife n'est pas
- Pas une pile d'apps assemblées : un seul produit, une seule façon de faire.
- Pas un jeu : pas de points, de niveaux ni de classements pour remplir l'écran.
- Pas une vitrine de fonctions : une fonction qui ne sert pas chaque semaine n'a pas sa place.

---

## 2. Les principes (ils tranchent les débats)

1. **Moins mais mieux.** Avant d'ajouter, on se demande ce qu'on enlève. Chaque ligne de code est une ligne à
   maintenir pendant des années.
2. **Chaque écran répond à une question.** « Combien je peux dépenser ? », « Qu'est-ce que je fais aujourd'hui à la
   salle ? ». La réponse se voit en trois secondes ; l'action principale saute aux yeux.
3. **Le quotidien d'abord.** On soigne ce qui sert tous les jours avant ce qui sert une fois par mois.
4. **Tes données t'appartiennent.** Elles vivent sur ton appareil, voyagent chiffrées, s'exportent en clair dans un
   format documenté. Le serveur ne sait pas les lire.
5. **Les données durent plus longtemps que le code.** Le code sera réécrit plusieurs fois en dix ans ; les données,
   elles, doivent survivre à chaque réécriture (formats versionnés, migrations, export).
6. **Cohérent, pas uniforme.** Mêmes composants, même structure d'écran, même vocabulaire ; chaque module a sa couleur
   et sa navigation.
7. **Simple aujourd'hui, ouvert demain.** On ne construit pas pour des besoins hypothétiques ; on garde juste les
   portes ouvertes (contrat de module, formats de données).
8. **Fini veut dire fini** (voir § 7). Un module à moitié fait vaut moins que pas de module.

Règles inchangées : rien de personnel chez un autre compte ni dans ce qui est livré, jamais de secret affiché, la clé
d'API Anthropic reste sur l'appareil, dépôt privé.

---

## 3. Le périmètre de la V5

| On garde et on rend excellent | On retire | Gelé (pas jeté) |
|---|---|---|
| **MyFinances** | Personnage, Bilan, Wrapped | **MyChef** : son moteur (recettes, planning, ticket) est gardé dans le dépôt, hors de l'app, jusqu'à la fin de la phase 6 |
| **MyPerf** | Crew, Pacte | |
| **MyRave**, qui accueille les **Sorties** | MyGames, « Ton temps », MyMusique | |
| **Copilot**, devenu un service commun | MyObjectifs, MyAgenda, MyFoyer | |
| L'accueil, entièrement repensé | « Mes apps » et le générateur `new-app` | |
| | 4 des 5 thèmes, 6 des 8 polices, les cartes en relief | |

**Données des fonctions retirées** : elles restent dans l'export « Mes données » pendant une version, puis le serveur
les efface (retrait de `SYNC_APPS`, purge). L'effacement est définitif : il attend un dernier accord explicite au
moment de le faire.

**L'APK Android de MyPerf est retirée** (21/11/2026) : MyPerf n'existe plus qu'en web, et MyLife s'installe comme PWA
sur Android comme sur iPhone.

---

## 4. L'architecture cible

### La décision : une seule app web, un seul déploiement

Aujourd'hui : 4 projets Vercel recollés par des réécritures, du code partagé **copié** dans chaque app
(`npm run vendor`), et deux technologies d'interface (React web, Expo/React Native pour MyPerf). C'est ce qui coûtera
le plus cher sur dix ans.

Demain : **une seule app React (Vite, TypeScript), installable (PWA), un seul projet Vercel**. La modularité est
**dans le code** (des modules isolés), pas dans le déploiement. Chaque module est chargé à la demande : l'ouverture
de l'accueil ne charge pas MyPerf.

Pourquoi maintenant : l'interface est refaite de toute façon. C'est le seul moment où unifier la technologie ne coûte
presque rien de plus. Les règles métier (`domain/`, TypeScript pur et testé) se reprennent telles quelles.

Ce qu'on perd sur le web : le retour haptique sur iPhone et la localisation en arrière-plan (MyRave est déjà une app
web : pas de régression). Si un jour le natif devient indispensable, on emballe la même app (Capacitor) plutôt que
d'entretenir deux codes.

### L'organisation du dépôt

```text
MyLife/
├── app/                 La coquille : routes, compte, accueil, catalogue des modules, réglages, Copilot,
│                        notifications, ajout rapide, recherche
├── modules/
│   ├── finances/        module.ts (le manifeste), domain/, data/, ui/, tests/
│   ├── perf/
│   └── rave/
├── packages/
│   ├── core/            Compte, chiffrement, synchro, stockage local, migrations (ex-sync-client)
│   └── ui/              Le design system : jetons, composants, mises en page
├── server/, api/        Inchangés dans l'esprit : cœur indépendant de Vercel, adaptateurs HTTP
├── docs/                VISION.md, ARCHITECTURE.md, formats/ (formats d'export), décisions
└── tests/               Parcours de bout en bout de toute l'app
```

- **Espaces de travail npm** : `packages/*` et `modules/*` sont de vrais paquets importés. **Plus aucune copie**,
  plus de `npm run vendor`.
- **Règle de dépendance, vérifiée par le linter** : un module importe `packages/*` et son propre dossier, **jamais un
  autre module**. La coquille ne connaît les modules que par leur manifeste.

### Le contrat de module (court, volontairement)

Chaque module exporte un manifeste `module.ts` :

| Champ | Rôle |
|---|---|
| `id`, `nom`, `icône`, `couleur` | Identité dans le catalogue et la navigation |
| `routes` | Ses écrans, chargés à la demande |
| `cartes` | Ce qu'il propose à l'accueil (« budget du jour », « séance prévue »…) |
| `réglages` | Sa section dans les réglages communs |
| `collections` | Ses données synchronisées, chacune avec sa **version** et ses **migrations** |
| `export` | Son export lisible, au format documenté dans `docs/formats/` |
| `copilot` | Les outils qu'il prête à Copilot (lecture, actions à valider) |
| `publie` | Ce qu'il partage avec les autres (événements d'agenda, faits du jour) |

### Comment les modules se parlent
Jamais directement. Un module **publie** des informations dans un format commun (un événement d'agenda, un fait du
jour) ; un autre les **lit** sans savoir qui les a écrites. Exemple : MyRave publie « sortie samedi », MyPerf le lit
et propose de ne pas faire jambes vendredi. C'est l'agenda commun et les actions validées de la V4, simplifiés.

On ne construit **pas** de système de permissions entre modules : tout le code est le nôtre. On y pensera le jour où
un module viendrait d'ailleurs.

### Ce qu'on garde de l'existant
- Le **local-first chiffré de bout en bout** (`sync-client` → `packages/core`), la clé de secours, la synchro par
  lignes.
- Le serveur hexagonal, ses tests sur Postgres en mémoire.
- Les **identifiants de synchro** (`finances`, `perf`, `raveloc`…) : ils ne changent pas. Tes données actuelles
  reviennent dans la nouvelle app par la synchro du compte, sans manipulation.
- Les adresses `/finances`, `/perf`, `/raveloc` redirigent vers les nouvelles routes.

---

## 5. Le design

### Le constat
Le verre violet sombre est joli, mais tous les écrans se ressemblent, le texte secondaire est petit et gris, et
beaucoup d'informations sont au même niveau. Le soin est allé à la décoration plutôt qu'à la hiérarchie.

### La direction
- **Sobre et lisible** : un thème clair et un thème sombre, bien faits, qui suivent le téléphone. Une police
  d'interface (deux au plus, une pour les chiffres).
- **Une hiérarchie nette** : un titre, un chiffre ou une réponse principale, une action principale ; le reste est
  secondaire et le paraît.
- **Une échelle stricte** : tailles de texte, espacements (multiples de 4), rayons, ombres. Aucune valeur en dur dans
  un module.
- **La même structure d'écran partout** ; chaque module a sa couleur d'accent et sa barre de navigation.
- **Mobile d'abord, vrai ordinateur ensuite** : barre du bas sur téléphone, barre latérale sur grand écran.
- **Animations utiles seulement** : elles expliquent un changement, elles ne décorent pas.
- **Accessible** : contrastes suffisants, cibles de 44 px, lisible à 320 px, utilisable au clavier.

### La méthode
**Maquettes avant le code.** Pour chaque phase d'interface : les écrans clés en maquettes, tu valides, puis je code.
Une page « kit » interne montre tous les composants dans leurs états (vide, chargement, erreur, plein) : c'est la
référence qui garde l'ensemble cohérent dans le temps.

---

## 6. Ce que j'ajoute à l'écosystème (idées retenues)

Ces idées renforcent la base sans la compliquer ; elles sont intégrées au plan.

1. **L'accueil « Aujourd'hui », fait de cartes.** Fini le lanceur d'apps : chaque module actif propose ses cartes, et
   tu choisis et ordonnes les tiennes. Un module inactif n'apparaît nulle part.
2. **L'ajout rapide, partout.** Un seul bouton « + » pour noter une dépense, une séance, une sortie, sans chercher dans
   quel module aller. Chaque module y déclare ses saisies. C'est ce qui fait gagner le plus de temps au quotidien.
3. **Une seule boîte « À faire ».** Alertes et rappels de tous les modules au même endroit, au lieu d'une cloche par
   app ; et les notifications du téléphone en partent.
4. **Des sauvegardes qui ne dépendent pas de toi.** En plus de la synchro : une sauvegarde chiffrée complète,
   proposée automatiquement chaque semaine, restaurable sur un appareil neuf ; formats d'export documentés
   (`docs/formats/`). C'est la vraie garantie « pour la vie ».
5. **Une porte de sortie de l'hébergeur.** Le serveur doit pouvoir tourner hors de Vercel (un Postgres et un
   conteneur), documenté et testé une fois. Si Vercel change ses règles dans cinq ans, MyLife continue.
6. **« Signaler un souci » dans l'app** (sans traceur) : un message court avec la version et l'écran, envoyé seulement
   si la personne le décide. Indispensable pour la phase 6.

### Plus tard (noté, pas planifié)
- Un historique consultable de ta vie dans MyLife (dépenses, séances, sorties sur des années), avec recherche.
- La connexion par passkey quand elle sera fiable partout.
- La mémoire visible de Copilot (ce qu'il retient de toi, que tu peux modifier et effacer).
- Une page « Nouveautés » dans l'app, quand d'autres personnes l'utiliseront.
- De nouveaux modules, un à la fois : MyChef d'abord ; puis selon tes besoins (santé, voyage, logement…).

---

## 7. La définition de « fini » pour un module

Un module n'est pas fini tant qu'il ne coche pas tout :

- [ ] ses parcours principaux se font en peu de gestes, et ils sont listés et testés de bout en bout ;
- [ ] premier lancement guidé, écrans vides soignés, erreurs expliquées en français clair ;
- [ ] marche hors ligne, se synchronise entre deux appareils sans perte ni doublon ;
- [ ] ses données ont une version, des migrations testées, un export documenté ;
- [ ] lisible à 320 px, confortable sur ordinateur, contrastes et cibles respectés ;
- [ ] rien de personnel dans ce qui est livré ; un compte neuf part de zéro ;
- [ ] ses cartes d'accueil, ses saisies rapides et ses outils Copilot fonctionnent ;
- [ ] **tu l'as utilisé toi-même deux semaines sans frustration.**

---

## 8. Le plan

Chaque étape : codée, testée, notée dans le journal `docs/V5.md`, commitée et poussée ; puis **arrêt pour que tu
testes**.

| Phase | Contenu | Tu peux tester |
|---|---|---|
| **0. Décider** | Ce document | — |
| **1. Ménage** | Retirer tout ce qui part (§ 3) dans l'existant ; données gardées dans l'export une version | L'app actuelle, épurée |
| **2. Fondation** | Espaces de travail npm, `packages/core` et `packages/ui` importés (plus de copies), la coquille `app/`, le contrat de module, le nouveau design system (**maquettes validées d'abord**), page « kit », un seul projet Vercel, redirections | La nouvelle coquille : compte, accueil, réglages, avec un module vide |
| **3. MyFinances** | Inventaire de l'existant (on garde, on fusionne, on retire), tes tâches réelles, maquettes, puis le module refait dans la fondation, avec ses cartes, ses saisies rapides, ses outils Copilot | Ton budget au quotidien dans la nouvelle app |
| **4. MyPerf** | Même démarche ; passage d'Expo au web (le domaine repris tel quel), séance en salle soignée (écran allumé, minuteurs, notifications) | Une vraie séance |
| **5. MyRave + Sorties** | Même démarche ; les Sorties deviennent une partie de MyRave | Une vraie soirée |
| **6. Ouverture** | Sauvegardes automatiques, porte de sortie de l'hébergeur, « Signaler un souci », page légale à jour ; 3 à 5 personnes l'utilisent deux semaines ; on corrige | — |
| **Ensuite** | Un nouveau module à la fois, MyChef d'abord, chacun « fini » avant le suivant | — |

Pendant les phases 2 à 5, l'ancienne version reste en ligne : on ne remplace la production que quand la nouvelle
coquille et MyFinances sont prêtes, puis module par module.

---

## 9. Risques

- **Tout refaire et ne rien finir.** Parade : une app pilote (MyFinances) menée jusqu'au bout avant de toucher aux
  autres, et la définition de « fini ».
- **Perdre des données en route.** Parade : identifiants de synchro inchangés, points de restauration, migrations
  testées sur une copie réelle de tes données (sur ton appareil, jamais livrée).
- **Recommencer à s'éparpiller.** Parade : ce document ; toute nouvelle idée va dans « Plus tard » tant que la phase en
  cours n'est pas finie.
- **Le web ne suffit pas pour MyPerf ou MyRave.** Parade : on le saura en phase 4 ; Capacitor reste possible sans
  changer de code.

---

## 10. Décisions

| Date | Décision |
|---|---|
| 13/11/2026 | Moins mais excellent : MyFinances, MyPerf, MyRave (+ Sorties) et Copilot ; le reste part ou est gelé (§ 3) |
| 13/11/2026 | Une seule app web (PWA), un seul déploiement ; fin d'Expo et des copies de code partagé |
| 13/11/2026 | Ordre : MyFinances d'abord, puis MyPerf, puis MyRave |
| 13/11/2026 | MyChef gelé jusqu'à la fin de la phase 6 ; son moteur est gardé |
| 13/11/2026 | Données des fonctions retirées : dans l'export une version, puis effacées (dernier accord avant l'effacement) |
| 13/11/2026 | Maquettes validées avant chaque phase d'interface |
| 13/11/2026 | Design : verre fumé et cartes de module à bord en dégradé (maquettes validées, `docs/V5.md` 2.1) ; remplace le parti pris « sobre » du § 5 |
| 13/11/2026 | Les écrans des modules (MyFinances, MyPerf, MyRave) seront repensés de zéro, fonctionnellement et visuellement : aucun ancien écran n'est porté |
| 13/11/2026 | La nouvelle coquille est servie à `/v5/` à côté de l'ancien accueil jusqu'à ce qu'elle le remplace |
| 13/11/2026 | Phase 1 : thèmes en trop et cartes en relief reportés à la phase 2 (le design system y est refait entièrement) |
| 13/11/2026 | Phase 1 : données des fonctions retirées gardées dans le compte, récupérables par « Mes données » → « Télécharger l'archive » |
| 21/11/2026 | L'APK Android de MyPerf ne doit plus exister : MyPerf est web seulement (plus de projet Android, de build ni de code propre au téléphone) ; ses dernières branches natives partent avec Expo en phase 4 |
