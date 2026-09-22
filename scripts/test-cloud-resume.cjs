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
      const contentType = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": contentType || "application/octet-stream" });
      response.end(await fs.readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const page = await browser.newPage({ serviceWorkers: "block" });
    const settings = { agencyName: "Test", accessLockEnabled: false };
    const makeKey = (status) => ({
      id: "T3-1", category: "T3", number: 1, owner: "MEYER", property: "27 avenue Test",
      sets: [{ id: "main", label: "Jeu 1", status, history: [], reservations: [] }],
    });
    let remoteStatus = "out";
    let failReads = false;
    await page.addInitScript(({ settings: cachedSettings, staleKey }) => {
      localStorage.setItem("quialakey:century21lesminimes:cles-table-settings-v1", JSON.stringify(cachedSettings));
      localStorage.setItem("quialakey:century21lesminimes:cles-transaction-v1", JSON.stringify([staleKey]));
      localStorage.setItem("quialakey:century21lesminimes:cles-location-active-registry-v1", "transaction");
    }, { settings, staleKey: makeKey("out") });
    await page.route("**/*.supabase.co/**", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (failReads) {
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"offline"}' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
      const filter = new URL(request.url()).searchParams.get("key") || "";
      const rows = filter.includes("::slot::") && filter.includes("transaction")
        ? [{ key: "cles-transaction-v1::slot::T3-1", value: makeKey(remoteStatus), updated_at: remoteStatus === "out" ? "2026-09-21T17:00:00Z" : "2026-09-21T17:56:00Z" }]
        : filter.includes("cles-table-settings-v1")
          ? [{ key: "cles-table-settings-v1", value: settings, updated_at: "2026-09-21T12:00:00Z" }]
          : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-access-loading")), true);
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    await page.waitForFunction(() => !document.body.classList.contains("is-access-loading"));
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1")?.sets[0].status), "out");
    assert.equal(await page.locator("#keyForm").evaluate((element) => element.tagName), "DIV");
    assert.equal(await page.locator("#propertyInput").evaluate((element) => element.closest("form")), null);

    await page.evaluate(() => enterCloudSleep());
    remoteStatus = "available";
    await page.locator("#cloudSleepOverlay").click();
    assert.equal(await page.locator("#cloudSleepOverlay").evaluate((element) => element.hidden), false);
    assert.equal(await page.locator("#cloudSleepOverlay").evaluate((element) => element.classList.contains("is-awaiting-cloud")), true);
    await page.waitForFunction(() => !document.body.classList.contains("is-cloud-sleeping"), null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1")?.sets[0].status), "available");
    assert.equal(await page.locator("#cloudSleepOverlay").evaluate((element) => element.classList.contains("is-awaiting-cloud")), false);

    await page.evaluate(() => enterCloudSleep());
    failReads = true;
    await page.locator("#cloudSleepOverlay").click();
    await page.waitForFunction(() => document.querySelector("#cloudSleepOverlay span")?.textContent.includes("Connexion impossible"), null, { timeout: 15000 });
    assert.equal(await page.locator("#cloudSleepOverlay").evaluate((element) => element.hidden), false);
    failReads = false;
    await page.locator("#cloudSleepOverlay").click();
    await page.waitForFunction(() => !document.body.classList.contains("is-cloud-sleeping"), null, { timeout: 15000 });

    failReads = true;
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("#retryInitialLoadBtn")?.hidden, null, { timeout: 15000 });
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-access-loading")), true);
    failReads = false;
    await page.locator("#retryInitialLoadBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("is-access-loading"), null, { timeout: 15000 });
    process.stdout.write("Cloud startup, wake refresh, and retry checks passed.\n");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
