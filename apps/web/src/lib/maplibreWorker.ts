import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 finds its worker through a COMPUTED address next to its module
// (`new URL(\`./${nom}\`, import.meta.url)`), which the build does not see: the shipped build had no
// `maplibre-gl-worker.mjs`, the server returned the application's page in its place ("non-JavaScript
// MIME type"), and the maps ran without a worker. Here, Vite bundles the worker (with
// `maplibre-gl-shared.mjs`, which it imports) and we give it its address. To be imported by every component
// that creates a map, before the first one.
setWorkerUrl(workerUrl)
