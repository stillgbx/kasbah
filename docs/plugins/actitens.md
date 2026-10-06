# TENS actiTENS mini

| | |
|---|---|
| **Id** | `tens` (plugin **local**, pas un plugin serveur) |
| **Appareils** | électrostimulateur actiTENS mini (nom Bluetooth `acTENSv2_…`) |
| **Connexion** | **locale au poste** : Bluetooth basse consommation, directement entre le navigateur et l'appareil (Web Bluetooth) ; le serveur Kasbah n'intervient pas |
| **Compte** | aucun |
| **Vues** | TENS, Réglages → Sur cet appareil |

> Cet appareil envoie du courant dans le corps. Kasbah reprend les réglages de l'appli d'origine mais ne la remplace pas : se référer à la notice de l'actiTENS mini pour les précautions d'emploi. Le protocole a été déduit de l'observation de l'appli officielle, sans documentation du fabricant.

## Ce que fait le plugin

Il pilote le TENS depuis Kasbah, sans l'appli du téléphone :

- **Marche, pause, reprise, arrêt**, durée de la séance, batterie (avec « En charge » sur le câble).
- **Programmes P1 à P12** : Gate Control 100 Hz / 80 Hz, Endorphinique, Mixte, Séquentiel, Stimulation HAN, Burst 2 Hz, Modulation fréquentielle, Relaxation musculaire, Massage, Frottements, Traitement zones sensibles.
- **Intensité par canal** (canaux 1 et 2) : curseur ou boutons +/−, par paliers de 0,5 mA, **plafonnée à 30 mA par canal**. Le TENS accepte mal les envois trop rapprochés : Kasbah fait monter l'intensité elle-même, de façon régulière.
- **Intensités visées** : un curseur par canal sous « Canaux » ; la séance monte seule jusqu'à ces valeurs après le démarrage (0 = réglage à la main).
- **Favoris** : l'étoile d'un programme enregistre le lancement complet (programme, durée, canaux, intensités visées). On peut en avoir plusieurs par programme ; ils se relancent d'un clic. Ils sont retenus par poste.
- **Vérification des électrodes** au démarrage : « Électrodes non détectées » tant que le TENS n'est pas posé sur la peau.

## Pourquoi un plugin local

C'est voulu : **le TENS n'existe que sur le poste qui l'a activé.** Un plugin serveur diffuse ses appareils à tous les écrans ; celui-ci, jamais. Les autres écrans de la maison (la tablette du palier, par exemple) n'en voient rien, et **ni les automatisations, ni les scènes, ni l'assistant (MCP) ne peuvent l'atteindre**, par construction. Il n'a donc pas de section `.env` et ne figure pas dans Réglages → Plugins.

## Navigateur requis

- **Chrome ou Edge** : Firefox et Safari ne proposent pas Web Bluetooth. Sans Bluetooth, la page TENS et Réglages le disent (« Bluetooth indisponible dans ce navigateur »).
- Kasbah doit être ouvert en **`localhost` ou en HTTPS** : Web Bluetooth est refusé sur une adresse `http://` du réseau local. Le plus simple est d'ouvrir Kasbah en `localhost` sur le poste qui a le Bluetooth.
- Le poste doit être **à portée** du TENS (quelques mètres) et disposer du Bluetooth.

## Mise en route

1. Ouvrir Kasbah dans Chrome ou Edge, sur le poste voulu, puis **Réglages → Sur cet appareil** et activer **TENS actiTENS mini**. L'entrée **TENS** apparaît dans le menu, sur ce navigateur seulement.
2. **Fermer l'appli actiTENS du téléphone** : le TENS n'accepte qu'une connexion à la fois, et ne garde qu'une association (le téléphone devra être réappairé pour reprendre l'appli).
3. **Première connexion**, dans l'ordre :
   - allumer le TENS (voyant vert), puis **maintenir le bouton central 3 secondes** : le voyant clignote en **bleu**, il accepte un nouvel appareil ;
   - l'appairer depuis **Windows** (Paramètres → Bluetooth et appareils → Ajouter un appareil → Bluetooth → `acTENSv2_…`) : Windows apprend ainsi son nom ;
   - dans la vue **TENS**, **Connecter** : la liste ne propose alors que `acTENSv2_…`. Sans passer par Windows : **Autres appareils**, puis l'« appareil inconnu » dont l'adresse commence par `00:30:3A`.
4. Poser le TENS, choisir un programme, une durée, régler les canaux, **Démarrer**.

**Reconnexion automatique (facultatif)** : pour que Kasbah se reconnecte sans clic, même après un rechargement de la page, activer dans Chrome `chrome://flags` → « Web Bluetooth new permissions backend » → *Enabled* (`edge://flags` dans Edge), puis redémarrer le navigateur. Sans ce réglage, recharger la page coupe la liaison et il faut recliquer sur Connecter. **La séance, elle, continue sur le TENS** et son état est relu à la reconnexion.

## Où c'est stocké

Dans le navigateur du poste (`localStorage`), jamais sur le serveur ni dans le fichier de la maison : l'activation du plugin, les favoris, l'identifiant de l'appareil appairé et le dernier lancement. Vider les données du site efface ces réglages.

## Limites

- **Un seul poste à la fois**, un seul TENS : pas d'accès depuis les autres écrans, pas d'automatisation.
- Le TENS refuse un programme lancé quand il n'est pas posé sur la peau (« Électrodes non détectées »).
- Après une coupure, la séance continue sur l'appareil ; si elle a été lancée depuis un autre poste, Kasbah indique « Lancée depuis un autre appareil » plutôt que le nom du programme.
- Un voyant rose clignotant (erreur interne, d'après la notice : éteindre 15 minutes) a été vu une fois sans cause connue.

## Pour aller plus loin

Protocole Bluetooth, programmes, file d'intensité et pièges : [wiki, TENS actiTENS mini](../../doc/3_plugins/3_21_actitens-tens.md).
