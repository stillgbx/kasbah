import { createRouter, createWebHashHistory } from 'vue-router'

// Historique par hash : le build est servi en `base: './'` par le serveur Fastify ou depuis un
// dossier statique, sans configuration de réécriture côté serveur.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/lights', name: 'lights', component: () => import('../views/LightsView.vue') },
    { path: '/energy', name: 'energy', component: () => import('../views/EnergyView.vue') },
    { path: '/vehicles', name: 'vehicles', component: () => import('../views/VehiclesView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
