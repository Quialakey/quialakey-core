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
      window.__remoteRow.value = structuredClone(keys[0]);
      window.__originalSyncCloudAfterAction = syncCloudAfterAction;
      syncCloudAfterAction = async () => {};
      renderPanel();
    });
    const activeReservationCard = page.locator("#activeReservationPanel li").first();
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "reserved");
    assert.deepEqual(await activeReservationCard.locator(".reservation-history-actions button").allTextContents(), ["Sorti", "Annulation"]);
    await activeReservationCard.locator(".reservation-history-button.out").click();
    await page.waitForFunction(() => keys[0].sets[0].status === "out");
    assert.equal(await activeReservationCard.getAttribute("data-history-action"), "out");
    assert.equal(await activeReservationCard.evaluate((item) => getComputedStyle(item).backgroundColor), "rgb(242, 206, 200)");
    assert.deepEqual(await activeReservationCard.locator(".reservation-history-actions button").allTextContents(), ["Rentré"]);
    assert.equal(await activeReservationCard.locator(".reservation-history-actions").evaluate((actions) =>
      getComputedStyle(actions).gridTemplateColumns.split(" ").length), 1);
    assert.equal(await activeReservationCard.locator(".reservation-history-button.in").evaluate((button) => getComputedStyle(button).backgroundColor),
      await page.locator("#checkinBtn").evaluate((button) => getComputedStyle(button).backgroundColor));
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
      assert.equal(await page.locator("#checkinBtn").isVisible(), true);
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
    console.log("Confirmed return and five control-button loading states passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
