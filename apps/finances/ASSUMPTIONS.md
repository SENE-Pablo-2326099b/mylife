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
34. **Objectifs de départ par cycle** (V1, inventés ; en V2 les nouvelles installations n'ont aucun objectif par défaut ⚙️) : Courses 150 €, Restos 80 €, Cantines 60 €, Sorties 60 €, Shopping 50 €, Livraison 40 €, Sport 40 €, Transport 30 €, Tabac 30 €.

## Alertes ⚙️

35. **Livraisons** : plus de 4 opérations « Livraison » dans le cycle = alerte ; exactement 4 = information.
36. **« Achat Amazon hors budget »** : achat Amazon fait alors que l'objectif Shopping du cycle était déjà dépassé, achat compris. Sans objectif Shopping, tout achat Amazon est signalé.
37. **Dépassement du budget du jour N jours de suite** : chaque jour est comparé au budget du jour tel qu'il était calculé ce jour-là. Une série en cours = alerte, une série passée dans le cycle = à surveiller.
38. **Tickets de bus** : opérations dont le libellé contient « metropole », sur 12 mois glissants, comparées au pass annuel (100 €). Information à partir de 80 %.
39. **Objectif de catégorie** : alerte au-delà de 100 %, avertissement à partir de 80 %.

## Interface et technique

40. ~~Thème sombre uniquement~~ → remplacé en V2 par les 8 thèmes Lumen (voir 47).
41. **iPhone** : la page de retour de banque ne consomme pas le code d'autorisation si elle s'ouvre hors du contexte qui a lancé la connexion (Safari au lieu de l'app installée). Elle propose de copier le lien à coller dans l'app.
42. **Sauvegarde JSON** : remplace toute la base à l'import, conserve le mot de passe du relais de l'appareil, refuse les montants non entiers.
43. **Déploiement non testé** : les fonctions Vercel (`api/eb.ts`) et Netlify (`netlify/functions/eb.ts`) sont écrites d'après la documentation de ces plateformes. Le même code de relais tourne et est testé localement via `vite dev` / `vite preview`. Les imports `../server/bridge.js` (extension `.js` vers un fichier `.ts`) suivent la convention ESM de Vercel.
44. **Captures d'écran** : Chrome sous WSL n'a pas de police emoji, d'où les carrés vides à la place des icônes de catégorie sur les captures. Sur téléphone, les emoji s'affichent normalement.
45. **Versions figées** sur des versions éprouvées (React 18, Vite 5, Tailwind 3, Dexie 4, Recharts 2, Vitest 2) plutôt que les toutes dernières majeures.
46. **PapaParse** (demandé pour le CSV) n'est plus utilisé, faute d'import CSV.

## V2 : design Lumen, personnalisation, patrimoine (détails dans V2.md)

47. **Lumen porté de React Native vers le web** à partir du code de MyPerfV2 : mêmes palettes (Nuit et Perle à l'identique, 6 thèmes dérivés d'une graine), mêmes niveaux de verre, mêmes ressorts (framer-motion avec les constantes de Reanimated), même typographie (Sora / Inter embarquées). Thème par défaut : **Nuit** ; « Suivre le téléphone » désactivé par défaut ⚙️.
48. **Flou réel** seulement sur la barre d'onglets, la barre condensée, les feuilles et les toasts ; ailleurs, et sur Android ou sans `backdrop-filter`, le verre est simulé (remplissage plus dense). Sur Android, les halos du fond ne dérivent pas et les blocs n'apparaissent pas en fondu, pour la fluidité.
49. **Plafond du grossissement des polices** : tailles en `min(rem, px)`, ce qui suit la taille de police du navigateur jusqu'à ×1,3 (×1,2 pour les étiquettes et contrôles). Le Dynamic Type d'iOS ne s'applique pas aux pages web.
50. **Retour haptique** = Vibration API (Android). Safari iOS n'en expose pas : pas de vibration sur iPhone.
51. **Suppressions** : jamais de popup ; toast « Annuler » pendant 6 s. La déconnexion d'une banque (irréversible côté banque) n'est envoyée qu'à la disparition du toast.
52. **Nom de l'app : « MyFinances »** (constante `APP_NAME`), dans la lignée de MyPerf. La base IndexedDB s’appelle `myfinances` (l’ancienne base de la V1 est reprise une fois puis supprimée, cf. `migrateLegacyDatabase`).
53. **Migration v1 → v2** : salaire, APL et prime d'activité → lignes de revenus (jour = jour de paie pour le salaire, le 5 pour les aides) ; charges fixes → une ligne « Charges fixes » sans jour ; investissement → épargne en mode « montant fixe » ; nom → titulaire. Une base v1 est considérée comme déjà configurée (pas d'accueil).
54. **Règles par défaut génériques** : enseignes nationales françaises. Lydia / Wero / Paylib sont classés « Entre amis » par défaut (c'est leur usage le plus courant), avec la contrepartie comme personne. Les règles personnelles de la V1 ne sont plus livrées, mais restent dans une base existante.
55. **Épargne prévue en mode auto** = somme des plans d'investissement actifs (ramenés au mois : 52 semaines / 12) + contributions mensuelles des objectifs cochés « compter dans le budget ». Elle est retirée de l'enveloppe.
56. **Placements** : PRU = prix de revient moyen pondéré (une vente retire du capital investi au PRU), comme les courtiers français. Une ligne sans cours est comptée à son prix de revient dans les totaux (signalé à l'écran).
57. **Plans programmés** : chaque échéance passée crée un achat du montant prévu ; la quantité est estimée au dernier cours connu et marquée « estimé ». Un nouveau plan n'est jamais rétroactif. Rattrapage limité à 400 jours.
58. **Cours** : Yahoo Finance `v8/finance/chart` et `v1/finance/search` (non officiels, sans clé), CoinGecko `simple/price` et `search` (publics). Conversion en euros au taux Yahoo du jour ; les cotations en pence (GBp) sont divisées par 100. Mise à jour au plus toutes les 6 h à l'ouverture, ou à la demande.
59. **Trade Republic / Bitstack** : pas d'API publique pour les particuliers (vérifié) ; suivi par saisie des positions + plans programmés + cours automatiques. Si Trade Republic apparaît dans la liste Enable Banking de ton pays, son compte espèces peut aussi être connecté comme une banque.
60. **Historique du patrimoine** : une photo par jour (à l'ouverture et à chaque modification). Avant la première, estimation = solde bancaire reconstitué à rebours + capital investi à la date + biens − dettes actuels, signalée « estimée ».
61. **Récurrences** : même commerçant (libellé normalisé sans chiffres ni mots bancaires, 3 premiers mots), au moins 3 échéances (2 si mensuel au montant identique, 4 si hebdomadaire), 75 % des intervalles dans la plage de la cadence, montants à ±30 % (±40 % pour un revenu). « Abonnement » = catégorie Abonnements, ou petit montant (≤ 100 €) identique chaque mois hors logement et épargne. Hausse de prix = dernier montant différent d'un montant des 3 échéances précédentes (≥ 0,50 € et ≥ 2 %).
62. **Prévision de trésorerie** : comptes courants visibles (pas l'épargne) ; récurrences détectées actives, hors dépenses courantes (déjà dans la moyenne quotidienne) ; puis lignes de réglages avec un jour, si aucune récurrence de montant proche (±10 %) au même jour (±5) ne les représente déjà ; puis plans programmés, sauf si un versement récurrent vers l'épargne du même montant existe. Dépense courante = moyenne des 8 dernières semaines. Horizon par défaut : veille de la prochaine paie.
63. **Indépendance financière** : capital actuel = placements + comptes épargne ; capital visé = dépenses annuelles ÷ taux de retrait (4 %) ; rendement 5 %, inflation 2 % ⚙️ ; dépenses = 12 derniers mois ramenés à l'année (au moins 60 jours d'historique), sinon (charges fixes + enveloppe) × 12.
64. **Objectifs** : versement nécessaire = reste ÷ mois restants (au moins 1) ; l'objectif passe en or (« atteint ») quand le montant est atteint, l'orbe s'allume au versement qui le complète.
65. **Démo** : personne fictive « Camille Martin » ; ses réglages ne s'appliquent que si aucun revenu ni charge n'est saisi, et sont retirés avec la démo.

## Moteur du budget (v2.1, `src/domain/budgetEngine.ts`)

66. **Paie en avance** : une opération de revenu à ±25 % de la plus grosse ligne de revenu (hors « versé directement »), arrivée jusqu'à 7 jours avant le jour de paie, ouvre le nouveau cycle ce jour-là. **Paie en retard** : le cycle commence quand même au jour prévu (le budget ne s'arrête pas faute de virement).
67. **Revenus du cycle** = montants des réglages (stables), y compris ceux **versés directement à un tiers** (APL au CROUS : la charge est débitée nette). Sans aucune ligne configurée, les revenus reçus dans le cycle servent de base.
68. **Revenu exceptionnel** = opération de revenu qui ne correspond à aucune ligne (chaque ligne prend au plus une opération, la plus proche de son montant à ±25 %). Neutre tant qu'il n'est pas affecté : « Au budget » l'ajoute à l'enveloppe de ce cycle, « De côté » le laisse hors budget.
69. **Remboursement entre particuliers** : neutre, sauf rattaché à une dépense (éditeur d'opération) ; il réduit alors la dépense, à la date de la dépense. Le rattachement suit la dépense quand elle passe d'« en attente » à définitive.
70. **Premier cycle partiel** : si la plus ancienne opération connue est postérieure au début du cycle, l'enveloppe est ramenée au prorata des jours couverts.
71. **Enveloppe dépassée** : budget du jour = 0 € (jamais négatif) ; on affiche le déficit et « 0 € par jour pour ne pas l'aggraver ». Le déficit n'est pas reporté sur le cycle suivant.
72. **Charges réservées** : une charge fixe est « débitée » si une opération du cycle (charge fixe ou non classée) cite un mot de son libellé (≥ 4 lettres, hors « loyer », « abonnement »…) ou, à défaut, a un montant à ±20 %. Les autres restent réservées et réduisent le « réellement libre » (solde des comptes courants − charges et épargne encore à venir).
73. **Projection** : rythme = dépenses variables des jours écoulés ÷ jours écoulés (la journée en cours n'entre pas dans la moyenne) ; position de fin de cycle = enveloppe − (dépensé + rythme × jours restants).
74. **Plafond réel** : le budget du jour = le plus petit de (enveloppe − dépenses du cycle) et de l'argent **réellement libre** : soldes des comptes « Quotidien » − sorties engagées d'ici la paie, détectées automatiquement (prélèvements récurrents de l'historique, charges des réglages non détectées, investissements programmés, épargne manuelle pas encore versée). Les dépenses du jour, déjà dans le solde, sont réintégrées pour que le budget reste fixe dans la journée. Les revenus attendus avant la paie ne sont pas comptés (prudence). Les virements récurrents entre mes comptes ne sont pas des sorties.
75. **Rôle d'un compte** (Banques → toucher le compte) : « Quotidien » compte dans l'argent disponible ; « Épargne » (livret, cash d'un courtier) non.
76. **Recalage sur le courtier** (mouvement « Recalage ») : quantité + prix d'achat moyen (ou total investi) affichés par l'app du courtier deviennent la référence à cette date ; tout ce qui précède est remplacé, les mouvements suivants s'ajoutent (PRU pondéré). Un recalage passe après les mouvements du même jour.
77. **Achats depuis la banque** (Bitstack, tout service sans API) : chaque débit définitif dont le libellé contient le mot-clé de la ligne devient un achat (crédit = vente), quantité = montant ÷ cours de clôture du jour (CoinGecko / Yahoo via le relais, sinon dernier cours connu), marquée « estimée » (frais inconnus). Seuls les prélèvements postérieurs au dernier recalage et à la date de début du lien comptent. Un plan programmé sur une ligne reliée est mis en pause et n'est plus exécuté.
