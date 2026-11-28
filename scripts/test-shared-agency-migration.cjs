const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const run = promisify(execFile);

async function main() {
  const source = [
    { key: "cles-cloud-sync-heartbeat-v1", value: { version: "source" }, updated_at: "2026-11-27T10:00:00Z" },
    { key: "cles-immobilieres-v1", value: [{ id: "t2-1", owner: "Test" }], updated_at: "2026-11-27T11:00:00Z" },
  ];
  const target = [];
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push({ path: url.pathname, method: request.method, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && url.pathname === "/target/auth/v1/signup") {
      response.writeHead(200).end(JSON.stringify({ access_token: "test-session-token" }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/target/rest/v1/rpc/login_agency") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const credentials = JSON.parse(body);
      response.writeHead(200).end(JSON.stringify(
        credentials.p_login_code === "TEST" && credentials.p_password === "test-password"
          ? "agency-test" : null));
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/target/")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      target.push(...(Array.isArray(payload) ? payload : [payload]));
      response.writeHead(201).end("");
      return;
    }
    const rows = url.pathname.startsWith("/source/") ? source : target;
    const filtered = rows.filter((row) => !url.searchParams.has("agency_id")
      || row.agency_id === url.searchParams.get("agency_id").slice(3));
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || filtered.length);
    const selected = filtered.slice(offset, offset + limit);
    response.writeHead(200).end(JSON.stringify(url.searchParams.get("select") === "key"
      ? selected.map((row) => ({ key: row.key })) : selected));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "quialakey-shared-migration-"));
  const backupPath = path.join(temp, "agency.json");
  const script = path.resolve(__dirname, "migrate-agency-data.mjs");
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...process.env,
    QUIALAKEY_AGENCY_ID: "agency-test",
    QUIALAKEY_SOURCE_URL: `${base}/source`,
    QUIALAKEY_SOURCE_PUBLISHABLE_KEY: "sb_publishable_test",
    QUIALAKEY_TARGET_URL: `${base}/target`,
    QUIALAKEY_TARGET_SERVICE_KEY: "sb_secret_test",
  };
  try {
    await run(process.execPath, [script, "export", backupPath], { env });
    const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
    assert.equal(backup.rows.length, 2);
    await run(process.execPath, [script, "import", backupPath], { env });
    assert.equal(target.length, 0, "Dry run must not write");
    await run(process.execPath, [script, "import", backupPath, "--apply"], { env });
    assert.equal(target.length, 3);
    assert.ok(target.every((row) => row.agency_id === "agency-test"));
    assert.ok(target.some((row) => row.key === "quialakey-shared-ready-v1"));
    assert.ok(requests.every((entry) => !entry.headers.authorization), "New API keys must use the apikey header");
    await assert.rejects(run(process.execPath, [script, "import", backupPath, "--apply"], { env }),
      /contient deja des donnees/);
    target.length = 0;
    const authEnv = {
      ...env,
      QUIALAKEY_TARGET_SERVICE_KEY: "",
      QUIALAKEY_TARGET_PUBLISHABLE_KEY: "sb_publishable_test",
      QUIALAKEY_TARGET_AGENCY_CODE: "TEST",
      QUIALAKEY_TARGET_PASSWORD: "test-password",
    };
    await run(process.execPath, [script, "import", backupPath], { env: authEnv });
    assert.equal(target.length, 0, "Authenticated dry run must not write");
    await run(process.execPath, [script, "import", backupPath, "--apply"], { env: authEnv });
    assert.equal(target.length, 3);
    assert.ok(requests.some((entry) => entry.path === "/target/rest/v1/app_state"
      && entry.headers.authorization === "Bearer test-session-token"));
    target.length = 0;
    await assert.rejects(run(process.execPath, [script, "import", backupPath], {
      env: { ...authEnv, QUIALAKEY_TARGET_AGENCY_CODE: "WRONG" },
    }), /Connexion à l'agence de destination refusée/);
    console.log("Agency export, dry run, import and verification passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
