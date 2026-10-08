# Claude (le moteur de l'assistant)

| | |
|---|---|
| **Id** | `claude` |
| **Rôle** | moteur de l'assistant « Demander à Kasbah » : une instruction en langage naturel, exécutée par Claude avec les outils de Kasbah |
| **Connexion** | **Claude Code** (`claude -p`) lancé sur la machine du serveur, branché sur le serveur MCP de Kasbah |
| **Compte** | le **forfait Claude** (abonnement, pas de clé d'API) de chaque compte, par un jeton de `claude setup-token` |
| **Vues** | palette Ctrl+K et barre de la vue Maison (« Demander à Kasbah »), Réglages → Plugins, Réglages → Assistant (journal) |

## Ce que fait le plugin

- **Demander à Kasbah** : une instruction tapée dans la recherche (Ctrl+K, ou la barre de la vue Maison) — « éteins tout au rez-de-chaussée », « mets France Inter dans la cuisine » — part à Claude sur le serveur, qui agit par les outils de Kasbah (appareils, ambiances, musique, radio, école, état du serveur) et répond en une phrase. Les outils employés s'affichent pendant qu'il travaille.
- **Dictée** : avec le plugin [transcription](transcription.md), l'instruction se dit au micro, et la réponse peut être lue à voix haute.
- **Journal** : les 200 dernières instructions, de tous les comptes, dans Réglages → Assistant (visible depuis le réseau local seulement).

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D. Sans lui, « Demander à Kasbah » répond qu'aucun assistant n'est activé.

## Le forfait de chaque compte

Pas de clé d'API : chacun emploie **son abonnement Claude**.

1. Sur un ordinateur où Claude Code est installé, lancer `claude setup-token`, se connecter à claude.ai : la commande affiche un jeton `sk-ant-oat01-…` valable **un an**.
2. Le coller dans **Réglages → Plugins → claude**, puis **Enregistrer**.

Connecté (adresse publique), le jeton est celui **de votre compte** ; sur le réseau local, celui **de la maison**. Pour une instruction, Kasbah prend le jeton du compte qui demande, sinon celui de la maison, sinon la connexion `claude` déjà faite sur la machine du serveur. La carte dit lequel sert. Le jeton est gardé par le serveur (fichier lisible par lui seul) et **ne repart jamais vers le navigateur**. Retirer le jeton : **Retirer le jeton**, puis confirmer.

Les conditions d'Anthropic réservent un compte Claude à une personne : le repli sur le forfait de la maison fait tourner les autres comptes sur celui-ci.

## Mise en route

1. Installer **Claude Code** sur la machine qui héberge Kasbah (le binaire `claude`, dans le `PATH` du serveur ou indiqué par `CLAUDE_BIN`).
2. Cocher **claude** dans **Réglages → Plugins**. La santé du plugin dit la version de `claude` et le modèle employé, ou que le binaire est introuvable.
3. Coller un jeton (voir plus haut), ou s'être connecté une fois avec `claude` sur la machine du serveur.
4. Ouvrir la recherche (Ctrl+K), taper une instruction, choisir **Demander à Kasbah**.

## Sécurité

Claude ne reçoit **que** les outils de Kasbah : ni commandes, ni fichiers, ni web, aucun autre serveur MCP, aucun réglage ni fichier de la machine. Il agit avec les droits du compte qui demande, par un jeton de course révoqué à la fin de l'instruction.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Binaire de Claude Code (le `PATH` du serveur, sinon un chemin absolu) |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Modèle : un ID complet (version figée) ou un alias de la CLI (`haiku`, `sonnet`), qui suit les sorties avec du retard. Pris en compte au redémarrage |
| `CLAUDE_KEEP_SESSIONS` | `false` | Garder les sessions de `claude -p` pour déboguer (réflexion comprise) |

## Limites

- Une instruction à la fois par compte (un autre compte n'attend pas) ; au-delà de 60 s sans réponse, elle est abandonnée.
- La limite d'usage du forfait Claude s'applique : l'assistant le dit quand elle est atteinte.
- Un jeton refusé (expiré, révoqué) se dit à la première instruction : le refaire avec `claude setup-token`.

## Pour aller plus loin

Fonctionnement interne, lancement verrouillé, sortie de la CLI et pièges : [wiki, Claude](../../doc/3_plugins/3_24_claude.md) ; l'assistant : [wiki, assistant](../../doc/1_architecture/1_9_assistant.md).
