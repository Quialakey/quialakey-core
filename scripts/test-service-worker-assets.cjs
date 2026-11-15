const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const root = path.resolve(__dirname, "..");
  const source = await fs.readFile(path.join(root, "sw.js"), "utf8");
  const { version } = JSON.parse(await fs.readFile(path.join(root, "app-version.json"), "utf8"));
  const base = "https://example.test/tableau/";
  const cacheEntries = new Map();
  const cache = {
    match: async (request) => cacheEntries.get(request.url),
    put: async (request, response) => cacheEntries.set(request.url, response.clone()),
  };
  const requestedUrls = [];
  const context = vm.createContext({
    self: { location: { href: `${base}sw.js?v=${version}&agency=test` }, addEventListener() {} },
    URL, Request, Response, AbortController, setTimeout, clearTimeout,
    caches: { open: async () => cache },
    fetch: async (request) => {
      requestedUrls.push(request.url);
      return new Response("new stylesheet", { status: 200 });
    },
  });
  vm.runInContext(source, context);

  const currentRequest = new Request(`${base}styles.css?v=${version}`);
  cacheEntries.set(currentRequest.url, new Response("old stylesheet", { status: 200 }));
  const futureRequest = new Request(`${base}styles.css?v=${version}-next`);
  const response = await context.serveCoreAsset(futureRequest, new URL(futureRequest.url), { waitUntil() {} });
  assert.equal(await response.text(), "new stylesheet");
  assert.deepEqual(requestedUrls, [futureRequest.url]);
  assert.equal(await (await cache.match(futureRequest)).text(), "new stylesheet");
  assert.equal(await (await cache.match(currentRequest)).text(), "old stylesheet");

  const rootRequest = new Request(base);
  cacheEntries.set(rootRequest.url, new Response("<main>tableau</main>", { status: 200 }));
  context.fetch = async () => new Response("<main>attestation</main>", { status: 200 });
  const receiptRequest = new Request(`${base}receipt.html?v=${version}`);
  const receipt = await context.serveNavigation(receiptRequest, new URL(receiptRequest.url), { waitUntil() {} });
  assert.equal(await receipt.text(), "<main>attestation</main>");
  assert.equal(await (await cache.match(rootRequest)).text(), "<main>tableau</main>");
  assert.equal(await (await cache.match(receiptRequest)).text(), "<main>attestation</main>");

  context.fetch = async () => { throw new Error("offline"); };
  const uncachedReceipt = new Request(`${base}receipt.html?v=uncached`);
  await assert.rejects(context.serveNavigation(uncachedReceipt, new URL(uncachedReceipt.url), { waitUntil() {} }),
    /Page indisponible/);

  context.fetch = async () => new Response("<main>nouveau tableau</main>", { status: 200 });
  const indexRequest = new Request(`${base}index.html?v=${version}`);
  await context.serveNavigation(indexRequest, new URL(indexRequest.url), { waitUntil() {} });
  assert.equal(await (await cache.match(rootRequest)).text(), "<main>nouveau tableau</main>");
  console.log("Versioned assets and receipt navigation keep the table cache intact.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
