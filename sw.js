const workerUrl = new URL(self.location.href);
const agencyCacheId = String(workerUrl.searchParams.get("agency") || "default-agency").replace(/[^a-z0-9-]/gi, "-");
const runtimeCachePrefix = `quialakey-runtime-${agencyCacheId}-`;
const runtimeCacheName = `${runtimeCachePrefix}20260915-6`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith(runtimeCachePrefix) && key !== runtimeCacheName) || key.startsWith("cles-runtime-"),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const shouldCache = !["app.js", "app-version.json"].some((fileName) => url.pathname.endsWith(`/${fileName}`));

  event.respondWith(
    fetch(new Request(request, { cache: "no-store" }))
      .then(async (response) => {
        if (response.ok && shouldCache) {
          const cache = await caches.open(runtimeCacheName);
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
