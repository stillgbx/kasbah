# Glossaire

> Dernière mise à jour : 2026-10-06
> Sources : `packages/shared/src/devices/kinds.ts`, `packages/shared/src/house/schema.ts`

| Terme | Définition |
|---|---|
| **Kind** | Famille d'appareil, une par appareil : `light`, `cover`, `media_player`, `climate`, `vacuum`, `mower`, `sensor`, `energy`, `ev_charger`, `vehicle`, `camera`, `weather`, `water`, `pet_feeder`, `pet_fountain`, `fan` (16 au total, `DEVICE_KINDS`). Fixe la forme de l'état et la famille de commandes. |
| **Capacité** (capability) | Trait fin déclaré par un plugin pour un appareil (`brightness`, `color`, `position`, `tilt`, `now_playing`…). L'UI n'affiche que les contrôles dont la capacité est présente ; le serveur refuse une commande dont la capacité manque. `KIND_CAPABILITIES` liste les capacités légales par kind. |
| **Descripteur** (`DeviceDescriptor`) | Identité stable d'un appareil de plugin : `id`, `pluginId`, `externalId`, `kind`, `name`, `capabilities[]`, `meta`. |
| **Id d'appareil** | `"<pluginId>:<externalId>"` (ex. `hue:6f2c…`, `mock:light-living`). Sert de clé partout : Map, URL, WebSocket, maison JSON. |
| **État** (`DeviceState`) | Objet discriminé par `kind`, avec `updatedAt` (posé par le serveur) et `available`. Toujours envoyé **entier** aux clients. |
| **Patch d'état** | Sous-ensemble de champs émis par un plugin ; fusionné par le registre. |
| **Commande** | Objet `{ type: "kind.verbe", … }` (`light.set`, `cover.set_position`, `climate.set_target_temp`…). Une seule commande fusionnée pour la lumière. |
| **Appareil maison** (`HouseDevice`) | Entrée de `house.json` : nom, position 3D, ancre (pièce/niveau/zone), lien optionnel `deviceId` vers un appareil de plugin. Sans lien : « non lié », affiché grisé. |
| **Clé de sélection** | Dans l'app web : id d'appareil maison, ou id de plugin pour un appareil non placé dans la maison. |
| **Niveau** (level) | Étage : `elevation` (z du sol fini), hauteur, `shortName` pour l'onglet. |
| **Pièce** (room) | Polygone CCW de la face intérieure des murs, sur un niveau ; porte ses murs et ses ouvertures. |
| **Zone** | Surface du jardin (`lawn`, `terrace`, `driveway`, `pool`…) qui ancre les appareils extérieurs. |
| **Ouverture** (opening) | Porte/fenêtre ancrée sur une arête de pièce : segment, offset, largeur, hauteur, allège. |
| **Scène** (house scene) | Lot de commandes déclaré dans `house.json` (Départ, Nuit, Cinéma) exécuté d'un geste *(Constat du lint du 2026-10-06 : `house.scenes[]` existe dans le schéma mais n'a aucun exécuteur, voir `1_architecture/1_8_automatisations.md` ; ce qu'on rappelle d'un geste, ce sont les ambiances de plugin ci-dessous)* *(Retirée le 2026-10-06 : le champ n'existe plus dans le format, voir `2_maison/2_0_format-house-json.md`.)*. À ne pas confondre avec la **scène 3D** (`HouseScene`, Three.js). |
| **Scène plugin** (`PluginScene`) | Préréglage qui vit **chez le fabricant** (scène Hue d'une pièce ou d'une zone). Kasbah ne la recompose pas : il la liste, en montre l'aperçu (`swatches`) et demande son rappel. `dynamic: true` = palette animée par le pont. Troisième sens du mot « scène » après la scène maison et la scène 3D ; l'UI l'appelle **« ambiance »**. |
| **Rappel** (recall) | Jouer une scène plugin, en mode `static` (valeurs fixes) ou `dynamic` (défilement de la palette, côté fabricant). |
| **Effet** (capacité `effect`) | Animation d'UNE lampe pilotée par le fabricant (`candle`, `fire`, `cosmos`…), indépendante des scènes. `no_effect` l'arrête. |
| **Plugin** | Module serveur implémentant `DevicePlugin` : découverte, push d'états, exécution de commandes. Activé par `KASBAH_PLUGINS` *(Dépassé le 2026-09-11 : variable supprimée, l'activation est dans `house.json`, `plugins.<id>.enabled`, réglable dans Réglages → Plugins — voir `1_architecture/1_2_serveur-et-plugins.md`)*. |
| **Registre** | Carte serveur `id → { descriptor, state }` qui fusionne les patchs et publie sur le bus uniquement en cas de changement. |
| **Hub** | Côté WebSocket serveur : snapshot à la connexion, diffusion coalescée (50 ms). |
| **Transport** | Côté web : abstraction `getHouse / getDevices / sendCommand / connect` ; implémentations HTTP+WS et simulation in-process. |
