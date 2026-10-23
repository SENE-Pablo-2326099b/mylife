# MyLife : contexte complet (accueil + MyFinances + MyPerf + myRaveLoc)

> **À lire au début d'une nouvelle conversation.** Ce fichier résume l'écosystème : architecture, dépôt,
> commandes, décisions, contraintes, état actuel au **22/10/2026**. Une seule copie, à la racine du dépôt
> `~/PersoDev/MyLife` ; la mettre à jour après toute évolution importante.
>
> Documents plus détaillés :
> - `README.md` (présentation, utilisation, développement) ; `docs/UNIFICATION.md` (choix notés) ;
> - `apps/finances/README.md`, `apps/finances/V2.md` ;
> - `apps/perf/CLAUDE.md`, `apps/perf/README.md`, `apps/perf/ERGONOMIE.md` ;
> - `apps/raveloc/README.md` (architecture, sécurité, données visibles par le serveur, limites).

---

## 1. Vue d'ensemble

**MyLife est une seule app** (une PWA installable, un compte, une identité visuelle) servie sur **une seule
origine** : https://mylife-liart.vercel.app

| Chemin | Partie | Dossier du dépôt | Projet Vercel | Techno |
|---|---|---|---|---|
| `/` | **Accueil MyLife** : apps + aperçus, compte, apparence, installation, premier lancement ; **manifeste unique** (portée `/`, raccourcis vers les 3 apps) | `web/` | `mylife` | React 18 + Vite + kit `packages/ui` |
| `/api/auth`, `/api/sync`, `/api/raveloc` | Comptes, synchro chiffrée, API de myRaveLoc | `api/`, `server/` | `mylife` | Fonctions Vercel + Neon Postgres |
| `/finances/` | **MyFinances** (budget, banques, patrimoine) | `apps/finances` | `myfinances` (https://myfinances-sepia-sigma.vercel.app) | React 18 + Vite + TS + Tailwind + Dexie |
| `/api/eb` | Relais Enable Banking + cours des placements | `apps/finances/api/eb.ts` | `myfinances` | Fonction Vercel |
| `/perf/` | **MyPerf** (musculation) | `apps/perf` | `myperf` (https://myperf-six.vercel.app) | Expo / React Native (React 19) + SQLite ; web + APK Android |
| `/raveloc/` | **myRaveLoc** (retrouver ses amis en festival) | `apps/raveloc` | `myraveloc` (https://myraveloc.vercel.app) | React 18 + Vite + kit `packages/ui` |

**Fonctionnement :**
- **Un seul dépôt git** (`~/PersoDev/MyLife`, historiques des quatre anciens dépôts conservés par `git subtree`) ;
  dépôt GitHub **privé** (il contient le programme et l'historique d'entraînement de l'utilisateur).
  Les anciens dossiers sont archivés dans `~/PersoDev/_archives/avant-depot-unique/` (plus utilisés).
- Chaque app reste un **projet Vercel à part**, déployé depuis son dossier ; les chemins sont des
  **réécritures** déclarées dans `vercel.json` (racine). Pas d'espace de travail npm : chaque dossier a ses
  `node_modules` (React 18 contre 19).
- **Une seule app installable** : seul l'accueil a un manifeste ; les pages des apps relient
  `/manifest.webmanifest` et `/apple-touch-icon.png`. Chaque app garde son service worker (sa portée).
  Passage d'une app à l'autre en fondu (`@view-transition`, Chrome 126+ / Safari 18.2+).

**Appareils de l'utilisateur :** PC (Windows + WSL) ; Android (MyLife en PWA, MyPerf aussi en APK) ;
iPhone plus tard (PWA).

**Contexte d'usage :** l'utilisateur et, bientôt, ses amis : l'inscription est ouverte (sans code).

---

## 2. Commandes essentielles

### Racine (`~/PersoDev/MyLife`)

| Action | Commande |
|---|---|
| Dépendances (racine + 3 apps) | `npm run setup` |
| Copier les paquets partagés | `npm run vendor` (ou `npm run vendor -- finances raveloc`) : `packages/sync-client` → `src/vendor/mylife-sync`, `packages/lumen` → `src/vendor/lumen` (toutes les apps), `packages/ui` → `src/ui` (accueil, MyFinances, myRaveLoc). **On modifie toujours dans `packages/`, jamais dans les copies.** |
| Tout construire | `npm run build:all` |
| Tests serveur + paquets | `npm test` (vitest, **42 tests**, Postgres en mémoire via PGlite) |
| Tous les tests unitaires | `npm run test:all` |
| **Parcours de bout en bout de tout MyLife** | `npm run e2e` (**11 étapes** : bienvenue, compte en un écran, manifeste unique relié partout, session commune, MyFinances et MyPerf reliés tout seuls, thème commun, Espaces, aperçus, palette vers les autres apps, second appareil dont le thème suit, 320 px). Prérequis : les trois apps construites. |
| Tous les parcours | `npm run e2e:all` |
| MyLife en local | `npm run local` → http://localhost:4300 (accueil + apps construites + vraies API, base en mémoire, inscription ouverte) |
| Accueil en développement | `npm run dev` (port 4310, `/api` relayé vers `npm run local`) |
| Icônes MyLife | `npm run icons` (depuis `web/public/favicon.svg`) |
| **Déployer** | `npm run deploy` (MyLife : accueil + API) ; `npm run deploy:all` (les 3 apps puis MyLife) |

**Après chaque déploiement d'une app, redéployer MyLife.** Sinon le CDN de MyLife peut garder un 404 obtenu pendant la mise en ligne.

### MyFinances (`apps/finances`)

| Action | Commande |
|---|---|
| Développement | `npm run dev` (lance aussi le relais local) |
| Types / lint | `npx tsc -b --noEmit` / `npx eslint src --quiet` |
| Tests | `npm test` (**332 tests**) |
| **Bout en bout** | `npm run e2e` (**25 vérifications**). À lancer avant tout déploiement d'interface. |
| Déployer | `npm run deploy` |

### MyPerf (`apps/perf`)

| Action | Commande |
|---|---|
| Types / lint / tests | `npx tsc --noEmit` / `npx expo lint` / `npx jest` (**214 tests**) |
| Aperçu web | `npx expo start --web --port 8090` (sans `CI=1`) |
| **Web** | `npm run build:web && npm run deploy:web` (sortie dans `web/perf`) |
| **APK** | `cd android && ANDROID_HOME=~/android-sdk ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2`, puis copier `android/app/build/outputs/apk/release/app-release.apk` vers `/mnt/c/Users/qwark/Downloads/MyPerf-MyLife.apk`. Après le passage au dépôt unique, un `./gradlew clean` peut être nécessaire (chemins absolus en cache). |

Pour l'APK, utiliser **2 workers** : avec 4, WSL tue la compilation faute de mémoire (code 137).

### myRaveLoc (`apps/raveloc`)

| Action | Commande |
|---|---|
| Types / lint | `npx tsc -b --noEmit` / `npx eslint .` |
| Tests | `npm test` (**83 tests**, importe l'API et l'authentification de la racine) |
| **Bout en bout** | `npm run e2e` : deux téléphones simulés (Alice, Bob), **13 étapes**. `SHOTS=dossier` pour des captures. |
| Local | `npm run build && npm run local` → http://localhost:4320/raveloc/ (serveur local de MyLife) |
| Déployer | `npm run deploy` ; l'API part avec MyLife |

### Commits

- Messages en français, descriptifs (une phrase longue qui liste les changements).
- Ils se terminent par :
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## 3. MyLife : comptes et synchronisation chiffrée de bout en bout

### API (`server/`, points d'entrée dans `api/`)

- `POST /api/auth` (`server/auth.ts` → `authDispatch`) : sans session `salt`, `available` (identifiant
  libre ?), `signup`, `login`, `recoverStart` / `recoverFinish` ; avec session `password`,
  `renewRecovery` (nouvelle clé de secours), `deleteAccount` (mot de passe redemandé ; efface le compte, ses
  lignes et quitte ses groupes myRaveLoc).
- `POST /api/sync` (`server/sync.ts`) : `status`, `sync`. Apps synchronisées : `finances`, `perf`, `mylife`
  (réglages communs : l'apparence).
- `POST /api/raveloc` : API de myRaveLoc (voir § 6 bis).
- Le même code sert en local (`server/local.ts`, `npm run local`) et dans les tests.

### Inscription « comme une app ordinaire »

- **Un écran** : identifiant (disponibilité affichée pendant la saisie) + mot de passe (bouton afficher,
  jauge de robustesse, refus des mots de passe trop courants ou contenant l'identifiant ; `autocomplete`
  `username` / `new-password` pour les gestionnaires). Pas de confirmation, **pas de code d'invitation**
  (`SIGNUP=open` par défaut ; `SIGNUP=invite` remet le code).
- La **clé de secours** est montrée juste après la création (copier / enregistrer / partager), et
  rappelée (« Mets de côté ta clé de secours ») tant que « C'est fait » n'a pas été touché ; elle est gardée
  sur l'appareil en attendant (`mylife:recovery-pending`).
- Garde-fous (`RATES` dans `server/core.ts`, table `auth_rate`) : 10 comptes par réseau et par jour (empreinte
  HMAC de l'adresse, jamais l'adresse), 10 mauvais mots de passe ou clés par quart d'heure et par
  identifiant (puis 429), 120 vérifications de disponibilité par heure ; quotas `ROW_QUOTA` (100 000 lignes
  par app, 200 pour `mylife`).
- Dérivation **native** (WebCrypto) sur le web et dans Node : ~0,1 s ; en JavaScript sur Android (même
  résultat, testé).

### Chiffrement

- Le mot de passe ne quitte jamais l'appareil. PBKDF2-SHA256 (200 000 tours) → HKDF : clé
  d'authentification (le serveur n'en garde qu'une empreinte HMAC) et clé d'emballage de la **clé de
  données** (aléatoire). Chaque ligne en AES-256-GCM, liée à `app/table/identifiant`. Clé de secours = 2ᵉ
  emballage.

### Session et reliure des appareils

- Sur le web, une session pour toutes les apps (`mylife-session`, `packages/sync-client/src/web.ts`) ; se
  déconnecter dans une app déconnecte les autres, onglets ouverts compris. Écrans de compte communs :
  `packages/ui/src/account.tsx` (MyPerf en a la copie React Native, `apps/perf/src/app/account.tsx`).
- **Reliure automatique** (`autoJoin`) dès qu'une session apparaît : données d'un **autre compte** sur
  l'appareil → effacées (`LocalStore.forget`, mot de passe du relais compris), jamais envoyées ni montrées,
  l'appareil prend ce que contient le compte (rien pour un compte neuf) puis la page se recharge ; appareil
  sans données saisies → il prend celles du compte (ou y envoie ses valeurs par défaut si le compte est
  neuf) ; données saisies hors de tout compte → l'utilisateur choisit (compte neuf : « Partir de zéro »
  proposé d'abord, ou « les mettre dans mon compte » ; copie de sécurité avant d'effacer). Jamais de fusion.
  « Données saisies » : MyFinances = accueil fait ou opérations/placements/banques ; MyPerf = séances après
  la fin de l'historique personnel importé (build privé). Tant que l'appareil n'est pas relié au compte de la
  session, le portail (`AccountGate`, `linked`/`linking`) couvre l'app : jamais un écran avec les données
  d'un autre compte, même un instant.
- **Un appareil, plusieurs comptes** : à chaque connexion, `claimDevice` (`packages/sync-client/src/device.ts`)
  efface ce que le navigateur garde pour la personne précédente hors synchro (clé d'API Anthropic, conversation
  de l'assistant, aperçus de l'accueil, dates de sauvegarde, journaux d'erreurs) ; propriétaire noté dans
  `mylife:device-owner`. Sur Android, MyPerf efface la clé d'API du trousseau. Avant de se déconnecter, les
  apps envoient leurs dernières modifications.
- Conflits : la modification la plus récente gagne.
- **Personnage (V3, étape 1)** : moteur pur `packages/lumen/src/character.ts` (niveaux, quêtes, série, entièrement
  recalculé depuis des compteurs par semaine). Chaque app publie ses compteurs (`stats/<app>` de l'app de synchro
  `mylife`, chiffrés, jamais de montant) : MyFinances `domain/rpgStats.ts`, MyPerf `services/rpgStats.ts` (Android :
  via `services/cloud/prefs.ts`), myRaveLoc `App.tsx` (fusionné : ses groupes expirent). Web : `packages/ui/src/stats.ts`
  (`publishStats`, `useCharacter`). Écran : `web/src/pages/Character.tsx` (carte de l'accueil, `/personnage`).
  Bilans (V3, étape 2) : `timeline` et `recap` dans le même moteur ; `web/src/pages/Recap.tsx` (cartes du dimanche et
  du début de mois, `/bilan`), `Wrapped.tsx` (stories, `/wrapped`), `web/src/wrappedImage.ts` (image partagée).
  Espaces partagés (V3, étape 3) : `server/space.ts` (`/api/space`, tables `space*`), client
  `packages/sync-client/src/space.ts` ; Crew : `packages/lumen/src/crew.ts`, `web/src/crew.ts`, `web/src/pages/Crew.tsx`.
  Sorties (V3, étape 4) : `packages/lumen/src/sortie.ts`, `web/src/pages/Sortie.tsx`, hors ligne `web/src/spaceSync.ts`.
  MyMusique (V3, étape 5) : `packages/lumen/src/music.ts`, `web/src/pages/Music.tsx`, `web/src/zip.ts`.
  Journal complet : `docs/V3.md`.
- **Apparence synchronisée** entre appareils (app `mylife`, `packages/ui/src/prefsSync.ts` et
  `apps/perf/src/services/cloud/prefs.ts`) : une ligne datée du choix (`at`), la plus récente gagne, un
  thème jamais choisi (at = 0) n'est jamais envoyé.

### Base et variables

- Neon Postgres. Tables `users`, `records`, `auth_rate`, `raveloc_*`, créées au premier appel.
- Variables (**ne jamais afficher leurs valeurs**) : `DATABASE_URL` ; `SESSION_SECRET` (aussi sur
  `myfinances` ; sensible, illisible sur Vercel) ; `SIGNUP` ; `INVITE_CODE` (seulement en mode invitation).
- Fichier local : `.env.local` (racine).

### Suivi des modifications dans chaque app

- **MyFinances :** middleware Dexie (`src/sync/cloud`). **MyPerf :** déclencheurs SQLite
  (`src/services/cloud/sqliteStore.ts`), actifs une fois l'appareil relié.

### Comptes de test

- Ils s'appellent `test-e2e-*` et **doivent être supprimés** après les tests sur la vraie base :
  `DELETE FROM users WHERE login LIKE 'test-e2e-%'` (client `pg`, `DATABASE_URL` de `.env.local`). Les
  parcours de bout en bout tournent sur une base en mémoire : rien à nettoyer.

### Risque connu

- Augmenter `PERSONAL_IMPORT_VERSION` dans MyPerf reconstruit l'historique importé avec des identifiants
  aléatoires sur chaque appareil : doublons possibles entre appareils synchronisés.

---

## 4. Paquets partagés (`packages/`)

### `lumen` → `src/vendor/lumen`

Le **système visuel commun**, dans `packages/lumen/src/index.ts`.

**Thèmes**
- `THEME_IDS` (12) et `THEMES`. Chaque `ThemeInfo` a : `id`, `name`, `description`, `scheme`, `pair` et **`style`**.
- **8 palettes Lumen** (verre et lumière) :
  - sombres : `nuit`, `ocean`, `braise`, `graphite` ;
  - claires : `perle`, `glacier`, `sable`, `craie`.
  - Chacune a un équivalent dans l'autre mode, utilisé par « Suivre le téléphone ».
- **4 identités**, qui sont leur propre paire (un seul mode) :
  - **Circuit** (sombre) : interface tête haute, néon cyan, bords fins, équerres aux coins, grille + lignes de balayage, Space Grotesk + JetBrains Mono, étiquettes et grands titres en capitales.
  - **Ardoise** (sombre) : outil pro mat, surfaces pleines sans flou ni lueur, barre de couleur à gauche pour les teintes, IBM Plex Sans + Plex Mono.
  - **Argile** (claire) : relief doux, pâte claire, très arrondi (30 px), doubles ombres (sombre bas-droite, claire haut-gauche), Nunito.
  - **Brut** (claire) : néo-brutalisme, blanc + encre noire, bordures 2,5 px, ombres franches décalées, capsule jaune `#FFE45C`, Archivo 900 + Space Grotesk, trame de points sur papier.

**Couleurs et typographie**
- `SEEDS` : graines de couleur par thème. Les palettes en sont **dérivées** par les mêmes règles dans les deux apps.
- `STYLES` / `styleOf(id)` : polices, graisse et approche des titres, casse des étiquettes, rayons (carte, contrôle, pastille), matière (`glass|outline|solid|clay|brutal`), bordure, flou, ombre, texture, fond, bouton, densité.
- `TEXT_ALPHA`, `BASE_TEXT`, `SERIES_HUES` (couleurs de graphiques validées daltonisme).

**Apps, écrans, aperçus et apparence partagés**
- `MYLIFE_HOME` (l'accueil) et `MYLIFE_APPS` : registre des apps, dans un ordre et avec des couleurs fixes.
  - `finances` : `['#B9A0FF','#7340FF']`, icône diamant, `/finances/` ;
  - `perf` : `['#FFB86B','#F0566B']`, icône haltère, `/perf/` ;
  - `raveloc` : `['#5DFFC4','#1FA3FF']`, icône `navigate`, `/raveloc/`.
  - **Toute nouvelle app s'ajoute ici.**
- `MYLIFE_DESTINATIONS` : les écrans de chaque app (titre, chemin, mots-clés) que la palette de commande de n'importe quelle app propose.
- `MyLifeGlance` / `readGlance` / `writeGlance` : aperçus déposés par chaque app sur l'appareil (`mylife:glance:<app>`, avec échéance `until`) et affichés par l'accueil et les Espaces : MyFinances « X € à dépenser aujourd'hui » (Today), MyPerf la séance du jour (web), myRaveLoc le groupe actif.
- `SharedAppearance` (`theme`, `followSystem`, `reduceMotion`, `haptics`, `at`) : **un seul réglage d'apparence pour toutes les apps** (`mylife:appearance`), synchronisé entre appareils (§ 3).

### `sync-client` → `src/vendor/mylife-sync`

- Client commun en TypeScript pur (web + React Native) : `account.ts` (création, connexion, secours, mot de
  passe, nouvelle clé, suppression, règles d'identifiant et de mot de passe), `crypto.ts`, `engine.ts`
  (`join`, `autoJoin`, `syncNow`), `web.ts` (session web commune, clé de secours en attente).

### `ui` → `src/ui` (apps web : accueil, MyFinances, myRaveLoc)

Le **kit d'interface web** de MyLife, extrait de MyFinances : une seule source pour l'apparence.
- `lumen.css` (verre, identités `[data-style]`, dock, orbe, feuilles, champs, transitions entre apps),
  `tailwind.preset.js`, `fonts.ts` ; chaque app : `@import './ui/lumen.css'` et `presets: [lumen]`.
- Thème : `theme.ts`, `themes.ts` (`stylize`), `themeRuntime.ts`, `ThemeProvider.tsx`, `appearance.ts`
  (apparence commune, en direct entre onglets), `AppearanceSettings.tsx`, `prefsSync.ts`.
- Coque : `boot.ts` (`bootMyLife(appId)` : nom de l'app, journal d'erreurs, couleurs dès la 1ʳᵉ image,
  lumière du verre, synchro de l'apparence), `app.ts` (`configureApp`, `openMyLifeApp`), `Navigation.tsx`
  (dock / barre latérale ; `inDock`, appui long `onAssistant` + `holdLabel`), `PageTransition.tsx`
  (`KeptTabs` génériques, `PushedScreen`), `Screen.tsx`, `Backdrop.tsx`, `Sheet.tsx`, `primitives.tsx`
  (dont `TextField` et `PasswordField`), `icons.tsx` (Ionicons), `charts.tsx`, `toast*`, `money.ts`,
  `relative.ts`, `errorLog.ts`.
- MyLife commun : `account.tsx` + `session.ts` (compte), `HeaderActions.tsx` + `Spaces.tsx` (en-tête et
  Espaces, avec lignes d'état et raccourcis fournis par l'app), `CommandPalette.tsx` + `palette.ts`
  (entrées de l'app + autres apps), `glance.ts`.
- MyPerf (React Native) ne peut pas l'utiliser : il le reproduit (`Glass`, `Navigation`, `Orbit`,
  `CommandPalette`, compte) à partir des mêmes jetons ; la parité se vérifie par captures dans chaque thème.

---

## 5. MyFinances (`apps/finances`)

### Fonctions

**Écrans principaux (onglets du dock)**
- **Aujourd'hui** :
  - ce qui reste à dépenser aujourd'hui = enveloppe vie courante ÷ jours restants jusqu'à la paie, plafonnée par l'argent réel restant après les prélèvements à venir détectés ;
  - un anneau vert / orange / rouge ; un toucher détaille le calcul.
- **Budget** (`/budget` → `Cycle.tsx`) : le cycle de paie, jour par jour (calendrier `SpendCalendar`), trajectoire, colonnes empilées.
- **Opérations** (`/operations`) : recherche, filtres, regroupement par jour, file **À classer** (`/a-classer`).
- **Patrimoine** (`/patrimoine`) :
  - onglets Aperçu, Placements, Objectifs, Biens ;
  - détail de chaque placement ;
  - import d'un relevé Trade Republic ;
  - **Indépendance financière** (`/independance`) : simulateur à intérêts composés façon Finary, pré-rempli avec les données réelles ; paramètres dans l'URL (`capital`, `epargne`, `horizon`, `reel`, `hausse`).
- **Réglages** : profil, compte MyLife, budget, apparence, règles, catégories, alertes, données (sauvegarde, démo, journal d'erreurs).

**Autres écrans**
- Prévisions (`/previsions`), charges récurrentes (`/recurrents`), alertes, Banques (`/synchro`).

**Banques**
- **Enable Banking** (DSP2, lecture seule, « restricted production ») pour BNP et Revolut.
- La signature RSA rend obligatoire un relais sans état : `/api/eb`. La clé privée reste **uniquement** dans les variables d'environnement du serveur.
- Mode « Ma propre application » (pour les amis) : `appId` + PEM scellés en AES-GCM par le relais (opération `sealCredentials`, liée à l'utilisateur, clé tirée de `SESSION_SECRET`). L'app ne garde que `settings.ebOwnApp.sealed` et envoie l'en-tête `x-eb-credentials`.
- Cours des placements : Yahoo Finance + CoinGecko via le relais, en n'envoyant que les **symboles**. Protégé par `BRIDGE_PASSWORD` (**ne jamais afficher sa valeur**).

**Assistant IA** (`src/assistant/`, `/assistant`)
- Clé API Anthropic de l'utilisateur, **sur l'appareil seulement** (localStorage) : jamais synchronisée ni sauvegardée.
- Modèles : `claude-opus-5-5` par défaut, `claude-sonnet-5-5` en option, avec `fallbacks: 'default'`.
- Les outils de lecture s'exécutent directement ; les outils d'écriture demandent une validation par changement.
- La CSP autorise `https://api.anthropic.com`.

**Classement**
- Règles, apprentissage, détection des virements internes, dédoublonnage, personnes (`src/domain/*`).

### Architecture

| Domaine | Fichiers |
|---|---|
| Logique métier pure et testée | `src/domain/` |
| Données | `src/db/` (Dexie, `sharedQuery.ts` pour les lectures partagées, `undo.ts`) |
| Banques et synchro | `src/sync/` (Enable Banking, `refresh.ts` → `refreshEverything`, `cloud/` = MyLife) |
| Interface | `src/ui/` = **copie du kit commun** (`packages/ui`, ne pas modifier ici) ; écrans dans `src/pages/` ; composants propres dans `src/components/` (`TxEditor`, `CommandPalette` = entrées de MyFinances dans la palette commune, `HeaderActions` = en-tête commun + alertes, banques, synchro) |
| Thème | dans le kit : `theme.ts` (Palette, `cssVars`), `themes.ts` (`darkPalette`, `lightPalette`, **`stylize`**, `themePalette`, `resolvePalette`), `themeRuntime.ts` (`applyPalette` pose les variables CSS et **`data-style`** sur `<html>`, plus `data-scheme`, `.android`, `.no-live-blur`), `ThemeProvider.tsx` (lit l'apparence commune) |
| Styles | `src/index.css` = `@import './ui/lumen.css'` (le CSS commun) |

**Contenu de `lumen.css` (kit)**
- Le verre optique `.glass` : couches de fond, arête biseautée `::before`, lumière au contact `--gl`, onde au toucher `--rp` pilotée par `ui/glassLight.ts`.
- Niveaux de verre `glass-raised`, `glass-float`, `glass-lens`, teintes `.tone-*`, `.liquid`, `.dock-pill`, `.orb`, `.field-input`.
- Puis **un bloc par identité** `[data-style='circuit'|'ardoise'|'argile'|'brut']`.

**Variables d'identité**
- Familles : `--font-display`, `--font-body`, `--font-num`, `--font-label`.
- Titres et étiquettes : `--w-title`, `--track-k`, `--label-case`.
- Rayons : `--r-xs` … `--r-xl`, `--r-pill`, `--r-sheet`.
- Tailwind les lit : `rounded-lg` = `var(--r-lg)`, `.t-*` = familles en variables.
- `.num.font-display` utilise la police des nombres.

**Polices**
- `@fontsource` est importé dans `src/main.tsx`. Chaque fichier n'est téléchargé que si le thème l'affiche.

**Fond** (`src/ui/Backdrop.tsx`)
- Halos selon `HALO_GAIN` par style.
- Texture : points (Lumen), grille néon + balayage (Circuit), points noirs (Brut), rien (Ardoise, Argile).
- Lumière d'état (ambiance) gérée par `ui/mood.ts`.

**Sélecteur de thème** (`src/ui/extras.tsx` → `ThemePicker`)
- Deux familles, Identités puis Lumen.
- Aperçus dessinés dans chaque identité (carte, bouton, police « Aa »).

**Navigation**
- `src/ui/PageTransition.tsx` :
  - **`KeptTabs`** : les onglets restent montés une fois visités (adresse et défilement gardés) ;
  - `PushedScreen` : les écrans poussés montent en fondu.
- `ui/tabActive.ts` → `useTabActive`.
- `Navigation.tsx` : dock liquide (capsule de l'onglet actif + **orbe** central = palette de commande Ctrl/Cmd+K ; appui long = assistant).
- En-tête : cloche des alertes + « Espaces MyLife ».

**Chargements**
- `Pending` : rien pendant 150 ms, puis un squelette. **Jamais un faux état vide.**

**Performances acquises** (CPU ×4)
- Changement d'onglet ~450 ms à la 1ʳᵉ visite, immédiat ensuite.
- Bundle principal 607 Ko.
- Moyens :
  - LazyMotion strict (composants `m`) ;
  - enfoncement au toucher en CSS (`.tap`) ;
  - `content-visibility` (`.cv-auto`) ;
  - préchargement des pages en lots au repos ;
  - animations perpétuelles réservées à l'ordinateur (`hover:hover` et `pointer:fine`) ;
  - pas de flou réel sur Android.

**Feuilles**
- `src/ui/Sheet.tsx` utilise `ui/scrollLock.ts` : un **compteur partagé**, si bien que deux feuilles qui se chevauchent ne laissent jamais la page bloquée.
- L'installation de la feuille (focus, touches) se fait une seule fois.
- `.sheet-veil` n'a pas de flou sur Android.

---

## 6. MyPerf (`apps/perf`)

### Fonctions

- Programme réel : `data/programme-reel.md` et historique importé.
- Onglets :
  - **Aujourd'hui** : séance prévue, démarrer, semaine du cycle ;
  - **Planning** : macro- et mésocycles typés, semaines ;
  - **Exercices** : bibliothèque, fiche, historique, 1RM, carte musculaire ;
  - **Stats** : lifts principaux, volume par muscle, régularité.
  - Les réglages passent par Espaces MyLife.
- Séance en direct : saisie des séries, minuteur de repos, remplacement d'exercice, notes par série.
- **Coach IA** (`src/services/coach/`, `/coach`) :
  - `claude-sonnet-5-5` par défaut, `claude-opus-5-5` en « Analyse poussée » ;
  - les outils d'écriture sont des propositions validées par l'utilisateur ;
  - clé dans expo-secure-store (localStorage sur le web).
- Règles métier détaillées dans `apps/perf/CLAUDE.md` : charges = % du jour × 1RM de référence, lestés sur la masse totale, etc.

### Architecture

| Couche | Rôle |
|---|---|
| `src/domain` | Logique pure, testée |
| `src/db` | SQL synchrone, migrations **append-only** |
| `src/services` | Services métier |
| `src/state` | Stores zustand |
| `src/features` | Fonctions par domaine |
| `src/ui` | Composants et thème |
| `src/app` | Routes expo-router |

**Données**
- Toute écriture passe par `db()`. Les écrans lisent via `useLive`, qui ne relit que si l'écran a le focus.
- Web : driver `src/db/expoDriver.web.ts` (sql.js en mémoire, sauvegarde dans IndexedDB).
- Le démarrage web passe par **`bootOnce()`** dans `src/app/_layout.tsx`, qui garantit une seule préparation de la base (voir § 9).

### Thèmes et identités en React Native

- `src/ui/theme.ts` :
  - `Palette.style` ;
  - `radius` et `family` sont des **objets modifiés en place** par `applyIdentity(style, fontsLoaded)` (rayons, familles par identité ; `identity.upperLabels`, `upperTitles`, `tracking`) ;
  - `useShownTheme` (zustand) contient le thème réellement affiché.
- `src/app/_layout.tsx` :
  - charge d'abord les polices de l'identité (`src/ui/fonts.ts` → `IDENTITY_FONTS`, `@expo-google-fonts/*`) ;
  - puis applique l'identité et bascule `useShownTheme`, si bien qu'aucun écran n'apparaît à moitié dans l'ancien style ;
  - charge les autres identités 2,5 s après le démarrage, pour des aperçus fidèles et une bascule immédiate.
- `src/ui/themes.ts` : `stylize()`, même logique que MyFinances.
  - Argile utilise `towardWhite` à la place de `color-mix`.
  - Les variantes de texte (`primitives.tsx` → `variants(t.style)`) sont recalculées par identité.
- `Glass.tsx`, une branche par identité :
  - **Lumen** : biseau, grain, flou ;
  - **Circuit** : bord néon + `Brackets` aux coins ;
  - **Ardoise** : à plat + barre de teinte à gauche ;
  - **Argile** : sans bord, ombres doubles ;
  - **Brut** : bord 2,5 px encre + ombre franche.
- `Button` primaire, `Navigation.tsx` (`pillStyle`, `Orb`), `Backdrop.tsx` (`HALO_GAIN`, `CircuitGrid`, `PaperDots`) et `features/settings/ThemePicker.tsx` (deux familles + aperçus) suivent le même modèle.

### Android

- Ombres via `shade()` : pas d'ombres internes, pas de lueurs sur les éléments répétés. Exceptions : Brut et Argile gardent leurs ombres.
- Halos figés.
- Pas de grain sur les cartes de base.

---

## 6 bis. myRaveLoc (`apps/raveloc`)

Retrouver ses amis en festival : groupes temporaires, partage de position limité dans le temps, flèche
vers un ami. Détails dans `apps/raveloc/README.md`.

- **Interface** : le kit commun (`src/ui`) : même en-tête (mode phare + Espaces), même dock (Retrouver · orbe · Groupes ; appui long = mode phare), mêmes cartes, feuilles, identités, clair et sombre ; routeur `react-router` (`/`, `/groupes`, `/groupes/nouveau`, `/groupe`, `/ami/:uid`, `/rejoindre`, `/compte`). Propre à l'app : `src/components` (avatars, bandeaux réseau, phare, palette) et dans `index.css` la boussole (`.dial`) et le phare (`.beacon`).
- **Compte** : celui de MyLife (même session) ; écrans communs ; se déconnecter ou supprimer le compte coupe d'abord tous les partages (`beforeSignOut`).
- **Chiffrement** : clé de groupe aléatoire, transmise dans le fragment `#` du lien d'invitation (jamais envoyé au serveur), rangée emballée par la clé de données MyLife de chaque membre. Nom du groupe, pseudos et positions chiffrés (`encryptRow`, liés au groupe et au membre). Le serveur ne voit que des identifiants, des rôles et des horodatages.
- **Accès** vérifiés côté serveur à chaque requête ; partage coupé par défaut ; une seule position par membre et par groupe, effacée à l'arrêt, au départ, à la fin du partage ou du groupe (14 j max).
- **Temps réel** : requêtes courtes adaptatives (4 s navigation, 10 s groupe, 30 s ailleurs ; rien en arrière-plan) ; pas de WebSocket (réécriture externe).
- **Navigateur** : rien n'est envoyé app fermée ou écran éteint (limite des navigateurs mobiles, affichée à l'utilisateur).
- **Thème** : l'apparence commune (tous les thèmes) ; la flèche, le phare et la balise gardent la couleur d'identité du registre (vert laser → cyan).

## 7. Règles d'écosystème (décisions de l'utilisateur)

- **Une seule app, unifiée à 100 %** (demande du 22/10/2026 : « une seule PWA installable », « toute l'identité visuelle unifiée à 100 % »). L'accueil et les trois apps partagent :
  - une installation (manifeste unique), un compte, une apparence (synchronisée entre appareils) ;
  - le même dock (capsule + orbe = palette de commande ; appui long = l'action propre de l'app) ;
  - le même en-tête (bouton propre à l'app, puis « Espaces MyLife » en dernier) ;
  - les mêmes Espaces (apps avec aperçus, bouton Accueil, compte, raccourcis) et la même palette (avec les écrans des autres apps) ;
  - les mêmes écrans de compte, transitions, verre et thèmes.
  - **Toute interface web passe par le kit `packages/ui`** ; MyPerf le reproduit en React Native et se vérifie par captures dans chaque thème. **Toute fonction ajoutée à une app reçoit son équivalent dans les autres.**
- **Compte aussi simple qu'une app ordinaire** : un écran, pas de code, rien d'obligatoire après (la clé de secours peut attendre, avec rappel).
- **Compte obligatoire** (22/10/2026) : sans session MyLife, chaque partie n'affiche que la création de compte / la connexion (`AccountGate` : kit web, `apps/perf/src/features/account/AccountGate.tsx`, accueil → `/bienvenue`). Un nouvel utilisateur ne voit jamais de données d'autrui ; la session est gardée sur l'appareil (usage hors ligne ensuite). Vérifié par le parcours e2e (4 apps, aucune fuite).
- **Données personnelles de l'auteur** (programme + historique MyPerf) : **absentes des builds publics**. `apps/perf/src/import/personal.ts` ne charge l'import que si `EXPO_PUBLIC_PERSONAL_DATA=1` au build (privé). Une base vide reçoit la bibliothèque générique. L'auteur récupère ses données par son compte ou en important un JSON (`Réglages → Importer`).
- **Clé API Anthropic commune** (web) : `mylife:anthropic-key` (`packages/sync-client/src/aiKey.ts`), partagée par l'assistant de MyFinances et le coach de MyPerf, jamais synchronisée ; l'APK garde la sienne (trousseau).
- **Les thèmes sont de vraies identités.** Changer de thème doit donner l'impression d'une autre app : cartes, typographie, effets, bordures, ombres, fond. Une nouvelle identité se fait en 4 étapes :
  1. graine et `ThemeInfo` (style) + `STYLES` dans lumen ;
  2. `stylize` dans le kit et dans MyPerf ;
  3. bloc CSS `[data-style]` (web) et branches `Glass`, `Backdrop`, `Button`, `pillStyle`, `Orb` (React Native) ;
  4. polices.
  - Les tests de contraste des deux apps doivent rester verts : texte ≥ 7:1, secondaire et discret ≥ 4,5:1 dans MyFinances.
- **Fluidité avant tout.** Le rechargement d'une page ou d'un élément ne doit jamais dégrader la fluidité. Onglets gardés montés, aucun écran vide ni faux chiffre pendant une lecture.
- **Automatique, précis, réel.** Les chiffres viennent des vrais comptes et des vraies transactions, pas de réglages approximatifs. Toute estimation est expliquée à l'écran.
- **Interface en français**, nombres au format français.
- **L'utilisateur délègue tout.** Faire le travail de bout en bout (code, tests, déploiement, vérification). Ne s'arrêter que pour ce qui exige ses comptes (panneau Enable Banking, connexions OAuth), avec des instructions clic par clic.

---

## 8. Sécurité et confidentialité (à respecter toujours)

- Les données restent sur l'appareil. Seules exceptions : le relais bancaire de l'utilisateur et la synchro MyLife **chiffrée de bout en bout**.
- **Aucun outil d'analytique ni de pistage.**
- Clé privée Enable Banking : uniquement dans les variables d'environnement du serveur. `.pem` et `.env*` sont ignorés par git.
- **Ne jamais afficher un secret** dans la sortie : `BRIDGE_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, clés.
- Clé API Anthropic : sur l'appareil seulement, jamais synchronisée ni sauvegardée.
- Comptes de test `test-e2e-*` : à supprimer après usage.

---

## 9. Historique récent et état actuel (22/10/2026)

**Unification (22/10/2026)**, détaillée et notée dans `docs/UNIFICATION.md` :
- kit d'interface web commun extrait de MyFinances (`packages/ui`), utilisé par l'accueil, MyFinances et myRaveLoc ;
- myRaveLoc reconstruit sur le kit (tous les thèmes, dock, en-tête, Espaces, palette, compte) ;
- accueil MyLife devenu une app (`web/`) et **seule PWA installable** (manifeste `/`, raccourcis, icône MyLife) ;
- comptes : inscription ouverte en un écran, garde-fous serveur, nouvelle clé, suppression, reliure automatique ;
- apparence commune synchronisée entre appareils (web et APK) ; aperçus des apps ; palette transversale ; transitions entre apps ;
- **dépôt unique** (historiques conservés) et README de présentation ;
- tests : serveur 49, MyFinances 332 + 25 bout en bout, myRaveLoc 83 + 13, MyPerf 214, écosystème 14 : tout vert.
- menu des apps en feuille du bas, cartes en relief (`Tilt`) partout (y compris MyPerf web), rappel de sauvegarde hebdomadaire (MyFinances, MyPerf web), `docs/ARCHITECTURE.md`.

**Dépôt GitHub (privé)** : https://github.com/SENE-Pablo-2326099b/mylife (branche `master`, `git push`).

**À faire** : déploiement en production (`npm run deploy:all`), refusé à l'outil par les permissions. Tant
que MyLife n'est pas redéployé, l'API en ligne est l'ancienne (inscription avec code, pas d'app `mylife`) :
la nouvelle APK MyPerf (`/mnt/c/Users/qwark/Downloads/MyPerf-MyLife.apk`) en dépend.

**Outils de vérification visuelle** : `npm run local` puis Playwright (Chrome système) ; les parcours de
bout en bout acceptent `SHOTS=dossier`. Les émojis des catégories s'affichent en carrés dans le Chrome de
WSL (pas de police émoji) : normal.

---

## 10. Pistes possibles (non demandées pour l'instant)

- Variante « densité » des identités (le champ `density` de `STYLES` n'est pas encore utilisé pour les espacements).
- Comptes pour les amis avec leur propre application Enable Banking (le mécanisme existe déjà).
- Passkeys pour la connexion le jour où l'extension PRF sera fiable partout (aujourd'hui écartée : voir `docs/UNIFICATION.md`).
