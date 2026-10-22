# MyLife

Point d'entrée commun des apps personnelles, sur **une seule origine** (même adresse) :

| Chemin | App | Projet Vercel | Dépôt |
|---|---|---|---|
| `/` | Accueil (ce dépôt) | `mylife` | `~/PersoDev/MyLife` |
| `/finances/` | MyFinances (PWA) | `myfinances` | `~/PersoDev/Budget` |
| `/perf/` | MyPerf (PWA) | `myperf` | `~/PersoDev/MyPerfV2` (`npm run build:web && npm run deploy:web`) |
| `/raveloc/` | myRaveLoc (PWA) | `myraveloc` | `~/PersoDev/myRaveLoc` (`npm run deploy`) |
| `/api/raveloc` | API de myRaveLoc (groupes, positions chiffrées) | `mylife` (ce dépôt) | `api/raveloc.ts`, `server/raveloc.ts` |
| `/api/eb` | Relais Enable Banking + cours | `myfinances` | `~/PersoDev/Budget` |

Les chemins `/finances`, `/perf` et `/raveloc` sont des réécritures Vercel vers les projets de chaque app : chaque
app reste un dépôt indépendant, déployable seule, mais le navigateur ne voit qu'une adresse. C'est ce
qui permettra une connexion unique et la synchronisation chiffrée entre appareils (étapes suivantes).

Déployer l'accueil : `npx vercel@61.1.0 deploy --prod`.

**Après le déploiement d'une app** : si un fichier répond 404 *via MyLife* alors qu'il existe sur l'adresse
de l'app (le CDN de MyLife a pu garder un 404 obtenu pendant la mise en ligne), redéployer MyLife vide son cache.

## Comptes et synchronisation (chiffrée de bout en bout)

- `POST /api/auth` : `salt`, `signup` (code d'invitation `INVITE_CODE`), `login`, `recoverStart` / `recoverFinish`
  (clé de secours), `password`. `POST /api/sync` : `status`, `sync` (envoi + réception, curseur par appareil).
- Le mot de passe ne quitte jamais l'appareil : PBKDF2-SHA256 (200 000 tours) → HKDF → clé d'authentification
  (le serveur n'en garde qu'une empreinte HMAC) et clé d'emballage de la **clé de données** (aléatoire).
  Chaque ligne est chiffrée en AES-256-GCM, liée à `app/table/identifiant`. Clé de secours = 2ᵉ emballage.
- Conflits : la modification la plus récente gagne ; une modification refusée reçoit la version du compte.
- Rejoindre un compte : compte vide → l'appareil l'alimente ; sinon l'appareil prend les données du compte
  (copie de sécurité d'abord) — jamais de fusion de deux historiques saisis séparément.
- Base : Neon Postgres (Marketplace Vercel), tables `users` et `records` créées au premier appel.
- Variables : `DATABASE_URL` (Neon), `SESSION_SECRET` (aussi sur le projet `myfinances` : le relais bancaire
  accepte la session), `INVITE_CODE`.
- Client commun : `packages/sync-client` (TypeScript pur, web + React Native), copié dans chaque app par
  `npm run vendor` (`Budget/src/vendor/mylife-sync`, `MyPerfV2/src/vendor/mylife-sync`).
- Tests : `npm test` (vrai Postgres en mémoire via PGlite, serveur + client de bout en bout).

## API de myRaveLoc (`/api/raveloc`)

Hébergée ici pour réutiliser la session et les secrets de MyLife (voir `~/PersoDev/myRaveLoc/README.md`) :
groupes temporaires, invitations, partage de position. Le serveur ne lit ni les positions, ni les noms
de groupe, ni les pseudos (chiffrés par les téléphones avec une clé de groupe qu'il ne connaît pas) ; il
vérifie l'appartenance au groupe à chaque requête. Tables `raveloc_*` créées au premier appel, une seule
position par membre et par groupe, tout est effacé à la fin du groupe. Tests : `tests/raveloc.test.ts`.
