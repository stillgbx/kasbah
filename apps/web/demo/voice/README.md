# Spoken answers of the demo assistant

The static demo (`npm run build:demo -w @kasbah/web`) copies this folder, without this file, beside
its build (`voice/`). `src/api/demoAssistant.ts` plays `<request>.<lang>.mp3` after a dictated
request: `lights`, `bedrooms`, `movie`, each in `en` and `fr`, the answers written in
`DEMO_REQUESTS`. Without them, the demo shows its answers without saying them.

Made with a stock voice of a text-to-speech model (no cloned voice: these files are public), then
converted to mono MP3:

```bash
ffmpeg -i lights.en.wav -ac 1 -b:a 64k lights.en.mp3
```
