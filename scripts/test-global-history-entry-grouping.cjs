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
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/agency-config.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'window.QUIALAKEY_CONFIG = { agencyId: "history-group-test", agencyName: "Test", supabaseUrl: "", supabasePublishableKey: "" };',
    }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
    await page.evaluate(() => {
      const movement = (id, date, reason = "created") => ({
        id: `history-${id}-test`, type: "in", returnReason: reason,
        date, person: "Soraya EL YACOUBI", phone: "06 81 17 45 53",
      });
      const key = (number, ids, dates, reasons = []) => ({
        id: `T2-${number}`, category: "T2", number, owner: "MORTEVEILLE", property: "Rue Test",
        sets: ids.map((id, index) => ({
          ...makeKeySet(["main", "double", "triple", "quad"][index]),
          history: [movement(id, dates[index], reasons[index])],
        })),
      });
      setRuntimeStorageValue(registryConfig.location.keysStorageKey, JSON.stringify([
        key(4, [1793372535017, 1793372535015], ["30/10/2026 16:02", "30/10/2026 16:02"]),
        key(5, [1793372535017, 1793372540015], ["30/10/2026 16:02", "30/10/2026 16:02"]),
        key(6, [1793372535017, 1793372535015], ["30/10/2026 16:02", "30/10/2026 16:02"], ["returned", "returned"]),
        key(7, [1793372535017, 1793372535018, 1793372535019],
          ["30/10/2026 16:02", "30/10/2026 16:02", "30/10/2026 16:02"]),
        key(8, [1793372535017, 1793372535018, 1793372535019, 1793372535020],
          ["30/10/2026 16:02", "30/10/2026 16:02", "30/10/2026 16:02", "30/10/2026 16:02"]),
      ]));
      setRuntimeStorageValue(appActivityLogStorageKey, JSON.stringify([
        ...["main", "double"].map((setId, index) => ({
          id: `activity-entry-${setId}`, date: "2026-10-30T15:02:15.077Z", action: "Entré",
          title: `T2 #4 - MORTEVEILLE - Jeu ${index + 1}`,
          details: "Soraya EL YACOUBI | 06 81 17 45 53", registry: "location",
          keyId: "T2-4", setId, movementId: `history-${index ? 1793372535015 : 1793372535017}-test`,
        })),
        { id: "activity-add", date: "2026-10-30T15:02:15.077Z", action: "Ajout jeu",
          title: "T2 #4 - MORTEVEILLE", details: "2 jeux au total", registry: "location" },
        { id: "activity-create", date: "2026-10-30T15:02:15.076Z", action: "Création fiche",
          title: "T2 #4 - MORTEVEILLE", details: "MORTEVEILLE - Rue Test", registry: "location" },
      ]));
      renderGlobalHistoryItems(globalHistoryList, "location");
    });
    const rows = await page.locator("#globalHistoryList li").evaluateAll((items) => items.map((item) => ({
      keyId: item.dataset.historyKeyId,
      title: item.querySelector("strong")?.textContent,
      meta: item.querySelector("small")?.textContent,
      groupedIds: item.dataset.groupedHistoryIds,
    })));
    const grouped = rows.filter((row) => row.keyId === "T2-4" && row.title.includes("Entré"));
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].title, "T2 #4 - Entré - Location - MORTEVEILLE - Jeu 1 et 2");
    assert.match(grouped[0].meta, /30\/10\/2026 16:02 - Soraya EL YACOUBI - 06 81 17 45 53/);
    assert.equal(JSON.parse(grouped[0].groupedIds).length, 5);
    assert.equal(rows.filter((row) => row.keyId === "T2-5").length, 2);
    assert.equal(rows.filter((row) => row.keyId === "T2-6").length, 2);
    assert.equal(rows.find((row) => row.keyId === "T2-7")?.title,
      "T2 #7 - Entré - Location - MORTEVEILLE - Jeu 1, 2 et 3");
    assert.equal(rows.find((row) => row.keyId === "T2-8")?.title,
      "T2 #8 - Entré - Location - MORTEVEILLE - Jeu 1, 2, 3 et 4");

    await page.evaluate(() => { globalHistoryPanel.hidden = false; });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('#globalHistoryList li[data-history-key-id="T2-4"][data-grouped-history-ids]').click({ modifiers: ["Control"] });
    assert.equal(await page.locator('#globalHistoryList li[data-history-key-id="T2-4"][data-history-action="in"]').count(), 0);
    console.log("Simultaneous initial entries form one global-history row; separate entries remain separate.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
