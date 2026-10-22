# MyLife : contexte complet (MyFinances + MyPerf)

> **À lire au début d'une nouvelle conversation.** Ce fichier résume l'écosystème : architecture, dépôts,
> commandes, décisions, contraintes, état actuel au **22/10/2026**.
> - Fichier de référence : `~/PersoDev/MyLife/CONTEXTE.md`.
> - Copies : `~/PersoDev/Budget/CONTEXTE.md` et `~/PersoDev/MyPerfV2/CONTEXTE.md`.
> - Après une évolution importante, mettre à jour la référence puis recopier.
>
> Documents plus détaillés propres à chaque dépôt :
> - `Budget/README.md`, `Budget/V2.md` ;
> - `MyPerfV2/CLAUDE.md`, `MyPerfV2/README.md`, `MyPerfV2/ERGONOMIE.md` ;
> - `MyLife/README.md`.

---

## 1. Vue d'ensemble

**MyLife** regroupe les apps personnelles de l'utilisateur sur **une seule origine** : https://mylife-liart.vercel.app

| Chemin | App | Dépôt local | Projet Vercel | Techno |
|---|---|---|---|---|
| `/` | Accueil MyLife, API comptes et synchro | `~/PersoDev/MyLife` | `mylife` | HTML statique + fonctions Node |
| `/finances/` | **MyFinances** (budget, banques, patrimoine) | `~/PersoDev/Budget` | `myfinances` (https://myfinances-sepia-sigma.vercel.app) | React 18 + Vite + TS + Tailwind + Dexie (IndexedDB), PWA |
| `/perf/` | **MyPerf** (musculation / street lifting) | `~/PersoDev/MyPerfV2` | `myperf` (https://myperf-six.vercel.app) | Expo / React Native (React 19, React Compiler) + SQLite ; web (PWA) + APK Android |
| `/api/eb` | Relais Enable Banking + cours des placements | `~/PersoDev/Budget/api/eb.ts` | `myfinances` | Fonction Vercel |

**Fonctionnement des chemins :**
- Ce sont des **réécritures Vercel** déclarées dans `MyLife/vercel.json`.
- Chaque app reste un **dépôt indépendant**, déployable seul : pas de monorepo, à cause de l'historique, des chemins, des mémoires Claude et de React 18 contre 19.
- Les dépôts sont locaux (pas de remote git).

**Appareils de l'utilisateur :**
- PC (Windows + WSL) ;
- Android : MyPerf en APK, MyFinances en PWA ;
- iPhone plus tard, en PWA gratuite.

**Contexte d'usage :** l'utilisateur est seul pour l'instant ; des amis viendront plus tard « avec les mêmes méthodes ».

---

## 2. Commandes essentielles

### MyFinances (`~/PersoDev/Budget`)

| Action | Commande |
|---|---|
| Développement | `npm run dev` (lance aussi le relais local) |
| Types | `npx tsc -b --noEmit` |
| Lint | `npx eslint src --quiet` |
| Tests unitaires | `npm test` (vitest, **332 tests**) |
| **Parcours de bout en bout** | `npm run e2e` : build + Playwright avec Chrome système (`/usr/bin/google-chrome`), **25 vérifications**, dont le changement de catégorie. **À lancer avant tout déploiement d'interface.** |
| **Déployer** | `npx --yes vercel@latest deploy --prod --yes` |

### MyPerf (`~/PersoDev/MyPerfV2`)

| Action | Commande |
|---|---|
| Types | `npx tsc --noEmit` |
| Lint | `npx eslint src --quiet` (ou `npx expo lint`) |
| Tests | `npx jest` (**214 tests**) |
| Aperçu web | `npx expo start --web --port 8090` (sans `CI=1`) |
| **Web** | `npm run build:web && npm run deploy:web` (sortie dans `web/perf`) |
| **APK** | `cd android && ANDROID_HOME=~/android-sdk ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2`, puis copier `android/app/build/outputs/apk/release/app-release.apk` vers `/mnt/c/Users/qwark/Downloads/MyPerf-MyLife.apk` |

Pour l'APK, utiliser **2 workers** : avec 4, WSL tue la compilation faute de mémoire (code 137).

### MyLife (`~/PersoDev/MyLife`)

| Action | Commande |
|---|---|
| Tests | `npm test` (Postgres en mémoire via PGlite, serveur + client de bout en bout) |
| Paquets partagés | `npm run vendor` copie `packages/sync-client` et `packages/lumen` dans `src/vendor/{mylife-sync,lumen}` des **deux** apps. On modifie toujours dans `MyLife/packages/`, **jamais** dans `src/vendor/`. |
| Déployer | `npm run deploy` (vercel@61.1.0) |

**Après chaque déploiement d'une app, redéployer MyLife.** Sinon le CDN de MyLife peut garder un 404 obtenu pendant la mise en ligne.

### Commits

- Messages en français, descriptifs (une phrase longue qui liste les changements).
- Ils se terminent par :
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## 3. MyLife : comptes et synchronisation chiffrée de bout en bout

### API

- `POST /api/auth` : `salt`, `signup` (code d'invitation), `login`, `recoverStart` / `recoverFinish` (clé de secours), `password`.
- `POST /api/sync` : `status`, `sync` (envoi + réception, curseur par appareil).
- Code : `MyLife/api/{auth,sync}.ts`, `MyLife/server/{core,http}.ts`.

### Chiffrement

- Le mot de passe ne quitte jamais l'appareil.
- Dérivation : PBKDF2-SHA256 (200 000 tours) → HKDF. On en tire :
  - la clé d'authentification, dont le serveur ne garde qu'une empreinte HMAC ;
  - la clé d'emballage de la **clé de données**, qui est aléatoire.
- Chaque ligne est chiffrée en AES-256-GCM, liée à `app/table/identifiant`.
- La clé de secours est un 2ᵉ emballage de la clé de données.

### Règles de synchronisation

- **Conflits :** la modification la plus récente gagne ; une modification refusée reçoit la version du compte.
- **Rejoindre un compte :**
  - compte vide → l'appareil l'alimente ;
  - sinon → l'appareil prend les données du compte, après une copie de sécurité.
  - **Jamais de fusion** de deux historiques.

### Base et variables

- Base : Neon Postgres (Marketplace Vercel). Tables `users` et `records`, créées au premier appel.
- Variables d'environnement (**ne jamais afficher leurs valeurs**) :
  - `DATABASE_URL` ;
  - `SESSION_SECRET`, présente aussi sur `myfinances` (le relais bancaire accepte la session) ;
  - `INVITE_CODE`.
- Fichier local : `MyLife/.env.local`.
- Code d'invitation actuel : `mylife-5c6bbe-6fb408`.

### Suivi des modifications dans chaque app

- **MyFinances :** middleware Dexie (`src/sync/cloud`).
- **MyPerf :** déclencheurs SQLite (`src/services/cloud/sqliteStore.ts`, migration 9). Le suivi n'est actif qu'une fois l'appareil relié à un compte.

### Comptes de test

- Ils s'appellent `test-e2e-*` et **doivent être supprimés** après les tests.
- Suppression avec le client `pg` et `DATABASE_URL` de `MyLife/.env.local` :
  ```sql
  DELETE FROM users WHERE login LIKE 'test-e2e-%'
  ```

### Risque connu

- Augmenter `PERSONAL_IMPORT_VERSION` dans MyPerf reconstruit l'historique importé avec des identifiants aléatoires sur chaque appareil.
- Cela peut créer des doublons entre appareils synchronisés : n'augmenter cette version qu'en connaissance de cause.

---

## 4. Paquets partagés (`MyLife/packages/`)

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

**Apps et apparence partagées**
- `MYLIFE_APPS` : registre des apps, dans un ordre et avec des couleurs fixes.
  - `finances` : `['#B9A0FF','#7340FF']`, icône diamant, `/finances/` ;
  - `perf` : `['#FFB86B','#F0566B']`, icône haltère, `/perf/`.
  - **Toute nouvelle app s'ajoute ici.**
- `readSharedAppearance` / `writeSharedAppearance` : clé localStorage `mylife:appearance`. Le thème est partagé entre les apps **sur le web**, car elles ont la même origine. L'APK MyPerf garde son propre réglage.

### `sync-client` → `src/vendor/mylife-sync`

- Client de synchronisation commun en TypeScript pur (web + React Native) : `account.ts`, `crypto.ts`, `engine.ts`.

---

## 5. MyFinances (`~/PersoDev/Budget`)

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
| Interface | `src/ui/` (primitives, verre, navigation, thèmes) ; écrans dans `src/pages/` ; composants transverses dans `src/components/` (`TxEditor`, `CommandPalette`, `Spaces`, `HeaderActions`) |
| Thème | `src/ui/theme.ts` (Palette, `cssVars`) ; `src/ui/themes.ts` (`darkPalette`, `lightPalette`, **`stylize`** par identité, `themePalette`, `resolvePalette`) ; `src/ui/themeRuntime.ts` (`applyPalette` pose les variables CSS et **`data-style`** sur `<html>`, plus `data-scheme`, `.android`, `.no-live-blur`) ; `src/ui/ThemeProvider.tsx` |
| Styles | `src/index.css` |

**Contenu de `src/index.css`**
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

## 6. MyPerf (`~/PersoDev/MyPerfV2`)

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
- Règles métier détaillées dans `MyPerfV2/CLAUDE.md` : charges = % du jour × 1RM de référence, lestés sur la masse totale, etc.

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

## 7. Règles d'écosystème (décisions de l'utilisateur)

- **Un seul environnement.** MyFinances et MyPerf doivent se ressentir comme une seule app (« Il y a trop de disparité… l'application entière doit être un système / un environnement »). Elles partagent :
  - le même dock (capsule + orbe = palette de commande ; appui long = l'IA de l'app) ;
  - le même en-tête (bouton propre à l'app, puis « Espaces MyLife » en dernier) ;
  - le même écran Espaces, construit sur `MYLIFE_APPS` ;
  - les mêmes transitions, le même verre, les mêmes thèmes.
  - **Toute fonction ajoutée à l'une reçoit son équivalent dans l'autre.**
- **Les thèmes sont de vraies identités.** Changer de thème doit donner l'impression d'une autre app : cartes, typographie, effets, bordures, ombres, fond. Une nouvelle identité se fait en 4 étapes :
  1. graine et `ThemeInfo` (style) + `STYLES` dans lumen ;
  2. `stylize` dans les deux apps ;
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

**Tout est déployé :**
- MyFinances (commit `29d4909`) ;
- MyPerf web (commit `e9ea979`) ;
- MyLife (commit `9555129`, paquet lumen).

L'APK MyPerf a été recompilé avec les identités ; s'il manque, relancer la commande APK du § 2.

**Derniers chantiers :**

1. **Gel au changement de catégorie d'une opération** (MyFinances). Corrigé et couvert par `npm run e2e` (deux tours ; vérifie que `body.style.overflow` est vide et qu'aucune couche `.fixed.inset-0.z-50` ne reste). Causes traitées :
   - restauration croisée de `body.style.overflow` entre feuilles qui se chevauchent → `scrollLock` à compteur ;
   - effet de la feuille relancé à chaque rendu (vol de focus) → `onClose` gardé dans une référence ;
   - lumière et onde animées sur toute la feuille au-dessus d'un flou plein écran sous Android ;
   - enregistrement non protégé dans `TxEditor` → feuille fermée d'abord, double toucher ignoré, erreur affichée et notée dans le journal (`logError`). Même protection pour la file À classer (`Queue.tsx`).
2. **Harmonisation des deux apps** : mêmes cartes, boutons, ombres, dock, orbe, fond et thèmes ; vérifiée par captures dans les 4 identités et dans Lumen.
3. **Vraies identités de thème** : Circuit, Ardoise, Argile, Brut, en plus des 8 palettes Lumen (§ 4), dans les deux apps.
4. **Bug corrigé dans MyPerf web :**
   - Symptôme : au premier lancement sur un navigateur où MyFinances avait déjà choisi un autre thème, MyPerf affichait « Impossible d'ouvrir la base de données — no such table: sync_queue ».
   - Cause : l'effet de démarrage se relançait quand les polices finissaient de charger. La base était préparée une seconde fois (base vide) pendant que la synchro, déjà abonnée, lisait `sync_queue`.
   - Correctif : `bootOnce()`.

**Navigation (sessions précédentes)**
- Onglets gardés montés : `KeptTabs`.
- Dock stable : il ne disparaît plus au changement d'écran.
- Retoucher l'onglet actif remonte en haut.
- Palette de commande avec écrans, actions, opérations, catégories et question à l'assistant.
- Espaces MyLife en plein écran.
- Chiffres qui roulent (`Rolling`), cartes en relief (`Tilt`), tirer pour actualiser, lumière d'état.

**Outils de vérification visuelle**
- Scripts Playwright dans le scratchpad de session (perdus au redémarrage, à recréer si besoin).
- Recette :
  - MyFinances : `vite preview` sur `/finances`, bouton « Continuer » puis « Passer » dans l'accueil, « Charger la démo » dans `/reglages/donnees`, choix du thème dans `/reglages/apparence` (radios « Thème X : … ») ;
  - MyPerf : servir `web/` avec un serveur statique (repli sur `perf/index.html`), poser `localStorage['mylife:appearance'] = {"theme":"circuit","followSystem":false,"at":…}` avant le chargement.
- Les émojis des catégories s'affichent en carrés dans le Chrome sans police émoji de WSL. C'est normal, pas un bug de l'app.

---

## 10. Pistes possibles (non demandées pour l'instant)

- Synchroniser aussi le choix du thème entre appareils (aujourd'hui partagé seulement sur le web, par l'origine commune).
- Variante « densité » des identités (le champ `density` de `STYLES` n'est pas encore utilisé pour les espacements).
- Comptes pour les amis : invitation + leur propre application Enable Banking (le mécanisme existe déjà).
