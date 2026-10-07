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
    for (const mode of ["success", "failure"]) {
      await page.evaluate(() => {
        window.__resetReservationReturn();
        window.__resolveWrite = null;
        const button = activeReservationPanel.querySelector(".reservation-history-button.in");
        if (!button) throw new Error("Reservation return button missing");
        window.__returnPromise = toggleReservationMovement("reservation-1", button);
      });
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
    console.log("Confirmed return: standard and reservation paths, delayed success, failure and uncertain response passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
