const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
      const contents = await fs.readFile(file);
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)];
      response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const width of [1180, 960, 667]) {
      const context = await browser.newContext({ serviceWorkers: 'block', hasTouch: true, isMobile: true,
        viewport: { width, height: 440 } });
      const page = await context.newPage();
      await page.route('**/agency-config.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript',
        body: 'window.QUIALAKEY_CONFIG = { agencyId: "landscape-test", agencyName: "Test", accessLockEnabled: false };' }));
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.backup-actions .icon-button');
      const layout = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('.backup-actions > .icon-button')];
        const main = document.querySelector('.backup-main-panel').getBoundingClientRect();
        const info = document.querySelector('.backup-info-panel').getBoundingClientRect();
        const actions = document.querySelector('.backup-actions').getBoundingClientRect();
        const settings = document.querySelector('.settings-data-button').getBoundingClientRect();
        return {
          coarseLandscape: matchMedia('(orientation: landscape) and (pointer: coarse)').matches,
          widths: buttons.map((button) => button.getBoundingClientRect().width),
          fontSize: getComputedStyle(buttons[0]).fontSize,
          infoRight: info.right,
          actionsLeft: actions.left,
          sameRow: Math.abs(info.top - actions.top) < 20,
          overflow: buttons.map((button) => button.scrollWidth - button.clientWidth),
          lines: buttons.map((button) => {
            const label = button.querySelector('.backup-action-label');
            const first = document.createRange();
            first.selectNodeContents(label.firstChild);
            const second = document.createRange();
            second.selectNodeContents(label.querySelector('.backup-action-break'));
            return { first: first.getClientRects().length, second: second.getClientRects().length,
              separated: second.getBoundingClientRect().top > first.getBoundingClientRect().top };
          }),
          settingsSeparate: main.right <= settings.left || main.bottom <= settings.top,
        };
      });
      assert.equal(layout.coarseLandscape, true);
      assert.equal(layout.widths.length, 6);
      assert.ok(Math.max(...layout.widths) - Math.min(...layout.widths) < 1, `${width}: unequal buttons ${layout.widths}`);
      assert.ok(layout.overflow.every((value) => value <= 1), `${width}: button overflow ${layout.overflow}`);
      assert.ok(layout.lines.every((line) => line.first === 1 && line.second === 1 && line.separated),
        `${width}: labels are not on two lines ${JSON.stringify(layout)}`);
      assert.ok(layout.infoRight <= layout.actionsLeft && layout.sameRow, `${width}: info not beside buttons ${JSON.stringify(layout)}`);
      assert.equal(layout.settingsSeparate, true, `${width}: settings overlap`);
      if (width === 960 || width === 667) {
        await page.locator('.backup-panel-row').screenshot({ path: path.join(root, 'output', `backup-landscape-${width}-20261108.png`) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('Six equal-width backup buttons fit on two lines in phone landscape.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
