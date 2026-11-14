# MyFinances V5 : inventaire et proposition (étape 3.1)

> 14/11/2026. Première étape de la phase 3 (`docs/VISION.md` § 8) : ce que fait l'app actuelle, ce que je propose de
> garder, fusionner ou retirer, et les questions qui décident des maquettes. Rien n'est codé tant que ce document et
> les maquettes (3.2) ne sont pas validés.

## 1. L'existant en chiffres

| Partie | Lignes | Sort proposé |
|---|---|---|
| Domaine (`src/domain` : moteur de budget, récurrents, prévision, règles, patrimoine, indépendance) | 4 600 | **Gardé tel quel**, déplacé dans le module |
| Synchro bancaire et cloud (`src/sync`) | 1 200 | Gardée |
| Base locale (`src/db`, Dexie `myfinances`) | 600 | Gardée : mêmes tables, mêmes identifiants de synchro |
| Assistant (`src/assistant`) | 1 100 | Ses outils passent à Copilot ; la page disparaît |
| Écrans, composants, kit (`src/pages`, `src/ui`, `src/components`) | 13 000 | **Réécrits de zéro** dans le kit V5 |

351 tests unitaires couvrent le domaine : c'est lui qui porte la valeur, et il ne bouge pas. Tes données non plus : le
module lira la même base et les mêmes lignes synchronisées, sans migration.

## 2. Ce que fait l'app aujourd'hui

**Le quotidien**
- **Budget du jour** : enveloppe « vie courante » du cycle de paie ÷ jours restants, avec plafond sur l'argent
  réellement libre, paie en avance, remboursements rattachés, revenus exceptionnels à affecter. Explication « comment
  c'est calculé ».
- **Opérations** : liste par jour, recherche, filtres (période, catégorie, compte), fiche d'opération (catégorie, note,
  remboursement de…), file « à classer » une par une.
- **Classement automatique** : règles (mot-clé ou regex, sens, montant), commerçants par défaut, transferts internes
  détectés, apprentissage depuis les corrections.

**Le cycle**
- **Page Budget** : total du cycle, par jour en moyenne, reste par jour, prévision de fin, récurrents à venir,
  calendrier jour par jour, dépenses cumulées, par catégorie vs cycle précédent, habitudes par jour de semaine,
  historique des cycles, commerçants, plus grosses dépenses, part de la nourriture, « entre amis ».
- **Récurrents** : liste unique (réglages + détectés + investissements programmés), sauter ce mois.
- **Prévision de trésorerie** : solde jour par jour jusqu'à la paie, point bas.
- **Alertes** : livraisons, Amazon hors budget, budget du jour dépassé N jours, tickets de bus vs abonnement, objectif
  de catégorie.

**Le long terme**
- **Patrimoine** : liquidités (comptes bancaires), placements (portefeuilles, lignes, cours Yahoo / CoinGecko,
  mouvements, plans programmés, achats déduits des prélèvements, import de relevé Trade Republic), objectifs d'épargne,
  biens et dettes, historique quotidien, répartition.
- **Indépendance financière** : simulateur d'intérêts composés branché sur tes données (Lean / Coast FI, pension).

**Autour**
- Banques : connexion Enable Banking par le relais, synchro auto, application propre pour les proches.
- Premier lancement guidé, démo (« Camille Martin », fictive), sauvegarde et import, points de restauration.
- Réglages : revenus, charges, épargne, catégories et objectifs, règles, seuils d'alerte, apparence.

**Ce qui manque** : **aucune saisie manuelle de dépense.** Toute opération vient de la banque ou de la démo. Or le « + »
de la coquille propose déjà « Une dépense », et sans banque compatible l'app est vide.

## 3. Ce que je propose

### Les questions auxquelles le module répond (principe 2 de la vision)

| Question | Fréquence | Où |
|---|---|---|
| Combien je peux dépenser aujourd'hui ? | chaque jour | Carte d'accueil + écran **Jour** |
| J'ai bien tout noté, tout est bien classé ? | chaque jour | Ajout rapide + **Opérations** (« à classer » en tête) |
| Je finis le mois dans le vert ? | chaque semaine | **Cycle** |
| Combien j'ai, et ça progresse ? | chaque mois | **Patrimoine** |

Quatre onglets, un par question. Les réglages du module s'ouvrent depuis l'en-tête, pas depuis un onglet.

### Gardé, et rendu excellent
- Le **moteur de budget**, tel quel : c'est le cœur, il est juste et testé.
- **Opérations** avec la file « à classer » fondue dedans (plus d'écran à part) : un bandeau « 3 à classer » en tête,
  classement en un geste.
- **Règles et apprentissage** : invisibles au quotidien, réglables au besoin.
- **Récurrents** et **prévision**, fondus dans l'écran **Cycle** : « ce qui doit encore tomber » et « où tu finiras ».
- **Patrimoine** : comptes, placements, objectifs, biens et dettes, sur un seul écran plus court.
- **Banques** (Enable Banking) et **Trade Republic** : gardés, au second niveau.
- Démo, sauvegarde, points de restauration.

### Ajouté
- **La saisie manuelle** : montant, catégorie, c'est tout (date et note facultatives). Elle sert le « + » partout, les
  espèces, les comptes sans synchro, et les personnes qui n'auront jamais de banque connectée (phase 6 : pour un
  proche, créer sa propre application Enable Banking est un vrai obstacle). Une dépense notée à la main puis arrivée
  par la banque est rapprochée, pas comptée deux fois.
- Les **cartes d'accueil** (budget du jour, prochains prélèvements), les **saisies rapides** et les **outils Copilot**
  du module, par le contrat.

### Fusionné ou retiré
| Aujourd'hui | Devient | Pourquoi |
|---|---|---|
| Page Alertes et ses 5 alertes | 2 alertes génériques (objectif de catégorie dépassé, budget du jour dépassé plusieurs jours) dans la boîte « À faire » de la coquille | Livraisons, Amazon, tickets de bus : taillées pour un seul usage, à refaire en règles si besoin |
| Assistant de MyFinances | Copilot (outils du module) | Un seul assistant |
| Page Budget à 12 sections | Écran **Cycle** à 4 blocs : où tu en es, ce qui doit tomber, par catégorie, cycles précédents | Une question, une réponse |
| Habitudes par jour de semaine, part de la nourriture, dépenses cumulées, calendrier | Retirés (le calcul reste dans le domaine) | Rarement lus |
| « Entre amis » | Gardé dans la fiche d'opération (personne), section retirée | Rare |
| Simulateur d'indépendance financière | Une carte « liberté financière » dans Patrimoine (où tu en es, à quelle date) ; le simulateur complet passe en « Plus tard » | Mensuel au mieux ; le moteur reste |
| Menu des espaces, palette de commandes, apparence, compte | La coquille | Déjà fait en phase 2 |

### Données et continuité
- Même base locale (`myfinances`), mêmes tables, mêmes identifiants de synchro : rien à migrer, l'ancienne app et le
  nouveau module lisent les mêmes données pendant la bascule.
- Le nom technique `budget-dodge` (ancienne base et ancien format de sauvegarde, encore lus pour reprise) disparaît
  après cette version.
- L'opération manuelle ajoute une valeur `source: 'manual'` : version de la base +1, migration testée.

## 4. Les étapes proposées

| Étape | Contenu | Tu testes |
|---|---|---|
| 3.1 | Ce document | Tu valides ou tu corriges |
| 3.2 | Maquettes : Jour, Opérations (avec à classer et saisie), Cycle, Patrimoine, premier lancement | Tu valides les écrans |
| 3.3 | Le module dans la coquille : domaine et base branchés, écran **Jour**, saisie manuelle, carte d'accueil | Ton budget du jour dans la nouvelle app |
| 3.4 | **Opérations** : liste, recherche, fiche, à classer, règles | Classer une semaine |
| 3.5 | **Cycle** : où tu en es, à venir, catégories, historique | Ton mois |
| 3.6 | **Patrimoine** et banques | Tes comptes et placements |
| 3.7 | Premier lancement, réglages du module, Copilot, export ; bascule de `/finances/` vers le module | Deux semaines d'usage réel |

## 5. Ce que j'ai besoin de savoir (tes tâches réelles)

1. **Banque ou main ?** Tes comptes se synchronisent-ils bien aujourd'hui, et noterais-tu des dépenses à la main
   (espèces, en attendant la banque) ? Je propose la saisie manuelle de toute façon ; reste à savoir si elle est
   centrale ou d'appoint.
2. **Patrimoine** : l'utilises-tu vraiment (Trade Republic, Bitstack, objectifs) ? Si c'est rare, il passe en dernier
   et plus léger.
3. **Indépendance financière** : une carte suffit-elle, ou tiens-tu au simulateur complet ?
4. **Alertes** : livraisons, Amazon, tickets de bus te servent-elles encore ?
5. **Ce qui t'agace** dans l'app actuelle, au quotidien.
