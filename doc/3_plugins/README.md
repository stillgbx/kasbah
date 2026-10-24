# 3 — Plugins

> Dernière mise à jour : 2026-10-13
> Catalogue de la section : source unique de sa liste de pages, d'où `scripts/wiki-index.mjs` génère le bloc `3_plugins` de [`index.md`](../index.md). Historique de la section : `Grep 3_plugins/` dans [`log/`](../log/README.md).

Un résumé dit **ce que couvre** la page, en 350 caractères au plus, jamais ce qui a changé : l'historique
vit dans la page (sections datées) et dans le journal.

<!-- catalogue:begin -->
Un plugin par fabricant ou par service : le socle (simulation, écrire un plugin), puis chaque intégration, ses contraintes, ses pièges et ce qui a été vérifié sur du vrai matériel.

### Socle

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [3_0 Simulation (mock-sim et plugin mock)](3_0_simulation-mock.md) | Moteur de simulation partagé serveur / navigateur : horloge injectée, graine, comportements par kind, scénarios, émission, kinds simulés en sous-items cochables pour compléter un parc réel, maison de démo. | 2026-10-14 |
| [3_2 Écrire un plugin](3_2_ecrire-un-plugin.md) | Interface `DevicePlugin` et son contexte, erreurs, routes propres, parties (`parts`), quota d'une API facturée (`PluginHealth.quota`), marche à suivre et liste de contrôle tirée des vrais fabricants (fixtures capturées, flux d'événements, état remis à zéro dans `init`). | 2026-10-20 |
| [3_3 Fabricants à venir](3_3_fabricants-a-venir.md) | Squelettes déclarés et pistes d'API ; tableau vide depuis que tous les squelettes ont été implémentés, chaque fabricant gardant sa mémoire dans sa section datée ; leçon sur les fixtures inventées. | 2026-10-06 |

### Intégrations

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [3_1 Philips Hue](3_1_philips-hue.md) | API CLIP v2 locale : TLS auto-signé, découverte et appairage, flux d'événements SSE, mappage pur, limitation de débit, scènes (fixes et palettes animées) et effets de lampe. | 2026-10-24 |
| [3_4 Somfy TaHoma](3_4_somfy-tahoma.md) | API locale Overkiz du mode développeur (activée depuis l'appli mobile) : io-homecontrol et RTS distingués, événements en deltas, position inconnue d'un RTS, position favorite « my », pièges relevés sur la vraie box, volets solaires (luminosité, mode discret), rafales de commandes (file ou exécution groupée). | 2026-10-24 |
| [3_5 Google Nest (caméras, sonnettes)](3_5_google-nest.md) | API cloud Smart Device Management : prérequis Google, liaison du compte, mappage en `camera` et thermostat en `climate`, ce que l'API refuse, vidéo RTSP relayée en MSE, vignettes de la vue Caméras et budget de sessions, fixtures relevées. | 2026-10-24 |
| [3_6 Google Cast](3_6_google-cast.md) | Enceintes, réveils, Chromecast et barres de son par Cast v2 local : ce que le protocole permet, trame protobuf faite main, connexion TLS par appareil, volume fixe, nature déduite de l'annonce mDNS, mappage `media_player`, pochettes relayées, mise en route. | 2026-10-24 |
| [3_7 Enphase](3_7_enphase.md) | Production solaire, micro-onduleurs et batteries par l'API locale de la passerelle : jeton JWT d'un an sans mot de passe en configuration, appareils publiés, pièges révélés par la capture, cadences, borne de recharge par le cloud. | 2026-10-24 |
| [3_8 Tesla (Fleet API)](3_8_tesla.md) | Véhicules par la Fleet API cloud : clé publique sur un domaine HTTPS, API facturée (budget journalier, jamais de réveil automatique), véhicule qui dort, jetons à usage unique, fixtures, routes et côté web. | 2026-10-20 |
| [3_9 Renault (Gigya + Kamereon)](3_9_renault.md) | Véhicules par l'API privée de l'appli MY Renault faute de voie officielle : mot de passe saisi dans l'UI, Gigya qui refuse en HTTP 200, clés rotées, débit limité, capture et ses surprises, réveil de charge solaire, fragilités assumées. | 2026-10-24 |
| [3_10 Open-Meteo](3_10_open-meteo.md) | Météo au-dessus de la maison : pourquoi Open-Meteo, appareil `weather`, prévisions et qualité de l'air, mappage WMO, pollens, routes `places` / `at` / `alerts`, vigilance Météo-France par MeteoAlarm, lecture par le MCP. | 2026-10-09 |
| [3_11 Husqvarna Automower](3_11_husqvarna-automower.md) | Robot tondeuse par l'Automower Connect API : `client_credentials`, quota hebdomadaire de requêtes, WebSocket d'événements et resynchronisation REST, horodatages locaux, mappage `state` / `activity`, carte et GPS calés sur la maison, routes et côté web. | 2026-10-14 |
| [3_12 COMAP Proteo 2](3_12_comap-proteo.md) | Station de filtration d'eau, protocole reversé par capture (JSON ligne par ligne sur TCP/23, sans authentification, mono-session) : méthode de capture, pièges, ce qui n'est pas décodé, kind `water`, consommation, côté web et simulation. | 2026-10-06 |
| [3_13 Mitsubishi MELCloud](3_13_mitsubishi-melcloud.md) | Pompes à chaleur Ecodan par le cloud non officiel : mot de passe échangé une fois contre une `ContextKey`, ce que la capture a démenti (un appareil pour plusieurs PAC, zones, aucun compteur d'énergie), `ListDevices` plutôt que `Device/Get`, pièges, configuration. | 2026-10-21 |
| [3_14 iRobot (Roomba)](3_14_irobot-roomba.md) | Aspirateur par son courtier MQTT local (TLS) : mot de passe local obtenu une fois par le compte, découverte UDP, session unique, deltas et ombre accumulée, pièges de mappage, commande acceptée puis perdue, fixtures, configuration. | 2026-10-24 |
| [3_15 Sonos](3_15_sonos.md) | Enceintes par UPnP/SOAP local : relevé du réseau, un `media_player` par enceinte, transport sur le groupe et volume sur le lecteur, lecture d'URL, comportement d'un flux HTTP mis en pause, pochettes relayées, mise en route. | 2026-10-24 |
| [3_16 YouTube Music (non officiel)](3_16_ytmusic.md) | Source non officielle : cookie, catalogue `youtubei.js`, flux et PO Token, relais sans réencodage vers les enceintes, pilotage d'un flux (transfert, pause, saut) et modèles écartés, interface `/ytmusic`, routes, variables. | 2026-10-24 |
| [3_17 PetKit](3_17_petkit.md) | Mangeoires et fontaines par le cloud privé : connexion par code courriel et compte dédié, six pièges d'API, ce que le roster ne dit pas, mangeoire `d4`, fontaine `ctw3`, relais Bluetooth, ce que le plugin ne fait pas. | 2026-10-06 |
| [3_18 Tuya (ventilateur CREATE)](3_18_tuya.md) | Ventilateur-lumière par le protocole local Tuya 3.5 (`tuyapi`) : pas de découverte, `TUYA_DEVICES`, deux kinds liés pour un objet, les 7 DP vérifiés, six pièges mesurés, configuration. | 2026-10-06 |
| [3_19 Radios (radio-browser.info)](3_19_radio.md) | Radios par l'annuaire libre radio-browser.info : source sans appareil, recherche indépendante de l'ordre des mots, favorites de la maison et ajout par URL, flux `live`, qualité, santé, pièges. | 2026-10-07 |
| [3_20 Mixcloud](3_20_mixcloud.md) | Source du lecteur commun : compte = nom d'utilisateur (API publique), listes paginées, fil des suivis recomposé, flux yt-dlp relayé en m4a, reprise tenue par Kasbah, accueil recomposé, santé, limites. | 2026-10-08 |
| [3_21 TENS actiTENS mini (Web Bluetooth)](3_21_actitens-tens.md) | Premier plugin local au poste (Web Bluetooth, hors serveur) : protocole BLE rétro-conçu, file d'intensité consigne / acquis, appairage et reconnexion, favoris, tests sans l'appareil, limites connues. | 2026-10-06 |
| [3_22 Agenda (adresse iCal secrète)](3_22_agenda.md) | Agendas Google par l'adresse iCal secrète plutôt que l'API OAuth : stockage de l'adresse, lecture périodique des flux, déroulé des récurrences (`ical.js`), routes, ordre des agendas, lecture par le MCP. | 2026-10-24 |
| [3_23 TouteMonAnnée](3_23_toutemonannee.md) | Cahier de texte, cahier de liaison et publications par l'API privée de l'appli web : session par cookies, mot de passe utilisé une fois, case « fait », routes, vue École, outils MCP. | 2026-10-19 |
| [3_24 Claude (moteur de l'assistant)](3_24_claude.md) | Moteur de l'assistant par `claude -p` : forfait de chaque compte (`claude setup-token`), lancement verrouillé (outils, MCP, réglages, environnement), traduction de `stream-json`, santé, coût par instruction, pièges. | 2026-10-11 |
| [3_25 Transcription (la voix de l'assistant)](3_25_transcription.md) | Voix de l'assistant : micro et WAV 16 kHz faits par le navigateur, trois fournisseurs par la route OpenAI de transcription, vocabulaire de la maison, réponses parlées et choix des voix, texte réécrit pour la voix, drapeau Chrome du micro sur le LAN. | 2026-10-12 |
| [3_26 Hörmann (portes de garage)](3_26_hormann.md) | Portes SupraMatic série 4 par un pont HCPBridgeMqtt (ESP32 + RS485) sur le bus HCP2 : câblage RJ12, bus coupé hors scan, broches série inversées sur l'Atom Lite, API HTTP lue dans le firmware, sondage plutôt que SSE, disponibilité par la fraîcheur du bus, accusé qui ne prouve rien, lumière en bascule. | 2026-10-21 |
<!-- catalogue:end -->
