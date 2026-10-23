/* VOOXOR: replace the former advertising worker; no external imports. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const subscription = await self.registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  await self.clients.claim();
})()));
