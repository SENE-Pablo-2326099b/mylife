# Feuille de route MyLife

**Objectif final** : un environnement d'apps utiles et amusantes, centralisé et sécurisé (chiffré de bout en bout),
dont n'importe qui se sert au quotidien, seul ou avec son entourage ; et, à terme, où chacun peut ajouter la sienne.

**Principes** : une étape à la fois ; chaque étape sert seule (rien n'est « utile plus tard ») ; rien de personnel
envoyé en clair (le serveur ne voit que des blocs chiffrés) ; le fun vient de la vraie vie (les données arrivent
toutes seules, jamais de double saisie) ; rien d'obligatoire ni de culpabilisant.

```
1 Personnage ─▶ 2 Bilan & Wrapped ─▶ 3 Espace partagé + Crew ─▶ 4 Sortie ─▶ 5 MyMusique ─▶ 6 MyGames + Temps
                                                      │                                          │
                                                      └──▶ 8 Pacte                 7 Copilot ◀───┘ (dès l'étape 1 en lecture)
                                       9 Ouverture au public ─▶ 10 Plateforme d'apps (dans 2 ans)
```

Effort : S = quelques heures, M = une à deux sessions, L = plusieurs sessions.

---

## Étape 1 : Le Personnage (RPG de la vraie vie) : effort M, **fait** (journal : `docs/V3.md`)

**But** : l'accueil de MyLife montre un personnage dont les stats montent avec ce que tu fais déjà dans MyFinances,
MyPerf et myRaveLoc. Aucune saisie en plus.

**Comment (architecture)**
- Chaque app dépose, comme elle le fait déjà pour les aperçus, un petit **instantané de stats** dans le stockage commun
  (`mylife:stats:<app>`) : des nombres calculés, jamais le détail (séances de la semaine, jours sous l'enveloppe, groupes actifs).
  `packages/lumen` définit la forme ; chaque app écrit la sienne.
- L'accueil calcule le personnage à partir de ces instantanés (fonctions pures, testées).
- Le **registre d'XP** (une ligne par semaine) est gardé dans l'app de synchro `mylife` (chiffré, comme l'apparence) : la progression
  suit d'un appareil à l'autre et ne se perd pas.

**Stats de départ (5)**
| Stat | Source | Ce qui la fait monter |
|---|---|---|
| Force | MyPerf | séances faites, records battus, volume |
| Discipline | MyFinances | jours sous l'enveloppe du jour, épargne du cycle tenue |
| Social | myRaveLoc | groupes actifs, sorties (plus tard : Sortie, Crew) |
| Constance | toutes | jours actifs d'affilée (au moins une action dans une app) |
| Culture | MyMusique (étape 5) | verrouillée au début, « bientôt » |

**Niveaux** : points requis `100 × niveau^1,5` ; niveau global = moyenne pondérée. Titres et paliers (« Novice » → « Légende »).

**Quêtes hebdomadaires** : 3 par semaine, une par app, **calculées sur ton rythme** (si ton planning prévoit 4 séances, la quête dit 4).
Validation automatique, récompense en XP. Une quête bonus « semaine complète ».

**Garde-fous** : pas de pénalité ni de vie perdue ; semaine de repos déclarable (la série est gelée) ; tout masquable ; montants jamais affichés.

**Terminé quand** : onglet « Personnage » sur l'accueil, 4 stats vivantes, quêtes de la semaine, progression synchronisée, tests unitaires du moteur
(courbes, quêtes, gel de série), parcours e2e (une séance + un jour sous l'enveloppe font monter les stats), captures sur 6 thèmes et à 320 px.

---

## Étape 2 : Bilan de la semaine et Wrapped : effort S à M, **fait** (journal : `docs/V3.md`)
- Carte du dimanche sur l'accueil : budget, séances, sorties, quêtes réussies.
- « Wrapped » mensuel et annuel : cartes images à partager (générées sur l'appareil, canvas), sans rien envoyer.
- **Terminé quand** : le bilan s'affiche à la bonne date, le partage d'image marche sur téléphone.

## Étape 2 bis : Importer son programme dans MyPerf : effort M, **fait**
Format d'échange, IA gratuite au choix (instructions à copier, réponse à coller), texte collé sans IA, programmes
prêts, aperçu à corriger, export. Ajoutée en route ; détails dans `docs/V3.md`.

## Étape 3 : Brique « espace partagé » et Crew : effort L, **fait** (journal : `docs/V3.md`)
- Un groupe chiffré où plusieurs personnes lisent et écrivent (mécanique de myRaveLoc : clé du groupe dans le lien d'invitation, serveur aveugle), rendue **générique** pour que d'autres apps s'en servent.
- Crew : on partage ses **scores** (jamais les données brutes ni les montants), choix stat par stat et groupe par groupe, discret et facultatif.
- Quotas par espace, quitter un groupe efface ce qu'on y a mis.
- **Terminé quand** : deux appareils de comptes différents voient leurs scores dans un groupe, le serveur ne voit rien de lisible (test), quitter un groupe retire les données.

## Étape 4 : Sortie : effort L, **fait** (journal : `docs/V3.md`)
Un événement (festival, week-end) qui orchestre tout : groupe de localisation, budget partagé, planning set par set (qui de la bande va où), liste à emporter,
« Chaud ? » (un tap pour répondre, la Sortie se crée quand 3 sont chauds), **carnet d'ID** (bouton « ID ? » qui note l'heure, la scène et le DJ du planning),
carte souvenir après. Réutilise l'espace partagé et myRaveLoc.
- **Terminé quand** : une Sortie de bout en bout à deux comptes, du « Chaud ? » à la carte souvenir.

## Étape 5 : MyMusique : effort M, **fait** (journal : `docs/V3.md`)
- Import de l'**export de données Spotify** (fichier demandé à Spotify, traité sur l'appareil, seuls les résultats sont gardés). Pas d'API : celle de Spotify est très restreinte pour les nouvelles apps (5 utilisateurs en mode développeur).
- Top artistes et morceaux, heure d'écoute type, obsession du moment, découvertes, séries ; croisement avec Sortie (ce qu'on écoutait avant un festival).
- Alimente la stat **Culture** du Personnage. Option plus tard : Last.fm / ListenBrainz en direct.
- **Terminé quand** : un vrai fichier d'export est importé et donne des stats justes ; rien n'est envoyé au serveur sauf les résultats chiffrés.

## Étape 6 : MyGames et « Où va ton temps ? » : effort M, **fait** (journal : `docs/V3.md`)
- Steam (clé gratuite, profil public) : temps de jeu total et récent. Autres jeux : saisie ou import, selon ce que tu joues.
- Vue transversale : camembert d'heures (jeu, musique, salle, festival…).
- **Terminé quand** : tes heures de jeu s'affichent et la vue « temps » regroupe au moins trois sources.

## Étape 7 : Copilot : effort M à L, **fait** (journal : `docs/V3.md`)
- Une IA (ta clé, sur l'appareil) qui lit un **résumé** de tes apps (instantanés + outils de lecture) et répond : budget d'un billet, semaine à alléger avant un festival, compatibilité d'un line-up avec tes goûts.
- Propose, ne fait jamais sans ta validation ; les écritures sont des propositions.
- Une première version en lecture seule est possible dès l'étape 1.
- **Terminé quand** : des questions croisant au moins deux apps reçoivent une réponse juste sur des données de test.

## Étape 8 : Pacte : effort M, **fait** (journal : `docs/V3.md`)
Engagement dans un groupe Crew (« 3 séances par semaine chacun »), validé automatiquement par MyPerf (ou MyFinances), cagnotte virtuelle (un compteur, pas de vrai virement)
qui paie la soirée du groupe. Règles de tricherie : seules les données calculées par l'app valent, pas de saisie libre.
- **Terminé quand** : un pacte à trois comptes se valide et se clôt tout seul.

## Étape 9 : Ouverture au public : effort L
*Fait côté app le 23/10/2026 (voir `docs/V3.md`) ; reste la relecture de la page légale et les premiers inconnus.*
Page de présentation, onboarding pour un inconnu (clé de secours très claire), politique de confidentialité et RGPD, quotas et coûts surveillés (base et hébergement), support, export des données,
notifications web push sans pistage. **Pas de données de santé avant d'avoir regardé le cadre RGPD.**
- **Terminé quand** : quelqu'un de totalement étranger au projet crée un compte, l'utilise une semaine et revient.

## Étape 10 : Plateforme d'apps (horizon 2 ans) : effort L+
D'abord des **apps sans code** décrites par l'utilisateur (l'IA les génère), partageables par lien ; puis, seulement si le besoin est là, des apps avec code dans un cadre isolé.
Pas de boutique publique au début. Identifiants d'app dynamiques et quotas par app côté serveur.

---

## Points de contrôle (on ne passe pas à la suite sans)
- Après l'étape 1 : 5 personnes proches l'essaient une semaine ; on note ce qui bloque, sans les aider.
- Après l'étape 3 : au moins un groupe réel s'en sert chaque semaine.
- Avant l'étape 9 : 10 conversations sur les problèmes du quotidien, pas sur l'app ; on construit ce que 3 personnes sur 10 évoquent d'elles-mêmes.

## Risques
Disperser (une étape à la fois) ; dépendances aux API tierces qui changent (Spotify, jeux) : toujours un plan sans API ; coûts quand les comptes augmentent ;
mot de passe perdu sans clé de secours (la première cause de colère à prévoir) ; pression sociale des classements (rester discret et facultatif).
