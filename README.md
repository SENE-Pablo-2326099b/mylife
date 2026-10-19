# MyFinances

Gestion de finances personnelles **pour tout le monde**, pensée pour le téléphone (PWA installable, hors ligne), au design **Lumen** (verre et lumière, 8 thèmes clairs et sombres).
Les opérations bancaires arrivent automatiquement via **Enable Banking** (API DSP2 en lecture seule) ; tout le reste (revenus, charges, catégories, règles, placements, objectifs) se règle dans l'app. Nouveautés et choix de la V2 : voir **[V2.md](V2.md)**.

- **Aujourd'hui** : combien je peux encore dépenser aujourd'hui (enveloppe vie courante ÷ jours restants jusqu'à la paie), anneau vert / orange / rouge.
- **Budget** : le cycle de paie à paie, courbe cumulée vs trajectoire et cycle précédent, catégories et objectifs ; **prévision de trésorerie** et **abonnements / récurrents détectés**.
- **Opérations** : recherche, filtres, correction de catégorie avec création de règle, file « à classer » au clavier.
- **Patrimoine** : patrimoine net et son historique, comptes, **placements** (Trade Republic, Bitstack, PEA, assurance vie…) avec PRU, plus-values, **investissements programmés** et cours automatiques, **objectifs d'épargne**, biens et dettes, **indépendance financière**.
- **Réglages** : accueil guidé au premier lancement, profil, revenus / charges / épargne en listes, catégories, règles, alertes, banques, apparence (thèmes, suivre le téléphone), sauvegarde JSON, démo.

---

## Confidentialité : où vont les données ?

```
 Téléphone (PWA)                         Ta fonction serverless (/api/eb)         Enable Banking → BNP / Revolut
 ───────────────                         ───────────────────────────────          ─────────────────────────────
 IndexedDB : opérations, règles,  ──►    signe un JWT avec TA clé privée   ──►    API DSP2 (lecture seule)
 réglages. Rien d'autre.          ◄──    relaie la réponse, ne stocke rien ◄──
```

- Les opérations sont stockées **uniquement** dans le navigateur de l'appareil (IndexedDB).
- L'API Enable Banking refuse les appels directs depuis un navigateur (pas de CORS, signature RSA obligatoire). Un **relais sans état** est donc nécessaire :
  une fonction serverless *à toi* (Vercel ou Netlify), sur le **même domaine** que l'app. Elle garde la clé privée, signe les requêtes, relaie les réponses et ne stocke ni ne journalise rien.
- Le relais n'accepte qu'une **liste fermée** d'opérations en lecture (liste des banques, autorisation, session, soldes, transactions) et exige un mot de passe (`BRIDGE_PASSWORD`).
- Aucune analytics, aucun tracking, aucune police ou script externe (Sora et Inter sont embarquées). En production, la CSP impose `connect-src 'self'` : le navigateur ne peut parler qu'à ton propre domaine.
- **Cours des placements** : le relais interroge Yahoo Finance (ETF, actions) et CoinGecko (crypto) avec les seuls **symboles** (ex. `CW8.PA`, `bitcoin`), jamais de montant. Ces deux opérations ne demandent que `BRIDGE_PASSWORD` (pas la configuration Enable Banking). Sans relais, les cours se saisissent à la main.

---

## Installation et lancement

Prérequis : **Node.js 20+** et npm.

```bash
npm install
npm run dev          # http://localhost:5173 (le relais est monté sur /api/eb)
```

Au premier lancement, l'accueil guidé propose « Essayer avec la démo » (6 mois de la vie de Camille Martin, personne fictive : deux banques, un livret, un PEA, du bitcoin programmé, des objectifs). Ensuite : **Réglages → Sauvegarde et données → Charger la démo**.

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement + relais Enable Banking local |
| `npm run build` | vérification TypeScript + build de production dans `dist/` (avec service worker) |
| `npm run preview` | sert le build de production (relais inclus) sur http://localhost:4173 |
| `npm test` | tests unitaires (Vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run screenshots` | captures de chaque écran avec la démo, thèmes Nuit et Perle, 320 / 390 / 430 / 1 280 px, + contrôle des erreurs console, des débordements, du clavier et du hors-ligne (nécessite `npm run build` et Chrome ; `CHROME_PATH` pour un autre binaire) |
| `node scripts/make-icons.mjs` | régénère les icônes PNG de la PWA à partir de `public/favicon.svg` |

---

## Configurer Enable Banking

Enable Banking propose un mode **« restricted production »** gratuit : une application de production limitée aux comptes que tu as toi-même liés. C'est exactement le cas d'usage.

1. **Crée un compte** sur <https://enablebanking.com/sign-in/> (lien de connexion par e-mail), puis ouvre le *Control Panel*.
2. **Enregistre une application** (*Applications → Register new application*) :
   - Environnement : **Production** (ou *Sandbox* pour tester avec des banques fictives).
   - Clé : choisis *Generate in the browser (using SubtleCrypto) and export private key*. Le fichier `.pem` téléchargé est ta **clé privée** : garde-le hors du dépôt (`*.pem` est dans `.gitignore`).
   - **Redirect URLs** : ajoute exactement
     - `https://<ton-domaine>/connexion/retour` (production)
     - `http://localhost:5173/connexion/retour` et `http://localhost:4173/connexion/retour` (développement)
   - Note l'**Application ID** affiché.
3. **Active l'application** : une application de production reste « pending » tant que tu n'as pas mis **tes propres comptes en liste blanche** (*whitelist your own accounts*, depuis la page de l'application dans le Control Panel ; la doc Enable Banking décrit la marche à suivre). Une fois tes comptes BNP et Revolut liés, l'application fonctionne en *restricted production*, limitée à ces comptes.
4. **Configure les variables d'environnement** (voir `.env.example`) :

   | Variable | Valeur |
   |---|---|
   | `EB_APP_ID` | l'Application ID |
   | `EB_PRIVATE_KEY` | la clé privée PEM. Le plus simple : en base64 sur une ligne, `base64 -w0 ma-cle.pem` (macOS : `base64 -i ma-cle.pem`) |
   | `EB_PRIVATE_KEY_PATH` | *(local uniquement)* chemin vers le `.pem`, à la place de `EB_PRIVATE_KEY` |
   | `BRIDGE_PASSWORD` | mot de passe long et aléatoire, par ex. `openssl rand -base64 32` |
   | `EB_REDIRECT_URLS` | *(facultatif, recommandé)* liste blanche des URL de retour, séparées par des virgules |

   En local : copie `.env.example` en `.env.local` et remplis-le.
5. **Dans l'app** : *Banques* (icône ⟳ en haut à droite, ou Réglages → Banques) → saisis le mot de passe du relais → **Ajouter une banque** → choisis le pays et ta banque → authentification sur son site → retour automatique dans l'app. Recommence pour chaque banque.

La synchro se fait ensuite toute seule à l'ouverture de l'app (au plus toutes les 6 h, réglable : la DSP2 limite à 4 accès automatiques par jour et par compte), ou à la demande. L'accès bancaire expire au bout de 90 à 180 jours selon la banque : l'app affiche « Expire dans N j », puis « Reconnecter ».

> **iPhone** : une PWA installée et Safari ne partagent pas leurs données. Si la banque te renvoie dans Safari au lieu de l'app, la page de retour te propose de copier le lien : colle-le dans *Synchro → « La banque m'a renvoyé dans le navigateur »*.

---

## Déploiement

### Vercel (recommandé)

Le dépôt contient `vercel.json` (réécritures SPA, en-têtes de sécurité) et la fonction `api/eb.ts`.

1. Pousse le dépôt sur GitHub, puis *Add New → Project* sur <https://vercel.com> et importe-le (preset **Vite** détecté automatiquement : build `npm run build`, sortie `dist`).
2. *Settings → Environment Variables* : ajoute `EB_APP_ID`, `EB_PRIVATE_KEY`, `BRIDGE_PASSWORD` (et `EB_REDIRECT_URLS=https://<projet>.vercel.app/connexion/retour`).
3. Déploie, puis ajoute `https://<projet>.vercel.app/connexion/retour` aux *Redirect URLs* de l'application Enable Banking.
4. Ouvre l'URL sur ton téléphone → menu du navigateur → **Ajouter à l'écran d'accueil**.

En ligne de commande : `npx vercel`, `npx vercel env add EB_APP_ID`, …, puis `npx vercel --prod`.

### Netlify

Le dépôt contient `netlify.toml` et la fonction `netlify/functions/eb.ts` (servie sur `/api/eb`).
*Add new site → Import from Git*, puis *Site configuration → Environment variables* avec les mêmes variables, et l'URL de retour `https://<site>.netlify.app/connexion/retour` côté Enable Banking.

### GitHub Pages

Non adapté : GitHub Pages ne sert que des fichiers statiques et ne peut pas héberger le relais qui garde la clé privée. L'interface seule fonctionnerait (démo, sauvegardes), mais pas la synchro bancaire.

---

## Format des données bancaires

Il n'y a plus d'import de fichier : tout passe par l'API Enable Banking (format JSON ISO 20022 simplifié). Des réponses d'exemple anonymisées sont dans [`samples/enablebanking/`](samples/enablebanking/) et servent aux tests.

| Champ Enable Banking | Utilisation |
|---|---|
| `transaction_amount.amount` + `credit_debit_indicator` | montant signé, converti en **centimes entiers** (`DBIT` = négatif) |
| `transaction_date` → `booking_date` → `value_date` | date de l'opération (la première disponible) |
| `status` | `PDNG` / `HOLD` = **en attente** ; `CNCL`, `RJCT`, `SCHD` ignorées ; le reste = définitive |
| `creditor.name` / `debtor.name`, `remittance_information`, `note` | libellé affiché et texte comparé aux règles |
| `creditor_account.iban` / `debtor_account.iban` | détection des virements entre tes propres comptes |
| `entry_reference` / `transaction_id` | référence bancaire (déduplication secondaire) |
| `identification_hash` du compte | identité stable du compte d'une connexion à l'autre |

**Déduplication** : clé = compte + date + montant + libellé normalisé (+ rang si deux opérations identiques le même jour), complétée par la référence bancaire. Chaque synchro re-télécharge les 7 derniers jours : un chevauchement ne crée jamais de doublon.
**Opérations en attente** : à chaque synchro, les opérations « en attente » d'un compte sont remplacées par la nouvelle photo fournie par la banque ; une catégorie corrigée à la main sur une opération en attente est conservée quand elle devient définitive.

---

## Structure du projet

```
api/eb.ts                    fonction Vercel (relais)
netlify/functions/eb.ts      fonction Netlify (relais)
server/bridge.ts             cœur du relais : JWT RS256, liste blanche d'opérations, validation
server/vitePlugin.ts         relais monté dans `vite dev` / `vite preview`
server/market.ts             cours de bourse / crypto (Yahoo Finance, CoinGecko) via le relais
src/ui/                      design system Lumen : jetons et 8 thèmes (theme.ts, themes.ts), verre,
                             fond animé, Screen, navigation, feuilles, toasts « Annuler », graphiques
src/sync/                    couche « source de données » (DataSource), client du relais,
                             mapping Enable Banking, moteur de synchro, connexion bancaire
src/domain/                  logique métier pure et testée : cycle, budget du jour, règles,
                             transferts internes, déduplication, alertes, réglages (migration v1),
                             patrimoine (PRU, historique), plans programmés, récurrences,
                             prévision de trésorerie, indépendance financière, sauvegarde, démo
src/db/                      schéma Dexie (IndexedDB) et initialisation
src/pages/, src/components/  écrans React
samples/enablebanking/       réponses API anonymisées utilisées par les tests
tests/                       tests Vitest (224), dont les contrastes des 8 thèmes
scripts/                     captures d'écran, génération des icônes
```

**Brancher un autre agrégateur** (GoCardless, Powens…) : implémenter l'interface `DataSource` de `src/sync/source.ts` (`fetchAccount(account, since, until)` → opérations normalisées + solde) et ajouter ses opérations au relais. La déduplication, le classement, le budget et les alertes ne changent pas.

---

## Sauvegarde

*Réglages → Sauvegarde et données → Exporter* télécharge un fichier JSON avec toute la base (opérations, patrimoine, objectifs, catégories, règles, réglages), **sans** le mot de passe du relais. *Importer* remplace toutes les données de l'appareil par celles du fichier (« Annuler » pendant quelques secondes). Les sauvegardes de la V1 (Budget Dodge) se réimportent : les réglages sont migrés.
Comme les données ne vivent que sur l'appareil, fais un export de temps en temps.
