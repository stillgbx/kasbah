# Open-Meteo

| | |
|---|---|
| **Id** | `open_meteo` |
| **Appareils** | un appareil météo (`weather`), à la position de la maison |
| **Connexion** | **cloud, officielle** : API libre d'Open-Meteo, interrogée par le serveur |
| **Compte** | aucun : ni compte, ni clé, ni jeton |
| **Vues** | Météo, Maison (widget météo), alertes de vigilance, Réglages → Plugins |

## Ce que fait le plugin

- **Météo de la maison** : température et ressenti, conditions, vent et rafales, humidité, pression, indice UV, visibilité, point de rosée, risque de pluie, nébulosité, lever et coucher du soleil.
- **Prévisions** : les 24 prochaines heures et 7 jours.
- **Qualité de l'air** (indice européen EAQI) et **pollens** (aulne, bouleau, graminées, armoise, olivier, ambroisie), du programme européen Copernicus CAMS. Si ce service ne répond pas, la météo reste affichée sans ces deux blocs, qui reviennent à la lecture suivante.
- **Vigilance Météo-France** en cours sur le département de la maison, affichée dans les alertes. Elle vient du flux public MeteoAlarm, sans clé. Métropole seulement : ailleurs, la vigilance n'est pas affichée.
- **Météo ailleurs** : la vue Météo permet de chercher un autre lieu, de le garder en favori, d'en voir les prévisions et la vigilance.
- Côté assistant (MCP) : l'outil `get_weather` rend la météo, les prévisions, l'air, les pollens et la vigilance de la maison, ou d'un lieu cherché par son nom.
- **Radar de précipitations** dans la vue Météo : images observées (RainViewer), puis prévision AROME de Météo-France. Cette carte est chargée directement par le navigateur.

## Connexion

Le serveur Kasbah interroge `api.open-meteo.com` (prévisions) puis `air-quality-api.open-meteo.com` (air et pollens), toutes les 10 minutes par défaut : environ 300 appels par jour, très en deçà des 10 000 tolérés. Open-Meteo combine plusieurs modèles, dont AROME de Météo-France pour la France. Il n'y a rien en local et rien à configurer côté compte.

## Mise en route

1. Vérifier que la maison a une position géographique (`origin` dans le fichier de la maison) : c'est elle qui fixe l'endroit de la météo.
2. Cocher **Open Meteo** dans **Réglages → Plugins**.
3. C'est tout : l'appareil apparaît quelques secondes plus tard, le temps de la première lecture. Aucune variable à renseigner.

## Attribution

Les données Open-Meteo sont sous licence **CC BY 4.0**, pour un **usage non commercial** (gratuit jusqu'à 10 000 appels par jour). L'attribution « Open-Meteo.com » est affichée au pied de la vue Météo par Kasbah : à conserver si vous partagez une capture. Les vigilances sont publiées par Météo-France via MeteoAlarm (CC BY 4.0), et les images de radar par RainViewer.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `OPEN_METEO_POLL_MS` | `600000` | Cadence de lecture, de 60 000 à 3 600 000 ms. Les modèles se relancent à l'heure : plus souvent, on relit la même chose |

## Limites

- **Pas de commande** : c'est une source d'information, rien à piloter.
- Qualité de l'air et pollens : couverture **européenne** seulement (des tirets ailleurs).
- Vigilance : métropole seulement, jaune ou plus ; vert signifie « rien à signaler ».
- La position est arrondie par le service (environ un kilomètre) : la météo est celle du quartier, pas du jardin.
- Le radar AROME s'affiche même hors de sa zone de validité (France et pays voisins).
- Pas de prévisions en l'absence de réseau : la dernière lecture réussie reste affichée.

## Pour aller plus loin

Fonctionnement interne, mappage des codes météo et vigilance : [wiki, Open-Meteo](../../doc/3_plugins/3_10_open-meteo.md).
