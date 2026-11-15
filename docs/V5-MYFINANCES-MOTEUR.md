# MyFinances V5 : le moteur financier (réflexion avant conception)

> 15/11/2026. Le premier test sur données réelles (étape 3.3) a montré deux moteurs qui donnent deux réponses : le
> nouveau calcul dit « 0,56 € de trop aujourd'hui », l'app actuelle « 35,02 € de trop ». Aucune n'inspire confiance.
> Avant tout écran, on fige les règles métier. Ce document est la réflexion d'architecture ; il se termine par les
> questions dont les réponses décideront de la conception. Les écrans (3.4 et suivantes) attendent.

## Le principe : tout est configurable, sauf l'arithmétique

Tu demandes zéro règle figée. Je te suis sur presque tout, avec une réserve que j'assume : **un tout petit noyau doit
rester fermé**, sinon plus aucun total n'est garanti.

- **Fermé (5 valeurs, le sens comptable d'un flux)** : dépense, revenu, virement interne, mise de côté (épargne ou
  investissement), remboursement. C'est ce qui dit si l'argent sort de ta poche, y entre, ou change seulement de place.
- **Ouvert (tout le reste)** : catégories et sous-catégories, tags, marchands, règles de tri, enveloppes, rôles des
  comptes, cycles, reports. Aucune catégorie livrée n'a de comportement spécial : « Courses » n'est qu'un nom.

Autrement dit : l'utilisateur décide librement **comment il range**, jamais **comment on additionne**.

## 1. Angles morts et cas limites

**Ce qui fausse le budget**
- **Avance pour des amis** : tu paies 80 € pour quatre. Ta dépense réelle est de 20 €, mais les 60 € reviennent plus
  tard, parfois au cycle suivant. Sans rattachement à la dépense d'origine, un cycle est plombé et l'autre gonflé. Et
  l'argent « qu'on te doit » n'est pas disponible tant qu'il n'est pas arrivé.
- **Achat financé par l'épargne** : un virement livret → courant puis un gros achat. Ce n'est pas une dépense du
  quotidien : il doit réduire le patrimoine sans toucher au budget du jour.
- **Paiement fractionné (4x)** : un achat, quatre débits sur plusieurs cycles. Soit on compte chaque échéance dans son
  cycle, soit tout d'un coup ; dans les deux cas, les échéances restantes sont une dette à court terme qui doit
  réduire le cash libre.
- **Charges annuelles ou irrégulières** (assurance, impôt, abonnement annuel) : sans lissage, un cycle par an explose.
- **Retour d'un achat** d'un cycle précédent : le crédit doit-il corriger l'ancien cycle ou alléger le cycle courant ?
- **Retrait d'espèces** : un virement vers un compte « Espèces », pas une dépense ; les dépenses en espèces sont
  ensuite saisies à la main, ou le retrait est compté en bloc.
- **Revenus irréguliers** : paie en avance ou en retard, deux paies dans un cycle, prime, treizième mois.

**Ce qui fausse la trésorerie**
- **Carte à débit différé** : les dépenses apparaissent tout de suite, l'argent part en fin de mois. Le solde
  bancaire surestime alors l'argent disponible.
- **Opérations en attente** : montant provisoire, identifiant qui change à la validation, date d'opération différente
  de la date de valeur. Risque de double comptage ou d'oubli.
- **Provisions** : de l'argent présent sur un compte courant mais réservé à un prélèvement à venir. Compté comme
  libre, il fait croire à une marge qui n'existe pas ; classé en épargne, il fausse le patrimoine.
- **Découvert** : un solde négatif est une dette, pas un cash libre négatif qu'on « rattrape ».
- **Virement interne dont une jambe manque** (compte non synchronisé, délai d'un jour ou deux) : sans appariement,
  il devient une dépense d'un côté ou un revenu de l'autre.
- **Devises** (Revolut) : frais et taux de change entre l'autorisation et le débit.

**Ce qui fausse le patrimoine**
- Acheter un titre n'est pas une dépense ; vendre n'est pas un revenu ; seuls les dividendes, intérêts et plus-values
  enrichissent. Les cours bougent sans aucun flux.
- **Clôture anticipée d'un objectif** : l'argent libéré redevient disponible, ou est réaffecté ? Il ne doit pas
  apparaître comme un revenu.

**Ce qui fausse l'historique**
- **Reclasser après coup** : changer une catégorie ou une règle modifie les cycles passés. Faut-il les recalculer ou
  les figer à leur clôture ?
- **Fusionner ou archiver une catégorie** : l'historique doit suivre sans perdre un centime.
- **Doublons** : une dépense saisie à la main puis arrivée par la banque.

## 2. Modèle conceptuel

L'idée centrale : **séparer le fait de son interprétation.**

| Entité | Rôle | Modifiable |
|---|---|---|
| **Compte** | Où est l'argent. Son comportement vient de paramètres, pas d'un type figé : compte dans le cash quotidien ou non, compte de provision dédié, compte dans le patrimoine, seuil d'alerte, débit différé | oui |
| **Opération** | Le fait bancaire : compte, date, montant, libellé. Jamais réécrite | non |
| **Affectation** | L'interprétation : une ou plusieurs lignes par opération (ventilation), chacune avec son type de flux, sa catégorie, ses tags, son cycle d'imputation, et ses liens (opération jumelle d'un virement, dépense remboursée, engagement rapproché) | oui |
| **Catégorie** | Arbre libre (parent, ordre, archivée, fusionnée dans). Identifiant stable : renommer ou déplacer ne change aucun calcul | oui |
| **Tag** | Étiquette libre, transversale, sans effet sur les calculs | oui |
| **Marchand** | Le libellé nettoyé ; porte une affectation par défaut | oui |
| **Règle** | Conditions (marchand, mots-clés, compte, montant, sens) → actions (type de flux, catégorie, tags, engagement). Priorité, et application au passé sur demande | oui |
| **Enveloppe** | Un budget : ses catégories, son plafond par cycle, sa politique de report (aucun, excédent, déficit, les deux), et si elle compte dans le budget quotidien | oui |
| **Engagement** | Ce qui est prévu : revenu, charge, mise de côté, échéance de paiement fractionné. Récurrent ou ponctuel ; rapproché des opérations (dû, payé, sauté) ; lissable (charge annuelle → un douzième par cycle) | oui |
| **Provision** | De l'argent verrouillé : montant, compte, motif (engagement, objectif, échéance), date de libération | oui |
| **Objectif** | Une cible d'épargne, alimentée par des mises de côté | oui |
| **Cycle** | D'une paie à la suivante ; ouvert ou clos ; garde ses reports et, une fois clos, son résultat | par clôture |

Deux contraintes d'intégrité portent tout le reste : les lignes d'une ventilation somment au montant de l'opération ;
une catégorie appartient à une seule enveloppe au plus (sinon une dépense compterait deux fois), et ce qui n'a pas
d'enveloppe tombe dans une enveloppe par défaut.

## 3. Règles de calcul et invariants

1. **Compte** : solde = solde d'ouverture + somme de ses opérations. Tout écart avec le solde donné par la banque est
   affiché comme un écart à expliquer, jamais absorbé en silence.
2. **Virements** : la somme des deux jambes d'un virement interne vaut zéro. Un virement n'est ni dépense ni revenu.
3. **Patrimoine net** = somme des comptes inclus − dettes. Sa variation sur une période = revenus − dépenses +
   variation de valeur des placements. Les virements et mises de côté n'y changent rien.
4. **Budget théorique du cycle** = revenus prévus − charges prévues − mises de côté prévues ± reports du cycle
   précédent. C'est le reste à vivre.
5. **Cash libre réel** = soldes des comptes du quotidien − provisions verrouillées − engagements encore à payer avant
   la prochaine paie et non provisionnés − encours de carte à débit différé.
6. **Disponible** = le plus petit des deux : (reste à vivre − déjà dépensé) et cash libre réel. C'est la règle qui
   garantit qu'on ne surestime jamais. L'écart entre les deux est affiché, avec sa cause.
7. **Budget du jour** = disponible à minuit ÷ jours restants. Il est **gelé pour la journée** : les dépenses du jour
   réduisent « reste aujourd'hui », pas le budget lui-même ; le recalcul a lieu à minuit.
8. **Enveloppes** : chaque ligne de dépense tombe dans exactement une enveloppe ; la somme des enveloppes = le total
   des dépenses du cycle. Vrai par construction, donc vrai même quand tu réorganises tes catégories.
9. **Reclassement** : le cycle ouvert est toujours recalculé. Pour les cycles clos, deux politiques possibles (figer
   le résultat à la clôture, ou tout recalculer) : à trancher.

## 4. Réglages structurels et leviers tactiques

**Structurels** (posés une fois, rarement touchés) : comptes et leurs rôles ; arbre de catégories et tags ; règles de
tri ; enveloppes et politiques de report ; jour de paie et règles de clôture ; engagements récurrents ; objectifs.

**Tactiques** (en cours de cycle, un geste, toujours réversibles et tracés) : étaler un imprévu sur plusieurs jours ou
cycles ; marquer un achat « financé par l'épargne » ; sauter ou mettre en pause un engagement ; clore un objectif et
choisir où va l'argent ; verrouiller ou libérer une provision ; affecter un revenu exceptionnel ; déplacer du budget
d'une enveloppe à une autre ; clore le cycle en avance.

## 5. Ce que ça change à l'étape 3.3

Le modèle déjà codé (compte, mouvement, marchand, prévu) reste la bonne base, mais il lui manque : les rôles de compte
(aujourd'hui une simple famille), la mise de côté comme type de flux à part entière, les sous-catégories et les tags,
les enveloppes, les provisions, les cycles avec clôture et report, les paiements fractionnés, et la règle du plus
petit des deux pour le disponible. La reprise des données reste valable.

## 6. Questions avant de figer

**Tes comptes**
1. Quels comptes servent au quotidien, et comment l'argent circule entre eux (par exemple la paie sur l'un, les
   dépenses sur l'autre) ?
2. As-tu une carte à débit différé ?
3. Tes comptes tampons sont-ils de vrais comptes ou sous-comptes séparés, ou veux-tu aussi verrouiller de l'argent
   resté sur le compte courant ?

**Le reste à vivre**
4. Quand le budget dit 30 € et la trésorerie 10 €, on affiche 10 €. Et dans l'autre sens, si la trésorerie dépasse le
   budget : on s'en tient au budget, ou on te signale la marge ?
5. En fin de cycle, un excédent est-il reporté, envoyé vers l'épargne, ou remis à zéro ? Et un dépassement : reporté
   en moins sur le cycle suivant, ou oublié ?
6. Le budget du jour gelé à minuit te convient-il, ou veux-tu aussi pouvoir étaler une grosse dépense sur le reste du
   cycle d'un geste ?

**Les cas particuliers**
7. Paiements fractionnés : à quelle fréquence, et par quels services ? Préfères-tu que chaque échéance pèse sur son
   cycle, ou que l'achat pèse entièrement sur le cycle de l'achat ?
8. Un achat financé par l'épargne : doit-il être détecté (retrait d'épargne juste avant) ou déclaré par toi ?
9. Avances entre amis : fréquentes ? Faut-il suivre qui te doit combien ?
10. Charges annuelles ou irrégulières : veux-tu qu'elles soient lissées en provision mensuelle ?
11. Tes revenus : un salaire fixe, ou aussi des primes et des revenus variables ?

**Le classement**
12. Deux niveaux (catégorie, sous-catégorie) suffisent-ils ? Les tags te serviraient-ils vraiment (voyage, travail) ?
13. Quand tu reclasses une vieille opération, les cycles déjà clos doivent-ils bouger ou rester figés ?

**Le périmètre**
14. Espèces, devises étrangères, compte joint : lesquels te concernent ?

---

# Conception (15/11/2026, après tes réponses)

Tes 14 réponses sont intégrées. Rappel de la règle d'or : ton usage (deux comptes du quotidien, virements de l'un
vers l'autre, réserve pour les mensualités) sert de cas de test, jamais de comportement codé en dur. Tout ce qui suit
est un réglage, sauf les cinq types de flux.

**Où vit ce schéma.** MyLife chiffre les données sur l'appareil : le serveur ne peut pas les lire, donc il ne peut pas
faire respecter de contraintes. Le schéma est relationnel dans sa forme (entités, clés, relations), stocké dans la
base locale (IndexedDB) et synchronisé ligne par ligne, chiffré. Les contraintes d'intégrité sont garanties par le
moteur (toute écriture passe par lui) et vérifiées par des tests.

## A. Schéma

Montants en centimes entiers, dans la devise du compte. Dates « AAAA-MM-JJ ». `→` = référence.

### Comptes
**Account** — `id`, `name`, `provider`, `role`, `include_in_daily_cash`, `include_in_net_worth`, `currency` (EUR par
défaut), `ownership_ratio` (1 par défaut), `alert_threshold`, `deferred_debit` (null, ou `{closing_day, debit_day}`),
`source` (banque ou manuel), `balance`, `balance_at`, `archived_at`.
- `role` : `CHECKING`, `PROVISION`, `SAVINGS`, `INVESTMENT`, plus trois que j'ajoute parce que le patrimoine et les
  espèces en ont besoin : `CASH` (portefeuille d'espèces), `ASSET` (bien), `LIABILITY` (dette).
- Le rôle ne fait que proposer des valeurs par défaut pour les deux drapeaux ; ce sont les drapeaux qui comptent dans
  les calculs. Un compte `PROVISION` est entièrement verrouillé.

### Le fait et son interprétation
**Transaction** (le fait bancaire, jamais réécrit) — `id`, `account_id →`, `date`, `value_date`, `amount` (signé),
`raw_label`, `pending`, `external_id`, `source`, `merchant_id →`, `created_at`.

**Allocation** (l'interprétation ; une ou plusieurs lignes par transaction) — `id`, `transaction_id →`, `amount`
(signé), `flow`, `category_id →`, `origin` (règle, marchand, manuel), `note`, et les liens et leviers :
- `linked_transaction_id →` : l'autre jambe d'un virement, ou la dépense qu'un remboursement rembourse ;
- `occurrence_id →` : l'échéance prévue que cette ligne règle (rapprochement) ;
- `installment_plan_id →` : l'achat fractionné auquel elle appartient ;
- `receivable_id →` : la créance ouverte par cette part (avance pour quelqu'un) ;
- `funded_by_savings` : achat payé par l'épargne ;
- `smoothed` : dépense lissée sur le reste du cycle ;
- `income_use` : pour un revenu non prévu, `BUDGET`, `SAVINGS`, ou non décidé ;
- `cycle_id →` : cycle d'imputation (par défaut celui de la date).
- `flow` (fermé) : `EXPENSE`, `INCOME`, `TRANSFER`, `SAVING`, `REFUND`.

**AllocationTag** — `allocation_id →`, `tag_id →` (relation N-N).

### Classement (entièrement libre)
**Category** — `id`, `parent_id →` (deux niveaux au plus), `scope` (dépense, revenu, mise de côté), `name`, `color`,
`icon`, `order`, `archived_at`, `merged_into_id →`.
**Tag** — `id`, `name`, `color`, `archived_at`.
**Merchant** — `id`, `name`, `aliases[]`, valeurs par défaut `flow`, `category_id →`, `tag_ids[]`.
**Rule** — `id`, `priority`, `enabled`, conditions (`merchant_id`, `keywords[]`, `account_ids[]`, `amount_min`,
`amount_max`, `direction`), actions (`flow`, `category_id`, `tag_ids[]`, `commitment_id`).

### Budget
**Envelope** — `id`, `name`, `cap` (plafond par cycle, ou null), `in_daily_budget`, `end_policy` (`RESET`,
`ROLLOVER`, `AUTO_SAVE`), `overspend_policy` (`DEDUCT_NEXT`, `FORGIVE`), `is_default`, `order`.
**EnvelopeCategory** — `envelope_id →`, `category_id →` (unique sur `category_id`).
**Cycle** — `id`, `start`, `end`, `status` (ouvert, clos), `opened_by_transaction_id →` (la paie qui l'a ouvert),
`carry_in` (global et par enveloppe), `snapshot` (résultats figés à la clôture), `closed_at`.

### Prévu, provisions, créances
**Commitment** (engagement) — `id`, `kind` (`INCOME`, `CHARGE`, `SAVING`, `INSTALLMENT`), `label`, `amount`,
`tolerance`, `rhythm` (hebdo, bimensuel, mensuel, trimestriel, annuel, une fois), `anchor` (jour ou date),
`account_id →`, `counter_account_id →` (destination d'une mise de côté), `category_id →`, `merchant_id →`,
`start_date`, `end_date`, `remaining_occurrences`, `provision_monthly`, `paused`, `installment_plan_id →`.
**Occurrence** (une échéance) — `id`, `commitment_id →`, `due_date`, `expected_amount`, `status` (due, payée, sautée),
`transaction_id →`, `cycle_id →`.
**InstallmentPlan** (achat fractionné) — `id`, `label`, `total`, `count`, `provider`, `purchase_transaction_id →`,
`lock_remaining` (verrouiller les échéances futures).
**Provision** (poche) — `id`, `account_id →`, `label`, `amount` (verrouillé à ce jour), `target`, motif
(`commitment_id →`, `goal_id →`, `installment_plan_id →`, ou libre), `auto`, `release_date`, `status`.
**ProvisionMove** (journal de la poche) — `id`, `provision_id →`, `date`, `delta`, `cause`.
**Receivable** (créance) — `id`, `person`, `amount`, `allocation_id →`, `status` (ouverte, soldée, abandonnée),
`settled_by[] →`.
**Goal** — `id`, `name`, `target`, `deadline`, `account_id →` ou `provision_id →`, `status`.

### Réglages et patrimoine
**Settings** — devise de référence, règle de cycle (jour de paie, fenêtre de détection, engagement de revenu qui
ouvre le cycle), mode (`PRUDENT` ou `CASH`), tolérance d'appariement des virements (3 jours), politiques par défaut.
**FxRate**, **Holding**, **InvestmentOp**, **Snapshot** : repris de l'étape 3.3.

### Contraintes d'intégrité
1. La somme des allocations d'une transaction égale son montant.
2. `category_id` n'est permis que pour `EXPENSE`, `INCOME`, `REFUND` et `SAVING`, et son `scope` doit correspondre.
3. Une catégorie a deux niveaux au plus ; une catégorie archivée ou fusionnée ne reçoit plus rien de neuf, et une
   fusion redirige l'historique sans le réécrire.
4. Une catégorie appartient à une enveloppe au plus ; il existe toujours exactement une enveloppe par défaut, qui
   reçoit le reste.
5. Les deux jambes d'un virement se référencent l'une l'autre, sur deux comptes différents, de montants opposés.
6. Un remboursement lié pointe vers une dépense ; une créance ne dépasse jamais la part de dépense qui l'a ouverte.
7. Une occurrence est réglée par une transaction au plus ; une transaction peut régler plusieurs occurrences par
   ses lignes.
8. La somme des poches d'un compte ne dépasse pas son solde ; sinon l'écart est signalé (« provision non couverte »),
   pas bloqué.
9. Les cycles se suivent sans trou ni chevauchement ; un seul est ouvert ; le résultat d'un cycle clos ne change
   plus sans demande explicite.

## B. Formules

Pour le cycle `c`, le jour `t`, `N` jours restants (aujourd'hui compris). Tout est converti en devise de référence et
pondéré par `ownership_ratio`.

### Ce qu'une ligne pèse dans le budget
```
poids(ligne) =
  EXPENSE : −montant − part avancée pour quelqu'un (créance)
            0 si « financée par l'épargne »
            0 si elle règle une échéance prévue (elle est déjà dans les charges)
            0 si c'est l'achat d'un paiement fractionné (ce sont ses échéances qui pèsent)
  REFUND  : −montant si lié à une dépense (imputé au cycle ouvert si la dépense est dans un cycle clos)
            0 s'il solde une créance (déjà neutralisée)
  INCOME, TRANSFER, SAVING : 0
```
Une vue « analyse » garde toujours le montant complet (l'achat de 600 € apparaît en entier dans sa catégorie) ; seule
la vue « budget » applique ces poids.

### Budget théorique
```
Revenus(c)  = échéances de revenu du cycle (le réel dès qu'il est reçu)
              + revenus supplémentaires fléchés « budget »
Charges(c)  = échéances de charge du cycle (réel si payée, prévu si due, 0 si sautée)
              + échéances de paiements fractionnés du cycle
              + cotisations aux provisions mensuelles
Épargne(c)  = max(mises de côté prévues non sautées, mises de côté faites)
              hors revenus supplémentaires fléchés « épargne »
Report(c)   = excédents reportés − dépassements à déduire, du cycle précédent

RAV(c)      = Revenus − Charges − Épargne + Report

Réservé(c)  = Σ (plafond + report) des enveloppes hors budget quotidien
Pot(c)      = RAV(c) − Réservé(c)                    ← ce qui alimente le budget du jour
Dépensé(t)  = Σ poids des lignes du cycle jusqu'à t, dans les enveloppes du quotidien
Reste_enveloppe(t) = Pot(c) − Dépensé(t)
```

### Trésorerie réelle
```
Cash(t)      = Σ soldes des comptes « dans le cash quotidien »
Verrouillé   = Σ poches actives sur ces comptes (un compte PROVISION inclus est verrouillé en entier)
À_payer(t)   = Σ échéances dues entre t et la fin du cycle, payées depuis ces comptes,
               moins la part déjà couverte par une poche liée
Différé(t)   = encours des cartes à débit différé prélevé avant la fin du cycle
Hors_quot(t) = Σ max(0, budget − dépensé) des enveloppes hors budget quotidien

Cash_libre(t) = Cash − Verrouillé − À_payer − Différé − Hors_quot
```
Les revenus attendus avant la fin du cycle ne sont pas comptés : tant qu'ils ne sont pas arrivés, ils n'existent pas.

### Disponible et budget du jour
```
Mode prudent : Disponible(t) = min(Reste_enveloppe(t), Cash_libre(t))
               Marge(t)      = Cash_libre(t) − Reste_enveloppe(t)     (affichée si positive)
Mode cash    : Disponible(t) = Cash_libre(t)

À minuit (dépenses du jour non comptées, dépenses lissées du jour comptées) :
  Budget_jour(t)   = max(0, Disponible_minuit(t) / N)
  Reste_aujourd'hui = Budget_jour(t) − dépenses du jour non lissées
  Demain           = max(0, (Disponible_minuit(t) − dépenses du jour) / (N − 1))
  Déficit          = max(0, −Disponible_minuit(t))
```
Le budget du jour est gelé : une dépense ordinaire ne le change pas, elle réduit seulement « reste aujourd'hui ». Une
dépense marquée « lissée » fait l'inverse : elle réduit le budget de chaque jour restant de `montant / N`.

Quand la trésorerie est la limite, l'écran dit pourquoi, terme par terme (« 161 € verrouillés, 240 € à payer avant la
paie »).

### Provisions
```
Poche manuelle (verrouiller 161 € sur un compte) :
  Verrouillé += 161. Si la poche est liée à une échéance du cycle, À_payer −= 161 (jamais deux fois).
  Une poche libre réduit le cash libre, pas le budget théorique.

Provision mensuelle d'une charge de montant M, due dans k cycles :
  cotisation(c) = (M − déjà provisionné) / k        → comptée dans Charges(c), ajoutée à la poche
  Le jour J : la poche est consommée ; l'échéance pèse 0 dans son cycle (seul un manque pèse).
```

### Paiement fractionné
```
Achat de T en n échéances a_1 … a_n aux dates d_1 … d_n :
  l'achat : poids 0 dans le budget, T dans l'analyse ;
  chaque a_i : une charge du cycle qui contient d_i ;
  dette restante = Σ a_i non payées       → déduite du patrimoine net ;
  option « verrouiller la suite » : une poche égale à la dette restante sur le compte choisi.
```

### Créances, épargne, fin de cycle
```
Avance : part p pour quelqu'un → poids de la dépense réduit de p ; créance ouverte de p (un actif du patrimoine).
         Retour lié : créance soldée, poids 0. Créance abandonnée : p redevient une dépense du cycle ouvert.
Achat financé par l'épargne : poids 0 ; le virement depuis l'épargne reste un virement (0).
Retrait d'espèces : virement vers le compte CASH (0) ; les dépenses en espèces se saisissent ensuite.

Clôture, par enveloppe k : résultat_k = budget_k − dépensé_k
  RESET     : report 0 ; excédent proposé à l'épargne
  ROLLOVER  : report = résultat_k
  AUTO_SAVE : virement d'épargne suggéré du montant de l'excédent
  Dépassement : déduit du cycle suivant (DEDUCT_NEXT) ou oublié (FORGIVE)
Le résultat est figé dans le cycle clos.
```

### Invariants testés
- La somme des lignes d'une transaction égale son montant ; un virement apparié vaut zéro.
- Chaque dépense tombe dans exactement une enveloppe : Σ dépensé par enveloppe = total dépensé.
- Renommer, déplacer, fusionner une catégorie ne change aucun total ; changer la composition d'une enveloppe change
  la répartition, jamais la somme.
- En mode prudent, Disponible ≤ Cash_libre ; Budget_jour ≥ 0.
- Une dépense non lissée ne change pas le budget du jour en cours.
- Variation du patrimoine net = revenus − dépenses (vue analyse, créances ouvertes comptées comme actif) + variation
  de valeur des placements + effet de change.
- Un cycle clos ne change pas sans demande explicite.

## C. Choix que j'ai faits, à confirmer
1. Trois rôles de compte en plus des tiens : `CASH`, `ASSET`, `LIABILITY`.
2. Un revenu supplémentaire **non décidé ne compte pas** dans le budget tant que tu n'as pas choisi (prudence).
3. Une poche libre (sans échéance liée) réduit le cash libre, pas le budget théorique.
4. « Recalculer les statistiques historiques » recalcule les totaux par catégorie des cycles clos, **pas leurs
   reports** : un report a déjà été consommé, le refaire en cascade changerait tous les cycles suivants.
5. Un remboursement lié à une dépense d'un cycle clos allège le cycle ouvert.
6. Les enveloppes hors budget quotidien sont retirées du pot **et** du cash libre : leur argent n'est pas pour le
   quotidien, des deux côtés.

## D. Plan

Chaque étape : codée, testée, journalisée, commitée, puis arrêt pour que tu testes.

| Étape | Contenu | Tu vérifies |
|---|---|---|
| **M1. Moteur minimal** | Schéma (comptes à rôles, transactions, allocations, catégories à deux niveaux, tags, cycles), contraintes, formules du budget théorique, du cash libre, du disponible et du budget du jour gelé. Reprise depuis l'étape 3.3. Écran « pourquoi ce chiffre » : chaque terme de la formule, avec tes montants | Chaque terme, sur tes vraies données |
| **M2. Prévu et leviers** | Engagements, échéances et rapprochement ; poches manuelles et provisions mensuelles ; paiements fractionnés ; créances ; financé par l'épargne ; dépense lissée ; revenus supplémentaires ; enveloppes, clôture et reports | Un cycle complet, avec un 4x et une poche |
| **M3. Automatisations** | Appariement des virements (±3 jours) ; marchands et règles de tri ; détection des récurrents en engagements proposés ; suggestions (épargne, remboursement, retrait d'espèces) ; carte à débit différé ; devises | Que rien ne soit à faire à la main deux fois |
| **M4. Réglages** | Écrans de configuration : comptes et rôles, catégories et tags, enveloppes, règles, cycle | Refaire ta configuration sans moi |
| **M5. Écrans** | Jour, Opérations, Plan, Patrimoine (maquettes validées), branchés sur le moteur | L'usage quotidien |
| **M6. Bascule** | Synchro bancaire et entre appareils dans le nouveau module, premier lancement, Copilot, export ; `/finances/` passe au module | Deux semaines d'usage réel |

Le moteur est du code pur, sans écran ni base : il se teste par scénarios (ton cas de référence : deux comptes du
quotidien, une poche de 161 €, un achat de 600 € en quatre fois) et par propriétés (les invariants ci-dessus, vérifiés
sur des données tirées au hasard).

## E. Deux règles ajoutées après le test de M1 (15/11/2026)

Sur des données réelles, deux écarts : −93,19 € de cash libre au lieu de 206,81 €, et 554,35 € de budget au lieu de
206,86 €. Le calcul était cohérent ; il lui manquait deux notions.

**Échéance en partie versée.** Une échéance a un prévu, un déjà versé et un reste : `reste = prévu − versé`. Seul le
reste entre dans « à payer avant la paie », puisque le versé est déjà sorti du solde. Dans le budget théorique,
l'échéance compte une seule fois pour son montant prévu, et les opérations qui la règlent, même en partie, ne pèsent
pas dans les dépenses. Le versé se reconnaît de trois façons : des dépenses du cycle dont le libellé cite la charge,
plus petites qu'elle, qui s'additionnent sans la dépasser ; une déclaration à la main (« déjà versé ») ; et dès que le
versé atteint le prévu à la tolérance près, l'échéance est réglée.

**Charges réglées sans être au plan.** Une enveloppe hors budget quotidien sans plafond met à part ce qui y a été
payé : `Pot = RAV − budgets des enveloppes plafonnées hors quotidien − payé dans les enveloppes hors quotidien sans
plafond`. Une charge fixe payée, même absente du plan, réduit donc le budget théorique de son montant ; côté
trésorerie, elle est déjà sortie du solde. C'est la règle générique ; le nom « Charges fixes » n'est qu'un réglage de
départ issu de l'ancienne app.
