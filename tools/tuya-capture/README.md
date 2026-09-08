# Capture des DPS d'un appareil Tuya (ventilateur CREATE)

Outil d'exploration, **pas un plugin**. Il sert à répondre à la question préalable au plugin :
quel « data point » (DP) du ventilateur porte quoi, et sur quelle échelle. Tout se passe en local
sur le LAN ; le cloud Tuya n'intervient qu'une seule fois, pour lire la clé de l'appareil.

Contexte : les ventilateurs CREATE (gamme WindCalm…) sont des appareils Tuya en marque blanche.
Ils s'appairent aussi dans Tuya Smart / Smart Life et parlent le protocole local Tuya (TCP 6668,
versions 3.3 à 3.5). Les DPS varient d'un modèle à l'autre (la vitesse est réputée sur une échelle
1 à 6 chez CREATE, pas en pourcentage), d'où la capture sur le vrai appareil avant d'écrire le
mappage — c'est la leçon « fixtures capturées, pas déduites de la spec » de
`doc/3_plugins/3_2_ecrire-un-plugin.md`.

## 1. Obtenir l'id et la clé locale (une seule fois)

La clé locale (`localKey`) est le seul secret nécessaire. Elle change si l'appareil est ré-appairé.

1. Créer un compte sur <https://iot.tuya.com> (compte distinct de celui de l'appli mobile).
2. Cloud → Development → créer un projet de type **Smart Home**. Choisir le data center de
   l'appli mobile dans la liste en haut à droite (**Central Europe** pour un compte français).
3. Dans le projet, onglet **Link Tuya App Account** → scanner le QR code depuis l'appli mobile
   (menu profil → scanner). Si l'appli CREATE n'est pas listée, essayer l'entrée « Others » ;
   en dernier recours, ré-appairer le ventilateur dans **Smart Life** (il quitte alors l'appli
   CREATE, mais la télécommande RF continue de fonctionner).
4. Onglet **Service API** → s'assurer que **IoT Core** et **Authorization** sont activés. IoT Core
   est un essai d'un mois, renouvelable tous les six mois : il ne sert qu'à lire la clé, plus
   jamais ensuite.
5. Récupérer l'**Access ID** et l'**Access Secret** du projet (onglet Overview), puis lancer :

   ```bash
   npx @tuyapi/cli wizard
   ```

   L'assistant demande ces deux valeurs et l'id d'un appareil (n'importe lequel du compte, visible
   dans l'appli : réglages de l'appareil → informations). Il affiche ensuite **nom, id et clé
   locale** de tous les appareils du compte. Noter ceux du ventilateur.

## 2. Lancer la capture

```bash
cd tools/tuya-capture
npm install
npm run capture -- --id <deviceId> --key <localKey>
```

Ou copier `.env.example` en `.env`, remplir `TUYA_ID` et `TUYA_KEY`, puis `npm run capture`.

Options : `--ip <ip>` (sinon recherche par diffusion UDP), `--version 3.3|3.4|3.5`,
`--set <dp>=<valeurJSON>` (une commande au démarrage), `--out <fichier.jsonl>`
(défaut `captures/ventilateur.jsonl`).

Le script :

1. trouve l'appareil et affiche IP et version du protocole ;
2. lit tous les DPS et affiche la table DP / type / valeur ;
3. journalise ensuite **chaque changement** (ancienne → nouvelle valeur), à l'écran et dans le
   fichier JSONL.

Pendant qu'il tourne, **actionner la télécommande RF et l'appli du fabricant**, une fonction à la
fois, en notant ce qu'on fait : marche/arrêt ventilateur, chaque vitesse, sens de rotation,
marche/arrêt lumière, intensité, température de couleur, minuterie. Au clavier :

| Saisie | Effet |
|---|---|
| `3 4` | envoie la valeur `4` sur le DP 3 (JSON accepté : `true`, `"low"`, `50`) |
| `get` | relit tous les DPS |
| Ctrl+C | déconnecte et affiche le **récapitulatif des valeurs vues par DP** |

Le récapitulatif donne directement l'échelle de chaque DP (par ex. vitesse 1 à 6, intensité 10 à
1000), la matière du futur mappage.

## 3. Ce qu'on en fait

- Le fichier `captures/*.jsonl` devient la fixture du plugin (anonymiser l'id de l'appareil,
  **garder les bizarreries** : types inattendus, DP jamais renseignés).
- Décider du kind `fan` à ajouter au contrat (`doc/1_architecture/1_1_contrat-appareils.md`) :
  la lumière du ventilateur se mappe déjà sur `light`, le ventilateur lui-même n'a pas de kind.
  Un appareil physique = deux appareils Kasbah (lumière + ventilateur).
- Écrire le plugin selon `doc/3_plugins/3_2_ecrire-un-plugin.md` (client local `tuyapi`, mappage
  pur, tests sur la fixture).

## Pièges

- **Une seule connexion locale à la fois** par appareil Tuya. Connexion refusée ou qui tombe
  aussitôt → fermer l'appli mobile ou la sortir du Wi-Fi. Le futur plugin devra reconnecter avec
  délai.
- **Protocole 3.5** (firmwares récents) : l'appareil ne répond pas à la recherche par diffusion
  sur les ports écoutés (6666/6667). Passer `--ip` et `--version 3.5`. Sans version, tenter 3.3
  puis 3.4.
- **Sans internet**, un appareil Tuya coupé du cloud mais dont le DNS répond encore peut refuser
  les connexions locales (« zombie »). Ne rien bloquer au routeur pendant la capture.
- Les échanges `dp-refresh` sont des **deltas** (un ou deux DP par trame), pas des états complets :
  le mappage du plugin devra accumuler un état par appareil, comme pour TaHoma.

## Sources

- tuyapi : <https://github.com/codetheweb/tuyapi> (`docs/SETUP.md` pour la procédure iot.tuya.com)
- @tuyapi/cli : <https://github.com/TuyaAPI/cli>
- Fil Homey sur les ventilateurs CREATE (vitesse 1 à 6) :
  <https://community.homey.app/t/create-fan-and-tuya-app/146417>
- Intégration locale d'un ventilateur Tuya (DP 1 ventilateur, DP 9 et 101 lumières sur un autre modèle) :
  <https://community.home-assistant.io/t/cheap-ceiling-fan-integration-with-local-tuya/838480>
