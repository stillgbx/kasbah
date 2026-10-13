import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 trouve son worker par une adresse CALCULÉE à côté de son module
// (`new URL(\`./${nom}\`, import.meta.url)`), que le build ne voit pas : le build livré n'avait pas de
// `maplibre-gl-worker.mjs`, le serveur rendait la page de l'application à sa place (« non-JavaScript
// MIME type »), et les cartes tournaient sans worker. Ici, Vite empaquette le worker (avec
// `maplibre-gl-shared.mjs`, qu'il importe) et on lui donne son adresse. À importer par tout composant
// qui crée une carte, avant la première.
setWorkerUrl(workerUrl)
