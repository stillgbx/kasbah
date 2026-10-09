# TENS actiTENS mini — premier plugin LOCAL (Web Bluetooth)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/web/src/lib/tens/protocol.ts`, `apps/web/src/lib/tens/programs.ts`, `apps/web/src/lib/tens/link.ts`, `apps/web/src/lib/tens/fakeTens.ts`, `apps/web/src/stores/tens.ts`, `apps/web/src/stores/localPlugins.ts`, `apps/web/src/views/TensView.vue`, `apps/web/src/lib/navItems.ts`, `apps/web/src/views/SettingsView.vue`, notice actiTENS Mini (avril 2025, Expanscience), captures HCI du 2026-09-25 (hors dépôt)

L'électrostimulateur actiTENS mini (Sublimed, nom Bluetooth `acTENSv2_XXXXXX`, appli Android
`com.sublimed.actitens`) se pilote depuis Kasbah sans l'appli du téléphone : marche / arrêt,
programme, intensité par canal, durée, batterie. C'est le **premier plugin qui ne vit pas sur le
serveur** : il tourne dans le navigateur, en Web Bluetooth, et n'existe que sur le poste qui l'a
activé.

## Pourquoi un plugin local, et pas un plugin serveur

- **Le périmètre voulu est le poste, pas la maison.** Le TENS ne doit jamais être pilotable depuis
  une tablette murale. Un plugin serveur diffuse ses appareils à tous les écrans par le
  WebSocket (voir `../1_architecture/1_2_serveur-et-plugins.md`) : exactement l'inverse.
- **La radio est sur le poste.** Le Bluetooth basse consommation porte à quelques mètres ; le serveur
  ne sera pas toujours sur la machine où l'on s'assoit.
- **Sécurité** : on envoie du courant dans un corps. Hors du serveur, ni automatisation, ni scène, ni
  assistant (MCP) ne peuvent atteindre le TENS — par construction, pas par réglage.

L'activation est un choix **du navigateur** (`localStorage`, clé `kasbah.localPlugins`, store
`stores/localPlugins.ts`), jamais écrit dans house.json. Réglages → **« Sur cet appareil »**.
L'entrée du rail porte `local: 'tens'` (`lib/navItems.ts`) : `visibleNavItems()` la filtre pour le
rail ET la recherche de la vue Maison.

## Protocole (rétro-conçu le 2026-09-25)

Aucune documentation publique. Relevé en trois temps : carte GATT et lectures passives avec nRF
Connect, puis capture des échanges de l'appli. Le rapport de bogue (`adb bugreport`) d'un Pixel
**n'inclut pas** le journal HCI complet, seulement un résumé `btsnooz` sans données : la capture a
été faite **en direct** par l'option « socket des journaux HCI » des options développeur
(`adb forward tcp:8872 tcp:8872`, flux btsnoop enregistré sur le PC).

### Services

| Service | Caractéristiques | Rôle |
|---|---|---|
| `59994ce0-…` | `ce1` écriture, `ce2` notification | **commandes / réponses** (malgré sa ressemblance avec un canal de mise à jour) |
| `9c7786c0-…` | `c1` lecture ; `c2`, `c3`, `c4` lecture + notification | identité, batterie, état, séance |
| `9c775fb0-…` | `fb1` / `fb2` | inutilisé par l'appli pendant une séance |

L'annonce ne porte **ni nom ni service** (drapeaux + puissance d'émission seulement) : voir
l'appairage plus bas.

### Trames

`1b 40 <cmd> <long> <données> <crc>` vers le TENS, `1b c0 <cmd & 0x7f> …` en réponse, `1b e0 …`
pour un événement. Contrôle **CRC-8/MAXIM** (poly 0x31 réfléchi, init 0) sur toute la trame,
vérifié sur les 74 trames capturées. Les commandes portent un jeton de 4 octets (`2a 11 5b 4a`)
d'origine inconnue ; **rejoué tel quel, il est accepté**.

| Cmd | Données | Sens |
|---|---|---|
| `85` | — | salut → numéro de série en ASCII |
| `a6` | `<masque canaux 01/02/03> <jeton> 64 00 00 00 10 27 00 00` | vérification des électrodes (0,5 mA de test) |
| `a0` | `<id séance> <NOMBRE de segments> <segment 14 o>` | un segment de programme (forme d'onde) |
| `a1` | `<durée s LE16> <jeton>` | démarrage |
| `a2` | `<canal> <intensité LE16, 0,1 mA> <jeton>` | intensité absolue |
| `a4` / `a5` / `a3` | `<jeton>` | pause / reprise / arrêt |
| `93` | `3c ff` / `3c 00` | drapeau posé après le démarrage, retiré après l'arrêt |

Un **refus** revient en `1b c0 7f 02 <commande refusée> <code>` — `link.ts` rejette alors la
commande tout de suite au lieu d'attendre le délai :

- `05` : programme mal formé (nombre de segments faux) ;
- `11` : programme refusé quand le TENS **n'est pas posé** (la vérification `a6` répond pourtant) →
  « Électrodes non détectées » ;
- `33` : intensité envoyée **trop tôt** après la précédente (la même valeur repasse juste après).

Lectures : `c2` batterie `[en charge][?][mV LE16][%]` (le pourcentage suit la tension : faux 100 %
sur le câble, d'où « En charge » à l'écran) ; `c4` séance `[état][raison][id séance][s restantes
LE16][c1 LE16][c2 LE16]`, états 0 repos / 1 vérification / 2 en cours / 3 pause.

### Programmes = formes d'onde

L'appareil ne connaît pas « P3 » : l'appli envoie la forme du courant, segment par segment
(`<n°> <durée ms LE32> <mode> <fréq c1> <fréq c2> <largeur c1> <largeur c2> <enveloppe> …`,
largeur en dizaines de µs, enveloppe plate / montée / descente, mode balayage). `programs.ts`
rejoue les segments capturés de P1 à P12 (P9 = cycle « relaxation musculaire » repos 5 s / montée
2 s / contraction 10 s / descente 1 s, lancé sans la phase de réglage de l'appli). Les **favoris**
(programme + durée) sont modifiables et retenus par poste (`kasbah.tens.favorites`), avec deux favoris par
défaut au départ.

*(Dépassé le 2026-09-28 : un favori lance désormais le traitement complet, pas seulement programme et durée — voir « Mise à jour 2026-09-28 - favori = lancement complet, intensités visées » plus bas.)*

### Mise à jour 2026-09-28 - favori = lancement complet, intensités visées

Auparavant un favori valait « programme + durée », un seul par programme, toujours lancé sur 1 + 2.
Depuis le 2026-09-28 :

- **Intensités visées** : la carte de droite de `TensView.vue` porte, sous « Canaux », un curseur
  par canal (0 à 30 mA, pas de 0,5 mA ; 0 = à la main ; grisé pour un canal hors séance).
  `startProgram(program, minutes, channels, targets)` pose ces consignes **après** le démarrage et
  laisse la file ordinaire monter (paliers de 0,5 mA / 300 ms, plafond, pause / arrêt / geste qui
  la remplacent) — pas de chemin d'envoi à part. Ordre de grandeur : 20 mA sur deux canaux ≈ 24 s.
- **Favori = tout le lancement** : `TensFavorite { program, minutes, channels?, ch1?, ch2? }`
  (dixièmes de mA). Les anciens favoris sans ces champs valent 1 + 2 et 0. L'identité est
  `favoriteKey` (`programs.ts`) : **plusieurs favoris par programme** dès que durée, canaux ou
  intensités diffèrent.
- **Étoile à trois états** (`starState`) : pleine = les réglages affichés sont déjà un favori (clic
  = retrait) ; pâle (`other`) = le programme est favori mais avec d'autres réglages (clic = ajout) ;
  vide = jamais favori.
- **Favori en cours** : `lastLaunch.key` retient la clé du lancement, `currentKey` n'encadre que
  la tuile lancée (deux P6 ne s'allument plus ensemble).
- **Tuile sur deux lignes** : nom dessus, « 30 min · 12,0 / 8,0 mA » (ou « canal 1 : … ») dessous ;
  sur une ligne, le nom tombait à « P1 · … » à trois tuiles par rangée. Le libellé du × reprend
  durée et intensités.

Tests : `stores/tens.test.ts` (montée vers les consignes de lancement, canal hors séance, plafond,
geste qui remplace), `views/TensView.test.ts` (intensités enregistrées et rappelées en un clic,
deux favoris P6, tuile en cours unique, étoile qui ne retire que les réglages en cours).

## Intensité : consigne, acquis, une seule file

Deux valeurs par canal dans `stores/tens.ts` : la **consigne** (curseur, clics +/− qui s'y
additionnent) et l'**acquis** (dernière valeur acceptée par le TENS). Une seule file les rapproche :

- montée par paliers de 0,5 mA, descente directe ;
- **une commande toutes les 300 ms, tous canaux confondus**, en alternant les canaux (plus vite : refus
  `33`) ;
- un refus `33` ne perd rien, la file retente au créneau suivant ; au 10e d'affilée, erreur et
  consigne ramenée à l'acquis ;
- plafond **30 mA** par canal (`INTENSITY_MAX`) ; pause et arrêt vident la file ; l'arrêt passe même
  pendant un lancement et empêche alors le démarrage.

Page : curseur de consigne avec repères tous les 5 mA (couleur du repère des ouvrants), barre
discrète de l'acquis dessous, petit « TENS x mA » tant qu'il n'a pas rattrapé.

## Appairage et connexion

Le TENS **refuse tout nouvel appareil hors mode appairage** : connexion radio acceptée, GATT muet,
appairage Windows `FAILED` sans même proposer de cérémonie. Procédure (notice + essais) :

1. allumer (voyant vert), **bouton central 3 s → voyant bleu** ;
2. appairer depuis **Windows** (Paramètres → Bluetooth → Ajouter un appareil) : le système apprend
   alors le nom `acTENSv2_…` ;
3. « Connecter » : sélecteur filtré sur `acTENS` — le filtre ne trouve le TENS qu'une fois son nom
   connu du système, sinon « Autres appareils » (liste complète, adresse en `00:30:3A:…`).

Le TENS ne garde qu'**une** association : le téléphone doit être réappairé pour reprendre l'appli.
Il n'accepte qu'**une connexion** à la fois.

Kasbah retient l'identifiant Web Bluetooth (`kasbah.tens.deviceId`) et s'y reconnecte sans
sélecteur **si Chrome expose `getDevices()`**, ce qui demande le drapeau
`chrome://flags` → « Web Bluetooth new permissions backend ». Sans lui, un rechargement de page
coupe la liaison et il faut recliquer ; **la séance continue sur le TENS** et son état est relu à la
reconnexion (le nom du programme est retrouvé par l'id de séance si le lancement vient de ce poste).
Web Bluetooth exige un contexte sécurisé : `localhost` ou HTTPS — à prévoir quand le serveur aura
sa propre machine.

## Tests sans l'appareil

`lib/tens/fakeTens.ts` simule le TENS (réponses, séance, refus `05` / `11` / `33`). Les trames
encodées sont comparées **octet pour octet** aux captures (`protocol.test.ts`) ; store et vue sont
testés contre le simulateur (`stores/tens.test.ts`, `views/TensView.test.ts`). Validé ensuite sur
l'appareil : connexion, jeton, lancement, intensités, refus.

## Connu et non résolu

- Un **voyant rose clignotant** (erreur interne selon la notice : éteindre 15 min) est apparu une
  fois en cours d'essai, cause inconnue. Les trames sont tracées en console (`[tens] → / ←`) pour la
  prochaine occurrence.
- Sens de la queue de `a6`, du drapeau `93 3c`, de l'octet « raison » de `c4` : rejoués ou lus bruts.
