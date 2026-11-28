import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

const [action, fileArgument, flag] = process.argv.slice(2);
if (!["export", "import"].includes(action) || !fileArgument) {
  throw new Error("Usage: node scripts/migrate-agency-data.mjs export|import C:\\chemin\\sauvegarde.json [--apply]");
}

const filePath = resolve(fileArgument);
const isInsideRepository = !relative(resolve(import.meta.dirname, ".."), filePath).startsWith("..")
  && !isAbsolute(relative(resolve(import.meta.dirname, ".."), filePath));
if (action === "export" && isInsideRepository) {
  throw new Error("Enregistrez la sauvegarde hors du depot Git : elle contient des donnees confidentielles.");
}

function environment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} est obligatoire.`);
  return value;
}

function apiHeaders(key, token = "") {
  return {
    apikey: key,
    ...(token || key.startsWith("eyJ") ? { Authorization: `Bearer ${token || key}` } : {}),
  };
}

async function requestRows(url, key, query, token = "") {
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/app_state?${query}`, {
    headers: apiHeaders(key, token),
  });
  if (!response.ok) throw new Error(`Lecture Supabase impossible (${response.status}) : ${await response.text()}`);
  return response.json();
}

async function readAllRows(url, key, filter = "", token = "") {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    const rows = await requestRows(url, key, `select=*&order=key.asc&limit=100&offset=${offset}${filter}`, token);
    result.push(...rows);
    if (rows.length < 100) return result;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function rowDigest(row) {
  return createHash("sha256").update(JSON.stringify(canonicalJson(row.value ?? null))).digest("hex");
}

if (action === "export") {
  const agencyId = environment("QUIALAKEY_AGENCY_ID");
  const sourceUrl = environment("QUIALAKEY_SOURCE_URL");
  const sourceKey = environment("QUIALAKEY_SOURCE_PUBLISHABLE_KEY");
  const rows = await readAllRows(sourceUrl, sourceKey);
  if (!rows.length) throw new Error("Aucune ligne source : sauvegarde interrompue.");
  const confirmation = await readAllRows(sourceUrl, sourceKey);
  const confirmationByKey = new Map(confirmation.map((row) => [row.key, row]));
  if (rows.length !== confirmation.length || rows.some((row) => !confirmationByKey.has(row.key)
      || rowDigest(row) !== rowDigest(confirmationByKey.get(row.key)))) {
    throw new Error("Les donnees ont change pendant l'export. Recommencez lorsque le tableau n'est pas utilise.");
  }
  const backup = { agencyId, exportedAt: new Date().toISOString(), rows };
  await writeFile(filePath, JSON.stringify(backup), { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(`Sauvegarde creee : ${rows.length} lignes pour ${agencyId}.`);
} else {
  const backup = JSON.parse(await readFile(filePath, "utf8"));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(backup.agencyId) || !Array.isArray(backup.rows) || !backup.rows.length) {
    throw new Error("Sauvegarde invalide : identifiant d'agence ou lignes manquants.");
  }
  const keys = backup.rows.map((row) => row.key);
  if (keys.some((key) => typeof key !== "string") || new Set(keys).size !== keys.length) {
    throw new Error("Sauvegarde invalide : cles manquantes ou dupliquees.");
  }
  const targetUrl = environment("QUIALAKEY_TARGET_URL");
  const serviceKey = String(process.env.QUIALAKEY_TARGET_SERVICE_KEY || "").trim();
  const targetKey = serviceKey || environment("QUIALAKEY_TARGET_PUBLISHABLE_KEY");
  let targetToken = "";
  if (!serviceKey) {
    const loginCode = environment("QUIALAKEY_TARGET_AGENCY_CODE");
    const password = environment("QUIALAKEY_TARGET_PASSWORD");
    const authResponse = await fetch(`${targetUrl.replace(/\/$/, "")}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: targetKey, "Content-Type": "application/json" },
      body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
    });
    if (!authResponse.ok) throw new Error(`Connexion anonyme impossible (${authResponse.status}).`);
    targetToken = (await authResponse.json()).access_token || "";
    if (!targetToken) throw new Error("Session Supabase manquante.");
    const loginResponse = await fetch(`${targetUrl.replace(/\/$/, "")}/rest/v1/rpc/login_agency`, {
      method: "POST",
      headers: { ...apiHeaders(targetKey, targetToken), "Content-Type": "application/json" },
      body: JSON.stringify({ p_login_code: loginCode, p_password: password }),
    });
    if (!loginResponse.ok || await loginResponse.json() !== backup.agencyId) {
      throw new Error("Connexion à l'agence de destination refusée.");
    }
  }
  const agencyFilter = `&agency_id=eq.${encodeURIComponent(backup.agencyId)}`;
  const existing = await requestRows(targetUrl, targetKey, `select=key&limit=1${agencyFilter}`, targetToken);
  if (existing.length) throw new Error("Cette agence contient deja des donnees dans le projet commun : import bloque.");
  if (flag !== "--apply") {
    console.log(`Controle OK : ${backup.rows.length} lignes pretes pour ${backup.agencyId}. Ajoutez --apply pour importer.`);
    process.exit(0);
  }
  for (let index = 0; index < backup.rows.length; index += 10) {
    const batch = backup.rows.slice(index, index + 10).map((row) => ({
      agency_id: backup.agencyId,
      key: row.key,
      value: row.value,
      updated_at: row.updated_at,
      expected_updated_at: null,
    }));
    const response = await fetch(`${targetUrl.replace(/\/$/, "")}/rest/v1/app_state?on_conflict=agency_id,key`, {
      method: "POST",
      headers: {
        ...apiHeaders(targetKey, targetToken),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`Import interrompu au lot ${index + 1} (${response.status}) : ${await response.text()}`);
  }
  const imported = await readAllRows(targetUrl, targetKey, agencyFilter, targetToken);
  const importedKeys = new Set(imported.map((row) => row.key));
  const importedByKey = new Map(imported.map((row) => [row.key, row]));
  const backupByKey = new Map(backup.rows.map((row) => [row.key, row]));
  if (imported.length !== backup.rows.length || keys.some((key) => !importedKeys.has(key)
      || rowDigest(backupByKey.get(key)) !== rowDigest(importedByKey.get(key)))) {
    throw new Error(`Verification echouee : ${imported.length}/${backup.rows.length} lignes retrouvees.`);
  }
  const readyResponse = await fetch(`${targetUrl.replace(/\/$/, "")}/rest/v1/app_state?on_conflict=agency_id,key`, {
    method: "POST",
    headers: {
      ...apiHeaders(targetKey, targetToken),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      agency_id: backup.agencyId,
      key: "quialakey-shared-ready-v1",
      value: { validatedAt: new Date().toISOString() },
    }),
  });
  if (!readyResponse.ok) throw new Error(`Validation de l'agence impossible (${readyResponse.status}).`);
  console.log(`Import verifie : ${imported.length} lignes pour ${backup.agencyId}.`);
}
