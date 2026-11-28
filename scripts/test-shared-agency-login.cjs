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
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/agency-config.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `window.QUIALAKEY_CONFIG = Object.freeze({
        agencyId: "agency-test", agencyName: "Century 21 Les Minimes",
        supabaseUrl: "https://shared-test.supabase.co", supabasePublishableKey: "sb_publishable_test",
        sharedProjectMode: true, agencyLogins: {
          "TEST-42": { agencyId: "agency-test", agencyName: "Century 21 Les Minimes" },
          "OTHER-42": { agencyId: "agency-other", agencyName: "Autre agence" }
        }
      });`,
    }));
    await context.route("**/vendor/supabase-2.110.8.min.js*", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `window.__authAttempts = [];
        window.__clientModes = [];
        window.supabase = { createClient(_url, _key, options) {
          const persistent = options?.auth?.persistSession === true;
          window.__clientModes.push(persistent);
          let session = persistent ? JSON.parse(localStorage.getItem('test-auth-session') || 'null') : null;
          let activeAgency = persistent ? localStorage.getItem('test-auth-agency') : null;
          return {
            auth: {
              async signInAnonymously() {
                window.__authAttempts.push({ anonymous: true });
                session = { access_token: "agency-token" };
                if (persistent) localStorage.setItem('test-auth-session', JSON.stringify(session));
                return { data: { session }, error: null };
              },
              async getSession() { return { data: { session }, error: null }; },
              async signOut() {
                session = null; activeAgency = null;
                localStorage.removeItem('test-auth-session');
                localStorage.removeItem('test-auth-agency');
                return { error: null };
              }
            },
            async rpc(name, args) {
              if (name === "login_agency") {
                activeAgency = args.p_password === "correct-password"
                  ? { "TEST-42": "agency-test", "OTHER-42": "agency-other" }[args.p_login_code] || null
                  : null;
                if (persistent && activeAgency) localStorage.setItem('test-auth-agency', activeAgency);
                return { data: activeAgency, error: null };
              }
              if (name === "current_agency_id" && persistent && activeAgency) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                if (localStorage.getItem('test-auth-rpc-fail') === '1') {
                  return { data: null, error: new Error('Network unavailable') };
                }
              }
              return { data: activeAgency, error: null };
            },
            channel() { return { on() { return this; }, subscribe() { return this; } }; },
            async removeChannel() {}
          };
        } };`,
    }));
    const requests = [];
    const rows = new Map([
      ["quialakey-shared-ready-v1", { agency_id: "agency-test", key: "quialakey-shared-ready-v1", value: { validatedAt: "2026-11-27" }, updated_at: "2026-11-27T09:00:00Z" }],
      ["cles-cloud-sync-heartbeat-v1", { agency_id: "agency-test", key: "cles-cloud-sync-heartbeat-v1", value: { version: "test" }, updated_at: "2026-11-27T09:00:00Z" }],
    ]);
    await context.route("https://shared-test.supabase.co/rest/v1/**", async (route) => {
      const request = route.request();
      requests.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postData() });
      const query = new URL(request.url()).searchParams;
      if (request.method() === "POST") {
        const payload = JSON.parse(request.postData());
        for (const row of Array.isArray(payload) ? payload : [payload]) {
          rows.set(row.key, { ...row, updated_at: row.updated_at || new Date().toISOString() });
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(payload) ? payload : [payload]) });
        return;
      }
      let selected = [...rows.values()];
      const keyFilter = query.get("key") || "";
      if (keyFilter.startsWith("eq.")) selected = selected.filter((row) => row.key === keyFilter.slice(3));
      if (keyFilter.startsWith("in.")) {
        const included = new Set([...keyFilter.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
        selected = selected.filter((row) => included.has(row.key));
      }
      if (keyFilter.startsWith("like.")) selected = selected.filter((row) => row.key.startsWith(keyFilter.slice(5).replace(/%$/, "")));
      if (query.get("agency_id")) selected = selected.filter((row) => query.get("agency_id") === `eq.${row.agency_id}`);
      const columns = query.get("select")?.split(",") || [];
      if (columns.length && columns[0] !== "*") {
        selected = selected.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(selected) });
    });

    const url = `http://127.0.0.1:${server.address().port}/`;
    const page = await context.newPage();
    await page.goto(url);
    await page.locator("#accessLock").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#accessRememberInput').isVisible(), true);
    const formBounds = await page.locator("#accessForm").boundingBox();
    assert.ok(formBounds && formBounds.x >= 0 && formBounds.x + formBounds.width <= 390);
    assert.equal(await page.locator("#accessAgencyCodeInput").isVisible(), true);
    assert.equal(await page.locator("#accessCodeInput").isVisible(), true);
    assert.equal(requests.length, 0, "Cloud must not be read before login");
    await page.locator("#accessAgencyCodeInput").fill("OTHER");
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator("#accessForm button[type=submit]").click();
    assert.equal(await page.locator("#accessError").isVisible(), true);
    assert.equal(await page.evaluate(() => window.__authAttempts?.length || 0), 0);
    await page.locator("#accessAgencyCodeInput").fill("TEST-42");
    await page.locator("#accessCodeInput").fill("wrong-password");
    await page.locator("#accessForm button[type=submit]").click();
    assert.equal(await page.locator("#accessError").isVisible(), true);
    assert.equal(requests.length, 0);
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator("#accessForm button[type=submit]").click();
    await page.locator("#accessLock").waitFor({ state: "hidden" });
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    const result = await page.evaluate(async () => {
      const client = createRestSupabaseClient("https://shared-test.supabase.co", "sb_publishable_test");
      await client.from("app_state").select("key,value").eq("key", "probe");
      await client.from("app_state").upsert({ key: "probe", value: { ok: true } });
      return isAccessUnlocked();
    });
    assert.equal(result, true);
    const probeReads = requests.filter((entry) => entry.url.includes("key=eq.probe"));
    assert.ok(probeReads.length >= 1);
    assert.ok(probeReads.every((entry) => new URL(entry.url).searchParams.get("agency_id") === "eq.agency-test"));
    const write = requests.find((entry) => entry.method === "POST" && entry.body?.includes('"key":"probe"'));
    assert.ok(write);
    assert.equal(write.headers.authorization, "Bearer agency-token");
    assert.equal(JSON.parse(write.body).agency_id, "agency-test");
    assert.equal(new URL(write.url).searchParams.get("on_conflict"), "agency_id,key");
    assert.equal(await page.locator("#agencySignOutBtn").isVisible(), true);
    await page.setViewportSize({ width: 320, height: 700 });
    const signOutBounds = await page.locator("#agencySignOutBtn").boundingBox();
    const agencyNameBounds = await page.locator("#agencyNameLabel").boundingBox();
    assert.ok(signOutBounds && agencyNameBounds);
    assert.ok(signOutBounds.x >= 0 && agencyNameBounds.x + agencyNameBounds.width <= 320);
    assert.ok(signOutBounds.x + signOutBounds.width <= agencyNameBounds.x);
    await page.locator("#agencySignOutBtn").click();
    await page.locator("#accessLock").waitFor({ state: "visible" });

    const secondPage = await context.newPage();
    await secondPage.goto(url);
    await secondPage.locator("#accessLock").waitFor({ state: "visible" });
    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    rows.set("quialakey-shared-ready-v1", {
      agency_id: "agency-other", key: "quialakey-shared-ready-v1",
      value: { validatedAt: "2026-11-27" }, updated_at: "2026-11-27T09:00:00Z",
    });
    rows.set("cles-cloud-sync-heartbeat-v1", {
      agency_id: "agency-other", key: "cles-cloud-sync-heartbeat-v1",
      value: { version: "test" }, updated_at: "2026-11-27T09:00:00Z",
    });
    await page.locator("#accessAgencyCodeInput").fill("OTHER-42");
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator("#accessForm button[type=submit]").click();
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => agencyId), "agency-other");
    const otherRequests = requests.filter((entry) => entry.url.includes("agency_id=eq.agency-other"));
    assert.ok(otherRequests.length > 0, "Second agency must use its own rows");
    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    rows.delete("quialakey-shared-ready-v1");
    await page.locator("#accessAgencyCodeInput").fill("TEST-42");
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator("#accessForm button[type=submit]").click();
    await page.locator("#retryInitialLoadBtn").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => hasCompletedInitialCloudLoad), false);
    rows.set("quialakey-shared-ready-v1", {
      agency_id: "agency-test", key: "quialakey-shared-ready-v1",
      value: { validatedAt: "2026-11-27" }, updated_at: "2026-11-27T09:00:00Z",
    });
    rows.set("cles-cloud-sync-heartbeat-v1", {
      agency_id: "agency-test", key: "cles-cloud-sync-heartbeat-v1",
      value: { version: "test" }, updated_at: "2026-11-27T09:00:00Z",
    });
    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    await page.locator("#accessAgencyCodeInput").fill("TEST-42");
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator('#accessRememberInput').check();
    await page.locator("#accessForm button[type=submit]").click();
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('quialakey-remembered-agency-v1')), 'TEST-42');
    await page.reload();
    assert.equal(await page.locator('#startupLoading').isVisible(), true);
    assert.equal(await page.locator('#accessLock').isVisible(), false);
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    assert.equal(await page.locator("#accessLock").isVisible(), false);
    await page.evaluate(() => localStorage.setItem('test-auth-rpc-fail', '1'));
    await page.reload();
    await page.locator('#retryInitialLoadBtn').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#accessLock').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('quialakey-remembered-agency-v1')), 'TEST-42');
    await page.evaluate(() => localStorage.removeItem('test-auth-rpc-fail'));
    await page.locator('#retryInitialLoadBtn').click();
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    await page.locator("#agencySignOutBtn").click();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => localStorage.getItem('quialakey-remembered-agency-v1')), null);
    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    await page.locator("#accessAgencyCodeInput").fill("TEST-42");
    await page.locator("#accessCodeInput").fill("correct-password");
    await page.locator('#accessRememberInput').check();
    await page.locator("#accessForm button[type=submit]").click();
    await page.waitForFunction(() => hasCompletedInitialCloudLoad, null, { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('test-auth-session'));
    await page.reload();
    await page.locator("#accessLock").waitFor({ state: "visible" });
    assert.equal(await page.locator('#startupLoading').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('quialakey-remembered-agency-v1')), null);
    console.log("Shared agency login, second agency and scoped cloud requests passed.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
