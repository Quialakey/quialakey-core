const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

function cardSpacing(item) {
  const styles = (selector, properties) => {
    const target = selector ? item.querySelector(selector) : item;
    return properties.map((property) => getComputedStyle(target)[property]);
  };
  return {
    card: styles(null, ["rowGap", "paddingTop", "paddingBottom"]),
    heading: styles("strong", ["marginBottom", "lineHeight"]),
    comment: styles(".reservation-comment-field", ["rowGap", "marginTop"]),
    actions: styles(".reservation-history-actions", ["rowGap", "marginTop", "marginBottom"]),
    footer: styles("small", ["marginTop", "lineHeight"]),
  };
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      const contents = await fs.readFile(file);
      response.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      response.end(contents);
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
      body: 'window.QUIALAKEY_CONFIG = Object.freeze({ agencyId: "return-test", agencyName: "Test", supabaseUrl: "https://mock.supabase.co", supabasePublishableKey: "test", migrateLegacyStorage: true });',
    }));
    await page.route("**/mock.supabase.co/**", (route) => {
      const url = new URL(route.request().url());
      const rows = url.searchParams.get("key")?.includes("cles-table-settings-v1")
        ? [{ key: "cles-table-settings-v1", value: { accessLockEnabled: false }, updated_at: "2026-10-07T10:00:00Z" }]
        : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof confirmReturnedSetMovement === "function" &&
      hasCompletedInitialCloudLoad && hasStartedCloudInactivityTracking && !isCloudCheckRunning);
    assert.deepEqual(await page.evaluate(() => smoothSignaturePoint({ x: 0, y: 0 }, { x: 100, y: 50 })),
      { x: 65, y: 32.5 });
    await page.evaluate(() => { window.__photoPrompt = promptMovementSignature("Sorti"); });
    assert.deepEqual(await page.locator(".movement-signature-dialog h3").allTextContents(),
      ["Photo - Sorti", "Signature - Sorti"]);
    assert.equal(await page.locator(".movement-photo-button").textContent(), "Prendre une photo");
    const emptyPhotoHeight = await page.locator(".movement-photo-field")
      .evaluate((field) => field.getBoundingClientRect().height);
    assert.ok(emptyPhotoHeight <= 110);
    if (process.env.MOVEMENT_PHOTO_EMPTY_SCREENSHOT) {
      await page.locator(".movement-signature-dialog").screenshot({ path: process.env.MOVEMENT_PHOTO_EMPTY_SCREENSHOT });
    }
    const makePhotoBuffer = async (color) => Buffer.from(await page.evaluate((fill) => {
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 90;
      const context = canvas.getContext("2d");
      context.fillStyle = fill;
      context.fillRect(0, 0, 120, 90);
      return canvas.toDataURL("image/png").split(",")[1];
    }, color), "base64");
    const capturePhoto = async (color) => {
      const chooserPromise = page.waitForEvent("filechooser");
      await page.locator(".movement-photo-button").click();
      await (await chooserPromise).setFiles({ name: "cles.png", mimeType: "image/png", buffer: await makePhotoBuffer(color) });
      await page.waitForFunction(() => document.querySelector(".movement-photo-button")?.textContent === "Reprendre une photo" &&
        !isPhotoImporting);
    };
    await capturePhoto("#cc4455");
    const firstPhoto = await page.locator(".movement-photo-preview").getAttribute("src");
    assert.match(firstPhoto, /^data:image\/jpeg;base64,/);
    const filledPhotoHeight = await page.locator(".movement-photo-field")
      .evaluate((field) => field.getBoundingClientRect().height);
    assert.equal(filledPhotoHeight, 154);
    assert.ok(filledPhotoHeight > emptyPhotoHeight);
    assert.equal(await page.locator(".movement-photo-delete-button").isVisible(), true);
    assert.ok(await page.locator(".movement-photo-preview").evaluate((image) => image.getBoundingClientRect().height) >= 120);
    await capturePhoto("#336699");
    assert.notEqual(await page.locator(".movement-photo-preview").getAttribute("src"), firstPhoto);
    await page.locator(".movement-photo-delete-button").click();
    assert.equal(await page.locator(".movement-photo-button").textContent(), "Prendre une photo");
    assert.equal(await page.locator(".movement-photo-preview").isVisible(), false);
    assert.equal(await page.locator(".movement-photo-delete-button").isVisible(), false);
    assert.equal(await page.locator(".movement-photo-field").evaluate((field) => field.getBoundingClientRect().height),
      emptyPhotoHeight);
    await capturePhoto("#336699");
    const signatureBox = await page.locator(".movement-signature-canvas").boundingBox();
    const signatureEnd = { x: signatureBox.x + signatureBox.width - 30,
      y: signatureBox.y + signatureBox.height - 30 };
    await page.mouse.move(signatureBox.x + 20, signatureBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(signatureEnd.x, signatureEnd.y);
    await page.mouse.up();
    assert.equal(await page.locator(".movement-signature-canvas").evaluate((canvas, end) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((end.x - rect.left) / rect.width * canvas.width);
      const y = Math.round((end.y - rect.top) / rect.height * canvas.height);
      const pixels = canvas.getContext("2d").getImageData(x - 3, y - 3, 7, 7).data;
      return Array.from(pixels).some((value, index) => index % 4 === 3 && value > 0);
    }, signatureEnd), true);
    if (process.env.MOVEMENT_PHOTO_DIALOG_SCREENSHOT) {
      await page.locator(".movement-signature-dialog").screenshot({ path: process.env.MOVEMENT_PHOTO_DIALOG_SCREENSHOT });
    }
    await page.locator(".movement-signature-validate").click();
    const photoEvidence = await page.evaluate(async () => {
      window.__photoEvidence = await window.__photoPrompt;
      return { signature: window.__photoEvidence.signature.slice(0, 22),
        movementPhoto: window.__photoEvidence.movementPhoto.slice(0, 23) };
    });
    assert.match(photoEvidence.signature, /^data:image\/png;base64/);
    assert.match(photoEvidence.movementPhoto, /^data:image\/jpeg;base64/);
    await page.evaluate(() => {
      const key = normalizeKey({ id: "T2-1", category: "T2", number: 1, owner: "TEST", property: "1 rue Test",
        sets: [{ ...makeKeySet("main"), status: "out", holder: "Test",
          history: [{ id: "photo-movement", type: "out", person: "Test", date: "15/11/2026 14:00",
            ...window.__photoEvidence }] }] });
      keys = [key];
      selectedId = key.id;
      selectedSetId = "main";
      renderPanel();
    });
    await page.locator("#keyHistoryToggleBtn").click();
    const evidenceSizes = await page.locator("#historyList .history-evidence").evaluate((row) => ({
      photo: row.querySelector(".history-movement-photo").getBoundingClientRect().height,
      signature: row.querySelector(".history-signature").getBoundingClientRect().height,
    }));
    assert.equal(evidenceSizes.photo, evidenceSizes.signature);
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopEvidenceSizes = await page.locator("#historyList .history-evidence").evaluate((row) => ({
      photo: row.querySelector(".history-movement-photo").getBoundingClientRect().height,
      signature: row.querySelector(".history-signature").getBoundingClientRect().height,
    }));
    assert.equal(desktopEvidenceSizes.photo, desktopEvidenceSizes.signature);
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.MOVEMENT_PHOTO_HISTORY_SCREENSHOT) {
      await page.locator("#historyList .history-evidence").screenshot({ path: process.env.MOVEMENT_PHOTO_HISTORY_SCREENSHOT });
    }
    await page.locator("#historyList .history-movement-photo").click();
    assert.equal(await page.locator(".photo-viewer").isVisible(), true);
    assert.equal(await page.locator(".photo-viewer img").getAttribute("src"),
      await page.evaluate(() => window.__photoEvidence.movementPhoto));
    await page.locator(".photo-viewer-close").click();
    for (const action of ["Entr\u00e9", "Rentr\u00e9"]) {
      await page.evaluate((label) => { window.__photoPrompt = promptMovementSignature(label); }, action);
      assert.deepEqual(await page.locator(".movement-signature-dialog h3").allTextContents(),
        ["Photo - Entr\u00e9", `Signature - ${action}`]);
      assert.equal(await page.locator(".movement-photo-button").textContent(), "Prendre une photo");
      await page.locator(".movement-signature-cancel").click();
      assert.equal(await page.evaluate(() => window.__photoPrompt), null);
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => { window.__photoPrompt = promptMovementSignature("Sorti"); });
    await capturePhoto("#336699");
    const narrowPhotoLayout = await page.locator(".movement-photo-field").evaluate((field) => {
      const actions = field.querySelector(".movement-photo-actions");
      const preview = field.querySelector(".movement-photo-preview-frame");
      return { noOverflow: actions.getBoundingClientRect().right <= field.getBoundingClientRect().right,
        previewHeight: preview.getBoundingClientRect().height,
        buttonHeight: actions.querySelector(".movement-photo-button").getBoundingClientRect().height };
    });
    assert.equal(narrowPhotoLayout.noOverflow, true);
    assert.ok(narrowPhotoLayout.previewHeight >= 120);
    assert.ok(narrowPhotoLayout.buttonHeight >= 40);
    if (process.env.MOVEMENT_PHOTO_NARROW_SCREENSHOT) {
      await page.locator(".movement-signature-dialog").screenshot({ path: process.env.MOVEMENT_PHOTO_NARROW_SCREENSHOT });
    }
    await page.locator(".movement-signature-cancel").click();
    await page.setViewportSize({ width: 390, height: 844 });
    const sameSlotWithReorderedFields = await page.evaluate(() => {
      const local = normalizeKey({
        id: "T2-6", category: "T2", number: 6,
        sets: [{ ...makeKeySet("main"), history: [{ id: "movement-1", type: "out", person: "Test", date: "07/10/2026 18:00" }] }],
      });
      const remote = structuredClone(local);
      remote.sets[0].history[0] = { date: "07/10/2026 18:00", person: "Test", type: "out", id: "movement-1" };
      return cloudRowMatchesPendingKeySlotWrite(
        { key: "cles-transaction-v1::slot::T2-6", value: remote },
        { value: local, comparableValue: JSON.stringify(local) },
      );
    });
    assert.equal(sameSlotWithReorderedFields, true, "JSON field order must not cause repeated slot writes");
    const restWrite = await page.evaluate(async () => {
      const originalFetch = window.fetch;
      let request;
      try {
        window.fetch = async (url, options) => {
          request = { url: String(url), method: options.method, payload: JSON.parse(options.body) };
          return new Response(JSON.stringify([{ key: "test-slot", value: {}, updated_at: "new" }]), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        };
        const client = createRestSupabaseClient("https://mock.supabase.co", "test");
        const result = await client.from("app_state")
          .update({ key: "test-slot", value: {}, updated_at: "new", expected_updated_at: "old" })
          .eq("key", "test-slot").eq("updated_at", "old").maybeSingle();
        return { ...request, result: result.data?.key };
      } finally {
        window.fetch = originalFetch;
      }
    });
    assert.equal(restWrite.method, "PATCH");
    assert.equal(new URL(restWrite.url).searchParams.get("updated_at"), "eq.old");
    assert.equal(restWrite.payload.expected_updated_at, "old");
    assert.equal(restWrite.result, "test-slot");

    await page.evaluate(() => {
      loadStorageFromCloud = async () => {};
      requestAutomaticCloudRefresh = () => {};
      retryFailedCloudSyncs = async () => {};
      checkCloudSyncHeartbeat = async () => {};
      const originalLogActivity = logActivity;
      window.__returnLogs = [];
      logActivity = (...args) => window.__returnLogs.push(args);
      scheduleCloudSyncHeartbeat = () => {};
      hasPendingCloudRowChange = () => false;
      promptMovementSignature = async () => "";
      ensureMovementActor = () => true;
      ensureCompletePhoneNumber = () => true;
      alert = (message) => { window.__returnAlert = message; };
      window.__resetReturn = (registry = "transaction") => {
        activeRegistry = registry;
        selectedId = "Maison-4";
        selectedSetId = "main";
        selectedArchiveRecord = null;
        beginKeyWorkProtection();
        window.__returnLogs.length = 0;
        window.__returnAlert = "";
        const key = normalizeKey({
          id: selectedId, category: "Maison", number: 4, owner: "GUINGAL", property: "37 rue Test",
          sets: [{ ...makeKeySet("main"), status: "out", holder: "Raquel PEROZO",
            holderPhone: "0700000000", history: [{ id: "checkout-1", type: "out", person: "Raquel PEROZO", date: "07/10/2026 18:00" }] }],
        });
        keys = [key];
        window.__remoteRow = {
          key: getKeySlotCloudKey(getRegistryConfig().keysStorageKey, key.id),
          value: JSON.parse(JSON.stringify(key)),
          updated_at: "2026-10-07T16:00:00Z",
        };
        movementPhoneInput.value = "0700000000";
        render();
      };
      window.__resetReservationReturn = () => {
        window.__resetReturn();
        const set = keys[0].sets[0];
        set.holderReservationId = "reservation-1";
        set.reservations = [{ id: "reservation-1", person: "Raquel PEROZO", phone: "0700000000",
          reservationDate: "08/10/2026 18:00", returnsToAgency: true }];
        set.history = [
          { id: "checkout-reservation-1", type: "out", person: "Raquel PEROZO", reservationId: "reservation-1", date: "07/10/2026 18:00" },
          { id: "reserved-1", type: "reserved", reservationId: "reservation-1", person: "Raquel PEROZO",
            reservationDate: "08/10/2026 18:00", date: "07/10/2026 17:00" },
        ];
        window.__remoteRow.value = structuredClone(keys[0]);
        render();
      };
      supabaseClient.from = () => {
        let payload = null;
        const filters = {};
        return {
          select() { return this; },
          eq(column, value) { filters[column] = value; return this; },
          update(value) { payload = value; return this; },
          maybeSingle() {
            if (!payload) return Promise.resolve({ data: structuredClone(window.__remoteRow), error: null });
            window.__returnPayload = payload;
            window.__returnFilters = filters;
            return new Promise((resolve) => {
              window.__resolveWrite = (mode) => {
                if (mode !== "failure") window.__remoteRow = {
                  key: payload.key, value: structuredClone(payload.value), updated_at: payload.updated_at,
                };
                resolve(mode === "success"
                  ? { data: structuredClone(window.__remoteRow), error: null }
                  : { data: null, error: { message: "offline" } });
              };
            });
          },
        };
      };
      window.__resetReturn();
      window.__originalLogActivity = originalLogActivity;
    });

    await page.evaluate(() => {
      window.__resetReturn();
      const set = keys[0].sets[0];
      set.status = "available";
      set.holder = "";
      set.holderPhone = "";
      set.history = [];
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      window.__remoteRow.value = structuredClone(keys[0]);
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
      window.__resolveWrite = null;
      renderPanel();
    });
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), false);
    assert.equal(await page.locator("#checkoutBtn").textContent(), "En cours...");
    assert.equal(await page.locator("#checkoutBtn").getAttribute("aria-busy"), "true");
    assert.notEqual(await page.locator("#checkoutBtn").evaluate((button) => getComputedStyle(button, "::after").content), "none");
    assert.equal(await page.locator("#checkinBtn").isDisabled(), true);
    assert.equal(await page.locator("#closePanelBtn").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__returnLogs.length), 0);
    assert.equal(await page.evaluate(() => { switchRegistry(); renderPanel(); return activeRegistry; }), "transaction");
    assert.equal(await page.locator("#checkoutBtn").textContent(), "En cours...");
    assert.equal(await page.locator("#checkoutBtn").getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("#checkinBtn").getAttribute("aria-busy"), "false");
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), false);
    await page.evaluate(() => window.__resolveWrite("failure"));
    await page.waitForFunction(() => !isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    assert.equal(await page.locator("#checkoutBtn").textContent(), "Sorti");
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), false);
    assert.equal(await page.evaluate(() => movementPersonInput.value), "Raquel");
    await page.evaluate(() => { window.__resolveWrite = null; });
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets[0].status === "out" && !isConfirmingReturn);
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), true);
    assert.equal(await page.evaluate(() => selectedId), "Maison-4");
    assert.equal(await page.evaluate(() => getUndoCheckout(undoSnapshot)?.isLastAction), true);
    assert.equal(await page.evaluate(() => movementPersonInput.value), "");

    await page.evaluate(() => {
      window.__resetReturn();
      keys[0].sets[0] = { ...makeKeySet("main"), history: [] };
      keys[0].sets.push(makeKeySet("double"));
      window.__remoteRow.value = structuredClone(keys[0]);
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      selectedSetId = "main";
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
      window.__signatureCount = 0;
      promptMovementSignature = async () => {
        window.__signatureCount += 1;
        return { signature: "signature-group", movementPhoto: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" };
      };
      window.__resolveWrite = null;
      renderPanel();
    });
    assert.equal(await page.locator("#multiSetSelectionLabel").isVisible(), true);
    await page.locator("#multiSetSelectionInput").check();
    assert.equal(await page.locator('.photo-set-select[aria-pressed="true"]').count(), 0);
    assert.equal(await page.locator("#checkoutBtn").isDisabled(), true);
    await page.evaluate(() => { keys[0].sets[1].needsCheckIn = true; renderPanel(); });
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.match(await page.evaluate(() => window.__returnAlert), /Validez d'abord l'entrée du Jeu 2/);
    assert.equal(await page.locator('.photo-set-select[aria-pressed="true"]').count(), 0);
    await page.evaluate(() => { keys[0].sets[1].needsCheckIn = false; renderPanel(); });
    const originalLabelBackground = await page.locator(".photo-set-select").first()
      .evaluate((button) => getComputedStyle(button).backgroundColor);
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.equal(await page.locator(".photo-set-select").nth(1).getAttribute("aria-pressed"), "true");
    await page.locator(".photo-set-check-icon").first().click();
    assert.equal(await page.locator(".key-set-photo-card.is-selected").count(), 2);
    assert.equal(await page.locator(".photo-set-check-icon").count(), 2);
    assert.equal(await page.locator(".photo-set-select").first()
      .evaluate((button) => getComputedStyle(button).backgroundColor), originalLabelBackground);
    assert.equal(await page.locator("#reservedBtn").isEnabled(), true);
    if (process.env.MULTI_SET_SCREENSHOT) {
      await page.locator(".photo-box").screenshot({ path: process.env.MULTI_SET_SCREENSHOT });
    }
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    const pendingGroup = await page.evaluate(() => ({
      localStatuses: keys[0].sets.map((set) => set.status),
      remoteStatuses: window.__remoteRow.value.sets.map((set) => set.status),
      pendingStatuses: window.__returnPayload.value.sets.map((set) => set.status),
      signatures: window.__returnPayload.value.sets.map((set) => set.history[0].signature),
      photos: window.__returnPayload.value.sets.map((set) => set.history[0].movementPhoto),
      movementIds: window.__returnPayload.value.sets.map((set) => set.history[0].id),
      signatureCount: window.__signatureCount,
      busy: checkoutBtn.getAttribute("aria-busy"),
    }));
    assert.deepEqual(pendingGroup.localStatuses, ["available", "available"]);
    assert.deepEqual(pendingGroup.remoteStatuses, ["available", "available"]);
    assert.deepEqual(pendingGroup.pendingStatuses, ["out", "out"]);
    assert.deepEqual(pendingGroup.signatures, ["signature-group", "signature-group"]);
    assert.equal(pendingGroup.photos[0], pendingGroup.photos[1]);
    assert.match(pendingGroup.photos[0], /^data:image\/gif;base64,/);
    assert.notEqual(pendingGroup.movementIds[0], pendingGroup.movementIds[1]);
    assert.equal(pendingGroup.signatureCount, 1);
    assert.equal(pendingGroup.busy, "true");
    await page.evaluate(() => window.__resolveWrite("failure"));
    await page.waitForFunction(() => !isConfirmingReturn);
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.status)), ["available", "available"]);
    assert.equal(await page.locator(".key-set-photo-card.is-selected").count(), 2);
    await page.evaluate(() => { window.__resolveWrite = null; });
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets.every((set) => set.status === "out") && !isConfirmingReturn);
    assert.equal(await page.evaluate(() => selectedId), null);
    await page.evaluate(() => { selectedId = "Maison-4"; renderPanel(); });
    assert.equal(await page.locator("#activeCheckoutPanel li").count(), 2);
    assert.equal(await page.locator("#multiSetSelectionInput").isChecked(), false);
    assert.equal(await page.evaluate(() => getUndoCheckoutGroup(undoSnapshot)?.isLastAction), true);
    assert.equal(await page.evaluate(() => window.__returnLogs.length), 2);
    assert.equal(await page.evaluate(() => getRegistryHistoryEntries("transaction")
      .filter((item) => item.keyId === "Maison-4" && item.action === "Sorti").length), 2);
    await page.evaluate(() => {
      window.__resolveWrite = null;
      window.__undoGroupPromise = undoPreviousStep();
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isUndoingCheckout);
    assert.deepEqual(await page.evaluate(() => window.__returnPayload.value.sets.map((set) => set.history[0].returnReason)),
      ["undo-checkout", "undo-checkout"]);
    await page.evaluate(async () => {
      window.__resolveWrite("success");
      await window.__undoGroupPromise;
    });
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.status)), ["available", "available"]);
    assert.equal(await page.evaluate(() => undoSnapshot), null);
    await page.locator("#multiSetSelectionInput").check();
    await page.locator(".photo-set-check-icon").first().click();
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.equal(await page.locator('.photo-set-select[aria-pressed="true"]').count(), 2);
    await page.evaluate(() => {
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
      window.__resolveWrite = null;
    });
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets.every((set) => set.status === "out") && !isConfirmingReturn);
    assert.equal(await page.evaluate(() => selectedId), null);
    await page.evaluate(() => { selectedId = "Maison-4"; renderPanel(); });
    await page.evaluate(() => { window.__resolveWrite = null; });
    await page.locator("#activeCheckoutPanel li").nth(1).locator("button").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn, null, { timeout: 5000 })
      .catch(async () => {
        throw new Error(JSON.stringify(await page.evaluate(() => ({
          selectedId, selectedSetId, isConfirmingReturn, isUndoingCheckout, alert: window.__returnAlert,
          statuses: keys[0].sets.map((set) => set.status), resolver: typeof window.__resolveWrite,
          buttonLabels: [...document.querySelectorAll("#activeCheckoutPanel li button")].map((button) => button.textContent),
        }))));
      });
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets.filter((set) => set.status === "out").length === 1 && !isConfirmingReturn);
    await page.evaluate(() => { selectedId = "Maison-4"; renderPanel(); });
    assert.equal(await page.locator("#activeCheckoutPanel li").count(), 1);
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.status).sort()), ["available", "out"]);

    await page.evaluate(() => {
      window.__resetReturn();
      keys[0].sets = [{ ...makeKeySet("main"), history: [] }, makeKeySet("double")];
      window.__remoteRow.value = structuredClone(keys[0]);
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      selectedSetId = "main";
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
      window.__reservationDatePrompts = 0;
      window.__reservationReturnPrompts = 0;
      promptReservationDateTime = async () => {
        window.__reservationDatePrompts += 1;
        return "2026-11-20T15:00";
      };
      promptReservationReturn = async () => {
        window.__reservationReturnPrompts += 1;
        return true;
      };
      window.__resolveWrite = null;
      renderPanel();
    });
    await page.locator("#multiSetSelectionInput").check();
    assert.equal(await page.locator("#reservedBtn").isDisabled(), true);
    await page.locator(".photo-set-check-icon").first().click();
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.equal(await page.locator("#reservedBtn").isEnabled(), true);
    await page.locator("#reservedBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    const pendingReservation = await page.evaluate(() => ({
      localCounts: keys[0].sets.map((set) => set.reservations.length),
      pendingCounts: window.__returnPayload.value.sets.map((set) => set.reservations.length),
      reservationIds: window.__returnPayload.value.sets.map((set) => set.reservations[0].id),
      movementIds: window.__returnPayload.value.sets.map((set) => set.history[0].id),
      dates: window.__returnPayload.value.sets.map((set) => set.reservations[0].reservationDate),
      prompts: [window.__reservationDatePrompts, window.__reservationReturnPrompts],
      busy: reservedBtn.getAttribute("aria-busy"),
    }));
    assert.deepEqual(pendingReservation.localCounts, [0, 0]);
    assert.deepEqual(pendingReservation.pendingCounts, [1, 1]);
    assert.notEqual(pendingReservation.reservationIds[0], pendingReservation.reservationIds[1]);
    assert.notEqual(pendingReservation.movementIds[0], pendingReservation.movementIds[1]);
    assert.equal(pendingReservation.dates[0], pendingReservation.dates[1]);
    assert.deepEqual(pendingReservation.prompts, [1, 1]);
    assert.equal(pendingReservation.busy, "true");
    await page.evaluate(() => window.__resolveWrite("failure"));
    await page.waitForFunction(() => !isConfirmingReturn);
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.reservations.length)), [0, 0]);
    assert.equal(await page.locator('.photo-set-select[aria-pressed="true"]').count(), 2);
    await page.evaluate(() => { window.__resolveWrite = null; });
    await page.locator("#reservedBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets.every((set) => set.reservations.length === 1) && !isConfirmingReturn);
    assert.equal(await page.evaluate(() => selectedId), null);
    assert.equal(await page.evaluate(() => window.__returnLogs.length), 2);
    assert.equal(await page.evaluate(() => getRegistryHistoryEntries("transaction")
      .filter((item) => item.keyId === "Maison-4" && item.action === "Réservé").length), 2);
    await page.evaluate(() => { selectedId = "Maison-4"; renderPanel(); });
    assert.equal(await page.locator("#activeReservationPanel li").count(), 2);
    assert.equal(await page.evaluate(() => getUndoReservationGroup(undoSnapshot)?.isLastAction), true);
    await page.evaluate(() => {
      window.__resolveWrite = null;
      window.__undoReservationPromise = undoPreviousStep();
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isUndoingCheckout);
    assert.deepEqual(await page.evaluate(() => window.__returnPayload.value.sets.map((set) => set.reservations.length)), [0, 0]);
    assert.deepEqual(await page.evaluate(() => window.__returnPayload.value.sets.map((set) => set.history[0].type)),
      ["cancel-reservation", "cancel-reservation"]);
    await page.evaluate(async () => {
      window.__resolveWrite("success");
      await window.__undoReservationPromise;
    });
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.reservations.length)), [0, 0]);
    assert.equal(await page.evaluate(() => undoSnapshot), null);

    await page.evaluate(() => {
      keys[0].sets[1].status = "out";
      keys[0].sets[1].holder = "Raquel PEROZO";
      keys[0].sets[1].history.unshift({ id: "older-checkout", type: "out", person: "Raquel PEROZO",
        date: "15/11/2026 10:00" });
      window.__remoteRow.value = structuredClone(keys[0]);
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
      window.__resolveWrite = null;
      renderPanel();
    });
    await page.locator("#multiSetSelectionInput").check();
    await page.locator(".photo-set-check-icon").first().click();
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.equal(await page.locator("#checkoutBtn").isDisabled(), true);
    assert.equal(await page.locator("#reservedBtn").isEnabled(), true);
    await page.locator("#reservedBtn").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    assert.deepEqual(await page.evaluate(() => window.__returnPayload.value.sets.map((set) => set.status)),
      ["available", "out"]);
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets.every((set) => set.reservations.length === 1) && !isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[1].status), "out");

    for (const mode of ["success", "failure", "uncertain"]) {
      await page.evaluate(() => {
        window.__resetReturn();
        window.__resolveWrite = null;
        window.__returnPromise = addMovement("in");
      });
      await page.waitForFunction(() => typeof window.__resolveWrite === "function");
      const pending = await page.evaluate(() => ({
        status: keys[0].sets[0].status,
        busy: isConfirmingReturn,
        disabled: checkinBtn.disabled,
        label: checkinBtn.textContent,
        spinner: getComputedStyle(checkinBtn, "::after").content,
        logs: window.__returnLogs.length,
        expectedVersion: window.__returnPayload.expected_updated_at,
        filterVersion: window.__returnFilters.updated_at,
      }));
      assert.equal(pending.status, "out", `pending ${mode}`);
      assert.equal(pending.busy, true);
      assert.equal(pending.disabled, true);
      assert.equal(pending.label, "Enregistrement...");
      assert.notEqual(pending.spinner, "none");
      assert.equal(pending.logs, 0);
      assert.equal(pending.expectedVersion, pending.filterVersion);

      await page.evaluate(async (result) => {
        window.__resolveWrite(result);
        await window.__returnPromise;
      }, mode);
      const finished = await page.evaluate(() => ({
        local: keys[0].sets[0].status,
        remote: window.__remoteRow.value.sets[0].status,
        localReturns: keys[0].sets[0].history.filter((entry) => entry.returnReason === "returned").length,
        logs: window.__returnLogs.length,
        busy: isConfirmingReturn,
        alert: window.__returnAlert,
      }));
      assert.equal(finished.local, mode === "failure" ? "out" : "available");
      assert.equal(finished.remote, mode === "failure" ? "out" : "available");
      assert.equal(finished.localReturns, mode === "failure" ? 0 : 1);
      if (mode !== "failure") assert.match(await page.evaluate(() => keys[0].sets[0].history[0].movementPhoto),
        /^data:image\/gif;base64,/);
      assert.equal(finished.logs, mode === "failure" ? 0 : 1);
      assert.equal(finished.busy, false);
      assert.equal(Boolean(finished.alert), mode === "failure");
    }
    await page.evaluate(() => window.__resetReturn());
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), true);
    assert.equal(await page.locator("#activeReservationPanel").isVisible(), false);
    assert.equal(await page.locator("#checkinBtn").isVisible(), false);
    assert.equal(await page.locator("#movementContactDetails").evaluate((details) => details.open), false);
    assert.equal(await page.locator("#movementNameInput").isVisible(), false);
    await page.locator("#movementContactDetails summary").click();
    assert.equal(await page.locator("#movementNameInput").isVisible(), true);
    assert.equal(await page.locator("#activeCheckoutPanel li").count(), 1);
    const checkoutSpacing = await page.locator("#activeCheckoutPanel li").evaluate(cardSpacing);
    assert.equal(await page.locator("#activeCheckoutPanel li strong").nth(1).textContent(), "Le 07/10/2026 à 18:00");
    assert.equal(await page.locator("#activeCheckoutPanel li small").textContent(), "Sorti le 07/10/2026 18:00");
    assert.deepEqual(await page.locator("#activeCheckoutPanel li").evaluate((item) =>
      [...item.children].map((child) => child.tagName)), ["STRONG", "STRONG", "LABEL", "DIV", "SMALL"]);
    assert.equal(await page.locator("#activeCheckoutPanel li").evaluate((item) => getComputedStyle(item).backgroundColor), "rgb(242, 206, 200)");
    assert.equal(await page.locator("#activeCheckoutPanel .reservation-history-button.in").evaluate((button) => getComputedStyle(button).backgroundColor),
      await page.locator("#checkinBtn").evaluate((button) => getComputedStyle(button).backgroundColor));
    await page.locator("#activeCheckoutPanel .checkout-comment-input").fill("Retour rapide avec commentaire");
    await page.evaluate(() => renderPanel());
    assert.equal(await page.locator("#activeCheckoutPanel .checkout-comment-input").inputValue(), "Retour rapide avec commentaire");
    await page.locator("#activeCheckoutPanel .reservation-history-button.in").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.locator("#activeCheckoutPanel .reservation-history-button.in").textContent(), "Enregistrement...");
    assert.equal(await page.locator("#activeCheckoutPanel .reservation-history-button.in").getAttribute("aria-busy"), "true");
    await page.evaluate(() => {
      window.__resolveWrite("failure");
      window.__resolveWrite = null;
    });
    await page.waitForFunction(() => !isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "out");
    assert.equal(await page.locator("#activeCheckoutPanel .checkout-comment-input").inputValue(), "Retour rapide avec commentaire");
    await page.locator("#activeCheckoutPanel .reservation-history-button.in").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets[0].status === "available" && !isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].history[0].note), "Retour rapide avec commentaire");
    assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), false);
    await page.evaluate(() => {
      window.__resetReturn();
      keys[0].sets.push({ ...makeKeySet("double"), status: "out", holder: "Autre intervenant",
        holderPhone: "0600000000", history: [{ id: "checkout-2", type: "out", person: "Autre intervenant",
          date: "07/10/2026 19:00" }] });
      window.__remoteRow.value = structuredClone(keys[0]);
      renderPanel();
    });
    assert.equal(await page.locator("#activeCheckoutPanel li").count(), 2);
    await page.locator("#activeCheckoutPanel li").first().locator("textarea").fill("Commentaire jeu 1");
    await page.locator("#activeCheckoutPanel li").nth(1).locator("textarea").fill("Commentaire jeu 2");
    await page.evaluate(() => renderPanel());
    assert.deepEqual(await page.locator("#activeCheckoutPanel textarea").evaluateAll((inputs) => inputs.map((input) => input.value)),
      ["Commentaire jeu 1", "Commentaire jeu 2"]);
    await page.locator("#activeCheckoutPanel li").nth(1).locator("button").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.evaluate(() => selectedSetId), "double");
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets[1].status === "available" && !isConfirmingReturn);
    assert.deepEqual(await page.evaluate(() => keys[0].sets.map((set) => set.status)), ["out", "available"]);
    assert.equal(await page.evaluate(() => keys[0].sets[1].history[0].note), "Commentaire jeu 2");
    const staleReturn = await page.evaluate(async () => {
      window.__resetReturn();
      window.__remoteRow.value.sets[0].history.unshift({
        id: "newer-checkout", type: "out", person: "Raquel PEROZO", date: "07/10/2026 19:00",
      });
      window.__resolveWrite = null;
      await addMovement("in");
      return {
        status: keys[0].sets[0].status,
        latestMovement: keys[0].sets[0].history[0].id,
        writeStarted: Boolean(window.__resolveWrite),
        logs: window.__returnLogs.length,
        alert: window.__returnAlert,
      };
    });
    assert.equal(staleReturn.status, "out");
    assert.equal(staleReturn.latestMovement, "newer-checkout");
    assert.equal(staleReturn.writeStarted, false);
    assert.equal(staleReturn.logs, 0);
    assert.match(staleReturn.alert, /actualis/);
    const mergedNoOp = await page.evaluate(async () => {
      const olderKey = normalizeKey({ ...keys[0], sets: keys[0].sets.map((set) => ({
        ...set, history: set.history.filter((movement) => movement.id !== "newer-checkout"),
      })) });
      const from = supabaseClient.from;
      let writes = 0;
      try {
        supabaseClient.from = () => ({
          select() { return this; },
          in() { return Promise.resolve({ data: [structuredClone(window.__remoteRow)], error: null }); },
          upsert() { writes += 1; return Promise.resolve({ data: null, error: null }); },
        });
        const confirmed = await writeConfirmedKeySlotsToCloud("cles-transaction-v1", [olderKey.id],
          new Map([[olderKey.id, olderKey]]));
        return { writes, latestMovement: confirmed.get(olderKey.id)?.sets[0].history[0]?.id };
      } finally {
        supabaseClient.from = from;
      }
    });
    assert.deepEqual(mergedNoOp, { writes: 0, latestMovement: "newer-checkout" });
    await page.evaluate(() => {
      window.__resetReservationReturn();
      const set = keys[0].sets[0];
      set.status = "available";
      set.holder = "";
      set.holderReservationId = "";
      set.history = set.history.filter((entry) => entry.type === "reserved");
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      window.__remoteRow.value = structuredClone(keys[0]);
      window.__originalSyncCloudAfterAction = syncCloudAfterAction;
      syncCloudAfterAction = async () => {};
      renderPanel();
    });
    const activeReservationCard = page.locator("#activeReservationPanel li").first();
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.equal(await activeReservationCard.locator(".reservation-edit-button").count(), 1);
    assert.deepEqual(await activeReservationCard.locator(".reservation-history-actions button").allTextContents(), ["Sorti", "Annulation"]);
    await activeReservationCard.locator(".reservation-history-button.out").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.equal(await activeReservationCard.evaluate((item) => getComputedStyle(item).backgroundColor), "rgb(248, 209, 154)");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.out").textContent(), "En cours...");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.out").getAttribute("aria-busy"), "true");
    assert.notEqual(await activeReservationCard.locator(".reservation-history-button.out").evaluate((button) =>
      getComputedStyle(button, "::after").content), "none");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.cancel").isDisabled(), true);
    assert.equal(await activeReservationCard.locator(".reservation-edit-button").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__returnLogs.length), 0);
    await page.evaluate(() => renderPanel());
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.out").textContent(), "En cours...");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.out").getAttribute("aria-busy"), "true");
    await page.evaluate(() => window.__resolveWrite("failure"));
    await page.waitForFunction(() => !isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.out").textContent(), "Sorti");
    assert.equal(await activeReservationCard.locator(".reservation-history-button.cancel").isEnabled(), true);
    assert.equal(await activeReservationCard.locator(".reservation-edit-button").isEnabled(), true);
    assert.match(await page.evaluate(() => window.__returnAlert), /sortie.*confirm/i);
    await activeReservationCard.locator(".reservation-history-button.out").click();
    await page.waitForFunction(() => typeof window.__resolveWrite === "function" && isConfirmingReturn);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    await page.evaluate(() => window.__resolveWrite("success"));
    await page.waitForFunction(() => keys[0].sets[0].status === "out");
    assert.match(await page.evaluate(() => keys[0].sets[0].history[0].movementPhoto), /^data:image\/gif;base64,/);
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "out");
    assert.equal(await activeReservationCard.locator(".reservation-edit-button").count(), 0);
    assert.equal(await activeReservationCard.evaluate((item) => getComputedStyle(item).backgroundColor), "rgb(242, 206, 200)");
    assert.deepEqual(await activeReservationCard.locator(".reservation-history-actions button").allTextContents(), ["Rentré"]);
    assert.equal(await activeReservationCard.locator(".reservation-history-actions").evaluate((actions) =>
      getComputedStyle(actions).gridTemplateColumns.split(" ").length), 1);
    assert.equal(await activeReservationCard.locator(".reservation-history-button.in").evaluate((button) => getComputedStyle(button).backgroundColor),
      await page.locator("#checkinBtn").evaluate((button) => getComputedStyle(button).backgroundColor));
    await page.evaluate(() => {
      const storageKey = getRegistryConfig().keysStorageKey;
      const cloudKey = getKeySlotCloudKey(storageKey, selectedId);
      clearTimeout(directCloudFlushTimers.get(storageKey));
      directCloudFlushTimers.delete(storageKey);
      discardPendingKeySlotWrite(cloudKey);
      clearDirtyKeySlot(storageKey, selectedId);
      window.__remoteRow.value = structuredClone(keys[0]);
      const candidate = getUndoCheckout(undoSnapshot);
      if (!candidate?.isLastAction) throw new Error(JSON.stringify({ candidate: Boolean(candidate),
        beforeStatus: candidate?.previousSet?.status, afterStatus: candidate?.set?.status,
        beforeHistory: candidate?.previousSet?.history?.map((entry) => entry.id),
        afterHistory: candidate?.set?.history?.map((entry) => entry.id),
        snapshotKey: undoSnapshot?.selectedId, snapshotSet: undoSnapshot?.selectedSetId }));
      window.__resolveWrite = null;
      window.__undoPromise = undoPreviousStep();
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "out");
    assert.equal(await page.locator("#undoBtn").getAttribute("aria-busy"), "true");
    assert.equal(await page.locator("#undoBtn").evaluate((button) => getComputedStyle(button, "::after").content), '""');
    await page.evaluate(async () => {
      window.__resolveWrite("failure");
      await window.__undoPromise;
    });
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "out");
    assert.equal(await page.locator("#undoBtn").isEnabled(), true);
    await page.evaluate(() => {
      window.__resolveWrite = null;
      window.__undoPromise = undoPreviousStep();
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    await page.evaluate(async () => {
      window.__resolveWrite("success");
      await window.__undoPromise;
    });
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    assert.equal(await page.evaluate(() => window.__remoteRow.value.sets[0].status), "available");
    assert.equal(await page.evaluate(() => keys[0].sets[0].reservations.length), 1);
    assert.equal(await page.evaluate(() => keys[0].sets[0].history[0].returnReason), "undo-checkout");
    assert.equal(await page.evaluate(() => keys[0].sets[0].history[1].type), "out");
    assert.equal(await page.evaluate(() => getMovementActionLabel(keys[0].sets[0].history[0])), "Sortie annulée");
    assert.equal(await page.evaluate(() => {
      const staleKey = structuredClone(keys[0]);
      staleKey.sets[0] = { ...staleKey.sets[0], status: "out", holder: "Raquel PEROZO",
        holderReservationId: "reservation-1", history: staleKey.sets[0].history.slice(1) };
      return mergeKeyRecord(keys[0], staleKey).sets[0].status;
    }), "available");
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.equal(await activeReservationCard.locator(".reservation-edit-button").count(), 1);
    assert.equal(await page.locator("#undoBtn").isEnabled(), false);
    await page.evaluate(() => {
      window.__resetReservationReturn();
      const set = keys[0].sets[0];
      set.status = "available";
      set.holder = "";
      set.holderReservationId = "";
      set.history = set.history.filter((entry) => entry.type === "reserved");
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      window.__resolveWrite = null;
      renderPanel();
    });
    await activeReservationCard.locator(".reservation-history-button.out").click();
    await page.waitForFunction(() => !isConfirmingReturn && Boolean(window.__returnAlert));
    assert.equal(await page.evaluate(() => Boolean(window.__resolveWrite)), false);
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "out");
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "out");
    assert.match(await page.evaluate(() => window.__returnAlert), /actualis/);
    await page.evaluate(() => {
      window.__resetReturn();
      const set = keys[0].sets[0];
      set.status = "available";
      set.holder = "";
      set.holderPhone = "";
      set.history = [];
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      updateSelectedSet({ status: "out", holder: "Raquel PEROZO", holderPhone: "0700000000",
        history: [{ id: "plain-checkout", type: "out", person: "Raquel PEROZO", date: "07/10/2026 18:00" }] });
      const storageKey = getRegistryConfig().keysStorageKey;
      clearTimeout(directCloudFlushTimers.get(storageKey));
      directCloudFlushTimers.delete(storageKey);
      discardPendingKeySlotWrite(getKeySlotCloudKey(storageKey, selectedId));
      clearDirtyKeySlot(storageKey, selectedId);
      window.__remoteRow.value = structuredClone(keys[0]);
      if (!getUndoCheckout(undoSnapshot)?.isLastAction) throw new Error("Ordinary checkout undo was not detected");
      closeKeyPanelAfterAction();
      activeRegistry = "location";
      keys = loadKeys();
      render();
      window.__resolveWrite = null;
      window.__undoPromise = undoPreviousStep();
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    await page.evaluate(async () => {
      window.__resolveWrite("success");
      await window.__undoPromise;
    });
    assert.equal(await page.evaluate(() => getSelectedKey().sets[0].status), "available");
    assert.equal(await page.evaluate(() => getSelectedKey().sets[0].reservations.length), 0);
    assert.equal(await page.evaluate(() => getSelectedKey().sets[0].history[0].undoOfMovementId), "plain-checkout");
    assert.equal(await page.evaluate(() => selectedId), "Maison-4");
    assert.equal(await page.evaluate(() => activeRegistry), "transaction");
    assert.equal(await page.evaluate(() => window.__remoteRow.value.sets[0].status), "available");
    const staleUndo = await page.evaluate(async () => {
      keys = [getSelectedKey()];
      const storageKey = getRegistryConfig().keysStorageKey;
      updateSelectedSet({ status: "out", holder: "Raquel PEROZO", holderPhone: "0700000000",
        history: [{ id: "latest-local-checkout", type: "out", person: "Raquel PEROZO", date: "07/10/2026 19:00" },
          ...keys[0].sets[0].history] });
      clearTimeout(directCloudFlushTimers.get(storageKey));
      directCloudFlushTimers.delete(storageKey);
      discardPendingKeySlotWrite(getKeySlotCloudKey(storageKey, selectedId));
      clearDirtyKeySlot(storageKey, selectedId);
      window.__remoteRow.value = structuredClone(keys[0]);
      window.__remoteRow.value.sets[0].history.unshift({ id: "other-device-checkout", type: "out",
        person: "Autre intervenant", date: "07/10/2026 19:05" });
      window.__returnAlert = "";
      window.__resolveWrite = null;
      await undoPreviousStep();
      return { latest: keys[0].sets[0].history[0].id, undoAvailable: Boolean(undoSnapshot),
        writeStarted: Boolean(window.__resolveWrite), alert: window.__returnAlert };
    });
    assert.deepEqual(staleUndo, { latest: "other-device-checkout", undoAvailable: false, writeStarted: false,
      alert: "La fiche a changé sur un autre appareil. Elle vient d'être actualisée : vérifiez-la avant de réessayer." });
    const alreadyReturnedUndo = await page.evaluate(async () => {
      const set = keys[0].sets[0];
      set.status = "available";
      set.holder = "";
      set.holderPhone = "";
      set.history = [];
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      updateSelectedSet({ status: "out", holder: "Raquel PEROZO", holderPhone: "0700000000",
        history: [{ id: "checkout-before-remote-return", type: "out", date: "07/10/2026 20:00" }] });
      keys[0].sets[0].status = "available";
      keys[0].sets[0].holder = "";
      keys[0].sets[0].holderPhone = "";
      keys[0].sets[0].history.unshift({ id: "remote-return", type: "in", date: "07/10/2026 20:05" });
      setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
      window.__returnAlert = "";
      await undoPreviousStep();
      return { status: keys[0].sets[0].status, latest: keys[0].sets[0].history[0].id,
        undoAvailable: Boolean(undoSnapshot), alert: window.__returnAlert };
    });
    assert.deepEqual(alreadyReturnedUndo, { status: "available", latest: "remote-return", undoAvailable: false,
      alert: "La fiche a changé depuis cette sortie. Actualisez le tableau avant de faire un nouveau mouvement." });
    await page.evaluate(() => {
      syncCloudAfterAction = window.__originalSyncCloudAfterAction;
      window.__resetReturn();
      keys[0].sets.push({ ...makeKeySet("second"), label: "Jeu 2", status: "out", holder: "Ana BERNARD",
        holderReservationId: "reservation-2", reservations: [{ id: "reservation-2", person: "Ana BERNARD",
          reservationDate: "09/10/2026 12:00", returnsToAgency: true }], history: [
          { id: "checkout-reservation-2", type: "out", reservationId: "reservation-2", date: "08/10/2026 12:00" },
          { id: "reserved-2", type: "reserved", reservationId: "reservation-2", person: "Ana BERNARD",
            reservationDate: "09/10/2026 12:00", date: "07/10/2026 12:00" },
        ] });
      selectedSetId = "main";
      renderPanel();
    });
    const otherSetCard = page.locator("#activeReservationPanel li").first();
    assert.equal(await otherSetCard.getAttribute("data-history-action"), "out");
    assert.equal(await otherSetCard.locator(".reservation-edit-button").count(), 0);
    assert.deepEqual(await otherSetCard.locator(".reservation-history-actions button").allTextContents(), ["Rentré"]);
    for (const mode of ["success", "failure"]) {
      await page.evaluate(() => {
        window.__resetReservationReturn();
        window.__resolveWrite = null;
        const button = activeReservationPanel.querySelector(".reservation-history-button.in");
        if (!button) throw new Error("Reservation return button missing");
        window.__returnPromise = toggleReservationMovement("reservation-1", button);
      });
      assert.equal(await page.locator("#activeCheckoutPanel").isVisible(), false);
      assert.equal(await page.locator("#checkinBtn").isVisible(), false);
      assert.deepEqual(await page.locator("#activeReservationPanel li").first().evaluate(cardSpacing), checkoutSpacing);
      await page.waitForFunction(() => typeof window.__resolveWrite === "function");
      await page.evaluate(() => renderPanel());
      const pending = await page.evaluate(() => ({
        status: keys[0].sets[0].status,
        label: activeReservationPanel.querySelector(".reservation-history-button.in")?.textContent,
        busy: isConfirmingReturn,
      }));
      assert.deepEqual(pending, { status: "out", label: "En cours...", busy: true });
      await page.evaluate(async (result) => {
        window.__resolveWrite(result);
        await window.__returnPromise;
      }, mode);
      const finished = await page.evaluate(() => ({
        local: keys[0].sets[0].status,
        remote: window.__remoteRow.value.sets[0].status,
        reservations: keys[0].sets[0].reservations.length,
        logs: window.__returnLogs.length,
        busy: isConfirmingReturn,
        staleButton: checkinBtn.classList.contains("is-confirming-return"),
      }));
      assert.equal(finished.local, mode === "failure" ? "out" : "available");
      assert.equal(finished.remote, mode === "failure" ? "out" : "available");
      assert.equal(finished.reservations, mode === "failure" ? 1 : 0);
      assert.equal(finished.logs, mode === "failure" ? 0 : 1);
      assert.equal(finished.busy, false);
      assert.equal(finished.staleButton, false);
      assert.equal(await page.locator("#activeReservationPanel").isVisible(), mode === "failure");
    }
    await page.evaluate(() => {
      window.__resetReturn("location");
      window.__resolveWrite = null;
      window.__returnPromise = addMovement("in");
    });
    await page.waitForFunction(() => typeof window.__resolveWrite === "function");
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "out");
    await page.evaluate(async () => {
      window.__resolveWrite("success");
      await window.__returnPromise;
    });
    assert.equal(await page.evaluate(() => keys[0].sets[0].status), "available");
    for (const buttonId of ["checkinBtn", "reservedBtn", "checkoutBtn", "rentedBtn", "removedBtn"]) {
      await page.evaluate((id) => {
        window.__resetReturn();
        const button = document.getElementById(id);
        if (!beginKeyControlAction(button)) throw new Error(`Cannot begin ${id}`);
        waitForIndexedStorageWrite = async () => true;
        syncCloudAfterAction = () => new Promise((resolve) => {
          window.__releaseControlAction = () => {
            const storageKey = getRegistryConfig().keysStorageKey;
            dirtyKeySlots.delete(storageKey);
            pendingKeySlotWrites.delete(getKeySlotCloudKey(storageKey, selectedId));
            dirtyCloudKeys.delete(storageKey);
            resolve(true);
          };
        });
        window.__controlActionPromise = finishKeyControlAction(selectedId, { waitForConfirmation: true });
      }, buttonId);
      await page.waitForFunction(() => typeof window.__releaseControlAction === "function");
      const waiting = await page.evaluate((id) => ({
        label: document.getElementById(id).textContent,
        busy: document.getElementById(id).getAttribute("aria-busy"),
        spinner: getComputedStyle(document.getElementById(id), "::after").content,
        disabled: [checkinBtn, reservedBtn, checkoutBtn, rentedBtn, removedBtn].every((button) => button.disabled),
        panelOpen: Boolean(selectedId),
      }), buttonId);
      assert.equal(waiting.label, "En cours...");
      assert.equal(waiting.busy, "true");
      assert.notEqual(waiting.spinner, "none");
      assert.equal(waiting.disabled, true);
      assert.equal(waiting.panelOpen, true);
      await page.evaluate(async () => {
        window.__releaseControlAction();
        await window.__controlActionPromise;
        window.__releaseControlAction = null;
      });
      assert.equal(await page.evaluate(() => selectedId), null, `${buttonId} closes after confirmation`);
    }
    const delayedConfirmation = await page.evaluate(async () => {
      window.__resetReturn();
      hasPendingCloudRowChange = (cloudKey) =>
        Boolean(dirtyKeySlots.get(getKeyStorageKeyFromSlotCloudKey(cloudKey))?.has(getKeyIdFromSlotCloudKey(cloudKey)));
      beginKeyControlAction(checkoutBtn);
      syncCloudAfterAction = async () => false;
      const confirmed = await finishKeyControlAction(selectedId, { waitForConfirmation: true });
      const waiting = { confirmed, label: checkoutBtn.textContent, panelOpen: Boolean(selectedId),
        busy: checkoutBtn.getAttribute("aria-busy") };
      const storageKey = getRegistryConfig().keysStorageKey;
      dirtyKeySlots.delete(storageKey);
      pendingKeySlotWrites.delete(getKeySlotCloudKey(storageKey, selectedId));
      watchPendingKeyControlAction(activeKeyControlAction);
      return { waiting, closedAfterSync: selectedId === null };
    });
    assert.deepEqual(delayedConfirmation, {
      waiting: { confirmed: false, label: "En attente", panelOpen: true, busy: "false" },
      closedAfterSync: true,
    });
    console.log("Confirmed movements, grouped reservations, and movement photos passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
