# Index du wiki Kasbah

Catalogue de toutes les pages. Lire `SCHEMA.md` avant toute modification.

Index à deux niveaux : chaque section ne donne ici que les titres et dates de ses pages, bloc généré par
`scripts/wiki-index.mjs`. Les **résumés** sont dans le catalogue du `README.md` de la section : le lire
pour choisir une page.

## 0 — Overview

<!-- section:0_overview:begin (généré par scripts/wiki-index.mjs depuis 0_overview/README.md - ne pas éditer ici) -->
Vision du projet, principes structurants et vocabulaire commun. Résumés : [0_overview/README.md](0_overview/README.md) (2 pages, dernière mise à jour 2026-10-07).

| Pages | Dernière mise à jour |
|---|---|
| [0_0 Vision et principes](0_overview/0_0_vision-et-principes.md) | 2026-10-07 |
| [0_1 Glossaire](0_overview/0_1_glossaire.md) | 2026-10-06 |
<!-- section:0_overview:end -->

## 1 — Architecture

<!-- section:1_architecture:begin (généré par scripts/wiki-index.mjs depuis 1_architecture/README.md - ne pas éditer ici) -->
Monorepo, contrat partagé des appareils, serveur et plugins, protocole REST/WebSocket, application web, scène 3D, et les briques transverses : lecteur musique, MCP, automatisations, assistant, liste de courses. Résumés : [1_architecture/README.md](1_architecture/README.md) (15 pages, dernière mise à jour 2026-10-22).

| Pages | Dernière mise à jour |
|---|---|
| [1_0 Monorepo et flux de données](1_architecture/1_0_monorepo-et-flux.md) | 2026-10-20 |
| [1_1 Contrat des appareils](1_architecture/1_1_contrat-appareils.md) | 2026-10-21 |
| [1_2 Serveur et hôte de plugins](1_architecture/1_2_serveur-et-plugins.md) | 2026-10-11 |
| [1_3 Protocole REST et WebSocket](1_architecture/1_3_protocole-rest-ws.md) | 2026-10-22 |
| [1_4 Application web : stores, transport, routage](1_architecture/1_4_app-web.md) | 2026-10-06 |
| [1_5 Scène 3D (Three.js)](1_architecture/1_5_scene-3d.md) | 2026-10-13 |
| [1_6 Lecteur musique commun](1_architecture/1_6_lecteur-musique.md) | 2026-10-09 |
| [1_7 Serveur MCP](1_architecture/1_7_serveur-mcp.md) | 2026-10-20 |
| [1_8 Automatisations](1_architecture/1_8_automatisations.md) | 2026-10-15 |
| [1_9 Assistant (« Demander à Kasbah »)](1_architecture/1_9_assistant.md) | 2026-10-11 |
| [1_10 Liste de courses](1_architecture/1_10_liste-de-courses.md) | 2026-10-11 |
| [1_11 Scène 3D : rendu](1_architecture/1_11_scene-3d-rendu.md) | 2026-10-22 |
| [1_12 Scène 3D : objets dessinés](1_architecture/1_12_scene-3d-objets.md) | 2026-10-21 |
| [1_13 Comptes et sessions](1_architecture/1_13_comptes-et-sessions.md) | 2026-10-13 |
| [1_14 Énergie](1_architecture/1_14_energie.md) | 2026-10-13 |
<!-- section:1_architecture:end -->

## 2 — Maison

<!-- section:2_maison:begin (généré par scripts/wiki-index.mjs depuis 2_maison/README.md - ne pas éditer ici) -->
La maison décrite en JSON : format et validation, géométrie dérivée (murs, ouvertures, sols, toit), jardin. Résumés : [2_maison/README.md](2_maison/README.md) (3 pages, dernière mise à jour 2026-10-20).

| Pages | Dernière mise à jour |
|---|---|
| [2_0 Format house.json : décisions et validation](2_maison/2_0_format-house-json.md) | 2026-10-20 |
| [2_1 Géométrie : murs, ouvertures, sols, toit](2_maison/2_1_geometrie.md) | 2026-10-06 |
| [2_2 Jardin : arbres, buissons, pierres](2_maison/2_2_jardin.md) | 2026-10-06 |
<!-- section:2_maison:end -->

## 3 — Plugins

<!-- section:3_plugins:begin (généré par scripts/wiki-index.mjs depuis 3_plugins/README.md - ne pas éditer ici) -->
Un plugin par fabricant ou par service : le socle (simulation, écrire un plugin), puis chaque intégration, ses contraintes, ses pièges et ce qui a été vérifié sur du vrai matériel. Résumés : [3_plugins/README.md](3_plugins/README.md) (27 pages, dernière mise à jour 2026-10-21).

| Socle | Dernière mise à jour |
|---|---|
| [3_0 Simulation (mock-sim et plugin mock)](3_plugins/3_0_simulation-mock.md) | 2026-10-14 |
| [3_2 Écrire un plugin](3_plugins/3_2_ecrire-un-plugin.md) | 2026-10-20 |
| [3_3 Fabricants à venir](3_plugins/3_3_fabricants-a-venir.md) | 2026-10-06 |

| Intégrations | Dernière mise à jour |
|---|---|
| [3_1 Philips Hue](3_plugins/3_1_philips-hue.md) | 2026-10-02 |
| [3_4 Somfy TaHoma](3_plugins/3_4_somfy-tahoma.md) | 2026-10-14 |
| [3_5 Google Nest (caméras, sonnettes)](3_plugins/3_5_google-nest.md) | 2026-10-21 |
| [3_6 Google Cast](3_plugins/3_6_google-cast.md) | 2026-10-12 |
| [3_7 Enphase](3_plugins/3_7_enphase.md) | 2026-10-15 |
| [3_8 Tesla (Fleet API)](3_plugins/3_8_tesla.md) | 2026-10-20 |
| [3_9 Renault (Gigya + Kamereon)](3_plugins/3_9_renault.md) | 2026-10-19 |
| [3_10 Open-Meteo](3_plugins/3_10_open-meteo.md) | 2026-10-09 |
| [3_11 Husqvarna Automower](3_plugins/3_11_husqvarna-automower.md) | 2026-10-14 |
| [3_12 COMAP Proteo 2](3_plugins/3_12_comap-proteo.md) | 2026-10-06 |
| [3_13 Mitsubishi MELCloud](3_plugins/3_13_mitsubishi-melcloud.md) | 2026-10-21 |
| [3_14 iRobot (Roomba)](3_plugins/3_14_irobot-roomba.md) | 2026-10-06 |
| [3_15 Sonos](3_plugins/3_15_sonos.md) | 2026-10-02 |
| [3_16 YouTube Music (non officiel)](3_plugins/3_16_ytmusic.md) | 2026-10-20 |
| [3_17 PetKit](3_plugins/3_17_petkit.md) | 2026-10-06 |
| [3_18 Tuya (ventilateur CREATE)](3_plugins/3_18_tuya.md) | 2026-10-06 |
| [3_19 Radios (radio-browser.info)](3_plugins/3_19_radio.md) | 2026-10-07 |
| [3_20 Mixcloud](3_plugins/3_20_mixcloud.md) | 2026-10-08 |
| [3_21 TENS actiTENS mini (Web Bluetooth)](3_plugins/3_21_actitens-tens.md) | 2026-10-06 |
| [3_22 Agenda (adresse iCal secrète)](3_plugins/3_22_agenda.md) | 2026-10-09 |
| [3_23 TouteMonAnnée](3_plugins/3_23_toutemonannee.md) | 2026-10-19 |
| [3_24 Claude (moteur de l'assistant)](3_plugins/3_24_claude.md) | 2026-10-11 |
| [3_25 Transcription (la voix de l'assistant)](3_plugins/3_25_transcription.md) | 2026-10-12 |
| [3_26 Hörmann (portes de garage)](3_plugins/3_26_hormann.md) | 2026-10-21 |
<!-- section:3_plugins:end -->

## 4 — UI

<!-- section:4_ui:begin (généré par scripts/wiki-index.mjs depuis 4_ui/README.md - ne pas éditer ici) -->
Interface : langage visuel, navigation et panneaux de la vue Maison, thèmes et langues, puis une page par famille de vues. Résumés : [4_ui/README.md](4_ui/README.md) (9 pages, dernière mise à jour 2026-10-21).

| Socle | Dernière mise à jour |
|---|---|
| [4_0 Langage visuel](4_ui/4_0_langage-visuel.md) | 2026-10-06 |
| [4_1 Navigation et panneaux](4_ui/4_1_navigation-et-panneaux.md) | 2026-10-21 |
| [4_2 Thème et langues](4_ui/4_2_theme-et-langues.md) | 2026-10-06 |

| Vues | Dernière mise à jour |
|---|---|
| [4_3 Vues Lumières, Ouvrants et Caméras](4_ui/4_3_vues-lumieres-ouvrants-cameras.md) | 2026-10-20 |
| [4_4 Vues Énergie et Véhicules](4_ui/4_4_vues-energie-vehicules.md) | 2026-10-19 |
| [4_5 Musique et médias](4_ui/4_5_musique-et-medias.md) | 2026-10-13 |
| [4_6 Autres vues](4_ui/4_6_autres-vues.md) | 2026-10-21 |
| [4_7 Vue Réglages](4_ui/4_7_reglages.md) | 2026-10-13 |
| [4_8 Mode édition et propriétés](4_ui/4_8_mode-edition-et-proprietes.md) | 2026-10-21 |
<!-- section:4_ui:end -->

## 5 — Setup

<!-- section:5_setup:begin (généré par scripts/wiki-index.mjs depuis 5_setup/README.md - ne pas éditer ici) -->
Installer, configurer et mettre en production. Résumés : [5_setup/README.md](5_setup/README.md) (3 pages, dernière mise à jour 2026-10-20).

| Pages | Dernière mise à jour |
|---|---|
| [5_0 Installation et scripts](5_setup/5_0_installation-et-scripts.md) | 2026-10-20 |
| [5_1 Configuration (.env)](5_setup/5_1_configuration-env.md) | 2026-10-10 |
| [5_2 Production](5_setup/5_2_production.md) | 2026-10-13 |
<!-- section:5_setup:end -->

## 6 — FAQ

<!-- section:6_faq:begin (généré par scripts/wiki-index.mjs depuis 6_faq/README.md - ne pas éditer ici) -->
Pièges rencontrés et recettes : une entrée datée par incident (Date / Symptôme / Diagnostic / Solution). Résumés : [6_faq/README.md](6_faq/README.md) (2 pages, dernière mise à jour 2026-10-13).

| Pages | Dernière mise à jour |
|---|---|
| [6_0 Pièges d'outillage](6_faq/6_0_pieges-outillage.md) | 2026-10-13 |
| [6_1 Pièges à l'exécution](6_faq/6_1_pieges-runtime.md) | 2026-10-13 |
<!-- section:6_faq:end -->
