# Feuille de route MyLife V4

**D'où on part** : la V3 est faite (`docs/V3.md`). Personnage, Bilan et Wrapped, Crew, Sortie, MyMusique, MyGames,
Copilot, Pacte, ouverture au public côté app, et le premier palier de « Mes apps ». La refonte de MyFinances a commencé
(`docs/REFONTE-FINANCES.md`, étape 1 faite).

**Objectif de la V4** : faire monter MyLife en gamme. Les apps existantes vont plus loin, Copilot passe de « il lit » à
« il prépare, tu valides », et de nouvelles apps principales arrivent au niveau de MyFinances ou MyPerf. À la fin, MyLife
couvre le quotidien (repas et courses, foyer, agenda, objectifs, culture, plein air) et plus seulement le budget, la salle et les
festivals.

**Principes (ceux de la V3, plus deux)**
- Une étape à la fois, et chaque étape sert seule. Rien de personnel en clair : le serveur ne voit que des blocs
  chiffrés. Les données arrivent toutes seules. Rien d'obligatoire ni de culpabilisant.
- L'IA propose, elle n'agit jamais seule. Une seule app unifiée, et tout l'écran web passe par le kit `packages/ui`.
- **Nouveau : chaque app branche toute la « prise MyLife ».** Une app n'est finie que si elle remplit le contrat
  (§ 3.0) : registre, aperçu, compteurs du Personnage, fiche Copilot, palette, story du Wrapped, partage dans le Crew,
  export dans « Mes données ». C'est ce qui fait un écosystème plutôt qu'une pile d'apps.
- **Nouveau : on construit d'abord ce qui multiplie.** Avant une nouvelle app, on se demande quelle brique commune elle
  rend possible ou réutilise : actions validées, rappels, coffre de fichiers, agenda.

```
PARTIE 1 : BASE SAINE
  1.1 Lignes trop grosses ─┐
  1.2 Apps de synchro ─────┼─▶ 3.0 Contrat d'app ─▶ toutes les nouvelles apps
  1.3 Doublons MyPerf      │
  1.4 Refonte MyFinances ──┴─▶ Copilot qui agit (2.7), Foyer (3.3), Objectifs (3.1)
  1.5 Fin de l'étape 9 ────▶ premiers inconnus ─▶ choix des nouvelles apps

PARTIE 3 : FONDATIONS                        NOUVELLES APPS
  F1 Actions validées (Copilot) ───────────▶ partout (dont le planning de MyChef)
  F2 Rappels écrits par l'appareil ────────▶ Mes apps, MyChef, Foyer, Agenda, Cercle
  F3 Agenda commun ────────────────────────▶ MyAgenda, Objectifs, Foyer
  F4 Coffre de fichiers chiffrés ──────────▶ Coffre, Voyage, photos (Perf, Sortie, Santé)
  F5 Coquille native (APK MyLife) ─────────▶ Santé (Health Connect), widgets
```

Effort : S = quelques heures, M = une à deux sessions, L = plusieurs sessions, L+ = un chantier en plusieurs étapes.

---

# Partie 1 : Base saine

Seulement ce qui ralentirait ou casserait la suite. Le reste des petites imperfections attend.

| # | Chantier | Effort | Pourquoi maintenant |
|---|---|---|---|
| 1.1 | **Lignes de « Mes apps » trop grosses** (bug trouvé) : **fait** | M | Ça bloque toute la synchro commune, en silence |
| 1.2 | **Apps de synchro déclarables et quota de `mylife`** : **fait** | M | Sans ça, aucune nouvelle app ne peut ranger ses données proprement |
| 1.3 | **Doublons d'import MyPerf** (risque connu, `CONTEXTE.md` § 3) : **fait** | S à M | Une montée de version fabriquerait des séances en double sur chaque appareil |
| 1.4 | **Refonte MyFinances, étapes 2 à 5** : **fait** | M + M + S + S | Discipline, Pacte et Copilot lisent des chiffres faux tant que l'épargne a trois définitions |
| 1.5 | **Fin de l'étape 9** : page légale, VAPID, premiers inconnus | S + S + temps | On ne choisit pas les nouvelles apps sans avoir écouté de vrais utilisateurs |

### 1.1 Lignes de « Mes apps » trop grosses (bug trouvé en lisant le code) : **fait** (journal : `docs/V4.md`)
- **Constat** : une app sans code et toutes ses saisies forment **une seule ligne** `miniapp/<id>`. Elle peut contenir
  jusqu'à 1 500 saisies et 8 champs, et un champ texte peut faire 200 caractères (`packages/lumen/src/miniapp.ts`).
  Or le serveur refuse toute ligne de plus de 200 000 caractères chiffrés (`MAX_PAYLOAD`, `server/core.ts`). Un journal
  quotidien avec une note de 200 caractères atteint la limite en un an et demi environ. Avec deux champs texte, en
  quelques mois.
- **Effet** : `parseChanges` refuse alors **tout le lot**, avec une erreur 400. Le client l'avale (`prefsSync.ts`,
  `catch` silencieux) et recommence à chaque passage. L'apparence, les compteurs du Personnage, la musique et les autres
  apps cessent donc de se synchroniser, sans aucun message.
- **Correction** : découper les saisies en lignes par mois (`miniapp/<id>` pour la description,
  `miniapp/<id>/<AAAA-MM>` pour les saisies). Ça règle aussi la limite connue « deux appareils hors ligne : la plus
  récente gagne », puisque deux mois différents ne se contredisent plus. Côté serveur, refuser seulement la ligne
  fautive et la signaler, au lieu de rejeter tout le lot. Côté client, afficher un état « synchro bloquée » au lieu de
  se taire.
- **Terminé quand** : un test remplit une app à 1 500 saisies de 8 textes longs, et la synchro passe. Une ligne trop
  grosse forcée n'empêche plus les autres de passer. L'ancien format se relit et se migre tout seul.

### 1.2 Apps de synchro déclarables et quota de `mylife` : **fait** (journal : `docs/V4.md`)
- **Constat** : la liste des apps de synchro est figée (`APPS = ['finances', 'perf', 'mylife']`), et tout ce qui est
  né en V3 range ses données dans `mylife`, qui a un quota de 200 lignes. Le calcul du quota compte en plus chaque mise
  à jour comme une ligne nouvelle (`COUNT + changes.length`), et les lignes supprimées aussi. Près du plafond, une simple
  modification est refusée (413).
- **Correction** :
  - un registre d'apps de synchro côté serveur, chaque app avec son quota (`books`, `home`, `agenda`…) ;
  - le quota ne compte que les lignes vraiment nouvelles et ignore les traces de suppression ;
  - les traces de plus de 90 jours sont purgées ;
  - `mylife` redevient ce qu'il doit être : l'apparence, les compteurs et les préférences.
- **Terminé quand** : une app de test se déclare en une ligne et se synchronise. Les données V3 rangées dans `mylife`
  restent lues. Le quota ne bloque plus une modification. Les tests du serveur couvrent les trois cas.

### 1.3 Doublons d'import MyPerf : **fait** (journal : `docs/V4.md`)
- **Correction** : à l'import de l'historique personnel, des identifiants **déterministes**, tirés de la date, de
  l'exercice et du numéro de série, au lieu d'identifiants aléatoires. Une passe de dédoublonnage nettoie les doublons
  déjà créés. Un test vérifie que deux appareils qui montent de version arrivent aux mêmes identifiants.
- **Terminé quand** : `PERSONAL_IMPORT_VERSION` peut être augmenté sans risque, et c'est prouvé par un test à deux
  appareils simulés.

### 1.4 Refonte MyFinances, étapes 2 à 5 : **fait** (journal : `docs/REFONTE-FINANCES.md`)
Telles que décrites dans `docs/REFONTE-FINANCES.md` : **un seul modèle d'argent** (M), **une seule liste de
récurrents** (M), **navigation et réglages remis en ordre** (S), **vocabulaire cohérent** (S). C'est une condition de
la V4 : la fiche Copilot, la quête Discipline, le Pacte « jours sous le budget » et les futures actions validées (F1)
s'appuient tous sur ce modèle.

### 1.5 Fin de l'étape 9
- Relire `/confidentialite` (S). La mettre à jour à chaque nouvelle app qui garde un nouveau type de donnée.
- Clés VAPID et `CRON_SECRET` sur Vercel (S, de ton côté, avec les instructions de `docs/V3.md`). Les rappels de la
  V4 (F2) en dépendent.
- **Premiers inconnus** : cinq personnes hors du projet l'utilisent une semaine. On note ce qui bloque, sans les aider.
  Les dix conversations sur les problèmes du quotidien prévues avant l'ouverture servent à **trier la partie 3** :
  une nouvelle app que trois personnes sur dix évoquent d'elles-mêmes passe devant les autres.

**Terminé quand (partie 1)** : les cinq chantiers sont faits, tout est vert (`build:all`, `lint`, `test:all`,
`e2e:all`), et au moins un inconnu est revenu après une semaine.

---

# Partie 2 : Faire évoluer l'existant

Pour chaque app : ce qui la rend plus avancée, plus utile au quotidien et mieux reliée aux autres. La suite logique des
« limites connues » de la V3 est marquée **(suite V3)**.

## 2.1 Accueil et Personnage

Aujourd'hui, le Personnage est un reflet : 5 stats, 3 quêtes calculées, une série. L'enjeu est d'en faire **le jeu de
ta vie**, avec des choix, une progression longue et une histoire, sans jamais devenir une corvée.

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Quêtes au choix** : chaque lundi, 5 quêtes proposées (calées sur ton rythme), tu en gardes 3 | M | Le joueur décide : plus d'engagement, et une semaine chargée se choisit des quêtes légères au lieu d'être ratée |
| **Arcs de quêtes** sur 3 à 6 semaines (« Préparer le festival » : séances, budget de la Sortie, playlist), proposés par Copilot ou tirés d'une Sortie ou d'un Objectif (3.1) | M | Une progression qui raconte quelque chose ; les apps travaillent ensemble vers un même moment |
| **Succès** calculés sur tout l'historique (`timeline`) : « 100 séances », « 6 cycles sous l'enveloppe », « 10 sorties avec la bande » ; rétroactifs, rares, sans montant | S à M | Récompense le long terme, ce que les quêtes hebdomadaires ne voient pas ; un utilisateur ancien en débloque dès le premier jour |
| **Classes** déduites de la répartition de tes stats (« Athlète », « Stratège », « Âme de la fête », « Polyvalent »), qui changent si ta vie change | S | Une identité qui se lit d'un coup d'œil, partageable dans le Crew, et aucune saisie |
| **Avatar dessiné** (SVG généré sur l'appareil, aucune image externe) : silhouette, aura et accessoires débloqués par niveaux et succès, dans les 12 thèmes | M | Le Personnage devient visible ; c'est l'élément qu'on montre dans le Wrapped et le Crew |
| **Chronique** : une page « journal » écrite toute seule chaque semaine (« Semaine 43 : record au développé couché, 5 jours sous l'enveloppe, une sortie »). Sans Copilot, par gabarits ; avec ta clé, Copilot l'écrit | M | Le fil de ta vie en chiffres, relisable des mois après ; une base pour le Wrapped annuel |
| **Stats ouvertes aux nouvelles apps** : Vitalité (MyChef 3.4, puis Santé 3.9), Savoir (Culture, 3.6), Endurance (Plein air, 3.7), Foyer (3.3). Le moteur accepte une liste de stats déclarées au lieu de 5 en dur | M | Prérequis pour que chaque nouvelle app compte dans le jeu ; sans ça, le Personnage reste figé à la V3 |
| **« Mes apps » nourrissent une stat** : une app sans code peut déclarer la stat qu'elle fait monter, avec un plafond bas (une saisie n'a pas le poids d'une séance) | S | Lecture, eau, méditation entrent dans le jeu sans écrire d'app |
| **Accueil « Ta journée »** : un seul fil en haut de l'accueil (séance prévue, budget du jour, sortie à venir, quête la plus proche du but, rappel du jour) | S à M | L'accueil répond à « qu'est-ce que je fais aujourd'hui ? » au lieu d'empiler des cartes ; la première chose qu'on ouvre le matin |
| **Compteurs à jour sans ouvrir chaque app** **(suite V3)** : l'accueil, sur la même origine, lit les bases locales de MyFinances (Dexie) et de MyPerf web au lieu d'attendre qu'elles s'ouvrent ; sur Android installé, synchro périodique en arrière-plan | M | La limite « les compteurs ne bougent que quand l'app est ouverte » faussait quêtes, Crew et Pacte |
| **Personnage dans l'APK MyPerf** **(suite V3)** | M | Sur Android, l'APK est l'app qu'on ouvre ; le jeu doit y être visible |

**Terminé quand** : quêtes au choix, succès et classes en place, moteur à stats déclarées (testé avec une stat
factice), chronique sur 12 semaines, avatar dans les 12 thèmes et à 320 px.

## 2.2 MyFinances

Après la refonte, MyFinances a un modèle juste. On peut alors la rendre **prévoyante** (ce qui va arriver), **sociale**
(l'argent à plusieurs) et **lisible** (chaque euro expliqué).

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Part des Sorties dans le budget** **(suite V3)** : ta part d'une Sortie devient une dépense prévue du cycle, et le remboursement attendu un revenu prévu | M | La limite « la part n'est pas versée dans MyFinances » faisait mentir l'enveloppe pendant les festivals |
| **Rapprochement Sortie ↔ banque** : la dépense saisie dans la Sortie est retrouvée dans les opérations (montant, date, marchand) et ne compte pas deux fois | M | Pas de double saisie, l'un des principes fondateurs |
| **« Et si ? »** : simuler une décision (nouveau loyer, achat à crédit, abonnement, hausse de salaire) sur les 6 prochains cycles, avec l'effet sur l'argent libre et l'indépendance financière | M | Passe de « où en suis-je » à « que se passe-t-il si » ; c'est la question qu'on pose à Copilot, avec un écran pour y répondre sans lui |
| **Échéancier annuel** : les dépenses rares retrouvées sur 12 mois (taxe foncière, assurance, impôts, cadeaux de fin d'année), avec la somme à mettre de côté chaque mois | S à M | Supprime les « mauvaises surprises » qui cassent un cycle ; aucune saisie |
| **Abonnements** : coût annuel, hausse de prix détectée, « encore utilisé ? » (relié à MyGames et MyMusique quand c'est possible : Spotify payé mais rien écouté depuis 2 mois) | S | Le gain d'argent le plus facile ; et le genre de croisement que seul un écosystème permet |
| **Budget à deux (ou en coloc)** sur un espace chiffré : chacun garde ses comptes, on partage seulement les dépenses communes choisies et un solde « qui doit quoi » permanent | L | L'argent est souvent à plusieurs ; c'est aussi le cœur de MyFoyer (3.3), qui en hérite |
| **Patrimoine dans le temps** : courbe du patrimoine net, répartition, dividendes et intérêts reçus, frais payés | M | Le suivi de patrimoine était un instantané ; l'évolution motive plus que le chiffre |
| **Revue du mois guidée** : 5 écrans en fin de cycle (ce qui a dérapé, récurrents nouveaux, opérations à classer, objectif suivant), avec ou sans Copilot | S à M | Un rituel court qui garde les données propres ; c'est le pendant « argent » du Bilan du dimanche |
| **Banques pour les amis** (`CONTEXTE.md` § 10) : parcours guidé clic par clic pour « Ma propre application » Enable Banking, avec captures | S à M | Sans banques connectées, MyFinances ne tient pas sa promesse « automatique » pour un inconnu |
| **Wrapped financier sans montant** : pourcentages et tendances (« 74 % des jours sous l'enveloppe », « épargne tenue 5 cycles sur 6 ») | S | Donne une story Discipline riche sans rien de sensible dans l'image |

**Terminé quand** : une Sortie à deux passe dans le budget sans double comptage, « Et si ? » et l'échéancier tournent
sur la démo, le budget à deux est validé de bout en bout à deux comptes.

## 2.3 MyPerf

MyPerf est déjà la plus complète. La suite : **qu'elle calcule les charges toute seule**, qu'elle **accepte tous les
historiques**, et qu'elle se pratique **à plusieurs**.

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Prescriptions calculées** **(suite V3)** : les % du 1RM et les RPE importés deviennent des charges proposées en séance (au lieu de notes) | M | La limite connue de l'import ; un programme importé devient vraiment « prêt à faire » |
| **Progression automatique** : double progression, autorégulation au RPE ressenti, décharge proposée quand les séries stagnent 3 séances de suite | M | Le cœur d'une app de musculation avancée ; aujourd'hui, c'est à toi de décider de la prochaine charge |
| **Import Strong, Hevy, Fitbod** (CSV) **(suite V3)** : même mécanique tolérante que l'import de programmes | S à M | Un inconnu qui vient d'une autre app arrive avec ses années d'historique, donc avec un Personnage déjà avancé |
| **Coach de fin de bloc** : bilan d'un mésocycle (progrès, stagnations, volume par muscle) et proposition du bloc suivant, à valider (F1) | M | Ce que fait un vrai coach ; valorise l'historique |
| **Séance à deux** : un partenaire rejoint ta séance par un espace chiffré, chacun voit les séries de l'autre en direct et le minuteur est partagé | M | La salle se fait souvent à deux ; ça donne au Crew un usage concret, pas seulement un classement |
| **Partage de programme par lien** (comme « Mes apps ») et programmes du Crew | S | Un programme qui circule entre amis fait venir des gens sans publicité |
| **Échauffement et cardio** : séries d'échauffement calculées, blocs cardio et conditionnement dans la séance | S à M | Couvre ce que font la plupart des pratiquants entre deux séries lourdes |
| **Parité APK ↔ web** : Personnage (2.1), fiche Copilot depuis Android **(suite V3)**, actions validées | M | Règle « toute fonction ajoutée à une app reçoit son équivalent » |

**Terminé quand** : un programme importé avec % et RPE donne des charges en séance, une décharge est proposée sur un
historique de test qui stagne, un CSV Strong s'importe, une séance à deux passe de bout en bout.

## 2.4 MyRave

Aujourd'hui, l'app sert à retrouver ses amis. La suite : **qu'elle soit la boussole complète du festival**, plan
compris, et qu'elle **rassure** (tout le monde est bien rentré).

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Groupe créé depuis la Sortie** **(suite V3)** : un toucher, les membres de la Sortie sont invités, et le groupe expire à la fin de la Sortie | S à M | La limite connue ; supprime l'étape qu'on oublie toujours le jour J |
| **Repères partagés** : « la tente », « le stand frites », « l'entrée B », épinglés et chiffrés, avec une flèche pour s'y rendre | S | Sur un festival, on se retrouve à un repère, pas à des coordonnées |
| **Plan du festival hors ligne** : une image du plan (photo ou fichier), calée par deux points touchés, sur laquelle s'affichent amis et repères | M | Le réseau sature en festival ; un plan local qui marche sans réseau, c'est la fonction qu'aucune app généraliste ne fait bien |
| **« Bien rentré ? »** : à la fin de la Sortie, chacun touche « rentré » ; ceux qui ne l'ont pas fait restent visibles du groupe, avec leur dernière position partagée | M | La sécurité, raison numéro un de partager sa position entre amis ; discret, rien n'est forcé |
| **Économie de batterie** : partage espacé quand on ne bouge pas, dernière position connue affichée avec son âge | S | Un téléphone qui s'éteint à 23 h rend l'app inutile au moment où elle compte |

**Terminé quand** : une Sortie crée son groupe, un plan calé affiche deux amis simulés hors ligne, « Bien rentré ? »
se clôt à deux comptes.

## 2.5 MyMusique

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Line-up × tes goûts** : coller le line-up d'une Sortie (texte, ou photo de l'affiche passée par l'IA gratuite de ton choix, même mécanique que l'import de programmes), score de compatibilité par artiste, planning proposé dans la Sortie | M | La question de la feuille de route (« ce line-up me correspond ? ») sans clé d'IA ; MyMusique sert avant le festival, plus seulement après |
| **Écoute en direct** par Last.fm ou ListenBrainz **(suite V3)** | M | La limite connue : l'export Spotify a des semaines de retard ; en direct, la Culture et les quêtes vivent |
| **Carnet d'ID → MyMusique** : les morceaux retrouvés pendant les Sorties forment une liste, avec liens de recherche (sans API) | S | Ferme la boucle festival → découverte → écoute |
| **Affinités du Crew** : chacun choisit de montrer son top 5 ; MyLife calcule les artistes en commun et une « compatibilité » entre amis | M | Le social par la musique, sans dévoiler l'historique |
| **Autres services** : export Deezer et Apple Music (fichiers, traités sur l'appareil) | S à M | Tout le monde n'est pas sur Spotify ; toujours un plan sans API |
| **Concerts vus** : la liste des artistes vus en vrai (tirée des Sorties et des sets « j'y vais »), comparée à ce que tu écoutes | S | Un pont entre la vie réelle et l'écoute ; une story parfaite pour le Wrapped annuel |

## 2.6 MyGames

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Liste de jeux** : à faire, en cours, fini, abandonné, avec une note ; « fini » rapporte un succès | S | Le jeu entre dans la Culture par le fait de finir, sans récompenser le temps d'écran |
| **Soirée jeu du Crew** : chacun choisit de montrer sa ludothèque Steam ; MyLife trouve les jeux multijoueurs que tout le monde possède et propose une Sortie « en ligne » | M | Le Crew sert aussi à distance ; réutilise Sortie et « Chaud ? » |
| **Plus de sources** : RetroAchievements (API publique), saisie rapide console ou mobile depuis la palette | S à M | Toujours un plan sans API fermée |
| **Repère de temps choisi** : un plafond hebdomadaire que *tu* fixes, signalé sans rouge ni reproche | S | Le temps d'écran qu'on veut surveiller, dans l'esprit « rien de culpabilisant » |
| **« Où va ton temps ? » élargi** : chaque nouvelle app peut déclarer ses heures (lecture, plein air, sommeil, travail), et la vue devient semaine par semaine | S par source | La vue transversale prend tout son sens quand elle couvre plus que 3 sources |

## 2.7 Copilot

C'est le plus gros levier de la V4. Copilot lit tout, mais ne peut rien préparer. Le faire passer à « il prépare, tu
valides » change la nature de MyLife.

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Actions validées** **(suite V3)** : voir la fondation F1. Copilot propose « ajoute ce billet en dépense prévue », « décale la séance de jeudi », « crée la Sortie avec la bande », sous forme de cartes ; tu touches « Valider » et c'est l'app concernée qui écrit | L | La limite « pas d'actions » ; Copilot devient utile au quotidien sans jamais agir seul |
| **Un seul Copilot partout** : l'appui long sur l'orbe ouvre Copilot dans toutes les apps, avec les outils de l'app en cours en premier. L'assistant de MyFinances et le coach de MyPerf deviennent des « modes » de Copilot | M | Une seule IA, une seule conversation, une seule façon de faire : la règle « une seule app unifiée » appliquée à l'IA |
| **Mémoire visible** : Copilot garde des notes (tes objectifs, tes contraintes : « pas de séance le mercredi »), que tu vois, modifies et effaces. Synchronisées chiffrées ; la clé d'API, elle, ne l'est jamais | M | Sans mémoire, chaque conversation repart de zéro ; visible et effaçable, elle reste sous ton contrôle |
| **Point du lundi** : à la première ouverture de la semaine, un briefing de 5 lignes (semaine passée, semaine à venir, une suggestion) ; généré sur l'appareil, rien en arrière-plan | S | La valeur de Copilot sans avoir à poser de question |
| **Sans clé d'API** : les mêmes briefings et analyses via l'IA gratuite de ton choix (MyLife prépare un résumé à copier, sans montant si tu préfères, et la réponse se colle) | S à M | Un inconnu n'a pas de clé Anthropic ; aujourd'hui, Copilot lui est fermé |
| **Coût maîtrisé** : estimation du coût de chaque question, modèle léger (Haiku 5.5) pour les questions simples, Opus 5.5 pour les analyses | S | « Chaque question est facturée sur ton compte » : rendre ça visible et raisonnable |
| **Fiches depuis Android** **(suite V3)** : l'APK pose ses fiches par la synchro chiffrée (une ligne de fiche, plutôt que sur l'appareil seulement) | M | Copilot sur le web connaît enfin les séances faites sur l'APK |

**Terminé quand** : trois actions validées (une par app principale), testées avec Claude simulé, chacune refusable et
annulable ; Copilot ouvert depuis chaque app ; mémoire visible et effaçable.

## 2.8 Crew et Pacte

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Défis courts** : un duel d'une semaine (« plus de jours sous l'enveloppe », « plus de séances »), lancé en deux touchers | S | Plus léger qu'un Pacte, pour les groupes qui ne veulent pas s'engager un mois |
| **Raid** : un objectif commun (« 60 séances à nous tous ce mois », « 10 sorties cet été »), où tout le monde gagne ou personne | S à M | La coopération met moins de pression que le classement (risque noté en V3) |
| **Fil du Crew** : des événements automatiques choisis par chacun (« record battu », « niveau 20 », « Pacte tenu »), avec des réactions | M | Le Crew vit entre deux classements ; tout reste facultatif et ne montre que des scores |
| **Cagnotte → Sortie** : la cagnotte du Pacte devient une ligne du budget de la Sortie (« la cagnotte paie la première tournée ») | S à M | L'idée de la V3 (« la dépenser dans une Sortie »), enfin branchée |
| **Saisons** : classement trimestriel avec remise à zéro douce et succès de saison | S | Un nouvel arrivant a une chance ; ça relance les groupes endormis |
| **Notification de groupe** : « il y a du nouveau dans ton Crew » (texte générique, le serveur voit seulement qu'une ligne a changé) | S à M | Le Crew se rappelle à toi sans pistage ni contenu en clair |

## 2.9 Mes apps (plateforme, paliers 2 et 3)

| Idée | Effort | Pourquoi ça vaut le coup |
|---|---|---|
| **Modifier une app** **(suite V3)** : ajouter, renommer ou retirer un champ et changer l'objectif, sans perdre les saisies (les valeurs d'un champ retiré sont gardées, masquées) | S à M | Aujourd'hui on recrée l'app et on perd l'historique |
| **Rappels par app** **(suite V3)** : à l'heure choisie, une notification écrite **par l'appareil** (fondation F2) | M | Une app d'habitude sans rappel, on l'oublie au bout d'une semaine |
| **Apps à plusieurs** **(suite V3)** : une app dont les saisies sont communes, sur un espace chiffré (une saisie = une ligne, 8 Ko au plus) ; stats par membre et pour le groupe | L | Le palier 2 de la plateforme : la liste de lecture du couple, le suivi des corvées, le carnet de vin du groupe |
| **Nouveaux champs** : échelle (1 à 10), liste de cases, minuterie intégrée, lieu (noté sur l'appareil), photo (avec F4) | M | Couvre la plupart des suivis qu'on demande encore à des apps à part |
| **Champs calculés** : de petites formules (`pages / minutes`, `prix × quantité`) lues par un analyseur maison, **jamais** par `eval` | M | Plus de puissance sans casser la règle « rien ne s'exécute » |
| **Vues** : calendrier en chaleur sur l'année, comparaison de deux apps (« sommeil et humeur »), avec la corrélation expliquée en mots | S à M | Ce que Copilot sait déjà faire, mais visible sans clé |
| **Bibliothèque de modèles** intégrée, qui grandit à chaque version (30 modèles au lieu de 6), sans boutique publique | S | Démarrer en un toucher compte plus que la liberté totale |

**Terminé quand** : une app modifiée garde ses saisies, un rappel arrive avec un texte écrit par l'appareil (le serveur
n'a envoyé qu'un signal), une app à plusieurs fonctionne de bout en bout à deux comptes.

---

# Partie 3 : Nouvelles apps et nouveaux terrains

Chaque nouvelle app principale doit **faire franchir un palier** à l'écosystème : couvrir un pan de vie que MyLife ne
touche pas, rendre les autres apps plus utiles, et nourrir le Personnage, le Crew et Copilot. Une app qui ne fait rien
de tout ça reste une app sans code dans « Mes apps ».

## 3.0 Le contrat d'app et les fondations

### Le contrat d'app MyLife (effort M, à faire avant toute nouvelle app) : **fait** (`docs/CONTRAT-APP.md`, journal `docs/V4.md`)
Une liste de contrôle, et un générateur (`npm run new-app <id>`) qui crée le squelette déjà branché :

| Prise | Ce que l'app fournit |
|---|---|
| Registre | entrée dans `MYLIFE_APPS` (nom, couleurs, icône, chemin) et ses écrans dans `MYLIFE_DESTINATIONS` |
| Synchro | son app de synchro déclarée (1.2), son quota, ses tables |
| Aperçu | une ligne pour l'accueil et les Espaces (`writeGlance`) |
| Personnage | ses compteurs par semaine (jamais de détail), la stat qu'elle nourrit, une quête possible |
| Copilot | une fiche de contexte et des outils de lecture ; plus tard, ses actions validées (F1) |
| Wrapped et Bilan | une story et une ligne du bilan |
| Crew | ce qui est partageable, stat par stat |
| Données | sa part dans l'export de « Mes données » et sa section dans `/confidentialite` |
| Appareil | ce que `claimDevice` efface quand un autre compte se connecte |
| Tests | un test du moteur, un parcours de bout en bout (dont 320 px et un autre compte qui repart de zéro) |

**Où vit une nouvelle app** : par défaut, **dans `web/`**, en pages chargées à la demande, comme MyMusique et MyGames.
Pas de nouveau projet Vercel, pas de nouvelle copie du kit, un seul déploiement. On en fait une app à part
(`apps/<id>`) seulement si elle a besoin d'une autre pile technique.

**Pourquoi ça vaut le coup** : sans contrat, chaque nouvelle app oublie une prise (l'effacement à un changement de
compte, l'export…) et la règle « rien de personnel » finit par casser. Avec lui, une nouvelle app coûte un tiers de
moins et arrive complète.

### Les fondations (ce qui rend les nouvelles apps possibles)

| # | Fondation | Effort | Ce qu'elle ouvre | Règles du projet |
|---|---|---|---|---|
| F1 | **Actions validées** : un format commun d'« action proposée » (app, opération, aperçu lisible, annulation), une carte de validation du kit, et un exécuteur dans chaque app | L | Copilot qui prépare (2.7), coach de bloc (2.3), Objectifs (3.1), planning de MyChef (3.4), Foyer (3.3) | L'IA propose, l'app exécute après ton toucher ; chaque action est annulable et journalisée sur l'appareil |
| F2 | **Rappels écrits par l'appareil** : le serveur garde l'abonnement et des heures de réveil, et envoie un **signal vide** ; le service worker lit les données locales et écrit lui-même le texte | M | Mes apps, MyChef (péremptions, décongélation), Foyer (corvées), Agenda, Cercle (anniversaires), échéances du Coffre | Le serveur ne sait pas de quoi tu es rappelé ; aucun contenu en clair |
| F3 | **Agenda commun** : chaque app publie ses événements à venir (séance prévue, paie, prélèvement, Sortie, échéance) dans un format partagé, lu sur l'appareil | M | MyAgenda (3.2), « Ta journée » (2.1), Objectifs, Copilot (« ma semaine est-elle trop chargée ? ») | Calculé sur l'appareil, synchronisé chiffré comme le reste |
| F4 | **Coffre de fichiers chiffrés** : fichiers chiffrés sur l'appareil avant l'envoi, stockés en blocs opaques (Vercel Blob ou équivalent), clé dans la ligne chiffrée ; quotas par compte | L | Coffre (3.5), Voyage (3.8), photos de progression, souvenirs de Sortie, billets, champs photo de Mes apps | Le serveur stocke des octets illisibles ; quotas et coûts surveillés (`stats:serveur`) |
| F5 | **Coquille native** : une APK MyLife (l'accueil web dans une coque native qui reprend la PWA), avec accès à Health Connect et aux widgets ; l'APK MyPerf la rejoint à terme | L | Santé (3.9), widget « Ta journée », notifications plus fiables sur Android | Une seule app installable, aucune donnée hors de l'appareil sans chiffrement |

## 3.1 MyObjectifs : la direction (effort M)
**Quoi** : tes objectifs de l'année ou du trimestre, **reliés aux apps** qui en mesurent l'avancée, sans saisie :
« 5 000 € de côté » (MyFinances), « 100 kg au développé couché » (MyPerf), « 20 livres » (Culture), « un semi-marathon »
(Plein air), « une sortie par mois avec la bande » (Sortie). Chaque objectif se découpe en jalons et en arcs de
quêtes (2.1). Copilot peut proposer un plan, que tu valides (F1).

**Palier franchi** : aujourd'hui, chaque app mesure, mais rien ne dit *pourquoi*. MyObjectifs donne une direction à tout
l'écosystème et transforme les quêtes hebdomadaires en étapes d'un but que tu as choisi. C'est la première app qui se
sert de **toutes** les autres, d'où sa place en tête : elle valide le contrat d'app et les fondations.

**Règles** : progression calculée sur les compteurs (jamais de montant affiché si tu ne le veux pas : « 62 % » au lieu
de « 3 100 € ») ; objectifs chiffrés dans le compte ; partageables dans le Crew en pourcentage seulement.

**Terminé quand** : trois objectifs de trois apps différentes avancent tout seuls sur des données de test, un arc de
quêtes en découle, l'objectif atteint donne un succès et une story.

## 3.2 MyAgenda : la colonne vertébrale du temps (effort M à L)
**Quoi** : un agenda qui se remplit tout seul à partir des apps (fondation F3) : séances prévues, jour de paie,
prélèvements, Sorties, échéances du Coffre, anniversaires du Cercle, rappels de Mes apps. Tes agendas Google, Apple ou
Outlook entrent **par lien ICS ou par fichier**, lus sur l'appareil, sans connexion OAuth. Vues jour, semaine et mois,
une semaine type, et la détection des conflits (« séance jambes la veille du festival »).

**Palier franchi** : « Où va ton temps ? » regarde le passé ; MyAgenda regarde l'avenir. Copilot répond enfin à « quelle
semaine alléger ? » à partir de ton vrai agenda, et MyPerf peut déplacer une séance quand ta semaine déborde (action
validée).

**Règles** : les liens ICS sont lus par l'appareil. Si un relais est nécessaire pour contourner le CORS, il ne garde
rien, comme le relais Steam. Les événements sont chiffrés dans le compte.

**Terminé quand** : un agenda ICS importé, des événements de trois apps, un conflit détecté et une séance déplacée par
action validée.

## 3.3 MyFoyer : MyLife à la maison (effort L)
**Quoi** : la vie commune d'un foyer (couple, coloc, famille), sur un espace chiffré :
- **dépenses communes** permanentes avec un solde « qui doit quoi », sur le moteur de budget de la Sortie
  (`packages/lumen/src/sortie.ts`) et le budget à deux (2.2) ;
- **courses et repas du foyer** : la liste de courses, le garde-manger et le planning des repas de **MyChef** (3.4),
  partagés avec le foyer au lieu d'être réinventés ici ;
- **corvées tournantes** (qui sort les poubelles cette semaine), avec rappels écrits par l'appareil (F2) ;
- **factures et échéances du logement** (loyer, énergie, assurance), retrouvées dans MyFinances de chacun ;
- un **tableau du foyer** : ce qui est à faire aujourd'hui pour la maison.

**Palier franchi** : jusqu'ici, « à plusieurs » voulait dire festival. MyFoyer fait de MyLife un outil du quotidien
pour plusieurs personnes à la fois, utilisé chaque jour, ce qui est le meilleur moteur de rétention possible. C'est
aussi la preuve que la brique « espace partagé » de la V3 tient la charge.

**Règles** : chiffré de bout en bout comme les Sorties ; chacun garde ses comptes privés et ne partage que les dépenses
qu'il verse au foyer ; quitter le foyer efface ses lignes (règle des espaces). La stat **Foyer** du Personnage compte
les corvées faites, jamais les montants. Pas de classement entre colocataires.

**Terminé quand** : un foyer à trois comptes de bout en bout : liste cochée hors ligne puis synchronisée, une dépense
commune répartie et rapprochée de la banque, une corvée tournante avec rappel.

## 3.4 MyChef : courses, garde-manger, recettes et repas de la semaine (effort L+, en 4 paliers)
**Quoi** : l'app de la cuisine du quotidien. Elle sait ce que tu as chez toi, te dit ce que tu peux cuisiner avec,
prévoit tes repas de la semaine et en déduit ce qu'il faut acheter. Elle est bâtie sur une boucle qui tourne toute seule
une fois lancée :

```
 Garde-manger ──▶ « Avec ce que j'ai » ──▶ Planning de la semaine ──▶ Liste de courses
      ▲                                          │                          │
      └──── « J'ai cuisiné » retire du stock ◀───┘     cochée en magasin ───┘ (entre dans le stock)
```

### Ce qu'il faut (par bloc)

**1. Garde-manger** : ce qu'il y a chez toi.
- Trois lieux (frigo, placard, congélateur), regroupés par rayon.
- **Quantité au choix de précision** : « en stock / bientôt fini / fini » par défaut, ou une quantité précise
  (500 g, 6 œufs, 1 L) pour qui le veut. Personne ne pèse son riz : la version simple doit suffire.
- **Dates de péremption** (DLC « à consommer jusqu'au », DDM « de préférence avant ») avec un fil « à finir vite » ;
  une date proposée par défaut selon l'aliment (lait ouvert : 4 jours) et toujours modifiable.
- **Indispensables** : les aliments que tu veux toujours avoir (œufs, pâtes, café), avec un seuil. Sous le seuil, ils
  passent tout seuls sur la liste de courses.
- **Base de cuisine** : sel, poivre, huile, épices courantes, cochés une fois pour toutes et jamais comptés comme
  « manquants ».
- **Entrées rapides**, de la plus simple à la plus automatique :
  - saisie avec suggestions (catalogue d'aliments embarqué, synonymes et pluriels comme le rapprochement d'exercices de
    MyPerf : « tomates », « tomate cerise », « tom. ») ;
  - **liste de courses cochée** → les articles achetés entrent dans le stock (le cas le plus fréquent, sans effort) ;
  - **code-barres** (lecteur du navigateur quand il existe, sinon saisie du numéro) : le produit est retrouvé dans
    Open Food Facts par le relais, qui ne reçoit **que le code-barres**, comme les symboles des placements ;
  - **ticket de caisse** : photo ou texte du ticket passé à l'IA gratuite de ton choix (même mécanique que l'import de
    programmes MyPerf : une demande à copier, la réponse collée est lue même abîmée), ou à Copilot avec ta clé. Aperçu
    obligatoire avant d'ajouter au stock.

**2. Recettes** : ton livre de cuisine.
- Un format d'échange (`mychef-recipe`) : titre, portions, temps, ingrédients (quantité, unité, aliment, facultatif ou
  non), étapes, étiquettes (rapide, végé, protéiné, batch, sans four…). Le même format sert à l'import, au partage par
  lien et aux recettes fournies.
- **Import** : coller le texte d'une recette (analyseur à règles, sans IA : « 200 g de farine », « 3 œufs ») ; passer
  par l'IA gratuite pour une photo de livre ou une capture ; ou un **lien de site** lu par un relais sans état qui
  n'extrait que la fiche recette standard publiée par la plupart des sites (données `Recipe`).
- **Recettes fournies** : une trentaine de recettes simples et génériques pour démarrer (rien de personnel).
- **Portions ajustables** (quantités recalculées), conversions d'unités (cuillère, tasse, g, ml, pièce).
- **Mode cuisine** : une étape par écran, gros texte, écran gardé allumé, minuteurs intégrés tirés du texte (« 12 min »)
  et plusieurs minuteurs en même temps.
- Note et « refaire ? » après chaque recette faite ; historique des plats cuisinés.

**3. « Qu'est-ce que je fais avec ce que j'ai ? »** : le cœur de l'app.
- Pour chaque recette : **faisable maintenant**, **à 1 ou 2 ingrédients près** (lesquels), ou non.
- Classement qui favorise ce qui **périme bientôt**, puis le temps disponible, puis ce que tu n'as pas mangé récemment.
- Remplacements simples proposés (crème ↔ yaourt grec, beurre ↔ huile) depuis une petite table de substitutions.
- Avec Copilot (ta clé) : une recette inventée à partir du stock exact, rangée dans le format commun, à valider.

**4. Planning de la semaine**.
- Une grille jour par jour (midi et soir, petit-déjeuner facultatif), remplie à la main (glisser une recette) ou
  **proposée** : on utilise d'abord ce qui périme, on varie, on respecte le temps dispo selon le jour, et on prévoit les
  **restes** (cuisiner pour 4 les soirs où tu as le temps, manger 2 fois).
- **Branché sur les autres apps** : soir de Sortie ou de festival → pas de dîner prévu ; jour de séance lourde dans
  MyPerf → plat plus riche en protéines ; enveloppe serrée dans MyFinances → plats moins chers ; plus tard, MyAgenda
  (3.2) bloque les soirs pris.
- Copilot peut proposer toute la semaine en une fois : c'est une **action validée** (F1), rien n'est écrit sans ton
  toucher.
- Rappels écrits par l'appareil (F2) : « sors le poulet du congélateur » la veille, « le lait périme demain ».

**5. Liste de courses**.
- **Générée** : (ingrédients du planning − ce que tu as) + indispensables sous le seuil + ce que tu ajoutes à la main.
  Les quantités s'additionnent (deux recettes à 200 g de riz = 400 g) et s'arrondissent au conditionnement courant.
- Rangée **par rayon**, dans l'ordre de ton magasin (l'ordre se mémorise quand tu coches).
- **Partagée** avec le foyer ou le coloc sur un espace chiffré (lignes ouvertes, comme le sac de la Sortie), **hors
  ligne d'abord** (le réseau d'un supermarché est souvent mauvais), cochée en temps réel par chacun.
- Cocher = acheté → entre dans le garde-manger. Un ticket importé ensuite corrige les quantités et apprend les prix.

**6. Argent et anti-gaspi**.
- **Prix appris** des tickets importés → coût estimé de la liste, d'une recette et d'un repas.
- **MyFinances** : les courses détectées dans les opérations alimentent un « coût des repas maison » sur le cycle, et la
  comparaison avec la livraison et les restaurants (catégorie déjà classée), en pourcentage si tu préfères. L'enveloppe
  du jour peut prévenir quand une grosse course est prévue au planning.
- **Gaspillage évité** : ce qui a été cuisiné avant péremption ; ce qui a été jeté se note en un toucher (« jeté »).

**7. Nutrition (facultative, désactivée par défaut)**.
- Valeurs nutritionnelles calculées sur l'appareil à partir d'une table d'aliments ouverte embarquée (CIQUAL de l'Anses,
  données publiques) et d'Open Food Facts pour les produits scannés.
- Protéines par repas reliées à l'objectif de MyPerf ; aucun objectif de poids, aucun compte de calories imposé.
- **Régimes et allergies** : filtres des recettes (végétarien, sans gluten, sans lactose…). Une allergie est une
  donnée de santé : elle reste chiffrée dans ton compte, n'est jamais partagée dans le Crew, et la page légale le dit
  (même vigilance que MySanté, 3.9).

### Branchements dans l'écosystème (contrat d'app)
| Prise | MyChef |
|---|---|
| Aperçu | « Ce soir : risotto (tout est là) » ou « 3 produits à finir vite » |
| Personnage | compteurs : repas cuisinés maison, gaspillage évité ; nourrit la stat **Vitalité**, qui existe ainsi avant MySanté et sans aucune donnée de santé ; quête « cuisiner 4 soirs cette semaine » |
| Copilot | outils de lecture (stock, péremptions, planning, recettes, prix) ; actions validées : proposer la semaine, ajouter à la liste, créer une recette |
| Crew | recettes partagées par lien (la recette seule, jamais ton stock) ; défi « zéro gaspi » ; « qui apporte quoi » pour un repas commun |
| Sortie | courses d'un week-end ou d'un repas de groupe : la liste de la Sortie devient une liste MyChef, la dépense passe au budget partagé |
| Wrapped | « 142 repas maison, 9 kg de gaspillage évité, ton plat de l'année » |
| Foyer | liste, garde-manger et planning partagés (3.3) |
| Mes données | stock, recettes, planning et listes dans l'export |

### Palier franchi
C'est l'app qu'on ouvre **plusieurs fois par jour** (en se demandant quoi manger, au magasin, en cuisinant), là où les
autres apps s'ouvrent une fois par jour ou par semaine. Elle croise presque tout l'écosystème : l'argent (MyFinances),
le corps (MyPerf, plus tard MySanté), le temps (MyAgenda), les autres (Foyer, Sortie, Crew). Et elle répond à un
problème que tout le monde a, inconnus compris : « on mange quoi ce soir ? ».

### Règles du projet
- **Chiffré de bout en bout** : stock, recettes, planning et listes sont des lignes chiffrées (une par article, recette ou
  jour, pour éviter le piège des lignes trop grosses de 1.1). Le serveur ne sait pas ce que tu manges.
- **Relais sans mémoire** : le code-barres seul vers Open Food Facts, l'adresse d'une recette seule pour en extraire la
  fiche ; rien n'est gardé, avec des limites de requêtes comme le relais Steam.
- **L'IA propose** (planning, recette inventée, lecture d'un ticket), toujours avec un aperçu, et **toujours un chemin
  sans IA** (analyseur de texte, saisie, recettes fournies).
- **Rien de personnel livré** : recettes fournies et catalogue génériques, aucune habitude d'achat par défaut.
- **Rien de culpabilisant** : pas de rouge sur un produit jeté, nutrition désactivée par défaut, pas de classement des
  régimes dans le Crew.
- **Kit commun** : grille, listes cochables, mode cuisine et minuteurs passent par `packages/ui`. Les nouveaux composants
  (liste cochable partagée, minuteur multiple) servent ensuite à Foyer, Voyage et Mes apps.

### Paliers
| Palier | Contenu | Effort | Terminé quand |
|---|---|---|---|
| 1. Garde-manger et courses | Stock (simple ou précis), péremptions, indispensables, liste de courses partagée hors ligne, cocher = en stock | M | Une liste partagée à deux comptes, cochée hors ligne en magasin, remplit le garde-manger des deux ; un produit sous le seuil revient seul sur la liste |
| 2. Recettes et « avec ce que j'ai » | Format, import (texte, IA, lien), recettes fournies, portions, mode cuisine, recettes faisables ou à 1 ingrédient près, « J'ai cuisiné » retire du stock | M | Une recette collée en texte est comprise ; avec un stock de test, les recettes faisables et presque faisables sont justes ; cuisiner décompte le stock |
| 3. Planning de la semaine | Grille, proposition automatique (péremptions, restes, temps), liste générée, liens avec Sortie, MyPerf et MyFinances, rappels (F2) | M | Une semaine proposée utilise d'abord ce qui périme, saute le soir d'une Sortie, et la liste générée ne contient que ce qui manque |
| 4. Automatique et intelligent | Code-barres, tickets (IA gratuite ou Copilot), prix appris, coût des repas dans MyFinances, nutrition facultative, actions validées de Copilot (F1), Vitalité et quêtes | M à L | Un ticket importé met à jour stock et prix ; Copilot propose une semaine validée en un toucher ; Vitalité monte avec les repas maison |

## 3.5 Coffre : tes papiers et leurs échéances (effort L, après F4)
**Quoi** : les documents importants chiffrés sur l'appareil (pièces d'identité, contrats, garanties, factures d'achat,
bulletins de salaire, avis d'imposition), avec leurs **échéances** : passeport qui expire, fin de garantie, préavis de
résiliation, contrôle technique, renouvellement d'assurance. Inventaire des objets de valeur (relié aux Biens du
patrimoine de MyFinances). Copilot ne lit que les métadonnées (type, date, échéance), jamais le fichier, sauf si tu
l'y autorises pour une question précise.

**Palier franchi** : le pan administratif de la vie, que personne n'aime gérer, et la première app « coffre-fort » pour
laquelle le chiffrement de bout en bout de MyLife est un argument décisif. La fondation F4 sert ensuite partout
(photos, billets, souvenirs).

**Règles** : chiffrement avant l'envoi, clé jamais transmise ; quotas par compte ; rien d'indexé côté serveur ;
la clé de secours prend encore plus d'importance, et l'écran le dit.

**Terminé quand** : un document chiffré envoyé, relu sur un second appareil, illisible en base (test), et une échéance
qui déclenche un rappel.

## 3.6 MyCulture : livres, films, séries (effort M à L)
**Quoi** : ce que tu lis et regardes. Import des exports Goodreads, Babelio, Letterboxd et TV Time (fichiers, sur
l'appareil), liste « à lire, à voir », notes, citations surlignées, objectif annuel. Avec MyMusique et MyGames, elle
forme le pôle Culture.

**Palier franchi** : la stat Culture ne repose aujourd'hui que sur la musique. Avec MyCulture, elle devient une vraie
stat **Savoir**, alimente les objectifs de lecture et donne au Wrapped annuel ses histoires les plus partageables (« 23
livres, 61 films »). Le Crew gagne les recommandations entre amis.

**Règles** : uniquement des imports de fichiers et des saisies (toujours un plan sans API) ; des résumés gardés,
pas l'export entier ; partage d'une liste choisie, jamais de l'historique complet.

**Terminé quand** : un export Goodreads et un export Letterboxd importés donnent des stats justes ; Savoir monte ;
une recommandation passe d'un membre du Crew à l'autre.

## 3.7 MyPlein air : course, vélo, randonnée (effort M à L)
**Quoi** : l'endurance et le dehors. Import de fichiers GPX et FIT (montre, Strava, Garmin), tracés sur une carte,
allures, dénivelé, records personnels (5 km, 10 km, semi), volume hebdomadaire. Lien avec MyPerf : la charge totale de
la semaine (salle et cardio) et des séances de jambes placées loin des sorties longues.

**Palier franchi** : MyPerf couvre la force, pas l'endurance, alors que c'est l'activité physique la plus répandue.
Nouvelle stat **Endurance**, objectifs du type « courir un semi » (3.1), et des Pactes du Crew en kilomètres.

**Règles** : le suivi GPS en direct n'est pas fiable dans une PWA en arrière-plan, donc on importe les fichiers de la
montre ou du téléphone. Les traces sont des positions précises : elles restent chiffrées, et le partage dans le Crew se
limite aux distances et aux durées, **jamais le tracé** (il révèle le domicile).

**Terminé quand** : un GPX importé donne distance, allure et dénivelé justes ; Endurance monte ; la charge combinée
apparaît dans MyPerf.

## 3.8 MyVoyage : la Sortie en grand (effort L, après F4)
**Quoi** : un voyage de plusieurs jours, seul ou à plusieurs : itinéraire jour par jour, hébergements, transports,
billets et réservations (dans le Coffre, F4), budget multi-devises (sur le moteur de la Sortie), liste à emporter,
carnet de voyage, carte des lieux, et un souvenir à la fin (comme la Sortie, en plus riche).

**Palier franchi** : la Sortie a prouvé le modèle sur une soirée ou un festival ; MyVoyage l'étend aux moments qui
comptent le plus dans une année et qui demandent le plus d'organisation à plusieurs. MyFinances anticipe le budget du
voyage, MyAgenda réserve les jours et MyPerf allège la semaine.

**Règles** : même espace chiffré que la Sortie ; les billets sont des fichiers chiffrés ; les taux de change passent par
le relais existant (seules les devises sont envoyées, comme les symboles des placements).

**Terminé quand** : un voyage à deux de bout en bout, avec itinéraire, un billet chiffré partagé, une dépense en devise
répartie et rapprochée de la banque.

## 3.9 MySanté : sommeil, corps, énergie (effort L, après F5 et l'examen RGPD)
**Quoi** : sommeil, pas, fréquence cardiaque au repos, poids et mesures, humeur et énergie. Sources : **Health
Connect** sur Android via la coquille native (F5), exports Apple Santé, Withings, Fitbit ou Google (fichiers), et
« Mes apps » pour le reste. Corrélations avec le reste de ta vie : sommeil et performances à la salle, humeur et
dépenses impulsives, énergie et sorties.

**Palier franchi** : c'est le pan qui relie tout (on s'entraîne, on dépense et on sort selon son énergie). La stat
**Vitalité** complète le Personnage, et Copilot gagne ses analyses les plus utiles (« tes records tombent après 7 h de
sommeil »).

**Règles** : données de santé = catégorie particulière (RGPD, article 9). La feuille de route de la V3 l'avait posé :
**pas de données de santé avant d'avoir regardé le cadre**. Le chiffrement de bout en bout aide (le serveur ne lit
rien), mais il faut un consentement explicite, une page légale mise à jour, et rien de santé dans le Crew par défaut.
Aucun conseil médical : Copilot le dit.

**Terminé quand** : l'examen RGPD est fait et noté, une nuit de sommeil arrive de Health Connect, Vitalité monte, une
corrélation est expliquée en mots, et rien de santé ne sort de l'appareil en clair.

## 3.10 MyCercle : les gens qui comptent (effort M)
**Quoi** : un carnet des proches. Anniversaires (avec rappel F2), idées de cadeaux (reliées au budget), dernière fois
que vous vous êtes vus (tirée des Sorties, des groupes MyRave et des séances à deux), et un rappel doux (« ça fait
3 mois que vous ne vous êtes pas vus », sans prénom dans le texte de la notification).

**Palier franchi** : la stat Social ne compte aujourd'hui que les festivals et les groupes. MyCercle l'étend à toute la
vie sociale, ce qui en fait la stat la plus humaine du Personnage, et pousse vers de vraies rencontres plutôt que vers
l'écran.

**Règles** : des données sur des tiers qui n'ont rien accepté. Elles restent donc strictement privées, chiffrées, et ne
sont jamais partagées ni lues par le serveur. C'est l'usage purement personnel prévu par le RGPD, et la page légale le
précise. Aucun import de répertoire en masse.

**Terminé quand** : un anniversaire déclenche un rappel écrit par l'appareil, « dernière fois vu » se met à jour après
une Sortie, et Social compte les retrouvailles.

## 3.11 MyTravail : études, travail, projets (effort M)
**Quoi** : temps de travail ou de révision (pointage en un toucher ou minuteur de concentration), heures
supplémentaires qui annoncent la paie dans MyFinances, candidatures (suivi des étapes), projets perso avec leurs tâches.

**Palier franchi** : « Où va ton temps ? » ignore aujourd'hui la plus grosse part de la semaine. Avec MyTravail, la vue
devient complète, et MyFinances prévoit une paie variable au lieu de la deviner.

**Règles** : rien d'un employeur, aucune connexion à un outil de travail ; tout est chiffré ; pas de comparaison des
heures dans le Crew (le Crew ne doit pas devenir une course au surmenage).

**Terminé quand** : une semaine pointée apparaît dans « Où va ton temps ? » et des heures supplémentaires modifient la
prévision de paie.

## 3.12 Nouveaux terrains de plateforme

| Terrain | Effort | Ce que ça ouvre | Règles du projet |
|---|---|---|---|
| **Apps avec code, dans un cadre isolé** (palier 3 de la plateforme) : une `iframe` isolée, sans réseau, qui ne parle à MyLife que par un petit jeu de capacités (lire ses données, écrire les siennes, afficher par le kit) | L+ | Des apps impossibles en sans-code (jeux, calculateurs) ; l'objectif final « chacun ajoute la sienne » | Pas de boutique publique ; une app ne voit que ses propres données ; capacités déclarées et acceptées ; jamais de clé d'API transmise |
| **Mode famille** : un compte parent qui crée des comptes enfants, avec des Mes apps et des corvées adaptées, sans accès aux données de l'enfant au-delà de ce qu'il partage | L | MyFoyer pour les familles, et une génération de plus d'utilisateurs | Consentement parental (RGPD pour les mineurs) ; rien de visible d'un compte à l'autre par défaut |
| **Passkeys** (`CONTEXTE.md` § 10) quand l'extension PRF sera fiable partout | M | Connexion sans mot de passe, moins de comptes perdus (le premier risque noté) | La clé de données reste dérivée côté appareil |
| **Densité des identités** (`CONTEXTE.md` § 10) : le champ `density` utilisé pour les espacements | S | Des écrans plus denses pour les nouvelles apps riches en données (Agenda, Foyer) | Passe par le kit, testé dans les 12 thèmes |
| **Widgets et raccourcis** (avec F5) : « Ta journée » et l'enveloppe du jour sur l'écran d'accueil du téléphone, sans montant si tu préfères | M | La valeur de MyLife sans même l'ouvrir | Données lues sur l'appareil, rien de plus envoyé |

---

# Ordre de priorité

Chaque phase sert seule et ouvre la suivante. On s'arrête pour tester après chaque étape (`docs/V3.md`, méthode
inchangée). Le journal de la V4 sera `docs/V4.md`.

| Phase | Contenu | Effort cumulé | Ce que ça ouvre |
|---|---|---|---|
| **A. Base saine** | 1.1 lignes trop grosses → 1.2 apps de synchro → 1.3 doublons MyPerf → 1.4 refonte MyFinances (2 à 5) → 1.5 fin de l'étape 9 | L | Tout le reste : sans 1.1 et 1.2, aucune nouvelle donnée ne se range sans risque |
| **B. Multiplicateurs** | Contrat d'app (3.0) → F2 rappels écrits par l'appareil → F1 actions validées → F3 agenda commun ; moteur à stats déclarées (2.1) | L+ | Chaque nouvelle app coûte moins et arrive branchée ; Copilot change de nature |
| **C. Gains rapides sur l'existant** | Modifier une app et rappels par app (2.9), groupe MyRave depuis la Sortie et repères (2.4), part des Sorties dans le budget (2.2), quêtes au choix, succès et classes (2.1), line-up × goûts (2.5), un seul Copilot partout et point du lundi (2.7), défis et raids (2.8) | L | Ce que les inconnus de la phase A auront réclamé ; la V3 tient enfin toutes ses promesses |
| **D. Premières nouvelles apps** | MyObjectifs (3.1, valide le contrat) → MyChef paliers 1 à 3 (3.4, sur les espaces et F2) → MyAgenda (3.2, sur F3) → MyFoyer (3.3, reprend la liste de MyChef, le budget à deux et F2) → MyChef palier 4 (sur F1) | L+ | MyLife devient quotidien, plusieurs fois par jour, et à plusieurs ; Objectifs donne un sens aux quêtes, MyChef fait revenir chaque jour, Agenda nourrit Copilot |
| **E. Profondeur** | Prescriptions et progression automatique (2.3), « Et si ? » et échéancier (2.2), MyCulture (3.6), MyPlein air (3.7), MyCercle (3.10), mémoire de Copilot (2.7), apps à plusieurs (2.9) | L+ | Le Personnage passe à 8 stats ; le Wrapped annuel couvre toute la vie |
| **F. Gros terrains** | F4 coffre chiffré → Coffre (3.5) → MyVoyage (3.8) ; F5 coquille native → examen RGPD → MySanté (3.9) ; apps avec code isolé (3.12) | L+ | Les pans les plus sensibles, ouverts seulement quand la base, le chiffrement et le cadre légal sont prêts |

```
A Base saine ─▶ B Contrat + F1/F2/F3 ─┬─▶ C Gains rapides
                                      ├─▶ D Objectifs ─▶ MyChef ─▶ Agenda ─▶ Foyer
                                      └─▶ E Culture, Plein air, Cercle, Copilot qui se souvient
                                                       │
            F4 Coffre chiffré ─▶ Coffre ─▶ Voyage ◀────┘
            F5 Coquille native ─▶ examen RGPD ─▶ Santé
            Apps avec code isolé (quand Mes apps à plusieurs a prouvé le besoin)
```

**Pourquoi cet ordre va le plus vite** :
- **A avant tout** : le bug de 1.1 bloquerait en silence toute donnée commune, et 1.2 est la porte d'entrée de chaque
  nouvelle app. Les faire après coûterait une migration par app.
- **B avant D** : le contrat d'app et les fondations sont payés une fois et servent à chaque app suivante. MyObjectifs,
  la plus petite des nouvelles apps et celle qui se sert de toutes les autres, sert de banc d'essai au contrat.
- **C en parallèle de B** : des gains visibles pour les premiers utilisateurs pendant que les fondations se
  construisent, choisis d'après leurs retours.
- **F en dernier** : fichiers, santé et code tiers sont les terrains où une erreur coûte le plus cher (données
  sensibles, coûts de stockage, sécurité). On y va avec une base éprouvée.

## Points de contrôle (on ne passe pas à la suite sans)
- **Après A** : au moins un inconnu revenu après une semaine ; dix conversations faites ; la liste de la partie 3
  retriée selon ce que trois personnes sur dix évoquent d'elles-mêmes.
- **Après B** : une app de test créée avec le générateur, qui coche tout le contrat en moins d'une session.
- **Après D** : un foyer réel utilise MyFoyer chaque semaine pendant un mois, et la liste de MyChef sert à chaque course
  pendant un mois.
- **Avant F** : coûts du stockage de fichiers estimés pour 100 et 1 000 comptes ; examen RGPD santé écrit.

## Risques
- **Disperser** : trois nouvelles apps à moitié faites valent moins qu'une app complète. Le contrat d'app est le
  garde-fou : une app n'est pas « faite » tant qu'elle ne coche pas tout.
- **Alourdir l'accueil** : chaque nouvelle app dans `web/` est chargée à la demande. Le paquet principal est surveillé
  à chaque étape, comme celui de MyFinances.
- **Coûts** : fichiers (F4) et notifications (F2) sont les premiers postes qui grossissent avec les comptes. Quotas par
  compte dès le début, et `stats:serveur` étendu.
- **Données sur des tiers et données de santé** (Cercle, Santé) : cadre légal d'abord, puis le code.
- **Copilot qui agit** : une action mal comprise est pire qu'aucune action. Chaque action est montrée en clair,
  refusable, annulable, et testée avec Claude simulé.
- **Pression sociale** : plus de Crew veut dire plus de comparaison. Raids et coopération d'abord, tout reste
  facultatif et masquable.
