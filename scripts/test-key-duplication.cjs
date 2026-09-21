const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

function emptyKey(category, number) {
  return {
    id: `${category}-${number}`,
    category,
    number,
    property: "",
    postalCode: "",
    city: "",
    owner: "",
    ownerFirstName: "",
    notes: "",
    photo: "",
    archived: false,
    sets: [{ id: "main", label: "Jeu 1", status: "available", history: [], reservations: [] }],
  };
}

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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await page.route("**/*supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof duplicateSelectedKeyInCurrentRegistry === "function");

    const result = await page.evaluate(async (emptyTemplate) => {
      const copy = (value) => JSON.parse(JSON.stringify(value));
      const makeEmpty = (category, number) => ({ ...copy(emptyTemplate), id: `${category}-${number}`, category, number });
      const source = makeEmpty("T2", 4);
      Object.assign(source, {
        owner: "ASTIER",
        property: "11 All. Maurice Sarraut",
        photo: "photo-fiche",
        sets: [{
          id: "main", label: "Jeu 1", photo: "photo-jeu", status: "reserved",
          history: [{ id: "history-1", type: "reserved", person: "Yves ASTIER" }],
          reservations: [{ id: "reservation-1", person: "Yves ASTIER" }],
        }],
      });
      const base = [makeEmpty("T1", 4), makeEmpty("T2", 1), makeEmpty("T2", 3), source, makeEmpty("T2", 5), makeEmpty("T2", 6)];
      base[5].owner = "OCCUPE";
      const alerts = [];
      const activities = [];
      let allow = true;
      captureActiveKeyInfoDraft = () => {};
      endKeyWorkProtection = () => {};
      loadStorageFromCloud = async () => {};
      syncCloudAfterAction = async () => true;
      rememberUndoStep = () => {};
      rememberForcedKeySlot = () => {};
      markDirtyKeySlot = () => {};
      forgetFilledClearedKeySlots = () => {};
      resetKeyInfoEditUnlock = () => {};
      clearSignature = () => {};
      saveKeys = () => {};
      render = () => {};
      confirm = () => allow;
      alert = (message) => alerts.push(message);
      logActivity = (...args) => activities.push(args);
      activeRegistry = "transaction";
      selectedArchiveRecord = null;
      selectedSetId = "main";

      keys = copy(base);
      selectedId = "T2-4";
      await duplicateSelectedKeyInCurrentRegistry();
      const first = {
        selectedId,
        source: copy(keys.find((key) => key.id === "T2-4")),
        target: copy(keys.find((key) => key.id === "T2-5")),
        previous: copy(keys.find((key) => key.id === "T2-3")),
      };

      keys = copy(base);
      keys.find((key) => key.id === "T2-5").owner = "OCCUPE AUSSI";
      selectedId = "T2-4";
      await duplicateSelectedKeyInCurrentRegistry();
      const previousWhenNextOccupied = copy(keys.find((key) => key.id === "T2-3"));

      keys = copy(base).map((key) => key.category === "T2" && key.id !== "T2-4" ? { ...key, owner: "OCCUPE" } : key);
      selectedId = "T2-4";
      await duplicateSelectedKeyInCurrentRegistry();
      const noSlotSelectedId = selectedId;

      keys = copy(base);
      selectedId = "T2-4";
      allow = false;
      await duplicateSelectedKeyInCurrentRegistry();
      const cancelledTarget = copy(keys.find((key) => key.id === "T2-5"));

      activeRegistry = "transaction";
      updateRegistryHeader();
      const transactionLabel = duplicateKeyBtn.textContent;
      activeRegistry = "location";
      updateRegistryHeader();
      const locationLabel = duplicateKeyBtn.textContent;
      const duplicateStyle = getComputedStyle(duplicateKeyBtn);
      const transferStyle = getComputedStyle(transferKeyBtn);
      return {
        first,
        previousWhenNextOccupied,
        noSlotSelectedId,
        cancelledTarget,
        alerts,
        activities,
        transactionLabel,
        locationLabel,
        buttonOrder: duplicateKeyBtn.compareDocumentPosition(transferKeyBtn),
        matchingStyle: ["backgroundColor", "borderColor", "color", "minHeight", "width"]
          .every((property) => duplicateStyle[property] === transferStyle[property]),
      };
    }, emptyKey("T2", 0));

    assert.equal(result.first.selectedId, "T2-5");
    assert.equal(result.first.source.owner, "ASTIER");
    assert.equal(result.first.target.owner, "ASTIER");
    assert.deepEqual(result.first.target.sets, result.first.source.sets);
    assert.equal(result.first.previous.owner, "");
    assert.equal(result.previousWhenNextOccupied.owner, "ASTIER");
    assert.equal(result.noSlotSelectedId, "T2-4");
    assert.equal(result.cancelledTarget.owner, "");
    assert.ok(result.alerts.some((message) => message.includes("Aucune case libre dans la catégorie T2")));
    assert.equal(result.transactionLabel, "Dupliquer dans TRANSACTION");
    assert.equal(result.locationLabel, "Dupliquer dans LOCATION");
    assert.ok(result.buttonOrder & 4, "The duplicate button must precede the transfer button.");
    assert.equal(result.matchingStyle, true);
    assert.equal(result.activities.filter((entry) => entry[0] === "Duplication").length, 2);
    console.log("Key duplication: same-category proximity, confirmation, content and button presentation passed.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
