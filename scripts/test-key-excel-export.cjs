const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "output", "export-signatures-test");
  await fs.mkdir(output, { recursive: true });
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
    await page.waitForFunction(() => typeof exportKeyExcel === "function");
    await page.evaluate(() => {
      function signature(width, height, index) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.strokeStyle = "#263238";
        context.lineWidth = Math.max(3, Math.min(width, height) / 35);
        context.beginPath();
        context.moveTo(width * 0.08, height * 0.7);
        context.bezierCurveTo(width * 0.8, 0, width * 0.1, height, width * 0.9, height * 0.3);
        context.stroke();
        context.font = `${Math.min(width, height) / 6}px Arial`;
        context.fillText(`Test ${index}`, width * 0.1, height * 0.95);
        return canvas.toDataURL("image/png");
      }
      window.exportFixture = {
        id: "T3-5", category: "T3", number: 5, owner: "EXEMPLE", property: "12 rue du Test",
        postalCode: "01000", city: "Ville", ownerFirstName: "Camille", notes: "Fiche de test",
        sets: [{ label: "Jeu 1", status: "available", history: [
          { type: "in", person: "Sans signature", phone: "01 02 03 04 05", date: "19/09/2026 14:40", signature: "" },
          ...[[1200, 300], [320, 212], [180, 700]].map(([width, height], index) => ({
            type: index % 2 ? "in" : "out", person: `Signature ${index + 1}`,
            phone: "06 12 34 56 78", date: "18/09/2026 10:20", note: `Mouvement ${index + 1}`,
            signature: signature(width, height, index + 1),
          })),
          { type: "in", person: "Commentaire long", note: "Texte sur plusieurs lignes. ".repeat(20), date: "17/09/2026 09:00", signature: "" },
        ] }],
      };
    });
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => exportKeyExcel(window.exportFixture));
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "T3-5-export.xlsx");
    await download.saveAs(path.join(output, download.suggestedFilename()));
    const result = await page.evaluate(async () => {
      const rows = keyToCsvRows(window.exportFixture);
      const workbook = await createKeyExcelWorkbook(rows);
      const restored = new window.ExcelJS.Workbook();
      await restored.xlsx.load(await workbook.xlsx.writeBuffer());
      const sheet = restored.worksheets[0];
      const invalidRows = [{ ...rows[1], signatureManuscrite: "data:image/png;base64,broken" }];
      let rejectsInvalidSignature = false;
      try { await createKeyExcelWorkbook(invalidRows); } catch { rejectsInvalidSignature = true; }
      const noHistory = { ...window.exportFixture, sets: [{ label: "Jeu 2", status: "available", history: [] }] };
      const unsigned = await createKeyExcelWorkbook(keyToCsvRows(noHistory));
      const archive = { reason: "sold", archivedAt: "2026-09-19T10:00:00Z" };
      const archived = await createKeyExcelWorkbook(keyToCsvRows(window.exportFixture, archive));
      return {
        rowCount: sheet.rowCount,
        postalCode: sheet.getCell("C2").value,
        phone: sheet.getCell("N3").value,
        heights: [3, 4, 5].map((row) => sheet.getRow(row).height),
        images: sheet.getImages().map((image) => ({
          row: image.range.tl.nativeRow, col: image.range.tl.nativeCol,
          endRow: image.range.br.nativeRow, endCol: image.range.br.nativeCol,
          width: (image.range.br.nativeColOff - image.range.tl.nativeColOff) / 9525,
          height: (image.range.br.nativeRowOff - image.range.tl.nativeRowOff) / 9525,
          editAs: image.range.editAs,
        })),
        rejectsInvalidSignature,
        unsignedImages: unsigned.worksheets[0].getImages().length,
        archivedImages: archived.worksheets[0].getImages().length,
      };
    });
    assert.equal(result.rowCount, 6);
    assert.equal(result.postalCode, "01000");
    assert.equal(result.phone, "06 12 34 56 78");
    assert.deepEqual(result.images.map((image) => image.row), [2, 3, 4]);
    assert.ok(result.images.every((image) => image.col === 17 && image.endCol === 17 && image.row === image.endRow && image.width <= 160 && image.height <= 64 && image.editAs === "oneCell"));
    assert.ok(result.heights.every((height) => height >= 66));
    assert.equal(result.rejectsInvalidSignature, true);
    assert.equal(result.unsignedImages, 0);
    assert.equal(result.archivedImages, 3);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
