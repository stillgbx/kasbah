import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { vuetify } from './plugins/vuetify'
import { useSettingsStore } from './stores/settings'
import './styles/app.css'

// Ordre : pinia → réglages (thème/langue appliqués AVANT le mount pour éviter tout flash) → mount.
const pinia = createPinia()
const app = createApp(App).use(pinia).use(i18n).use(router).use(vuetify)

const settings = useSettingsStore(pinia)
settings.applyToVuetify(vuetify.theme)
settings.applyLocale(i18n)

app.mount('#app')
