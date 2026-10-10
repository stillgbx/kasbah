# Philips Hue

| | |
|---|---|
| **Id** | `hue` |
| **Appareils** | lampes (`light`), et en option les pièces Hue comme lampes de groupe |
| **Connexion** | **locale** : API CLIP v2 du bridge, sur le réseau de la maison |
| **Compte** | aucun compte en ligne : une clé d'application obtenue en appuyant sur le bouton du bridge |
| **Vues** | Maison (pilules 3D, panneau pièce), Lumières, Réglages → Plugins |

![Vue Lumières](../screenshots/lights.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Lampes** : allumer, éteindre, luminosité, blanc chaud / froid (selon la lampe), couleur (selon la lampe).
- **Effets de lampe** proposés par le bridge (bougie, feu, prisme, scintillement…), quand la lampe les accepte.
- **Ambiances** (scènes Hue) : liste par pièce ou zone, avec leurs pastilles de couleur ; rappel **fixe** ou **animé** (palette qui défile), extinction de l'ambiance. Créer une ambiance pour une pièce depuis Kasbah, et régler « démarrer l'animation automatiquement ».
- **Temps réel** : tout changement fait ailleurs (app Hue, interrupteur mural, autre écran) s'affiche aussitôt, par le flux d'événements du bridge.
- **Placement automatique** : une lampe non déclarée dans le fichier de la maison se place dans la pièce de la maison qui porte **le même nom** que sa pièce Hue. Sinon, elle reste pilotable dans la vue Lumières, signalée « non placée ».
- Option : exposer chaque **pièce Hue** comme une lampe de groupe (`HUE_EXPOSE_ROOMS=true`).

## Connexion

Tout passe par le réseau local : le serveur Kasbah parle directement au bridge en HTTPS (certificat du bridge auto-signé par Signify, accepté pour ce seul client). Aucun appel au cloud Philips, sauf la recherche du bridge si son adresse n'est pas connue.

## Mise en route

1. Cocher **Hue** dans **Réglages → Plugins**.
2. Sans `HUE_BRIDGE_HOST`, le bridge est cherché par `discovery.meethue.com` ; son adresse apparaît dans le journal du serveur. La recopier ensuite dans `.env` (et lui fixer un bail DHCP).
3. Le plugin passe en **« Appairage requis »**. Dans la section Hue de Réglages → Plugins : appuyer sur le **bouton rond du bridge**, puis dans les 30 s sur **Appairer le bridge**.
4. La clé s'affiche et sert tout de suite. La recopier dans `apps/server/.env` (`HUE_APP_KEY=…`) pour qu'elle survive au redémarrage : le serveur n'écrit jamais ce fichier.

Une clé perdue se remplace par le même geste (**Réappairer le bridge**).

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `HUE_BRIDGE_HOST` | — (découverte) | Adresse IP du bridge |
| `HUE_APP_KEY` | — | Clé d'application issue de l'appairage |
| `HUE_EXPOSE_ROOMS` | `false` | Expose aussi les pièces Hue comme lampes de groupe |
| `HUE_TLS_INSECURE` | `true` | Accepte le certificat auto-signé du bridge |

## Limites

- La découverte en ligne est limitée par Philips (environ un appel par quart d'heure) : fixer l'adresse.
- Débit : le bridge accepte une dizaine de commandes par seconde ; pendant un glissement de curseur, seule la dernière valeur part.
- Une lampe ne peut pas recevoir effet et couleur à la fois : l'effet prime.

## Pour aller plus loin

Fonctionnement interne, mappage et pièges : [wiki, Philips Hue](../../doc/3_plugins/3_1_philips-hue.md).
