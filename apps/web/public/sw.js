// Service worker of Kasbah: push notifications only — no cache, no offline mode, no fetch handler.
// The server writes the text (`PushMessage`: title, body, tag, url); this file only shows it, and a
// tap brings the app to the front on the page the message names.

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('push', (event) => {
  let msg = {}
  try { msg = event.data ? event.data.json() : {} } catch { /* not ours: shown as an empty Kasbah notification */ }
  event.waitUntil(self.registration.showNotification(msg.title || 'Kasbah', {
    body: msg.body || '',
    // the same alert replaces its previous notification, and still rings
    ...(msg.tag ? { tag: msg.tag, renotify: true } : {}),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: msg.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
    if (!open) return self.clients.openWindow(url)
    // the app routes itself (`main.ts`): no reload of an app already open
    open.postMessage({ type: 'kasbah:navigate', url })
    return open.focus()
  })())
})
