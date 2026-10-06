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

    for (const registry of ["transaction", "location"]) {
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

      await page.evaluate(async () => {
        discardPendingNewKeyDraft();
        selectedId = null;
        await waitForIndexedStorageWrite(newKeyDraftStorageKey);
      });
      await page.reload();
      await page.waitForFunction(() => typeof pendingNewKeyDraft !== "undefined" && indexedStorageHydrated);
      assert.equal(await page.evaluate(() => pendingNewKeyDraft), null);
    }
    console.log("Photo draft recovery passed for both registries");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
