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
      body: 'window.QUIALAKEY_CONFIG = Object.freeze({ agencyId: "photo-draft-test", agencyName: "Test", supabaseUrl: "", supabasePublishableKey: "" });',
    }));
    await page.addInitScript(() => {
      localStorage.setItem("quialakey:photo-draft-test:cles-table-settings-v1", JSON.stringify({ accessLockEnabled: false }));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof restorePendingNewKeyDraft === "function" && indexedStorageHydrated);
    const readActionVisibility = () => page.evaluate(() => Object.fromEntries(
      ["checkinBtn", "reservedBtn", "checkoutBtn", "rentedBtn", "removedBtn"].map((id) => [
        id, document.getElementById(id).getClientRects().length > 0,
      ]),
    ));

    for (const registry of ["transaction", "location"]) {
      await page.setViewportSize(registry === "transaction"
        ? { width: 390, height: 844 } : { width: 1280, height: 800 });
      const beforePhoto = await page.evaluate(async (name) => {
        activeRegistry = name;
        saveActiveRegistry();
        keys = loadKeys();
        selectedArchiveRecord = null;
        selectedId = "T3-9";
        selectedSetId = "main";
        beginPendingNewKeyDraft(keys.find((key) => key.id === selectedId));
        render();
        ownerInput.value = `PROPRIETAIRE ${name.toUpperCase()}`;
        ownerInput.dispatchEvent(new Event("input", { bubbles: true }));
        propertyInput.value = "12 rue de la Paix";
        propertyInput.dispatchEvent(new Event("input", { bubbles: true }));
        const input = keySetPhotoList.querySelector('.photo-actions label:first-child input[type="file"]');
        beginPhotoImport({ currentTarget: input });
        let hidden = true;
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pagehide"));
        const sleptDuringCamera = isCloudSleeping;
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 80;
        canvas.getContext("2d").fillRect(0, 0, 80, 80);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], "capture.png", { type: "image/png" }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { sleptDuringCamera, owner: ownerInput.value };
      }, registry);
      assert.equal(beforePhoto.sleptDuringCamera, false);
      assert.deepEqual(await readActionVisibility(), {
        checkinBtn: true, reservedBtn: false, checkoutBtn: false, rentedBtn: false, removedBtn: false,
      });
      await page.waitForFunction(() => !isPhotoImporting && pendingNewKeyDraft?.sets[0].photo?.length > 200);
      const beforeReload = await page.evaluate(async () => {
        await waitForIndexedStorageWrite(newKeyDraftStorageKey);
        return {
          owner: pendingNewKeyDraft.owner,
          photo: pendingNewKeyDraft.sets[0].photo,
          published: isKeyFilled(keys.find((key) => key.id === selectedId)),
        };
      });
      assert.equal(beforeReload.owner, beforePhoto.owner);
      assert.equal(beforeReload.published, false);

      await page.reload();
      await page.waitForFunction(() => typeof pendingNewKeyDraft !== "undefined" && pendingNewKeyDraft?.sets[0].photo?.length > 200);
      const recovered = await page.evaluate(() => ({
        registry: activeRegistry,
        selectedId,
        owner: ownerInput.value,
        photo: pendingNewKeyDraft.sets[0].photo,
        panelOpen: !detailPanel.hidden,
      }));
      assert.equal(recovered.registry, registry);
      assert.equal(recovered.selectedId, "T3-9");
      assert.equal(recovered.owner, beforeReload.owner);
      assert.equal(recovered.photo, beforeReload.photo);
      assert.equal(recovered.panelOpen, true);
      assert.deepEqual(await readActionVisibility(), {
        checkinBtn: true, reservedBtn: false, checkoutBtn: false, rentedBtn: false, removedBtn: false,
      });

      await page.evaluate(async () => {
        discardPendingNewKeyDraft();
        selectedId = null;
        await waitForIndexedStorageWrite(newKeyDraftStorageKey);
      });
      await page.reload();
      await page.waitForFunction(() => typeof pendingNewKeyDraft !== "undefined" && indexedStorageHydrated);
      assert.equal(await page.evaluate(() => pendingNewKeyDraft), null);

      await page.evaluate(() => {
        selectedId = "T3-9";
        beginPendingNewKeyDraft(keys.find((key) => key.id === selectedId));
        pendingNewKeyDraft.owner = "TEST";
        commitPendingNewKeyDraft();
        render();
      });
      assert.deepEqual(await readActionVisibility(), {
        checkinBtn: false, reservedBtn: true, checkoutBtn: true, rentedBtn: true, removedBtn: true,
      });
      const actionRows = await page.evaluate(() => {
        const bounds = (id) => {
          const { left, right, top, bottom } = document.getElementById(id).getBoundingClientRect();
          return { left, right, top, bottom };
        };
        return {
          reserved: bounds("reservedBtn"), checkout: bounds("checkoutBtn"),
          rented: bounds("rentedBtn"), removed: bounds("removedBtn"),
        };
      });
      assert.ok(Math.abs(actionRows.reserved.top - actionRows.checkout.top) < 1);
      assert.ok(Math.abs(actionRows.rented.top - actionRows.removed.top) < 1);
      assert.ok(actionRows.reserved.right < actionRows.checkout.left);
      assert.ok(actionRows.rented.right < actionRows.removed.left);
      assert.ok(actionRows.rented.top > actionRows.reserved.bottom);

      await page.evaluate(() => {
        getSelectedSet().needsCheckIn = true;
        getSelectedSet().needsCheckInReason = "created";
        renderPanel();
      });
      assert.equal((await readActionVisibility()).checkinBtn, true);

      for (const count of [2, 3, 4]) {
        const keyId = `T3-${count + 8}`;
        await page.evaluate(({ keyId, count }) => {
          selectedId = keyId;
          selectedSetId = "main";
          beginPendingNewKeyDraft(keys.find((key) => key.id === keyId));
          pendingNewKeyDraft.owner = "MARTIN";
          setKeySetCount(count);
          contactSelect.value = "";
          movementPersonInput.value = "Léa";
          movementNameInput.value = "Martin";
          movementCompanyInput.value = "";
          movementPhoneInput.value = "0612345678";
          movementNoteInput.value = "Création de fiche";
        }, { keyId, count });
        const draftState = await page.evaluate(() => ({
          selectedId,
          selectedSetId,
          draftId: pendingNewKeyDraft?.id,
          draftSetCount: pendingNewKeyDraft?.sets.length,
          checkinHidden: checkinBtn.hidden,
          checkinDisabled: checkinBtn.disabled,
          activeAction: activeKeyControlAction?.keyId,
        }));
        assert.equal(draftState.checkinDisabled, false, JSON.stringify(draftState));
        await page.locator("#checkinBtn").click();
        await page.locator(".movement-signature-validate").click();
        await page.waitForFunction((id) => !isPendingNewKeyDraft(id) &&
          keys.find((key) => key.id === id)?.sets.every((set) => set.history.length === 1), keyId);
        const result = await page.evaluate(({ id, registry }) => {
          const key = keys.find((item) => item.id === id);
          const entries = key.sets.map((set) => ({ setId: set.id, label: set.label, ...set.history[0] }));
          const activities = loadActivityLog().filter((item) => item.registry === registry && item.keyId === id && item.action === "Entré");
          return { entries, activities };
        }, { id: keyId, registry });
        assert.equal(result.entries.length, count);
        assert.equal(new Set(result.entries.map((entry) => entry.id)).size, count);
        assert.equal(new Set(result.entries.map((entry) => entry.date)).size, 1);
        for (const entry of result.entries) {
          assert.equal(entry.type, "in");
          assert.equal(entry.person, "Léa MARTIN");
          assert.equal(entry.phone, "06 12 34 56 78");
          assert.equal(entry.note, "Création de fiche");
          assert.ok(result.activities.some((item) => item.setId === entry.setId && item.movementId === entry.id));
        }
        assert.equal(result.activities.length, count);
        await page.evaluate(async () => waitForIndexedStorageWrite(getRegistryConfig().keysStorageKey));
        await page.reload();
        await page.waitForFunction(() => indexedStorageHydrated);
        const savedEntries = await page.evaluate((id) => keys.find((key) => key.id === id).sets.map((set) => set.history[0]), keyId);
        assert.equal(savedEntries.length, count);
        assert.ok(savedEntries.every((entry) => entry?.type === "in" && entry.person === "Léa MARTIN"));
        for (let index = 0; index < count; index += 1) {
          const historyView = await page.evaluate(({ id, index }) => {
            selectedId = id;
            selectedSetId = keys.find((key) => key.id === id).sets[index].id;
            renderPanel();
            return { heading: keyHistoryToggleBtn.textContent, history: historyList.textContent };
          }, { id: keyId, index });
          assert.equal(historyView.heading, `Historique du Jeu ${index + 1}`);
          assert.match(historyView.history, /Entré : Léa MARTIN/);
          assert.match(historyView.history, /Commentaire : Création de fiche/);
        }
      }
    }
    console.log("Photo draft recovery and creation action visibility passed for both registries");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
