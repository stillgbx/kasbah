# Pont Matter (Alexa, Google Home, Apple Maison)

> Dernière mise à jour : 2026-10-30
> Sources : `apps/server/src/matter/{bridge,mapping,mapping.test}.ts`, `apps/server/src/app.ts` (`MatterBridge`, `registerMatterRoutes`), `packages/shared/src/house/schema.ts` (`matterSettingsSchema`), `packages/shared/src/protocol/http.ts` (`MATTER_DEVICE_TYPES`, `matterSettingsPatchSchema`, `MatterStatus`), `apps/server/test/integration.test.ts`, `apps/web/src/components/settings/{MatterCard.vue,MatterCard.test.ts}`, `apps/server/package.json`

## Ce que c'est

Kasbah publie sur le réseau local un **pont Matter** : une seule « passerelle » dont les appareils que la
maison a choisis apparaissent comme des appareils Matter. Alexa, Google Home ou Apple Maison les
appairent avec un code, sans skill, sans compte développeur et sans que Kasbah soit exposé sur
Internet. Le pont ne crée aucun appareil : il lit le registre d'états et renvoie les commandes des
contrôleurs par l'hôte de plugins (`host.execute`), exactement comme le serveur MCP
(`1_7_serveur-mcp.md`). Il n'est pas un plugin (il ne fournit aucun appareil), d'où son propre bloc de
maison et sa propre carte de Réglages.

Intention : rendre des appareils pilotables à la voix. L'utilisateur n'a pas d'Echo ; le pont se teste
avec n'importe quel contrôleur Matter.

## Pistes écartées

- **Skill Smart Home Alexa officielle** : compte développeur Amazon, fonction Lambda, OAuth, et un Kasbah
  exposé en HTTPS. Beaucoup trop lourd pour ce que ça apporte face à Matter, qui reste sur le réseau local.
- **Piloter un Echo depuis Kasbah** (sens inverse, API non officielle `alexa-remote` et cookie) : rien à
  tester sans appareil. Laissé pour plus tard.
- **Exposer par type d'appareil ou par plugin** : écarté, l'exposition est **appareil par appareil**.
  Ce qui crée des doublons, c'est la **marque** (Hue, Somfy sont déjà connus des assistants et
  apparaîtraient deux fois), pas le type.
- **Mettre le réglage dans la carte Plugins** : écarté, l'en-tête « actifs / dispo · appareils »
  (`4_7_reglages.md`) serait faux pour un pont qui ne fournit rien.
- **Une « custom skill » qui passerait les questions à l'assistant de Kasbah** (pression des pneus,
  etc.) : piste distincte, **non faite**. Matter décrit des appareils, pas des informations : un capteur de
  pression Matter existe mais Alexa et Apple ne l'affichent a priori pas.

## Ce qui est publié (`mapping.ts`)

Module pur, sans import de matter.js (la bibliothèque ne se charge que si le pont est allumé).

| Kasbah | Matter | Détail |
|---|---|---|
| `light` avec `on_off` | lampe | avec `brightness` : lampe à variateur, niveau Matter 1 à 254 |
| `cover` avec `open_close` ou `position` | Window Covering | échelle **inversée** (voir plus bas) |
| `vehicle` avec `lock` | Door Lock | `LockState` 1 verrouillé, 2 déverrouillé, `null` si inconnu |

- **Volets** : Matter compte la position en centièmes de pour cent **fermé** (0 = ouvert) ; Kasbah, 0 =
  fermé, 100 = ouvert. Un volet sans `position` (radio à sens unique) n'a pas de position connue
  (`null`) et un ordre de niveau va à l'extrémité **la plus proche** (`coverCommandForLift`).
- **Porte de garage** : publiée comme volet, parce qu'aucun assistant ne connaît encore la porte de garage
  Matter. Conséquence assumée : « ouvre le garage » se dit **sans code vocal**, alors que la serrure en
  demande un pour déverrouiller.
- Un appareil d'un autre type n'est pas traduisible : il n'est pas proposé (clim Tesla en thermostat et
  automatisations en interrupteurs ont été laissées hors de l'itération 1).

## Réglage et routes

Bloc facultatif de la maison `matter: { enabled, devices: [ids] }` (`matterSettingsSchema`, voir
`../2_maison/2_0_format-house-json.md`). Hors du bloc, le pont est éteint.

- `GET /api/matter` : état (`enabled`, `running`, `commissioned`), **codes d'appairage et QR en SVG tant
  que le pont n'est pas appairé** (le QR est dessiné côté serveur par `qrcode`, le bundle web ne grossit
  pas), `candidates` (tous les appareils traduisibles, avec `listed` et `published`) et `skipped` (ids
  listés introuvables ou non traduisibles).
- `PATCH /api/matter` : seuls les champs présents sont écrits (comme `PATCH /api/plugins/:id`), par
  `updateHouseFile`, avec diffusion du message `house` sur le WebSocket, puis application **à chaud**.
  Maison de démo en lecture seule : refus habituel.

Types partagés : `MatterStatus`, `MatterSettingsPatch`, `MATTER_DEVICE_TYPES` (`packages/shared`).

## Cycle de vie (`bridge.ts`)

- Branché dans `app.ts` comme le MCP ; démarré **en parallèle** des plugins (`startPlugins`) et publie les
  appareils **au fil de leur apparition** (événement `devices` du bus) : un appareil listé dont le plugin
  démarre tard est publié quand il arrive.
- `apply()` suit le réglage sans redémarrage : démarre ou arrête le pont, publie, ou retire
  (`endpoint.delete()`) un appareil.
- Démarrage, arrêt, `apply` et `sync` passent par une **file sérielle** : une case cochée pendant le
  démarrage ne publie pas deux fois, un arrêt ne court pas contre une publication.
- `start()` ne lève jamais : un pont qui ne démarre pas ne doit pas faire tomber la maison.
- **Stockage** : clés et fabrics de matter.js dans `apps/server/.state/matter/` (non suivi), avec un
  code d'appairage aléatoire persistant. Identité : vendeur de test `0xFFF1`, produit `0x8000` : pont
  **non certifié**.
- Dépendances : `@matter/main` et `@matter/nodejs` en 0.17.9 (la 0.18.0 avait dix jours), `qrcode` 1.5.4.

### Commande de contrôleur ou écriture de Kasbah ?

Il faut distinguer ce qu'un contrôleur demande de ce que Kasbah écrit lui-même, sans quoi chaque état
poussé reviendrait comme une commande.

- **Lampes** : on observe `onOff$Changed` et `currentLevel$Changed`, et on **ignore le contexte
  `offline`** (celui des écritures locales). Observer plutôt que surcharger : le niveau est couplé à
  l'interrupteur, l'état doit bouger tout de suite.
- **Volets et serrure** : on **surcharge les commandes** (`upOrOpen`, `goToLiftPercentage`, `lockDoor`…).
  Un volet n'a pas de position à montrer avant que l'appareil bouge, et « stop » ne change rien qu'un
  observateur verrait.
- La commande Kasbah part **sans attendre** (`send`) : une voiture met des secondes à répondre, la
  transaction Matter ne doit pas rester ouverte. En cas d'échec, l'état réel du registre est
  republié, puisque le contrôleur montre déjà le changement.
- Les états du bus sont recopiés vers Matter (`state`), la disponibilité vers `reachable`.

## Pièges

- **matter.js installe son environnement Node à l'import** de `@matter/main` (signaux, code de sortie,
  lecture de `argv`, de l'environnement et d'un `config.json`, stockage dans le dossier personnel).
  `@matter/nodejs/config` doit donc être réglé **avant**, d'où un `import()` dynamique (`loadMatter`) : un
  import statique le ferait pour tous les serveurs, pont éteint compris.
- **Door Lock sans fonctionnalité** : la 0.17.9 exige `operatingMode` (Normal) et **valide quand même**
  `wrongCodeEntryLimit` et `userCodeTemporaryDisableTime` (borne 1 à 255, le défaut 0 est refusé) alors
  que ces champs n'existent pas dans le type sans la fonctionnalité PIN : posés par un cast, jamais
  utilisés.
- **Id d'endpoint** : le `.` est refusé, remplacé par `_` ; l'id doit rester **stable**, il indexe le
  stockage de matter.js.
- **Google Home** refuse un appareil Matter non certifié tant qu'il n'est pas déclaré (gratuitement)
  dans la console développeur Google Home ; Apple Maison affiche un avertissement ; Alexa n'a pas été
  essayé.

## Carte « Assistants vocaux (Matter) » de Réglages

Voir `../4_ui/4_7_reglages.md` (mise à jour du 2026-10-30).

## Vérifié, et non joué

**Vérifié** avec un contrôleur matter.js (script d'essai hors dépôt) contre un serveur Kasbah en
simulation : appairage par le code, lecture des quatre types avec états concordants, commandes
contrôleur vers Kasbah (allumer, luminosité, éteindre, position du portail, déverrouiller), changements
Kasbah vers contrôleur (luminosité, portail en mouvement, verrouillage), publication et retrait à chaud
depuis la carte, passage automatique de la carte à « Appairé ». Tests : `mapping.test.ts`, test
d'intégration `GET/PATCH /api/matter`, `MatterCard.test.ts` ; suite complète verte à la livraison.

**Non joué** : la disponibilité (`reachable`) transmise ; aucun vrai Alexa, Google ou Apple ; pas
d'essai sur la vraie maison.

## Restant

Essai avec un vrai assistant ; skill personnalisée (questions vers l'assistant de Kasbah) ; piloter un
Echo (sens Kasbah vers Alexa) ; éventuellement clim Tesla en thermostat et automatisations en
interrupteurs.
