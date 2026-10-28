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
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/agency-config.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'window.QUIALAKEY_CONFIG = Object.freeze({ agencyId: "access-per-open-test", agencyName: "Test", supabaseUrl: "", supabasePublishableKey: "" });',
    }));
    await context.addInitScript(() => {
      localStorage.setItem("quialakey:access-per-open-test:cles-table-settings-v1", JSON.stringify({
        accessLockEnabled: true, accessCode: "2468", accessLockVersion: 42,
      }));
      localStorage.setItem("quialakey:access-per-open-test:quialakey-access-unlocked-v1", "42");
    });

    const url = `http://127.0.0.1:${server.address().port}/`;
    const page = await context.newPage();
    await page.goto(url);
    await page.locator("#accessLock").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => isAccessUnlocked()), false);
    assert.equal(await page.locator(".access-logo").getAttribute("src"), "quialakey-opening-banner-20261025.webp");
    assert.equal(await page.locator(".access-logo").evaluate((image) => image.complete && image.naturalWidth > 0), true);
    if (process.env.ACCESS_SCREENSHOT_DIR) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: path.join(process.env.ACCESS_SCREENSHOT_DIR, "access-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.ACCESS_SCREENSHOT_DIR, "access-mobile.png") });
    }
    await page.locator("#forgotPasswordBtn").click();
    assert.equal(await page.locator("#forgotPasswordMessage").textContent(), "Contacter : contact@quialakey.com");
    assert.equal(await page.locator("#forgotPasswordMessage").isVisible(), true);

    await page.locator("#accessCodeInput").fill("0000");
    await page.locator("#accessForm button[type=submit]").click();
    assert.equal(await page.locator("#accessError").isVisible(), true);
    await page.locator("#accessCodeInput").fill("2468");
    await page.locator("#accessForm button[type=submit]").click();
    assert.equal(await page.locator("#accessLock").isVisible(), false);
    await page.evaluate(() => updateAccessLockState());
    assert.equal(await page.locator("#accessLock").isVisible(), false);

    const settingsLabels = await page.evaluate(() => {
      settingsDraft = cloneTableSettings();
      renderSettingsPanel();
      const active = settingsAccessLockLabel.textContent;
      settingsAccessLockInput.checked = false;
      settingsAccessLockInput.dispatchEvent(new Event("change", { bubbles: true }));
      const inactive = settingsAccessLockLabel.textContent;
      settingsAccessLockInput.checked = true;
      settingsAccessLockInput.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        active,
        inactive,
        restored: settingsAccessLockLabel.textContent,
        heading: document.querySelector(".settings-access-section h3").textContent,
        replacements: document.querySelector(".settings-replacements-section h3").textContent,
        saleQuestion: document.querySelector(".settings-sale-mode-fieldset legend").textContent,
      };
    });
    assert.equal(settingsLabels.active, "Oui");
    assert.equal(settingsLabels.inactive, "Non");
    assert.equal(settingsLabels.restored, "Oui");
    assert.match(settingsLabels.heading, /Restreindre le tableau/);
    assert.equal(settingsLabels.replacements, "Abréviations utilisées");
    assert.equal(settingsLabels.saleQuestion, "Une fois le compromis signé, vos clés restent-elles sur le tableau ?");

    const secondPage = await context.newPage();
    await secondPage.goto(url);
    await secondPage.locator("#accessLock").waitFor({ state: "visible" });
    await secondPage.close();

    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    await page.evaluate(() => {
      tableSettings.accessLockEnabled = false;
      updateAccessLockState();
    });
    assert.equal(await page.locator("#accessLock").isVisible(), false);
    console.log("Access code is required for every new page opening and reload.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
