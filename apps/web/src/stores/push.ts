import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { NOTIFY_CATEGORIES, type NotifyCategory } from '@kasbah/shared'
import { getTransport } from '../api'
import { router } from '../router'
import { useSettingsStore } from './settings'

// Push notifications of THIS screen: the service worker (`public/sw.js`), its subscription to the
// server, and the categories chosen here. The browser holds the subscription, the server a copy of
// it with the categories; each opening of the app sends them again, which also carries a renewed
// endpoint or a subscription the server dropped.
//
// Web Push needs a secure context: through the public address (HTTPS) or `localhost`, never
// `http://<poste>:8787`. On an iPhone, only once the app is installed on the home screen.

/** Why this screen cannot subscribe; `null` = it can. */
export type PushUnsupported = 'insecure' | 'install' | 'browser'

const SW_URL = '/sw.js'

function unsupportedReason(): PushUnsupported | null {
  if (typeof window === 'undefined') return 'browser'
  if (!window.isSecureContext) return 'insecure'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return null
  // iOS only exposes Web Push to an app installed on the home screen
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  return ios && !window.matchMedia('(display-mode: standalone)').matches ? 'install' : 'browser'
}

/** The VAPID key (base64url) as `applicationServerKey` wants it. */
function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const toB64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const usePushStore = defineStore('push', () => {
  const settings = useSettingsStore()
  const unsupported = unsupportedReason()
  /** The categories this screen wants; all of them by default. */
  const categories = useLocalStorage<NotifyCategory[]>('kasbah.push.categories', [...NOTIFY_CATEGORIES])
  const subscription = ref<PushSubscription | null>(null)
  const permission = ref<NotificationPermission>(unsupported ? 'default' : Notification.permission)
  const busy = ref(false)
  const enabled = computed(() => subscription.value !== null)

  let registration: Promise<ServiceWorkerRegistration> | null = null
  const ready = () => (registration ??= navigator.serviceWorker.register(SW_URL).then(() => navigator.serviceWorker.ready))

  const send = (sub: PushSubscription) => {
    const json = sub.toJSON()
    return getTransport().pushSubscribe({
      subscription: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } },
      categories: categories.value.filter((c) => NOTIFY_CATEGORIES.includes(c)),
      lang: settings.resolvedLocale,
    })
  }

  /** At startup: the worker, the subscription already there (sent again), the taps on a notification. */
  async function init() {
    if (unsupported) return
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === 'kasbah:navigate' && e.data.url) void router.push(e.data.url)
    })
    try {
      subscription.value = await (await ready()).pushManager.getSubscription()
      if (subscription.value) await send(subscription.value)
    } catch { /* server unreachable: sent again at the next opening */ }
  }

  /** Asks the permission, subscribes, and sends the subscription to the server. */
  async function enable() {
    if (unsupported || busy.value) return
    busy.value = true
    try {
      permission.value = await Notification.requestPermission()
      if (permission.value !== 'granted') return
      const { publicKey } = await getTransport().pushKey()
      const reg = await ready()
      let sub = await reg.pushManager.getSubscription()
      // a subscription made with another key (server state reset) is refused by the push service
      if (sub?.options.applicationServerKey && toB64u(sub.options.applicationServerKey) !== publicKey) {
        await sub.unsubscribe()
        sub = null
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      await send(sub)
      subscription.value = sub
    } finally { busy.value = false }
  }

  async function disable() {
    const sub = subscription.value
    if (!sub || busy.value) return
    busy.value = true
    try {
      await getTransport().pushUnsubscribe(sub.endpoint)
      await sub.unsubscribe()
      subscription.value = null
    } finally { busy.value = false }
  }

  async function setCategory(c: NotifyCategory, on: boolean) {
    categories.value = on ? [...new Set([...categories.value, c])] : categories.value.filter((x) => x !== c)
    if (subscription.value) await send(subscription.value)
  }

  async function test() {
    if (subscription.value) await getTransport().pushTest(subscription.value.endpoint)
  }

  // the server writes the texts: in the language of this screen
  watch(() => settings.resolvedLocale, () => { if (subscription.value) void send(subscription.value).catch(() => {}) })

  return { unsupported, categories, permission, busy, enabled, init, enable, disable, setCategory, test }
})
