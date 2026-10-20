# Claude (the assistant engine)

| | |
|---|---|
| **Id** | `claude` |
| **Role** | engine of the "Ask Kasbah" assistant: an instruction in natural language, carried out by Claude with Kasbah's tools |
| **Connection** | **Claude Code** (`claude -p`) run on the server machine, plugged into Kasbah's MCP server |
| **Account** | each account's **Claude plan** (subscription, no API key), through a token from `claude setup-token` |
| **Views** | Ctrl+K palette and Home view bar ("Ask Kasbah"), Settings → Plugins, Settings → Assistant (log) |

## What the plugin does

- **Ask Kasbah**: an instruction typed into search (Ctrl+K, or the Home view bar) — "turn everything off on the ground floor", "put France Inter on in the kitchen" — goes to Claude on the server, which acts through Kasbah's tools (devices, light scenes, music, radio, school, server status) and answers in one sentence. The tools in use are shown while it works.
- **Dictation**: with the [transcription](transcription.md) plugin, the instruction can be spoken into the microphone, and the answer can be read aloud.
- **Log**: the last 200 instructions, from all accounts, in Settings → Assistant (visible from the local network only).

The plugin publishes no device: it does not appear in the 3D house. Without it, "Ask Kasbah" answers that no assistant is enabled.

## Each account's plan

No API key: everyone uses **their own Claude subscription**.

1. On a computer where Claude Code is installed, run `claude setup-token` and sign in to claude.ai: the command prints a token `sk-ant-oat01-…` valid for **one year**.
2. Paste it into **Settings → Plugins → claude**, then **Save**.

When signed in (public address), the token is the one **for your account**; on the local network, the one **for the house**. For an instruction, Kasbah uses the token of the account that is asking, otherwise the house's, otherwise the `claude` sign-in already done on the server machine. The card says which one is in use. The token is kept by the server (in a file readable only by it) and **never goes back to the browser**. To remove the token: **Remove token**, then confirm.

Anthropic's terms reserve a Claude account for one person: falling back to the house plan makes the other accounts run on it.

## Setup

1. Install **Claude Code** on the machine that hosts Kasbah (the `claude` binary, in the server's `PATH` or given by `CLAUDE_BIN`).
2. Tick **claude** in **Settings → Plugins**. The plugin's health states the version of `claude` and the model used, or that the binary cannot be found.
3. Paste a token (see above), or have signed in once with `claude` on the server machine.
4. Open search (Ctrl+K), type an instruction, choose **Ask Kasbah**.

## Security

Claude receives **only** Kasbah's tools: no commands, no files, no web, no other MCP server, no setting or file of the machine. It acts with the rights of the account that is asking, through a per-run token revoked at the end of the instruction.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Claude Code binary (the server's `PATH`, otherwise an absolute path) |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Model: a full ID (pinned version) or a CLI alias (`haiku`, `sonnet`), which follows new releases with a delay. Applied at restart |
| `CLAUDE_KEEP_SESSIONS` | `false` | Keep the `claude -p` sessions for debugging (reasoning included) |

## Limitations

- One instruction at a time per account (another account does not wait); after 60 s without an answer, it is abandoned.
- The Claude plan's usage limit applies: the assistant says so when it is reached.
- A rejected token (expired, revoked) is reported at the first instruction: renew it with `claude setup-token`.

## Further reading

Internals, locked-down launch, CLI output and pitfalls: [wiki, Claude](../../doc/3_plugins/3_24_claude.md) (in French); the assistant: [wiki, assistant](../../doc/1_architecture/1_9_assistant.md) (in French).
