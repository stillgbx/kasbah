# Transcription (la voix de l'assistant)

| | |
|---|---|
| **Id** | `transcription` |
| **Rôle** | dicter une instruction à l'assistant au lieu de la taper ; en option, entendre sa réponse à voix haute |
| **Connexion** | un moteur de transcription par la route compatible OpenAI `/v1/audio/transcriptions` : **VoiceStudio** en local, **vLLM** (Voxtral Realtime) sur un serveur, ou l'**API de Mistral** |
| **Compte** | aucun, sauf la clé de l'API pour Mistral ; la voix des réponses se choisit **par compte connecté** |
| **Vues** | palette Ctrl+K et barre de la vue Maison (bouton micro), Réglages → Plugins |

## Ce que fait le plugin

- **Dicter** : un bouton micro au bout du champ de la palette Ctrl+K et de la barre de la vue Maison. Appuyer pour parler, appuyer pour finir (arrêt seul au bout de 15 s) : le texte entendu part **aussitôt** à l'assistant, comme une instruction tapée puis envoyée.
- **Envoi à la fin de la phrase** (interrupteur « Envoyer à la fin de la phrase », allumé par défaut) : l'écoute s'arrête seule après une seconde de silence, sans appuyer sur Terminer ; le bouton reste pour couper plus tôt. Si personne ne parle dans les 5 premières secondes, rien n'est envoyé. Une musique forte peut empêcher la fin d'être vue : le bouton reprend alors la main.
- **Vocabulaire de la maison** : les noms des pièces, zones, ambiances et appareils sont envoyés au moteur, qui reconnaît ainsi « Spots cuisine » plutôt qu'un mot approchant.
- **Réponses parlées** (interrupteur « Lire les réponses à voix haute », éteint par défaut) : la réponse de l'assistant à une instruction **dictée** est dite à voix haute, sur l'appareil qui a parlé (pas sur les enceintes). Une instruction tapée garde une réponse écrite.
- **Prononciation** : avant la synthèse, la réponse est réécrite pour être dite en entier. « 8h00 » devient « 8 heures », « 21 °C » devient « 21 degrés », « 80 % » devient « 80 pour cent », « RDC » devient « rez-de-chaussée ». L'abréviation de chaque niveau de la maison est remplacée par son nom. Le texte affiché ne change pas. Les correspondances sont dans `apps/server/src/plugins/transcription/spoken-rules.ts`, une table par langue (français et anglais) : ajouter un remplacement, c'est y ajouter une ligne.
- **Voix des réponses** : la fiche du plugin propose les voix créées chez le fournisseur (les profils de VoiceStudio). Voir plus bas.
- **VoiceStudio sans son interface** (interrupteur « Lancer VoiceStudio sans son interface », éteint par défaut) : Kasbah lance le moteur de VoiceStudio à son démarrage et l'arrête avec lui, sans ouvrir l'application.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D. Le micro ne se montre que si le plugin tourne et sait où envoyer l'audio.

## La voix des réponses, par compte

Dans **Réglages → Plugins → transcription**, la liste « Voix des réponses parlées » :

- **sur le réseau local** (sans connexion), règle la **voix de la maison** ; « Voix par défaut » revient à `TTS_VOICE` ;
- **connecté** (adresse publique), règle la voix **de votre compte seulement**. La première option, « Voix de la maison », veut dire « pas de choix personnel » : la voix de la maison sert, et suit ses changements.

À chaque réponse, Kasbah prend la voix du compte qui a parlé, sinon celle de la maison, sinon `TTS_VOICE`. Le choix vaut dès la réponse suivante, sans redémarrer. Un compte connecté ne change pas la voix de la maison ; une voix supprimée chez le fournisseur reste affichée (« introuvable chez le fournisseur ») jusqu'à ce qu'on en choisisse une autre.

## Mise en route

### VoiceStudio (par défaut, sur un PC Windows)

1. Installer [VoiceStudio](https://voicestudio.sh/), choisir un moteur de transcription Whisper et vérifier qu'il transcrit le français. Pour les réponses parlées, un moteur de synthèse (OmniVoice) ; les voix personnelles se créent dans l'application.
2. Dans `apps/server/.env` : `STT_PROVIDER=voicestudio` et `STT_URL=http://127.0.0.1:3900` (ou l'adresse du PC qui le fait tourner).
3. Cocher **transcription** dans **Réglages → Plugins**. Allumer au besoin les réponses parlées, et le lancement de VoiceStudio sans son interface (seulement si `STT_URL` est sur la machine du serveur).

### vLLM (Voxtral Realtime)

`STT_PROVIDER=vllm` (et `STT_URL` si vLLM n'écoute pas sur `http://localhost:8000`). Il faut 16 Go de GPU et Linux (WSL2 sous Windows) : la recette est dans le wiki.

### API Mistral

`STT_PROVIDER=mistral` et `STT_API_KEY=<clé de console.mistral.ai>`. Aucun GPU local.

### Le micro sur le réseau local

Le navigateur **refuse le micro** sur une adresse `http://` qui n'est pas `localhost`. Deux voies : passer par l'adresse publique (HTTPS), ou autoriser l'adresse locale dans Chrome sur chaque appareil (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, y saisir par exemple `http://192.168.1.90:8787`, puis **Relaunch**). Rien d'équivalent sur iPhone et iPad : adresse publique.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `STT_PROVIDER` | `voicestudio` | `voicestudio`, `vllm` ou `mistral` |
| `STT_URL` | selon le fournisseur (aucune pour VoiceStudio) | Racine du serveur, sans `/v1` |
| `STT_MODEL` | selon le fournisseur (`whisper-1` pour VoiceStudio) | Modèle de transcription |
| `STT_API_KEY` | — | Clé du fournisseur, obligatoire pour Mistral |
| `STT_LANGUAGE` | `fr` | Langue parlée (pas de détection) ; choisit aussi la table de prononciation des réponses |
| `TTS_MODEL` | `tts-1` | Modèle de synthèse (`tts-1` = le moteur actif de VoiceStudio) |
| `TTS_VOICE` | `default` | Voix des réponses quand ni la maison ni le compte n'en ont choisi une |
| `VOICESTUDIO_DIR` | celui que l'application note dans `%APPDATA%` | Runtime de VoiceStudio, pour le lancement sans interface |

Les choix de voix sont gardés par le serveur : `apps/server/.state/transcription.json` pour la maison, le dossier d'état de chaque compte pour le sien.

## Limites

- Une instruction dure **15 s** au plus ; une réponse dite, 1 000 caractères.
- La prononciation suit `STT_LANGUAGE`, pas la langue de chaque réponse : une langue sans table passe telle quelle (seules les abréviations des niveaux sont remplacées).
- Réponses parlées et liste des voix essayées avec VoiceStudio seulement (ni vLLM ni Mistral).
- Tout redémarrage du plugin (y compris basculer un de ses interrupteurs) recharge VoiceStudio lancé sans interface (environ 10 s).
- Ne pas ouvrir l'application VoiceStudio pendant que Kasbah tient son port : éteindre l'interrupteur d'abord.

## Pour aller plus loin

Fonctionnement interne, routes, mesures et pièges : [wiki, Transcription](../../doc/3_plugins/3_25_transcription.md) ; l'assistant : [wiki, assistant](../../doc/1_architecture/1_9_assistant.md).
