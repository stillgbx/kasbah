# PetKit

| | |
|---|---|
| **Id** | `petkit` |
| **Appareils** | mangeoires (`pet_feeder` : Fresh Element Solo / Infinity) et fontaines (`pet_fountain` : Eversweet) |
| **Connexion** | **cloud, non officielle** : l'API de l'application mobile PetKit ; les fontaines Bluetooth sont commandées par l'intermédiaire d'un appareil PetKit voisin |
| **Compte** | adresse du compte PetKit + code à usage unique reçu par courriel (aucun mot de passe) ; seul le jeton de session est gardé |
| **Vues** | Animaux, Maison (panneau d'appareil), Réglages → Plugins |

![Vue Animaux](../screenshots/pets.webp)

*Capture de la démonstration (simulation, aucun appareil réel).*

## Ce que fait le plugin

- **Mangeoires** : trémie garnie ou à remplir, dessiccant, batterie de secours, ration servie aujourd'hui et prévue, prochain repas du plan, distribution en cours. Bouton **Servir une ration**, dans la liste de portions que la machine accepte.
- **Fontaines** : eau à remplir ou correcte, filtre (pourcentage et alerte), batterie, nombre de passages du jour et durée moyenne. Commandes **Démarrer / Arrêter** la pompe et choix du mode **Continu** ou **Intermittent** (minuterie, pas détection de présence).
- **Appeler l'animal** : seulement sur les modèles qui ont un haut-parleur (série à caméra) ; absent sur une Fresh Element Solo.
- Les quantités d'une mangeoire à tasses sont en dixièmes de tasse ; les grammes affichés à côté sont une **estimation**. Le poids d'une tasse se règle dans la vue Animaux (100 g par défaut) : peser une ration une fois pour le caler.

## Connexion

Rien en local : les mangeoires ne parlent qu'au cloud de PetKit, et une fontaine Eversweet Max n'a pas de Wi-Fi (Bluetooth seulement). Kasbah relit les appareils toutes les 5 minutes.

La connexion se fait **par code**, pas par mot de passe : PetKit envoie un code à usage unique par courriel, valable dix minutes. Aucun mot de passe ne traverse le serveur ; seul le jeton de session (valable environ 36 heures, renouvelé de lui-même avant l'échéance) est écrit, dans `apps/server/.state/petkit-session.json`. Si la session est perdue, un nouveau code est demandé : le plugin passe en « Appairage requis » plutôt que d'insister.

**Utilisez un compte PetKit dédié**, auquel vous partagez vos appareils depuis votre compte principal : une nouvelle connexion invalide la précédente, et sur votre compte principal le serveur et votre téléphone se déconnecteraient l'un l'autre en boucle.

## Mise en route

1. Dans l'application PetKit, créer un compte dédié et lui partager les appareils.
2. Cocher **Petkit** dans **Réglages → Plugins**.
3. Dans la section PetKit de Réglages → Plugins : saisir l'**adresse du compte PetKit**, puis **Recevoir un code**.
4. Relever le code reçu par courriel (dans les dix minutes), le saisir dans **Code reçu par courriel**, puis **Relier**.
5. La carte indique le nombre d'appareils reliés et la date de fin de la session. Rien à recopier dans `.env`. **Délier** efface le jeton.

## Configuration (`apps/server/.env`)

Tout est facultatif et aucun secret n'y figure.

| Variable | Défaut | Rôle |
|---|---|---|
| `PETKIT_REGION` | `FR` | Région du compte : elle choisit le serveur du fabricant (le compte doit y être inscrit) |
| `PETKIT_TIMEZONE` | `Europe/Paris` | Fuseau annoncé au fabricant |
| `PETKIT_SESSION_FILE` | `apps/server/.state/petkit-session.json` | Où garder le jeton de session. Vide : la liaison est perdue à chaque redémarrage |
| `PETKIT_POLL_MS` | `300000` | Cadence de lecture, de 60 000 à 3 600 000 ms |
| `PETKIT_GATEWAY` | vide (déduite de la région) | Serveur forcé, si besoin |
| `PETKIT_PASSPORT_URL`, `PETKIT_APP_VERSION` | valeurs du fabricant | À ne changer que si PetKit déplace son API ou exige une version plus récente |

## Limites

- **Fontaines : relevés décalés.** Kasbah ne peut pas forcer une fontaine à se synchroniser : la carte indique l'âge du relevé plutôt que de faire croire au temps réel. Le relais Bluetooth ne sert qu'aux commandes (quelques secondes, parfois plus), pendant lesquelles la mangeoire voisine est occupée.
- Une fontaine **ne mesure pas l'eau bue** : elle compte ses visites (passages), pas des millilitres.
- Une mangeoire sans plateau pesant ignore ce qui a été **mangé** : la ligne n'est pas affichée.
- Une confirmation « ration servie » vient de la relecture de la machine, pas de l'accusé de réception.
- **Pas de plan de repas** (il se règle dans l'application PetKit ; une ration servie depuis Kasbah s'y ajoute sans le toucher), ni caméra, ni détection d'animal, ni litière ou purificateur.
- Le « mode batterie » des fontaines n'est pas pris en charge.
- L'API n'est pas publique : elle peut changer sans préavis.

## Pour aller plus loin

Fonctionnement interne, pièges de l'API et protocole Bluetooth : [wiki, PetKit](../../doc/3_plugins/3_17_petkit.md).
