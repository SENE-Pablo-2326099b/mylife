# Échantillons Enable Banking (anonymisés, fictifs)

Réponses JSON au format de l'API Enable Banking (`GET /accounts/{uid}/transactions`,
`POST /sessions`, `GET /accounts/{uid}/balances`), construites d'après la référence officielle
et les libellés typiques de BNP Paribas et Revolut. Elles servent aux tests unitaires
(`tests/ebMapping.test.ts`, `tests/sync.test.ts`).

Le format exact renvoyé par chaque banque n'a pas pu être vérifié sans compte réel :
voir `ASSUMPTIONS.md`. Une fois ta connexion faite, tu peux remplacer ces fichiers par
de vraies réponses anonymisées pour durcir les tests.

- `session-bnp.json`, `session-revolut.json` : réponse de `POST /sessions`
- `bnp-transactions.json`, `revolut-transactions.json` : une page de transactions
- `revolut-transactions-later.json` : la même période téléchargée plus tard
  (opérations en attente devenues définitives + chevauchement)
- `balances.json` : réponse de `GET /accounts/{uid}/balances`
