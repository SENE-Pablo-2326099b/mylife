# MyLife : consignes pour Claude

Dépôt unique de l'écosystème MyLife : l'accueil (`web/`, la seule PWA installable), l'API (`api/`, `server/`),
les paquets partagés (`packages/`) et trois apps (`apps/finances`, `apps/perf`, `apps/raveloc`).

**Au début d'une tâche, lire `docs/VISION.md`** (la direction de la V5, décidée le 13/11/2026 : elle prime sur
tout le reste), puis `CONTEXTE.md` (état technique actuel : architecture, commandes, règles, ce qui part en phase 1)
et `docs/V5.md` (journal de la V5 : **sa tête dit où on en est exactement et ce qu'il faut garder obligatoirement**). Selon le sujet : `docs/ARCHITECTURE.md` (détail technique), `apps/perf/CLAUDE.md`
pour MyPerf. L'historique d'avant la V5 (journaux V3 et V4, refonte MyFinances…) est dans `docs/archives/`.

## Règles qui ne se négocient pas
- **Rien de personnel** : aucune donnée de l'utilisateur ne doit apparaître pour un autre compte ni dans ce qui est
  livré (ni nom ou prénom, y compris en exemple sur un écran d'identifiant ; ni séances, ni salaire dans des valeurs par
  défaut). Un compte neuf part de zéro, même sur un navigateur qui contient déjà des données.
- **Jamais de secret affiché** : ni `DATABASE_URL`, ni `SESSION_SECRET`, ni clés (API, VAPID, Steam), ni dans un
  message, ni dans un journal, ni dans un commit. Pas de fichier `.env*` dans le dépôt.
- La clé d'API Anthropic de l'utilisateur reste sur son appareil : jamais synchronisée ni sauvegardée.
- Aucune analytique, aucun traceur.
- Le dépôt GitHub reste privé.

## Comment travailler
- Le code partagé se modifie dans `packages/`, **jamais dans les copies** (`*/src/vendor/*`, `*/src/ui` des apps
  web) ; ensuite `npm run vendor`, et commiter les copies avec.
- Toute UI web passe par le kit `packages/ui` ; tout en français, tutoiement.
- Avant de conclure : `npm run build:all`, `npm run lint`, `npm run test:all`, et pour ce qui touche aux écrans
  `npm run e2e:all` (Chrome attendu à `/usr/bin/google-chrome`, ou `CHROME_PATH`). Les tests du serveur et de bout en
  bout tournent sur une base Postgres en mémoire (PGlite) : aucune base réelle ni secret nécessaire.
- Noter chaque évolution importante dans `docs/V5.md` (et `CONTEXTE.md` si l'architecture change).
- Messages de commit en français, descriptifs, terminés par
  la ligne `Co-Authored-By` du modèle utilisé (`Claude Fable 5.2 <noreply@anthropic.com>` ou `Claude Opus 5.5 <noreply@anthropic.com>`).

## Dans le cloud (claude.ai/code)
- Le hook SessionStart (`.claude/settings.json` → `scripts/cloud-setup.sh`) installe les dépendances de l'accueil et
  des trois apps, et Chrome pour les tests de bout en bout. Journal : `/tmp/mylife-cloud-setup.log`.
- Travailler sur une branche, la pousser ; l'utilisateur relit et fusionne.
- **Pas de déploiement depuis le cloud** : `npm run deploy:all` se lance sur la machine de l'utilisateur, après fusion.
- Pas d'accès à la base de production ni aux scripts qui la lisent (`npm run support`, `npm run stats:serveur`).
