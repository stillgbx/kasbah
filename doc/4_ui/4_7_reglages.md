# Vue Réglages

> Dernière mise à jour : 2026-10-13
> Sources : sections reprises telles quelles de `4_1_navigation-et-panneaux.md` le 2026-10-13 ; chaque section cite les siennes.

Cette page couvre la vue Réglages : ses zones, la carte Plugins, les thèmes, le rendu 3D, les entrées locales au poste, les comptes, le calage sur la photo. Elle est née du découpage de
[4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md), trop longue pour être lue d'un trait : ses
sections y ont été déplacées sans retouche, dans leur ordre d'origine, avec leurs dates. Un renvoi
« plus haut » ou « plus bas » peut donc désigner une section restée dans une autre page de `4_ui/`.

## Vue Réglages (`views/SettingsView.vue`)

Colonne gauche : apparence (segmenté), langue (segmenté : automatique, français, english), couleur
d'accent (4 pastilles), origine GPS (+ compte niveaux/pièces/appareils), plein écran. Colonne droite :
plugins (nom, **noms des clés `.env`**, pastille de statut, nombre d'appareils) et carte d'appairage
Hue quand nécessaire.

*(Dépassé le 2026-09-12 puis le 2026-09-16 : les quatre pastilles d'accent sont une grille de thèmes (« Mise à jour 2026-09-12 — les quatre pastilles d'accent deviennent une grille de thèmes ») et la page ne se lit plus en deux colonnes mais en trois zones, les Plugins en pleine largeur à la fin (« Mise à jour 2026-09-16 — la vue Réglages en trois zones, les Ambiances rendues à leur plugin »).)*

### Mise à jour 2026-09-11 — carte Plugins : un interrupteur par fabricant, des pastilles par sous-item

Réglages → Plugins ne liste plus seulement les plugins actifs : elle liste **tout ce que le serveur
sait faire**, avec de quoi choisir.

- Une ligne par plugin : nom, clés `.env` lues (jamais leurs valeurs), pastille d'état, et un
  **interrupteur**. Cocher écrit la maison et prend effet sans redémarrer le serveur.
- Un squelette (Sonos, iRobot, Tesla…) est listé avec son interrupteur **grisé** et « Pas encore
  implémenté » : on voit ce qui existera sans pouvoir activer une coquille vide.
- Sous-items : une rangée de **pastilles à bascule** (« Fournit »), affichée seulement quand le
  plugin est allumé — décochées, elles ne voudraient rien dire. Pastilles et non cases à cocher pour
  deux raisons : `v-checkbox-btn` rend une icône vide avec le jeu d'icônes maison
  (`../6_faq/6_0_pieges-outillage.md`), et une pastille garde la **même empreinte** allumée ou
  éteinte. Vérifié : décocher « Énergie » ne déplace ni les pastilles voisines ni la ligne suivante.
- Un paragraphe d'introduction dit où va le choix (`settings.pluginsHint`) : dans le fichier de la
  maison, pas dans le navigateur — il vaut donc pour tous les écrans.

### Mise à jour 2026-09-19 — plus de squelette dans Réglages → Plugins

Le tiret « Un squelette (Sonos, iRobot, Tesla…) » plus haut date d'avant l'implémentation de ces
trois-là. `sonos` était le **dernier** `makeStubPlugin` ; il a quitté ce statut le 2026-09-19
(`../3_plugins/3_15_sonos.md`). L'interrupteur grisé « Pas encore implémenté » reste le comportement
de `implemented: false` — il n'a plus de porteur dans `PLUGIN_FACTORIES`. Les enceintes Sonos
apparaissent dans la vue Médias déjà existante (bande « Hors maison » tant qu'on ne les a pas
placées) ; aucune carte de liaison, aucune vue nouvelle. Le cas de test « ne se déplie pas »
(`PluginSection.test.ts`) construit un id factice `unobtanium`.

### Mise à jour 2026-09-12 — les quatre pastilles d'accent deviennent une grille de thèmes

Le bloc « Couleur d'accent » de la colonne gauche des Réglages est remplacé par un bloc **« Thème »**
(commit `abf88f5`, mécanique côté palette dans `4_2_theme-et-langues.md`). Quatre pastilles rondes ne
pouvaient plus rien dire : un thème ne se reconnaît pas à son accent mais à son fond et ses surfaces.

Une **tuile par thème**, deux colonnes, chacune composée de trois éléments d'empreinte fixe :

- un **aperçu** de 46 px qui rend la palette elle-même — fond du thème, carte posée dessus, deux
  barres de texte (`text` et `muted`), pastille d'accent en bas à droite. C'est la palette qui se
  montre, pas une vignette d'illustration à maintenir à côté ;
- le **nom** du thème (nom propre, jamais traduit) ;
- une **ligne de variante** toujours présente, même vide : elle porte le nom de la déclinaison chez
  son auteur (« Latte », « Alucard », « Light Owl », « Day ») ou, pour un thème sans variante claire,
  « Sombre uniquement ». Réserver la ligne évite que la grille se réorganise en changeant
  d'apparence — règle « rien ne doit bouger » (`4_0_langage-visuel.md`).

**L'aperçu montre la variante que l'apparence DEMANDE**, pas celle appliquée : en apparence
« Clair », toutes les tuiles s'affichent en clair sauf Synthwave '84 qui reste sombre — ce qui est
précisément ce que chacune appliquerait si on la choisissait. Le badge « Sombre uniquement » est
**statique** (il dépend du thème, pas de l'état), donc il ne clignote pas d'une apparence à l'autre.
Le thème sélectionné se marque comme les autres bascules de la page : bordure d'accent et fond
`--accent-soft`.

La description de la vue Réglages plus haut (« couleur d'accent (4 pastilles) ») est donc caduque sur
ce point ; le reste de la colonne — apparence, langue, origine GPS, plein écran — est inchangé.

### Mise à jour 2026-09-15 (ter) — carte « Rendu 3D » des Réglages

Sous le bloc « Thème », dans la colonne de gauche, une carte qui rassemble ce qui décide de
l'apparence de la SCÈNE (et non de l'interface) :

- une **grille de tuiles de style** (même gabarit que les tuiles de thème : aperçu, nom, bordure
  d'accent sur la tuile active). L'aperçu est rendu avec les couleurs du style **à l'heure choisie** —
  ciel en fond, sol en bas, un pan de mur posé dessus, une pastille de la couleur du verre. Un style de
  nuit ne se juge pas sur sa palette de midi : changer l'ambiance redessine donc les quatre tuiles.
- un **segmenté « Heure de la maison »** (Automatique / Jour / Crépuscule / Nuit) et sa ligne
  d'explication : elle dit que le réglage est indépendant du thème clair/sombre et qu'« Automatique »
  suit le soleil réel d'après l'origine GPS ;
- un **segmenté « Qualité »** (Automatique / Haute / Moyenne / Basse) et sa ligne d'explication.

Le style s'applique EN DIRECT, sans rechargement : revenir sur la vue Maison montre la nouvelle
matière (vérifié en passant de Réaliste à Cyberpunk avec la maison de démo). Voir
`../1_architecture/1_5_scene-3d.md` pour ce que chacun des trois axes pilote, et
`4_2_theme-et-langues.md` pour les clés persistées.

Sources : `apps/web/src/views/SettingsView.vue`, `apps/web/src/stores/settings.ts`.

### Mise à jour 2026-09-16 — Réglages → Plugins : chaque fabricant tient dans SA section, dépliable

Constat de l'utilisateur : « le plugin renault affiche toujours son bloc "compte lié" alors que le
plugin est paramétré et fonctionne ». C'était structurel — les cartes de mise en route (Hue, Nest,
Enphase, Tesla, Renault) vivaient **au-dessus** de la liste et décidaient chacune de leur apparition.
Celle de Renault n'avait aucune condition de retrait : compte lié, elle restait là à l'annoncer.

La carte Plugins devient une liste de **sections** (`components/settings/PluginSection.vue`, une par
plugin de l'inventaire) :

- **En-tête toujours rendu**, empreinte fixe : chevron, nom, pastille d'état (+ « n appareils »),
  interrupteur. Le chevron reste dans le DOM même quand il n'y a rien à déplier (`visibility: hidden`) :
  les noms de tous les fabricants restent alignés, y compris ceux des squelettes.
- **Corps déplié** : le `detail` que renvoie le serveur — jamais affiché jusqu'ici, alors qu'il dit
  l'essentiel (« IQ Gateway D8.x · N onduleurs, N batteries », « gateway-1234-5678-9012.local
  (protocol 2026.3.3-7) ») —, puis la carte de mise en route du fabricant, les pastilles « Fournit »,
  puis les clés `.env`. Les clés quittent donc la ligne repliée, qui redevient lisible d'un coup d'œil.
- **Ouverture automatique** quand le serveur RÉCLAME quelque chose : `needs_pairing` et `error`,
  et seulement pour un plugin allumé. **Pas `degraded`** : un fabricant dégradé se plaint souvent sans
  rien demander (Cast qui attend un appareil éteint), et ouvrir sa section n'y changerait rien — arbitré
  avec l'utilisateur, au prix de ne plus ouvrir seuls Enphase « jeton qui expire » et Tesla « domaine
  non enregistré », qui sont `degraded` eux aussi.
- **L'utilisateur garde le dernier mot** : `manual: boolean | null`, `null` = on suit le serveur ; un
  clic fixe l'état dans les deux sens (fermer une section ouverte seule, ouvrir une section calme).
- `v-show` et non `v-if` sur le corps : les cartes interrogent leur fabricant au montage et retiennent
  où en est la mise en route (l'onglet de consentement ouvert, par exemple). Replier ne doit rien
  redemander.

Conséquence pour les cinq cartes : elles perdent leur condition d'apparition et leur titre propre (la
section porte déjà le nom), et gardent leur enveloppe `card--soft` comme bloc du corps. Deux d'entre
elles n'existaient qu'en `needs_pairing` et gagnent donc leur **état déjà lié**, avec de quoi refaire
la liaison — c'est le sens de la demande, « chaque section affiche ses propres infos/params (moyen de
lier, de délier…) » :

- **Hue** : « Le pont est apparié. » + « Réappairer le bridge » (à ne faire que si la clé est perdue,
  la nouvelle est à recopier dans `.env` : le texte le dit).
- **Nest** : « Compte Google lié. » + « Relier le compte à nouveau » (c'est le chemin pour changer les
  caméras partagées, le choix se fait dans l'écran de consentement Google).
- **Enphase** : en `stage: 'ok'`, la carte dit que la passerelle est appairée et qu'il n'y a rien à
  faire tant que le jeton vaut, au lieu de son texte d'introduction ; le formulaire de renouvellement
  reste sous la main.
- **Tesla** et **Renault** : contenu inchangé, ils cessent simplement de s'imposer.

Tests : `components/settings/PluginSection.test.ts` (6 cas — replié quand le fabricant va bien,
ouvert sur `needs_pairing` et `error`, fermé sur `degraded`, jamais ouvert pour un plugin éteint,
l'utilisateur a le dernier mot dans les deux sens, squelette inerte). Le panneau étant masqué par
`v-show`, l'assertion lit le `style` du corps : `isVisible()` de `@vue/test-utils` le rendait vrai.

Vérifié dans l'app (maison réelle, 13 plugins) : tout replié au chargement, plus rien au-dessus de la
liste ; noms alignés à 768 px ; aucun débordement introduit en 1280 / 768 / 375 px ni en thème clair
comme sombre — le dépassement horizontal des Réglages à 375 px préexiste et vient de la colonne de
gauche.

**i18n** : `settings.pluginDetails` (infobulle du chevron), `settings.hue.paired` / `.repair` /
`.repairHint`, `settings.nest.linked` / `.relink` / `.relinkHint`, `settings.enphase.paired`.
`settings.noKeys` est supprimée : la ligne des clés ne s'affiche plus que s'il y en a.

Sources : `apps/web/src/components/settings/PluginSection.vue`,
`apps/web/src/components/{Hue,Nest}*.vue`, `apps/web/src/components/{Enphase,Tesla,Renault}*.vue`,
`apps/web/src/views/SettingsView.vue`, `apps/web/src/i18n/locales/{fr,en}.json`.

### Mise à jour 2026-09-16 — la vue Réglages en trois zones, les Ambiances rendues à leur plugin

Deux changements de fond dans `views/SettingsView.vue`, qui **remplacent** deux descriptions plus
haut dans cette page : la section « Vue Réglages » (colonne gauche / colonne droite) et, dans la
mise à jour du 2026-09-08, le placement des Ambiances en **carte séparée, une par plugin**. Les deux
restent lisibles comme état antérieur ; depuis le 2026-09-16, ce qui suit fait foi.

**1. Les réglages d'abord, les fabricants en dernier.** La page ne se lit plus en deux colonnes
figées mais en deux temps : tous les blocs de réglages en haut, puis la carte **Plugins en pleine
largeur** en fin de page — chaque ligne de plugin (nom, clés `.env`, statut, interrupteur) a enfin
la place de se déployer sans se serrer.

**2. Les Ambiances vivent chez leur plugin.** Le bloc a quitté la colonne des réglages pour le
panneau dépliable de `components/settings/PluginSection.vue`, sous la carte d'appairage : réglage
« Nouvelles ambiances animées » (`PATCH /api/plugins/:id/settings`), puis la liste complète avec sa
bascule par ambiance et sa suppression en deux temps. Le code lit `scenes.scenesByPlugin` et filtre
sur `props.plugin.id` : **générique**, pas câblé sur Hue — aujourd'hui seul Hue en produit, un futur fabricant à scènes héritera du même emplacement. La
présence d'ambiances rend la section dépliable (`expandable`).

*Conséquence assumée* : les ambiances ne sont plus visibles sans déplier la section du fabricant.
C'est l'écran de **gestion** ; le geste courant reste la pastille du panneau pièce (`SceneChips.vue`).

#### La disposition des réglages, et pourquoi elle a coûté quatre essais

La forme retenue tient en un croquis :

```
| Apparence | Rendu 3D                    | Plein écran |
| Langue    |   tuiles     | Matières     | Origine GPS |
| Thème     |              | Débogage     |             |
|           |   Heure de la maison (pleine largeur)     |
|           |   Qualité            (pleine largeur)     |
--------------------------------------------------------
| Plugins                              (largeur totale)  |
```

Quatre unités : une **pile** d'une unité, le Rendu 3D sur deux, une pile d'une unité. Des piles
(`.stack`, `display: grid; align-content: start`) et non des cellules de grille — une rangée de
grille s'aligne sur son plus grand élément, et le Rendu 3D (887 px à l'origine, contre 94 px pour
« Plein écran ») aurait creusé sa hauteur à côté de chaque petit bloc. Chaque pile coule à son
rythme ; la page ne fait que la hauteur de la plus haute des trois.

Les mesures des tentatives écartées, pour ne pas les refaire (toutes prises au
`getBoundingClientRect` dans l'app réelle, viewport 1280 sauf mention) :

| Tentative | Hauteur | Ce qui clochait |
|---|---|---|
| Grille `auto-fit minmax(320px, 1fr)` | 1318 px | rangées alignées : 800 px de vide à côté du Rendu 3D |
| Colonnes CSS `columns: 360px` | 887 px | dense à 1280, mais **4e colonne entièrement vide** à 1920 |
| Colonnes `2 340px`, Rendu 3D au milieu | 1131 px | la dernière colonne absorbe le reste : 683 d'un côté, 1131 de l'autre |
| Colonnes `2 340px`, Rendu 3D **en dernier** | 808 px | 92-98 % de remplissage, mais pas de bloc sur 2 unités |
| **Trois zones 1-2-1** (retenue) | 682 px | conforme au croquis, ratio mesuré 1 : 2.00 : 1 à 1920 |

Trois enseignements réutilisables ailleurs (repris en `../6_faq/6_0_pieges-outillage.md`) :
le **nombre de colonnes utile** d'un empilement vaut « hauteur totale ÷ hauteur du plus grand bloc »
(ici ~2 — au-delà il n'y a plus de quoi remplir) ; l'équilibrage de `columns` **suit l'ordre du DOM**
et la dernière colonne ramasse le reste ; et `column-span` ne connaît que `all`, jamais « deux ».

#### Le seuil de 1500 px n'est pas un chiffre rond

`grid-template-columns: 1fr 2fr 1fr` ne s'applique qu'à partir de **1500 px** ; en dessous, tout
s'empile sur une colonne — ce qui suffit à ces blocs. Le seuil est mesuré, pas choisi : une piste
`fr` ne descend jamais sous le min-content de ce qu'elle porte (`../6_faq/6_0_pieges-outillage.md`),
et la pile de gauche en réclame **344 px** (le segmenté Automatique / Français / English). Un quart
de la largeur doit donc valoir au moins ça. Sous ce seuil les pistes se déformaient en
**344 / 492 / 246** — plus rien de 1-2-1, et la colonne de droite à l'étroit.

Le plancher `auto` est **gardé volontairement** (pas de `minmax(0, …)`) : il garantit que la piste
centrale ne se serre jamais au point de couper les segmentés, et il encaisserait une traduction plus
longue en élargissant plutôt qu'en tronquant.

#### Le contenu du Rendu 3D, et ce qui refuse de tenir en demi-colonne

Le bloc se lit sur deux colonnes — les tuiles de style à gauche, les bascules « Matières en images »
et « Débogage » à droite — **sauf les deux segmentés**, qui reprennent toute la largeur du bloc
(`.render__full`, `grid-column: 1 / -1`). Mesuré : « Automatique / Jour / Crépuscule / Nuit » réclame
**~370 px** de min-content, une demi-colonne n'en offrait que ~280, et un premier jet les coupait net
au bord de la carte. Les deux passent aussi en `dense` (prop déjà prévue par `ui/Segmented.vue`), ce
qui desserre d'autant la contrainte de largeur minimale imposée à la piste centrale.

La bascule à deux colonnes est une **requête de conteneur** (`container-type: inline-size` sur le
bloc, `@container (min-width: 520px)`) et non une requête d'écran : ce qui décide est la largeur du
bloc, qu'il soit sur deux unités en grand écran (881 px à 1920) ou en pleine page sur une tablette
étroite (635 px). En dessous de 520 px il repasse à une colonne tout seul.

Enfin, les tuiles (`.themes`, partagées par Thème et Rendu 3D) passent en
`repeat(auto-fit, minmax(max(130px, (100% - 20px) / 3), 1fr))` : autant par rangée que la colonne en
porte, **jamais plus de trois**. Il y a six thèmes comme six styles — 3 + 3 se ferme, 5 + 1 laissait
une orpheline. Effet de bord utile : sur large écran les deux blocs à tuiles raccourcissent au lieu
de s'étaler, ce qui aide les zones à finir à niveau.

Vérifié sur la maison réelle, deux thèmes, de 500 à 1920 px : aucun débordement horizontal, aucun
segmenté ni curseur coupé, ratio 1 : 2.00 : 1 à 1920 et 1 : 1.96 : 0.98 à 1512. Débogage activé, la
page passe à 879 px (pastilles météo 631 px, deux curseurs) et revient à 682 px en le refermant.

Sources : `apps/web/src/views/SettingsView.vue`,
`apps/web/src/components/settings/PluginSection.vue`, `apps/web/src/components/ui/Segmented.vue`.

### Mise à jour 2026-09-22 (quater) — en-tête Plugins : actifs / dispo · appareils

Réglages → Plugins porte à droite du titre un résumé (`settings.pluginsStats`) :
**actifs / disponibles · N appareils**. Actifs = `enabled` parmi les `implemented` ;
disponibles = plugins implémentés de l'inventaire ; appareils = `devices.count` du store
(parc live à l'instant T, pas la somme des `health.deviceCount`).

Sources : `apps/web/src/views/SettingsView.vue`, `stores/{plugins,devices}.ts`.

### Mise à jour 2026-09-25 — entrée de rail LOCALE (TENS) et « Sur cet appareil » dans les Réglages

Une entrée du rail peut désormais dépendre du **poste** et non de la maison : `NavItem.local`
(`lib/navItems.ts`) nomme un plugin local, et `visibleNavItems(isEnabled)` filtre la liste pour le
rail (`layout/NavRail.vue`) comme pour la recherche (`composables/useSearch.ts`). Première entrée
concernée : **TENS** (icône `pulse`, route `/tens`, entre Animaux et Automatisations — juste avant
ce que la maison fait seule, qui ne peut justement pas l'atteindre).

Réglages : un bloc **« Sur cet appareil »** précède la liste des plugins de la maison, avec un
interrupteur par plugin local, enregistré dans le navigateur (`stores/localPlugins.ts`,
`kasbah.localPlugins`) et non dans house.json. Sur une tablette murale, rien n'apparaît.

La vue `views/TensView.vue` suit la règle « rien ne bouge » (mesuré au `getBoundingClientRect()`
entre repos, connecté, séance, montée et pause) : emplacements des boutons de connexion réservés,
ligne d'erreur réservée, cartes Séance et Programmes à hauteur égale côte à côte (Pause / Arrêter
collés en bas), noms de programmes sur deux lignes plutôt que tronqués, point pulsant (`PulseDot`)
à place réservée pour le programme en cours. Détail du plugin : `../3_plugins/3_21_actitens-tens.md`.

Sources : `apps/web/src/lib/navItems.ts`, `apps/web/src/components/layout/NavRail.vue`,
`apps/web/src/composables/useSearch.ts`, `apps/web/src/views/SettingsView.vue`,
`apps/web/src/views/TensView.vue`, `apps/web/src/stores/localPlugins.ts`.

### Mise à jour 2026-10-06 (soir) — Réglages : la carte « Comptes »

La carte « Assistants IA (MCP) » de Réglages (`components/settings/McpUsersCard.vue`) devient
**« Comptes » / « Accounts »** : les mêmes comptes ouvrent Kasbah depuis l'extérieur et connectent un
assistant IA. Aide réécrite en fr et en. Quand une session existe (adresse publique), la carte affiche
« Connecté en tant que … » et un bouton « Se déconnecter » (formulaire natif `POST /logout` : le serveur
ferme la session et renvoie à sa page de connexion) ; la liste et le formulaire y sont **masqués** et
`/api/mcp/users` n'est même pas demandé (il rendrait 403 `LAN_ONLY`). Sur le réseau local, rien de
changé. Vérifié en fr et en à 375 px, sans débordement. Détail : `../1_architecture/1_7_serveur-mcp.md`,
mise à jour du 2026-10-06 (soir) ; la description d'origine de la carte y figure à la mise à jour du
2026-10-04 (nuit).

### Mise à jour 2026-10-13 — Réglages : « Caler sur la photo » (origine GPS)

Le bloc « Origine GPS » des Réglages porte un bouton « Caler sur la photo » qui ouvre
`components/settings/OriginCalibration.vue`. Masqué sur une propriété de démonstration, comme le relief :
on ne réécrit pas un fichier versionné.

- **Ce qu'elle montre** : l'orthophoto IGN (ou le plan), et par-dessus, en trait **épais** le contour du
  dernier niveau qui a un `outline` (le toit que montre la photo), en trait **fin** les pièces du niveau
  le plus bas (annexe, terrasse), le terrain en pointillé, les places, et la **pelouse** de chaque
  tondeuse qui a une carte (`site_map`) et une base posée, posée sur sa base. Le `outline` du
  rez-de-chaussée n'est volontairement PAS tracé (enveloppe pour le toit, pas l'emprise : piège dans
  `../2_maison/2_0_format-house-json.md`). La pelouse est le meilleur repère : elle est au sol, alors
  qu'un toit photographié d'avion est déporté d'un à deux mètres par la perspective.
- **Commandes** : flèches nord / sud / est / ouest (nord en haut, mètres du monde), rotation autour du
  centre de la maison, pas réglable 0,1 / 0,5 / 2 (mètres pour les flèches, degrés pour la rotation),
  zoom jusqu'à `IGN_MAX_ZOOM` + 4 (photo agrandie). Rien n'est écrit avant « Enregistrer »
  (`house.saveOrigin`, `PUT /api/house/origin`).
- **Rien ne bouge** : la ligne de bilan (« 1,0 m E · 0,5 m S · +3,5° », glissement du CENTRE de la
  maison depuis l'origine enregistrée ; exemple inventé) a sa propre ligne, car sa longueur change à
  chaque clic.
- **Après le calage** : le `mapOffset` d'une tondeuse (panneau « Modifier » de la vue Robots) est à
  remettre à zéro ; ce qui en resterait n'est plus l'erreur de la maison. Voir
  `../3_plugins/3_11_husqvarna-automower.md`.
- **Écarté** : glisser le contour à la souris (non fait).

Sources : `apps/web/src/components/settings/OriginCalibration.vue`, `apps/web/src/views/SettingsView.vue`.

### Mise à jour 2026-10-13 (bis) — Réglages : la carte « Mise à jour du serveur »

Pleine largeur, après « Assistant » et avant « Plugins » (`apps/web/src/components/settings/ServerUpdateCard.vue`) :

- le commit **en service** (sha court et titre), boutons **Vérifier** (`git fetch` forcé) et **Mettre à jour** ;
- une ligne toujours présente (en attente / à jour / dépôt injoignable), puis la liste des commits en
  attente (titres coupés à une ligne, défilement au-delà de 180 px) ;
- pendant une mise à jour, les étapes (Récupération, Dépendances si le lock change, Construction,
  Redémarrage, et Retour en arrière après un échec) avec la courante en cours ; l'état est relu toutes
  les 1,5 s, les échecs de lecture pendant le redémarrage sont ignorés ;
- après un échec : l'étape en cause, si la version précédente est revenue, et le **Journal** (dépliable,
  60 dernières lignes de sortie) ;
- sans superviseur (`npm start`, `npm run dev`) : bouton grisé et renvoi au wiki ; sous l'adresse
  publique : une ligne « depuis le réseau local », sans requête.

Le rechargement des écrans après le redémarrage reste celui du bandeau « Nouvelle version »
(`AppUpdateBanner.vue`). Colonne de la carte bornée (`minmax(0, 1fr)`) : à 375 px, un titre de commit
long élargissait la page de 263 px avant correction. Vérifié dans la preview (serveur de démonstration,
réponses de l'API simulées dans la page pour les états en cours et en échec) : sombre 1280 px, clair
375 px, fr et en.
