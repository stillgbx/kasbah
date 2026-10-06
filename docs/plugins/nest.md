# Google Nest

| | |
|---|---|
| **Id** | `nest` |
| **Appareils** | caméras, sonnettes et écrans à caméra (`camera`), thermostat (`climate`) |
| **Connexion** | **cloud, officielle** : API Smart Device Management (SDM) de Google, il n'existe pas d'API locale |
| **Compte** | un compte Google, un projet Google Cloud et un projet Device Access (5 USD, une fois) ; un jeton de rafraîchissement stocké dans `apps/server/.env` |
| **Vues** | Maison (panneau appareil, cadrage à la sonnerie), Caméras, Chauffage, Réglages → Plugins |

## Ce que fait le plugin

- **Caméras et sonnette** : image en **direct** dans le panneau de l'appareil (son en option, démarré en sourdine), avec environ 4 secondes de retard.
- **Vue Caméras** : une **vignette** par caméra, rafraîchie toutes les 10 secondes, et pour chaque tuile trois états : **Arrêté**, **Aperçu** (l'image et son âge), **Direct**. Trois directs simultanés au plus dans cette vue. L'en-tête compte les caméras « actives ».
- **Sonnette** (avec les événements Pub/Sub, voir plus bas) : quand on sonne, Kasbah revient sur la vue Maison, cadre la pièce de la sonnette et lance sa vidéo.
- **Thermostat** : température mesurée, humidité, consigne et mode (chauffage, arrêt, éco, selon ce que le thermostat propose), état de chauffe. La consigne se règle entre 9 et 32 °C, sauf en éco ou à l'arrêt où Google la refuse.
- **Placement automatique** : un appareil se place dans la pièce de la maison qui porte **le même nom** que sa pièce dans Google Home. Sinon il reste « non placé » et se place à la main depuis son panneau.

## Connexion

Tout passe par le cloud de Google : le serveur Kasbah interroge l'API SDM avec un jeton OAuth renouvelé automatiquement (il dure une heure). La liste des appareils est relue toutes les 60 secondes. Pour la vidéo, le serveur demande à Google un flux RTSP et le relaie au navigateur avec **ffmpeg**, sans ré-encodage (un ffmpeg par caméra regardée, à installer sur la machine du serveur, jamais sur l'écran).

Les caméras doivent être rattachées à un **compte Google** : un ancien compte Nest se migre d'abord.

## Mise en route

**Côté Google, une seule fois (environ 15 minutes) :**

1. Sur `console.cloud.google.com` : créer un projet, activer l'API **Smart Device Management**, puis créer un **ID client OAuth** de type **application web**. L'URI de redirection autorisée est exactement la valeur de `NEST_REDIRECT_URI`. Sur l'écran de consentement, s'ajouter comme utilisateur test, puis passer l'application **« In production »** : tant qu'elle reste en mode « Testing », Google fait expirer le jeton au bout de 7 jours et il faut tout relier (pour un usage personnel, Google affiche seulement un avertissement « application non vérifiée »).
2. Sur `console.nest.google.com/device-access` : accepter les conditions (**5 USD**, une fois) et créer un projet en y collant l'ID client OAuth de l'étape 1. L'identifiant du projet (un UUID, **pas** le nom du projet Google Cloud) est `NEST_PROJECT_ID`.

**Côté Kasbah :**

3. Dans `apps/server/.env` : `NEST_PROJECT_ID`, `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET` (et `NEST_REDIRECT_URI` si le serveur n'écoute pas sur le port 8787).
4. Cocher **Nest** dans **Réglages → Plugins**, et redémarrer le serveur. Le plugin passe en **« Appairage requis »**.
5. Dans la section Nest : **Lier le compte Google**. Le consentement Google s'ouvre dans un nouvel onglet : c'est là qu'on **choisit les caméras partagées** avec Kasbah.
6. Au retour, la page affiche `NEST_REFRESH_TOKEN=…`. La recopier dans `apps/server/.env` pour qu'elle survive au redémarrage : le serveur n'écrit jamais ce fichier. Le plugin fonctionne déjà ; **Actualiser** fait apparaître les caméras.

**Relier le compte à nouveau** (même bouton) pour changer les caméras partagées.

**Option, la sonnette en temps réel** : Google ne pousse la sonnerie que par Pub/Sub.

7. Dans le projet Google Cloud : activer la **facturation** (Pub/Sub l'exige ; le volume d'un foyer reste dans le quota gratuit, donc environ 0 €), activer l'API **Cloud Pub/Sub**, créer un **sujet** avec son abonnement par défaut de type **pull**.
8. Donner le droit **Pub/Sub Publisher** sur ce sujet au groupe `sdm-publisher@googlegroups.com`, puis saisir le sujet dans la console Device Access et **valider**.
9. Relier le compte à nouveau (la portée Pub/Sub est demandée à la liaison), et renseigner `NEST_PUBSUB_SUBSCRIPTION` avec le nom complet de l'abonnement, `projects/<projet-cloud>/subscriptions/<abonnement>`.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `NEST_PROJECT_ID` | — | UUID du projet Device Access |
| `NEST_CLIENT_ID`, `NEST_CLIENT_SECRET` | — | Client OAuth « application web » du projet Google Cloud |
| `NEST_REFRESH_TOKEN` | — | Jeton obtenu par la liaison du compte |
| `NEST_REDIRECT_URI` | `http://localhost:8787/api/plugins/nest/auth/callback` | À déclarer à l'identique dans le client OAuth |
| `NEST_POLL_MS` | `60000` | Relecture de la liste des appareils (10 s à 10 min) : Google borne les appels |
| `FFMPEG_PATH` | `ffmpeg` | Binaire ffmpeg du relais vidéo (dans le `PATH`, ou chemin complet) |
| `NEST_LIVE_BUDGET` | `10` | Sessions vidéo ouvertes en même temps, au plus (1 à 32) |
| `NEST_SNAPSHOT_MS` | `10000` | Cadence des vignettes de la vue Caméras (2 s à 2 min) |
| `NEST_PUBSUB_SUBSCRIPTION` | — | Abonnement Pub/Sub pull ; sans lui, aucun événement de sonnette |
| `NEST_PUBSUB_POLL_MS` | `5000` | Cadence de tirage des événements (1 s à 60 s) |

Une ligne laissée vide (`NEST_REFRESH_TOKEN=`) équivaut à « absente » et ne désactive pas le plugin.

## Limites

- **Pas d'allumage ni d'extinction d'une caméra** : l'API publique de Google n'expose pas ce réglage (l'appli Google Home passe par une API privée, non reprise ici).
- **Quota de Google** : quelques commandes par minute. Les sessions vidéo s'ouvrent donc une toutes les 8 secondes, avec une pause de 90 secondes si Google se plaint ; avec plus de caméras que `NEST_LIVE_BUDGET`, les vignettes **tournent**.
- **Vidéo en RTSP uniquement** : une caméra qui ne sert que du WebRTC apparaît dans les listes, mais sa vidéo n'est pas encore prise en charge.
- **Caméra éteinte** : l'API ne dit pas si une caméra est débranchée. Elle n'apparaît « inactive » qu'après un essai de flux qui échoue.
- Seule la **sonnerie** est remontée ; mouvement, personne et son sont reçus mais pas encore utilisés. Les détecteurs de fumée Nest Protect ne sont pas dans cette API.
- L'auto-placement ne connaît que les pièces : une caméra extérieure (garage, façade, toit) reste « non placée » tant qu'on ne la place pas à la main.
- Le serveur arrêté brutalement pendant une lecture peut laisser un ffmpeg qui s'éteint seul en cinq minutes au plus.

## Pour aller plus loin

Fonctionnement interne, relais vidéo, quota et pièges : [wiki, Google Nest](../../doc/3_plugins/3_5_google-nest.md).
