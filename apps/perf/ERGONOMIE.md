# Ergonomie — audit et plan (15 oct. 2026)

Principe directeur : chaque écran montre l'essentiel, le reste est à un tap. Logique métier, base de données et calculs inchangés.

## 1. Audit

### Saisie de séance (onglet Accueil quand une séance est en cours)
- **Affiché :**
  - En-tête : anneau « 0/19 », titre, badge « Semaine 1 · Cycle 1 », durée, bouton Repos, bouton ⋯.
  - Une carte par exercice : pastille numéro, nom, prescription, badges (↑ charge, Stagnation, Réf. provisoire), icônes ⇄ et ⋯.
  - Ligne d'en-têtes de colonnes, puis les séries : pastille de type (T/B/É) qui change le type au tap, Préc., icône bulle de note, kg, reps, ✓.
  - Sous le top set, toujours affichées : puces « Rapide / Normal / Lent / Test ».
  - Bas de chaque carte : « + Série » et « Échauff. ».
  - Bas d'écran : « Ajouter un exercice » et « Terminer ».
- **Inutile ou redondant :**
  - Anneau chiffré et compteur « 2/5 » dans chaque carte.
  - ⇄ en double avec le menu ⋯.
  - Bulle de note sur chaque ligne.
  - Puces de vitesse permanentes.
  - « Échauff. » sur chaque carte.
- **Mal placé :**
  - Toutes les cartes sont dépliées au même niveau : l'exercice en cours ne se distingue que par un léger halo.
  - Le bouton Repos est en haut, loin du pouce.
- **Risque :** toucher la pastille de type change le type de série par erreur.

### Accueil (Aujourd'hui)
- **Bien :** la carte de la séance du jour, avec le gros bouton « Démarrer ».
- **Trop chargé dessous :**
  - Liste complète des 5 séances types, chacune avec un bouton ▶.
  - Grande carte du cycle : barre S1-S4-D, ligne de jours, structure « 1×5 @80 % + 4×6 @70 % ».
  - 5 séances récentes.
- **Redondance :** la semaine et le cycle sont déjà sur la carte du jour et dans Planning ; l'historique récent est déjà dans Planning.

### Planning
- **Calendrier :** lisible.
- **Jour sélectionné :** la puce « Cycle 1 · S1 » et le bouton « Go » côte à côte avec ⋯ font doublon. « Planifier » et « Séance libre » en ligne, OK.
- **Programme (onglet 2) :** frise des blocs, cycles, séances types et semaine type empilés ; long.

### Exercices
- **Vue Corps par défaut :** la carte, puis un paragraphe d'explication et 15 puces muscle + compteur. Le paragraphe d'aide est répété à chaque visite.
- **Vue Liste :** pastilles de deux lettres (« Bi », « Pe ») qui n'apportent rien ; deux rangées de filtres qui défilent ; « Créer un exercice » en haut du sélecteur, puis le bouton + flottant.

### Fiche exercice
- **Ordre actuel :** graphique e1RM, e1RM max par mésocycle, base des charges (1RM), table de charges, records, top sets par semaine, historique.
- **Problèmes :**
  - Les réglages (1RM, progression) sont noyés au milieu des graphiques, sans séparation entre « réglages » et « historique ».
  - La table de charges est longue (15 lignes).

### Stats
- **Contenu :** 3 chiffres, 3 grandes cartes de lifts, volume par muscle, régularité, derniers records, puis la progression de tous les exercices (≈ 20 lignes) : un mur.

### Réglages
- **Ordre :** Apparence (3 boutons), saisie (2 steppers), barre et 10 puces de disques, écran allumé, coach, données (6 lignes), objectifs, volume visé, repos (2 interrupteurs + 9 steppers).
- **Problèmes :**
  - Les réglages rares (planchers de repos, disques) sont au même niveau que l'apparence.
  - Export et sauvegarde sont au milieu de la page.

### Écrans poussés
- **Mésocycle :**
  - Types de bloc en 5 grandes cartes.
  - Semaines, deload, par exercice, macrocycle, notes.
  - « Enregistrer » tout en bas après une très longue page.
- **Plan du cycle par exercice :** carte 1RM puis 5 semaines ; correct.
- **Séance type :** sous-titres sur 2 lignes (« Double progression · 4×8-12 · Hypertrophie ») et flèches ↑↓ sur chaque ligne.
- **Suivi corporel :** correct. Puces de mesures tronquées à droite, sans indication qu'on peut défiler.
- **Coach :** correct.
- **Sélecteur d'exercices :** mêmes remarques que la liste.

## 2. Plan

### Saisie de séance (priorité)
- **En-tête :** compact (nom, semaine, durée, ⋯) avec une fine barre de progression, sans chiffre.
- **Exercice en cours :** déplié et mis en avant.
- **Autres exercices :** repliés sur une ligne (prescription, ou résumé quand ils sont faits). Un tap les déplie.
- **Ligne de série :** numéro ou lettre discrets · Préc. gris · kg · reps · ✓.
  - Appui long ou tap sur le numéro → feuille de la série : type, vitesse de barre, Test, note, supprimer.
  - La note reste affichée sous la ligne quand elle existe.
- **Vitesse de barre :** proposée seulement une fois le top set validé et tant qu'elle n'est pas choisie (le moment de la décision), puis rappelée en petit.
- **Menu ⋯ par exercice :**
  - Remplacer, note, ajouter un échauffement, historique, monter / descendre, retirer.
  - « + Série » reste en bas de la carte dépliée.
- **Bas d'écran :** Repos à côté de « Terminer la séance ».

### Accueil
- **Gardé :** carte du jour (séance, charges, Démarrer), puis une seule ligne « Cycle 1 · semaine 1 sur 4 » vers le planning, et la prochaine séance.
- **Replié :**
  - Les autres séances types et la séance libre → « Autre séance » (feuille).
  - Les séances récentes → Planning.

### Planning
- **Calendrier :** inchangé.
- **Jour sélectionné :** une ligne par séance avec une seule action principale ; le reste dans ⋯.
- **Programme :** sections compactes ; la semaine type et les séances types en lignes simples.

### Exercices
- **Vue par défaut :** Liste.
- **Lignes :** sans pastille de lettres.
- **Filtres :** une seule rangée muscle, l'équipement dans un bouton « Filtres ».
- **Corps :** l'aide n'est montrée que tant qu'aucun muscle n'est choisi, en une ligne.

### Fiche exercice
- **En haut :** les réglages (1RM de référence pour les lifts principaux, prochaine séance pour les accessoires).
- **Ensuite :** un graphique, les records.
- **Replié :** table de charges, e1RM par mésocycle, top sets par semaine, historique → « Voir plus » / sections dépliables.

### Stats
- **Gardé :** 3 chiffres clés, lifts principaux en lignes compactes (référence + mini-courbe), volume vs cibles.
- **Replié :** régularité, records, progression de tous les exercices → sections repliables ; le détail est sur la fiche de chaque exercice.

### Réglages
- **Ordre :**
  1. Apparence (thèmes avec aperçu).
  2. Données (export, sauvegarde) en haut.
  3. Saisie.
  4. Objectifs.
  5. Coach.
- **Repliés :** planchers de repos, disques, réglages rares.

### Écrans poussés
- **Mésocycle :** types de bloc en liste compacte ; « Enregistrer » fixé en bas.
- **Séance type :** sous-titre sur une ligne ; monter / descendre dans le panneau déplié.
- **Suivi corporel :** les puces passent à la ligne.

### Thèmes
- **Jetons :** tout passe par des jetons centralisés (fond, surface, texte, accent, succès, alerte, danger, bordure…).
- **Huit thèmes :**
  - quatre sombres : Nuit (défaut), Océan, Braise, Graphite ;
  - quatre clairs : Perle, Glacier, Sable, Craie.
- **Réglage :** aperçu de chaque thème, application immédiate, option « Suivre le téléphone » (chaque thème a son équivalent clair ou sombre).

## 3. Réalisé

- **Séance :**
  - en-tête compact (nom, semaine, durée, ⋯) et fine barre de progression, sans anneau chiffré ;
  - seul l'exercice en cours est déplié, les autres tiennent sur une ligne (prescription, ou résumé une fois faits) ;
  - ligne de série : numéro discret · précédent · kg · reps · ✓ ;
  - toucher le numéro (ou appui long) ouvre la feuille de série : type, vitesse de barre, test, note, suppression. Le type ne change plus par un tap accidentel ;
  - la vitesse de barre est proposée seulement juste après le top set, puis rappelée en petit ;
  - menu ⋯ unique par exercice (remplacer, échauffement, note, ordre, historique, retirer) ; en bas de carte, seulement « + Série » ;
  - « Repos » et « Terminer » côte à côte en bas d'écran (Repos aussi dans le menu de séance).
- **Accueil :**
  - carte du jour allégée, sans pastilles numérotées ;
  - « Autre séance » ouvre une feuille avec les séances types et la séance libre ;
  - une carte compacte : cycle et semaine, barre des semaines, jours de la semaine, prochaine et dernière séance ;
  - les listes « Démarrer une séance » et « Récentes » sont retirées de l'écran. Les séances passées restent dans Planning et via « Dernière ».
- **Planning :**
  - jour sélectionné : une ligne par séance, avec ▶ aujourd'hui ;
  - un tap ouvre ses détails dans une feuille : exercices et charges prévues, puis Démarrer, Déplacer, Modifier la séance type, Sauter (avec Annuler) ;
  - semaine type : le retrait propose Annuler ;
  - sous-titres des cycles raccourcis.
- **Exercices :**
  - la liste s'ouvre par défaut, en lignes simples sans pastilles ;
  - une rangée de muscles, l'équipement derrière le bouton filtres ;
  - vue Corps : aide en une ligne.
- **Fiche exercice :**
  - d'abord la base des charges (1RM) ou la prochaine séance ;
  - puis la courbe et les records ;
  - repliés : table de charges, e1RM par cycle, top sets par semaine ;
  - séances en liste compacte (5 puis « Voir plus »).
- **Stats :**
  - 3 chiffres (séances, séries, semaines d'affilée) ;
  - lifts principaux en lignes ;
  - alertes de stagnation ;
  - volume vs cibles ;
  - repliés : tous les muscles, régularité, records, tous les exercices.
- **Réglages :**
  - Apparence (8 thèmes avec aperçu, Suivre le téléphone), puis Données (export et sauvegardes en haut), Séance, Objectifs, Coach ;
  - repliés : charges et disques, temps de repos, options de données rares.
- **Écrans d'édition :**
  - « Enregistrer » ou « Démarrer » fixé en bas (mésocycle, exercice, séance type) ;
  - mésocycle : types de bloc en puces, macrocycle et notes repliés, suppression directe avec Annuler ;
  - séance type : monter / descendre dans le panneau déplié ;
  - exercice : l'archivage propose Annuler.
- **Suivi corporel :** les puces de mesures passent à la ligne.
- **Thèmes :**
  - jetons centralisés (dont nouveaux : succès, puits de saisie, carte musculaire, curseur), plus aucune couleur en dur dans les écrans ;
  - 8 thèmes, Nuit par défaut ; les anciens réglages clair / sombre / système sont repris ;
  - le texte discret des thèmes clairs a été foncé pour la lisibilité.

### Retouches (15 oct.)
- **Calendrier :**
  - chaque bloc ou cycle a sa propre couleur : semaines teintées, trait en bas, deload plus pâle ;
  - les couleurs viennent d'une palette dédiée (`blockColors`, src/ui/themes.ts), sans les teintes proches de l'accent du thème, pour ne jamais se confondre avec la sélection ou le jour courant ;
  - deux cycles qui se suivent n'ont jamais la même couleur ;
  - une légende sous le calendrier (nom · type) mène à chaque bloc.
- **Exercices :** une page à parcourir plutôt qu'une liste de 62 lignes.
  - Recherche en haut ; taper cherche dans toute la bibliothèque.
  - « Mes séances » : une carte repliée par séance type (jour, nom, nombre d'exercices) qui se déplie sur ses exercices.
  - « Par muscle » : grille de tuiles (muscle et nombre d'exercices) qui ouvre la liste du muscle, avec un filtre d'équipement et un retour.
  - « Toute la bibliothèque » : la liste complète, avec le même filtre d'équipement.
  - Le sélecteur d'exercices en séance suit la même structure ; la feuille de filtres a disparu.
