# IKEA DIRIGERA — TRÅDFRI et Matter par le hub, écrit sans hub

> Dernière mise à jour : 2026-11-06
> Sources : `apps/server/src/plugins/dirigera/{index,client,socket,mapping,types}.ts`,
> `apps/server/src/plugins/dirigera/{mapping,plugin,socket}.test.ts`, `__fixtures__/hub.ts`,
> `apps/server/src/plugins/index.ts`, `apps/server/src/plugins/home_assistant/mapping.ts` (`NATIVE_PLUGIN`),
> `apps/server/src/http/rights.ts` (`PLUGIN_RIGHTS`),
> `apps/server/.env.example`, `docs/plugins/dirigera.md`, paquet npm `dirigera` 2.0.2 (lu, pas utilisé)

## Origine et intention

Demande du 2026-11-06 : préparer IKEA TRÅDFRI et SYMFONISK **avant d'avoir le matériel**. Deux
réponses différentes :

- **SYMFONISK = Sonos.** Mêmes firmware et protocole (UPnP :1400, SSDP `ZonePlayer`) : le plugin Sonos
  (`3_15_sonos.md`) les prend sans filtre de modèle. Rien à écrire. La lampe SYMFONISK n'est pas pilotée
  par Sonos (simple interrupteur, ou ampoule connectée → TRÅDFRI).
- **TRÅDFRI = Zigbee derrière une passerelle.** Voie retenue : le **hub DIRIGERA** (actuel) et son API
  locale. Écartées : l'ancienne passerelle TRÅDFRI E1526 (CoAP + DTLS, plus vendue) ; les ampoules
  appairées au pont Hue (zéro code, mais télécommandes, stores et capteurs IKEA y marchent mal) ;
  Home Assistant comme intermédiaire. La gamme Matter-over-Thread d'IKEA passe aussi par DIRIGERA
  (contrôleur Matter) ; le pont Matter de Kasbah (`../1_architecture/1_17_pont-matter.md`) ne fait que
  **publier**, il ne pilote pas.

## Bibliothèque lue, pas utilisée

Le paquet npm `dirigera` (lpgera, MIT, 2.0.2) existe. Il n'est **pas** une dépendance : il tire `got`,
`commander`, `mdns-server`, `reconnecting-websocket` pour une poignée d'appels, et les plugins du dépôt
gardent leur propre client (délais bornés, épinglage TLS, horloge injectable). Il a servi de
**référence** : le plugin, d'abord écrit de mémoire, a été confronté à ses sources le jour même.
Ce que la lecture a confirmé, et ce qu'elle a corrigé :

| Point | Confirmé par la bibliothèque | Corrigé |
|---|---|---|
| API `https://<hub>:8443/v1`, `GET /devices`, `PATCH /devices/<id>` (corps = tableau) | oui | |
| Une famille d'attributs par écriture ; teinte + saturation ensemble ; `transitionTime` | oui | |
| Store : `blindsTargetLevel` **0 = ouvert, 100 = fermé** (README), `blindsState` up/down/stopped | oui | |
| Appairage PKCE S256, `audience=homesmart.local`, échange du code après le bouton | oui | il réessaie sur **toute** erreur pendant 60 s, pas seulement 401/403 |
| WebSocket `wss://<hub>:8443/v1`, `Authorization: Bearer` | oui | le maintien est un **message JSON `type: 'ping'`** toutes les 30 s, pas un ping WebSocket |
| `deviceStateChanged` = delta | oui | il porte aussi `room`, `isHidden`, `capabilities`, désormais fusionnés |
| Capteurs d'air | | `currentCO2` (ALPSTUGA) ajouté |

## Principe

- `discover()` sans réseau ; `start()` lit `GET /devices` puis ouvre le WebSocket. Chaque
  `deviceStateChanged` est **fondu dans le dernier état complet** de l'appareil (`mergeEvent`), puis
  l'état Kasbah est recalculé de l'état complet. Ajout, retrait, pièce, configuration (`device*`,
  `room*` hors état) → relecture complète différée de 1,5 s. Reconnexion → relecture.
- Une coupure du WebSocket grise tout (`setAvailable('*', false)`) ; `isReachable: false` grise
  l'appareil et ses mesures.
- Une commande = une suite de PATCH, un par famille, dans l'ordre (allumer avant de régler). La
  promesse se résout à l'**accusé** (202) : l'effet n'est pas vérifié (leçon iRobot, `3_2`).

| Appareil du hub | Kasbah |
|---|---|
| `light` | `light` : `on_off`, `brightness` (1-100), `color_temp` (plage triée, le hub nomme `Min` le plus froid), `color` (teinte/saturation ↔ xy) ; `colorMode` décide entre couleur et blanc |
| `outlet` | `light` à `on_off` seul (comme les prises du pont Hue) + `<id>.power` (W) et `<id>.energy` (kWh) liés (`linkedTo`) si elle mesure (INSPELNING) |
| `blinds` | `cover` classe `blind` : `open_close`, `position` (= 100 − niveau du hub), `stop`, `battery` |
| tout appareil portant une mesure | un `sensor` par mesure : température, humidité, PM2.5, CO₂, luminosité (`<id>.<mesure>`) |
| télécommandes, enceintes (`speaker`), détecteurs de mouvement / ouverture / fuite, purificateur, `isHidden` | rien (voir Reste à faire) |

Appairage : `POST /api/plugins/dirigera/pair` demande le code puis réessaie l'échange toutes les 2 s
pendant 60 s : on appuie sur le bouton d'action du hub dans cette minute. Le jeton (sans expiration)
est écrit dans `DIRIGERA_TOKEN_FILE` (0600, `.state/dirigera-token.json` par défaut) et n'est jamais
renvoyé par la route. Réappairer efface l'épinglage du certificat. Droits (`http/rights.ts`) : domaine
`lights`, et `pair` est une écriture de Réglages, comme pour Hue.

TLS : le certificat du hub est **épinglé à la première connexion** (`core/tls-pin.ts`), pour HTTP
(undici) comme pour le WebSocket (`createConnection` de `ws` → `pinnedTlsConnect`, la poignée de main
et son jeton ne partent qu'après la vérification). La bibliothèque, elle, valide contre une **autorité
racine IKEA** embarquée (« IKEA Home smart Root CA », `checkServerIdentity` désactivé) : alternative
plus forte que l'épinglage, non retenue pour rester sur le patron des autres appareils du LAN (Hue
épingle aussi malgré l'autorité Signify). À reconsidérer avec un vrai hub.

Doublons : `dirigera_platform` (intégration HA communautaire) → `dirigera` dans `NATIVE_PLUGIN`.

## Vérifié, et non joué

- **Vérifié** : 30 tests (mappage, plugin avec faux hub et faux WebSocket, appairage avec et sans
  bouton) ; le **vrai** `ws` contre un vrai serveur TLS auto-signé (`socket.test.ts`) : jeton reçu,
  certificat appris, et rien d'écrit quand le certificat a changé. Typecheck et lint du serveur.
- **Non joué** (aucun hub) : tout ce qui touche le vrai matériel. Les fixtures sont **reconstruites**
  des types de la bibliothèque, pas capturées : à remplacer par une capture anonymisée de
  `GET /v1/devices` et du WebSocket dès l'appairage (leçons TaHoma et COMAP, `3_2`).

## À vérifier sur le premier hub

1. Statut HTTP de l'échange du jeton avant l'appui (réessayé quel qu'il soit, mais à noter).
2. Le hub accepte-t-il un PATCH à plusieurs familles ? (sinon garder la suite actuelle).
3. Débit accepté pendant un glissé de curseur : aucune file de remplacement comme celle de Hue.
4. `blindsState: 'stopped'` arrête-t-il vraiment un store en mouvement ?
5. `colorTemperatureMin` / `Max` dans le sens annoncé ; l'arrondi teinte/saturation.
6. L'épinglage face au certificat réel (ou passer à l'autorité IKEA).
7. Ce que publient les appareils Matter appairés au hub.

## Reste à faire

- Carte d'appairage dans Réglages (comme `HuePairingCard.vue`) : aujourd'hui, la route seule.
- Détecteurs de mouvement, d'ouverture et de fuite : le contrat n'a pas de capteur tout-ou-rien ;
  `remotePressEvent` (appui de télécommande) pourrait nourrir les automatisations.
- Purificateur STARKVIND (`fan` ?), scènes du hub (`/v1/scenes`), découverte mDNS du hub.
- Capture du premier hub : remplacer les fixtures, corriger `docs/plugins/dirigera.md` (page
  utilisateur, avertissement « not yet tried on a real hub ») et la ligne des README.
