# MyLife : contexte technique

> **État du code au 13/11/2026.** Ce fichier décrit ce qui existe et comment s'en servir. La direction (ce que MyLife
> devient, et dans quel ordre) est dans **`docs/VISION.md`**, qui prime en cas de désaccord. Le journal de la V5 est
> `docs/V5.md` ; l'historique d'avant la V5 est dans `docs/archives/`.
>
> À mettre à jour à chaque changement d'architecture, de commande ou de règle. Pas de compteurs de tests ici :
> ils se périment.

---

## 1. Où on en est

- **V5** : phases 0 et 1 faites ; **phase 2 en cours** : la nouvelle coquille (`app/`, kit `packages/kit`, contrat de
  module) est servie à `/v5/` à côté de l'ancien accueil (`docs/V5.md`, étape 2.2). Étape 2.3 faite : la coquille a son
  compte, ses données, sa confidentialité, Copilot. Prochaine étape : 2.4, la bascule de `/` (manifeste, hors ligne).
- **Production** : https://mylife-liart.vercel.app ; elle n'a pas encore la phase 1 (à déployer).
- **Dépôt** : `~/PersoDev/MyLife`, GitHub privé `SENE-Pablo-2326099b/mylife`, branche `master`. Il contient le
  programme et l'historique d'entraînement de l'utilisateur (build privé de MyPerf) : il reste privé.
- **De ton côté, toujours en attente** : clés VAPID et `CRON_SECRET` sur Vercel (sans elles, aucun rappel ne part) ;
  relecture de `/confidentialite`.

---

## 2. Vue d'ensemble (architecture actuelle)

Une seule origine, une seule PWA installable, mais **quatre projets Vercel** recollés par des réécritures
(`vercel.json`). La V5 les remplace par une seule app et un seul déploiement (phase 2).

| Chemin | Partie | Dossier | Projet Vercel | Techno |
|---|---|---|---|---|
| `/` | **Accueil** : « Ta journée », Copilot, Sorties, apps et aperçus, compte, apparence, installation ; **seul manifeste** | `web/` | `mylife` | React 18 + Vite + kit `packages/ui` |
| `/api/*` | Comptes, synchro chiffrée, espaces partagés, MyRave, notifications, support | `api/`, `server/` | `mylife` | Fonctions Vercel + Neon Postgres |
| `/finances/` | **MyFinances** | `apps/finances` | `myfinances` | React 18 + Vite + Tailwind + Dexie |
| `/api/eb` | Relais Enable Banking + cours des placements | `apps/finances/api/eb.ts` | `myfinances` | Fonction Vercel |
| `/perf/` | **MyPerf** | `apps/perf` | `myperf` | Expo / React Native (React 19) + SQLite ; web + APK Android |
| `/raveloc/` | **MyRave** (ex-myRaveLoc ; chemin et identifiants inchangés) | `apps/raveloc` | `myraveloc` | React 18 + Vite + kit `packages/ui` |

- Pas d'espace de travail npm : chaque dossier a ses `node_modules` (React 18 contre 19).
- Le code partagé de `packages/` est **copié** dans chaque app par `npm run vendor`. On modifie toujours dans
  `packages/`, jamais dans les copies (`*/src/vendor/*`, `*/src/ui`). Fin de ce mécanisme en phase 2.
- Même origine = même stockage : une session, une apparence, une installation pour tout.

**Appareils de l'utilisateur** : PC (Windows + WSL), Android (PWA, et l'APK MyPerf), iPhone plus tard (PWA).

---

## 3. Commandes

### Racine
| Action | Commande |
|---|---|
| Dépendances (racine + 3 apps) | `npm run setup` |
| Copier les paquets partagés | `npm run vendor` |
| Tout construire | `npm run build:all` |
| Lint de l'accueil | `npm run lint` |
| Tests serveur + paquets (Postgres en mémoire, PGlite) | `npm test` |
| Tous les tests unitaires | `npm run test:all` |
| Parcours de bout en bout de l'accueil / de tout | `npm run e2e` / `npm run e2e:all` (Chrome à `/usr/bin/google-chrome` ou `CHROME_PATH` ; `SHOTS=dossier` pour des captures) |
| Tout MyLife en local | `npm run local` → http://localhost:4300 (vraies API, base en mémoire) |
| Accueil en développement | `npm run dev` (port 4310, `/api` relayé vers `npm run local`) |
| Déployer | `npm run deploy:all` (les 3 apps, puis MyLife) ; `npm run deploy` (MyLife seul). **Après le déploiement d'une app, redéployer MyLife** (sinon le CDN peut garder un 404). |
| Volumes du serveur, sans contenu | `DATABASE_URL=… npm run stats:serveur` |
| Messages au support | `DATABASE_URL=… npm run support` (puis `-- done <id>`) |

### Par app
| | MyFinances (`apps/finances`) | MyPerf (`apps/perf`) | MyRave (`apps/raveloc`) |
|---|---|---|---|
| Développement | `npm run dev` | `npx expo start --web --port 8090` (sans `CI=1`) | `npm run build && npm run local` → :4320/raveloc/ |
| Types / lint | `npx tsc -b --noEmit` / `npx eslint src --quiet` | `npx tsc --noEmit` / `npx expo lint` | `npx tsc -b --noEmit` / `npx eslint .` |
| Tests | `npm test` ; `npm run e2e` | `npx jest` | `npm test` ; `npm run e2e` (deux téléphones simulés) |
| Déployer | `npm run deploy` | `npm run build:web && npm run deploy:web` | `npm run deploy` |

**APK MyPerf** : `cd apps/perf/android && ANDROID_HOME=~/android-sdk ./gradlew assembleRelease
-PreactNativeArchitectures=arm64-v8a --max-workers=2` (pas plus de 2 workers : WSL manque de mémoire), puis copier
`android/app/build/outputs/apk/release/app-release.apk` vers les Téléchargements Windows. Un `./gradlew clean` peut être
nécessaire (chemins absolus en cache).

**Commits** : en français, descriptifs, terminés par la ligne `Co-Authored-By` du modèle utilisé (`Claude Fable 5.2 <noreply@anthropic.com>` ou `Claude Opus 5.5 <noreply@anthropic.com>`).

---

## 4. Comptes, synchronisation et chiffrement

### API (`server/`, points d'entrée dans `api/`)
- `/api/auth` (`server/auth.ts`) : `salt`, `available`, `signup`, `login`, `recoverStart` / `recoverFinish` ; avec
  session : `password`, `renewRecovery`, `deleteAccount` (efface compte, lignes, groupes, espaces, messages au support,
  abonnements aux notifications).
- `/api/sync` (`server/sync.ts`) : `status`, `sync`. Registre des apps de synchro et de leurs quotas : `SYNC_APPS`
  (`server/core.ts`) + `AppId` (sync-client) : `finances` (les faits de MyFinances, partagés par l'ancienne app et le
  module V5), `finances5` (les réglages du moteur du module V5), `perf`, `mylife` (réglages communs) ; et `miniapps`,
  `objectifs`, `chef`, `calendrier`, plus lues par aucun écran depuis la phase 1 (gardées jusqu'à la purge, § 8). Seules les lignes vivantes comptent dans le quota ; une ligne trop grosse est écartée
  seule (`tooBig`). Traces de suppression purgées après 90 jours (cron du dimanche) ; un appareil plus ancien reçoit
  `resync`.
- `/api/space` (`server/space.ts`) : espaces partagés chiffrés (les Sorties ; les anciens Crew et foyers restent stockés).
- `/api/raveloc` : groupes, invitations, positions chiffrées de MyRave.
- `/api/push`, `/api/cron-reminders` : rappels écrits par l'appareil (le serveur n'envoie qu'un signal vide, le service
  worker écrit le rappel depuis les données locales ; aucune app n'en prévoit pour l'instant).
- `/api/cron-weekly` : purge des traces de suppression, le dimanche.
- `/api/support` : messages au support.
- Le même code sert en local (`server/local.ts`) et dans les tests. Cœur indépendant de Vercel : `server/core.ts` ne
  dépend que d'une interface `Db { query() }`.

### Inscription et garde-fous
- Un écran : identifiant + mot de passe, pas de courriel ni de code (`SIGNUP=open` ; `invite` remet le code).
- Clé de secours montrée après la création, rappelée tant que « C'est fait » n'est pas touché.
- `RATES` (`server/core.ts`) : 10 comptes par réseau et par jour (empreinte HMAC de l'adresse), 10 mauvais mots de passe
  par quart d'heure et par identifiant, 120 vérifications de disponibilité par heure.

### Chiffrement de bout en bout
Le mot de passe ne quitte jamais l'appareil. PBKDF2-SHA256 (200 000 tours) → HKDF : clé d'authentification (le serveur
n'en garde qu'une empreinte HMAC) et clé d'emballage d'une **clé de données** aléatoire. Chaque ligne en AES-256-GCM,
liée à `app/table/identifiant`. Clé de secours = second emballage. Détails : `docs/ARCHITECTURE.md` § 6.

### Session et appareils
- Une session web pour toutes les apps (`packages/sync-client/src/web.ts`) ; se déconnecter quelque part déconnecte
  partout.
- **Reliure automatique** (`autoJoin`) : les données d'un autre compte sur l'appareil sont effacées, jamais montrées ;
  un appareil vide prend le contenu du compte ; des données saisies hors compte → l'utilisateur choisit (« Partir de
  zéro » d'abord pour un compte neuf). Jamais de fusion. Tant que l'appareil n'est pas relié, `AccountGate` couvre l'app.
- `claimDevice` (`packages/sync-client/src/device.ts`) efface à chaque connexion ce que le navigateur garde pour le
  compte précédent hors synchro (clé d'API, conversations, aperçus…).
- Conflits : la modification la plus récente gagne.
- Suivi des modifications : MyFinances par un middleware Dexie (`src/sync/cloud`), MyPerf par des déclencheurs SQLite
  (`src/services/cloud/sqliteStore.ts`).

### Base et variables
- Neon Postgres ; tables créées au premier appel. Fichier local : `.env.local` (racine, ignoré par git).
- Variables (**ne jamais afficher leurs valeurs**) : `DATABASE_URL`, `SESSION_SECRET` (aussi sur `myfinances`),
  `SIGNUP`, `INVITE_CODE` ; facultatives : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`, `CRON_SECRET`
  (`STEAM_API_KEY` ne sert plus) ; côté `myfinances` : clé Enable Banking, `BRIDGE_PASSWORD`.
- Comptes de test sur la vraie base : `test-e2e-*`, à supprimer après usage. Les parcours de bout en bout tournent sur
  une base en mémoire.

---

## 5. Paquets partagés (`packages/`)

| Paquet | Copié dans | Contenu |
|---|---|---|
| `sync-client` | `src/vendor/mylife-sync` | Compte, chiffrement, moteur de synchro (`join`, `autoJoin`, `syncNow`, lecture seule `readAccountApp`), session web, espaces, clé d'API commune (`aiKey.ts`). TypeScript pur (web et React Native). |
| `lumen` | `src/vendor/lumen` | Jetons (thèmes, styles, couleurs), registre des apps (`MYLIFE_APPS`, `HOME_APPS` : les Sorties), destinations de la palette, aperçus, apparence commune, fiches Copilot ; moteurs purs : `sortie.ts`, `agenda.ts` (agenda commun), `actions.ts` (actions validées), `dates.ts` ; MyChef gelé (`chef.ts`, `recipes.ts`, `mealplan.ts`, `ticket.ts`). |
| `ui` | `src/ui` (accueil, MyFinances, MyRave) | Kit d'interface web : `lumen.css`, thème, coque (`boot.ts`, `Navigation`, `Screen`, `Sheet`, `PageTransition`), compte (`account.tsx`, `AccountGate`), Espaces, palette, aperçus, collections synchronisées (`collectionSync.ts`, gardé pour MyChef), synchro de l'apparence (`prefsSync.ts`). MyPerf (React Native) ne peut pas l'utiliser et le reproduit. |

Aujourd'hui : 12 thèmes dont 4 « identités » (Circuit, Ardoise, Argile, Brut). La V5 n'en garde qu'un clair et un sombre
(phase 2, avec le nouveau design system).

---

## 6. Les apps

### MyFinances (`apps/finances`)
- **Aujourd'hui** : ce qui reste à dépenser aujourd'hui (enveloppe ÷ jours jusqu'à la paie, plafonnée par l'argent réel
  après les prélèvements à venir). **Budget** (cycle de paie jour par jour, prévision, récurrents). **Opérations**
  (recherche, file « À classer », banques). **Patrimoine** (placements, objectifs, biens, import Trade Republic,
  indépendance financière). **Réglages**.
- Modèle d'argent unifié par la refonte d'octobre (épargne du cycle unique, une seule liste de récurrents, vocabulaire
  enveloppe / budget du jour / argent libre) : `docs/archives/REFONTE-FINANCES.md`.
- **Banques** : Enable Banking (DSP2, lecture seule) via le relais sans état `/api/eb` (la clé privée reste sur le
  serveur). Mode « ma propre application » pour les amis (identifiants scellés par le relais). Cours : Yahoo Finance et
  CoinGecko, seuls les symboles partent.
- **Assistant** (`src/assistant/`) : clé Anthropic de l'utilisateur, sur l'appareil seulement ; `claude-opus-5-5` par
  défaut, `fallbacks: 'default'` ; écritures validées une par une.
- Couches : `src/domain` (pur, testé) ← `src/db` (Dexie) ← `src/sync` ← `src/pages`, `src/components`. Points de
  restauration automatiques (`src/domain/restorePoints.ts`).
- Décisions et hypothèses d'origine : `docs/archives/finances/`.

### MyPerf (`apps/perf`)
- Onglets Aujourd'hui (séance prévue), Planning (macro- et mésocycles), Exercices (fiche, 1RM, carte musculaire), Stats.
  Séance en direct : séries, minuteur de repos, remplacement, notes. Import de programme (texte, IA gratuite, programmes
  prêts). Coach IA (`src/services/coach/`).
- Couches : `src/domain` (pur) ← `src/db` (SQL synchrone, migrations append-only) ← `src/services`, `src/state`
  (zustand), `src/features`, `src/ui`, `src/app` (expo-router). Web : sql.js en mémoire sauvegardé dans IndexedDB,
  démarrage par `bootOnce()`.
- Règles métier (charges = % du jour × 1RM de référence, lestés sur la masse totale…) : `apps/perf/CLAUDE.md` et
  `README.md`.
- **Données personnelles de l'auteur** : seulement dans le build privé (`EXPO_PUBLIC_PERSONAL_DATA=1`,
  `src/import/personal.ts`). `PERSONAL_IMPORT_VERSION` reconstruit l'historique importé avec des identifiants fixes.
- La V5 la passe sur le web (phase 4) ; l'APK reste jusque-là.

### MyRave (`apps/raveloc`)
- Retrouver ses amis en festival : groupes temporaires (14 jours max), partage de position limité dans le temps, flèche
  et distance, mode phare. Détails : `apps/raveloc/README.md`.
- Clé de groupe dans le fragment `#` du lien d'invitation (jamais envoyée au serveur) ; noms, pseudos et positions
  chiffrés ; une seule position par membre, effacée à l'arrêt. Requêtes courtes adaptatives, rien en arrière-plan.
- Accueillera les Sorties (phase 5).

### Copilot (accueil, gardé)
- `web/src/copilot.ts`, `web/src/pages/Copilot.tsx` : une IA pour toutes les apps, avec la clé de l'utilisateur, depuis
  l'appareil. Outils : vue d'ensemble, fiches de MyFinances et MyPerf (posées par chaque app : `Today.tsx`,
  `services/copilotCard.ts`), agenda commun, sorties ; **actions validées** (sauter un récurrent, décaler une séance :
  carte « Valider », exécutée par l'app concernée, annulable : `packages/lumen/src/actions.ts`).

---

## 7. Règles

**Non négociables** (aussi dans `CLAUDE.md`) : rien de personnel chez un autre compte ni dans ce qui est livré ; jamais
de secret affiché ; clé d'API Anthropic sur l'appareil seulement ; aucune analytique ni traceur ; dépôt privé.

**Façon de faire** :
- Interface en français, tutoiement, nombres au format français.
- **Automatique, précis, réel** : les chiffres viennent des vrais comptes ; toute estimation est expliquée à l'écran.
- **Fluidité** : jamais d'écran vide ni de faux chiffre pendant un chargement.
- **Compte aussi simple qu'une app ordinaire**, et **obligatoire** : sans session, seule la création de compte s'affiche.
- L'utilisateur délègue le travail de bout en bout ; on ne s'arrête que pour ce qui exige ses comptes, et **pour qu'il
  teste après chaque étape** (V5).
- Les principes de produit et de design de la V5 (moins mais mieux, un écran = une question, définition de « fini »)
  sont dans `docs/VISION.md` § 2, § 5 et § 7.

---

## 8. Les fonctions retirées en phase 1

Personnage, bilan et Wrapped, Crew et Pactes, MyMusique, MyGames, « Mes apps », MyObjectifs, MyAgenda, MyFoyer et
MyChef (gelé : moteur gardé dans `packages/lumen`) sont partis le 13/11/2026 ; le détail est dans `docs/V5.md`.

- **Restent pour les Sorties** : `web/src/spaces.ts` (espaces « sortie »), `spaceSync.ts`, `sortieDigest.ts`,
  `pages/Sortie.tsx`, `pages/Join.tsx` (`/rejoindre`). Elles rejoindront MyRave en phase 5.
- **Leurs données** sont encore dans le compte (`SYNC_APPS` inchangé, lignes `stats`, `music`, `games`, `miniapp` de
  `mylife`) : « Mes données » → « Télécharger l'archive » (`web/src/archive.ts`) les emporte. **La purge** (retrait de
  `SYNC_APPS`, effacement des lignes, des espaces Crew et foyer orphelins) attend une prochaine version et **un accord
  explicite de l'utilisateur**.
- Les préfixes de stockage qu'elles utilisaient restent dans `PERSONAL_PREFIXES` (effacés quand un autre compte se
  connecte).

---

## 9. Vérifier visuellement

`npm run local` puis Playwright (Chrome système) ; les parcours de bout en bout acceptent `SHOTS=dossier`. Les émojis
s'affichent en carrés dans le Chrome de WSL (pas de police émoji) : normal.
