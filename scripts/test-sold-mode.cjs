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
    await page.route("**/*supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof renderCompromisesPanel === "function");

    const result = await page.evaluate(() => {
      const defaults = normalizeTableSettings({}).keepKeysAfterCompromise;
      const key = (id, owner) => normalizeKey({ ...makeEmptyKey({ id, category: "T2", number: Number(id.split("-")[1]) }), owner });
      activeRegistry = "transaction";
      archives = [
        { id: "compromise", reason: "rented", archivedAt: "2026-10-10T10:00:00Z", compromiseSignedAt: "2026-10-10", key: key("T2-1", "ANCIEN COMPROMIS") },
        { id: "sale", reason: "sold", archivedAt: "2026-10-12T10:00:00Z", key: key("T2-2", "VENDU") },
        { id: "authenticated", reason: "authenticated", archivedAt: "2026-10-11T10:00:00Z", key: key("T2-3", "ACTE") },
        { id: "removed", reason: "removed", archivedAt: "2026-10-09T10:00:00Z", key: key("T2-4", "ARCHIVE") },
      ];
      const snapshot = () => ({
        action: rentedBtn.textContent,
        tab: compromisesTabLabel.textContent,
        tabOwners: [...compromisesList.querySelectorAll("strong")].map((node) => node.textContent),
        legacyVisible: !legacyCompromiseArchiveSection.hidden,
        legacyOwner: legacyCompromiseList.textContent.includes("ANCIEN COMPROMIS"),
        soldArchiveVisible: !soldArchiveSection.hidden,
        soldArchiveOwner: soldArchiveList.textContent.includes("VENDU"),
        authenticatedArchiveVisible: !authenticatedArchiveSection.hidden,
        removedVisible: !removedArchiveSection.hidden,
      });
      tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: false });
      updateRegistryHeader(); renderArchivesPanel(); renderCompromisesPanel();
      const no = snapshot();
      settingsDraft = cloneTableSettings();
      renderSettingsPanel();
      const defaultChoiceIsNo = settingsKeepKeysNo.checked && !settingsKeepKeysYes.checked;
      settingsKeepKeysYes.checked = true;
      updateSettingsDraftFromDom();
      tableSettings = normalizeTableSettings(settingsDraft);
      updateRegistryHeader(); renderArchivesPanel(); renderCompromisesPanel();
      const yes = snapshot();
      archiveSearchInput.value = "AUCUN RESULTAT";
      renderArchivesPanel(); renderCompromisesPanel();
      const unaffectedByArchiveSearch = compromisesList.querySelectorAll("li").length === 2;
      soldSearchInput.value = "ACTE";
      renderCompromisesPanel();
      const soldSearchWorks = compromisesList.querySelectorAll("li").length === 1 && compromisesList.textContent.includes("ACTE");
      activeRegistry = "location";
      updateRegistryHeader(); renderArchivesPanel();
      const location = { action: rentedBtn.textContent, soldArchiveVisible: !soldArchiveSection.hidden };
      return { defaults, defaultChoiceIsNo, no, yes, unaffectedByArchiveSearch, soldSearchWorks, location };
    });

    assert.equal(result.defaults, false);
    assert.equal(result.defaultChoiceIsNo, true);
    assert.equal(result.no.action, "Compromis");
    assert.equal(result.no.tab, "Compromis");
    assert.equal(result.no.tabOwners.length, 1);
    assert.match(result.no.tabOwners[0], /ANCIEN COMPROMIS/);
    assert.equal(result.no.soldArchiveVisible, true);
    assert.equal(result.no.soldArchiveOwner, true);
    assert.equal(result.no.authenticatedArchiveVisible, true);
    assert.equal(result.yes.action, "Vendu");
    assert.equal(result.yes.tab, "Vendus");
    assert.equal(result.yes.tabOwners.length, 2);
    assert.match(result.yes.tabOwners[0], /VENDU/);
    assert.match(result.yes.tabOwners[1], /ACTE/);
    assert.equal(result.yes.legacyVisible, true);
    assert.equal(result.yes.legacyOwner, true);
    assert.equal(result.yes.authenticatedArchiveVisible, false);
    assert.equal(result.yes.removedVisible, true);
    assert.equal(result.unaffectedByArchiveSearch, true);
    assert.equal(result.soldSearchWorks, true);
    assert.equal(result.location.action, "Loué");
    assert.equal(result.location.soldArchiveVisible, false);
    const persistence = await page.evaluate(() => {
      activeRegistry = "transaction";
      tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: false });
      settingsDraft = cloneTableSettings();
      renderSettingsPanel();
      settingsKeepKeysYes.checked = true;
      updateSettingsDraftFromDom();
      const saved = saveTableSettings(settingsDraft);
      updateRegistryHeader();
      return {
        saved,
        stored: JSON.parse(getRuntimeStorageValue(tableSettingsStorageKey)).keepKeysAfterCompromise,
        action: rentedBtn.textContent,
      };
    });
    assert.equal(persistence.saved, true);
    assert.equal(persistence.stored, true);
    assert.equal(persistence.action, "Vendu");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => {
      settingsPanel.hidden = false;
      renderSettingsPanel();
      const options = document.querySelector(".settings-sale-mode-options");
      const optionBounds = [...options.querySelectorAll("label")].map((label) => label.getBoundingClientRect());
      const inputBounds = settingsKeepKeysYes.getBoundingClientRect();
      return {
        separateColumns: optionBounds[0].right < optionBounds[1].left,
        withinPanel: optionBounds[1].right <= settingsPanel.getBoundingClientRect().right,
        radioWidth: inputBounds.width,
        radioHeight: inputBounds.height,
      };
    });
    assert.equal(mobileLayout.separateColumns, true);
    assert.equal(mobileLayout.withinPanel, true);
    assert.equal(mobileLayout.radioWidth, 16);
    assert.equal(mobileLayout.radioHeight, 16);
    console.log("Sold mode, legacy compromises, and location isolation passed.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
