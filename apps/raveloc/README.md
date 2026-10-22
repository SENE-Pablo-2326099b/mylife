# myRaveLoc

Retrouver ses amis en festival, en rave ou en concert : une flèche, une distance, et la vérité sur la
qualité des données. App web mobile-first (PWA) de l'écosystème **MyLife**, servie sous
**https://mylife-liart.vercel.app/raveloc/**.

| | |
|---|---|
| Dossier | `apps/raveloc` du dépôt MyLife |
| Projet Vercel | `myraveloc` (l'app, statique) |
| Chemin public | `/raveloc/`, réécrit par `MyLife/vercel.json` vers le projet `myraveloc` |
| API | `POST /api/raveloc`, **hébergée par MyLife** : `MyLife/api/raveloc.ts` + `MyLife/server/raveloc.ts`, tests `MyLife/tests/raveloc.test.ts` |
| Techno | React 18 + Vite + TypeScript, CSS sans framework, PWA (vite-plugin-pwa) ; API Node + Neon Postgres dans MyLife |
| Paquets partagés | `src/vendor/lumen` et `src/vendor/mylife-sync`, copiés par `npm run vendor` dans MyLife (ne jamais les modifier ici) |

## Commandes

| Action | Commande |
|---|---|
| Types | `npx tsc -b --noEmit` |
| Lint | `npx eslint .` |
| Tests unitaires + intégration | `npm test` (vitest ; Postgres en mémoire via PGlite ; vraie API et vraie authentification de MyLife). Le serveur seul : `cd ../MyLife && npm test` |
| Parcours de bout en bout | `npm run e2e` : build + deux téléphones simulés dans Chrome (`/usr/bin/google-chrome`, ou `CHROME_PATH`). `SHOTS=dossier` pour des captures. |
| Serveur local | `npm run build && npm run local` → http://localhost:4320/raveloc/ (base en mémoire, code d'invitation MyLife `local-invite`) ; `npm run dev` relaie `/api` vers lui |
| Icônes | `npm run icons` (depuis `public/favicon.svg`) |
| Déployer l'app | `npm run deploy` (vercel@61.1.0), puis redéployer MyLife (cache CDN, voir MyLife/README) |
| Déployer l'API | dans MyLife : `npm run deploy` |

Les tests, le serveur local et l'E2E importent `../MyLife/server/{core,raveloc}.ts` : les deux dépôts
doivent être côte à côte.

## Architecture

```
Téléphone (navigateur, /raveloc/)                       Serveur (projet mylife, /api/raveloc)
├─ session MyLife (localStorage « mylife-session »)  ──► vérifie le jeton (code de MyLife)            
├─ clé de groupe (256 bits, aléatoire)                  vérifie l'appartenance au groupe à CHAQUE requête
│   └─ chiffre : nom du groupe, pseudos, positions ──►  ne range que des blocs chiffrés + métadonnées
├─ GPS (watchPosition) ── seulement si partage actif     une seule position par membre et par groupe
│                          ou écran de navigation        effacement : arrêt, départ, fin du partage,
└─ boussole (deviceorientation[absolute])                fin du groupe, position > 12 h
```

### Pourquoi ces choix

- **Comptes : ceux de MyLife.** Même origine que MyFinances et MyPerf, donc même session
  (`mylife-session`) : un utilisateur déjà connecté dans une autre app n'a rien à faire. Connexion et
  création de compte réutilisent `signIn` / `createAccount` du paquet `sync-client` (le mot de passe ne
  quitte pas l'appareil).
- **API hébergée par MyLife**, à côté de `/api/auth` et `/api/sync`, avec ses `verifyToken`, `handle`,
  `getDb` et ses variables d'environnement. Le précédent `/api/eb` (fonction dans le projet de l'app,
  `SESSION_SECRET` recopié) n'était pas reproductible : `SESSION_SECRET` est une variable « sensible »
  sur Vercel, illisible, et le changer aurait déconnecté tous les appareils et rendu illisibles les
  identifiants bancaires scellés de MyFinances. L'app, elle, reste un dépôt et un projet indépendants.
- **La synchro chiffrée de MyLife ne convient pas aux positions** : elle synchronise les données d'UN
  compte entre SES appareils (curseur, conflits, historique complet), alors qu'une position doit aller à
  d'AUTRES comptes, ne garder que la dernière valeur et disparaître vite. On réutilise en revanche ses
  **primitives** (`encryptRow`, AES-256-GCM avec emplacement lié) et la **clé de données** du compte pour
  ranger la clé de groupe sur le serveur.
- **Temps réel par requêtes courtes (polling adaptatif)**, pas de WebSocket : la réécriture externe de
  MyLife vers le projet de l'app ne relaie pas de connexion persistante de façon fiable, et sur un réseau
  de festival saturé, des requêtes courtes avec reprise valent mieux qu'une connexion qui tombe sans
  prévenir. Un seul aller-retour envoie ma position (si utile) et rapporte celles du groupe.
- **Base : le Postgres Neon existant de MyLife**, tables préfixées `raveloc_` créées au premier appel ;
  pas de nouvelle infrastructure.
- **Pas de carte** dans cette version : la flèche suffit pour se rejoindre, une carte coûterait une
  dépendance lourde et des tuiles chargées depuis un tiers (fuite de position vers ce tiers).

### Chiffrement de bout en bout des données du groupe

- Le créateur génère l'identifiant (128 bits) et la clé du groupe (256 bits) sur son téléphone.
- Le lien d'invitation est `…/raveloc/#rejoindre=<jeton>.<clé>`. Le **jeton** (128 bits) est vérifié par le
  serveur, qui n'en garde que l'empreinte SHA-256 ; la **clé** est dans le fragment `#`, que le navigateur
  n'envoie jamais. L'app l'efface de la barre d'adresse dès l'ouverture.
- Chaque membre range la clé du groupe sur le serveur emballée par SA clé de données MyLife (qui ne
  quitte pas ses appareils) : il la retrouve sur ses autres appareils connectés.
- Nom du groupe, pseudos et positions sont chiffrés et **liés à leur emplacement** (groupe, membre) : le
  serveur ne peut ni les lire, ni attribuer la position de l'un à l'autre, ni la clé d'un groupe à un autre.

### Ce que le serveur voit, et combien de temps

| Donnée | Lisible par le serveur ? | Conservation |
|---|---|---|
| Identifiant de compte MyLife des membres, rôle, date d'arrivée | oui | jusqu'au départ ou à la fin du groupe |
| Nom du groupe, pseudos | non (chiffrés) | fin du groupe |
| Position (lat, lon, précision, âge) | **non** (chiffrée) | **une seule par membre et par groupe**, effacée à l'arrêt du partage, au départ, à la fin du partage programmé, à la fin du groupe, ou après 12 h |
| Heure de réception d'une position, dernière requête d'un membre, état du partage et son échéance | oui | idem |
| Invitations : empreinte du jeton, échéance, nombre d'utilisations | oui | jusqu'à 1 jour après expiration/révocation |
| Compteurs anti-abus (par compte) | oui | 2 jours |
| Adresse IP, taille et rythme des requêtes | oui (comme tout serveur web) | journaux Vercel, sans corps de requête |

Garanties réelles : un membre retiré ou parti n'obtient plus rien du serveur dès la requête suivante ;
le serveur ne connaît pas les coordonnées. Limites : un ancien membre garde la clé du groupe (pas de
rotation de clé dans cette version) — elle ne lui sert à rien sans le serveur, qui ne lui sert plus
rien ; un serveur compromis pourrait refuser ou retarder des positions (il ne peut pas les lire ni les
falsifier de façon indétectable, mais il peut renvoyer une ancienne position chiffrée).

### Règles d'accès (vérifiées côté serveur)

- Voir un groupe, ses membres, ses positions : être membre (sinon 404, identique à un groupe inexistant).
- Voir la position d'un membre : il partage (`on` ou `paused`) avec CE groupe, et le partage n'a pas expiré.
- Envoyer une position : partage `on` dans ce groupe.
- Inviter, lister et révoquer les liens, retirer un membre, nommer un admin, supprimer le groupe : admin.
- Être dans un même groupe ne donne aucun accès permanent ; les « habitués » sont une liste locale au
  téléphone, sans aucun droit.
- Anti-abus : 45 échanges/min, 60 modifications/10 min, 20 groupes créés/jour, 10 jetons invalides par
  quart d'heure (puis blocage) ; tailles de champs bornées ; 30 groupes par compte, 60 membres par groupe.

## Localisation, boussole, batterie

- **GPS allumé seulement si nécessaire** : partage actif dans un groupe, écran de navigation ouvert, ou
  distances demandées sur l'écran du groupe. Toujours en haute précision (dans une foule, la position par
  antennes est inutilisable) avec `maximumAge` 2 s en navigation, 10 s sinon. Coupé quand l'app est cachée.
- **Envois** : seulement après un vrai déplacement (au-delà de 8 m et de la moitié de la précision), une
  nette amélioration de la précision, ou un signe de vie (15 s en navigation, 30 s sinon).
- **Échanges** : 4 s en navigation, 10 s sur le groupe, 30 s ailleurs ; arrêt en arrière-plan et hors
  ligne ; espacement exponentiel après échec (max 60 s) ; reprise immédiate au retour.
- **Ancienneté sans comparer les horloges** : âge à l'envoi (horloge de l'ami) + temps sur le serveur
  (horloge du serveur) + temps depuis la réception (notre horloge).
- **Boussole** : iOS `webkitCompassHeading` (autorisation par un bouton), Chrome Android
  `deviceorientationabsolute`, sinon `deviceorientation` marqué absolu. Le cap « devant moi » combine l'axe
  du haut de l'écran et l'axe du dos du téléphone : à plat ou relevé, pas de saut. Un `deviceorientation`
  relatif (gyroscope) est ignoré : il ne donne pas le nord. Lissage circulaire à constante de temps
  variable (0,07–0,28 s), instabilité mesurée (écart au cap lissé > 20° → « boussole perturbée »).
  Déclinaison magnétique négligée (quelques degrés en Europe).
- **Sans boussole** : flèche « nord en haut » avec le N affiché et la direction en mots ; en marchant,
  cap de déplacement GPS. Toujours annoncé à l'écran.
- **Proximité** : « tout proche » sous 15 m (ou positions qui se recouvrent) seulement si l'incertitude
  combinée est < 30 m ; « direction incertaine » si le cône d'incertitude dépasse ±50°. Seuils dans
  `src/domain/status.ts` (`THRESHOLDS`).
- **Écran allumé** pendant la navigation (Screen Wake Lock) ; **mode phare** : écran clignotant pour être vu.

### Limites des navigateurs (arrière-plan)

- Aucun navigateur mobile n'envoie la position d'une page en arrière-plan, écran verrouillé ou onglet
  fermé (iOS suspend la page ; Android la gèle rapidement ; une PWA installée ne change rien). Le
  partage n'est donc effectif **que lorsque myRaveLoc est ouvert à l'écran** ; l'app le dit, et les amis
  voient « plus de nouvelles depuis X min » au lieu d'une fausse position en direct.
- Un suivi continu écran éteint exigerait une app native (Android : service de premier plan ; iOS :
  « Always » + mise à jour en arrière-plan). Évolution possible, non faite.
- iOS : l'accès à la boussole se demande par un geste ; s'il est refusé, il faut fermer l'onglet et rouvrir.

## PWA et hors ligne

- Manifeste (`/raveloc/`, portrait, icônes 192/512/maskable), service worker Workbox limité à la coquille
  de l'app (JS, CSS, polices, icônes). **Aucune réponse d'API en cache** : une position vient du réseau
  ou est affichée avec son âge, jamais ressortie d'un cache.
- Sur l'appareil : liste des groupes (noms chiffrés, clés emballées) pour ouvrir l'app hors ligne ;
  dernier pseudo ; « habitués ». Les positions ne sont gardées qu'en mémoire.
- Hors ligne : bannière, dernières positions conservées et vieillissant à l'écran, reprise automatique.

## Thème

L'app suit le thème choisi dans MyLife (`mylife:appearance`), toujours en version sombre (paire sombre
d'un thème clair, Nuit pour Argile et Brut), avec les couleurs des graines Lumen, les niveaux de texte de
`TEXT_ALPHA` (légèrement relevés pour l'extérieur) et les rayons de `STYLES`. Son identité propre (balise,
flèche, bouton principal) est sa couleur du registre `MYLIFE_APPS` : vert laser → cyan. Aucune palette ni
identité existante n'a été modifiée, et le moteur de thèmes n'est pas dupliqué.

## Configuration et déploiement

Aucune variable d'environnement pour le projet `myraveloc` (app statique). L'API utilise celles du
projet `mylife` (`DATABASE_URL`, `SESSION_SECRET`) ; ses tables `raveloc_*` sont créées au premier appel.

1. myRaveLoc : `npx tsc -b --noEmit && npx eslint . && npm test && npm run e2e` ; MyLife : `npx tsc --noEmit && npm test`
2. myRaveLoc : `npm run deploy`
3. MyLife : réécritures `/raveloc`, `/raveloc/`, `/raveloc/:path+` vers le projet `myraveloc` ; `raveloc`
   exclu des en-têtes de l'accueil ; `npm run deploy` (publie aussi l'API).
4. Vérifier en production : `/raveloc/` (200), `/raveloc/manifest.webmanifest`, `POST /api/raveloc` sans
   session → 401.

## Pistes (non faites)

- Rotation de la clé de groupe au retrait d'un membre.
- Carte en complément (tuiles hébergées ou hors ligne, pour ne pas révéler la position à un tiers).
- Invitation directe d'un habitué (sans lien), notifications.
- App native pour le partage en arrière-plan.
