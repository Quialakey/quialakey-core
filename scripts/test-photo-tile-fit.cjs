const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const width of [1280, 800, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`
        <div class="key-grid" data-view-mode="photo">
          <div class="category-row">
            <div class="category-title">T2</div>
            <div class="key-row">
              <span class="key-tile-shell photo-view-shell">
                <button class="key-tile photo-view available has-set-strip">
                  <span class="key-photo-content">
                    <img alt="Photo portrait" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='600'%3E%3Crect width='300' height='600' fill='red'/%3E%3C/svg%3E">
                  </span>
                </button>
              </span>
            </div>
          </div>
        </div>
      `);
      await page.addStyleTag({ path: path.resolve(__dirname, "../styles.css") });
      const photo = page.locator(".key-photo-content img");
      await photo.evaluate((image) => image.decode());
      const result = await photo.evaluate((image) => ({
        fit: getComputedStyle(image).objectFit,
        position: getComputedStyle(image).objectPosition,
        boxWidth: image.clientWidth,
        boxHeight: image.clientHeight,
        frameWidth: image.parentElement.clientWidth,
        frameHeight: image.parentElement.clientHeight,
        frameScrollWidth: image.parentElement.scrollWidth,
        frameScrollHeight: image.parentElement.scrollHeight,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      }));
      assert.equal(result.fit, "contain", `Photo recadree a ${width}px`);
      assert.equal(result.position, "50% 50%", `Photo non centree a ${width}px`);
      assert.ok(result.boxWidth > 0 && result.boxHeight > 0, `Case invisible a ${width}px`);
      assert.equal(result.boxWidth, result.frameWidth, `Photo deborde horizontalement a ${width}px`);
      assert.equal(result.boxHeight, result.frameHeight, `Photo deborde verticalement a ${width}px`);
      assert.equal(result.frameScrollWidth, result.frameWidth, `Cadre coupe la photo a ${width}px`);
      assert.equal(result.frameScrollHeight, result.frameHeight, `Cadre coupe la photo a ${width}px`);
      assert.equal(result.naturalHeight, result.naturalWidth * 2);
      await page.close();
    }
    console.log("Portrait photos remain fully visible in desktop, tablet, and mobile tiles.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
