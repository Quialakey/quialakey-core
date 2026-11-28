import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), process.argv[2] || "agency.json");
const outputDirectory = resolve(process.cwd(), process.argv[3] || ".");
const source = JSON.parse(await readFile(configPath, "utf8"));

const agencyId =
  String(source.agencyId || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "";
const agencyName = String(source.agencyName || "").trim();
const supabaseUrl = String(source.supabaseUrl || "").trim().replace(/\/$/, "");
const supabasePublishableKey = String(source.supabasePublishableKey || "").trim();
const sharedProjectMode = source.sharedProjectMode === true;
const agencyLoginCode = String(source.agencyLoginCode || "").trim().toUpperCase();
const agencyLogins = source.agencyLogins || null;

if (!agencyId) throw new Error("agencyId est obligatoire.");
if (!agencyName) throw new Error("agencyName est obligatoire.");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error("supabaseUrl doit etre une URL de projet Supabase valide.");
}
if (!supabasePublishableKey.startsWith("sb_publishable_") && !supabasePublishableKey.startsWith("eyJ")) {
  throw new Error("Utilisez uniquement la Publishable key ou l'ancienne cle anon.");
}
if (sharedProjectMode && !agencyLogins && !/^[A-Z0-9-]{4,32}$/.test(agencyLoginCode)) {
  throw new Error("agencyLoginCode doit contenir 4 a 32 lettres, chiffres ou tirets.");
}
if (agencyLogins && (!sharedProjectMode || typeof agencyLogins !== "object" || Array.isArray(agencyLogins)
  || Object.keys(agencyLogins).length < 2 || Object.entries(agencyLogins).some(([code, login]) =>
    !/^[A-Z0-9-]{4,32}$/.test(code)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(login?.agencyId || "")
    || !String(login?.agencyName || "").trim()))) {
  throw new Error("agencyLogins doit contenir des codes, identifiants et noms valides.");
}

const publicConfig = {
  agencyId,
  agencyName,
  supabaseUrl,
  supabasePublishableKey,
  migrateLegacyStorage: source.migrateLegacyStorage === true,
  sharedProjectMode,
  ...(sharedProjectMode && agencyLogins ? { agencyLogins } : {}),
  ...(sharedProjectMode && !agencyLogins ? { agencyLoginCode } : {}),
};
const configContents = `window.QUIALAKEY_CONFIG = Object.freeze(${JSON.stringify(publicConfig, null, 2)});\n`;
await writeFile(resolve(outputDirectory, "agency-config.js"), configContents, "utf8");

const manifestPath = resolve(outputDirectory, "manifest.webmanifest");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.name = `Quialakey - ${agencyName}`;
manifest.short_name = "Quialakey";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Configuration generee pour ${agencyName} (${agencyId}).`);
