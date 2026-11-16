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
        tabVisible: !compromisesTabBtn.hidden,
        tabPanelVisible: !compromisesPanel.hidden,
        tabOwners: [...compromisesList.querySelectorAll("strong")].map((node) => node.textContent),
        legacyVisible: !legacyCompromiseArchiveSection.hidden,
        legacyOwner: legacyCompromiseList.textContent.includes("ANCIEN COMPROMIS"),
        authenticatedArchiveVisible: !authenticatedArchiveSection.hidden,
        authenticatedOwners: [...authenticatedList.querySelectorAll("strong")].map((node) => node.textContent),
        soldTabRemoved: !document.querySelector("#soldArchiveSection") && !document.querySelector("#soldSearchInput"),
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
      compromisesPanel.hidden = false;
      updateRegistryHeader(); renderArchivesPanel(); renderCompromisesPanel();
      const yes = snapshot();
      archiveSearchInput.value = "VENDU";
      renderArchivesPanel();
      const soldSearchWorks = authenticatedList.querySelectorAll("li").length === 1 && authenticatedList.textContent.includes("VENDU");
      archiveSearchInput.value = "";
      tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: false });
      updateRegistryHeader(); renderArchivesPanel(); renderCompromisesPanel();
      const backToNo = snapshot();
      activeRegistry = "location";
      updateRegistryHeader(); renderArchivesPanel();
      const location = { action: rentedBtn.textContent, authenticatedVisible: !authenticatedArchiveSection.hidden };
      return { defaults, defaultChoiceIsNo, no, yes, soldSearchWorks, backToNo, location };
    });

    assert.equal(result.defaults, false);
    assert.equal(result.defaultChoiceIsNo, true);
    assert.equal(result.no.action, "Compromis");
    assert.equal(result.no.tab, "Compromis");
    assert.equal(result.no.tabVisible, true);
    assert.equal(result.no.tabOwners.length, 1);
    assert.match(result.no.tabOwners[0], /ANCIEN COMPROMIS/);
    assert.equal(result.no.authenticatedArchiveVisible, true);
    assert.equal(result.no.authenticatedOwners.length, 2);
    assert.match(result.no.authenticatedOwners[0], /VENDU/);
    assert.match(result.no.authenticatedOwners[1], /ACTE/);
    assert.equal(result.yes.action, "Vendu");
    assert.equal(result.yes.tabVisible, false);
    assert.equal(result.yes.tabPanelVisible, false);
    assert.equal(result.yes.soldTabRemoved, true);
    assert.equal(result.yes.authenticatedArchiveVisible, true);
    assert.equal(result.yes.authenticatedOwners.length, 2);
    assert.match(result.yes.authenticatedOwners[0], /VENDU/);
    assert.match(result.yes.authenticatedOwners[1], /ACTE/);
    assert.equal(result.yes.legacyVisible, true);
    assert.equal(result.yes.legacyOwner, true);
    assert.equal(result.yes.removedVisible, true);
    assert.equal(result.soldSearchWorks, true);
    assert.equal(result.backToNo.tabVisible, true);
    assert.equal(result.backToNo.authenticatedOwners.length, 2);
    assert.equal(result.location.action, "Loué");
    assert.equal(result.location.authenticatedVisible, false);
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
        compromiseTabHidden: compromisesTabBtn.hidden,
      };
    });
    assert.equal(persistence.saved, true);
    assert.equal(persistence.stored, true);
    assert.equal(persistence.action, "Vendu");
    assert.equal(persistence.compromiseTabHidden, true);
    for (const width of [390, 700, 900]) {
      await page.setViewportSize({ width, height: 844 });
      const tabWidths = await page.evaluate(() => {
        const measure = () => ({
          actions: topActions.getBoundingClientRect().width,
          archive: archivesTabBtn.getBoundingClientRect().width,
          singleTab: topActions.classList.contains("has-single-tab"),
        });
        activeRegistry = "location";
        updateRegistryHeader();
        const location = measure();
        activeRegistry = "transaction";
        tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: true });
        updateRegistryHeader();
        const sold = measure();
        tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: false });
        updateRegistryHeader();
        const normal = measure();
        return { location, sold, normal };
      });
      assert.equal(tabWidths.location.singleTab, true, `${width}px location`);
      assert.equal(tabWidths.sold.singleTab, true, `${width}px vendu`);
      assert.equal(tabWidths.normal.singleTab, false, `${width}px compromis`);
      assert.ok(Math.abs(tabWidths.sold.archive - tabWidths.sold.actions) < 2, `${width}px vendu`);
      assert.ok(Math.abs(tabWidths.location.archive - tabWidths.location.actions) < 2, `${width}px location`);
    }
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        settingsPanel.hidden = false;
        renderSettingsPanel();
        const section = document.querySelector(".settings-sale-mode-section");
        const optionsBounds = section.querySelector(".settings-sale-mode-options").getBoundingClientRect();
        const questionBounds = section.querySelector("legend").getBoundingClientRect();
        const labels = [...section.querySelectorAll(".settings-sale-mode-options label")];
        const bounds = labels.map((label) => label.getBoundingClientRect());
        return {
          sideBySide: bounds[0].right < bounds[1].left && Math.abs(bounds[0].top - bounds[1].top) < 2,
          belowQuestion: bounds[0].top >= questionBounds.bottom,
          centered: Math.abs(
            (bounds[0].left + bounds[0].right + bounds[1].left + bounds[1].right) / 4 -
            (optionsBounds.left + optionsBounds.right) / 2,
          ) < 2,
          withinPanel: bounds[1].right <= settingsPanel.getBoundingClientRect().right,
          sectionBorder: getComputedStyle(section).borderTopWidth,
          labels: labels.map((label) => {
            const input = label.querySelector("input").getBoundingClientRect();
            const text = document.createRange();
            text.selectNode(label.lastChild);
            const textBounds = text.getBoundingClientRect();
            const style = getComputedStyle(label);
            return {
              display: style.display,
              border: style.borderTopWidth,
              background: style.backgroundColor,
              radioWidth: input.width,
              radioHeight: input.height,
              aligned: Math.abs((input.top + input.bottom) / 2 - (textBounds.top + textBounds.bottom) / 2) < 3,
            };
          }),
        };
      });
      assert.equal(layout.sideBySide, true, `${width}px`);
      assert.equal(layout.belowQuestion, true, `${width}px`);
      assert.equal(layout.centered, true, `${width}px`);
      assert.equal(layout.withinPanel, true, `${width}px`);
      assert.equal(layout.sectionBorder, "1px");
      for (const label of layout.labels) {
        assert.ok(["flex", "inline-flex"].includes(label.display));
        assert.equal(label.border, "0px");
        assert.equal(label.background, "rgba(0, 0, 0, 0)");
        assert.equal(label.radioWidth, 16);
        assert.equal(label.radioHeight, 16);
        assert.equal(label.aligned, true);
      }
    }
    await page.evaluate(() => {
      activeRegistry = "transaction";
      tableSettings = normalizeTableSettings({ ...tableSettings, keepKeysAfterCompromise: false });
      const key = normalizeKey({ ...makeEmptyKey({ id: "T2-8", category: "T2", number: 8 }),
        owner: "COMPROMIS TEST", property: "8 rue Test",
        sets: [makeKeySet("main"), makeKeySet("double")] });
      archives = [{ id: "compromise-multi", reason: "rented", archivedAt: "2026-11-16T10:00:00Z", key }];
      saveArchives = () => { window.__savedArchives = structuredClone(archives); };
      window.__activity = [];
      logActivity = (...args) => window.__activity.push(args);
      window.__finishCalls = [];
      finishKeyControlAction = async (...args) => { window.__finishCalls.push(args); return true; };
      ensureMovementActor = () => true;
      ensureTypedMovementPhone = () => true;
      promptReservationDateTime = async () => "2026-11-20T15:00";
      promptReservationReturn = async () => true;
      window.__signaturePrompts = 0;
      promptMovementSignature = async () => {
        window.__signaturePrompts += 1;
        return { signature: "group-signature", movementPhotos: { main: "photo-jeu-1", double: "photo-jeu-2" } };
      };
      alert = () => {};
      settingsPanel.hidden = true;
      openArchivedKeyRecord(archives[0]);
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
    });
    assert.equal(await page.locator("#multiSetSelectionLabel").isVisible(), true);
    await page.locator("#multiSetSelectionInput").check();
    await page.locator(".photo-set-check-icon").first().click();
    await page.locator(".photo-set-check-icon").nth(1).click();
    assert.equal(await page.locator(".key-set-photo-card.is-selected").count(), 2);
    assert.equal(await page.locator("#reservedBtn").isEnabled(), true);
    await page.locator("#reservedBtn").click();
    await page.waitForFunction(() => archives[0].key.sets.every((set) => set.reservations.length === 1));
    const reservedCompromise = await page.evaluate(() => ({
      movementIds: archives[0].key.sets.map((set) => set.history[0].id),
      reservationIds: archives[0].key.sets.map((set) => set.reservations[0].id),
      savedCounts: window.__savedArchives[0].key.sets.map((set) => set.reservations.length),
      activities: window.__activity.map((item) => item[0]),
      finish: window.__finishCalls[0],
    }));
    assert.notEqual(reservedCompromise.movementIds[0], reservedCompromise.movementIds[1]);
    assert.notEqual(reservedCompromise.reservationIds[0], reservedCompromise.reservationIds[1]);
    assert.deepEqual(reservedCompromise.savedCounts, [1, 1]);
    assert.deepEqual(reservedCompromise.activities, ["Réservé", "Réservé"]);
    assert.equal(reservedCompromise.finish[0], "archive-compromise-multi");
    assert.deepEqual(reservedCompromise.finish[1],
      { keysChanged: false, archivesChanged: true, waitForConfirmation: true });
    assert.equal(await page.locator("#multiSetSelectionInput").isChecked(), false);
    await page.evaluate(() => {
      movementPersonInput.value = "Raquel";
      movementNameInput.value = "PEROZO";
      movementPhoneInput.value = "0700000000";
    });
    await page.locator("#multiSetSelectionInput").check();
    await page.locator(".photo-set-check-icon").first().click();
    await page.locator(".photo-set-check-icon").nth(1).click();
    await page.locator("#checkoutBtn").click();
    await page.waitForFunction(() => archives[0].key.sets.every((set) => set.status === "out"));
    const checkedOutCompromise = await page.evaluate(() => ({
      photos: archives[0].key.sets.map((set) => set.history[0].movementPhoto),
      signatures: archives[0].key.sets.map((set) => set.history[0].signature),
      movementIds: archives[0].key.sets.map((set) => set.history[0].id),
      savedStatuses: window.__savedArchives[0].key.sets.map((set) => set.status),
      activities: window.__activity.map((item) => item[0]),
      signaturePrompts: window.__signaturePrompts,
      checked: multiSetSelectionInput.checked,
    }));
    assert.deepEqual(checkedOutCompromise.photos, ["photo-jeu-1", "photo-jeu-2"]);
    assert.deepEqual(checkedOutCompromise.signatures, ["group-signature", "group-signature"]);
    assert.notEqual(checkedOutCompromise.movementIds[0], checkedOutCompromise.movementIds[1]);
    assert.deepEqual(checkedOutCompromise.savedStatuses, ["out", "out"]);
    assert.deepEqual(checkedOutCompromise.activities, ["Réservé", "Réservé", "Sorti", "Sorti"]);
    assert.equal(checkedOutCompromise.signaturePrompts, 1);
    assert.equal(checkedOutCompromise.checked, false);
    await page.evaluate(() => {
      openArchivedKeyRecord({ ...archives[0], id: "removed-multi", reason: "removed" });
    });
    assert.equal(await page.locator("#multiSetSelectionLabel").isVisible(), false);
    console.log("Sold mode, legacy compromises, and location isolation passed.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
