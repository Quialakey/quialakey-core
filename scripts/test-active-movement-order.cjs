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
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      response.end(await fs.readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await page.route("**/agency-config.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'window.QUIALAKEY_CONFIG = Object.freeze({ agencyId: "movement-order-test", agencyName: "Test", supabaseUrl: "https://mock.supabase.co", supabasePublishableKey: "test", migrateLegacyStorage: true });',
    }));
    await page.route("**/mock.supabase.co/**", (route) => {
      const url = new URL(route.request().url());
      const rows = url.searchParams.get("key")?.includes("cles-table-settings-v1")
        ? [{ key: "cles-table-settings-v1", value: { accessLockEnabled: false }, updated_at: "2026-10-21T10:00:00Z" }]
        : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof renderPanel === "function" && hasCompletedInitialCloudLoad);

    await page.evaluate(() => {
      activeRegistry = "transaction";
      selectedId = "T1-1";
      selectedSetId = "main";
      selectedArchiveRecord = null;
      const reserved = (id, label, date) => ({
        ...makeKeySet(id), label,
        reservations: [{ id: `reservation-${id}`, person: "Intervenant Test", reservationDate: date, returnsToAgency: true }],
        history: [{ id: `history-${id}`, type: "reserved", reservationId: `reservation-${id}`,
          person: "Intervenant Test", reservationDate: date, date: "09/10/2026 09:00" }],
      });
      const out = (id, label, date) => ({
        ...makeKeySet(id), label, status: "out", holder: "Intervenant Test",
        history: [{ id: `history-${id}`, type: "out", person: "Intervenant Test", date }],
      });
      keys = [normalizeKey({
        id: "T1-1", category: "T1", number: 1, owner: "TEST", property: "1 rue Test",
        sets: [
          out("main", "Jeu 1", "15/10/2026 23:47"),
          reserved("double", "Jeu 2", "23/10/2026 21:51"),
          out("triple", "Jeu 3", "25/10/2026 12:00"),
          reserved("quad", "Jeu 4", "10/10/2026 08:00"),
        ],
      })];
      renderPanel();
    });

    const readOrder = () => page.locator("#activeMovementPanel > ol:not([hidden])").evaluateAll((panels) =>
      panels.map((panel) => ({
        heading: panel.dataset.heading,
        cards: [...panel.children].map((item) => item.querySelector("strong")?.textContent),
      })));
    assert.deepEqual(await readOrder(), [
      { heading: "Réservation en cours", cards: ["Jeu 4 - Réservé : Intervenant Test"] },
      { heading: "Sortie en cours", cards: ["Jeu 1 - Sorti : Intervenant Test"] },
      { heading: "Réservation en cours", cards: ["Jeu 2 - Réservé : Intervenant Test"] },
      { heading: "Sortie en cours", cards: ["Jeu 3 - Sorti : Intervenant Test"] },
    ]);
    await page.locator("#activeMovementPanel > ol:not([hidden])").nth(2).locator("textarea").fill("Commentaire conservé");
    assert.equal(await page.evaluate(() => getInlineReservationComment("reservation-double")), "Commentaire conservé");
    if (process.env.MOVEMENT_SCREENSHOT) {
      await page.locator("#activeMovementPanel").screenshot({ path: process.env.MOVEMENT_SCREENSHOT });
    }

    await page.evaluate(() => {
      const set = keys[0].sets[1];
      set.status = "out";
      set.holder = "Intervenant Test";
      set.holderReservationId = "reservation-double";
      set.history.unshift({ id: "checkout-double", type: "out", reservationId: "reservation-double", date: "14/10/2026 10:00" });
      renderPanel();
    });
    assert.deepEqual(await readOrder(), [
      { heading: "Réservations en cours", cards: [
        "Jeu 4 - Réservé : Intervenant Test", "Jeu 2 - Réservé : Intervenant Test",
      ] },
      { heading: "Sorties en cours", cards: [
        "Jeu 1 - Sorti : Intervenant Test", "Jeu 3 - Sorti : Intervenant Test",
      ] },
    ]);
    console.log("Active movements are displayed in ascending date order");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
