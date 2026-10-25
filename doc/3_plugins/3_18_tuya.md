# Tuya — ventilateur-lumière CREATE (protocole local 3.5)

> Dernière mise à jour : 2026-10-25
> Sources : `apps/server/src/plugins/tuya/{index,client,mapping,types}.ts`,
> `apps/server/src/plugins/tuya/__fixtures__/tuya.ts` (trames capturées),
> `tools/tuya-probe.mts`, `tools/tuya-capture/`,
> plan `_generated-ai-doc/sessions/2026-09-21-ventilateur-create/plan-implementation.md`

Appareil de référence : **un ventilateur de plafond CREATE** (`Windcalm-Windstylance Not dimmable`, catégorie
Tuya `fsd`, product id `xxxxxxxxxxxxxxxx`), adresse `192.168.1.56`, TCP **6668**, protocole **3.5**
(`tuyapi` 7.7.1). Tout ce qui suit a été **mesuré** en lecture et en écriture le 2026-09-21.

## Pourquoi du local, et pourquoi pas de découverte

Après la clé locale (relevée une fois sur iot.tuya.com), **plus rien ne sort du réseau**. Même
famille que Roomba / Sonos / COMAP, pas que PetKit.

La découverte par broadcast UDP Tuya (ports 6666 / 6667 / 7000) est **inutilisable** sur ce réseau : plus
d'une minute d'écoute, zéro paquet, y compris au démarrage du module — alors que le mDNS et le SSDP
remontent des sources. Le multicast passe ; le broadcast `255.255.255.255` de Tuya non (filtre du
point d'accès). **Conséquence : adresse en configuration + bail DHCP statique. Pas de `discover`
réseau.**

## Deux appareils, un objet physique

Le contrat ne couvre pas un ventilateur avec `climate.fan_mode`. Nouveau kind **`fan`**, et la
lumière reste un `light` — **aucune commande commune** (précédent PetKit). Le ventilateur déclare
`meta.linkedTo` vers la lumière. L'UI les rend ensemble dans la vue Lumières
(`LightControl` + section ventilateur ; un ventilateur seul a sa propre carte).

Noms dérivés du nom PHYSIQUE de config (« Ventilateur plafonnier chambre 2 ») :
- fan → « Ventilateur chambre 2 »
- light → « Plafonnier chambre 2 »

La pièce vit dans `house.json` — ne pas l'injecter dans le nom du plugin.

## Les 7 DP (tous vérifiés R/W)

| DP | Rôle | Valeurs |
|---|---|---|
| 20 | lumière on/off | booléen |
| 23 | température de couleur | **0 = 4000 K (froid), 500 = 3300 K, 1000 = 2700 K (chaud)** seulement — sens mesuré sur le CREATE, inverse d'une échelle Kelvin naïve |
| 60 | ventilateur on/off | booléen |
| 62 | vitesse | entier **1 à 6** |
| 63 | sens | `"forward"` / `"reverse"` |
| 64 | minuterie | **minutes** restantes (1 h → 59, 2 h → 119, 4 h → 239) |
| 66 | mute (bip d'accusé) | booléen, `true` = silencieux |

Module LED : ⌀130 mm, 18 W, `3CCT`, **Non Dimming**. La température de couleur **ne peut pas**
servir d'atténuateur (courant constant) — ne pas rouvrir.

`meta.colorTempMirekSteps: [370, 303, 250]` (mirek) : liste, pas plage — l'appareil **accepte**
puis **ignore** toute valeur intermédiaire (mesuré : 250, 750, 137). Même raisonnement que
`meta.petFeeder.portions`.

## Six pièges mesurés

1. **Écrire `dp 62` ALLUME le ventilateur** (`dp 60` passe à `true`). Le patch optimiste UI pose
   `on: true` quand on règle la vitesse.
2. **L'accusé de réception ment.** Ne jamais valider une commande dessus — attendre l'état
   republé (`data` / `dp-refresh`). Le plugin refuse les températures hors crans
   (`UNSUPPORTED_COMMAND`) plutôt que de laisser l'appareil les avaler.
3. **Interroger un DP isolé (`get({dps})`) fait décrocher** (`ECONNRESET`). S'abonner, jamais
   sonder.
4. **L'état complet arrive à la connexion** (`issueRefreshOnConnect: true`). Rien à demander.
5. **La connexion tombe sans prévenir** — boucle de reconnexion (~700 ms) obligatoire.
6. **Éteindre le ventilateur remet `dp 64` à 0** : la minuterie lui est liée.

Les changements faits à la **télécommande RF** sont publiés sur le réseau : pas de risque de
désynchronisation.

`mute` sur un `fan` coupe le **bip d'accusé**, pas le son d'un lecteur — double sens de la
capacité, documenté dans `kinds.ts`.

## Configuration

```
TUYA_DEVICES=[{"id":"…","key":"…","ip":"192.168.1.56","name":"Ventilateur plafonnier chambre 2"}]
TUYA_COMMAND_TIMEOUT_MS=8000
TUYA_RECONNECT_MS=700
```

*(Complété le 2026-10-06 : chaque appareil de `TUYA_DEVICES` accepte un champ facultatif `version`, par défaut `3.5` — `apps/server/src/plugins/tuya/types.ts`.)*

La clé locale fait 16 caractères et contient des caractères spéciaux — **jamais** en CLI ni en
log. Ne pas réappairer le ventilateur (régénère la clé).

Routes : `GET /api/plugins/tuya/raw` — état brut des DP. Enveloppe d'erreur
`{ error: { code, message } }`.

Sonde : `npx tsx --env-file=apps/server/.env tools/tuya-probe.mts`.

## Structure du plugin

`index.ts` (cycle de vie), `client.ts` (tuyapi injectable + reconnexion), `mapping.ts` (pur),
`types.ts`, fixtures capturées, tests. Fabrique déclarée dans `apps/server/src/plugins/index.ts`.

### Mise à jour 2026-09-21 (bis) — fabricant affiché, CCT confirmé

`meta.manufacturer` : **`CREATE / Tuya`** (marque appareil + protocole), pas seulement `CREATE`.
DP 23 confirmé en usage réel : **0 = 4000 K (froid), 1000 = 2700 K (chaud)** — voir tableau
ci-dessus (corrigé après inversion constatée dans l'UI).

### Mise à jour 2026-10-25 — la santé dit pourquoi la connexion échoue

Symptôme rencontré sur la vraie maison : le plugin dit l'appareil indisponible, **l'application
Tuya le dit en ligne**. Les deux ne se contredisent pas : l'application passe par le cloud Tuya, il
suffit au ventilateur d'avoir internet ; Kasbah a besoin de le joindre **en local**, TCP 6668. Un
ventilateur passé sur un autre segment (réseau invité ou IoT, isolation des clients au point
d'accès) reste en ligne dans l'application et disparaît pour Kasbah.

Jusqu'ici l'échec de `connect()` n'allait qu'au niveau `debug` et `lastError` n'était jamais rempli :
la santé disait seulement « no Tuya device connected ». Désormais :

- `DeviceSession` (`client.ts`) appelle `onConnectError(message)` à chaque tentative ratée et logue
  en **`warn` une fois par raison nouvelle** (IP + message, jamais la clé) ; les reprises toutes les
  ~700 ms pour la même raison restent en `debug`. Une connexion réussie remet la raison à zéro, un
  nouvel échec reprévient.
- Le plugin (`index.ts`) garde la dernière erreur **par appareil** (`connectErrors`), effacée à la
  connexion. Détail de santé : `<nom>: <message>`, ajouté après « x/y connectés » si une partie
  seulement répond.

Lecture du message : `EHOSTUNREACH` ou délai dépassé → injoignable sur le réseau (adresse, segment,
point d'accès) ; `ECONNREFUSED` → joignable mais refuse ; erreur de déchiffrement ou de poignée de
main → la clé locale a changé (réappairage).
