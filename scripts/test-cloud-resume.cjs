const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { PNG } = require("pngjs");

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
    const reservationHeadings = await page.evaluate(() => {
      const originalKeys = keys;
      const originalSelectedId = selectedId;
      const originalSelectedSetId = selectedSetId;
      try {
        selectedId = "T3-1";
        selectedSetId = "main";
        return [1, 2].map((count) => {
          const reservations = Array.from({ length: count }, (_, index) => ({
            id: `reservation-${index}`,
            reservationDate: "2026-09-26T18:00:00Z",
            createdAt: "2026-09-26T12:00:00Z",
          }));
          keys = originalKeys.map((key) => key.id === selectedId ? {
            ...key,
            sets: [{
              ...key.sets[0],
              reservations,
              history: reservations.map((reservation) => ({
                id: `history-${reservation.id}`,
                type: "reserved",
                reservationId: reservation.id,
                date: "26/09/2026 12:00",
              })),
            }],
          } : key);
          renderPanel();
          return {
            count: activeReservationPanel.children.length,
            heading: activeReservationPanel.dataset.heading,
            accessibleHeading: activeReservationPanel.getAttribute("aria-label"),
            visibleHeading: getComputedStyle(activeReservationPanel, "::before").content,
          };
        });
      } finally {
        keys = originalKeys;
        selectedId = originalSelectedId;
        selectedSetId = originalSelectedSetId;
        renderPanel();
      }
    });
    assert.deepEqual(reservationHeadings, [
      { count: 1, heading: "Réservation en cours", accessibleHeading: "Réservation en cours", visibleHeading: '"Réservation en cours"' },
      { count: 2, heading: "Réservations en cours", accessibleHeading: "Réservations en cours", visibleHeading: '"Réservations en cours"' },
    ]);
    const reservationActions = await page.evaluate(() => {
      const originalKeys = keys;
      const originalSelectedId = selectedId;
      const originalSelectedSetId = selectedSetId;
      try {
        selectedId = "T3-1";
        selectedSetId = "main";
        return [true, false, undefined, "returned"].map((decision) => {
          const reservation = {
            id: "reservation-test",
            reservationDate: "2026-09-26T18:00:00Z",
            createdAt: "2026-09-26T12:00:00Z",
            ...(typeof decision === "boolean" || decision === "returned"
              ? { returnsToAgency: decision !== false } : {}),
          };
          keys = originalKeys.map((key) => key.id === selectedId ? {
            ...key,
            sets: [{
              ...key.sets[0],
              status: decision === "returned" ? "out" : "available",
              holderReservationId: decision === "returned" ? reservation.id : "",
              reservations: [reservation],
              history: [{
                id: "history-reservation-test",
                type: "reserved",
                reservationId: reservation.id,
                date: "26/09/2026 12:00",
                ...(typeof reservation.returnsToAgency === "boolean"
                  ? { returnsToAgency: reservation.returnsToAgency } : {}),
              }],
            }],
          } : key);
          renderPanel();
          return [...activeReservationPanel.querySelectorAll(".reservation-history-actions button")]
            .map((button) => button.textContent);
        });
      } finally {
        keys = originalKeys;
        selectedId = originalSelectedId;
        selectedSetId = originalSelectedSetId;
        renderPanel();
      }
    });
    assert.deepEqual(reservationActions, [
      ["Sorti", "Annulation"],
      ["Archivé", "Annulation"],
      ["Préciser le retour", "Annulation"],
      ["Rentré", "Annulation"],
    ]);
    for (const [answer, expected] of [["yes", true], ["no", false]]) {
      const result = page.evaluate(() => promptReservationReturn());
      const button = page.locator(`.reservation-return-dialog button[value="${answer}"]`);
      const colors = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderTopColor };
      });
      assert.deepEqual(colors, expected
        ? { background: "rgb(191, 232, 205)", border: "rgb(61, 143, 94)" }
        : { background: "rgb(241, 199, 194)", border: "rgb(185, 76, 67)" });
      await button.click();
      assert.equal(await result, expected);
    }
    const savedReturnDecisions = await page.evaluate(async () => {
      const originalSelectedId = selectedId;
      const originalActorCheck = ensureMovementActor;
      const originalPhoneCheck = ensureTypedMovementPhone;
      const originalUpdateSet = updateSelectedSet;
      const originalFinish = finishKeyControlAction;
      const originalLog = logActivity;
      const originalPerson = movementPersonInput.value;
      const originalPhone = movementPhoneInput.value;
      const recorded = [];
      try {
        selectedId = "T3-1";
        movementPersonInput.value = "Test";
        movementPhoneInput.value = "06 12 34 56 78";
        ensureMovementActor = () => true;
        ensureTypedMovementPhone = () => true;
        updateSelectedSet = (changes) => recorded.push(changes);
        finishKeyControlAction = async () => {};
        logActivity = () => {};
        for (const answer of ["yes", "no"]) {
          const reservation = reserveSelectedSet();
          document.querySelector('.reservation-date-dialog button[value="confirm"]').click();
          let choiceButton;
          for (let attempt = 0; attempt < 50; attempt++) {
            choiceButton = document.querySelector(`.reservation-return-dialog button[value="${answer}"]`);
            if (choiceButton) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          if (!choiceButton) throw new Error("The return-choice dialog did not open after confirming the date.");
          choiceButton.click();
          await reservation;
        }
        return recorded.map((changes) => ({
          reservation: changes.reservations[0].returnsToAgency,
          history: changes.history[0].returnsToAgency,
        }));
      } finally {
        selectedId = originalSelectedId;
        ensureMovementActor = originalActorCheck;
        ensureTypedMovementPhone = originalPhoneCheck;
        updateSelectedSet = originalUpdateSet;
        finishKeyControlAction = originalFinish;
        logActivity = originalLog;
        movementPersonInput.value = originalPerson;
        movementPhoneInput.value = originalPhone;
      }
    });
    assert.deepEqual(savedReturnDecisions, [
      { reservation: true, history: true },
      { reservation: false, history: false },
    ]);
    const legacyDecision = await page.evaluate(async () => {
      const originalKeys = keys;
      const originalSelectedId = selectedId;
      const originalUpdateSet = updateSelectedSet;
      const originalMark = markKeyControlActionForSync;
      const originalSync = syncCloudAfterAction;
      let changes;
      try {
        selectedId = "T3-1";
        keys = originalKeys.map((key) => key.id === selectedId ? {
          ...key,
          sets: [{
            ...key.sets[0],
            reservations: [{ id: "legacy-reservation", createdAt: "26/09/2026 12:00" }],
            history: [{ id: "legacy-history", type: "reserved", reservationId: "legacy-reservation" }],
          }],
        } : key);
        updateSelectedSet = (next) => { changes = next; };
        markKeyControlActionForSync = () => {};
        syncCloudAfterAction = async () => {};
        const choice = setReservationReturnDecision("legacy-reservation");
        document.querySelector('.reservation-return-dialog button[value="no"]').click();
        await choice;
        return {
          reservation: changes.reservations[0].returnsToAgency,
          history: changes.history[0].returnsToAgency,
        };
      } finally {
        keys = originalKeys;
        selectedId = originalSelectedId;
        updateSelectedSet = originalUpdateSet;
        markKeyControlActionForSync = originalMark;
        syncCloudAfterAction = originalSync;
      }
    });
    assert.deepEqual(legacyDecision, { reservation: false, history: false });

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
    const photoCardViewport = page.viewportSize();
    for (const width of [320, 428, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const withPhoto of [false, true]) {
        const layout = await page.evaluate((photoPresent) => {
          const key = getSelectedKey();
          const photo = photoPresent
            ? "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
            : "";
          renderKeySetPhotos({ ...key, sets: [{ ...key.sets[0], id: selectedSetId, photo }] });
          const card = keySetPhotoList.querySelector(".key-set-photo-card");
          const preview = card.querySelector(".photo-preview");
          const title = preview.querySelector(".photo-set-select");
          const actions = [...card.querySelectorAll(".photo-actions > *")];
          const cardRect = card.getBoundingClientRect();
          const previewRect = preview.getBoundingClientRect();
          const titleRect = title.getBoundingClientRect();
          return {
            height: cardRect.height,
            titleInsidePreview: titleRect.left >= previewRect.left && titleRect.top >= previewRect.top &&
              titleRect.right <= previewRect.right && titleRect.bottom <= previewRect.bottom,
            titleTopLeft: titleRect.left - previewRect.left <= 20 && titleRect.top - previewRect.top <= 20,
            singleSelectedOutline: getComputedStyle(card).outlineColor === "rgb(0, 0, 0)" &&
              getComputedStyle(card).outlineWidth === "2px",
            titleStyle: title.tagName === "BUTTON" && getComputedStyle(title).fontSize === "14.3px" &&
              titleRect.height >= 21 && titleRect.height <= 24 &&
              getComputedStyle(title).backgroundColor === "rgba(238, 241, 239, 0.78)",
            actionsFit: actions.every((action) => {
              const rect = action.getBoundingClientRect();
              return rect.top >= cardRect.top && rect.bottom <= cardRect.bottom;
            }),
            noOverflow: card.scrollHeight <= card.clientHeight,
            actionCount: actions.length,
            actionHeights: actions.every((action) => Math.abs(action.getBoundingClientRect().height - 34) < 1),
            deleteTextBlack: !photoPresent || getComputedStyle(card.querySelector(".photo-delete-button")).color === "rgb(0, 0, 0)",
          };
        }, withPhoto);
        assert.deepEqual(layout, {
          height: 165,
          titleInsidePreview: true,
          titleTopLeft: true,
          singleSelectedOutline: true,
          titleStyle: true,
          actionsFit: true,
          noOverflow: true,
          actionCount: withPhoto ? 3 : 2,
          actionHeights: true,
          deleteTextBlack: true,
        });
      }
      for (const setCount of [2, 3, 4]) {
        const layout = await page.evaluate((count) => {
          const key = getSelectedKey();
          const photo = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
          renderKeySetPhotos({
            ...key,
            sets: Array.from({ length: count }, (_, index) => ({
              ...key.sets[0], id: index === 0 ? selectedSetId : `photo-layout-${index}`, label: `Jeu ${index + 1}`, photo,
            })),
          });
          const cards = [...keySetPhotoList.querySelectorAll(".key-set-photo-card")];
          const cardRects = cards.map((card) => card.getBoundingClientRect());
          const listRect = keySetPhotoList.getBoundingClientRect();
          return {
            columns: getComputedStyle(keySetPhotoList).gridTemplateColumns.split(" ").length,
            selectedOutline: getComputedStyle(cards[0]).outlineColor === "rgb(63, 63, 63)" &&
              getComputedStyle(cards[0]).outlineWidth === "3px" &&
              cards.slice(1).every((card) => getComputedStyle(card).outlineStyle === "none"),
            firstRowAligned: Math.abs(cardRects[0].top - cardRects[1].top) < 1,
            secondColumnRight: cardRects[1].left > cardRects[0].right,
            thirdInFirstRow: count !== 3 || (Math.abs(cardRects[2].top - cardRects[0].top) < 1 && cardRects[2].left > cardRects[1].right),
            secondRowAligned: count < 4 || (Math.abs(cardRects[2].left - cardRects[0].left) < 1 && cardRects[2].top > cardRects[0].bottom),
            fourthAligned: count < 4 || (Math.abs(cardRects[3].left - cardRects[1].left) < 1 && Math.abs(cardRects[3].top - cardRects[2].top) < 1),
            cardsFit: cards.every((card, index) => {
              const preview = card.querySelector(".photo-preview");
              const previewRect = preview.getBoundingClientRect();
              const title = preview.querySelector(".photo-set-select");
              const titleRect = title.getBoundingClientRect();
              const buttons = [...card.querySelectorAll(".photo-actions > *")];
              return cardRects[index].left >= listRect.left && cardRects[index].right <= listRect.right &&
                card.scrollHeight <= card.clientHeight && previewRect.height >= 100 &&
                titleRect.left >= previewRect.left && titleRect.right <= previewRect.right &&
                titleRect.top >= previewRect.top && titleRect.bottom <= previewRect.bottom &&
                getComputedStyle(title).fontSize === "14.3px" &&
                titleRect.height >= 21 && titleRect.height <= 24 &&
                buttons.length === 3 && buttons.every((button) => {
                  const rect = button.getBoundingClientRect();
                  const text = button.querySelector("span");
                  const textRect = text?.getBoundingClientRect();
                  return rect.left >= cardRects[index].left && rect.right <= cardRects[index].right &&
                    rect.top >= cardRects[index].top && rect.bottom <= cardRects[index].bottom &&
                    Math.abs(rect.height - 34) < 1 &&
                    button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight &&
                    (!textRect || (textRect.left >= rect.left && textRect.right <= rect.right &&
                      textRect.top >= rect.top && textRect.bottom <= rect.bottom));
              });
            }),
            buttonFonts: cards.every((card) => [...card.querySelectorAll(".photo-actions > *")]
              .every((button) => getComputedStyle(button).fontSize === (count === 3 ? "9px" : "11px"))),
          };
        }, setCount);
        assert.deepEqual(layout, {
          columns: setCount === 3 ? 3 : 2,
          selectedOutline: true,
          firstRowAligned: true,
          secondColumnRight: true,
          thirdInFirstRow: true,
          secondRowAligned: true,
          fourthAligned: true,
          cardsFit: true,
          buttonFonts: true,
        }, `${setCount} photo cards at ${width}px`);
      }
      const photoStatuses = await page.evaluate(() => {
        const key = getSelectedKey();
        const states = ["available", "reserved", "out"];
        renderKeySetPhotos({ ...key, sets: states.map((status, index) => ({
          ...key.sets[0],
          id: `status-${index}`,
          label: `Jeu ${index + 1}`,
          status: status === "out" ? "out" : "available",
          reservations: status === "reserved" ? [{ id: "test-reservation", createdAt: "2026-09-26T12:00:00Z" }] : [],
          photo: "",
        })) });
        const matchesTile = (card, status) => {
          const tile = document.createElement("button");
          tile.className = `key-tile ${status}`;
          document.body.append(tile);
          const cardStyle = getComputedStyle(card);
          const tileStyle = getComputedStyle(tile);
          const previewStyle = getComputedStyle(card.querySelector(".photo-preview"));
          const matches = card.classList.contains(status) &&
            cardStyle.backgroundColor === tileStyle.backgroundColor &&
            cardStyle.borderColor === tileStyle.borderColor &&
            previewStyle.backgroundColor === cardStyle.backgroundColor;
          tile.remove();
          return matches;
        };
        const activeCards = [...keySetPhotoList.querySelectorAll(".key-set-photo-card")];
        const activeMatch = states.every((status, index) => matchesTile(activeCards[index], status));
        renderKeySetPhotos({
          id: "T3-1", category: "T3", number: 1, owner: "", property: "", postalCode: "", city: "", notes: "",
          sets: [makeKeySet("main")],
        });
        return { activeMatch, emptyMatch: matchesTile(keySetPhotoList.querySelector(".key-set-photo-card"), "empty") };
      });
      assert.deepEqual(photoStatuses, { activeMatch: true, emptyMatch: true });
      for (const [imageWidth, imageHeight] of [[200, 300], [300, 200]]) {
        await page.evaluate(({ imageWidth: sourceWidth, imageHeight: sourceHeight }) => {
          const canvas = document.createElement("canvas");
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const context = canvas.getContext("2d");
          context.fillStyle = "#ff0000";
          context.fillRect(0, 0, sourceWidth, sourceHeight / 2);
          context.fillStyle = "#0000ff";
          context.fillRect(0, sourceHeight / 2, sourceWidth, sourceHeight / 2);
          const key = getSelectedKey();
          renderKeySetPhotos({ ...key, sets: [{ ...key.sets[0], photo: canvas.toDataURL("image/png") }] });
        }, { imageWidth, imageHeight });
        const screenshot = PNG.sync.read(await page.locator(".photo-preview").screenshot());
        const colorAt = (x, y) => {
          const offset = (Math.floor(y * screenshot.height) * screenshot.width + Math.floor(x * screenshot.width)) * 4;
          return [...screenshot.data.subarray(offset, offset + 3)];
        };
        const top = colorAt(0.5, 0.3);
        const bottom = colorAt(0.5, 0.7);
        assert.ok(top[0] > 200 && top[2] < 50, `Photo top cropped at ${width}px (${imageWidth}x${imageHeight}): ${top}`);
        assert.ok(bottom[2] > 200 && bottom[0] < 50, `Photo bottom cropped at ${width}px (${imageWidth}x${imageHeight}): ${bottom}`);
      }
    }
    const secondSetId = await page.evaluate(() => {
      const key = getSelectedKey();
      selectedSetId = key.sets[0].id;
      render();
      renderKeySetPhotos({
        ...key,
        sets: key.sets.map((set) => ({
          ...set, photo: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
        })),
      });
      return key.sets[1].id;
    });
    await page.locator(".photo-set-select").nth(1).click();
    assert.equal(await page.locator("#keySetSelect").inputValue(), secondSetId);
    assert.equal(await page.locator(".key-set-photo-card.is-selected .photo-set-select").textContent(), "Jeu 2");
    assert.equal(await page.evaluate(() => !photoViewer || photoViewer.hidden), true);
    await page.locator(".photo-set-select").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".key-set-photo-card.is-selected .photo-set-select").textContent(), "Jeu 1");
    await page.evaluate(() => {
      const key = getSelectedKey();
      renderKeySetPhotos({ ...key, sets: key.sets.map((set) => ({
        ...set, photo: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
      })) });
    });
    await page.locator(".photo-preview img").first().click();
    assert.equal(await page.locator(".photo-viewer").isVisible(), true);
    await page.locator(".photo-viewer-close").click();
    for (const width of [390, 820]) {
      const touchPage = await browser.newPage({
        viewport: { width, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
      });
      try {
        await touchPage.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
        const labelStyle = await touchPage.evaluate(() => {
          const label = document.createElement("button");
          label.className = "photo-set-select";
          document.body.append(label);
          const style = getComputedStyle(label);
          const result = {
            finePointer: matchMedia("(hover: hover) and (pointer: fine)").matches,
            fontSize: style.fontSize,
            padding: style.padding,
          };
          label.remove();
          return result;
        });
        assert.deepEqual(labelStyle, { finePointer: false, fontSize: "16px", padding: "3px 5px" });
      } finally {
        await touchPage.close();
      }
    }
    await page.setViewportSize(photoCardViewport);
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
