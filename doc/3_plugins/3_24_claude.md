# Plugin Claude (moteur de l'assistant, `claude -p`)

> Dernière mise à jour : 2026-10-08
> Sources : `apps/server/src/plugins/claude/{index,run}.ts`, tests `apps/server/src/plugins/claude/{plugin,run}.test.ts` et `test-claude.ts`, `apps/server/src/assistant/engines.ts`, `apps/server/src/plugins/index.ts`, `apps/web/src/components/ClaudeLinkCard.vue`, `apps/web/src/components/settings/PluginSection.vue`, CLI Claude Code 2.1.288 (`claude --help`), session du 2026-10-07, page utilisateur `docs/plugins/claude-assistant.md` (2026-10-08)

## Ce que c'est

Le **moteur** de l'assistant (`../1_architecture/1_9_assistant.md`) : un plugin **sans appareil** qui,
pour chaque instruction, lance Claude Code en mode non interactif (`claude -p`) sur la machine du
serveur, branché sur le MCP de Kasbah. Il s'inscrit auprès du cœur à son `start()`
(`registerAssistantEngine`) et se retire à son `stop()`. Éteint par défaut, comme tout plugin :
Réglages → Plugins → **claude**.

## Le compte Claude de chaque utilisateur (pas de clé d'API)

- **Jeton d'abonnement** : chacun lance une fois `claude setup-token` sur un poste où Claude Code est
  installé ; la commande ouvre claude.ai pour se connecter et affiche un jeton `sk-ant-oat01-…`
  valable **un an**. `claude -p` le lit dans `CLAUDE_CODE_OAUTH_TOKEN` (relevé dans le binaire de la
  CLI : « Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token> »). Aucune connexion à
  faire sur le serveur.
- **Rangement** : `.state/users/<compte>/claude.json` (`userStateFile`), `.state/claude.json` pour la
  maison ; 0600. Le jeton **ne repart jamais** vers le navigateur : les routes ne disent que
  `savedAt` et si la maison en a un. Retirer un compte efface son dossier, donc son jeton.
- **Routes** (`/api/plugins/claude/…`, compte courant comme les cartes de musique : le sien sous
  l'adresse publique, la maison sur le réseau local) : `GET /account` → `{ user, savedAt, house }`,
  `PUT /account { token }` (forme `sk-ant-[\w-]{20,500}` vérifiée, pas la version), `DELETE /account`.
- **Repli, pour tous** (décision de l'utilisateur) : jeton du compte, sinon celui de la maison, sinon
  la connexion `claude` déjà faite sur la machine du serveur. L'utilisateur a été prévenu que les
  conditions d'Anthropic réservent un compte à une personne : le repli fait tourner d'autres personnes
  sur le forfait de la maison.
- **Carte** : `ClaudeLinkCard.vue`, dans la section du plugin (`SETUP_CARDS` de `PluginSection.vue`),
  dit quel forfait sert (« Aucun jeton pour alice. Le forfait de la maison sert en attendant. »).

## Le lancement, verrouillé (`run.ts`)

```
claude -p --model <CLAUDE_MODEL>
  --tools "" --strict-mcp-config --mcp-config <fichier> --allowedTools mcp__kasbah
  --setting-sources "" [--no-session-persistence]
  --system-prompt <prompt du cœur> --output-format stream-json --verbose
```

- **Aucun outil intégré** (`--tools ""` : ni Bash, ni fichiers, ni web) ; **le seul MCP Kasbah**
  (`--strict-mcp-config`), outils autorisés d'avance (`--allowedTools mcp__kasbah`, sinon `-p` les
  refuserait).
- **Le jeton de course** dans un fichier `mcp-<uuid>.json` 0600, effacé à la fin — jamais sur la ligne
  de commande, que les autres processus de la machine voient.
- **Rien de la machine** : dossier courant vide (`.state/claude/cwd`, pas de `CLAUDE.md`), aucun
  réglage (`--setting-sources ""`), et l'environnement du serveur **filtré** de tout ce qui commence
  par `CLAUDE` ou `ANTHROPIC` (une clé d'API héritée prendrait le pas sur le forfait ; les plugins de
  la session qui a lancé le serveur passaient par là). Avec un jeton : `CLAUDE_CODE_OAUTH_TOKEN` et un
  dossier de config isolé (`CLAUDE_CONFIG_DIR=.state/claude/config`).
- **L'instruction par l'entrée standard**, pas en argument.
- **Sessions** : non gardées (`--no-session-persistence`), sauf `CLAUDE_KEEP_SESSIONS=1` pour
  déboguer : transcriptions JSONL dans `<config>/projects/` — sous `.state/claude/config/` avec un
  jeton, dans le `~/.claude` du serveur en repli (mêlées aux sessions de l'utilisateur). Cette option
  n'a pas été essayée en réel (seul le test unitaire vérifie l'argument).

## La sortie `stream-json` (relevée sur la CLI 2.1.288)

| Ligne | Traduction |
|---|---|
| `system` / `init`, `mcp_servers[]` | si `kasbah` n'est pas `connected` → `MCP_UNAVAILABLE`, `claude` tué |
| `assistant`, blocs `tool_use` | `tool` (préfixe `mcp__kasbah__` retiré) |
| `assistant`, blocs `text` | `text` (les blocs `thinking` sont ignorés) |
| `user`, blocs `tool_result` | `tool_result` (`ok = !is_error`) |
| `result`, `is_error: false` | `done` |
| `result`, `is_error: true` | `api_error_status` 401 → `CLAUDE_AUTH`, 429 → `CLAUDE_LIMIT`, sinon `CLAUDE_ERROR` (texte de `result`) |

- Un message `assistant` **synthétique** porte `error` (ex. `authentication_failed`, avec un texte
  « Failed to authenticate… ») : il n'est pas montré comme une réponse, le `result` suit.
- Binaire introuvable (`ENOENT`) → `CLAUDE_MISSING` ; sortie sans `result` → `CLAUDE_ERROR` avec la
  fin de stderr.
- Annulé par le cœur : `claude` tué, rien n'est émis (même quand l'annulation arrive pendant la
  préparation des fichiers, avant le lancement).

## Santé

`claude --version` est lancé au démarrage du plugin : `ok` « claude 2.1.288 — claude-haiku-5-5 — house token set » (ou
« no house token: the server's claude sign-in is used ») ; `error` « claude not found (CLAUDE_BIN,
or the server PATH) » quand le binaire manque — visible dans Réglages avant la première instruction.

## Configuration

| Clé | Défaut | Rôle |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Binaire (le `PATH` du processus serveur ; chemin absolu sinon). |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Modèle de `--model` : ID complet (version figée) ou alias de la CLI (voir plus bas). |
| `CLAUDE_KEEP_SESSIONS` | `false` | Garder les sessions de `claude -p` (voir plus haut). |

## Pièges rencontrés (2026-10-07)

- **L'alias `haiku` retarde sur les sorties** : avec la CLI 2.1.288, `--model haiku` lançait encore
  `claude-haiku-4-5-20251001` (champ `model` de la ligne `init`) alors que Haiku 5.5 était sorti, et
  `--model claude-haiku-5-5` était accepté. D'où `CLAUDE_MODEL`, un ID complet par défaut : changer de
  modèle = une ligne du `.env` et un redémarrage ; la santé dit le modèle employé.
- **`--safe-mode` coupe aussi les serveurs MCP** (`mcp_servers: []` dans `init`) : il ne peut pas
  servir à ignorer la configuration personnelle de la machine. Voir `../6_faq/6_1_pieges-runtime.md`.
- **`--bare`** n'accepte que `ANTHROPIC_API_KEY` ou un `apiKeyHelper` (« OAuth and keychain are never
  read ») : inutilisable avec un forfait.
- **Config re-validée** : l'hôte passe une config déjà transformée (`CLAUDE_KEEP_SESSIONS` booléen) ;
  la revalider dans `init` mettait le plugin en erreur. Récidive du piège Hue de 2026-09-04
  (`../6_faq/6_1_pieges-runtime.md`, règle dans `3_2_ecrire-un-plugin.md`). Les tests passent
  désormais la config telle que l'hôte la donne.

## Tests et vérification

- `run.test.ts` (11) : traduction de la sortie, verrouillage des arguments, jeton de course en fichier
  effacé, environnement filtré, MCP injoignable, 401, binaire absent, sortie interrompue, annulation
  (avant et après le lancement). Faux `claude` : `test-claude.ts`, lignes relevées sur le vrai.
- `plugin.test.ts` : inscription et retrait du moteur, forfait du compte puis de la maison puis de la
  machine, santé (version, binaire absent), routes du jeton (jamais rendu, forme refusée).
- Contrôles négatifs faits (révocation retirée, `--tools ""` retiré, annulation précoce, dernier mot
  du cœur).
- En réel, sur un serveur jetable (maison de démo, plugin mock, port 9799) : plugin éteint →
  `NO_ENGINE` ; allumé → santé « claude 2.1.288 », plafonnier allumé en 6,5 s ; jeton invalide →
  `CLAUDE_AUTH` en 3,8 s.
