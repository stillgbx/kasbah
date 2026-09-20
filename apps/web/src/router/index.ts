import { createRouter, createWebHashHistory } from 'vue-router'

// Historique par hash : le build est servi en `base: './'` par le serveur Fastify ou depuis un
// dossier statique, sans configuration de réécriture côté serveur.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/lights', name: 'lights', component: () => import('../views/LightsView.vue') },
    { path: '/covers', name: 'covers', component: () => import('../views/CoversView.vue') },
    { path: '/cameras', name: 'cameras', component: () => import('../views/CamerasView.vue') },
    { path: '/media', name: 'media', component: () => import('../views/MediaView.vue') },
    { path: '/ytmusic', name: 'ytmusic', component: () => import('../views/YtmusicView.vue') },
    { path: '/energy', name: 'energy', component: () => import('../views/EnergyView.vue') },
    { path: '/water', name: 'water', component: () => import('../views/WaterView.vue') },
    { path: '/heating', name: 'heating', component: () => import('../views/HeatingView.vue') },
    { path: '/vehicles', name: 'vehicles', component: () => import('../views/VehiclesView.vue') },
    { path: '/robots', name: 'robots', component: () => import('../views/RobotsView.vue') },
    { path: '/weather', name: 'weather', component: () => import('../views/WeatherView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
