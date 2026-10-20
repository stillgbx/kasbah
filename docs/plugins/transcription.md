# Transcription (the assistant's voice)

| | |
|---|---|
| **Id** | `transcription` |
| **Role** | dictate an instruction to the assistant instead of typing it; optionally, hear its answer read aloud |
| **Connection** | a transcription engine through the OpenAI-compatible `/v1/audio/transcriptions` route: **VoiceStudio** locally, **vLLM** (Voxtral Realtime) on a server, or the **Mistral API** |
| **Account** | none, except the API key for Mistral; the answers' voice is chosen **per signed-in account** |
| **Views** | Ctrl+K palette and Home view bar (microphone button), Settings → Plugins |

## What the plugin does

- **Dictate**: a microphone button at the end of the Ctrl+K palette field and of the Home view bar. Press to speak, press to finish (stops by itself after 15 s): the text heard is sent **immediately** to the assistant, like an instruction typed and then submitted.
- **Send at the end of the sentence** ("Send at the end of the sentence" switch, on by default): listening stops by itself after one second of silence, without pressing Finish; the button remains to cut it short. If nobody speaks within the first 5 seconds, nothing is sent. Loud music can prevent the end from being detected: the button then takes over.
- **House vocabulary**: the names of rooms, zones, light scenes and devices are sent to the engine, which therefore recognizes "Kitchen spots" rather than a similar-sounding word.
- **Spoken answers** ("Read answers aloud" switch, off by default): the assistant's answer to a **dictated** instruction is spoken aloud, on the device that spoke (not on the speakers). A typed instruction keeps a written answer.
- **Pronunciation**: before synthesis, the answer is rewritten so that it can be spoken in full. In French, "8h00" becomes "8 heures", "21 °C" becomes "21 degrés", "80 %" becomes "80 pour cent", "RDC" becomes "rez-de-chaussée". The abbreviation of each level of the house is replaced by its name. The displayed text does not change. The mappings are in `apps/server/src/plugins/transcription/spoken-rules.ts`, one table per language (French and English): adding a replacement means adding a line there.
- **Answers' voice**: the plugin's card offers the voices created at the provider (VoiceStudio's profiles). See below.
- **VoiceStudio without its window** ("Start VoiceStudio without its window" switch, off by default): Kasbah starts VoiceStudio's engine at its own startup and stops it with itself, without opening the application.

The plugin publishes no device: it does not appear in the 3D house. The microphone only shows if the plugin is running and knows where to send the audio.

## The answers' voice, per account

In **Settings → Plugins → transcription**, the "Spoken answers voice" list:

- **on the local network** (not signed in), it sets the **house voice**; "Default voice" goes back to `TTS_VOICE`;
- **signed in** (public address), it sets the voice **of your account only**. The first option, "House voice", means "no personal choice": the house voice is used, and follows its changes.

For each answer, Kasbah takes the voice of the account that spoke, otherwise the house's, otherwise `TTS_VOICE`. The choice applies from the next answer, without a restart. A signed-in account does not change the house voice; a voice deleted at the provider stays displayed ("not found at the provider") until another is chosen.

## Setup

### VoiceStudio (default, on a Windows PC)

1. Install [VoiceStudio](https://voicestudio.sh/), choose a Whisper transcription engine and check that it transcribes French. For spoken answers, a synthesis engine (OmniVoice); personal voices are created in the application.
2. In `apps/server/.env`: `STT_PROVIDER=voicestudio` and `STT_URL=http://127.0.0.1:3900` (or the address of the PC running it).
3. Tick **transcription** in **Settings → Plugins**. Turn on spoken answers if wanted, and starting VoiceStudio without its window (only if `STT_URL` is on the server's machine).

### vLLM (Voxtral Realtime)

`STT_PROVIDER=vllm` (and `STT_URL` if vLLM does not listen on `http://localhost:8000`). It needs 16 GB of GPU memory and Linux (WSL2 on Windows): the recipe is in the wiki.

### Mistral API

`STT_PROVIDER=mistral` and `STT_API_KEY=<key from console.mistral.ai>`. No local GPU.

### The microphone on the local network

The browser **refuses the microphone** on an `http://` address that is not `localhost`. Two routes: go through the public address (HTTPS), or allow the local address in Chrome on each device (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enter for example `http://192.168.1.90:8787`, then **Relaunch**). There is no equivalent on iPhone and iPad: public address.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `STT_PROVIDER` | `voicestudio` | `voicestudio`, `vllm` or `mistral` |
| `STT_URL` | depends on the provider (none for VoiceStudio) | Root of the server, without `/v1` |
| `STT_MODEL` | depends on the provider (`whisper-1` for VoiceStudio) | Transcription model |
| `STT_API_KEY` | — | Provider key, required for Mistral |
| `STT_LANGUAGE` | `fr` | Spoken language (no detection); also selects the pronunciation table for answers |
| `TTS_MODEL` | `tts-1` | Synthesis model (`tts-1` = VoiceStudio's active engine) |
| `TTS_VOICE` | `default` | Voice of the answers when neither the house nor the account has chosen one |
| `VOICESTUDIO_DIR` | the one the application records in `%APPDATA%` | VoiceStudio runtime, for starting without its window |

Voice choices are kept by the server: `apps/server/.state/transcription.json` for the house, each account's state folder for its own.

## Limitations

- An instruction lasts **15 s** at most; a spoken answer, 1,000 characters.
- Pronunciation follows `STT_LANGUAGE`, not the language of each answer: a language with no table goes through as is (only the level abbreviations are replaced).
- Spoken answers and the voice list have only been tried with VoiceStudio (neither vLLM nor Mistral).
- Any restart of the plugin (including flipping one of its switches) reloads the VoiceStudio started without its window (about 10 s).
- Do not open the VoiceStudio application while Kasbah holds its port: turn the switch off first.

## Further reading

Internals, routes, measurements and pitfalls: [wiki, Transcription](../../doc/3_plugins/3_25_transcription.md) (in French); the assistant: [wiki, assistant](../../doc/1_architecture/1_9_assistant.md) (in French).
