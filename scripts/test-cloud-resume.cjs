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
      const contents = await fs.readFile(file);
      const contentType = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": contentType || "application/octet-stream" });
      response.end(contents);
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
      if (sessionStorage.getItem("quialakey-test-seeded") === "done") return;
      localStorage.setItem("quialakey:century21lesminimes:cles-table-settings-v1", JSON.stringify(cachedSettings));
      localStorage.setItem("quialakey:century21lesminimes:cles-transaction-v1", JSON.stringify([staleKey]));
      localStorage.setItem("quialakey:century21lesminimes:cles-location-active-registry-v1", "transaction");
      sessionStorage.setItem("quialakey-test-seeded", "done");
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) }).catch(() => {});
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-access-loading")), true);
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    await page.waitForFunction(() => !document.body.classList.contains("is-access-loading"));
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1")?.sets[0].status), "out");
    const indexedStorageReady = await page.evaluate(async () => {
      const storageKey = getRegistryConfig().keysStorageKey;
      await waitForIndexedStorageWrite(storageKey);
      const entry = await readIndexedStorageEntry(storageKey);
      return Boolean(indexedStorageDb && entry && JSON.parse(entry.value).some((key) => key.id === "T3-1")) &&
        browserStorage.getItem(getScopedBrowserStorageKey(storageKey)) === null;
    });
    assert.equal(indexedStorageReady, true);
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
    await page.waitForFunction(() => document.querySelector("#cloudSleepOverlay span")?.textContent.includes("Tableau non actualisé"), null, { timeout: 15000 });
    assert.equal(await page.locator("#cloudSleepOverlay").evaluate((element) => element.hidden), false);
    failReads = false;
    await page.locator("#cloudSleepOverlay").click();
    await page.waitForFunction(() => !document.body.classList.contains("is-cloud-sleeping"), null, { timeout: 15000 });

    failReads = true;
    await page.reload();
    await page.waitForFunction(() => !document.querySelector("#retryInitialLoadBtn")?.hidden, null, { timeout: 15000 });
    assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("is-access-loading")), true);
    assert.equal(await page.locator("#startupLoadingMessage").textContent(), "Tableau non actualisé.");
    failReads = false;
    await page.locator("#retryInitialLoadBtn").click();
    await page.waitForFunction(() => !document.body.classList.contains("is-access-loading"), null, { timeout: 15000 });

    const conflictChecks = await page.evaluate(() => {
      const departure = { id: "departure", type: "out", date: "21/09/2026 15:00" };
      const returnEntry = { id: "return", type: "in", date: "21/09/2026 17:56" };
      const otherEntry = { id: "other", type: "out", date: "21/09/2026 18:00" };
      const makeRecord = (status, history) => ({
        id: "T3-1", category: "T3", number: 1, owner: "MEYER", property: "27 avenue Test",
        sets: [{ id: "main", status, history, reservations: [] }],
      });
      const oldLocal = makeRecord("out", [departure]);
      const returnedRemote = makeRecord("available", [returnEntry, departure]);
      const merged = mergeKeyRecord(oldLocal, returnedRemote);
      let competingMovementsBlocked = false;
      try {
        mergeKeyRecord(makeRecord("available", [returnEntry, departure]), makeRecord("out", [otherEntry, departure]));
      } catch {
        competingMovementsBlocked = true;
      }
      const repeatedEntryA = { id: "repeat-a", type: "in", date: "21/09/2026 17:56" };
      const repeatedEntryB = { id: "repeat-b", type: "in", date: "21/09/2026 17:56" };
      const repeatedActionsRemainDistinct = !historyContainsEntry([repeatedEntryA], repeatedEntryB);
      const legacyEntry = { type: "in", date: "20/09/2026 12:00" };
      const stableLegacyId = normalizeSet({ id: "main", history: [legacyEntry] }).history[0].id ===
        normalizeSet({ id: "main", history: [legacyEntry] }).history[0].id;
      const cloudKey = getKeySlotCloudKey("cles-transaction-v1", "T3-1");
      rememberPendingKeySlotWrite("cles-transaction-v1", "T3-1", makeRecord("available", [returnEntry, departure]));
      saveKeySlotCloudRow({ key: cloudKey, value: makeRecord("out", [otherEntry, departure]), updated_at: "2100-01-01T00:00:00Z" });
      return {
        mergedStatus: merged.sets[0].status,
        mergedHistory: merged.sets[0].history.map((entry) => entry.id),
        competingMovementsBlocked,
        repeatedActionsRemainDistinct,
        stableLegacyId,
        pendingMovementPreserved: Boolean(getPendingKeySlotWrite(cloudKey)),
      };
    });
    assert.equal(conflictChecks.mergedStatus, "available");
    assert.deepEqual(conflictChecks.mergedHistory, ["return", "departure"]);
    assert.equal(conflictChecks.competingMovementsBlocked, true);
    assert.equal(conflictChecks.repeatedActionsRemainDistinct, true);
    assert.equal(conflictChecks.stableLegacyId, true);
    assert.equal(conflictChecks.pendingMovementPreserved, true);

    const safeRendering = await page.evaluate(async () => {
      const key = normalizeKey({
        id: "T3-1", category: "T3", number: 1, owner: "MEYER", property: "27 avenue Test",
        sets: [{ id: "main", photo: 'bad" data-xss="true', status: "available", history: [], reservations: [] }],
      });
      selectedArchiveRecord = null;
      renderKeySetPhotos(key);
      const photoInjectedElement = Boolean(keySetPhotoList.querySelector("[data-xss]"));
      const datePrompt = promptCompromiseDate('2026-09-22" data-xss="true', '<img data-xss="true">');
      const dialogInjectedElement = Boolean(document.querySelector(".date-dialog [data-xss]"));
      document.querySelector(".date-dialog").close("cancel");
      await datePrompt;
      return { photoInjectedElement, dialogInjectedElement };
    });
    assert.deepEqual(safeRendering, { photoInjectedElement: false, dialogInjectedElement: false });

    const originalViewport = page.viewportSize();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const reservationHeading = await page.evaluate(async () => {
        const result = promptReservationDateTime();
        const dialog = document.querySelector(".reservation-date-dialog");
        const heading = dialog.querySelector("h3");
        const style = getComputedStyle(heading);
        const headingRect = heading.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        const layout = {
          text: heading.textContent,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textAlign: style.textAlign,
          withinDialog: headingRect.left >= dialogRect.left && headingRect.right <= dialogRect.right,
          noHorizontalOverflow: heading.scrollWidth <= heading.clientWidth,
        };
        dialog.close("cancel");
        await result;
        return layout;
      });
      assert.deepEqual(reservationHeading, {
        text: "DATE ET HEURE DE RÉSERVATION",
        fontSize: "18px",
        fontWeight: "900",
        textAlign: "center",
        withinDialog: true,
        noHorizontalOverflow: true,
      });
    }
    await page.setViewportSize(originalViewport);

    const durableStorage = await page.evaluate(async () => {
      const storageKey = getRegistryConfig().keysStorageKey;
      const originalSetItem = Storage.prototype.setItem;
      const originalAlert = alert;
      const alerts = [];
      Storage.prototype.setItem = function (key, value) {
        if (key === getScopedBrowserStorageKey(storageKey)) throw new DOMException("Quota exceeded", "QuotaExceededError");
        return originalSetItem.call(this, key, value);
      };
      alert = (message) => alerts.push(message);
      try {
        keys = keys.map((key) => key.id === "T3-1" ? { ...key, notes: "Sauvé dans IndexedDB" } : key);
        saveKeys();
        const saved = await waitForIndexedStorageWrite(storageKey);
        const entry = await readIndexedStorageEntry(storageKey);
        return {
          saved,
          persisted: JSON.parse(entry.value).find((key) => key.id === "T3-1")?.notes === "Sauvé dans IndexedDB",
          alerts: alerts.length,
          noCloudOnlyFallback: !cloudOnlyStorageKeys.has(storageKey),
        };
      } finally {
        Storage.prototype.setItem = originalSetItem;
        alert = originalAlert;
        clearTimeout(directCloudFlushTimers.get(storageKey));
        clearTimeout(cloudSyncTimers.get(storageKey));
      }
    });
    assert.deepEqual(durableStorage, { saved: true, persisted: true, alerts: 0, noCloudOnlyFallback: true });
    await page.evaluate(async () => {
      await Promise.all([
        waitForIndexedStorageWrite(getRegistryConfig().keysStorageKey),
        waitForIndexedStorageWrite(dirtyKeySlotsStorageKey),
        waitForIndexedStorageWrite(lastLocalEditStorageKey),
      ]);
    });
    await page.reload();
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    assert.equal(
      await page.evaluate(() => keys.find((key) => key.id === "T3-1")?.notes),
      "Sauvé dans IndexedDB",
    );

    const storageFailure = await page.evaluate(() => {
      const originalSave = setRuntimeStorageValue;
      const originalAlert = alert;
      const alerts = [];
      const blockedKey = getRegistryConfig().keysStorageKey;
      keys = keys.map((key) => key.id === "T3-1" ? { ...key, notes: "Modification avec stockage local plein" } : key);
      setRuntimeStorageValue = (key, value) => {
        if (key !== blockedKey) return originalSave(key, value);
        runtimeStorageFallback.set(key, String(value));
        return false;
      };
      alert = (message) => alerts.push(message);
      let rejected = false;
      try {
        saveKeys();
      } catch {
        rejected = true;
      } finally {
        setRuntimeStorageValue = originalSave;
        alert = originalAlert;
      }
      clearTimeout(directCloudFlushTimers.get(blockedKey));
      clearTimeout(cloudSyncTimers.get(blockedKey));
      const pending = cloudOnlyPendingStorageKeys.has(blockedKey);
      const noRoutineBanner = document.querySelector("#cloudOnlyStatus") === null;
      markCloudOnlyStorageConfirmed(blockedKey);
      clearCloudOnlyStorageWarning(blockedKey);
      return { rejected, pending, noRoutineBanner, alerts: alerts.length };
    });
    assert.deepEqual(storageFailure, { rejected: false, pending: true, noRoutineBanner: true, alerts: 0 });

    const cloudOnlyAction = await page.evaluate(async () => {
      const storageKey = getRegistryConfig().keysStorageKey;
      const cloudKey = getKeySlotCloudKey(storageKey, "T3-1");
      const originalSync = syncCloudAfterAction;
      const originalClose = closeKeyPanelAfterAction;
      const originalAlert = alert;
      const warnings = [];
      let closes = 0;
      markCloudOnlyStoragePending(storageKey);
      syncCloudAfterAction = async () => false;
      closeKeyPanelAfterAction = () => { closes += 1; };
      alert = (message) => warnings.push(message);
      try {
        await finishKeyControlAction("T3-1");
        const stayedOpenWhenUnconfirmed = closes === 0 && warnings.length === 0;
        syncCloudAfterAction = async () => {
          dirtyKeySlots.delete(storageKey);
          pendingKeySlotWrites.delete(cloudKey);
          markCloudOnlyStorageConfirmed(storageKey);
          return true;
        };
        await finishKeyControlAction("T3-1");
        return { stayedOpenWhenUnconfirmed, closedAfterConfirmation: closes === 1 };
      } finally {
        syncCloudAfterAction = originalSync;
        closeKeyPanelAfterAction = originalClose;
        alert = originalAlert;
        clearCloudOnlyStorageWarning(storageKey);
      }
    });
    assert.deepEqual(cloudOnlyAction, { stayedOpenWhenUnconfirmed: true, closedAfterConfirmation: true });

    const slotCloudKey = "cles-transaction-v1::slot::T3-1";
    const remoteRows = new Map([[slotCloudKey, {
      key: slotCloudKey, value: makeKey("available"), updated_at: "2026-09-21T17:56:00Z",
    }]]);
    let confirmedWrites = 0;
    await page.unroute("**/*.supabase.co/**");
    await page.route("**/*.supabase.co/**", async (route) => {
      const request = route.request();
      const filter = new URL(request.url()).searchParams.get("key") || "";
      if (request.method() === "GET") {
        const rows = [...remoteRows.values()].filter((row) => filter.includes(row.key));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        return;
      }
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      rows.forEach((row) => {
        remoteRows.set(row.key, { key: row.key, value: row.value, updated_at: row.updated_at });
        if (row.key === slotCloudKey) confirmedWrites += 1;
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });
    const cloudOnlyWrite = await page.evaluate(async () => {
      const storageKey = getRegistryConfig().keysStorageKey;
      dirtyCloudKeys.clear();
      dirtyKeySlots.clear();
      pendingKeySlotWrites.clear();
      recentlyForcedKeySlots.clear();
      recentlyClearedKeySlots.clear();
      keys = keys.map((key) => key.id === "T3-1" ? { ...key, notes: "Confirmé directement sur Supabase" } : key);
      const originalSave = setRuntimeStorageValue;
      setRuntimeStorageValue = (key, value) => {
        if (key !== storageKey) return originalSave(key, value);
        runtimeStorageFallback.set(key, String(value));
        return false;
      };
      try {
        saveKeys();
        const pendingBefore = cloudOnlyPendingStorageKeys.has(storageKey);
        await syncCurrentRegistryNow();
        return { pendingBefore, pendingAfter: cloudOnlyPendingStorageKeys.has(storageKey) };
      } finally {
        setRuntimeStorageValue = originalSave;
      }
    });
    assert.deepEqual(cloudOnlyWrite, { pendingBefore: true, pendingAfter: false });
    assert.ok(confirmedWrites > 0);
    assert.equal(remoteRows.get(slotCloudKey).value.notes, "Confirmé directement sur Supabase");

    const otherStorageWrites = await page.evaluate(() => {
      const locationKey = registryConfig.location.keysStorageKey;
      const archivesKey = getRegistryConfig().archivesStorageKey;
      const originalSave = setRuntimeStorageValue;
      setRuntimeStorageValue = (key, value) => {
        if (key !== locationKey && key !== archivesKey) return originalSave(key, value);
        runtimeStorageFallback.set(key, String(value));
        return false;
      };
      try {
        const locationKeys = loadKeysForRegistry("location");
        saveKeysForRegistry("location", locationKeys.map((key, index) => index === 0 ? { ...key, owner: "TEST" } : key));
        saveArchives();
        return {
          locationPending: cloudOnlyPendingStorageKeys.has(locationKey),
          archivesPending: cloudOnlyPendingStorageKeys.has(archivesKey),
        };
      } finally {
        clearTimeout(directCloudFlushTimers.get(locationKey));
        clearTimeout(cloudSyncTimers.get(locationKey));
        clearTimeout(cloudSyncTimers.get(archivesKey));
        clearCloudOnlyStorageWarning(locationKey);
        clearCloudOnlyStorageWarning(archivesKey);
        setRuntimeStorageValue = originalSave;
      }
    });
    assert.deepEqual(otherStorageWrites, { locationPending: true, archivesPending: true });
    await page.evaluate(() => {
      selectedId = "T3-1";
      selectedSetId = "main";
      render();
    });
    assert.equal(await page.locator("#keySetCountLabel").textContent(), "Nombre total de jeux de clés");
    assert.equal(await page.locator(".movement-box legend").textContent(), "Mouvements des jeux de clés");
    assert.equal(await page.locator("#keySetCountUnlockBtn").isVisible(), true);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
    await page.locator("#keySetCountUnlockBtn").click();
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").sets.length), 1);
    let countConfirmation = "";
    page.once("dialog", (dialog) => {
      countConfirmation = dialog.message();
      return dialog.accept();
    });
    await page.locator("#keySetCountUnlockBtn").dblclick();
    assert.equal(countConfirmation, 'Souhaitez-vous ajouter ou supprimer un jeu de clés sur la fiche clé du bien de monsieur et/ou madame "MEYER" ?');
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), true);
    await page.locator("#keySetCountSelect").selectOption("2");
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").sets.length), 2);
    assert.equal(await page.locator("#keySetCountUnlockBtn").isVisible(), true);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
    await page.locator("#keySetSelect").selectOption("double");
    assert.equal(await page.evaluate(() => selectedSetId), "double");
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").sets.length), 2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.evaluate(() => {
      const button = document.querySelector("#keySetCountUnlockBtn");
      button.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch" }));
      button.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch" }));
    });
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), true);
    await page.locator("#movementNameInput").click();
    await page.waitForFunction(() => document.querySelector("#keySetCountSelect").hidden);
    assert.equal(await page.evaluate(() => document.activeElement.id), "movementNameInput");
    let repeatedCountConfirmation = "";
    page.once("dialog", (dialog) => {
      repeatedCountConfirmation = dialog.message();
      return dialog.accept();
    });
    await page.locator("#keySetCountUnlockBtn").dblclick();
    assert.equal(repeatedCountConfirmation, countConfirmation);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), true);
    await page.evaluate(() => {
      resetKeyInfoEditUnlock(getSelectedKey());
      render();
      const select = document.querySelector("#keySetCountSelect");
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").sets.length), 2);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#keySetCountUnlockBtn").dblclick();
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").sets.length), 2);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
    await page.evaluate(() => {
      resetKeyInfoEditUnlock(getSelectedKey());
      render();
    });
    let detailsConfirmation = "";
    page.once("dialog", (dialog) => {
      detailsConfirmation = dialog.message();
      return dialog.dismiss();
    });
    await page.locator("#ownerInput").dblclick();
    assert.equal(detailsConfirmation, 'Souhaitez-vous apporter des modifications sur la fiche clé du bien de monsieur et/ou madame "MEYER" ?');
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#ownerInput").dblclick();
    assert.equal(await page.locator("#ownerInput").evaluate((input) => input.readOnly), false);
    await page.locator("#propertyInput").click();
    assert.equal(await page.locator("#ownerInput").evaluate((input) => input.readOnly), false);
    await page.locator("#notesInput").fill("Note conservée au reverrouillage");
    await page.locator("#movementNameInput").click();
    await page.waitForFunction(() => document.querySelector("#ownerInput").readOnly);
    assert.equal(await page.evaluate(() => document.activeElement.id), "movementNameInput");
    assert.equal(await page.evaluate(() => keys.find((key) => key.id === "T3-1").notes), "Note conservée au reverrouillage");
    let repeatedDetailsConfirmation = "";
    page.once("dialog", (dialog) => {
      repeatedDetailsConfirmation = dialog.message();
      return dialog.dismiss();
    });
    await page.locator("#ownerInput").dblclick();
    assert.equal(repeatedDetailsConfirmation, detailsConfirmation);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#ownerInput").dblclick();
    await page.locator("#selectedTitle").click();
    await page.waitForFunction(() => document.querySelector("#ownerInput").readOnly);

    await page.evaluate(() => {
      const blankKey = keys.find((key) => key.id === "T3-2");
      selectedId = blankKey.id;
      beginPendingNewKeyDraft(blankKey);
      resetKeyInfoEditUnlock(blankKey);
      render();
    });
    assert.equal(await page.locator("#keySetCountUnlockBtn").isVisible(), false);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), true);
    const blankDialogs = [];
    const onBlankDialog = (dialog) => {
      blankDialogs.push(dialog.message());
      return dialog.dismiss();
    };
    page.on("dialog", onBlankDialog);
    await page.locator("#keySetCountSelect").selectOption("2");
    page.off("dialog", onBlankDialog);
    assert.deepEqual(blankDialogs, []);
    assert.equal(await page.evaluate(() => pendingNewKeyDraft.sets.length), 2);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), true);
    await page.evaluate(() => {
      pendingNewKeyDraft = { ...pendingNewKeyDraft, owner: "TEST" };
      commitPendingNewKeyDraft();
      render();
    });
    assert.equal(await page.locator("#keySetCountUnlockBtn").isVisible(), true);
    assert.equal(await page.locator("#keySetCountSelect").isVisible(), false);
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
