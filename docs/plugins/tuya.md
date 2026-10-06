# Tuya (ventilateur-lumière CREATE)

| | |
|---|---|
| **Id** | `tuya` |
| **Appareils** | un ventilateur de plafond avec lumière CREATE (gamme WindCalm) : deux appareils Kasbah, une lumière (`light`) et un ventilateur (`fan`) |
| **Connexion** | **locale** : protocole local Tuya 3.5 sur le réseau de la maison (TCP 6668) ; le cloud Tuya ne sert qu'une fois, à lire la clé de l'appareil |
| **Compte** | aucun compte dans Kasbah : l'identifiant, la clé locale et l'adresse de l'appareil se mettent dans `.env` |
| **Vues** | Lumières (lumière et ventilateur ensemble), Maison (panneaux d'appareil), Réglages → Plugins |

## Ce que fait le plugin

- **Lumière** : allumer, éteindre, et choisir la température de couleur parmi **trois crans** : froid (4000 K), neutre (3300 K) et chaud (2700 K). Ce modèle ne se règle pas en intensité.
- **Ventilateur** : marche / arrêt, vitesse de 1 à 6, sens (avant / arrière), minuterie (arrêt, 1 h, 2 h, 4 h) et **bip silencieux** (coupe le bip d'accusé de l'appareil).
- Les réglages faits à la **télécommande RF** ou dans l'application du fabricant sont repris par Kasbah.
- La lumière et le ventilateur sont liés : la vue Lumières les montre ensemble.

Le plugin est écrit pour ce modèle précis (catégorie Tuya `fsd`). Un autre appareil Tuya, même de la même marque, n'est pas reconnu tel quel : ses points de données (DP) peuvent différer.

## Connexion

Une fois la clé locale relevée, **plus rien ne sort du réseau** : le serveur Kasbah ouvre une connexion directe avec le ventilateur et reçoit son état au fil de l'eau. Il n'y a pas de découverte automatique : le broadcast UDP de Tuya est souvent filtré par les routeurs et points d'accès, donc l'adresse IP se donne dans `.env`. Fixer un **bail DHCP statique** pour le ventilateur.

## Mise en route

1. Appairer le ventilateur dans l'application mobile (CREATE ou Tuya Smart / Smart Life), sur le même réseau que le serveur.
2. Relever **l'identifiant** et la **clé locale** de l'appareil, une seule fois : créer un projet Smart Home sur `iot.tuya.com`, y lier le compte de l'application, activer IoT Core, puis lancer `npx @tuyapi/cli wizard`. La procédure détaillée est dans `tools/tuya-capture/README.md`.
3. Dans `apps/server/.env`, renseigner `TUYA_DEVICES` (voir ci-dessous), puis redémarrer le serveur.
4. Cocher **Tuya** dans **Réglages → Plugins**. Tant que `TUYA_DEVICES` est vide, le plugin reste « Appairage requis ».
5. Placer la lumière et le ventilateur dans la maison comme les autres appareils.

**Ne pas réappairer le ventilateur** après coup : cela génère une nouvelle clé locale et casse la liaison. La clé contient des caractères spéciaux : ne la passer ni en ligne de commande, ni dans un message ou un journal.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `TUYA_DEVICES` | vide | Tableau JSON, un objet par appareil physique : `id`, `key` (clé locale), `ip`, `name`, et `version` du protocole (`3.5` par défaut) |
| `TUYA_COMMAND_TIMEOUT_MS` | `8000` | Attente de l'effet d'une commande, de 500 à 30 000 ms |
| `TUYA_RECONNECT_MS` | `700` | Intervalle de reconnexion, de 100 à 30 000 ms |

Exemple, avec des valeurs fictives (le nom de l'appareil physique sert à nommer la lumière et le ventilateur) :

```
TUYA_DEVICES=[{"id":"<identifiant>","key":"<cle-locale>","ip":"192.168.1.50","name":"Ventilateur salon"}]
```

## Limites

- **Un seul modèle pris en charge** (ventilateur-lumière CREATE, protocole 3.5) ; ajouter un autre appareil Tuya demande d'écrire son mappage.
- **Trois températures de couleur seulement** : l'appareil ignore toute valeur intermédiaire. Pas de variation d'intensité.
- Le serveur doit atteindre le ventilateur en TCP sur le port 6668.
- Régler la vitesse **allume** le ventilateur ; l'éteindre remet la minuterie à zéro.
- La connexion locale tombe parfois sans prévenir : Kasbah se reconnecte tout seul, et l'état est repris à la reconnexion.
- La clé est dans `.env` en clair : protéger ce fichier.

## Pour aller plus loin

Fonctionnement interne, points de données et pièges du protocole : [wiki, Tuya](../../doc/3_plugins/3_18_tuya.md).
