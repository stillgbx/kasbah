# Hörmann — portes de garage SupraMatic série 4 (pont HCPBridgeMqtt)

> Dernière mise à jour : 2026-10-21
> Sources : `apps/server/src/plugins/hormann/{index,client,mapping,types}.ts`,
> `apps/server/src/plugins/hormann/__fixtures__/status.ts`, firmware HCPBridgeMqtt v1.0.2
> (`HCPBridgeESP32/src/{main.cpp,hoermann.h,configuration.h}`), notice Hörmann 4511191 (montage)

Matériel de référence : un moteur **SupraMatic P série 4**, un pont **M5Stack Atom Lite + Atomic RS485
Base** flashé avec HCPBridgeMqtt 1.0.2 (environnement PlatformIO `m5stack-atom-lite`, compilé soi-même :
aucun binaire publié pour cette carte). Raccordement et scan du bus **vérifiés sur la vraie porte** le
2026-10-21 ; le plugin, lui, n'a pas encore tourné contre le vrai pont (voir « Reste à faire »).

## Pourquoi un pont sur le bus

Hörmann n'a **aucune API publique**, et BlueSecur est du Bluetooth direct téléphone → moteur, sans
cloud : pas de piste par le compte. Le moteur série 4 parle **HCP2** (Modbus RTU sur RS485) sur sa prise
**BUS** RJ12 ; un ESP32 s'y présente comme un accessoire UAP 1-HCP. Série 3 = autre protocole (HCP1,
projets hgdo / esphome-hoermann_supramatic_3), non couvert.

## Câblage et scan du bus (ce qui a coûté du temps)

- **RJ12 BUS** : 1-2 GND, 3 B−, 4 A+, 5-6 +24 V. Masse et 24 V sont doublés : un câble à **quatre fils
  centraux** (broches 2-5) suffit. Les couleurs d'un câble ne suivent aucune norme : partir des numéros
  de broches, jamais d'une couleur « logique » (le rouge du câble allait sur le bleu B du socle).
- La prise BUS est celle **collée au bornier à vis** ; celle d'à côté est l'entrée de sécurité SE (pont
  d'usine à ne jamais retirer). Bornier à vis (notice 4511191) : **20 = 0 V, 5 = +24 V**, 21 et 23 =
  entrées d'impulsion. Mesuré : 20 V entre 20 et 5.
- **0 V sur la prise BUS au repos est NORMAL** : le moteur n'alimente le bus que **pendant un scan**, et
  ne le garde que si un accessoire répond. Mesurer le sens du 24 V **pendant** un scan à vide (+22 V
  relevés). On a d'abord cru à un câble mort.
- **Scan** : PRG maintenu jusqu'à `00`, flèches jusqu'au menu **37**, PRG bref, paramètre **01**, PRG
  maintenu jusqu'à `bS` qui clignote. Résultat `1` = accessoire reconnu, `0` = rien. Le « P » des docs
  HCPBridge est la touche PRG. Débrancher un pont sans refaire de scan → erreur 04.
- **Broches série inversées par défaut** : le firmware émet sur G22 et lit sur G19 pour l'Atom Lite,
  mais l'Atomic RS485 Base attend l'inverse (exemple M5Stack, broches G5/G6 de l'AtomS3). Symptôme :
  scan à `0` même en permutant A et B, pont pourtant alimenté et joignable. Correctif sans reflasher :
  onglet **Expert**, **TX = 19, RX = 22**. Avec ce réglage, l'alimentation par le bus seul suffit (le
  pont démarre assez vite pour répondre au scan) ; l'alimentation par le bornier 5/20 reste un repli.
- L'Atom Lite **n'a pas de voyant d'alimentation** (sa LED RGB est pilotée par le firmware) : une LED
  éteinte ne prouve rien, un ping sur le réseau si.

## API HTTP du pont (lue dans le source du firmware)

| Route | Contenu |
|---|---|
| `GET /status` | JSON : `doorstate`, `currentPosition` / `targetPosition` (0-100), `light`, `busResponseAge` (s depuis le dernier échange du bus, −1 = jamais), `valid`, `swversion`, capteurs, E/S |
| `GET /command?action=N` | 0 fermer, 1 ouvrir, 2 stop, 3 ventilation, 4 mi-ouverture, 5 **bascule** lumière, 6 redémarrer, 7 position (`&position=`), 8 bascule porte. Répond **toujours** `200 OK` |
| `GET /events` | SSE des **capteurs et E/S seulement** : la porte n'y passe jamais |

Authentification Basic, utilisateur fixe `admin`, mot de passe de l'interface web (401 sans). La mise à
jour OTA (`/update`, ElegantOTA) est protégée par `admin` / `admin` **codé en dur** : n'importe qui sur
le réseau local peut reflasher le pont. Le firmware ouvre aussi par défaut un **point d'accès Wi-Fi**
(« Enable Wifi AP ») dont le mot de passe retombe sur `gifford47` s'il fait moins de 8 caractères : à
décocher une fois le pont sur le réseau.

`doorstate` vaut `open`, `closed`, `opening`, `closing`, `open h` (mi-ouverte), `opening h`, `opening v`
(vers la ventilation), `venting`, `stopped`.

## Choix du plugin

- **Sondage de `/status`** toutes les 2 s (`HORMANN_POLL_MS`), pas le SSE : `/events` ne porte pas la
  porte (seuls `sensor` et `io` y sont émis).
- **Deux appareils par porte** : `cover` (`meta.cover.deviceClass: 'garage'`, capacités `open_close`,
  `stop`, `position`) et `light` (`on_off`), **sans** `meta.linkedTo` *(corrigé le 2026-10-21 : le
  lien, copié de Tuya, masquait la lampe de la vue Lumières — `RoomBands hide-linked` cache tout
  accessoire, prévu pour être rendu avec son principal ; or la porte est dans le mur et ses LED au
  plafond)*.
  `externalId` = `<id>_door` / `<id>_light`, l'`id` étant choisi dans `HORMANN_DOORS`.
- **Disponibilité = fraîcheur du bus**, pas le drapeau `valid` (jamais remis à faux par le firmware) :
  `busResponseAge` entre 0 et 30 s. Un pont qui répond avec un bus muet (pas de scan, prise débranchée)
  rend la porte indisponible. Seuil de 30 s choisi, **pas encore mesuré** sur un bus coupé.
- **L'accusé ne prouve rien** : `/command` répond `OK` même quand le firmware laisse tomber la commande
  (une précédente pas encore lue par le bus, `stop` sur une porte au repos). `execute` relit `/status`
  toutes les 500 ms et ne résout que quand la porte **a commencé** le geste (ou la lumière a changé) ;
  sinon `UPSTREAM_ERROR` après `HORMANN_COMMAND_TIMEOUT_MS` (5 s, sous les 10 s de
  `KASBAH_COMMAND_TIMEOUT_MS`). Attendre la fin de course (15-20 s) dépasserait ce plafond. Test vu
  rouge en retirant l'attente.
- **Inversion = stop d'abord** : relevé sur la vraie porte, le moteur ignore une commande contraire au
  mouvement en cours (fermer pendant une ouverture ne fait rien ; le firmware, lui, l'envoie bien).
  `execute` relit la porte, envoie `stop` si elle va dans l'autre sens (`needsStopFirst`), attend
  qu'elle soit au repos (3 s au plus), puis envoie la commande. Délai entre l'arrêt et la reprise
  **pas encore mesuré** : si le moteur avale la commande envoyée juste après l'arrêt, c'est là qu'il
  faudra une pause. Test vu rouge sans le stop.
- **Lumière en bascule** : allumer une lampe allumée ne doit rien envoyer. La commande n'est traduite
  en bascule que si l'état lu diffère.
- Positions : le firmware transforme ≤ 5 % en fermeture et ≥ 95 % en ouverture complètes.
- Écarté pour l'instant : les positions mi-ouverture et ventilation du moteur (`cover.preset` n'en
  porte qu'une), la bascule de porte (action 8).

## Reste à faire

- **Fixture capturée** : `__fixtures__/status.ts` est écrit d'après le sérialiseur du firmware, pas
  relevé. Capturer `GET /api/plugins/hormann/raw` sur le vrai pont et l'anonymiser.
- Mesurer `busResponseAge` sur un bus débranché pour valider le seuil de 30 s.
- Deuxième porte (SupraMatic E4) : vérifier son année de fabrication, les E4 de 2025 ayant des trames
  que le pont ne décode pas.
