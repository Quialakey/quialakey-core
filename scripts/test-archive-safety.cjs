const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const archiveCode = source.slice(source.indexOf('const pendingArchiveSlots ='), source.indexOf('async function reserveSelectedSet('))
  + source.slice(source.indexOf('async function archiveSelectedKey('), source.indexOf('function openContactsPanel('));

async function check(registry, action, failure) {
  const events = [];
  const storage = new Map();
  const original = { id: 'T2-4', category: 'T2', number: 4, owner: 'ASTIER', property: 'Adresse test', sets: [{
    id: 'main', status: 'out', holderReservationId: 'reservation-test',
    reservations: [{ id: 'reservation-test' }], history: [{ id: 'previous', type: 'reserved' }],
  }] };
  let remote = [{ id: 'other-device-archive', key: { owner: 'AUTRE' } }];
  let reads = 0;
  let writes = 0;
  const context = {
    console: { warn() {} }, Date, Intl, JSON, Map, Set, Object,
    activeRegistry: registry, selectedArchiveRecord: null, selectedId: 'T2-4', selectedSetId: 'main',
    keys: [structuredClone(original)], archives: [], pendingCloudSync: Promise.resolve(), cloudRowVersions: new Map(),
    registryConfig: { location: { keysStorageKey: 'location', archivesStorageKey: 'location-archives', archiveActionLabel: 'Loue' }, transaction: { keysStorageKey: 'transaction', archivesStorageKey: 'transaction-archives', archiveActionLabel: 'Compromis' } },
    movementPhoneInput: { value: '0102030405' }, movementCompanyInput: { value: '' }, movementNoteInput: { value: '' },
    getSelectedKey: () => context.keys[0], getSelectedSet: (key) => key.sets[0], getSetForReservation: (key) => key?.sets[0],
    getRegistryConfig: () => context.registryConfig[context.activeRegistry],
    ensureMovementActor: () => true, ensureCompletePhoneNumber: () => true,
    getTypedMovementActor: () => ({ person: 'Intervenant', company: '', phone: '0102030405' }),
    confirm: () => true, promptMovementSignature: async () => 'signature-test', promptCompromiseDate: async () => '2026-09-21',
    rememberUndoStep() {}, createHistoryId: () => 'new-history', getMovementDateText: () => '21/09/2026 17:00',
    getInlineReservationComment: () => '', formatSentenceStart: (s) => s, formatCompanyName: (s) => s, formatPhoneNumber: (s) => s,
    getMovementPersonInputName: () => 'Intervenant', keyLabel: () => 'T2 #4', formatDateOnly: (s) => s,
    syncStorageKeyToCloud: async () => {}, hasPendingStorageKeyChange: () => failure === 'pending',
    parseStorageValue: JSON.parse,
    isStaleCloudWriteError: (error) => error.message === 'stale',
    setRuntimeStorageValue: (key, value) => storage.set(key, value),
    saveCloudRowVersions() {}, scheduleCloudSyncHeartbeat() {},
    loadArchives: () => JSON.parse(storage.get(`${registry}-archives`)),
    alert: (message) => events.push(['alert', message]),
    clearActiveKeySlotForSync: () => { events.push(['clear']); context.keys[0] = { ...original, owner: '', sets: [] }; },
    logActivity: () => events.push(['log']), saveKeys: () => events.push(['saveKeys']),
    finishKeyControlAction: async () => events.push(['finish']),
    upsertCloudRow: async (key, records) => {
      writes++;
      assert.equal(key, `${registry}-archives`);
      events.push(['write']);
      if (failure === 'write') return { error: new Error('offline') };
      if (failure === 'conflict' && writes === 1) {
        remote.push({ id: 'concurrent', key: { owner: 'CONCURRENT' } });
        return { error: new Error('stale') };
      }
      remote = JSON.parse(JSON.stringify(records));
      return { error: null };
    },
  };
  context.supabaseClient = failure === 'no-client' ? null : { from: () => ({
    select() { return this; }, eq() { return this; }, async maybeSingle() {
      reads++;
      if (failure === 'read' || (failure === 'confirmation' && writes)) return { error: new Error('offline') };
      if (writes && failure !== 'conflict') {
        if (failure === 'switch') context.activeRegistry = registry === 'location' ? 'transaction' : 'location';
        if (failure === 'edit') context.keys[0].owner = 'MODIFIED';
      }
      events.push([writes ? 'confirm' : 'read']);
      // Model JSONB reordering to exercise content verification.
      const canonical = JSON.parse(context.serializeArchiveForComparison(remote));
      if (failure === 'missing' && writes) canonical.shift();
      if (failure === 'corrupt' && writes) canonical[0].key.owner = 'WRONG';
      return { data: { value: canonical, updated_at: `version-${reads}` }, error: null };
    },
  }) };
  vm.createContext(context);
  vm.runInContext(archiveCode, context);
  if (action === 'reservation') await context.archiveReservationKey('reservation-test');
  else await context.archiveSelectedKey(action);
  const success = !failure || failure === 'conflict';
  assert.equal(events.some(([event]) => event === 'clear'), success, `${registry}/${action}/${failure}`);
  if (success) {
    assert.ok(events.findIndex(([event]) => event === 'clear') > events.findIndex(([event]) => event === 'confirm'));
    assert.ok(remote.some((item) => item.key.owner === 'ASTIER'));
    assert.ok(remote.some((item) => item.id === 'other-device-archive'));
    if (failure === 'conflict') assert.ok(remote.some((item) => item.id === 'concurrent'));
    const archived = remote.find((item) => item.key.owner === 'ASTIER');
    assert.equal(archived.key.sets[0].history[0].signature, 'signature-test');
    assert.equal(archived.key.sets[0].history[1].id, 'previous');
  } else {
    assert.notEqual(context.keys[0].owner, '');
    assert.ok(events.some(([event]) => event === 'alert'));
  }
}

(async () => {
  let count = 0;
  for (const registry of ['location', 'transaction']) {
    for (const action of ['reservation', 'removed', 'rented']) {
      for (const failure of ['', 'read', 'write', 'confirmation', 'missing', 'corrupt', 'pending', 'no-client', 'switch', 'edit', 'conflict']) {
        await check(registry, action, failure);
        count++;
      }
    }
  }
  console.log(`${count} archive safety scenarios passed.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
