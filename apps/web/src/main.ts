import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { vuetify } from './plugins/vuetify'
import { usePushStore } from './stores/push'
import { useSettingsStore } from './stores/settings'
import './styles/app.css'

// Order: pinia → settings (theme/language applied BEFORE the mount to avoid any flash) → mount.
const pinia = createPinia()
const app = createApp(App).use(pinia).use(i18n).use(router).use(vuetify)

const settings = useSettingsStore(pinia)
settings.applyToVuetify(vuetify.theme)
settings.applyLocale(i18n)

app.mount('#app')
// push notifications: the service worker, and this screen's subscription sent again
void usePushStore(pinia).init()
