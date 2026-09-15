const workerUrl = new URL(self.location.href);
const agencyCacheId = String(workerUrl.searchParams.get("agency") || "default-agency").replace(/[^a-z0-9-]/gi, "-");
const appVersion = "20260915-11";
const runtimeCachePrefix = `quialakey-runtime-${agencyCacheId}-`;
const runtimeCacheName = `${runtimeCachePrefix}${appVersion}`;
const workerBaseUrl = new URL("./", self.location.href);
const networkTimeoutMs = 3500;
const coreAssetPaths = [
  "./",
  `app.js?v=${appVersion}`,
  `styles.css?v=${appVersion}`,
  `agency-config.js?v=${appVersion}`,
  `manifest.webmanifest?v=${appVersion}`,
  "quialakey-logo-banniere-20260907-2.jpg",
  "quialakey-icon-20260908-1.png",
];

function getScopedUrl(path) {
  return new URL(path, workerBaseUrl).toString();
}

async function fetchWithTimeout(request, timeoutMs = networkTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new Request(request, { cache: "no-store", signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheResponse(cache, request, response) {
  if (!response?.ok) return response;
  await cache.put(request, response.clone());
  return response;
}

async function precacheCoreAssets() {
  const cache = await caches.open(runtimeCacheName);
  await Promise.all(
    coreAssetPaths.map(async (path) => {
      const request = new Request(getScopedUrl(path));
      try {
        const response = await fetchWithTimeout(request, 8000);
        await cacheResponse(cache, request, response);
      } catch {
        // Une ressource deja chargee par la page pourra etre ajoutee ensuite.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheCoreAssets().then(() => self.skipWaiting()));
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

async function serveCoreAsset(request, url, event) {
  const cache = await caches.open(runtimeCacheName);
  const canonicalRequest = new Request(getScopedUrl(`${url.pathname.split("/").pop()}?v=${appVersion}`));
  const cached = (await cache.match(request)) || (await cache.match(canonicalRequest));
  const refresh = fetchWithTimeout(request)
    .then((response) => cacheResponse(cache, canonicalRequest, response))
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  const response = await refresh;
  if (response) return response;
  throw new Error("Ressource principale indisponible.");
}

async function serveNavigation(request, url, event) {
  const cache = await caches.open(runtimeCacheName);
  const rootRequest = new Request(getScopedUrl("./"));
  const cached = (await cache.match(request)) || (await cache.match(rootRequest));
  const refresh = fetchWithTimeout(request)
    .then(async (response) => {
      if (response?.ok) {
        await Promise.all([cache.put(request, response.clone()), cache.put(rootRequest, response.clone())]);
      }
      return response;
    })
    .catch(() => null);

  if (url.searchParams.has("v")) {
    const response = await refresh;
    if (response) return response;
    if (cached) return cached;
    throw new Error("Page indisponible.");
  }

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  const response = await refresh;
  if (response) return response;
  throw new Error("Page indisponible.");
}

async function serveRuntimeAsset(request, event) {
  const cache = await caches.open(runtimeCacheName);
  const cached = await cache.match(request);
  const refresh = fetchWithTimeout(request)
    .then((response) => cacheResponse(cache, request, response))
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  if (response) return response;
  throw new Error("Ressource indisponible.");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/app-version.json")) return;

  const fileName = url.pathname.split("/").pop();
  if (["app.js", "styles.css", "agency-config.js", "manifest.webmanifest"].includes(fileName)) {
    event.respondWith(serveCoreAsset(request, url, event));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(serveNavigation(request, url, event));
    return;
  }
  event.respondWith(serveRuntimeAsset(request, event));
});
