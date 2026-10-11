# Liste de courses

> Dernière mise à jour : 2026-10-11
> Sources : `packages/shared/src/shopping/{shopping,shopping.test}.ts`, `packages/shared/src/protocol/{ws,http}.ts`, `apps/server/src/core/shopping.ts`, `apps/server/src/http/{routes,shopping.test}.ts`, `apps/server/src/ws/hub.ts`, `apps/server/src/app.ts`, `apps/server/src/mcp/{server,server.test}.ts`, `apps/web/src/stores/{shopping,shopping.test,devices}.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, `apps/web/src/views/ShoppingView.vue`, `apps/web/src/lib/{navItems,strokeIcons}.ts`, `apps/web/src/router/index.ts`, `.gitignore`, `apps/server/src/plugins/shopping/index.ts`, `packages/shared/src/house/schema.ts` (`pluginSettingsOf`), `apps/web/src/components/layout/NavRail.vue`, `apps/web/src/composables/useSearch.ts`

## Ce que c'est

Une liste de courses **partagée par la maison** : chacun la remplit depuis n'importe quel écran (tablette,
téléphone, ordinateur), coche ce qui est pris au magasin, et l'agent la tient aussi par le MCP
(« ajoute du lait et des œufs »). Les produits déjà achetés une fois restent connus pour la recherche ;
ceux qu'on étoile deviennent des **habituels**, remis dans la liste d'un toucher.

Pas un plugin : aucun appareil derrière. C'est une fonction du serveur, comme les automatisations
(`1_8_automatisations.md`), avec le même modèle de fichier par maison.

## Décisions prises avec l'utilisateur (2026-10-11)

- **Cocher barre la ligne SUR PLACE**, elle ne descend pas dans une section « dans le panier » : au
  magasin, le doigt coche les lignes l'une après l'autre et rien ne doit bouger dessous (règle « rien ne
  bouge », `../4_ui/4_0_langage-visuel.md`). Un bouton **« Terminer les courses »** retire ensuite toutes
  les lignes cochées d'un coup.
- **Pas de rayons** dans cette version : ordre d'ajout. Le format peut les accueillir plus tard sans
  migration (un champ de plus sur le produit).
- **La quantité est un compteur −/+ sur la ligne**, pas un nombre tapé dans le texte (« 2 lait »).
- **Une entrée dans le rail ET dans la barre du bas du téléphone** (c'est le même composant,
  `NavRail.vue`, nourri par `NAV_ITEMS`) ; route en anglais comme les autres, `/shopping`.

Choix de détail faits en séance, annoncés sans objection :

- ajouter un produit **déjà dans la liste et pas encore pris** augmente sa quantité ; **déjà coché**, il
  redevient « à acheter » avec la quantité demandée, à sa place ;
- à 1, le « − » du compteur devient une **corbeille au même emplacement** : retirer une ligne sans
  l'acheter, sans bouton qui surgit ;
- tout produit ajouté entre dans la **mémoire** (`products`) ; l'étoile n'est qu'un drapeau dessus.

Écarté en v1 : « ajouté par » (sur le réseau local, tout le monde est « la maison » : le champ serait vide
la plupart du temps, voir `../0_overview/0_0_vision-et-principes.md` sur les comptes) ; photos et prix ;
oublier un produit de la mémoire (un nom mal tapé reste proposé par la recherche).

## Le modèle (`packages/shared/src/shopping/shopping.ts`)

Deux listes dans un objet `ShoppingList` :

| Liste | Contenu | Ordre |
|---|---|---|
| `items` | le panier en cours : `id`, `name`, `quantity` (1 à 99), `checked`, `addedAt` | ordre d'ajout, jamais retrié |
| `products` | la mémoire : `id`, `name`, `favorite`, `uses` (nombre d'ajouts), `lastUsedAt` | ordre d'entrée |

**Une clé par produit**, tirée du nom par `shoppingKey` : sans casse, sans accents, espaces resserrés.
« Lait », « lait » et « LAIT » sont un seul produit, et le panier n'en porte qu'une ligne ; l'`id` d'une
ligne EST la clé de son produit. Conséquence voulue : pas d'identifiant aléatoire (ni `randomUUID`, absent
d'une page servie en HTTP sur une adresse du réseau local, qui n'est pas un contexte sécurisé), des tests
déterministes, et un agent qui peut désigner une ligne par son nom (`findShoppingItem`). Un produit
connu garde le nom de sa première saisie (casse, accents).

Les opérations sont des **fonctions pures**, partagées par le serveur et par le mock du navigateur :
`addShoppingItems`, `updateShoppingItem`, `removeShoppingItem` (le produit reste en mémoire),
`clearCheckedShoppingItems`, `setShoppingFavorite` (un produit jamais ajouté entre en mémoire avec
`uses: 0`). `updateShoppingItem` et `removeShoppingItem` rendent `null` pour une ligne inconnue.

Schémas des corps : `shoppingAddBodySchema` (1 à 50 produits d'un coup, pour un agent qui dicte une
liste), `shoppingItemPatchSchema` (`checked` et/ou `quantity`, au moins l'un des deux),
`shoppingFavoriteBodySchema`. Noms de 1 à 60 caractères après `trim`.

## Persistance (`apps/server/src/core/shopping.ts`)

`maison.json` → `maison.shopping.json`, dans le même dossier (`shoppingPathFor`). Même contrat que les
automatisations : données de l'utilisateur, pas un cache ; **un fichier illisible empêche le démarrage**
(démarrer à vide ferait écraser la liste au premier ajout) ; fichier absent = liste vide ; copie `.bak`
de la version précédente ; écriture par `writeFileAtomic` (`core/atomic-file.ts`). Format
`{ schemaVersion: 1, items, products }`.

`ShoppingService.update(op)` met les opérations **à la file** : chacune lit la liste laissée par la
précédente, l'écrit sur disque, puis seulement la publie (`onChange`). Deux écrans qui cochent en même
temps ne s'écrasent pas (test « runs concurrent operations one after the other »). Une démonstration en
lecture seule (`readOnly`) rejette toute écriture en `ReadOnlyHouseError` (409 `DEMO_READONLY`).

Le service est construit dans `buildApp` (`apps/server/src/app.ts`) avant le hub WebSocket, dont le
snapshot porte la liste. Une bascule de propriété reconstruit l'application : la liste suit la maison.

`.gitignore` : `house/*.shopping.json` et ses intermédiaires `house/*.shopping.json.*tmp`.

## REST et WebSocket

Toutes les routes rendent la liste **entière** (`{ shopping }`, `shoppingResponseSchema`) — elle est
petite, pas de patch — et le service la rediffuse à tous les écrans par le message WS
`{ type: 'shopping', shopping }`.

| Route | Effet |
|---|---|
| `GET /api/shopping` | la liste |
| `POST /api/shopping/items` | ajoute `{ items: [{ name, quantity? }] }` |
| `PATCH /api/shopping/items/:id` | coche, décoche, change la quantité ; 404 si la ligne n'existe pas |
| `DELETE /api/shopping/items/:id` | retire la ligne (le produit reste connu) ; 404 sinon |
| `POST /api/shopping/finish` | « Terminer les courses » : retire les lignes cochées |
| `PUT /api/shopping/favorites` | `{ name, favorite }` : pose ou retire l'étoile |

Le snapshot porte `shopping` en champ **facultatif** (`.optional()`, pas `.default()`) : un `.default()`
l'aurait rendu obligatoire dans le type de SORTIE de `ServerMessage`, et chaque snapshot littéral des
tests web existants aurait cessé de compiler. Un snapshot sans liste laisse à l'écran la sienne.

## MCP

Six outils (`apps/server/src/mcp/server.ts`), qui passent par les routes ci-dessus (`app.inject`) :
mêmes validations, même file d'écriture, même diffusion aux écrans. Détail dans
`1_7_serveur-mcp.md` (mise à jour du 2026-10-11).

## L'écran (`apps/web/src/views/ShoppingView.vue`)

- **Un champ qui cherche ET ajoute.** On tape : les produits connus qui contiennent la saisie se
  proposent (début de nom d'abord, puis habituels, puis les plus achetés ; 8 au plus,
  `useShoppingStore().suggest`). La liste des propositions est **posée par-dessus la page**
  (`position: absolute`) : rien ne se décale dessous pendant la frappe. Si la saisie n'est aucun
  produit connu, la première proposition est « Ajouter « … » ». Entrée ajoute ; le champ se vide et
  **garde le focus** (les propositions retiennent le focus par `mousedown.prevent`) pour enchaîner.
- **La liste**, une carte de 60 px par ligne : case à cocher (toute la ligne la bascule), nom
  (`MarqueeText` s'il est trop long), étoile, compteur. Une ligne cochée se barre et s'estompe ; son
  compteur est **rangé** (`visibility: hidden`), jamais retiré.
- **Les habituels**, triés par nom (ordre fixe : une tuile ne change pas de place quand on la touche).
  Une tuile dont le produit est déjà à acheter s'estompe et se désactive, à la même taille. Écran large :
  colonne à droite de la liste. Écran étroit (< 900 px) : bande AU-DESSUS de la liste, qui défile de
  côté et garde 40 px de haut — une ligne ajoutée allonge la liste vers le bas sans rien déplacer.
  L'aide « Touchez l'étoile… » tient DANS la bande, à la même hauteur : la première étoile ne décale pas
  la liste.
- **L'en-tête** porte « N à acheter · M pris » (caché sur téléphone) et « Terminer les courses »,
  toujours affiché, éteint tant que rien n'est coché.

Le store (`apps/web/src/stores/shopping.ts`) est un miroir du serveur, remplacé à chaque message
`snapshot` / `shopping` (branché dans `stores/devices.ts`, avec les scènes et les automatisations).
**Chaque geste est optimiste** — la ligne se barre sous le doigt, pas après l'aller-retour — par les
mêmes fonctions pures que le serveur ; un refus remet la liste d'avant si rien d'autre ne l'a changée
entre-temps, et un toast le dit (`shopping.toast.error`).

Le transport en mémoire (`mockTransport.ts`, preview `kasbah-mock`) part de quelques produits inventés
(trois lignes, six habituels) pour que la démo ne s'ouvre pas sur une page vide.

Icône `cart` ajoutée à `strokeIcons.ts` ; entrée `shopping` dans `NAV_ITEMS` après l'École (la vie de
la famille, qu'on remplit et consulte chaque jour). Libellés `nav.shopping` et bloc `shopping` en
français et en anglais.

## Vérifié (2026-10-11)

- Tests : `shopping.test.ts` partagé (opérations, clé, schéma), `http/shopping.test.ts` (routes sur une
  COPIE de la maison de démo, fichier écrit, message WS, 404/400, fichier invalide refusé, file
  d'écriture, démo en lecture seule), `mcp/server.test.ts` (les six outils dans les deux versions du
  protocole), `stores/shopping.test.ts` (optimisme, retour arrière, propositions). Suite complète,
  typecheck et lint globaux verts.
- Preview `kasbah-mock` : géométrie relevée avant et après chaque geste (cocher, −, toucher un habituel,
  ajout au clavier) — aucun déplacement ; pas de débordement à 1280, 1024, 853 (zooms 1 / 1,25 / 1,5)
  et 375 px ; clair et sombre ; fr et en ; console sans erreur.
- **Piège de mesure** : dans le panneau masqué, les transitions CSS ne progressent pas — la case cochée
  se lisait transparente à `getComputedStyle` ; avec `transition: none` posé le temps de la lecture, elle
  rend bien la couleur d'accent. Même famille que `requestAnimationFrame`, qui ne part pas non plus
  quand le panneau est masqué.

### Mise à jour 2026-10-11 (2) — une fonction qu'on peut couper

**Demande de l'utilisateur** : tout le monde ne voudra pas de la liste de courses, il faut pouvoir la
désactiver. Deux voies étudiées avec lui :

- **retenue — un interrupteur dans Réglages → Plugins** : la liste reste une fonction du serveur, un
  plugin sans appareil (`apps/server/src/plugins/shopping/index.ts`) ne sert qu'à la faire figurer dans
  l'inventaire avec le même interrupteur que les autres ;
- **écartée — en faire un vrai plugin** : il lui faut le chemin de la maison et la diffusion WebSocket,
  que `PluginContext` ne donne pas ; élargir le contrat de TOUS les plugins pour une seule fonction ne
  valait pas.

**Allumée par défaut** (choix de l'utilisateur) : ni compte ni matériel à relier, on la voit tout de
suite et on la coupe si on n'en veut pas. Mécanique : `PLUGINS_ON_BY_DEFAULT` et
`pluginSettingsOf(plugins, id)` dans `packages/shared/src/house/schema.ts` — le réglage de la maison,
sinon le défaut du plugin. Le `settingsOf` de `buildApp` passe par lui, si bien que l'inventaire de
`/api/plugins` la donne allumée sur une maison qui n'en dit rien.

**Coupée**, c'est `plugins.shopping.enabled` de la maison que tout le monde lit :

| Où | Effet |
|---|---|
| routes `/api/shopping/*` | 409 `DISABLED` (crochet `onRequest` de `routes.ts`) |
| MCP | les six outils ne sont pas enregistrés ; une instance par requête, la bascule vaut dès la suivante |
| rail, barre du bas, recherche de la vue Maison | l'entrée disparaît (`NavItem.plugin`, second filtre de `visibleNavItems`) |
| page `/shopping` (adresse tapée, ou coupée pendant qu'on la regarde) | une carte « coupée dans les Réglages » et un lien vers eux ; en-tête sans compteur ni bouton |
| fichier `<maison>.shopping.json` | **gardé tel quel** : rallumée, la liste revient |

Les écrans suivent sans protocole nouveau : la route `PATCH /api/plugins/:id` rediffuse déjà la maison
(message `house`), et le web lit `house.plugins` dans le store de la maison. Avant que la maison
n'arrive, le défaut vaut (allumée) : pas d'entrée qui surgit dans le rail au chargement.

Différence voulue avec l'Agenda et l'École, qui restent dans le rail plugin coupé (page « plugin
désactivé ») : ceux-là demandent une mise en route, la liste de courses non — la couper, c'est n'en pas
vouloir.

**Vérifié.** `http/shopping.test.ts` (inventaire allumé par défaut, coupure par `PATCH /api/plugins/shopping`,
409 en lecture et en écriture, fichier intact, retour à l'allumage), `mcp/server.test.ts` (outils absents
quand coupée, dans les deux versions du protocole), `shopping.test.ts` partagé (`pluginSettingsOf`),
`navItems.test.ts`. Preview `kasbah-mock` : entrée retirée du rail et page « coupée » à la bascule,
retour à l'identique, console sans erreur — le mock n'a pas la carte dans ses Réglages (son inventaire
ne liste que la simulation), la bascule y a été faite sur le store. Suite complète, typecheck et lint verts.
