# Hypothèses et décisions

Choix faits sans pouvoir te demander (mode autonome), ou imposés par une contrainte technique.
Tout ce qui est marqué ⚙️ est modifiable dans l'app.

## Source des données : Enable Banking

1. **Plus d'import CSV ni de mapping manuel.** À ta demande en cours de route, toutes les opérations passent par Enable Banking. Les parties CSV du cahier des charges (parseurs, détection du séparateur, mapping manuel des colonnes) ne sont pas implémentées.
2. **Un relais serveur est indispensable.** Testé le 17/10/2026 : `api.enablebanking.com` ne renvoie aucun en-tête CORS (le pré-vol `OPTIONS` répond 401) et chaque requête doit être signée en RS256 avec la clé privée de l'application. Tu as choisi la **fonction serverless sans état** (Vercel / Netlify). Le « 100 % côté client » devient donc : données stockées uniquement sur l'appareil, et un relais sur ton propre domaine qui ne stocke rien.
3. **La clé privée reste sur le serveur** (variable d'environnement), jamais dans le navigateur. Le relais est protégé par un mot de passe partagé, stocké sur l'appareil et exclu des sauvegardes JSON.
4. **Le relais n'expose que la lecture** (AIS) : banques, autorisation, session, détails, soldes, transactions. Les identifiants sont validés (UUID, dates ISO) pour empêcher d'atteindre d'autres routes de l'API.
5. **Validité de l'accès demandée** : le maximum annoncé par la banque (`maximum_consent_validity`), plafonné à 180 jours, moins une heure de marge.
6. **Identité d'un compte** : `identification_hash` d'Enable Banking, stable d'une connexion à l'autre. Une reconnexion après expiration rattache donc l'historique existant au lieu de créer un nouveau compte.
7. **Banques ciblées** : BNP Paribas et Revolut sont cherchées dans la liste `GET /aspsps?country=FR` par nom (`/bnp paribas/i`, `/revolut/i`). Si Revolut est listé sous un autre pays pour ton compte, utilise « Autre banque… ».
8. **Fenêtre de synchro** : 90 jours à la première synchro ⚙️ (au-delà, la plupart des banques exigent une nouvelle authentification), puis depuis la dernière synchro − 7 jours, et au moins depuis la plus ancienne opération en attente.
9. **Synchro automatique** à l'ouverture si la dernière date de plus de 6 h ⚙️ : la DSP2 limite à 4 accès sans l'utilisateur par jour et par compte. Les en-têtes `Psu-*` (utilisateur présent) ne sont pas envoyés.
10. **Format réel non vérifié.** Sans compte de test, les libellés renvoyés par BNP et Revolut via Enable Banking ont été **devinés** d'après la référence de l'API et les libellés usuels de ces banques. Les échantillons de `samples/enablebanking/` sont fictifs. Seul point vérifié en conditions réelles : l'API accepte le format du JWT (réponse `403 Application does not exist` avec un ID inventé, donc le jeton a bien été lu).
11. **Date d'une opération** = `transaction_date` si présente (date d'achat réelle), sinon `booking_date`, sinon `value_date`. C'est plus juste pour un suivi au jour près, au prix d'un écart possible avec le relevé papier pour les paiements carte BNP (comptabilisés 1 à 2 jours après).
12. **Statuts** : `PDNG` et `HOLD` = en attente ; `CNCL` (annulée), `RJCT` (rejetée) et `SCHD` (programmée, pas encore débitée) sont ignorées ; `BOOK` et `OTHR` = définitives.
13. **Signe des montants** : `credit_debit_indicator` fait foi (`DBIT` = négatif). En son absence, le signe du montant texte est conservé.
14. **Solde affiché** : le solde le plus « disponible » parmi ceux renvoyés (ordre ITAV, CLAV, XPCD, ITBD, CLBD…).

## Déduplication et opérations en attente

15. **Clé** = compte + date + montant + libellé normalisé (minuscules, sans accents ni ponctuation) + rang d'apparition dans le lot (deux cafés identiques le même jour restent deux opérations). La référence bancaire (`entry_reference` / `transaction_id`) sert de contrôle supplémentaire.
    *Limite connue* : deux opérations strictement identiques le même jour, dont une seule est retéléchargée lors d'une synchro partielle, pourraient produire un doublon. C'est très improbable avec le chevauchement de 7 jours.
16. **En attente** : à chaque synchro, toutes les opérations en attente d'un compte sont supprimées puis remplacées par celles que renvoie la banque. Une opération en attente qui disparaît (paiement annulé) disparaît donc aussi de l'app. Une catégorie ou une note saisie à la main sur une opération en attente est reportée sur sa version définitive (même montant, même libellé, ±5 jours).
17. **Les opérations en attente comptent dans les dépenses** : l'argent est déjà engagé.

## Budget et cycle

18. **Cycle** du jour de paie (inclus) à la veille du jour de paie suivant ⚙️. Si le jour de paie n'existe pas dans le mois (29-31), on prend le dernier jour du mois. Un salaire versé en avance (paie un dimanche) ne décale pas le cycle.
19. **Budget du jour** = (enveloppe − dépenses courantes du cycle **jusqu'à hier**) ÷ jours restants **aujourd'hui inclus**, arrondi au centime inférieur. Les dépenses du jour ne réduisent pas le budget du jour : elles le consomment (sinon le budget baisserait à chaque achat, ce qui le rendrait illisible).
20. **Jauge** : vert jusqu'à 75 % du budget du jour, orange jusqu'à 100 %, rouge au-delà, rouge aussi si l'enveloppe est épuisée. Le statut est aussi écrit en toutes lettres avec une icône (pas seulement la couleur).
21. **Ce qui consomme l'enveloppe « vie courante »** : les catégories de type *dépense courante*. **Logement** et **Abonnements** sont des *charges fixes* : elles comptent dans les dépenses du cycle (écran Cycle) mais pas dans le budget du jour, puisqu'elles sont déjà soustraites via « charges fixes » (359 €) ⚙️. Transferts, épargne, remboursements entre amis et revenus ne comptent jamais.
22. **Opération non classée** : un débit compte comme dépense courante (prudence), un crédit est ignoré.
23. **Remboursement d'un commerçant** (crédit dans une catégorie de dépense) : vient en déduction des dépenses de cette catégorie.
24. **Part de la nourriture** = Courses + Cantines + Restos & snacks + Livraison ⚙️, rapportée au total des dépenses du cycle (charges fixes incluses).
25. **Comparaison avec le cycle précédent** : au même stade (même nombre de jours écoulés) et en total.

## Classement

26. **Règles** comparées au libellé + texte brut normalisés. Un mot-clé à plusieurs mots est reconnu si la phrase exacte ou tous ses mots (de 2 lettres ou plus) sont présents, dans n'importe quel ordre. Les regex s'appliquent au même texte normalisé (par exemple `o ?tacos` pour « O'Tacos »).
27. **Priorités** : transferts internes (45-60) > épargne (40) > remboursements (30) > **tes règles** (25) > loyer (15-20) > revenus (10) > commerçants par défaut (0-5). À priorité égale, le motif le plus long gagne.
28. **Une correction manuelle n'est jamais écrasée** par les règles. Le bouton « Revenir au classement auto » l'annule.
29. **CROUS** : ≤ 30 € = cantine ; débit ≥ 100 € = loyer (Logement).
30. **Forfait téléphone** : opérateur inconnu, la règle couvre Free Mobile, Sosh, RED by SFR, SFR, Bouygues Telecom, B&You, Orange SA, Prixtel, Lebara, et le mot « forfait ». À ajuster ⚙️.
31. **« Google »** est rangé en Abonnements comme demandé : un achat Google Play ponctuel le sera aussi.
32. **Transferts internes** reconnus de trois façons : (a) IBAN de la contrepartie = un de tes comptes connectés ; (b) règles « Top up », « Virement … Revolut », « Paiement envoyé par / Payment from M PABLO SENE » (nom du titulaire ⚙️) ; (c) **appariement** : un débit et un crédit de même montant, sur deux de tes comptes, à 4 jours d'écart au plus, dont l'un est déjà reconnu comme transfert. L'autre jambe passe alors en transfert. Elle n'est jamais comptée deux fois.
33. **Remboursements entre amis** : la personne vient de la règle (Lancelot Simon) ou, à défaut, du nom de la contrepartie. Solde net = somme des flux (positif = tu as reçu plus que versé).
34. **Objectifs de départ par cycle** (inventés, à ajuster ⚙️) : Courses 150 €, Restos 80 €, Cantines 60 €, Sorties 60 €, Shopping 50 €, Livraison 40 €, Sport 40 €, Transport 30 €, Tabac 30 €.

## Alertes ⚙️

35. **Livraisons** : plus de 4 opérations « Livraison » dans le cycle = alerte ; exactement 4 = information.
36. **« Achat Amazon hors budget »** : achat Amazon fait alors que l'objectif Shopping du cycle était déjà dépassé, achat compris. Sans objectif Shopping, tout achat Amazon est signalé.
37. **Dépassement du budget du jour N jours de suite** : chaque jour est comparé au budget du jour tel qu'il était calculé ce jour-là. Une série en cours = alerte, une série passée dans le cycle = à surveiller.
38. **Tickets de bus** : opérations dont le libellé contient « metropole », sur 12 mois glissants, comparées au pass annuel (100 €). Information à partir de 80 %.
39. **Objectif de catégorie** : alerte au-delà de 100 %, avertissement à partir de 80 %.

## Interface et technique

40. **Thème sombre uniquement** (pas de thème clair).
41. **iPhone** : la page de retour de banque ne consomme pas le code d'autorisation si elle s'ouvre hors du contexte qui a lancé la connexion (Safari au lieu de l'app installée). Elle propose de copier le lien à coller dans l'app.
42. **Sauvegarde JSON** : remplace toute la base à l'import, conserve le mot de passe du relais de l'appareil, refuse les montants non entiers.
43. **Déploiement non testé** : les fonctions Vercel (`api/eb.ts`) et Netlify (`netlify/functions/eb.ts`) sont écrites d'après la documentation de ces plateformes. Le même code de relais tourne et est testé localement via `vite dev` / `vite preview`. Les imports `../server/bridge.js` (extension `.js` vers un fichier `.ts`) suivent la convention ESM de Vercel.
44. **Captures d'écran** : Chrome sous WSL n'a pas de police emoji, d'où les carrés vides à la place des icônes de catégorie sur les captures. Sur téléphone, les emoji s'affichent normalement.
45. **Versions figées** sur des versions éprouvées (React 18, Vite 5, Tailwind 3, Dexie 4, Recharts 2, Vitest 2) plutôt que les toutes dernières majeures.
46. **PapaParse** (demandé pour le CSV) n'est plus utilisé, faute d'import CSV.
