# Assistant (« Demander à Kasbah »)

> Dernière mise à jour : 2026-10-25
> Sources : `apps/server/src/assistant/{assistant,engines}.ts`, tests `apps/server/src/assistant/assistant.test.ts`, `apps/server/src/mcp/auth.ts` (`runToken`), `apps/server/src/app.ts`, `apps/web/src/composables/useAssistant.ts`, `apps/web/src/components/layout/{AssistantReply,SearchPalette,PageHeader}.vue`, `apps/web/src/components/home/SearchBar.vue`, `apps/web/src/components/settings/AssistantCard.vue`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`, session du 2026-10-07, `apps/web/src/composables/useVoiceInput.ts`, `apps/android/app/src/main/kotlin/org/kasbah/auto/VoiceScreen.kt`, session du 2026-10-22

## Ce que c'est

Donner une instruction **depuis l'app elle-même**, en texte : « allume la lampe de la cuisine »,
« quelle est la température de la piscine ? ». La dernière ligne de la recherche (palette Ctrl+K,
barre de la vue Maison) passe la saisie à un assistant IA qui tourne **sur le serveur** et agit par
les outils du serveur MCP (`1_7_serveur-mcp.md`) — les mêmes que Claude sur le téléphone. Jusque-là,
on ne pouvait commander la maison en langage naturel que depuis les apps des assistants.

C'est l'**étape 1** (texte). L'étape 2, la voix (transcription, Voxtral envisagé), passera son texte
à la même chaîne ; elle n'est pas commencée.

## Décisions (2026-10-07)

- **Moteur = plugin.** Le cœur ne connaît aucun fournisseur : il garde ce qui est commun, un plugin
  (Claude aujourd'hui, `../3_plugins/3_24_claude.md`) lance son CLI. D'autres CLI à la même forme
  (mode sans interface, config MCP, sortie JSON — Codex d'OpenAI, Gemini, Cursor) seraient d'autres
  plugins. Même découpe que les sources musicales et leur lecteur commun (`1_6_lecteur-musique.md`).
- **Pas de clé d'API** : chaque compte emploie son propre forfait chez le fournisseur (réglé dans la
  section du plugin), repli sur celui de la maison.
- **Une instruction = un appel**, sans mémoire de la précédente.
- **Haiku** pour Claude : le plus rapide, une commande de maison n'a pas besoin de plus.
- **Choisir entre plusieurs moteurs n'est pas décidé** : `currentAssistantEngine()` rend le premier
  inscrit ; on tranchera (par compte, pour la maison) quand un deuxième existera.

## Le contrat d'un moteur (`assistant/engines.ts`)

Un plugin s'inscrit à son `start()` par `registerAssistantEngine({ id, label, run })` et se retire à
son `stop()` (la fonction rendue). `run` reçoit :

| Champ | Contenu |
|---|---|
| `user` | le compte qui demande (`null` = la maison, réseau local) — ses comptes chez le fournisseur |
| `text` | l'instruction |
| `systemPrompt` | posé par le cœur : agir par les outils kasbah, sans confirmation sauf ambiguïté, répondre en une ou deux phrases sans markdown dans la langue de la demande, date et heure de Paris, qui demande |
| `mcp` | `{ url, token }` : `/mcp` de ce serveur (`http://127.0.0.1:<KASBAH_PORT>/mcp`) et un **jeton de course** au nom du compte |
| `emit` | événements : `tool` (nom sans préfixe : `send_command`), `tool_result`, `text`, puis **un** dernier mot `done` ou `error` |
| `signal` | annulé quand le client s'en va ou que le délai passe : tout arrêter et rendre la main **sans dernier mot** — le cœur dit pourquoi |

## Le cœur (`assistant/assistant.ts`)

- **`POST /api/assistant/ask`** `{ text }` (2 000 caractères au plus) → réponse **NDJSON** (une ligne
  JSON par événement), sans compression (`compress: false`, elle retiendrait les lignes). Une
  instruction à la fois **par compte** : la seconde reçoit 409 `BUSY`, un autre compte n'attend pas.
- **Jeton de course** : `auth.runToken(user, délai + 10 s)` (`mcp/auth.ts`) — en mémoire seulement,
  jamais écrit, accepté par `requireToken` avant les jetons OAuth, révoqué à la fin de l'appel.
  Un compte retiré entre-temps le rend invalide. Détails : `1_7_serveur-mcp.md`, mise à jour du
  2026-10-07 (soir).
- **Un dernier mot, toujours** : celui du moteur ; sinon `ABORTED` (client parti), `TIMEOUT` (60 s),
  `ENGINE_ERROR` (moteur muet ou en panne), `NO_ENGINE` (aucun plugin d'assistant allumé). Ce que le
  moteur dit après un dernier mot ou après l'annulation est ignoré.
- **Journal** : `.state/assistant-log.json` (`stateFile`, 0600), les **200** dernières instructions
  de tous les comptes, la plus récente d'abord : date, compte, instruction, outils (arguments gardés
  jusqu'à 2 000 caractères) avec leur résultat, réponse ou erreur, durée. Ajouts en file (deux comptes
  peuvent finir ensemble) ; le chemin du fichier est fixé au moment de l'ajout. **`GET
  /api/assistant/log`** : réseau local seulement (403 `LAN_ONLY` à un compte connecté par l'adresse
  publique) — on y voit les instructions de chacun.
- Sous l'adresse publique, la route passe par la porte à session comme le reste (origine exigée
  sur l'écriture) ; l'instruction agit au nom du compte connecté.

## L'app web

- **`useAssistant()`** (`composables/useAssistant.ts`) : état d'une instruction (`idle`, `running`,
  `done`, `error`), actions, réponse, erreur. `reset()` abandonne celle en cours (le serveur arrête
  le moteur). Un flux coupé sans dernier mot passe en erreur réseau.
- **Transport** : `assistantAsk(text, onEvent, signal)` lit le flux par `fetch` et
  `TextDecoderStream` (`streamLines` dans `httpTransport.ts`) ; `assistantLog()`. La simulation
  in-process répond « Mode démo : l'assistant a besoin du serveur Kasbah. ».
- **Affichage** : `AssistantReply.vue` — l'instruction, une ligne par outil appelé (libellé traduit,
  appareil ou ambiance nommés comme dans l'app, état en place réservée), la réponse, ou l'erreur dite
  en clair (`assistant.errors.*`). Le même composant sert au journal de Réglages. Placement dans la
  palette et la barre : `../4_ui/4_1_navigation-et-panneaux.md`, mise à jour du 2026-10-07.

## Mesures (2026-10-07, serveur jetable, plugin mock, Claude Haiku)

| Instruction | Ce qui s'est passé | Durée |
|---|---|---|
| `claude -p` nu, « Réponds juste : ok » | démarrage seul | 4,3 s |
| « Allume la lampe de la cuisine » | `list_devices` puis `send_command`, lampe allumée | 6,5 à 7,1 s |
| « Quelle est la température de la piscine ? » | `list_devices` seul | 4,5 s |

## Limites, suites

- Pas de conversation suivie ; pas de confirmation avant une action (Claude agit comme depuis son
  app mobile).
- Voix (étape 2) : micro = HTTPS obligatoire, que l'adresse publique a et le réseau local en `http://`
  non.
- Un deuxième moteur posera la question du choix (par compte, pour la maison).

### Mise à jour 2026-10-07 (soir) — l'étape 2, la voix

Le micro de la palette et de la barre dicte l'instruction : plugin `transcription`
(`../3_plugins/3_25_transcription.md`), trois fournisseurs (VoiceStudio en local, vLLM + Voxtral
Realtime sur le serveur, API Mistral) par la même route compatible OpenAI. Le texte entendu part à
l'assistant comme une instruction tapée : le cœur et les moteurs ne changent pas. Le micro sur le
réseau local en `http://` demande un drapeau Chrome par appareil (même page). La synthèse vocale des
réponses (Voxtral TTS, ≥ 16 Go de GPU, licence CC BY-NC) reste à faire.

### Mise à jour 2026-10-11 — coût dans le journal

- **Contrat** : `AssistantUsage` (`engines.ts`), `{ costUsd, inputTokens, outputTokens,
  cacheReadTokens, cacheWriteTokens }`, **optionnel** sur le dernier mot (`done` ou `error`) : un moteur
  qui ne le sait pas n'en met pas. Un champ en plus plutôt qu'un nouveau type d'événement : un client
  web resté en cache traite tout type inconnu comme une erreur (`useAssistant.apply`).
- **Journal** : `usage` gardé dans l'entrée (`record`) ; les entrées d'avant n'en ont pas.
- **Carte Assistant** (`AssistantCard.vue`) : « … · 4,2 s · ≈ 0,0031 $ » sur la ligne de chaque
  instruction chiffrée, les jetons au survol (`title`) ; sous le texte d'aide, « Total ≈ 0,016 $ pour
  2 instructions, au prix de l'API : le forfait ne facture rien à l'instruction. » (instructions
  chiffrées du journal affiché, absent s'il n'y en a aucune). Deux chiffres significatifs sous le
  dollar, deux décimales au-dessus. Pluriel par `$t(clé, { cost, k }, nombre)` : pas de champ `count`
  interpolé.
- Le coût vient du moteur Claude : voir `../3_plugins/3_24_claude.md` (prix catalogue, pas une
  facture).

Tests : `assistant.test.ts` (journal avec et sans `usage`), `AssistantCard.test.ts` (+2 : coût,
jetons et total ; pas de total sans instruction chiffrée) ; contrôle négatif fait. Vérifié dans la
preview sur le serveur de démo avec un journal inventé : fr et en, 1 280 et 375 px, sans débordement.

### Mise à jour 2026-10-22 — la synthèse vocale existe, et un client dans la voiture

La mise à jour du 2026-10-07 (soir) dit la synthèse vocale des réponses « reste à faire » : elle a été
faite depuis, par le même plugin (sous-item `speech`, route `POST /api/plugins/transcription/speak`,
voix du compte, moteur OmniVoice de VoiceStudio). Détail dans
[3_25 Transcription](../3_plugins/3_25_transcription.md). La phrase du 2026-10-07 n'est pas réécrite :
elle disait vrai ce jour-là.

L'appli Android Auto ([1_15](1_15_appli-android-auto.md)) est un deuxième client de
`/api/assistant/ask` : bouton « Parler » sur l'écran de la voiture, micro de la voiture, transcription,
instruction, réponse dite par `speak` (ou par la voix d'Android si la route refuse). Elle lit le flux
NDJSON en entier et ne garde que les lignes `text` et `error` ; le cœur ne change pas.

### Mise à jour 2026-10-25 — un bouton dans l'en-tête de toutes les pages

Les points d'entrée de « L'app web » (palette Ctrl+K, barre de la vue Maison) gagnent un troisième :
un bouton dans l'en-tête commun (`components/layout/PageHeader.vue`), sur toutes les vues, qui ouvre
la même palette. Au doigt, il l'ouvre sans faire monter le clavier : le micro est à portée. Le cœur,
les moteurs et `useAssistant` ne changent pas. Placement et mesures :
[4_1 Navigation et panneaux](../4_ui/4_1_navigation-et-panneaux.md), mise à jour du 2026-10-25.
