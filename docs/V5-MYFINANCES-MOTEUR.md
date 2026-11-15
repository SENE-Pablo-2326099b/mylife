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
