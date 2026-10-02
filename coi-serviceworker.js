/* Optional GitHub Pages headers for future SharedArrayBuffer acceleration. */
if (typeof window !== "undefined") {
  if (window.crossOriginIsolated !== true && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("./coi-serviceworker.js").then(registration => {
      if (registration.active && !navigator.serviceWorker.controller) window.location.reload();
    });
  }
} else {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", event => {
    event.respondWith(fetch(event.request).then(response => {
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }));
  });
}
