// Minimal service worker for installed-PWA/fullscreen eligibility.
// Deliberately no fetch interception or offline cache: live commerce data,
// OAuth and Cloudflare Access must always use the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
