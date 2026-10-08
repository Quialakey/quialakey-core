const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

function dialogAppearance(dialog) {
  const form = dialog.querySelector("form");
  const heading = dialog.querySelector("h3");
  const buttons = [...dialog.querySelectorAll("button")];
  const properties = (element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]]));
  return {
    dialog: properties(dialog, ["width", "padding", "backgroundColor", "borderColor", "borderWidth", "borderRadius"]),
    form: properties(form, ["display", "rowGap"]),
    heading: properties(heading, ["fontSize", "fontWeight", "lineHeight", "textAlign", "marginBottom"]),
    buttons: buttons.map((button) => properties(button, ["minHeight", "fontWeight", "color", "backgroundColor", "borderColor", "borderWidth", "borderRadius"])),
  };
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      const contents = await fs.readFile(file);
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".webp": "image/webp" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const touch of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: "block", hasTouch: touch, isMobile: touch,
        viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.route("**/agency-config.js*", (route) => route.fulfill({
        status: 200, contentType: "text/javascript",
        body: 'window.QUIALAKEY_CONFIG = { agencyId: "key-info-test", agencyName: "Test", accessLockEnabled: false };',
      }));
      await page.addInitScript(() => {
        if (sessionStorage.getItem("key-info-test-seeded")) return;
        const prefix = "quialakey:key-info-test:";
        localStorage.setItem(`${prefix}cles-table-settings-v1`, JSON.stringify({ accessLockEnabled: false }));
        localStorage.setItem(`${prefix}cles-location-active-registry-v1`, "transaction");
        localStorage.setItem(`${prefix}cles-transaction-v1`, JSON.stringify([{
          id: "T3-1", category: "T3", number: 1, owner: "MEYER", property: "27 avenue Test",
          sets: [{ id: "main", label: "Jeu 1", status: "available", history: [], reservations: [] }],
        }]));
        sessionStorage.setItem("key-info-test-seeded", "yes");
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      await page.locator(".key-tile").filter({ hasText: "T3 #1" }).first().click();
      await page.locator("#keyDetailsToggleBtn").click();
      if (!touch) {
        for (const count of [2, 3, 4]) {
          page.once("dialog", (dialog) => dialog.accept());
          await page.locator("#keySetCountUnlockBtn").dblclick();
          await page.locator("#keySetCountSelect").selectOption(String(count));
          assert.equal(await page.evaluate(() => getSelectedSet().needsCheckIn), false);
          assert.equal(await page.locator("#checkoutBtn").isEnabled(), true);
        }
        await page.locator("#propertyInput").dblclick();
      } else {
        await page.locator("#propertyInput").tap();
        await page.locator("#propertyInput").tap();
      }
      assert.equal(await page.locator(".key-info-edit-dialog h3").textContent(), "Souhaitez-vous effectuer des modifications ?");
      assert.deepEqual(await page.locator(".key-info-edit-dialog button").allTextContents(), ["Oui", "Non"]);
      assert.equal(await page.locator(".key-info-edit-dialog").evaluate((dialog) => dialog.classList.contains("reservation-return-dialog")), true);
      const editAppearance = await page.locator(".key-info-edit-dialog").evaluate(dialogAppearance);
      await page.locator(".key-info-edit-dialog button[value='yes']").click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "propertyInput");
      assert.equal(await page.locator("#propertyInput").evaluate((input) => input.readOnly), false);
      await page.locator("#propertyInput").fill("32 avenue du Test");
      await page.locator("#movementNameInput").click();
      await page.waitForFunction(() => document.querySelector("#propertyInput").readOnly);
      assert.equal(await page.evaluate(() => getSelectedKey().property), "32 Av. Du Test");
      await page.reload();
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      await page.locator(".key-tile").filter({ hasText: "T3 #1" }).first().click();
      await page.locator("#keyDetailsToggleBtn").click();
      assert.equal(await page.locator("#propertyInput").inputValue(), "32 Av. Du Test");
      await page.evaluate(() => { void promptReservationReturn(); });
      const reservationAppearance = await page.locator(".reservation-return-dialog").evaluate(dialogAppearance);
      assert.deepEqual(editAppearance, reservationAppearance);
      await page.locator(".reservation-return-dialog button[value='no']").click();
      await context.close();
    }
    console.log("Added key sets, address save/reload, and touch edit focus passed.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
