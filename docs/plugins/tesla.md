# Tesla

| | |
|---|---|
| **Id** | `tesla` |
| **Appareils** | véhicules (`vehicle`), un par voiture |
| **Connexion** | **cloud Tesla** (Fleet API officielle, payante à l'usage mais avec un crédit mensuel) : il n'existe rien en local |
| **Compte** | une application sur `developer.tesla.com` (ID client et secret), un domaine public en HTTPS qui sert une clé publique, puis le compte Tesla qui consent |
| **Vues** | Véhicules, Maison (voiture en 3D, aux couleurs de la peinture), Réglages → Plugins |

![Carte Tesla de la vue Véhicules](../screenshots/tesla.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Lecture** : charge, autonomie, câble branché et charge en cours, limite de charge, fin de charge estimée, verrouillage, position (sur la carte, avec le cap), kilométrage, vitesse et rapport, pression des quatre pneus, températures, version logicielle et mise à jour en attente, couleur de la peinture.
- **Veille** : l'état « en veille » est un état normal, affiché comme tel. Les dernières valeurs connues restent visibles, datées (« Lu il y a 12 min »).
- **Commandes** : **Réveiller**, **Actualiser** (relire maintenant, sans réveiller), régler la limite de charge, **Lancer la charge** / **Arrêter la charge**, **Climatiser** (consigne, sièges et volant chauffants), programmer ou annuler l'installation d'une mise à jour logicielle (**Installer maintenant**) avec ses notes de version dans la langue de l'app.
- **Réveil** : jamais de réveil automatique, sauf pour les gestes que vous demandez (bouton, automatisation) : lancer la charge et climatiser réveillent la voiture si elle dort. Les autres réglages sont refusés tant qu'elle dort.
- Climatiser est refusé quand la batterie est sous 20 % (refus du constructeur).

## Connexion

Tout passe par le cloud Tesla (`fleet-api`, région `eu` par défaut). Trois contraintes en découlent :

- **Un domaine public en HTTPS**, même pour une simple lecture : Tesla exige que la clé publique de l'application soit servie à `https://maison.example.org/.well-known/appspecific/com.tesla.3p.public-key.pem`. Kasbah tourne sur votre réseau local : c'est à vous de poser ce fichier sur un domaine à vous (un NAS, un petit hébergement). Le serveur génère la paire de clés ; la clé privée ne quitte jamais `TESLA_KEY_FILE`.
- **Un domaine n'appartient qu'à une application** : si vous recréez l'application (même sous un autre compte développeur), le domaine est « déjà pris ». Gardez la première application : n'importe quel compte Tesla peut ensuite lui donner accès à sa voiture.
- **Les jetons** sont gardés par le serveur (`apps/server/.state/tesla-token.json`) : rien à recopier dans `.env`. Le jeton de renouvellement est à usage unique et réécrit à chaque usage : ne pas supprimer ce fichier.

## Mise en route

1. Sur `developer.tesla.com`, créer une application (type « Authorization Code »), origine autorisée `https://maison.example.org`, redirection égale à `TESLA_REDIRECT_URI`, toutes les portées véhicule cochées. Aucune carte bancaire n'est nécessaire.
2. Renseigner `TESLA_CLIENT_ID`, `TESLA_CLIENT_SECRET`, `TESLA_DOMAIN` (le nom seul, sans `https://`) et `TESLA_REGION` dans `apps/server/.env`, puis redémarrer le serveur.
3. Cocher **Tesla** dans **Réglages → Plugins**. La carte **Tesla** propose trois pas :
   1. **Copier la clé** publique et la poser à l'adresse indiquée sur votre domaine (fichier texte, servi en HTTPS) ;
   2. **Enregistrer le domaine** : le serveur le déclare à Tesla et vérifie que la clé lue est la sienne ;
   3. **Lier le compte Tesla** : le consentement s'ouvre dans un onglet. Au retour, **Actualiser** : les véhicules apparaissent.
4. La carte disparaît quand tout est fait. **Générer une nouvelle clé** existe si la clé est perdue : la reposer sur le domaine, puis enregistrer le domaine à nouveau.

## Coût et crédit mensuel

Tesla facture l'API depuis 2025 : crédit de **10 $ par mois et par compte** (cycle du 1er au dernier jour du mois), puis lecture complète 1 $ pour 500, réveil 1 $ pour 50, commande 1 $ pour 1 000. Sans carte enregistrée, Tesla coupe simplement au bout du crédit.

- **Lister les véhicules et suivre la veille est gratuit.** Seuls coûtent la lecture complète, le réveil et les commandes.
- **Budget journalier** : au plus `TESLA_DAILY_DATA_BUDGET` lectures complètes par jour (100 par défaut, soit 6 $ par mois au pire). Épuisé, seule la veille est suivie jusqu'au lendemain.
- Une voiture vue au repos n'est pas relue avant 15 minutes (`TESLA_REST_MS`), le temps de s'endormir ; en route ou en charge, elle est relue à chaque tour (10 minutes).
- La jauge de la vue Véhicules est une estimation : la console du développeur Tesla reste la référence.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `TESLA_CLIENT_ID` | — | ID client de l'application |
| `TESLA_CLIENT_SECRET` | — | Secret de l'application |
| `TESLA_DOMAIN` | — | Domaine (nom seul) qui sert la clé publique |
| `TESLA_REGION` | `eu` | Région du compte : `eu` ou `na` |
| `TESLA_REDIRECT_URI` | `http://localhost:8787/api/plugins/tesla/auth/callback` | Doit être identique à la redirection déclarée dans l'application (le port est celui du serveur) |
| `TESLA_TOKEN_FILE` | `apps/server/.state/tesla-token.json` | Où le serveur garde les jetons. Vide : la liaison est perdue au redémarrage |
| `TESLA_KEY_FILE` | `apps/server/.state/tesla-key.json` | Où le serveur garde la paire de clés |
| `TESLA_STATE_FILE` | `apps/server/.state/tesla-state.json` | Derniers états des véhicules, couleur et consommation du mois (rien de secret). Vide : rien n'est gardé |
| `TESLA_POLL_MS` | `600000` | Cadence de lecture de la liste (60 000 à 3 600 000 ms) |
| `TESLA_REST_MS` | `900000` | Délai sans relecture pour une voiture au repos (`0` = pas de repos) |
| `TESLA_DAILY_DATA_BUDGET` | `100` | Lectures complètes par jour au plus (`0` = veille seule) |

## Limites

- Les commandes essayées sans signature (limite de charge, charge, climatisation) passent sur une Model S 2017 ; les modèles plus récents peuvent exiger une clé virtuelle installée dans la voiture, non gérée par Kasbah.
- Verrouiller / déverrouiller n'est pas encore disponible.
- La voiture met de 20 secondes à une minute à réagir à une commande de charge : l'état se met à jour à la relecture suivante.
- Un Model S ou X d'avant 2021 peut rester éveillé à cause des lectures (batterie) ; réduire le budget ou allonger `TESLA_POLL_MS` si besoin.
- Les échecs d'un préconditionnement lancé depuis une automatisation ne remontent que dans le journal du serveur.

## Pour aller plus loin

Fonctionnement interne, routes, essais sur la vraie voiture et pièges : [wiki, Tesla](../../doc/3_plugins/3_8_tesla.md).
