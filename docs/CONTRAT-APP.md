# Le contrat d'app MyLife

Une app de l'accueil (MyMusique, MyGames, Mes apps, et les nouvelles apps de la V4 : MyObjectifs, MyChef…) n'est
**finie que si elle branche toute la prise MyLife**. Sinon, c'est une pile d'apps, pas un écosystème, et un oubli finit
par laisser les données d'un compte à un autre.

## Créer une app

```
npm run new-app chef "MyChef" --icon leaf --tagline "Courses, garde-manger, repas de la semaine"
npm run vendor && npm test
```

Le générateur (`scripts/new-app.mjs`) écrit une app déjà branchée, qui compile, passe les tests et se synchronise
entre deux appareils :

| Il crée | Rôle |
|---|---|
| `packages/lumen/src/<id>.ts` + `tests/<id>.test.ts` | Le moteur pur (lecture prudente d'un élément) et son test |
| `web/src/<nom>Data.ts` | Une collection synchronisée (`defineCollection`) |
| `web/src/pages/<Nom>.tsx` | L'écran, chargé à la demande, avec le kit |

| Il complète (aux repères `new-app:`) | Rôle |
|---|---|
| `packages/lumen/src/homeApps.ts` | L'entrée du registre `HOME_APPS` |
| `packages/lumen/src/index.ts` | L'export du moteur, la destination de la palette (toutes les apps) |
| `web/src/App.tsx` | La route |
| `web/src/appData.ts` | Sa part de l'export de « Mes données » |
| `server/core.ts` | Son app de synchro et son quota (`SYNC_APPS`) |

## Les prises

| Prise | Où | Vérifiée par |
|---|---|---|
| Registre (nom, chemin, icône, ligne d'accueil) | `HOME_APPS` | `tests/contract.test.ts` |
| Accueil (tuile ou grande carte) | découle du registre | idem |
| Route et palette de toutes les apps | `App.tsx`, `MYLIFE_DESTINATIONS` | idem |
| Synchro chiffrée déclarée au serveur | `SYNC_APPS`, champ `sync` | idem |
| Effacée quand un autre compte se connecte | champ `storage` ⊂ `PERSONAL_PREFIXES` (`mylife:app:` pour les collections) | idem |
| Export de « Mes données » | `APP_EXPORTS` | idem |
| Page de confidentialité | champ `privacy` (la page lit le registre) | idem, puis relecture |
| Personnage | compteurs par semaine (jamais de détail), champ `stat` | à la main |
| Copilot | outil de lecture dans `web/src/copilot.ts` ; plus tard ses actions validées | à la main |
| Wrapped et Bilan | une story, une ligne | à la main |
| Crew | ce qui est partageable, stat par stat ; jamais de donnée brute | à la main |
| Parcours de bout en bout | `tests/e2e/ecosystem.e2e.ts`, dont 320 px et un autre compte qui repart de zéro | à la main |

## Collections synchronisées

`packages/ui/src/collectionSync.ts` : des lignes indépendantes (un ingrédient, une recette, un objectif), chacune
chiffrée et datée.

```ts
export const items = defineCollection({ app: 'chef', name: 'items', parse: parseItem });
items.put(id, value);   // ajoute ou remplace (la plus récente gagne sur les autres appareils)
items.remove(id);       // la suppression suit ; la trace disparaît une fois envoyée
items.useList();        // les lignes, en direct (autres onglets et synchro comprises)
```

- Une app peut avoir plusieurs collections (`name`) sur la même app de synchro.
- `parse` vérifie tout ce qui arrive d'un autre appareil : une ligne illisible est ignorée.
- 5 000 lignes par collection par défaut (`max`) ; quota serveur dans `SYNC_APPS`.
- Synchro au lancement, au retour sur l'app, et un peu après chaque modification ; un échec qui revient s'affiche sur
  la page Compte.

## Où vit une app

Par défaut **dans `web/`**, en pages chargées à la demande : pas de nouveau projet Vercel, pas de nouvelle copie du
kit, un seul déploiement. Une app à part (`apps/<id>`) seulement si elle a besoin d'une autre pile technique.
