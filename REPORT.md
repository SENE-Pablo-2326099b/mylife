# Rapport de livraison : Budget Dodge

État au 17/10/2026. Vérifié en fin de travail : `npm run typecheck`, `npm run lint`, `npm test` (**168 tests, 14 fichiers**), `npm run build`, `npm run preview` (pages et manifeste servis en 200) et `npm run screenshots` (16 captures à 390 px, **aucune erreur console, aucun débordement horizontal**, rechargement hors ligne OK).

## Changement de cap en cours de route

Après le lancement, tu as demandé de **tout faire passer par Enable Banking** au lieu de l'import manuel. Conséquences :

- l'import CSV, l'écran de mapping manuel des colonnes et PapaParse ont été abandonnés ;
- l'API Enable Banking refuse les appels directs depuis un navigateur (pas de CORS, signature RSA obligatoire). Tu as validé l'option **fonction serverless sans état**, qui garde la clé privée et relaie les requêtes ;
- tu n'as pas encore de compte Enable Banking : l'intégration est codée d'après la référence officielle de l'API et testée sur des réponses simulées. Ni la connexion réelle à BNP / Revolut ni le déploiement n'ont pu être essayés (voir « Ce qui n'est pas fait »).

## Ce qui est fait

| Étape | Commit | Contenu |
|---|---|---|
| a | `(a) Squelette…` | React + Vite + TS + Tailwind, base Dexie, réglages du cycle et de l'enveloppe |
| b | `(b) Relais Enable Banking…` | relais sans état (Vercel, Netlify, middleware Vite), JWT RS256, liste blanche d'opérations, mot de passe |
| c | `(c) Synchro Enable Banking…` | couche `DataSource`, mapping, déduplication, opérations en attente, écrans Synchro et retour de banque |
| d | `(d) Catégories, règles…` | moteur de règles, transferts internes appariés, file « à classer » (raccourcis clavier), correction → règle, écran Opérations, soldes entre amis |
| e | `(e) Écran « Aujourd'hui »…` | budget du jour, jauge vert / orange / rouge, opérations du jour, bannières |
| f | `(f) Écran Cycle…` | courbe cumulée vs trajectoire et cycle précédent, catégories avec objectifs, part de la nourriture |
| g | `(g) Alertes…` | les 5 alertes demandées, toutes réglables, badge dans la navigation |
| h | `(h) PWA…` | PWA installable et hors ligne, export / import JSON, données de démo, CSP `connect-src 'self'` |
| i | `(i) …` | captures automatisées, corrections de mise en page, README, ASSUMPTIONS, REPORT |

Points clés :
- **Montants en centimes entiers** partout. La conversion texte ↔ centimes ne passe jamais par un calcul en flottant.
- **Tests** : relais (signature JWT vérifiée avec la clé publique, mot de passe, injection de chemin), mapping Enable Banking sur les échantillons, déduplication et chevauchement, opérations en attente remplacées, transferts internes, moteur de règles (40+ commerçants réels), cycle 26→25 (mois de 28 / 29 / 30 / 31 jours, changement d'année, jour de paie 30 / 31), budget du jour, alertes, sauvegarde, synchro de bout en bout sur une base IndexedDB simulée.
- **Accessibilité** : lien d'évitement (vérifié au clavier par le script de captures), cibles tactiles de 44 px minimum, statut de la jauge donné en texte et en icône, table de données sous le graphique, focus visible, `aria` sur les boutons, interrupteurs et la boîte de dialogue.

## Ce qui n'est pas fait / limites

1. **Aucun test contre une vraie banque.** Les libellés BNP / Revolut renvoyés par Enable Banking sont devinés. Le seul contact réel avec l'API a confirmé que le JWT est accepté (réponse « application inconnue »). Il faudra sans doute ajuster quelques règles et le nettoyage des libellés après ta première synchro.
2. **Déploiement Vercel / Netlify non testé.** Le relais tourne en local (`npm run dev` / `npm run preview`), mais les adaptateurs serverless n'ont jamais été déployés.
3. **Import CSV et mapping manuel** : abandonnés à ta demande. L'architecture `DataSource` permettrait de les remettre comme source de secours.
4. **Pas de thème clair**, pas de notifications.
5. Les emoji des catégories n'apparaissent pas sur les captures (pas de police emoji sous WSL). Sur téléphone, ils s'affichent normalement.

Les hypothèses prises (46) sont détaillées dans [ASSUMPTIONS.md](ASSUMPTIONS.md). Les plus structurantes :
- Logement et Abonnements sont des charges fixes : hors budget du jour, mais visibles dans le Cycle.
- Le budget du jour se calcule sur les dépenses jusqu'à hier.
- Un débit non classé compte comme une dépense.
- « Amazon hors budget » = objectif Shopping déjà dépassé.
- Les objectifs de catégorie de départ sont inventés.

## Lancer l'app

```bash
npm install
npm run dev                  # http://localhost:5173
# Réglages → Sauvegarde et données → « Charger des données de démo »

npm test                     # 168 tests
npm run build && npm run preview   # build de production sur http://localhost:4173
npm run screenshots          # captures 390 px dans screenshots/ (après build)
```

Pour la synchro réelle : créer l'application Enable Banking, remplir `.env.local` (`EB_APP_ID`, `EB_PRIVATE_KEY` ou `EB_PRIVATE_KEY_PATH`, `BRIDGE_PASSWORD`), puis *Synchro* dans l'app. Le pas-à-pas complet et le déploiement Vercel sont dans le [README](README.md).

## Les 5 améliorations que je ferais ensuite

1. **Caler l'app sur tes vraies données** : faire une première synchro en *restricted production*, remplacer les échantillons de `samples/enablebanking/` par de vraies réponses anonymisées, puis ajuster `prettifyLabel` et les règles.
2. **Déployer sur Vercel et ajouter des tests de bout en bout en CI** (GitHub Actions + Playwright) contre le déploiement de prévisualisation, relais compris (en mode *sandbox* Enable Banking).
3. **Projection de fin de cycle et détection des récurrences** : estimer le reste au 25 au rythme actuel, et repérer automatiquement abonnements et charges fixes réels pour les comparer aux 359 € prévus.
4. **Verrouiller les données locales** : chiffrer IndexedDB avec une phrase secrète (WebCrypto) et ajouter un déverrouillage biométrique (WebAuthn). Un téléphone perdu ne donnerait alors pas accès à l'historique.
5. **Rappel quotidien** : notification locale (Periodic Background Sync / Notification API) en fin de journée, « il te reste X € aujourd'hui », et bilan hebdomadaire des catégories qui dérivent.
