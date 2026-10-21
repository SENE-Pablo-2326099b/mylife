# MyLife

Point d'entrée commun des apps personnelles, sur **une seule origine** (même adresse) :

| Chemin | App | Projet Vercel | Dépôt |
|---|---|---|---|
| `/` | Accueil (ce dépôt) | `mylife` | `~/PersoDev/MyLife` |
| `/finances/` | MyFinances (PWA) | `myfinances` | `~/PersoDev/Budget` |
| `/perf/` | MyPerf (PWA) | `myperf` | `~/PersoDev/MyPerfV2` (`npm run build:web && npm run deploy:web`) |
| `/api/eb` | Relais Enable Banking + cours | `myfinances` | `~/PersoDev/Budget` |

Les chemins `/finances` et `/perf` sont des réécritures Vercel vers les projets de chaque app : chaque
app reste un dépôt indépendant, déployable seule, mais le navigateur ne voit qu'une adresse. C'est ce
qui permettra une connexion unique et la synchronisation chiffrée entre appareils (étapes suivantes).

Déployer l'accueil : `npx vercel@61.1.0 deploy --prod`.

**Après le déploiement d'une app** : si un fichier répond 404 *via MyLife* alors qu'il existe sur l'adresse
de l'app (le CDN de MyLife a pu garder un 404 obtenu pendant la mise en ligne), redéployer MyLife vide son cache.
