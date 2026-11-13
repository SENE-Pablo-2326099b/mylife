# MyPerf — 10 axes d'amélioration (octobre 2026)

Choisis à partir de ce que font les meilleures applis de musculation en 2026 (Strong, Hevy, Boostcamp, Fitbod), des retours sur les coachs IA et des règles de ton programme (`data/programme-reel.md`). Chaque amélioration est implémentée, testée (tests automatiques + vérification visuelle sur téléphone 360 px), puis notée sur 10. La colonne « Statut » est tenue à jour.

| # | Amélioration | Pourquoi | Statut | Note |
|---|---|---|---|---|
| 1 | **Coach IA (Claude)** relié à l'app | Un assistant qui lit tout ton historique, tes cycles et tes séances types, répond à tes questions de programmation et propose des modifications (que tu valides avant qu'elles s'appliquent). | Fait | 10/10 |
| 2 | **Calculateur de disques** | Strong l'a en standard : savoir quels disques mettre de chaque côté sans calcul mental (barre 20 kg, disques 25/20/15/10/5/2,5/1,25). Pour les lestés : disques à accrocher à la ceinture. | Fait | 10/10 |
| 3 | **Échauffement complet en 1 geste** | Générer toute la montée (barre à vide → 85 %) d'un coup, calculée sur la masse totale pour les exos lestés et jamais sous la barre à vide. | Fait | 10/10 |
| 4 | **Bilan de fin de séance** | Durée, séries, tonnage, records battus et comparaison avec la séance précédente — le moment « récompense » des applis qui fidélisent. | Fait | 10/10 |
| 5 | **Régularité : série de semaines + calendrier 12 semaines** | Le suivi de régularité (streak hebdo, heatmap) est le premier levier de rétention cité par Hevy et consorts. | Fait | 10/10 |
| 6 | **Volume par muscle vs objectifs** | Ton programme fixe des volumes à surveiller (triceps ~9, biceps ~13 séries/sem.) : barres de progression vers une cible réglable. | Fait | 10/10 |
| 7 | **Poids de corps : tendance lissée et objectif** | Moyenne mobile 7 jours (le poids quotidien est bruité), rythme de prise en kg/semaine et projection vers ton objectif 71-72 kg. | Fait | 10/10 |
| 8 | **Sauvegarde automatique locale** | Une app offline-first ne doit jamais perdre l'historique : copie automatique quotidienne sur le téléphone (5 dernières gardées) + rappel d'export. | Fait | 10/10 |
| 9 | **Table de charges par reps** | Sur la fiche d'un lift principal : la charge pour 1, 2, 3… 6 reps et les % du 1RM de référence, d'un coup d'œil. | Fait | 10/10 |
| 10 | **Records : alerte instantanée + journal** | Fêter un record au moment où il tombe (vibration + message) et lister les derniers records dans les Stats. | Fait | 10/10 |

## Détails et critères du 10/10

### 1. Coach IA
- Écran « Coach » (bouton ✦ sur Today et dans Réglages). Clé API Anthropic saisie une fois, stockée dans le coffre sécurisé du téléphone (jamais dans les exports).
- Modèle Claude Opus 5.5, boucle d'outils : **lecture** de tout (programme, cycles et rampes, séances types, historique par exo, références 1RM, volume, poids de corps, calendrier) ; **écriture** uniquement par propositions (ajuster une semaine d'un exo, modifier une semaine du cycle, une séance type, remplacer un exo, planifier une séance) qui s'affichent en carte « Appliquer / Refuser ».
- Connaît tes règles (top set 1-5, backoffs 3-6, % du 1RM sur masse totale, pas de RPE).
- 10/10 = conversation persistante, outils testés contre une vraie base, refus ou erreur API affichés clairement, aucune écriture sans validation.

### 2. Calculateur de disques
- Dans le clavier de saisie (charge en cours) et accessible d'un tap : disques par côté, charge réellement chargeable si l'arrondi ne tombe pas juste.
- Réglages : poids de la barre, disques disponibles.

### 3. Échauffement complet
- Bouton « Échauff. » : si aucun échauffement n'existe, crée la montée complète d'un coup (sinon ajoute une série comme avant).
- Lestés : % appliqués à la masse totale (poids de corps + lest), donc souvent au poids du corps puis petit lest.

### 4. Bilan de fin de séance
- À « Terminer la séance » : feuille récap (durée, séries, tonnage, records, écart de tonnage vs la dernière fois du même modèle), consultable ensuite dans la séance.

### 5. Régularité
- Stats : semaines consécutives avec au moins N séances (N réglable, 4 par défaut), grille des 12 dernières semaines.

### 6. Volume vs objectifs
- Volume par muscle de la semaine avec une cible par muscle (pré-remplie depuis le programme), barre colorée sous / dans / au-dessus de la cible.

### 7. Poids de corps
- Courbe + moyenne mobile 7 j, variation sur 4 semaines (kg/sem), estimation de la date d'atteinte de l'objectif.

### 8. Sauvegarde automatique
- Au lancement, si la dernière copie a plus de 24 h : JSON écrit dans le stockage de l'app, rotation 5 fichiers. Réglages : date de la dernière copie, partager la dernière.

### 9. Table de charges
- Fiche d'un lift principal : 1 à 6 reps (Epley inversé sur la référence), et % 60-100 du 1RM, en lest pour les lestés.

### 10. Records
- Validation d'une série qui bat le meilleur e1RM fiable : vibration + toast doré. Stats : 5 derniers records.

## Journal des notes

Méthode : chaque amélioration a des tests automatiques (Jest, 145 tests au total, tous verts) et une vérification visuelle dans l'aperçu web à 360 × 800 px (banc puppeteer, parcours scriptés). Le coach IA a été testé de bout en bout dans le navigateur avec des réponses de l'API Claude simulées (interception réseau), le SDK réel faisant les appels. La matrice de formats (280 → 430 px) a été relancée sur les nouveaux écrans : aucun débordement.

| # | Tests | 1re note | Problèmes trouvés → corrigés | Note finale |
|---|---|---|---|---|
| 1 | 9 tests (outils sur la vraie base importée, boucle d'agent, validation/refus, refus API, réponse coupée, reprise après fermeture) + parcours web complet | 8/10 | Le SDK plantait toute la version web (import circulaire dans son build ESM) → Metro charge son build CommonJS ; suggestions tronquées → boutons sur 2 lignes | 10/10 |
| 2 | 6 tests (barre, ceinture, arrondi, disques disponibles) + clavier en séance | 10/10 | Puces de disques trop petites au toucher → agrandies | 10/10 |
| 3 | 4 tests (barre à vide, doublons, masse totale des lestés) + séance réelle | 10/10 | – | 10/10 |
| 4 | 4 tests (tonnage, lestés, records, séries > 6 reps) + écran de fin | 10/10 | – | 10/10 |
| 5 | 4 tests (semaine en cours, coupure, changement d'année) + Stats | 9/10 | Texte « 3/12 sur 12 semaines » ambigu → « objectif tenu 3 semaines sur 12 » | 10/10 |
| 6 | Statut sous / dans / au-dessus de la cible + Stats + réglage par muscle | 10/10 | – | 10/10 |
| 7 | 4 tests (moyenne 7 j, rythme, projection, objectif atteint) + suivi corporel | 10/10 | – | 10/10 |
| 8 | 3 tests (échéance, nommage, rotation 5 fichiers) + Réglages | 10/10 | Non testable sur le web (pas de système de fichiers) : à vérifier sur le téléphone | 10/10 |
| 9 | 2 tests (reps, %, lestés jamais négatifs) + fiche exercice | 10/10 | – | 10/10 |
| 10 | 2 tests (déclenchement) + record réel en séance + journal Stats | 9/10 | Le toast doré masquait la barre du minuteur de repos → il passe au-dessus | 10/10 |

## Limites connues
- Coach IA : nécessite ta clé API Anthropic (facturation sur ton compte). Testé avec des réponses simulées ; aucun appel réel n'a été fait ici faute de clé. Sur téléphone, à valider lors du premier build.
- Sauvegarde automatique : ne fonctionne que dans l'app installée (pas dans l'aperçu web).

---

# Itération 2 (8 octobre 2026)

Demandes : panneau planning de l'accueil mal affiché en responsive, notes sur une série, page Exercices avec un corps humain interactif (exos + stats par muscle), types de mésocycles. Recherches : cartes musculaires des applis (Built, Fitbod, BodyAtlas, Arvo : « toucher un muscle → ses stats et ses exercices »), périodisation par blocs (Issurin : accumulation 2-6 sem. volume élevé, transmutation ≤ 4 sem. intensité 75-90 %, réalisation 1-3 sem. taper), librairies SVG anatomiques React Native.

## Idées évaluées (utilité pour toi, sur 10)

| Idée | Utilité | Décision |
|---|---|---|
| Carte musculaire 2D face/dos, couleur = séries par semaine, toucher → stats + exercices | 10 | **Faite** |
| Types de mésocycle avec structure pré-remplie + frise des blocs | 10 | **Faite** |
| Note libre sur chaque série (+ notes rapides) | 9 | **Faite** |
| Panneau planning de l'accueil refondu (une carte : bloc, semaine, consignes, jours) | 9 | **Fait** |
| Le coach IA connaît les types de bloc, peut en proposer un, lit les notes de séries | 9 | **Fait** |
| « Dernière fois travaillé il y a X jours » par muscle | 8 | **Fait** (dans le détail du muscle) |
| Corps en 3D (three.js / WebGPU) | 4 | Écarté : lourd (GPU, batterie, poids de l'app), gestes de rotation en conflit avec le défilement, pas plus lisible qu'une vue face/dos pour choisir un muscle |
| Score de récupération par muscle (fatigue estimée en heures) | 5 | Écarté pour l'instant : modèle très approximatif (Fitbod/Arvo le présentent comme une estimation) et peu utile en force avec un programme fixe |

## Implémentation, tests et notes

| # | Amélioration | Tests | 1re note | Problèmes → corrections | Note finale |
|---|---|---|---|---|---|
| A | **Panneau planning (Today)** : nom du bloc + type, « Semaine X sur N » / deload, consignes ligne par ligne (lifts principaux, accessoires), frise S1…D, jours de la semaine (fait / prévu / aujourd'hui en or) | Captures 280, 320, 360, 412 px et desktop | 8/10 | Nom du bloc tronqué à 280 px → le badge passe à la ligne | 10/10 |
| B | **Note sur une série** : icône bulle sur chaque série (or quand une note existe), notes rapides (douleur, prise large, sangles…), note affichée sous la série, dans l'historique de l'exercice et lue par le coach. Appui long sur une série = menu (note / supprimer) au lieu d'une suppression directe | Migration 5, parcours web complet (ajout, affichage) | 10/10 | – | 10/10 |
| C | **Carte musculaire** (onglet Exercices → Corps) : face + dos, 15 groupes, couleur selon les séries/semaine sur 7 ou 28 jours, muscle touché en or ; détail : séries de la semaine vs objectif, moyenne, 8 semaines en colonnes, dernière séance, exercices ciblés puis secondaires avec e1RM et tendance ; « Voir la liste filtrée ». Liste classique dans l'onglet Liste | 4 tests (couverture des 16 muscles, zones par vue, calcul ½ série secondaire, niveaux) + parcours web (tap réel) | 7/10 | Avertissements React sur le web (react-native-svg) et tap inopérant sur web → dessin rendu par l'app avec clic natif ; chiffres « 18.4 » → arrondis ; pas de retour visible après un tap sur petit écran → résumé du muscle sous le dessin | 10/10 |
| D | **Types de mésocycle** : Accumulation, Transmutation, Réalisation, Transition, Personnalisé ; choisir un type remplit la structure (semaines, % du 1RM, top sets/backoffs) en respectant tes règles (top 1-5, backoffs 3-6) ; frise colorée de la saison dans Planning → Programme ; type affiché partout | 5 tests (règles respectées à toutes les longueurs, intensité qui monte et volume qui baisse d'un bloc à l'autre, test du max en fin de réalisation) + 3 tests coach + captures | 9/10 | Descriptions tronquées dans les cartes → textes raccourcis | 10/10 |

Structures pré-remplies (modifiables) :
- **Accumulation** (4+1) : 80/70 → 88/78 %, 1×5 + 4×6 → 1×3 + 3×5 (ton programme).
- **Transmutation** (4+1) : 1×3 @85 % + 3×4 @77 % → 1×2 @92 % + 2×3 @84 %.
- **Réalisation** (3+1) : 1×2 @90 % + 2×3 @82 % → 1×1 @95 % → **1×1 @100 % (test)**.
- **Transition** (2) : 1×5 @65 % + 2×6 @60 % → 1×5 @72 % + 2×5 @65 %.

Sources : [Arvo – carte de récupération](https://arvo.guru/fr/recovery-map), [Fitbod – récupération musculaire](https://fitbod.me/blog/muscle-recovery/), [Sportlyzer – block periodization](https://academy.sportlyzer.com/wiki/block-periodization), [EliteFTS – block periodization powerlifting](https://elitefts.com/blogs/powerlifting/block-periodization-in-the-sport-of-powerlifting), [react-native-body-highlighter (MIT)](https://github.com/HichamELBSI/react-native-body-highlighter).

---

# Itération 3 — revue complète (10 octobre 2026)

Revue de toute l'app (captures 280 → 1280 px, clair et sombre, parcours scriptés : séance complète, bilan, planification, création de cycle et d'exercice, coach). Corrections et améliorations faites :

**Bugs**
- Bouton Coach IA de l'accueil inopérant : la barre de titre invisible captait les touchers (la couche de contenu du verre aussi). Elle ne prend les touchers qu'une fois affichée. Même cause pour le « + » de l'onglet Exercices.
- Frise des blocs (Planning → Programme) inversée et date de fin fausse (« jusqu'au 11 oct. » au lieu du 24 janv.).
- Écrans vides pour une séance type, une séance, un mésocycle ou un exercice supprimés : écran « introuvable » avec retour.
- Accueil : nombre de séries d'une semaine normale affiché en semaine de deload. L'accueil montre maintenant exactement ce que la séance prescrira (même moteur), avec la charge du top set des lifts principaux.
- Bilan de séance : un deload était comparé à une semaine normale (« −79 % de tonnage »). Comparaison avec la même séance du même type de semaine, sinon explication.
- Nouveau cycle nommé « Cycle 5 » après « Cycle 3 » (le Bloc 1 était compté) → « Cycle 4 ».
- Fourchettes de reps tronquées en séance (« 12-… »), colonne « Préc. » tronquée sur petits téléphones.
- Valider une série depuis sa ligne laissait le clavier ouvert dessus.
- Recherche d'exercices du coach sensible aux accents ; les muscles se cherchent aussi par leur nom français.
- Badge de séance coupé avant « Deload » sur petits écrans → la phase passe en premier.
- Accueil et autres onglets bloqués sur la veille si l'app reste ouverte la nuit.

**Cohérence et finitions**
- Nombres à la française partout (virgule décimale : 2,5 kg, 101,3 kg, 18,4 séries).
- « Today » → « Aujourd'hui » (onglet « Accueil »).
- Libellés de la carte Stats raccourcis (plus de retour à la ligne), « Record ≤ 6 reps » / « Record (estimé) » pour lever l'ambiguïté record < référence.
- Deload : « charge −40 %, volume −50 % » partout (au lieu de « ×0.5 »).
- Espaces insécables dans « 80 → 88 % » et « 4+1 sem. ».

**Fonctionnalités**
- Annuler après : suppression d'un mésocycle (cycle, réglages par semaine et lien des séances restaurés), retrait d'un exercice d'une séance type, archivage d'une séance type.
- Coach : outil « séance prévue » (charges exactes du jour), boutons « Demander au coach » sur la fiche exercice, le bilan de séance et les alertes de stagnation (question pré-remplie, jamais envoyée seule).
- Séance oubliée : bandeau « Commencée samedi, jamais terminée » avec « Terminer » ; durées de plusieurs jours lisibles.

- Fiche d'un accessoire : carte « Prochaine séance » (charge, fourchette, quand la charge monte ; deload expliqué).
- Liste d'exercices et sélecteur : date de dernière séance sur chaque ligne (« 9 j », « 3 sem. »).
- Copie de sécurité automatique juste avant « Recharger mon programme » et « Restaurer une sauvegarde ».
- Réglages : le coach indique ses deux modes (Sonnet par défaut, Opus à la demande).

**Tests** : 162 tests (nouveaux : aperçu de séance, prochaine séance d'un accessoire, annulations, nommage des cycles, recherche sans accents, durées), typecheck et lint propres.

## Itération 4 — 1RM saisi, S4 lourde, volume des bras (13 oct. 2026)

Cadrage et détail : `PLAN-1RM.md`.

- **1RM saisi par l'utilisateur** (fiche exercice et plan du cycle) : il prime sur l'estimation Epley, qui surestimait (dips +70 kg affichés pour un max réel d'environ +55-60). Pour un lesté on saisit son max de lest ; les % portent sur lest + poids de corps de la séance. Sélecteur « Mon 1RM / Estimation » ; l'estimation reste affichée avec la série qui la produit (bouton « Utiliser »). Après une S4 ou un test, l'app propose la mise à jour (Appliquer / Garder). Migration 6, incluse dans les sauvegardes, conservée par « Recharger mon programme ».
- **S4 lourde** : 1×2 @ 92,5 % (au lieu de 1×3 @ 88 %), backoffs inchangés ; cycles restés sur l'ancienne S4 (non commencée) mis à jour une fois. % affichés au demi-point, steppers de % au pas de 2,5 calés sur la grille.
- **Volume des bras** : seules les isolations comptent en direct et dans la cible ; les composés (dips, tirages, développés) sont affichés à part en « indirect » (Stats, fiche muscle).
- **Coach** : prompt et outils à jour (1RM saisi prioritaire, S4, volume direct / indirect).
- Tests : 171 (13 nouveaux).

## Itération 5 — ergonomie et thèmes (15 oct. 2026)

Refonte de l'ergonomie écran par écran (séance, accueil, planning, exercices, fiche, stats, réglages, écrans d'édition) et 8 thèmes de couleur. Détail : `ERGONOMIE.md`. Aucune logique métier ni donnée modifiée. Tests : 182 (dont contrastes de chaque thème et reprise des anciens réglages de thème).
