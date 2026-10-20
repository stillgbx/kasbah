import { createRouter, createWebHistory } from 'vue-router'
import { getTransport } from '../api'

// HTML5 history (no `#`): the Fastify server returns index.html for any GET outside /api and
// /ws (SPA fallback), Vite does the same in dev. An old `/#/music` link is rewritten to `/music`.
if (location.hash.startsWith('#/')) history.replaceState(history.state, '', location.hash.slice(1))

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/lights', name: 'lights', component: () => import('../views/LightsView.vue') },
    { path: '/covers', name: 'covers', component: () => import('../views/CoversView.vue') },
    { path: '/cameras', name: 'cameras', component: () => import('../views/CamerasView.vue') },
    { path: '/media', name: 'media', component: () => import('../views/MediaView.vue') },
    { path: '/music', name: 'music', component: () => import('../views/MusicView.vue') },
    // old name of the view (a single source at the time): a bookmark still leads there
    { path: '/ytmusic', redirect: '/music' },
    { path: '/energy', name: 'energy', component: () => import('../views/EnergyView.vue') },
    { path: '/water', name: 'water', component: () => import('../views/WaterView.vue') },
    { path: '/heating', name: 'heating', component: () => import('../views/HeatingView.vue') },
    { path: '/vehicles', name: 'vehicles', component: () => import('../views/VehiclesView.vue') },
    { path: '/robots', name: 'robots', component: () => import('../views/RobotsView.vue') },
    { path: '/pets', name: 'pets', component: () => import('../views/PetsView.vue') },
    { path: '/tens', name: 'tens', component: () => import('../views/TensView.vue') },
    { path: '/weather', name: 'weather', component: () => import('../views/WeatherView.vue') },
    { path: '/agenda', name: 'agenda', component: () => import('../views/AgendaView.vue') },
    { path: '/school', name: 'school', component: () => import('../views/SchoolView.vue') },
    { path: '/shopping', name: 'shopping', component: () => import('../views/ShoppingView.vue') },
    { path: '/automations', name: 'automations', component: () => import('../views/AutomationsView.vue') },
    // editing has its own page: "Unless" and "Then" grow longer, a 340 px panel is not enough.
    // `:id` = the automation's id, or `new`. `meta.nav` keeps the rail entry lit.
    { path: '/automations/:id', name: 'automation-edit', component: () => import('../views/AutomationEditView.vue'), props: true, meta: { nav: 'automations' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// A view that fails to load, under the public address, is often an ended session (the server
// then refuses its files): we ask the API, which redirects to login if needed.
// Valid session, it is a replaced build (the screen stayed open during an update, its view
// no longer exists): we reload the page on the requested view, ONCE — a view still not found
// after the reload must not loop.
const CHUNK_RELOAD_KEY = 'kasbah.chunkReloadAt'
const CHUNK_RELOAD_WINDOW_MS = 10_000

router.onError((err, to) => {
  getTransport().session().then(() => {
    if (!(err instanceof TypeError)) return // a failing import is a TypeError in all browsers
    try {
      if (Date.now() - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0) < CHUNK_RELOAD_WINDOW_MS) return
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
    } catch { return } // without storage, no guard: no automatic reload
    window.location.assign(router.resolve(to).href)
  }).catch(() => {})
})
