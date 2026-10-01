const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/*supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof keyHasSetStatus === "function");

    const result = await page.evaluate(() => {
      const makeKey = (number, status, reserved = false) => normalizeKey({
        ...makeEmptyKey({ id: `T3-${number}`, category: "T3", number }),
        owner: `PROPRIETAIRE ${number}`,
        sets: [{ ...makeKeySet("main"), status, reservations: reserved ? [
          { id: `reservation-${number}`, person: "Agent", reservationDate: "02/10/2026 10:00" },
        ] : [] }],
      });
      const reserved = makeKey(1, "available", true);
      const available = makeKey(2, "available");
      const out = makeKey(3, "out");
      const archived = { ...makeKey(4, "available", true), archived: true };
      const empty = makeEmptyKey({ id: "T3-5", category: "T3", number: 5 });
      const mixed = makeKey(6, "out");
      mixed.sets.push({ ...makeKeySet("spare-1"), reservations: [{ id: "reservation-mixed", reservationDate: "02/10/2026 10:00" }] });
      const cases = [reserved, available, out, archived, empty, mixed];
      const snapshots = [];
      for (const registry of ["transaction", "location"]) {
        activeRegistry = registry;
        keys = cases;
        setKeyStatusFilter("available");
        snapshots.push({ registry, available: cases.map((key) => keyHasSetStatus(key, "available")),
          reserved: cases.map((key) => keyHasSetStatus(key, "reserved")),
          out: cases.map((key) => keyHasSetStatus(key, "out")),
          counts: getKeyStatusCounts(),
          reservedTileVisible: [...grid.querySelectorAll(".key-tile")].some((tile) => tile.title.startsWith("T3 #1")),
        });
      }
      return snapshots;
    });

    for (const snapshot of result) {
      assert.deepEqual(snapshot.available, [true, true, false, false, false, true]);
      assert.deepEqual(snapshot.reserved, [true, false, false, false, false, true]);
      assert.deepEqual(snapshot.out, [false, false, true, false, false, true]);
      assert.equal(snapshot.counts.available, 3);
      assert.equal(snapshot.counts.reserved, 2);
      assert.equal(snapshot.counts.out, 2);
      assert.equal(snapshot.reservedTileVisible, true);
    }
    console.log("Available filter includes reserved keys in both registries.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
