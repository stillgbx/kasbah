# Plugin Transcription (la voix de l'assistant)

> Dernière mise à jour : 2026-10-12
> Sources : `apps/server/src/plugins/transcription/index.ts`, `apps/server/src/plugins/transcription/voicestudio.ts` (+ test), tests `apps/server/src/plugins/transcription/plugin.test.ts`, `apps/web/src/composables/useVoiceInput.ts` (+ test), `apps/web/src/lib/wav.ts` (+ test), `apps/web/src/components/home/SearchBar.vue`, `apps/web/src/components/layout/SearchPalette.vue`, `apps/server/.env.example`, session du 2026-10-07, `apps/web/src/composables/useVoiceInput.speech.test.ts`, `apps/web/src/components/TranscriptionLinkCard.vue` (+ test), `docs/plugins/transcription.md`, session du 2026-10-08, `apps/web/src/lib/vad.ts` (+ test), `apps/web/src/composables/useVoiceInput.autosend.test.ts`, session du 2026-10-11, `apps/server/src/plugins/transcription/spoken.ts` et `spoken-rules.ts` (+ test), session du 2026-10-12

## Ce que c'est

L'**étape 2** de l'assistant (`../1_architecture/1_9_assistant.md`) : dicter l'instruction au lieu de la
taper. Un bouton micro au bout du champ de la palette Ctrl+K et de la barre de la vue Maison :
**appuyer pour parler, appuyer pour finir** (arrêt seul au bout de 15 s), et le texte entendu part
**aussitôt** à l'assistant, comme si on l'avait tapé puis envoyé.

Plugin **sans appareil**, éteint par défaut : Réglages → Plugins → **transcription**. Le micro ne se
montre que si le plugin tourne et sait où envoyer l'audio (`GET /api/plugins/transcription/status`,
demandé une fois par chargement de page).

## Trois fournisseurs, une seule route (décision de l'utilisateur, 2026-10-07)

Le GPU du serveur ne doit pas forcément être pris par la voix : selon la machine, la transcription
tourne en local, sur le serveur, ou chez Mistral. Les trois parlent la route **compatible OpenAI**
`POST /v1/audio/transcriptions` (multipart : `file`, `model`, `language`) ; le plugin ne change que
l'adresse, le modèle, la clé et le champ du vocabulaire.

| `STT_PROVIDER` | Ce que c'est | Adresse par défaut | Modèle par défaut | Clé | Vocabulaire |
|---|---|---|---|---|---|
| `voicestudio` (défaut) | [VoiceStudio](https://voicestudio.sh/), application locale (Whisper, Parakeet…), Windows natif | aucune : `STT_URL` obligatoire | `whisper-1` (= le moteur choisi dans VoiceStudio) | — | `prompt` |
| `vllm` | Voxtral Realtime servi par vLLM | `http://localhost:8000` | `mistralai/Voxtral-Mini-4B-Realtime-2602` | — | `prompt` |
| `mistral` | API de Mistral (Voxtral Mini Transcribe 2, ≈ 0,003 $/min) | `https://api.mistral.ai` | `voxtral-mini-latest` | `STT_API_KEY` | `context_bias` (100 au plus) |

- **Vocabulaire** : l'app envoie les noms de la maison (pièces, zones, niveaux, ambiances, appareils),
  des mots qu'un modèle ne devine pas (« Spots cuisine », « Robby »). En `prompt`, ils sont joints
  par des virgules et coupés à 800 caractères (Whisper n'en lit que ~224 jetons) ; en `context_bias`,
  un champ par nom (encodage du tableau en multipart supposé, à confirmer au premier essai avec une clé).
- **Langue** : `STT_LANGUAGE` (`fr`) — pas de détection, plus rapide et plus sûr sur une phrase courte.
- **Santé** : `GET {STT_URL}/v1/models` au démarrage. `needs_pairing` si `STT_URL` (VoiceStudio) ou
  `STT_API_KEY` (Mistral) manque ; `degraded` avec la raison (« voicestudio unreachable at … ») si le
  moteur ne répond pas — il peut démarrer après Kasbah ; `ok` dès qu'une transcription réussit.
- **Erreurs** : moteur injoignable → 503 `DEVICE_UNAVAILABLE` ; clé refusée (401/403) → 409
  `NEEDS_PAIRING` ; autre refus → 502 `UPSTREAM_ERROR` avec le début de la réponse ; texte vide →
  l'app dit « Rien entendu. » (dans le champ depuis le 2026-10-10, voir la mise à jour en bas).

## L'audio : WAV 16 kHz mono, fait par le navigateur

`MediaRecorder` enregistre (WebM/Opus sous Chrome, MP4 sous Safari) ; `lib/wav.ts` décode
(`AudioContext.decodeAudioData`), rééchantillonne à **16 kHz, une voie** (`OfflineAudioContext`) et
écrit un **WAV PCM 16 bits** (`encodeWav`) — le format que les trois lisent sans ffmpeg (vLLM lit mal
le WebM). 32 Ko par seconde : 15 s = 480 Ko, 640 Ko en base64. La route Kasbah
`POST /api/plugins/transcription/transcribe` reçoit `{ audio: base64, hints: string[] }` en JSON
(limite 2 Mo, en-tête `RIFF` vérifié) et rend `{ text, ms }`. Un toucher de moins de 0,3 s n'est
pas envoyé.

## Mettre en route

### VoiceStudio (sur le PC où il tourne)

1. Installer VoiceStudio ([voicestudio.sh](https://voicestudio.sh/), installeur Windows, AGPL-3.0).
2. Choisir un moteur de transcription Whisper (Faster-Whisper tient dans 6 Go de GPU, ceux d'un
   portable à GPU hybride) et vérifier qu'il transcrit le français.
3. Son API locale écoute sur **`127.0.0.1:3900`** (`OMNIVOICE_PORT`, documenté dans
   `docs/speech-platform.md` du dépôt VoiceStudio ; vérifié le 2026-10-07).
4. Dans le `.env` du serveur Kasbah : `STT_PROVIDER=voicestudio`, `STT_URL=http://127.0.0.1:3900`
   (ou l'adresse du PC qui le fait tourner). Redémarrer Kasbah, allumer le plugin.

#### Sans son interface, lancé avec Kasbah (sous-item `voicestudio`, 2026-10-07)

Le moteur de VoiceStudio est un programme Python (`backend/main.py`) qui sert **la même API, sur le
même port, avec les mêmes données** que l'app (`%APPDATA%\OmniVoice` : voix créées, moteur choisi).
**Rien à installer** : l'app apporte son propre Python 3.11 (`<runtime>\.python`, relié par
`<runtime>\project\.venv`), posé à **son premier lancement** (marque `.runtime-ready`).

- **Interrupteur** « Lancer VoiceStudio sans son interface » (sous-item `voicestudio`, éteint par
  défaut). Allumé : au démarrage du plugin, si `STT_URL` est sur cette machine (`127.0.0.1`,
  `localhost`, `[::1]`) et que **rien n'y répond**, Kasbah lance
  `<project>\.venv\Scripts\python.exe main.py` dans `backend\`, sans fenêtre, avec
  `OMNIVOICE_PORT` = le port de `STT_URL`. Le démarrage du serveur n'attend pas : la santé dit
  « starting » jusqu'à ce que `/health` réponde 200 (503 pendant le chargement, 180 s au plus).
- **Cycle de vie (décision de l'utilisateur)** : il **vit avec Kasbah**, arrêté à l'arrêt du plugin
  (`taskkill /T /F` sous Windows : `kill` ne toucherait que `python.exe`, ses moteurs resteraient).
  Tout redémarrage du plugin le recharge, y compris basculer « Lire les réponses à voix haute ».
- **Déjà là** (l'app ouverte, un lancement resté d'un serveur tué sans arrêt propre) : rien n'est
  lancé ni arrêté, la santé dit « already running, not launched by Kasbah ».
- **Runtime** : `VOICESTUDIO_DIR` (le dossier `project`), sinon celui que l'app note dans
  `%APPDATA%\VoiceStudio\runtime-location.json` (`root` + `project`). Introuvable ou incomplet,
  adresse sur une autre machine, ou VoiceStudio sorti seul (fin de ses sorties, ex. port déjà pris) :
  santé `error` avec la raison.
- **Réglages** (moteur, nouvelles voix) : dans l'app. Ne pas l'ouvrir pendant que Kasbah tient le
  port : éteindre l'interrupteur d'abord.
- **Le chemin du runtime appartient à l'app** et peut changer à une de ses mises à jour.

Mesuré le 2026-10-07 (portable à GPU hybride, 6 Go), le plugin lançant le vrai VoiceStudio :
prêt en 10,2 s, première synthèse en 11,9 s (modèle froid), transcription en 1,2 s (« Le salon est
allumé. » relu exactement), arrêt en 0,3 s, aucun processus restant. Lancé à la main
(`python main.py`) : `/health` à 200 en 10 s, profil « ma-voix » présent.

Non essayé : l'image Docker officielle (`ghcr.io/debpalash/voicestudio`, GPU NVIDIA, WSL sous
Windows), et `OMNIVOICE_BIND_HOST=0.0.0.0` + `OMNIVOICE_API_KEY` pour le joindre depuis une autre
machine.

### vLLM + Voxtral Realtime (serveur 192.168.1.90, GPU 16 Go)

- **Il faut 16 Go de GPU** (poids BF16) : c'est le minimum, le GPU n'a alors plus de place pour autre
  chose (pas de synthèse vocale Voxtral TTS en même temps, elle aussi ≥ 16 Go). Un portable à GPU
  hybride (6 Go) ne le fait pas tourner.
- vLLM ne tourne que sous **Linux** : sous Windows, **WSL2** (Ubuntu) ; le pilote NVIDIA de Windows
  sert au WSL. Un GPU Blackwell demande **CUDA ≥ 12.8**.
- Recette vLLM (vLLM ≥ 0.20), dans le WSL :

```bash
uv venv && source .venv/bin/activate
uv pip install -U vllm --torch-backend=auto
uv pip install -U "mistral-common[audio]>=1.9.0" transformers
VLLM_DISABLE_COMPILE_CACHE=1 vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --tokenizer-mode mistral \
  --compilation_config '{"cudagraph_mode": "PIECEWISE"}'
```

- `--tokenizer-mode mistral` est obligatoire. Réduire `--max-model-len` (défaut 131 072) libère de la
  mémoire : une instruction dure 15 s au plus.
- Dans le `.env` de Kasbah : `STT_PROVIDER=vllm` (et `STT_URL` si vLLM n'est pas sur
  `localhost:8000` ; le WSL2 transmet `localhost` à Windows).
- **À vérifier au premier essai** : la recette n'annonce que la route temps réel `/v1/realtime`
  (WebSocket). La route `/v1/audio/transcriptions` existe pour ce modèle d'après un ticket vLLM
  ([#52926](https://github.com/vllm-project/vllm/issues/52926), un blocage sur certains fichiers par
  cette route). Si elle manque, il faudra une route temps réel côté plugin (non faite).

### API Mistral

`STT_PROVIDER=mistral`, `STT_API_KEY=<clé de console.mistral.ai>` ; rien d'autre. Aucun GPU local.

## Le micro sur le réseau local : le drapeau Chrome, appareil par appareil

Le navigateur **refuse le micro** sur une adresse `http://` qui n'est pas `localhost`
(`navigator.mediaDevices` absent, `window.isSecureContext === false`). Sur le réseau local, Kasbah est
en `http://192.168.1.90:8787` : sans réglage, toucher le micro affiche « Le navigateur refuse le micro sur
une adresse http… ». Deux voies :

1. **L'adresse publique** (HTTPS, derrière un proxy inverse) : le micro marche, mais on y est connecté sous un
   compte (`../1_architecture/1_7_serveur-mcp.md`, accès depuis l'extérieur).
2. **Autoriser l'adresse locale dans Chrome**, sur chaque appareil (tablette, téléphone, poste) :
   - **Android (Chrome)** : ouvrir `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, passer
     l'option sur **Enabled**, saisir dans le champ l'adresse exacte de Kasbah telle qu'on l'ouvre —
     schéma, hôte et port, sans chemin ni `/` final : `http://192.168.1.90:8787` (plusieurs adresses
     séparées par des virgules, par exemple aussi `http://kasbah:8787`), puis **Relaunch**. L'app
     installée sur l'écran d'accueil passe par Chrome : le réglage vaut pour elle.
   - **Windows / macOS (Chrome)** : même page `chrome://flags/#unsafely-treat-insecure-origin-as-secure` ;
     **Edge** : `edge://flags/#unsafely-treat-insecure-origin-as-secure`.
   - Au premier toucher du micro, le navigateur demande l'autorisation : **Autoriser**.
   - **Firefox** : `about:config`, `media.devices.insecure.enabled` et
     `media.getusermedia.insecure.enabled` à `true` (non essayé).
   - **iPhone / iPad** : pas d'équivalent dans Safari — passer par l'adresse publique.
   - Le drapeau s'efface parfois à une mise à jour majeure de Chrome : à revérifier si le micro
     redevient refusé.

Un HTTPS sur le réseau local (certificat sur un nom local) supprimerait ces manipulations : non
décidé, chantier à part.

## Dans l'app

- **Barre de la vue Maison** : micro et croix se partagent **une seule place**, toujours réservée —
  le micro quand le champ est vide (ou pendant l'écoute), la croix dès qu'il y a du texte ou une
  réponse. Avec les deux côte à côte, la saisie ne faisait plus que 31 px sur téléphone (champ de
  159 px entre la météo et les boutons).
- **Palette** : le micro au bout du champ.
- Pendant l'écoute : bouton rouge (arrêt), champ en lecture seule, « J'écoute… » ; pendant la
  transcription : micro qui pulse, « Transcription… ». Le texte entendu remplit le champ et part à
  l'assistant ; la réponse s'affiche comme pour une instruction tapée.
- Refus du micro par l'utilisateur ou le navigateur : « Accès au micro refusé. » (vu dans le panneau
  navigateur de Claude Code, qui bloque toute capture).

## Tests et vérification

- `plugin.test.ts` (8) : les trois fournisseurs (adresse, modèle, langue, clé, vocabulaire en `prompt`
  ou `context_bias` limité à 100, `/v1` final retiré de l'adresse), réglage manquant, clé refusée,
  moteur injoignable, audio qui n'est pas un WAV.
- `wav.test.ts` : en-tête PCM 16 kHz mono 16 bits, écrêtage, base64 par tranches.
- `useVoiceInput.test.ts` (4) : du toucher au texte (WAV et noms envoyés, micro rendu), arrêt seul à
  15 s, adresse http, rien entendu. Contrôle négatif : sans la minuterie, le test des 15 s rougit.
- Dans le navigateur, sur un serveur jetable relié à un **faux moteur HTTP** (port 7861) : envoi réel
  depuis la page (WAV de l'encodeur de l'app, transport de l'app) → le faux moteur a décodé `file`
  (32 044 octets, `RIFF`), `model: whisper-1`, `language: fr`, `prompt` ; santé `degraded` tant que le
  moteur manquait, `ok` après un succès ; place du micro mesurée à 1 280 et 375 px.
- **Non joué** : une vraie transcription (aucun moteur installé ce jour-là) et une vraie capture du
  micro (le panneau navigateur la bloque).

### Mise à jour 2026-10-07 (nuit) — les réponses parlées

**Décision de l'utilisateur** : la réponse de l'assistant peut être dite à voix haute, avec le modèle
de synthèse par défaut de VoiceStudio en profil « fast » (OmniVoice), activable par un interrupteur
du plugin, et jouée **sur l'appareil d'où vient la demande** (pas sur les enceintes).

- **Interrupteur** : sous-item `speech` du plugin (« Lire les réponses à voix haute (sur l'appareil
  qui a parlé) »), éteint par défaut, dans la section du plugin de Réglages comme les sous-items des
  autres plugins (`house.json`, `plugins.transcription.parts.speech`). Le changer redémarre le plugin.
- **Seules les instructions dictées parlent** : une instruction tapée garde une réponse écrite.
- **Serveur** : `POST /api/plugins/transcription/speak` `{ text }` → `POST {STT_URL}/v1/audio/speech`
  `{ model: TTS_MODEL, input, voice: TTS_VOICE, language, response_format: 'wav' }` (1 000 caractères
  au plus, 60 s) ; rend le son tel quel (`audio/wav`). 409 `SPEECH_DISABLED` si l'interrupteur est
  éteint ; mêmes erreurs que la transcription (fonction d'appel commune). `GET /status` dit `speech`.
- **Web** (`useVoiceInput`) : l'appelant (palette, barre) rend la réponse de l'assistant après une
  dictée ; le micro la demande au serveur et la joue par un `Audio` du navigateur (phase
  `speaking`). Pendant la lecture, le bouton micro devient « Arrêter la lecture » ; la lecture
  s'arrête aussi au démontage. La lecture suit un toucher du micro : la règle d'autoplay de Chrome
  (interaction préalable) est satisfaite.
- **Clés** : `TTS_MODEL` (`tts-1` = le moteur actif de VoiceStudio), `TTS_VOICE` (`default`).
  Non essayé avec `vllm` ni `mistral` (Voxtral TTS demanderait vLLM-Omni, ≥ 16 Go).

**Mesuré par Kasbah** (portable à GPU hybride, 6 Go, VoiceStudio relancé, OmniVoice chargé au
démarrage, 1,9 Go) :

| Appel | Durée | Résultat |
|---|---|---|
| « Les spots de la cuisine sont allumés. » dit (1er, 2e) | 3,3 s · 2,0 s | WAV 24 kHz mono, 2,4 s · 2,3 s, relu exactement par Whisper |
| Transcription juste après, OmniVoice toujours chargé | 1,2 s · 1,2 s | exacte |

Contradiction apparente avec les mesures de la même soirée (transcription à 11 à 12 s avec OmniVoice
chargé, 3 s déchargé, modèle Whisper rechargé à chaque requête) : après la relance de VoiceStudio, les
deux cohabitent et Whisper répond en 1,2 s. Cause non établie (état de VoiceStudio avant relance ?) :
à remesurer si la lenteur revient.

**Écarté le même soir** : MOSS-TTS-Nano-100M (VoiceStudio le fait tourner sur CUDA, deux fois plus lent
que le temps réel, rendu instable sans voix de référence).

Tests : `plugin.test.ts` (+3 : éteint par défaut, requête de synthèse, panne),
`useVoiceInput.test.ts` (réponse non dite quand l'interrupteur est éteint),
`useVoiceInput.speech.test.ts` (3 : dite et arrêtée au toucher, fin de lecture, pas de réponse) ;
contrôle négatif fait.

### Mise à jour 2026-10-07 (nuit, suite) — la voix des réponses, dans la fiche du plugin

Une voix (profil « ma-voix ») a été créée dans VoiceStudio. La **fiche du plugin**
(`TranscriptionLinkCard.vue`, section de Réglages) propose une liste « Voix des réponses parlées » :
la voix par défaut (`TTS_VOICE`), puis les voix créées chez le fournisseur.

- `GET /api/plugins/transcription/voices` relaie `GET {STT_URL}/v1/audio/voices` (extension de
  VoiceStudio à l'API OpenAI) et ne garde que les **profils** : les alias OpenAI (`alloy`, `nova`…)
  renvoient tous chez VoiceStudio à la voix par défaut du moteur. Un profil s'identifie par son
  `voice_id` (« ma-voix » = `0a1b2c3d`).
- `GET/PUT /api/plugins/transcription/settings` `{ voice: string | null }` : la voix retenue, gardée par
  le serveur pour **toute la maison** dans `.state/transcription.json` ; `null` revient à `TTS_VOICE`.
  `/speak` la lit à chaque réponse : le choix vaut dès la suivante, sans redémarrage.
- Une voix retenue que le fournisseur ne propose plus reste affichée (« introuvable chez le
  fournisseur ») ; sans liste (fournisseur qui n'a pas cette route), la carte le dit.

Mesuré : « ma-voix » en 3,1 à 3,3 s par VoiceStudio en direct, 3,2 s par Kasbah après l'avoir choisie
dans la carte (relue exactement par Whisper) — autant que la voix par défaut. Carte vérifiée dans le
navigateur à 1 280 et 375 px.
Tests : `plugin.test.ts` (+3 : profils seuls, voix choisie puis effacée, voix vide refusée),
`TranscriptionLinkCard.test.ts` (2).

### Mise à jour 2026-10-08 — la voix des réponses, par compte connecté

**Demande de l'utilisateur** : chaque utilisateur connecté peut « surcharger » la voix choisie dans la
fiche du plugin et prendre celle qui lui convient. Jusqu'ici la voix retenue valait pour **toute la
maison** (section précédente) ; elle devient la voix **de la maison**, par-dessus laquelle un compte
pose la sienne.

- **Même modèle que le jeton Claude** (`3_24`) : le compte de la session (`req.sessionUser`, adresse
  publique) règle la sienne, le réseau local (sans session) règle celle de la maison. **Un compte
  connecté ne change pas la voix de la maison** (hypothèse posée en séance, non contredite).
- **Fichiers** : la maison dans `.state/transcription.json` (inchangé), un compte dans son dossier
  d'état (`userStateFile(user, 'transcription.json')`, `core/paths.ts`) ; même forme `{ voice }`,
  `null` = pas de choix.
- **`/speak`** : voix du compte qui a parlé, sinon celle de la maison, sinon `TTS_VOICE` — relue à
  chaque réponse, un compte qui n'a rien choisi suit donc les changements de la maison.
- **`GET/PUT /settings`** rendent `{ user, voice, houseVoice, defaultVoice }` : `voice` celle du compte
  courant (la maison sur le réseau local), `houseVoice` ce qui lui sert sans choix. Type web
  `TranscriptionSettings` (`apps/web/src/api/transport.ts`).
- **Carte** : sur le réseau local, rien ne change (« Voix par défaut (default) », aide « pour toute la
  maison »). Connecté, la première option devient « Voix de la maison (ma-voix) » (le nom de la voix de la
  maison, sinon `TTS_VOICE`) et l'aide dit « pour {compte} seulement » ; fr et en.

Tests : `plugin.test.ts` (+1 : un compte surcharge la voix de la maison, ni la maison ni un autre
compte ne la prennent, l'effacer ramène la voix de la maison ; contrôle négatif fait — lecture de la
voix du compte retirée → rouge), `TranscriptionLinkCard.test.ts` (+1, cas connecté). Vérifié par
l'utilisateur sur son installation (« ça fonctionne »).

### Mise à jour 2026-10-10 — rien entendu dans le champ, réécouter une réponse

- **Rien entendu** : plus de bandeau d'erreur. `useVoiceInput` expose `heardNothing`, vrai pendant
  `HEARD_NOTHING_MS` (4 s) ou jusqu'à la prochaine écoute ; la barre et la palette l'affichent à la
  place du texte indicatif (« Je n'ai rien entendu, réessayez ? », `voice.heardNothing`). La clé
  `voice.errors.empty` a disparu.
- **Réécouter** : `replay(answer)` dit une réponse à la demande, y compris celle d'une instruction
  **tapée**, ou arrête celle qui se dit. Bouton « Réécouter » / « Arrêter » en bas à droite de la
  réponse (`AssistantReply`, `canReplay` = sous-item `speech` allumé, exposé par `speech`), place
  réservée dès que le texte arrive, largeur du plus long libellé.
- **Cache** : l'audio de la dernière réponse synthétisée est gardé (`{ text, audio }`) ; la réécouter
  ne rappelle pas `/speak`. Une autre réponse le remplace ; la barre et la palette l'oublient
  (`forgetSpoken`) dès que l'assistant revient au repos (réponse fermée, nouvelle question,
  instruction retouchée).

Tests : `useVoiceInput.test.ts` (rien entendu sans bandeau puis effacé au bout de 4 s ; effacé en
reparlant), `useVoiceInput.speech.test.ts` (+2 : réécoute et arrêt ; une seule synthèse tant que la
réponse n'est pas oubliée).

### Mise à jour 2026-10-11 — envoi à la fin de la phrase

**Demande de l'utilisateur** : ne plus avoir à appuyer sur Terminer ; l'instruction part seule quand
on a fini de parler, le bouton restant pour couper plus tôt. Interrupteur sur la fiche du plugin,
**allumé par défaut**.

- **Interrupteur** : sous-item `autoSend` (« Envoyer à la fin de la phrase », `voice.autoSend`,
  `enabledByDefault: true`), rendu par `GET /status` (`autoSend`). Éteint : le fonctionnement d'avant
  (bouton, ou 15 s).
- **Détection dans le navigateur, au niveau sonore** (`lib/vad.ts`, détection d'activité vocale à
  seuil) : un `AnalyserNode` branché sur le flux du micro, lu toutes les 50 ms par `setInterval` (pas
  de `requestAnimationFrame` : un onglet masqué ne le rend pas). La parole compte après 250 ms au-dessus
  du seuil ; **1 s de silence** ensuite arrête l'enregistrement, qui part comme au bouton.
- **Seuil** : 3 fois le plancher de bruit, 0,01 au moins (niveau efficace). Le plancher descend
  aussitôt au niveau le plus bas entendu et ne remonte que lentement pendant les silences : une musique
  de fond constante devient le plancher, une parole dès le premier instant ne le fausse pas (il
  redescend au premier blanc entre deux mots). Les trames nulles du micro qui s'ouvre sont ignorées.
- **Personne ne parle en 5 s** : arrêt, « rien entendu » dans le champ, et **rien n'est envoyé** à la
  transcription (un modèle Whisper invente du texte sur un silence).
- **Écarté** : un modèle neuronal (Silero VAD par `@ricky0123/vad-web`, ≈ 2 Mo plus un moteur ONNX en
  WebAssembly), à reprendre derrière la même interface si le seuil se trompe à l'usage (TV, musique
  forte) ; la reconnaissance du navigateur (audio chez Google) ; la fin de tour d'un moteur en continu
  (Voxtral Realtime, que VoiceStudio ne fait pas).
- **Limites connues** : une hésitation de plus d'1 s coupe l'instruction ; une musique plus forte que
  la voix empêche la fin d'être vue (on retombe sur le bouton ou les 15 s). Les valeurs (1 s, 5 s,
  facteur 3, 0,01) sont **à régler sur un vrai micro**.

Tests : `vad.test.ts` (9 : fin après le silence voulu, hésitation, rien entendu, bruit bref, musique
de fond, parole dès le début, trames nulles), `useVoiceInput.autosend.test.ts` (3 : arrêt seul et
envoi, silence sans transcription, bouton toujours actif), `plugin.test.ts` (+1, interrupteur éteint) ;
contrôles négatifs faits (plancher qui ne redescend pas, détection débranchée → rouge).
**Non joué** : une vraie capture du micro (le panneau navigateur la bloque) et la pastille dans la
fiche du plugin (elle n'apparaît que plugin allumé, sur un serveur qui fait tourner ce code).

### Mise à jour 2026-10-11 (suite) — le champ reste vide après une commande vocale

Le texte entendu ne remplit plus le champ (barre et palette) : il part à l'assistant, et l'instruction
se lit en tête de la réponse. Dans la barre, le micro reprend la place du bout du champ dès que le champ
est vide, réponse affichée ou non : on enchaîne une autre commande vocale sans rien effacer. Détail dans
`../4_ui/4_1_navigation-et-panneaux.md` (mise à jour 8).

### Mise à jour 2026-10-12 — la réponse réécrite pour la voix

**Demande de l'utilisateur** : la synthèse prononce mal « RDC », le « h » de « 8h00 » ou « °C ». Il
fallait réécrire la réponse avant de l'envoyer au moteur, en pouvant ajouter facilement des
correspondances, et en pensant aux autres langues. Les abréviations des niveaux de la maison devaient
aussi être reprises automatiquement.

- **Où** : dans `speak()` (`index.ts`), juste avant `POST /v1/audio/speech`. Le champ `input` passe
  par `spokenText(text, language, houseWords)` (`spoken.ts`). Le texte affiché et le texte de
  l'historique ne changent pas : seule la synthèse reçoit la version réécrite.
- **Les tables** (`spoken-rules.ts`, `SPOKEN_RULES`), une par langue, avec `fr` et `en` pour
  commencer. Une ligne = une correspondance, sans ordre à tenir : les écritures les plus longues sont
  essayées d'abord (`kWh` avant `kW` avant `W`). Chaque table a :
  - `words` : mots et abréviations, en mot entier, casse ignorée (`RDC`, `n°`, `env.`, `1er`, `2e`…).
    Une clé qui finit sur un signe (`n°`, `env.`) reprend l'espace qui suit : « n°3 » devient
    « numéro 3 » ;
  - `units` : un symbole placé après un nombre, collé ou non → [singulier, pluriel] (`°C`, `%`, `kWh`,
    `km/h`, `A`, `€`…) ;
  - `plural` : quand le nombre prend le pluriel (sous 2 en français, « 1,5 degré » ; tout sauf 1 en
    anglais) ;
  - `minus` : le signe d'un nombre négatif (« -3 °C » → « moins 3 degrés ») ; il ne touche pas
    « 3-5 », où le tiret suit un nombre ;
  - `hours`, facultatif : « 8h00 », « 8 h 30 », « 14:05 » → « 8 heures », « 8 heures 30 »,
    « 14 heures 5 » (pas de « 00 », pas de zéro devant les minutes). Absent en anglais : l'heure est
    laissée au moteur.
- **La langue** est `STT_LANGUAGE`, celle de la dictée et de la synthèse. L'assistant répond dans la
  langue de la demande, et la demande est dictée dans cette langue : c'est cohérent tant que la dictée
  n'a qu'une langue. Une langue sans table passe telle quelle. **Non fait** : prendre la langue de
  chaque réponse (il faudrait que l'app l'envoie).
- **Les abréviations des niveaux** : l'app envoie `words` dans `POST /speak`
  (`{ text, words: { [shortName]: name } }`, `useVoiceInput.spokenWords()`), pour chaque niveau dont
  le `shortName` diffère du nom. C'est le même principe que le vocabulaire envoyé à la transcription :
  le plugin ne lit pas la maison lui-même, et un niveau renommé compte dès la réponse suivante. Côté
  serveur, ces mots passent **avant** les tables et **dans toutes les langues**, avec la **casse
  respectée** (une abréviation « ET » ne touche pas « et »). Une abréviation d'un seul caractère ou sans
  lettre (« E », « 1 ») est **écartée** : elle remplacerait des lettres ou des nombres de la phrase.
  Au plus 100 abréviations, de 12 caractères chacune (la limite de `shortName`) ; au-delà, 400
  `INVALID_BODY`.
- **Écarté** : demander à l'assistant d'écrire sans abréviations. La réponse sert aussi à l'écran, où
  « 8h00 » et « 21 °C » se lisent mieux. **Proposé, pas fait** : un fichier de correspondances propre à
  la maison, modifiable sans toucher au code.

Tests : `spoken.test.ts` (heures, unités et pluriel, abréviations, phrases qui ne doivent pas changer,
anglais, langue sans table, mots de la maison, et deux tests qui parcourent **chaque ligne de chaque
table** : une ligne ajoutée est testée d'office), `plugin.test.ts` (+2 : `input` réécrit,
abréviations reçues de l'app et refus d'une clé trop longue), `useVoiceInput.speech.test.ts` (+1 :
l'abréviation du niveau de la maison démo part avec la réponse). **Non joué** : l'écoute du rendu sur
VoiceStudio (en mode simulé, la synthèse n'existe pas).
