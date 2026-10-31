const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

function dialogAppearance(dialog) {
  const form = dialog.querySelector("form");
  const heading = dialog.querySelector("h3");
  const buttons = [...dialog.querySelectorAll("button")];
  const properties = (element, names) => Object.fromEntries(names.map((name) => [name, getComputedStyle(element)[name]]));
  return {
    dialog: properties(dialog, ["width", "padding", "backgroundColor", "borderColor", "borderWidth", "borderRadius"]),
    form: properties(form, ["display", "rowGap"]),
    heading: properties(heading, ["fontSize", "fontWeight", "lineHeight", "textAlign", "marginBottom"]),
    buttons: buttons.map((button) => properties(button, ["minHeight", "fontWeight", "color", "backgroundColor", "borderColor", "borderWidth", "borderRadius"])),
  };
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      const contents = await fs.readFile(file);
      const type = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".webp": "image/webp" }[path.extname(file)];
      response.writeHead(200, { "Content-Type": type || "application/octet-stream" });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const touch of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: "block", hasTouch: touch, isMobile: touch,
        viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.route("**/agency-config.js*", (route) => route.fulfill({
        status: 200, contentType: "text/javascript",
        body: 'window.QUIALAKEY_CONFIG = { agencyId: "key-info-test", agencyName: "Test", accessLockEnabled: false };',
      }));
      await page.addInitScript(() => {
        if (sessionStorage.getItem("key-info-test-seeded")) return;
        const prefix = "quialakey:key-info-test:";
        localStorage.setItem(`${prefix}cles-table-settings-v1`, JSON.stringify({ accessLockEnabled: false }));
        localStorage.setItem(`${prefix}cles-location-active-registry-v1`, "transaction");
        localStorage.setItem(`${prefix}cles-transaction-v1`, JSON.stringify([{
          id: "T3-1", category: "T3", number: 1, owner: "MEYER", property: "27 avenue Test",
          sets: [{ id: "main", label: "Jeu 1", status: "available", history: [], reservations: [] }],
        }]));
        sessionStorage.setItem("key-info-test-seeded", "yes");
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      await page.locator(".key-tile").filter({ hasText: "T3 #1" }).first().click();
      assert.equal(await page.locator("#detailPanel .panel-header .eyebrow").textContent(), "Fiche clés");
      assert.equal(await page.locator("#contactSelect").evaluate((select) => select.closest("label").firstChild.textContent.trim()), "Intervenants récurrents");
      assert.equal(await page.locator("#contactSelect option").first().textContent(), "Choisir dans la liste");
      assert.equal(await page.locator(".movement-contact-heading").textContent(), "Intervenant ponctuel");
      assert.equal(await page.locator("#movementContactDetails summary").textContent(), "Saisir les informations");
      assert.equal(await page.locator("#movementContactDetails").evaluate((details) => details.open), false);
      for (const button of ["#reservedBtn", "#checkoutBtn", "#rentedBtn", "#removedBtn"]) {
        let warning = "";
        page.once("dialog", async (dialog) => {
          warning = dialog.message();
          await dialog.accept();
        });
        await page.locator(button).click();
        assert.match(warning, /Renseigne ou choisis un intervenant/);
        assert.equal(await page.locator("#movementContactDetails").evaluate((details) => details.open), false, button);
      }
      const headingStyles = (element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(["color", "fontSize", "fontWeight"].map((property) => [property, style[property]]));
      };
      assert.deepEqual(await page.locator(".movement-contact-heading").evaluate(headingStyles),
        await page.locator("#contactSelect").evaluate((select) => {
          const style = getComputedStyle(select.closest("label"));
          return Object.fromEntries(["color", "fontSize", "fontWeight"].map((property) => [property, style[property]]));
        }));
      for (const width of touch ? [390, 320] : [1280]) {
        if (touch) await page.setViewportSize({ width, height: 844 });
        const copyFits = await page.locator("#contactSelect").evaluate((select) => {
          const style = getComputedStyle(select);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          context.font = style.font;
          const textWidth = context.measureText(select.options[0].text).width;
          const summary = document.querySelector("#movementContactDetails summary");
          return textWidth <= select.clientWidth - 48 && summary.scrollWidth <= summary.clientWidth + 1;
        });
        assert.equal(copyFits, true, `Movement labels must fit at ${width}px`);
      }
      if (touch) await page.setViewportSize({ width: 390, height: 844 });
      const bandStyles = (element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(["display", "minHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
          "borderTopWidth", "borderTopColor", "borderTopLeftRadius", "backgroundColor", "color", "fontSize",
          "fontWeight", "textAlign"].map((property) => [property, style[property]]));
      };
      assert.deepEqual(await page.locator("#keyDetailsToggleBtn").evaluate(bandStyles),
        await page.locator("#movementContactDetails summary").evaluate(bandStyles));
      assert.equal(Math.round((await page.locator("#keyDetailsToggleBtn").boundingBox()).width),
        Math.round((await page.locator("#keyDetailsHeading").boundingBox()).width));
      assert.ok(Math.round((await page.locator("#movementContactDetails summary").boundingBox()).height) >=
        Math.round((await page.locator("#keyDetailsToggleBtn").boundingBox()).height));
      await page.locator("#keyDetailsToggleBtn").click();
      if (!touch) {
        for (const count of [2, 3, 4]) {
          page.once("dialog", (dialog) => dialog.accept());
          await page.locator("#keySetCountUnlockBtn").dblclick();
          await page.locator("#keySetCountSelect").selectOption(String(count));
          assert.equal(await page.evaluate(() => getSelectedSet().needsCheckInReason), "added");
          assert.equal(await page.locator("#checkinBtn").isEnabled(), true);
          assert.equal(await page.locator("#checkoutBtn").isDisabled(), true);
        }
        await page.locator("#propertyInput").dblclick();
      } else {
        await page.locator("#propertyInput").tap();
        await page.locator("#propertyInput").tap();
      }
      assert.equal(await page.locator(".key-info-edit-dialog h3").textContent(), "Souhaitez-vous effectuer des modifications ?");
      assert.deepEqual(await page.locator(".key-info-edit-dialog button").allTextContents(), ["Oui", "Non"]);
      assert.equal(await page.locator(".key-info-edit-dialog").evaluate((dialog) => dialog.classList.contains("reservation-return-dialog")), true);
      const editAppearance = await page.locator(".key-info-edit-dialog").evaluate(dialogAppearance);
      await page.evaluate(() => {
        window.keyInfoFocusEvents = [];
        propertyInput.addEventListener("focus", () => window.keyInfoFocusEvents.push({
          readOnly: propertyInput.readOnly,
          dialogPresent: Boolean(document.querySelector(".key-info-edit-dialog")),
        }), { once: true });
      });
      if (touch) await page.locator(".key-info-edit-dialog button[value='yes']").tap();
      else await page.locator(".key-info-edit-dialog button[value='yes']").click();
      assert.equal(await page.locator(".key-info-edit-dialog").count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), "propertyInput");
      assert.equal(await page.locator("#propertyInput").evaluate((input) => input.readOnly), false);
      assert.deepEqual(await page.evaluate(() => window.keyInfoFocusEvents), [{ readOnly: false, dialogPresent: false }]);
      await page.locator("#propertyInput").fill("32 avenue du Test");
      await page.locator("#contactSelect").click();
      await page.waitForFunction(() => document.querySelector("#propertyInput").readOnly);
      assert.equal(await page.evaluate(() => getSelectedKey().property), "32 Av. Du Test");
      await page.reload();
      await page.waitForFunction(() => indexedStorageHydrated && !document.body.classList.contains("is-access-loading"));
      await page.locator(".key-tile").filter({ hasText: "T3 #1" }).first().click();
      await page.locator("#keyDetailsToggleBtn").click();
      assert.equal(await page.locator("#propertyInput").inputValue(), "32 Av. Du Test");
      const openOwnerEdit = async () => {
        if (touch) {
          await page.locator("#ownerInput").tap();
          await page.locator("#ownerInput").tap();
        } else {
          await page.locator("#ownerInput").dblclick();
        }
      };
      await openOwnerEdit();
      if (touch) await page.locator('.key-info-edit-dialog button[value="no"]').tap();
      else await page.locator('.key-info-edit-dialog button[value="no"]').click();
      assert.equal(await page.locator("#ownerInput").evaluate((input) => input.readOnly), true);
      await openOwnerEdit();
      if (touch) await page.locator('.key-info-edit-dialog button[value="yes"]').tap();
      else await page.locator('.key-info-edit-dialog button[value="yes"]').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "ownerInput");
      assert.equal(await page.locator("#ownerInput").evaluate((input) => input.readOnly), false);
      await page.locator("#ownerInput").fill("MARTIN");
      await page.locator("#contactSelect").click();
      await page.waitForFunction(() => getSelectedKey().owner === "MARTIN");
      await page.evaluate(() => { void promptReservationReturn(); });
      const reservationAppearance = await page.locator(".reservation-return-dialog").evaluate(dialogAppearance);
      assert.deepEqual(editAppearance, reservationAppearance);
      await page.locator(".reservation-return-dialog button[value='no']").click();
      await page.evaluate(() => {
        contacts = [
          { id: "internal-test", type: "internal", firstName: "Ana", name: "BERNARD", phone: "06 11 22 33 44" },
          { id: "external-test", type: "external", firstName: "Luc", name: "DUPONT", companyName: "Agence Test", phone: "07 11 22 33 44" },
        ];
        renderContactSelect();
      });
      await page.locator("#contactSelect").selectOption("internal-test");
      assert.equal(await page.locator("#contactSelect").inputValue(), "internal-test");
      assert.equal(await page.locator("#movementNameInput").inputValue(), "BERNARD");
      await page.locator("#contactSelect").selectOption("");
      assert.equal(await page.locator("#contactSelect").inputValue(), "");
      await page.evaluate(() => {
        void promptReservationEdit({ person: "Avant", reservationDate: "09/10/2026 12:00", note: "À conserver", returnsToAgency: true });
      });
      const contactPicker = page.locator('.reservation-edit-dialog select[name="contact"]');
      assert.deepEqual(await contactPicker.locator("optgroup").evaluateAll((groups) => groups.map((group) => group.label)),
        ["Intervenants internes", "Intervenants externes"]);
      assert.equal(await page.locator('.reservation-edit-dialog input[name="person"]').inputValue(), "Avant");
      await contactPicker.selectOption("internal-test");
      assert.equal(await page.locator('.reservation-edit-dialog input[name="person"]').inputValue(), "Ana BERNARD");
      await contactPicker.selectOption("external-test");
      assert.equal(await page.locator('.reservation-edit-dialog input[name="person"]').inputValue(), "Luc DUPONT");
      assert.equal(await page.locator('.reservation-edit-dialog input[name="company"]').inputValue(), "Agence Test");
      assert.equal(await page.locator('.reservation-edit-dialog input[name="phone"]').inputValue(), "07 11 22 33 44");
      assert.equal(await page.locator('.reservation-edit-dialog textarea[name="note"]').inputValue(), "À conserver");
      assert.equal(await page.locator('.reservation-edit-dialog select[name="returns"]').inputValue(), "yes");
      await page.locator('.reservation-edit-dialog button[value="cancel"]').click();
      await context.close();
    }
    const staleCssContext = await browser.newContext({ serviceWorkers: "block" });
    const staleCssPage = await staleCssContext.newPage();
    await staleCssPage.route("**/styles.css*", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await staleCssPage.route("**/app.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await staleCssPage.goto(`http://127.0.0.1:${server.address().port}/`);
    const fallbackStyle = await staleCssPage.locator("#keyDetailsToggleBtn").evaluate((button) => {
      const style = getComputedStyle(button);
      return { display: style.display, minHeight: style.minHeight, background: style.backgroundColor,
        border: style.borderTopWidth, after: getComputedStyle(button, "::after").content };
    });
    assert.deepEqual(fallbackStyle, { display: "flex", minHeight: "40px", background: "rgb(216, 220, 216)",
      border: "1px", after: '""' });
    await staleCssContext.close();
    console.log("Key edits, touch focus, and movement contact labels/selection passed.");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
