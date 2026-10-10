# Enphase

| | |
|---|---|
| **Id** | `enphase` |
| **Appareils** | site solaire (production, consommation, réseau), micro-onduleurs, batteries IQ, et en option la borne IQ EV Charger 2 |
| **Connexion** | **locale** pour la passerelle IQ Gateway (production, onduleurs, batteries) ; **cloud Enphase** (API privée de l'appli) pour la borne uniquement |
| **Compte** | un jeton de passerelle valable un an ; pour la borne, en plus, une session liée avec le compte Enphase |
| **Vues** | Énergie, Maison (panneaux et batteries en 3D), Réglages → Plugins |

![Vue Énergie](../screenshots/energy.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Site** : production solaire, consommation, échange avec le réseau et stockage, en temps réel (relevé toutes les 10 s).
- **Micro-onduleurs** : un capteur de puissance par onduleur, avec son record. Un onduleur muet depuis plus d'une demi-heure (la nuit, une panne) passe indisponible et garde sa dernière valeur, grisée.
- **Batteries IQ** : une par batterie, avec son niveau de charge ; le stockage est positif en charge, négatif en décharge.
- **Borne IQ EV Charger 2** : état (branchée, en charge), énergie de la session, **Lancer la charge** / **Arrêter la charge**. L'intensité ne se règle pas : le démarrage reprend celle de l'appli Enphase.
- La production n'est jamais affichée sous zéro : la veille des micro-onduleurs, la nuit, ne compte pas comme une consommation.
- **Retour au mode d'avant** : un arrêt ou un forçage depuis Kasbah met la borne en « annulation manuelle ». Quand la voiture atteint sa limite ou est débranchée, Kasbah remet le mode choisi dans l'appli (par exemple la charge verte).

## Connexion

- **Passerelle** : le serveur Kasbah parle directement à la passerelle en HTTPS (nom `envoy.local` par défaut, certificat auto-signé accepté pour elle seule). Aucun appel à Internet une fois le jeton posé, aucun quota. Le numéro de série n'est jamais à saisir : la passerelle le donne.
- **Jeton** : le logiciel 7.0 et plus exige un jeton, valable un an. Le serveur le garde dans `apps/server/.state/enphase-token.json` : il n'y a **rien à recopier** dans `.env`, et l'appairage survit aux redémarrages.
- **Borne** : elle n'est pas sur la passerelle, elle ne parle qu'au cloud Enphase. Il faut pour cela lier le compte Enphase (Enlighten) ; la session est gardée dans `apps/server/.state/enphase-cloud.json`. Un jeton collé à la main ne suffit pas.
- **Mot de passe** : celui du compte Enphase n'est jamais une clé de configuration. Il sert une fois à l'appairage, puis il est oublié (ni enregistré, ni journalisé). Il traverse toutefois votre réseau local en HTTP simple, Kasbah n'étant pas servi en HTTPS : la voie « jeton » évite cela, au prix de la borne.

## Mise en route

1. Cocher **Enphase** dans **Réglages → Plugins**. Le sous-élément **Borne de recharge** est coché par défaut : le décocher si vous n'en avez pas.
2. Si la passerelle ne répond pas à `envoy.local`, renseigner son adresse dans `ENPHASE_HOST` (et redémarrer le serveur).
3. Dans la section **Passerelle Enphase** de Réglages → Plugins, deux voies :
   - **Compte Enphase** (recommandée, et indispensable pour la borne) : saisir l'adresse du compte et le mot de passe, puis **Appairer la passerelle**. Le jeton d'un an est créé et gardé par le serveur ;
   - **Jeton** : le créer sur `entrez.enphaseenergy.com`, le coller, puis valider.
4. La carte affiche le rôle du jeton et son échéance. À moins de 30 jours, la pastille du plugin passe à l'orange : **Renouveler le jeton** avant.
5. Pour la borne : choisir **Compte Enphase** et **Valider**. Le bouton lie la session cloud sans refaire de jeton si le jeton local est encore valable.

## Configuration (`apps/server/.env`)

Rien d'obligatoire dans le cas normal.

| Variable | Défaut | Rôle |
|---|---|---|
| `ENPHASE_HOST` | `envoy.local` | Nom ou adresse de la passerelle |
| `ENPHASE_TOKEN` | — | Jeton d'amorçage facultatif (premier démarrage sans interface). Entre lui et celui du serveur, le plus tardif à expirer est retenu |
| `ENPHASE_TOKEN_FILE` | `apps/server/.state/enphase-token.json` | Où le serveur garde le jeton. Vide : rien n'est gardé, il faut réappairer à chaque démarrage |
| `ENPHASE_CLOUD_FILE` | `apps/server/.state/enphase-cloud.json` | Où le serveur garde la session de la borne. Vide : à relier à chaque démarrage |
| `ENPHASE_POLL_MS` | `10000` | Cadence des compteurs (2 000 à 300 000 ms) |
| `ENPHASE_SLOW_POLL_MS` | `60000` | Cadence des onduleurs, batteries et borne (30 000 à 900 000 ms) |

## Limites

- **Jeton d'installateur** : pour un compte à la fois installateur et propriétaire, le formulaire web d'Enphase ne donne qu'un jeton de 12 heures. Seul l'appairage par compte, dans Kasbah, donne celui d'un an.
- Un jeton est propre à une passerelle : celui d'une autre est refusé, comme un jeton expiré ou tronqué (la carte le dit).
- La passerelle est lente par moments (jusqu'à une dizaine de secondes sur le relevé détaillé) : les totaux du jour se rafraîchissent une fois par minute.
- **Arrêter la borne la bloque** jusqu'au prochain débranchement, soleil ou pas : Kasbah le signale sous le bouton et rend le mode d'avant quand il le peut. Elle revient normalement seule au mode choisi dans l'appli.
- La borne ne dit pas quelle voiture est branchée.
- Un seul site Enlighten est lu : celui retenu à l'appairage.
- Mode sécurisé : si la borne n'est pas reliée à la passerelle, elle se replie sur une intensité réduite. Cela se règle dans l'appli Enphase (Connectivité du chargeur), pas dans Kasbah.

## Pour aller plus loin

Fonctionnement interne, cadences, API de la borne et pièges : [wiki, Enphase](../../doc/3_plugins/3_7_enphase.md).
