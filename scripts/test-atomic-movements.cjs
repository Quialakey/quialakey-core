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
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const contentType = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": contentType || "application/octet-stream" });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.route("**/*supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof commitSelectedSetMovement === "function");

    const results = await page.evaluate(async () => {
      const copy = (value) => JSON.parse(JSON.stringify(value));
      const results = [];
      const alerts = [];
      alert = (value) => alerts.push(value);
      render = () => {};
      hasCompletedInitialCloudLoad = true;
      isCloudSleeping = false;
      hasPendingStorageKeyChange = () => false;
      selectedArchiveRecord = null;
      selectedSetId = "main";

      for (const registry of ["transaction", "location"]) {
        activeRegistry = registry;
        const key = normalizeKey({ ...makeEmptyKey({ id: "T3-9", category: "T3", number: 9 }), owner: "TEST", property: "1 rue" });
        keys = [key];
        selectedId = key.id;
        const storageKey = getRegistryConfig().keysStorageKey;
        const slotKey = getKeySlotCloudKey(storageKey, key.id);
        let remote = { key: slotKey, value: copy(key), updated_at: "2026-10-01T19:00:00.000Z" };
        let failWrite = false;
        supabaseClient.from = function () {
            return {
              select() { return this; },
              eq() { return this; },
              async maybeSingle() { return { data: copy(remote), error: null }; },
              update(payload) {
                return {
                  eq() { return this; },
                  select() { return this; },
                  async single() {
                    if (failWrite) return { data: null, error: { message: "network" } };
                    if (payload.expected_updated_at !== remote.updated_at) return { data: null, error: { message: "stale" } };
                    remote = { key: slotKey, value: copy(payload.value), updated_at: payload.updated_at };
                    return { data: copy(remote), error: null };
                  },
                };
              },
            };
        };
        const initialActivityCount = loadActivityLog().length;
        const sourceSet = key.sets[0];
        const entry = { id: `history-${registry}`, type: "out", person: "Agent", date: "01/10/2026 21:00", device: "Test" };
        const committed = await commitSelectedSetMovement(key, sourceSet, {
          status: "out", holder: "Agent", history: [entry, ...sourceSet.history],
        }, entry);
        results.push({ registry, case: "confirmed", committed, remoteStatus: remote.value.sets[0].status,
          localStatus: keys[0].sets[0].status, historyCount: remote.value.sets[0].history.length,
          activityCount: loadActivityLog().length - initialActivityCount });

        const staleSource = copy(key);
        const staleEntry = { ...entry, id: `history-stale-${registry}` };
        const stale = await commitSelectedSetMovement(staleSource, staleSource.sets[0], {
          status: "available", history: [staleEntry, ...staleSource.sets[0].history],
        }, staleEntry);
        results.push({ registry, case: "stale", committed: stale, remoteStatus: remote.value.sets[0].status,
          historyCount: remote.value.sets[0].history.length });

        const current = copy(keys[0]);
        const currentSet = current.sets[0];
        const failedEntry = { ...entry, id: `history-failed-${registry}`, type: "in" };
        failWrite = true;
        const failed = await commitSelectedSetMovement(current, currentSet, {
          status: "available", holder: "", history: [failedEntry, ...currentSet.history],
        }, failedEntry);
        results.push({ registry, case: "network", committed: failed, remoteStatus: remote.value.sets[0].status,
          localStatus: keys[0].sets[0].status, historyCount: remote.value.sets[0].history.length });
      }
      activeRegistry = "transaction";
      const archivedKey = normalizeKey({
        ...makeEmptyKey({ id: "T3-9", category: "T3", number: 9 }), owner: "ARCHIVE", property: "2 rue",
      });
      const archive = { id: "archive-test", reason: "rented", archivedAt: "2026-10-01T19:00:00.000Z", key: archivedKey };
      archives = [archive];
      selectedArchiveRecord = archive;
      selectedId = archivedKey.id;
      keys = [makeEmptyKey(archivedKey)];
      const archiveStorageKey = getRegistryConfig().archivesStorageKey;
      let remoteArchive = { key: archiveStorageKey, value: [copy(archive)], updated_at: "2026-10-01T19:00:00.000Z" };
      supabaseClient.from = function () {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: copy(remoteArchive), error: null }; },
          update(payload) {
            return {
              eq() { return this; },
              select() { return this; },
              async single() {
                if (payload.expected_updated_at !== remoteArchive.updated_at) return { data: null, error: { message: "stale" } };
                remoteArchive = { key: archiveStorageKey, value: copy(payload.value), updated_at: payload.updated_at };
                return { data: copy(remoteArchive), error: null };
              },
            };
          },
        };
      };
      renderCompromisesPanel = () => {};
      const archiveEntry = { id: "history-archive-test", type: "out", person: "Agent", date: "01/10/2026 21:00" };
      const archivedCommitted = await commitSelectedSetMovement(getSelectedKey(), archivedKey.sets[0], {
        status: "out", holder: "Agent", history: [archiveEntry],
      }, archiveEntry);
      results.push({ registry: "transaction", case: "archive", committed: archivedCommitted,
        remoteStatus: remoteArchive.value[0].key.sets[0].status,
        localStatus: selectedArchiveRecord.key.sets[0].status,
        historyCount: remoteArchive.value[0].key.sets[0].history.length,
        globalHistoryCount: getRegistryHistoryEntries("transaction").filter((item) => item.movementId === archiveEntry.id).length });
      return { results, alerts };
    });

    for (const registry of ["transaction", "location"]) {
      assert.deepEqual(results.results.filter((result) => result.registry === registry && result.case !== "archive"), [
        { registry, case: "confirmed", committed: true, remoteStatus: "out", localStatus: "out", historyCount: 1, activityCount: 0 },
        { registry, case: "stale", committed: false, remoteStatus: "out", historyCount: 1 },
        { registry, case: "network", committed: false, remoteStatus: "out", localStatus: "out", historyCount: 1 },
      ]);
    }
    assert.deepEqual(results.results.find((result) => result.case === "archive"),
      { registry: "transaction", case: "archive", committed: true, remoteStatus: "out", localStatus: "out", historyCount: 1, globalHistoryCount: 1 });
    assert.equal(results.alerts.length, 4);
    console.log("Atomic movement checks passed for Transaction and Location.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
