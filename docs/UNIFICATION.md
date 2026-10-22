# Unification de MyLife : idées notées, réalisation notée, itérations

Demande (22/10/2026) : une seule PWA installable, une identité visuelle unifiée à 100 %, une création de
compte aussi simple qu'une app standard, tout réuni sur GitHub avec un README. Méthode : noter chaque
idée sur 10, l'appliquer, noter la réalisation sur 10, recommencer jusqu'à 10/10 partout.

## Recherches (sources)

| Sujet | Ce qu'on en retient | Source |
|---|---|---|
| Plusieurs PWA sur une origine | Des portées imbriquées (`/` et `/finances/`) font croire au navigateur qu'il s'agit de deux apps qui se volent les liens, les invites d'installation et les notifications. Pour **une** app : un seul manifeste, portée `/`, et aucun manifeste dans les sous-chemins. Stockage et autorisations sont partagés par l'origine (c'est ce qui rend la connexion unique possible). | [web.dev — multiple PWAs on the same domain](https://web.dev/articles/building-multiple-pwas-on-the-same-domain) |
| Transitions entre pages | `@view-transition { navigation: auto; }` sur les deux pages, même origine : Chrome 126+, Safari 18.2+ ; ailleurs, navigation normale sans erreur. Abandon si la page suivante met plus de 4 s. | [Chrome — cross-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document) |
| Formulaire d'inscription | `autocomplete="username"` / `"new-password"` / `"current-password"` pour que les gestionnaires de mots de passe proposent et enregistrent ; noms distincts entre inscription et connexion ; pas de détour par un courriel (il fait chuter les inscriptions). | [web.dev — sign-up form best practices](https://web.dev/articles/sign-up-form-best-practices), [Chrome I/O 26 — web identity](https://developer.chrome.com/blog/io26-web-identity) |
| Passkeys + PRF pour chiffrer | PRF disponible partout récemment (Safari 18+, Chrome 132+, Android), mais un co-éditeur de WebAuthn L3 déconseille d'en tirer des clés de chiffrement : perdre l'authentificateur = perdre les données ; versions iOS 18.0–18.3 boguées. | [Corbado — passkeys & PRF](https://www.corbado.com/blog/passkeys-prf-webauthn), [lilting.ch — co-editor says don't](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk) |

## Idées, notées avant réalisation

Note = intérêt pour l'objectif × fiabilité × coût, justifiée.

| # | Idée | Note | Pourquoi |
|---|---|---|---|
| A | **Une seule PWA « MyLife »** : manifeste à la racine (`id` et `scope` = `/`), raccourcis vers les 3 apps, manifestes des apps supprimés, chaque page relie le manifeste racine, une icône MyLife | 9 | Exactement la demande ; conforme à web.dev (une seule portée). −1 : les PWA déjà installées (MyFinances) restent à désinstaller à la main. |
| B | **Kit d'interface web partagé** `packages/ui` (CSS du verre et des identités, jetons Tailwind, composants, thème, navigation) extrait de MyFinances, recopié dans MyFinances, myRaveLoc et l'accueil | 10 | Seul moyen d'avoir 100 % d'identité commune sur le web : une seule source, plus de copie à la main. |
| C | **myRaveLoc reconstruit sur le kit** : même en-tête, dock + orbe, palette, Espaces, toutes les identités, clair et sombre | 9 | Aujourd'hui l'app la plus différente. −1 : la flèche de navigation doit rester lisible dans les thèmes clairs (à vérifier). |
| D | **Accueil MyLife = une vraie app** sur le kit : apps avec aperçu en direct, compte, apparence, installation | 9 | Le point d'entrée de la PWA unique doit être au niveau des apps. |
| E | **Compte comme une app standard** : un écran (pseudo + mot de passe, afficher/masquer, pas de confirmation, pas de code d'invitation), dérivation de clé native (WebCrypto, ~0,2 s au lieu de plusieurs secondes), clé de secours proposée après coup (copier / enregistrer / partager) avec rappel, connexion unique pour toutes les apps, reliure automatique des apps quand il n'y a pas d'ambiguïté | 9 | Retire toutes les frictions actuelles. −1 : le chiffrement de bout en bout interdit la « réinitialisation par courriel » des apps standard (la clé de secours la remplace). |
| E2 | Inscription ouverte protégée : limite par adresse IP et par jour, quota de stockage par compte | 9 | Nécessaire si on retire le code d'invitation. |
| F | Passkeys + PRF à la place du mot de passe | 4 | Rejetée : support encore fragile, avertissement de l'éditeur de la norme, risque de perte de données. |
| G | **Transitions entre apps** : view transitions entre documents + fond et thème peints dès la première image dans chaque app | 8 | Rend le passage d'une app à l'autre continu sur Chrome et Safari ; sans effet ailleurs. |
| H | Préchargement des autres apps (règles de spéculation, « moderate ») | 6 | Gain réel sur Chrome, nul ailleurs ; peu coûteux. |
| I | **Palette de commande transversale** : les destinations des 3 apps depuis n'importe laquelle | 8 | Fait sentir un seul système. |
| J | **Aperçus en direct** : chaque app dépose un résumé local (reste à dépenser, séance du jour, groupe actif), lu par l'accueil et les Espaces | 8 | Relie les apps sans rien envoyer au serveur. |
| K | Thème synchronisé entre appareils (synchro chiffrée, app `mylife`) | 7 | Couvre l'APK et les autres appareils. |
| L | MyPerf (React Native) aligné pixel par pixel sur le kit, vérifié par captures dans chaque identité | 8 | Le kit ne peut pas être partagé avec React Native : la parité se prouve par comparaison. |
| M | **Dépôt GitHub unique** (privé), historique des 4 dépôts conservé, README de présentation et d'utilisation | 9 | Demandé. Privé par défaut : le dépôt contient des données personnelles (programme d'entraînement). |

## Réalisation, notée après coup

(rempli à chaque itération)

### Itération 1 (22/10/2026) : état à l'interruption

Fait :
- B (kit `packages/ui`) : MyFinances l'utilise, avec 332 tests et 25 vérifications de bout en bout au vert. **9/10** : myRaveLoc ne l'utilise pas encore.
- E / E2 (comptes) : inscription ouverte et protégée côté serveur, dérivation de clé native, écrans communs, reliure automatique ; 42 tests MyLife au vert. **8/10** : MyPerf et myRaveLoc ne sont pas encore branchés.
- D (accueil) : l'app `web/` se construit (accueil, compte, apparence, installation, bienvenue), avec l'icône MyLife. **Non vérifiée** : la première capture n'a pas trouvé le bouton « Commencer » (à diagnostiquer).
- I, J, K : palette commune, aperçus et apparence synchronisée sont dans le kit ; seul MyFinances s'en sert.

Reste : diagnostiquer l'accueil ; relier le manifeste racine depuis chaque app (A) ; myRaveLoc sur le kit (C) ; MyPerf (compte simplifié, aperçu, palette, parité visuelle L) ; transitions (G, H) ; `vercel.json` de MyLife (build `web/`) ; déploiements ; dépôt GitHub privé + README (M) ; nouvelles notes.
