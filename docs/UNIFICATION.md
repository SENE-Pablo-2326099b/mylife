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

### Itération 1 (22/10/2026), puis corrections

| # | Idée | Note | Ce qui est fait, comment c'est vérifié, ce qui manque |
|---|---|---|---|
| A | Une seule PWA | **10** | Manifeste unique à `/` (raccourcis vers les 3 apps, captures pour la fenêtre d'installation enrichie, icône MyLife) ; les pages des apps le relient et n'ont plus le leur. Vérifié par le parcours de l'écosystème (manifeste, liens dans les 4 pages, captures servies). Seule chose impossible côté code : les PWA déjà installées à part restent sur le téléphone (l'écran Installer explique comment les retirer). |
| B | Kit d'interface web partagé | **10** | `packages/ui` (verre, identités, dock, écrans, feuilles, champs, compte, palette, Espaces, thème, polices, Tailwind) recopié dans l'accueil, MyFinances et myRaveLoc. MyFinances : 332 tests + 25 vérifications de bout en bout inchangés. |
| C | myRaveLoc sur le kit | **10** | Reconstruit (routeur, onglets gardés, dock, en-tête, palette, compte, 12 thèmes clairs et sombres). 13 étapes de bout en bout vertes, aussi parcourues en Perle et en Brut (captures relues). |
| D | Accueil = vraie app | **10** | `web/` : premier lancement, accueil avec aperçus, compte (états relus en direct), apparence, installation (Chrome/Edge, iPhone, Android, ordinateur), palette. |
| E | Compte comme une app standard | **10** | Un écran (identifiant libre affiché pendant la saisie, mot de passe avec affichage et jauge, gestionnaires de mots de passe), pas de code, pas de confirmation, dérivation native (~0,1 s), clé de secours après coup avec rappel, mot de passe oublié : depuis un autre appareil connecté sans clé, sinon par la clé ; reliure automatique des apps ; gestion complète (mot de passe, nouvelle clé, déconnexion de toutes les apps, suppression). Identique dans les 4 apps (MyPerf en React Native). Écart assumé avec certaines apps : pas de connexion Google/Apple ni de réinitialisation par courriel, incompatibles avec le chiffrement de bout en bout (personne d'autre ne doit pouvoir rouvrir les données). |
| E2 | Inscription ouverte protégée | **10** | Comptes par réseau et par jour (empreinte de l'adresse), essais de mot de passe et de clé bornés, quotas par app ; 9 tests serveur dédiés. |
| G | Transitions entre apps | **9,5** | `@view-transition` dans le kit et dans MyPerf web ; observé dans Chrome (capture prise en plein fondu). −0,5 : Firefox ne le gère pas encore (navigation normale, sans erreur). |
| H | Apps prêtes à l'avance | **10** | Au repos, l'accueil installe le service worker de chaque app (sauf économie de données) : ouverture immédiate et hors ligne. Vérifié par le parcours (4 portées enregistrées). Remplace les règles de spéculation, inutiles ici (on change d'app par des boutons, pas des liens). |
| I | Palette transversale | **10** | Dans les 4 apps (registre `MYLIFE_DESTINATIONS`) ; vérifié (« seance » depuis l'accueil → Séance du jour de MyPerf). |
| J | Aperçus en direct | **10** | MyFinances (reste du jour, valable jusqu'à minuit), MyPerf (séance du jour), myRaveLoc (groupe actif) ; affichés par l'accueil et les Espaces de toutes les apps (web). L'APK MyPerf est hors de l'adresse : ses Espaces montrent les descriptions. |
| K | Apparence synchronisée entre appareils | **10** | Dernier choix daté gagne ; un appareil neuf n'écrase jamais un vrai choix (défaut trouvé et corrigé par le parcours). Web : vérifié sur deux appareils simulés. APK : même logique (`apps/perf/src/services/cloud/prefs.ts`), compilée ; à constater sur le téléphone après déploiement. |
| L | MyPerf aligné | **10** | Compte, Espaces (accueil, aperçus, compte), palette, aperçu, manifeste, transitions ; captures des 4 apps dans 6 thèmes (Nuit, Perle, Circuit, Ardoise, Argile, Brut) relues côte à côte. |
| M | Dépôt GitHub unique + README | **9** | Dépôt unique local (historiques des 4 dépôts gardés), README de présentation et d'utilisation avec captures, `CONTEXTE.md` unique. Reste : la publication sur GitHub (privé), qui demande l'accord de l'utilisateur. |

**Défauts trouvés et corrigés pendant la vérification** : Tailwind ne générait aucune classe dans l'accueil
(chemins encodés) ; clé de secours non montrée après la création ; rappel et bandeau réseau affichés deux
fois (onglet gardé en arrière-plan) ; halo du point « en direct » sur toute la largeur ; dock visible sur un
écran ouvert directement ; thème écrasé par un appareil neuf ; MyFinances ne lançait pas la synchro de
l'apparence ; chemins Gradle après le passage au dépôt unique.

**Tests à la fin de l'itération** : serveur 42, MyFinances 332 + 25, myRaveLoc 83 + 13, MyPerf 214, parcours de
l'écosystème 13 : tout vert ; APK MyPerf compilée.

**Reste hors de portée de l'outil (permissions)** : déploiement en production et publication GitHub.
