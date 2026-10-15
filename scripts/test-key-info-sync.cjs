const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const mergeCode = source.slice(source.indexOf("const keyInfoFields ="), source.indexOf("function mergeKeyCollections("));
const writeCode = source.slice(source.indexOf("async function writeConfirmedKeySlotsToCloud("), source.indexOf("function loadPendingCloudKeys("));
const pendingCode = source.slice(source.indexOf("function getComparableKeySlotValue("), source.indexOf("function waitForKeySlotRetry("));

async function checkEditDuringSync(editAt) {
  const storageKey = "keys";
  const keyId = "T3-14";
  const cloudKey = `${storageKey}::slot::${keyId}`;
  const makeKey = (owner) => ({ id: keyId, owner, property: "12 rue Test", sets: [{ id: "main", history: [], photo: "" }] });
  let remote = makeKey("ANCIEN");
  let local = makeKey("NOU");
  let version = 1;
  let reads = 0;
  let writes = 0;
  const pendingKeySlotWrites = new Map();
  const row = () => ({ key: cloudKey, value: structuredClone(remote), updated_at: `version-${version}` });
  const context = {
    console, Date, JSON, Map, Set, Object, Math, Promise, setTimeout,
    pendingKeySlotWrites,
    keySlotWriteMaxAttempts: 2,
    normalizeKey: (key) => structuredClone(key),
    normalizeCloudSlotKey: (savedRow) => structuredClone(savedRow.value),
    parseCloudObjectValue: (value) => structuredClone(value),
    getKeySlotCloudKey: () => cloudKey,
    getRecentKeySlotMemoryKey: () => cloudKey,
    recentlyClearedKeySlots: new Map(),
    recentlyForcedKeySlots: new Map(),
    dirtyKeySlots: new Map([[storageKey, new Set([keyId])]]),
    getDirtyKeySlotIds: () => new Set([keyId]),
    dirtyCloudKeys: new Set([storageKey]),
    failedCloudSyncKeys: new Set(),
    cloudRowVersions: new Map(),
    activeKeyInfoDraft: null,
    getRegistryConfig: () => ({ keysStorageKey: storageKey }),
    savePendingKeySlotWrites: () => {},
    savePendingCloudKeys: () => {},
    saveDirtyKeySlots: () => {},
    saveCloudRowVersions: () => {},
    clearKeyInfoSessionDraft: () => {},
    getCloudWritePayload: (key, value) => ({ key, value }),
    waitForKeySlotRetry: async () => {},
    scheduleCloudSyncHeartbeat: () => {},
    createKeySlotRecoveryBackup: async () => {},
    isStaleCloudWriteError: () => false,
    isKeyFilled: (key) => Boolean(key.owner),
    supabaseClient: {
      from: () => ({
        select: () => ({
          in: async () => {
            reads += 1;
            if (editAt === "read" && reads === 1) editAgain();
            return { data: [row()], error: null };
          },
        }),
        upsert: async (payloads) => {
          writes += 1;
          remote = structuredClone(payloads[0].value);
          version += 1;
          if (editAt === "write" && writes === 1) editAgain();
          return { error: null };
        },
      }),
    },
  };

  function editAgain() {
    local = makeKey("NOUVEAU");
    context.rememberPendingKeySlotWrite(storageKey, keyId, local);
  }

  vm.createContext(context);
  vm.runInContext(mergeCode + pendingCode + writeCode, context);
  assert.throws(() => context.mergeKeyRecord(makeKey("NOU"), makeKey("AUTRE"), {
    baseValue: makeKey("ANCIEN"),
  }), /Conflit de fiche/, "a real edit from another device must still be rejected");
  context.rememberPendingKeySlotWrite(storageKey, keyId, local, { baseValue: makeKey("ANCIEN") });
  const first = await context.writeConfirmedKeySlotsToCloud(storageKey, [keyId], new Map([[keyId, local]]));
  assert.equal(first.get(keyId).owner, "NOU");
  assert.equal(remote.owner, "NOU");
  assert.equal(pendingKeySlotWrites.get(cloudKey)?.value.owner, "NOUVEAU", "newer typing must remain queued");
  assert.equal(pendingKeySlotWrites.get(cloudKey)?.baseValue.owner, "NOU", "confirmed value must become the merge base");

  const second = await context.writeConfirmedKeySlotsToCloud(storageKey, [keyId], new Map([[keyId, local]]));
  assert.equal(second.get(keyId).owner, "NOUVEAU");
  assert.equal(remote.owner, "NOUVEAU");
  assert.equal(pendingKeySlotWrites.has(cloudKey), false);
}

Promise.all([checkEditDuringSync("read"), checkEditDuringSync("write")])
  .then(() => console.log("Owner edits made during cloud sync remain queued and are confirmed."))
  .catch((error) => { console.error(error); process.exitCode = 1; });
