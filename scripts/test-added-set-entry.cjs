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
      body: 'window.QUIALAKEY_CONFIG = { agencyId: "added-set-test", agencyName: "Test", supabaseUrl: "", supabasePublishableKey: "" };',
    }));
    await page.addInitScript(() => {
      if (sessionStorage.getItem("added-set-test-seeded")) return;
      const prefix = "quialakey:added-set-test:";
      localStorage.setItem(`${prefix}cles-table-settings-v1`, JSON.stringify({ accessLockEnabled: false }));
      for (const storageKey of ["cles-transaction-v1", "cles-immobilieres-v1"]) {
        localStorage.setItem(`${prefix}${storageKey}`, JSON.stringify([{
          id: "T2-12", category: "T2", number: 12, owner: "MARTIN", property: "12 rue Test",
          sets: [{ id: "main", label: "Jeu 1", status: "available", history: [], reservations: [] }],
        }]));
      }
      sessionStorage.setItem("added-set-test-seeded", "yes");
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));

    for (const registry of ["transaction", "location"]) {
      await page.setViewportSize(registry === "location" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
      await page.evaluate((registry) => {
        clearKeyControlAction();
        activeRegistry = registry;
        saveActiveRegistry();
        keys = loadKeys();
        selectedArchiveRecord = null;
        selectedId = "T2-12";
        selectedSetId = "main";
        render();
      }, registry);
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#keySetCountUnlockBtn").dblclick();
      await page.locator("#keySetCountSelect").selectOption("2");
      const pending = await page.evaluate(() => ({
        selectedSetId,
        savedSetCount: keys.find((key) => key.id === "T2-12").sets.length,
        set: getSelectedKey().sets[1],
        activities: loadActivityLog().filter((entry) => entry.registry === activeRegistry && entry.action === "Ajout jeu"),
      }));
      assert.equal(pending.selectedSetId, "double");
      assert.equal(pending.savedSetCount, 1);
      assert.equal(pending.set.needsCheckIn, true);
      assert.equal(pending.set.needsCheckInReason, "added");
      assert.equal(pending.set.history.length, 0);
      assert.equal(pending.activities.length, 0);
      assert.equal(await page.evaluate(() => JSON.parse(getRuntimeStorageValue(getRegistryConfig().keysStorageKey))
        .find((key) => key.id === "T2-12").sets.length), 1);
      assert.equal(await page.locator("#checkinBtn").isEnabled(), true);
      assert.equal(await page.locator("#checkinBtn").evaluate((button) => button.hidden), false);
      for (const selector of ["#reservedBtn", "#checkoutBtn", "#rentedBtn", "#removedBtn"]) {
        assert.equal(await page.locator(selector).isDisabled(), true, selector);
      }
      for (const selector of ["#reservedBtn", "#checkoutBtn"]) {
        assert.equal(await page.locator(selector).evaluate((button) => button.hidden), true, selector);
      }
      assert.equal(await page.locator(".movement-box .archive-actions").evaluate((actions) => actions.hidden), true);

      await page.evaluate(async () => waitForIndexedStorageWrite(addedKeySetDraftStorageKey));
      await page.reload();
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.length), 1);
      assert.equal(await page.evaluate(() => pendingAddedKeySetDraft), null);
      await page.evaluate(() => { selectedId = "T2-12"; selectedSetId = "main"; render(); });
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#keySetCountUnlockBtn").dblclick();
      await page.locator("#keySetCountSelect").selectOption("2");
      const draftPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9pTt8AAAAASUVORK5CYII=";
      await page.evaluate((photo) => {
        updateSelectedKeySets(getSelectedKey().sets.map((set) =>
          set.id === "double" ? { ...set, photo } : set));
      }, draftPhoto);
      assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.length), 1);
      await page.evaluate(async () => {
        setRuntimeStorageValue(addedKeySetPhotoResumeStorageKey, Date.now());
        await waitForIndexedStorageWrite(addedKeySetDraftStorageKey);
      });
      await page.reload();
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.length), 1);
      await page.evaluate(() => { selectedId = "T2-12"; selectedSetId = "double"; render(); });
      assert.equal(await page.evaluate(() => getSelectedSet().needsCheckInReason), "added");
      assert.equal(await page.evaluate(() => getSelectedSet().photo), draftPhoto);
      assert.equal(await page.locator("#reservedBtn").evaluate((button) => button.hidden), true);
      await page.locator("#closePanelBtn").click();
      assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.length), 1);
      assert.equal(await page.evaluate(() => getRuntimeStorageValue(addedKeySetDraftStorageKey)), null);
      await page.evaluate(() => { selectedId = "T2-12"; selectedSetId = "main"; render(); });
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator("#keySetCountUnlockBtn").dblclick();
      await page.locator("#keySetCountSelect").selectOption("2");
      let warning = "";
      page.once("dialog", async (dialog) => { warning = dialog.message(); await dialog.accept(); });
      await page.locator("#checkinBtn").click();
      assert.match(warning, /Renseigne ou choisis un intervenant/);
      assert.equal(await page.locator("#movementContactDetails").evaluate((details) => details.open), false);

      await page.evaluate(() => {
        contacts = [{ id: "contact-test", type: "internal", firstName: "Soraya", name: "EL YACOUBI", phone: "" }];
        renderContactSelect();
      });
      await page.locator("#contactSelect").selectOption("contact-test");
      page.once("dialog", async (dialog) => { warning = dialog.message(); await dialog.accept(); });
      await page.locator("#checkinBtn").click();
      assert.match(warning, /numéro de téléphone de l'intervenant/);
      assert.equal(await page.evaluate(() => getSelectedSet().history.length), 0);
      await page.evaluate(() => { movementPhoneInput.value = "06 81 17 45 53"; });
      await page.locator("#checkinBtn").click();
      await page.locator(".movement-signature-validate").click();
      await page.waitForFunction(() => keys.find((key) => key.id === "T2-12")?.sets[1].history.length === 1);
      const recorded = await page.evaluate(() => {
        const key = keys.find((item) => item.id === "T2-12");
        const entry = key.sets[1].history[0];
        return {
          firstHistoryCount: key.sets[0].history.length,
          pending: key.sets[1].needsCheckIn,
          entry,
          activity: loadActivityLog().find((item) => item.registry === activeRegistry && item.movementId === entry.id),
        };
      });
      assert.equal(recorded.firstHistoryCount, 0);
      assert.equal(recorded.pending, false);
      assert.equal(recorded.entry.type, "in");
      assert.equal(recorded.entry.person, "Soraya EL YACOUBI");
      assert.equal(recorded.entry.phone, "06 81 17 45 53");
      await page.evaluate(() => { selectedId = "T2-12"; selectedSetId = "double"; render(); });
      for (const selector of ["#reservedBtn", "#checkoutBtn"]) {
        assert.equal(await page.locator(selector).evaluate((button) => button.hidden), false, selector);
      }
      assert.equal(await page.locator(".movement-box .archive-actions").evaluate((actions) => actions.hidden), false);
      assert.equal(recorded.activity.action, "Entré");
      assert.match(recorded.activity.title, /Jeu 2$/);
      assert.match(recorded.activity.details, /Soraya EL YACOUBI \| 06 81 17 45 53/);
      const visibleHistory = await page.evaluate((registry) => {
        renderGlobalHistoryItems(globalHistoryList, registry);
        const item = [...globalHistoryList.querySelectorAll("li")]
          .find((entry) => entry.dataset.historyKeyId === "T2-12" && entry.dataset.historySetId === "double");
        return { title: item?.querySelector("strong")?.textContent, meta: item?.querySelector("small")?.textContent };
      }, registry);
      assert.match(visibleHistory.title, /Entré.*Jeu 2/);
      assert.match(visibleHistory.meta, /Soraya EL YACOUBI - 06 81 17 45 53/);
      await page.evaluate(async () => waitForIndexedStorageWrite(getRegistryConfig().keysStorageKey));
      await page.reload();
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      assert.equal(await page.evaluate(() => {
        const set = keys.find((key) => key.id === "T2-12").sets[1];
        return !set.needsCheckIn && set.history[0]?.type === "in";
      }), true);
      if (registry === "transaction") {
        const legacySetCount = await page.evaluate(() => {
          const legacyKey = {
            id: "T2-99", category: "T2", number: 99, owner: "TEST",
            sets: [makeKeySet("main"), { ...makeKeySet("double"), needsCheckIn: true, needsCheckInReason: "added" }],
          };
          return [normalizeKey(legacyKey).sets.length,
            normalizeKey(legacyKey, { preservePendingAddedSets: true }).sets.length,
            normalizeKey({ ...legacyKey, sets: [...legacyKey.sets, { ...makeKeySet("triple"), history: [{ id: "confirmed-third", type: "in" }] }] }).sets.length];
        });
        assert.deepEqual(legacySetCount, [1, 2, 3]);
        await page.evaluate(() => { selectedId = "T2-12"; selectedSetId = "main"; render(); });
        page.once("dialog", (dialog) => dialog.accept());
        await page.locator("#keySetCountUnlockBtn").dblclick();
        await page.locator("#keySetCountSelect").selectOption("4");
        assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.length), 2);
        assert.equal(await page.evaluate(() => getSelectedKey().sets.length), 4);
        await page.evaluate(() => {
          contacts = [{ id: "contact-test", type: "internal", firstName: "Soraya", name: "EL YACOUBI", phone: "06 81 17 45 53" }];
          renderContactSelect();
        });
        await page.locator("#contactSelect").selectOption("contact-test");
        await page.locator("#checkinBtn").click();
        await page.locator(".movement-signature-validate").click();
        await page.waitForFunction(() => keys.find((key) => key.id === "T2-12")?.sets.length === 4);
        const addedSets = await page.evaluate(() => keys.find((key) => key.id === "T2-12").sets.slice(2));
        assert.deepEqual(addedSets.map((set) => [set.needsCheckIn, set.history[0]?.type, set.history[0]?.person]), [
          [false, "in", "Soraya EL YACOUBI"], [false, "in", "Soraya EL YACOUBI"],
        ]);
      }
    }
    console.log("Added key sets require an actor and Entré in both registries.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
