import { createRouter, createWebHistory } from 'vue-router'

// Historique HTML5 (pas de `#`) : le serveur Fastify renvoie index.html pour tout GET hors /api et
// /ws (repli SPA), Vite fait de même en dev. Un ancien lien `/#/music` est réécrit en `/music`.
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
    // ancien nom de la vue (une seule source à l'époque) : un signet y mène encore
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
    { path: '/automations', name: 'automations', component: () => import('../views/AutomationsView.vue') },
    // l'édition a sa page : « Sauf si » et « Alors » s'allongent, un panneau de 340 px n'y suffit pas.
    // `:id` = id de l'automatisation, ou `new`. `meta.nav` garde l'entrée du rail allumée.
    { path: '/automations/:id', name: 'automation-edit', component: () => import('../views/AutomationEditView.vue'), props: true, meta: { nav: 'automations' } },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
