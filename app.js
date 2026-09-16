const defaultCategoryLabels = ["T1", "T2", "T3", "T4+", "Maison", "Autre"];
const defaultCategoryPrefixes = {
  T1: "T1",
  T2: "T2",
  T3: "T3",
  "T4+": "T4+",
  Maison: "M",
  Autre: "A",
};
const defaultSlotsPerCategory = 20;
const defaultCasesPerLine = defaultSlotsPerCategory / 2;
const defaultAddressReplacements = [
  { id: "avenue", word: "Avenue", replacement: "Av." },
  { id: "boulevard", word: "Boulevard", replacement: "Blv." },
  { id: "place", word: "Place", replacement: "Pl." },
  { id: "route", word: "Route", replacement: "Rte" },
  { id: "allee", word: "All\u00e9e", replacement: "All." },
  { id: "allee-sans-accent", word: "allee", replacement: "All." },
  { id: "chemin", word: "Chemin", replacement: "Ch." },
  { id: "impasse", word: "Impasse", replacement: "Imp." },
  { id: "passage", word: "Passage", replacement: "Pas." },
  { id: "esplanade", word: "Esplanade", replacement: "Esp." },
];
const rawAgencyConfig = globalThis.QUIALAKEY_CONFIG || {};
const agencyId =
  String(rawAgencyConfig.agencyId || "default-agency")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default-agency";
const configuredAgencyName = String(rawAgencyConfig.agencyName || "Agence").trim() || "Agence";
const shouldMigrateLegacyStorage = rawAgencyConfig.migrateLegacyStorage === true;
const browserStorageNamespace = `quialakey:${agencyId}:`;
const supabaseUrl = String(rawAgencyConfig.supabaseUrl || "").trim();
const supabasePublishableKey = String(rawAgencyConfig.supabasePublishableKey || "").trim();
const supabaseClient = createSupabaseClient();
const appBuildVersion = "20260916-2";
const appBuildVersionStorageKey = "cles-app-build-version-v1";
const appBuildReloadStorageKey = `${browserStorageNamespace}cles-app-build-reload-v1`;
const appBuildVersionUrl = "app-version.json";
const accessUnlockedStorageKey = "quialakey-access-unlocked-v1";
const defaultAccessCode = "0000";
const registryStorageKey = "cles-location-active-registry-v1";
const sharedContactsStorageKey = "cles-location-intervenants-v1";
const appActivityLogStorageKey = "cles-global-activity-v1";
const hiddenGlobalHistoryStorageKey = "cles-hidden-global-history-v1";
const deviceNameStorageKey = "cles-device-name-v1";
const tileViewStorageKey = "cles-tile-view-mode-v1";
const keyStatusFilterStorageKey = "cles-key-status-filter-v1";
const tableSettingsStorageKey = "cles-table-settings-v1";
const photoMaxSize = 560;
const photoJpegQuality = 0.36;
const photoMaxDataUrlLength = 260000;
const photoOptimizationStorageKey = "cles-photo-optimization-560-v2";
const cloudVersionsStorageKey = "cles-cloud-row-versions-v1";
const pendingCloudKeysStorageKey = "cles-pending-cloud-keys-v1";
const dirtyKeySlotsStorageKey = "cles-dirty-key-slots-v1";
const pendingKeySlotWritesStorageKey = "cles-pending-key-slot-writes-v1";
const syncMetadataVersionStorageKey = "cles-sync-metadata-version-v1";
const supabaseProjectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] || agencyId;
  } catch {
    return agencyId;
  }
})();
const syncMetadataVersion = `20260916-2-${supabaseProjectRef}`;
const cloudSyncHeartbeatStorageKey = "cles-cloud-sync-heartbeat-v1";
const lastLocalEditStorageKey = "cles-last-local-edit-v1";
const keySlotCloudSeparator = "::slot::";
const automaticBackupKeyPrefix = "cles-auto-backup-";
const keySlotRecoveryBackupPrefix = "cles-key-recovery-v1::";
const keySlotRecoveryRetentionCount = 5;
const automaticBackupsEnabled = false;
const automaticBackupRetentionCount = 14;
const automaticBackupHour = 12;
const automaticBackupMinute = 0;
const cloudPollIntervalMs = 900;
const mobileCloudPollIntervalMs = 900;
const cloudSafetyRefreshIntervalMs = 10 * 1000;
const fullCloudRefreshIntervalMs = 60 * 1000;
const cloudInteractionRefreshThrottleMs = 700;
const cloudWakeRefreshDelays = [0, 800, 2500];
const initialCloudLoadRetryDelays = [0, 700, 1800, 3500];
const cloudInactivityTimeoutMs = 3 * 60 * 1000;
const cloudReadRequestTimeoutMs = 6 * 1000;
const cloudWriteRequestTimeoutMs = 12 * 1000;
const cloudWriteDebounceMs = 300;
const keySlotWriteMaxAttempts = 8;
const keySlotWriteRetryBaseDelayMs = 90;
const pendingLocalEditGraceMs = 12 * 1000;
const recentKeySlotMemoryMs = 12 * 1000;
const runtimeStorageFallback = new Map();
let isApplyingCloudState = false;
let isResettingTableData = false;
const browserStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

function getScopedBrowserStorageKey(key) {
  return `${browserStorageNamespace}${key}`;
}

function getRuntimeStorageValue(key) {
  if (runtimeStorageFallback.has(key)) return runtimeStorageFallback.get(key);
  try {
    return browserStorage?.getItem(getScopedBrowserStorageKey(key)) ?? null;
  } catch {
    return null;
  }
}

function setRuntimeStorageValue(key, value) {
  const stringValue = String(value);
  runtimeStorageFallback.set(key, stringValue);
  try {
    browserStorage?.setItem(getScopedBrowserStorageKey(key), stringValue);
    return true;
  } catch (error) {
    if (isApplyingCloudState && browserStorage) {
      try {
        const scopedKey = getScopedBrowserStorageKey(key);
        browserStorage.removeItem(scopedKey);
        browserStorage.setItem(scopedKey, stringValue);
        return true;
      } catch {
        // La copie Supabase reste disponible en mémoire pour cette session.
      }
    }
    console.warn("Local storage fallback", key, error.message);
    return false;
  }
}

function removeRuntimeStorageValue(key) {
  runtimeStorageFallback.delete(key);
  try {
    browserStorage?.removeItem(getScopedBrowserStorageKey(key));
  } catch {}
}

function getRuntimeStorageKeys() {
  const keys = new Set(runtimeStorageFallback.keys());
  try {
    Object.keys(browserStorage || {}).forEach((key) => {
      if (key.startsWith(browserStorageNamespace)) keys.add(key.slice(browserStorageNamespace.length));
    });
  } catch {}
  return [...keys];
}

function migrateLegacyBrowserStorage() {
  if (!shouldMigrateLegacyStorage || !browserStorage) return;
  const migrationMarker = getScopedBrowserStorageKey("legacy-storage-migrated-v1");
  try {
    if (browserStorage.getItem(migrationMarker) === "done") return;

    Object.keys(browserStorage).forEach((legacyKey) => {
      if (!legacyKey.startsWith("cles-") && legacyKey !== "quialakey-access-unlocked-v1") return;
      const scopedKey = getScopedBrowserStorageKey(legacyKey);
      if (browserStorage.getItem(scopedKey) !== null) {
        browserStorage.removeItem(legacyKey);
        return;
      }

      const legacyValue = browserStorage.getItem(legacyKey);
      browserStorage.removeItem(legacyKey);
      try {
        browserStorage.setItem(scopedKey, legacyValue);
      } catch {
        try {
          browserStorage.setItem(legacyKey, legacyValue);
        } catch {}
      }
    });
    browserStorage.setItem(migrationMarker, "done");
  } catch (error) {
    console.warn("Migration du stockage local incomplète", error.message);
  }
}

migrateLegacyBrowserStorage();

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function createCategoryId(label = "Catégorie") {
  const slug =
    removeDiacritics(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "categorie";
  return `${slug}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

function createReplacementId() {
  return `replacement-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

function getDefaultTableSettings() {
  return {
    agencyName: configuredAgencyName,
    categories: defaultCategoryLabels.map((label) => ({
      id: label,
      label,
      prefix: defaultCategoryPrefixes[label] || label,
      aliases: [],
    })),
    slotsPerCategory: defaultSlotsPerCategory,
    casesPerLine: defaultCasesPerLine,
    addressReplacements: defaultAddressReplacements.map((item) => ({ ...item })),
    saleCelebrationEnabled: true,
    accessCode: defaultAccessCode,
    accessLockEnabled: false,
    accessLockVersion: 1,
  };
}

function sortAddressReplacements(replacements) {
  return [...replacements].sort((first, second) =>
    first.word.localeCompare(second.word, "fr", { sensitivity: "base" }),
  );
}

function normalizeCategorySetting(category, index, usedIds) {
  const fallbackLabel = defaultCategoryLabels[index] || `Catégorie ${index + 1}`;
  const rawLabel = typeof category === "string" ? category : category?.label;
  const label = String(rawLabel || fallbackLabel).trim() || fallbackLabel;
  const preferredDefaultId = defaultCategoryLabels.includes(label) ? label : "";
  let id = String((typeof category === "object" && category?.id) || preferredDefaultId || "").trim();
  if (!id || usedIds.has(id)) id = createCategoryId(label);
  usedIds.add(id);
  const hasStoredPrefix = typeof category === "object" && Object.prototype.hasOwnProperty.call(category, "prefix");
  const prefix = String(hasStoredPrefix ? category.prefix ?? "" : defaultCategoryPrefixes[label] || label).trim();
  const aliases = Array.isArray(category?.aliases)
    ? category.aliases.map((alias) => String(alias || "").trim()).filter(Boolean)
    : [];
  return { id, label, prefix, aliases: [...new Set(aliases.filter((alias) => alias !== label && alias !== prefix))] };
}

function normalizeAddressReplacement(item) {
  const word = formatSentenceStart(String(item?.word || item?.from || "")).trim();
  const replacement = formatSentenceStart(String(item?.replacement || item?.to || "")).trim();
  if (!word || !replacement) return null;
  return {
    id: String(item?.id || createReplacementId()),
    word,
    replacement,
  };
}

function normalizeEvenSlotCount(value, fallback = defaultSlotsPerCategory) {
  const parsed = Number.parseInt(value, 10);
  const clamped = Math.max(10, Math.min(60, Number.isFinite(parsed) ? parsed : fallback));
  return clamped % 2 === 0 ? clamped : Math.min(60, clamped + 1);
}

function normalizeCasesPerLine(value, slotsPerCategory = defaultSlotsPerCategory, fallback = defaultCasesPerLine) {
  const parsed = Number.parseInt(value, 10);
  const safeFallback = Math.max(1, Math.min(slotsPerCategory, fallback));
  return Math.max(1, Math.min(slotsPerCategory, Number.isFinite(parsed) ? parsed : safeFallback));
}

function normalizeTableSettings(value) {
  const parsed = typeof value === "string" ? parseStorageValue(value) : value;
  const fallback = getDefaultTableSettings();
  const source = parsed && typeof parsed === "object" ? parsed : fallback;
  const usedIds = new Set();
  const rawCategories = Array.isArray(source.categories) ? source.categories : fallback.categories;
  const categories = rawCategories
    .slice(0, 16)
    .map((category, index) => normalizeCategorySetting(category, index, usedIds))
    .filter((category) => category.label);
  const slotsPerCategory = normalizeEvenSlotCount(source.slotsPerCategory, fallback.slotsPerCategory);
  const legacyCasesPerLine = Math.max(1, Math.ceil(slotsPerCategory / 2));
  const casesPerLine = normalizeCasesPerLine(source.casesPerLine, slotsPerCategory, legacyCasesPerLine);
  const normalizedAddressReplacements = (Array.isArray(source.addressReplacements) ? source.addressReplacements : fallback.addressReplacements)
    .map(normalizeAddressReplacement)
    .filter(Boolean);
  const hasUnaccentedAllee = normalizedAddressReplacements.some(
    (item) => item.word.toLocaleLowerCase("fr-FR") === "allee",
  );
  if (!hasUnaccentedAllee) {
    normalizedAddressReplacements.push({ id: "allee-sans-accent", word: "allee", replacement: "All." });
  }
  const addressReplacements = sortAddressReplacements(normalizedAddressReplacements);
  const saleCelebrationEnabled = source.saleCelebrationEnabled !== false;
  const agencyName = String(source.agencyName || fallback.agencyName).trim() || fallback.agencyName;
  const accessCode = String(source.accessCode || fallback.accessCode || defaultAccessCode).trim() || defaultAccessCode;
  const accessLockEnabled = source.accessLockEnabled === true;
  const accessLockVersion = Number.isFinite(Number(source.accessLockVersion))
    ? Number(source.accessLockVersion)
    : fallback.accessLockVersion;

  return {
    agencyName,
    categories: categories.length ? categories : fallback.categories,
    slotsPerCategory,
    casesPerLine,
    addressReplacements,
    saleCelebrationEnabled,
    accessCode,
    accessLockEnabled,
    accessLockVersion,
  };
}

function loadTableSettings() {
  return normalizeTableSettings(getRuntimeStorageValue(tableSettingsStorageKey));
}

function getTableCategories() {
  return tableSettings?.categories?.length ? tableSettings.categories : getDefaultTableSettings().categories;
}

function getVisibleCategoryIds() {
  return new Set(getTableCategories().map((category) => category.id));
}

function getSlotsPerCategory() {
  return tableSettings?.slotsPerCategory || defaultSlotsPerCategory;
}

function getCasesPerLine() {
  return tableSettings?.casesPerLine || defaultCasesPerLine;
}

function getAddressReplacements() {
  return tableSettings?.addressReplacements?.length ? tableSettings.addressReplacements : defaultAddressReplacements;
}

function getCategorySetting(categoryId) {
  return getTableCategories().find((category) => category.id === categoryId || category.label === categoryId);
}

function getAllKnownCategorySettings() {
  const known = new Map();
  getDefaultTableSettings().categories.forEach((category) => known.set(category.id, category));
  getTableCategories().forEach((category) => known.set(category.id, category));
  return [...known.values()];
}

function getCategoryLabel(categoryId) {
  return getCategorySetting(categoryId)?.label || categoryId;
}

function getCategoryCasePrefix(categoryId) {
  const category = getCategorySetting(categoryId);
  if (!category) return categoryId;
  return Object.prototype.hasOwnProperty.call(category, "prefix")
    ? String(category.prefix || "")
    : category.label || categoryId;
}

function getCategoryAliases(category) {
  return [...new Set([category.prefix, category.label, category.id, ...(category.aliases || [])].filter(Boolean))];
}

function getCategoryIdFromLabel(label) {
  const normalizedLabel = String(label || "").trim().toLocaleLowerCase("fr-FR");
  return (
    getAllKnownCategorySettings().find((category) =>
      getCategoryAliases(category).some((alias) => alias.toLocaleLowerCase("fr-FR") === normalizedLabel),
    )?.id || ""
  );
}

function parseKeyLabelFromTitle(title) {
  const text = String(title || "").trim();
  const bareMatch = text.match(/^#(\d+)/u);
  const prefixlessCategories = getAllKnownCategorySettings().filter(
    (category) => Object.prototype.hasOwnProperty.call(category, "prefix") && !String(category.prefix || "").trim(),
  );
  if (bareMatch && prefixlessCategories.length === 1) {
    const category = prefixlessCategories[0];
    return {
      id: `${category.id}-${Number(bareMatch[1])}`,
      category: category.id,
      number: Number(bareMatch[1]),
      text: bareMatch[0],
    };
  }
  const candidates = getAllKnownCategorySettings()
    .flatMap((category) => getCategoryAliases(category).map((alias) => ({ alias, id: category.id })))
    .sort((first, second) => second.alias.length - first.alias.length);

  for (const candidate of candidates) {
    const match = text.match(new RegExp(`^(${escapeRegExp(candidate.alias)})\\s+#(\\d+)`, "iu"));
    if (match) {
      return {
        id: `${candidate.id}-${Number(match[2])}`,
        category: candidate.id,
        number: Number(match[2]),
        text: match[0],
      };
    }
  }
  return null;
}

function createSupabaseClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    console.warn("Configuration Supabase manquante pour cette agence.");
    return null;
  }
  return createRestSupabaseClient(supabaseUrl, supabasePublishableKey);
}

function createRestSupabaseClient(projectUrl, publishableKey) {
  const restBaseUrl = `${projectUrl.replace(/\/$/, "")}/rest/v1`;
  const baseHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
  };

  class RestQuery {
    constructor(table) {
      this.table = table;
      this.method = "GET";
      this.params = new URLSearchParams();
      this.body = null;
      this.prefer = "";
      this.readSingle = false;
    }

    select(columns = "*") {
      this.method = "GET";
      this.params.set("select", columns);
      return this;
    }

    in(column, values) {
      const quotedValues = (Array.isArray(values) ? values : [])
        .map((value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");
      this.params.set(column, `in.(${quotedValues})`);
      return this;
    }

    like(column, pattern) {
      this.params.set(column, `like.${pattern}`);
      return this;
    }

    eq(column, value) {
      this.params.set(column, `eq.${value}`);
      return this;
    }

    gt(column, value) {
      this.params.set(column, `gt.${value}`);
      return this;
    }

    order(column, options = {}) {
      this.params.set("order", `${column}.${options.ascending === false ? "desc" : "asc"}`);
      return this;
    }

    limit(count) {
      this.params.set("limit", String(count));
      return this;
    }

    upsert(value) {
      this.method = "POST";
      this.body = JSON.stringify(value);
      this.params.set("on_conflict", "key");
      this.prefer = "resolution=merge-duplicates,return=representation";
      return this.execute();
    }

    update(value) {
      this.method = "PATCH";
      this.body = JSON.stringify(value);
      this.prefer = "return=representation";
      return this;
    }

    delete() {
      this.method = "DELETE";
      this.prefer = "return=minimal";
      return this;
    }

    maybeSingle() {
      this.readSingle = true;
      return this.execute();
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    async execute() {
      if (isCloudSleeping || isAppInBackground()) {
        return {
          data: null,
          error: {
            message: isCloudSleeping ? "Synchronisation Supabase en veille." : "Synchronisation Supabase suspendue en arrière-plan.",
            sleeping: isCloudSleeping,
            background: isAppInBackground(),
          },
        };
      }
      const query = this.params.toString();
      const controller = new AbortController();
      const timeoutMs = this.method === "GET" ? cloudReadRequestTimeoutMs : cloudWriteRequestTimeoutMs;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${restBaseUrl}/${this.table}${query ? `?${query}` : ""}`, {
          method: this.method,
          headers: {
            ...baseHeaders,
            Accept: "application/json",
            ...(this.body ? { "Content-Type": "application/json" } : {}),
            ...(this.prefer ? { Prefer: this.prefer } : {}),
          },
          ...(this.body ? { body: this.body } : {}),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = response.statusText || "Supabase request failed";
          try {
            const payload = await response.json();
            message = payload?.message || payload?.details || message;
          } catch {}
          return { data: null, error: { message } };
        }

        if (response.status === 204) return { data: null, error: null };
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        return { data: this.readSingle ? (Array.isArray(data) ? data[0] || null : data) : data, error: null };
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        return {
          data: null,
          error: { message: timedOut ? "Supabase ne repond pas dans le delai attendu." : error.message },
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  return {
    from(table) {
      return new RestQuery(table);
    },
  };
}

const registryConfig = {
  location: {
    title: "LOCATION",
    toggleLabel: "BASCULER VERS TABLEAU TRANSACTION",
    keysStorageKey: "cles-immobilieres-v1",
    archivesStorageKey: "cles-location-archives-v1",
    archiveActionLabel: "Loué",
    rentedArchiveTitle: "Biens loués",
    rentedArchiveEmpty: "Aucun bien loué.",
    rentedArchiveText: "Loué",
  },
  transaction: {
    title: "TRANSACTION",
    toggleLabel: "BASCULER VERS TABLEAU LOCATION",
    keysStorageKey: "cles-transaction-v1",
    archivesStorageKey: "cles-transaction-archives-v1",
    archiveActionLabel: "Compromis",
    rentedArchiveTitle: "Biens compromis",
    rentedArchiveEmpty: "Aucun bien en compromis.",
    rentedArchiveText: "Compromis",
  },
};

const keySetOptions = [
  { id: "main", label: "Jeu 1" },
  { id: "double", label: "Jeu 2" },
  { id: "triple", label: "Jeu 3" },
  { id: "quad", label: "Jeu 4" },
];

const accessLock = document.querySelector("#accessLock");
const cloudSleepOverlay = document.querySelector("#cloudSleepOverlay");
const accessForm = document.querySelector("#accessForm");
const accessAgencyTitle = document.querySelector("#accessAgencyTitle");
const accessCodeInput = document.querySelector("#accessCodeInput");
const accessError = document.querySelector("#accessError");
const forgotPasswordBtn = document.querySelector("#forgotPasswordBtn");
const forgotPasswordMessage = document.querySelector("#forgotPasswordMessage");
const appTitle = document.querySelector("#appTitle");
const appTitleText = document.querySelector(".app-title-text");
const agencyNameLabel = document.querySelector("#agencyNameLabel");
const registryToggleBtn = document.querySelector("#registryToggleBtn");
const topActions = document.querySelector(".top-actions");
const grid = document.querySelector("#keyGrid");
const detailPanel = document.querySelector("#detailPanel");
const form = document.querySelector("#keyForm");
const selectedTitle = document.querySelector("#selectedTitle");
const statusPill = document.querySelector("#statusPill");
const keySetCountSelect = document.querySelector("#keySetCountSelect");
const propertyInput = document.querySelector("#propertyInput");
const postalCodeInput = document.querySelector("#postalCodeInput");
const cityInput = document.querySelector("#cityInput");
const ownerInput = document.querySelector("#ownerInput");
const ownerFirstNameInput = document.querySelector("#ownerFirstNameInput");
const notesInput = document.querySelector("#notesInput");
const keyDetailsHeading = document.querySelector("#keyDetailsHeading");
const keyDetailsToggleBtn = document.querySelector("#keyDetailsToggleBtn");
const keyDetailsContent = document.querySelector("#keyDetailsContent");
const keySetPhotoList = document.querySelector("#keySetPhotoList");
const keySetSelect = document.querySelector("#keySetSelect");
const activeReservationPanel = document.querySelector("#activeReservationPanel");
const contactSelect = document.querySelector("#contactSelect");
const movementPersonInput = document.querySelector("#movementPersonInput");
const movementNameInput = document.querySelector("#movementNameInput");
const movementCompanyInput = document.querySelector("#movementCompanyInput");
const movementPhoneInput = document.querySelector("#movementPhoneInput");
const movementNoteInput = document.querySelector("#movementNoteInput");
const checkoutBtn = document.querySelector("#checkoutBtn");
const checkinBtn = document.querySelector("#checkinBtn");
const rentedBtn = document.querySelector("#rentedBtn");
const removedBtn = document.querySelector("#removedBtn");
const reservedBtn = document.querySelector("#reservedBtn");
const transferKeyBtn = document.querySelector("#transferKeyBtn");
const exportKeyCsvBtn = document.querySelector("#exportKeyCsvBtn");
const signatureCanvas = document.querySelector("#signatureCanvas");
const clearSignatureBtn = document.querySelector("#clearSignatureBtn");
const historyList = document.querySelector("#historyList");
const keyHistoryToggleBtn = document.querySelector("#keyHistoryToggleBtn");
const searchInput = document.querySelector("#searchInput");
const textViewBtn = document.querySelector("#textViewBtn");
const photoViewBtn = document.querySelector("#photoViewBtn");
const keyStatusFilterButtons = [...document.querySelectorAll(".key-status-filter-button")];
const statusFilter = document.querySelector("#statusFilter");
const closePanelBtn = document.querySelector("#closePanelBtn");
const saleCelebration = document.querySelector("#saleCelebration");
const celebrationSky = saleCelebration?.querySelector(".celebration-sky");
const compromisesTabBtn = document.querySelector("#compromisesTabBtn");
const compromisesPanel = document.querySelector("#compromisesPanel");
const closeCompromisesBtn = document.querySelector("#closeCompromisesBtn");
const compromisesList = document.querySelector("#compromisesList");
const archivesTabBtn = document.querySelector("#archivesTabBtn");
const archivesPanel = document.querySelector("#archivesPanel");
const closeArchivesBtn = document.querySelector("#closeArchivesBtn");
const archiveSearchInput = document.querySelector("#archiveSearchInput");
const rentedArchiveSection = document.querySelector("#rentedArchiveSection");
const removedArchiveSection = document.querySelector("#removedArchiveSection");
const authenticatedArchiveSection = document.querySelector("#authenticatedArchiveSection");
const rentedArchiveTitle = document.querySelector("#rentedArchiveTitle");
const rentedList = document.querySelector("#rentedList");
const removedList = document.querySelector("#removedList");
const authenticatedList = document.querySelector("#authenticatedList");
const contactsTabBtn = document.querySelector("#contactsTabBtn");
const contactsPanel = document.querySelector("#contactsPanel");
const closeContactsBtn = document.querySelector("#closeContactsBtn");
const contactForm = document.querySelector("#contactForm");
const contactFirstNameLabel = document.querySelector("#contactFirstNameLabel");
const contactFirstNameInput = document.querySelector("#contactFirstNameInput");
const contactNameLabel = document.querySelector("#contactNameLabel");
const contactNameInput = document.querySelector("#contactNameInput");
const contactCompanyLabel = document.querySelector("#contactCompanyLabel");
const contactCompanyInput = document.querySelector("#contactCompanyInput");
const contactPhoneInput = document.querySelector("#contactPhoneInput");
const addContactBtn = document.querySelector("#addContactBtn");
const contactsList = document.querySelector("#contactsList");
const contactTabs = [...document.querySelectorAll(".contact-tab")];
const undoBtn = document.querySelector("#undoBtn");
const historyDataBtn = document.querySelector("#historyDataBtn");
const registryHistoryDataBtn = document.querySelector("#registryHistoryDataBtn");
const registryHistoryDataLabel = document.querySelector("#registryHistoryDataLabel");
const settingsDataBtn = document.querySelector("#settingsDataBtn");
const settingsPanel = document.querySelector("#settingsPanel");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const settingsForm = document.querySelector("#settingsForm");
const settingsAgencyNameInput = document.querySelector("#settingsAgencyNameInput");
const settingsRowCountInput = document.querySelector("#settingsRowCountInput");
const settingsCasesPerLineInput = document.querySelector("#settingsCasesPerLineInput");
const settingsSlotsInput = document.querySelector("#settingsSlotsInput");
const settingsCategoriesList = document.querySelector("#settingsCategoriesList");
const settingsReplacementsList = document.querySelector("#settingsReplacementsList");
const settingsOrganizationContent = document.querySelector("#settingsOrganizationContent");
const toggleSettingsOrganizationBtn = document.querySelector("#toggleSettingsOrganizationBtn");
const toggleSettingsReplacementsBtn = document.querySelector("#toggleSettingsReplacementsBtn");
const addSettingsReplacementBtn = document.querySelector("#addSettingsReplacementBtn");
const settingsCelebrationInput = document.querySelector("#settingsCelebrationInput");
const settingsAccessLockInput = document.querySelector("#settingsAccessLockInput");
const settingsAccessCodeText = document.querySelector("#settingsAccessCodeText");
const editSettingsAccessCodeBtn = document.querySelector("#editSettingsAccessCodeBtn");
const resetTablesBtn = document.querySelector("#resetTablesBtn");
const globalHistoryPanel = document.querySelector("#globalHistoryPanel");
const globalHistoryEyebrow = document.querySelector("#globalHistoryEyebrow");
const globalHistoryTitle = document.querySelector("#globalHistoryTitle");
const closeGlobalHistoryBtn = document.querySelector("#closeGlobalHistoryBtn");
const globalHistoryList = document.querySelector("#globalHistoryList");
const exportFilledDataBtn = document.querySelector("#exportFilledDataBtn");
const backupDataBtn = document.querySelector("#backupDataBtn");
const savedBackupsBtn = document.querySelector("#savedBackupsBtn");
const savedBackupsPanel = document.querySelector("#savedBackupsPanel");
const closeSavedBackupsBtn = document.querySelector("#closeSavedBackupsBtn");
const savedBackupsList = document.querySelector("#savedBackupsList");
const importDataBtn = document.querySelector("#importDataBtn");
const backupFileInput = document.querySelector("#backupFileInput");

let tableSettings = loadTableSettings();
let hasResolvedInitialAccessSettings = getRuntimeStorageValue(tableSettingsStorageKey) !== null;
let settingsDraft = null;
let activeRegistry = loadActiveRegistry();
let shouldSanitizeCachedArchivedResidues = true;
let keys = loadKeys();
let archives = loadArchives();
let contacts = loadContacts();
let selectedId = null;
let selectedSetId = "main";
let selectedArchiveRecord = null;
let draggedKeyId = null;
let suppressKeyTileClickUntil = 0;
let activeContactType = "internal";
let isSigning = false;
let hasSignature = false;
let contactsCloseTimer = null;
let archivesCloseTimer = null;
let detailCloseTimer = null;
let draggedContactId = null;
let touchContactDrag = null;
let editingContactId = null;
let hoveredKeyId = null;
let isDetailPanelHovered = false;
let isPhotoImporting = false;
let photoImportResetTimer = null;
let undoSnapshot = null;
let isKeyInfoEditUnlocked = false;
let expandedKeyHistoryIds = new Set();
let expandedKeyDetailsIds = new Set();
const recentlyClearedKeySlots = new Map();
const recentlyForcedKeySlots = new Map();

const protectedKeyInfoInputs = [ownerInput, ownerFirstNameInput, propertyInput, postalCodeInput, cityInput, notesInput];
let tileViewMode = loadTileViewMode();
let keyStatusFilter = loadKeyStatusFilter();
let currentGlobalHistoryFilter = "";
let saleCelebrationTimer = null;
const celebrationAudioFiles = ["Ados.mp3", "Adultes.mp3", "Langue.mp3"];
let celebrationAudioPlayers = [];
let photoViewer = null;
let lastLocalEditAt = Number(getRuntimeStorageValue(lastLocalEditStorageKey) || 0);
let isSavingKeyInfoDraft = false;
let pendingCloudSync = Promise.resolve();
let failedCloudSyncKeys = new Set();
let cloudSyncTimers = new Map();
let dirtyCloudKeys = loadPendingCloudKeys();
let dirtyKeySlots = loadDirtyKeySlots();
let pendingKeySlotWrites = loadPendingKeySlotWrites();
let cloudRowVersions = loadCloudRowVersions();
let activeKeyInfoDraft = null;
let pendingNewKeyDraft = null;
let hasLoadedCloudState = false;
let hasCompletedInitialCloudLoad = false;
let isCloudCheckRunning = false;
let shouldReloadCloudAfterCurrentCheck = false;
let shouldFullyReloadCloudAfterCurrentCheck = false;
let isCloudHeartbeatCheckRunning = false;
let initialCloudLoadPromise = null;
let lastSlotCloudSeenAt = "";
let lastAutomaticCloudRefreshAt = 0;
let automaticCloudRefreshTimer = null;
let cloudHeartbeatTimer = null;
let directCloudFlushTimers = new Map();
let isKeyWorkProtected = false;
let hasDeferredCloudRefreshForKeyWork = false;
let cloudInactivityTimer = null;
let cloudInactivityWatchdogTimer = null;
let isCloudSleeping = false;
let hasStartedCloudInactivityTracking = false;
let lastCloudActivityAt = Date.now();
let areSettingsOrganizationVisible = false;
let areSettingsReplacementsVisible = false;

function getAccessAgencyTitle() {
  const agencyName = String(tableSettings?.agencyName || "Agence").trim() || "Agence";
  return agencyName;
}

function updateAccessLockTitle() {
  if (accessAgencyTitle) accessAgencyTitle.textContent = getAccessAgencyTitle();
}

function isAccessUnlocked() {
  if (tableSettings?.accessLockEnabled === false) return true;
  return getRuntimeStorageValue(accessUnlockedStorageKey) === String(tableSettings?.accessLockVersion || 1);
}

function showAccessLock() {
  updateAccessLockTitle();
  if (accessLock) accessLock.hidden = false;
  document.body.classList.add("is-access-locked");
  window.setTimeout(() => accessCodeInput?.focus(), 0);
}

function unlockAccess() {
  setRuntimeStorageValue(accessUnlockedStorageKey, String(tableSettings?.accessLockVersion || 1));
  hideAccessLock();
}

function hideAccessLock() {
  document.body.classList.remove("is-access-locked");
  if (accessLock) accessLock.hidden = true;
}

function updateAccessLockState() {
  if (!hasResolvedInitialAccessSettings) {
    document.body.classList.remove("is-access-locked");
    document.body.classList.add("is-access-loading");
    if (accessLock) accessLock.hidden = true;
    return;
  }

  document.body.classList.remove("is-access-loading");
  if (isAccessUnlocked()) {
    hideAccessLock();
    return;
  }
  showAccessLock();
}

function markLocalEdit() {
  if (isApplyingCloudState) return;
  lastLocalEditAt = Date.now();
  setRuntimeStorageValue(lastLocalEditStorageKey, String(lastLocalEditAt));
}

function hasRecentLocalEdit() {
  return Date.now() - lastLocalEditAt <= pendingLocalEditGraceMs;
}

function isStandaloneHomeScreenApp() {
  return Boolean(window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)")?.matches);
}

function isMobileLikeDevice() {
  return Boolean(
    window.navigator.standalone ||
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.matchMedia?.("(pointer: coarse)")?.matches ||
      "ontouchstart" in window,
  );
}

function isAppInBackground() {
  return document.visibilityState === "hidden";
}

function isPhoneOrTabletDevice() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /Android|iPhone|iPad|Tablet|Mobi/i.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isTabletDevice() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIpad = /iPad/i.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(userAgent) && !/Mobi|Mobile/i.test(userAgent);
  return isIpad || isAndroidTablet || /Tablet/i.test(userAgent);
}

function beginKeyWorkProtection() {
  isKeyWorkProtected = true;
}

function deferCloudRefreshDuringKeyWork() {
  if (!isKeyWorkProtected || !hasCompletedInitialCloudLoad) return false;
  hasDeferredCloudRefreshForKeyWork = true;
  return true;
}

function endKeyWorkProtection({ refresh = true } = {}) {
  const wasProtected = isKeyWorkProtected;
  const hadDeferredCloudRefresh = hasDeferredCloudRefreshForKeyWork;
  isKeyWorkProtected = false;
  hasDeferredCloudRefreshForKeyWork = false;
  if (!refresh || (!wasProtected && !hadDeferredCloudRefresh) || !hasCompletedInitialCloudLoad) return;

  setTimeout(() => {
    requestAutomaticCloudRefresh({ force: true, immediate: true });
  }, 0);
}

function getAutomaticCloudPollInterval() {
  return isMobileLikeDevice() ? mobileCloudPollIntervalMs : cloudPollIntervalMs;
}

function clearScheduledCloudWorkForSleep() {
  clearTimeout(automaticCloudRefreshTimer);
  automaticCloudRefreshTimer = null;
  clearTimeout(cloudHeartbeatTimer);
  cloudHeartbeatTimer = null;
  cloudSyncTimers.forEach((timer) => clearTimeout(timer));
  cloudSyncTimers = new Map();
  directCloudFlushTimers.forEach((timer) => clearTimeout(timer));
  directCloudFlushTimers = new Map();
}

function pauseCloudWorkWhileBackgrounded() {
  getPendingCloudSyncKeys().forEach((storageKey) => failedCloudSyncKeys.add(storageKey));
  clearScheduledCloudWorkForSleep();
  savePendingCloudKeys();
}

function setCloudSleepOverlayVisible(visible) {
  document.body.classList.toggle("is-cloud-sleeping", visible);
  if (!cloudSleepOverlay) return;
  cloudSleepOverlay.hidden = !visible;
  cloudSleepOverlay.classList.toggle("is-visible", visible);
  cloudSleepOverlay.setAttribute("aria-hidden", String(!visible));
  if (visible) cloudSleepOverlay.getBoundingClientRect();
}

function enterCloudSleep() {
  if (isCloudSleeping) {
    setCloudSleepOverlayVisible(true);
    return;
  }
  isCloudSleeping = true;
  setCloudSleepOverlayVisible(true);
  clearTimeout(cloudInactivityTimer);
  cloudInactivityTimer = null;
  clearScheduledCloudWorkForSleep();
  savePendingCloudKeys();
}

function scheduleCloudSleep() {
  clearTimeout(cloudInactivityTimer);
  if (isCloudSleeping) {
    cloudInactivityTimer = null;
    return;
  }
  const remainingInactivityMs = Math.max(0, cloudInactivityTimeoutMs - (Date.now() - lastCloudActivityAt));
  cloudInactivityTimer = setTimeout(enterCloudSleep, remainingInactivityMs);
}

function recordCloudActivity() {
  if (isCloudSleeping) return;
  lastCloudActivityAt = Date.now();
  scheduleCloudSleep();
}

function enforceCloudSleepAfterInactivity() {
  if (isCloudSleeping) return true;
  if (Date.now() - lastCloudActivityAt < cloudInactivityTimeoutMs) return false;
  enterCloudSleep();
  return true;
}

function resumeCloudSyncFromInactivity() {
  const wasSleeping = isCloudSleeping;
  isCloudSleeping = false;
  lastCloudActivityAt = Date.now();
  setCloudSleepOverlayVisible(false);
  scheduleCloudSleep();
  if (!hasCompletedInitialCloudLoad) {
    void ensureInitialCloudStateLoaded();
    return true;
  }
  if (!wasSleeping) return false;

  lastAutomaticCloudRefreshAt = 0;
  setTimeout(() => {
    queueWakeCloudRefreshes();
    void ensureMissedAutomaticBackupOnOpen();
  }, 0);
  return true;
}

function startCloudInactivityTracking() {
  if (hasStartedCloudInactivityTracking) return;
  hasStartedCloudInactivityTracking = true;
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach((eventName) => {
    document.addEventListener(
      eventName,
      () => recordCloudActivity(),
      { capture: true, passive: true },
    );
  });
  scheduleCloudSleep();
  cloudInactivityWatchdogTimer = setInterval(() => {
    if (isCloudSleeping) return;
    if (!isAppInBackground()) enforceCloudSleepAfterInactivity();
  }, 1000);
}

function canCheckPublishedAppVersion() {
  return location.protocol === "https:" || location.protocol === "http:";
}

function markAppBuildVersionAsSeen() {
  try {
    setRuntimeStorageValue(appBuildVersionStorageKey, appBuildVersion);
  } catch {
    // Le contrôle de version ne doit jamais bloquer l'ouverture du tableau.
  }
}

async function ensureFreshPublishedAppVersion() {
  markAppBuildVersionAsSeen();
  if (!canCheckPublishedAppVersion()) return false;

  try {
    const response = await fetch(`${appBuildVersionUrl}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return false;
    const published = await response.json();
    const publishedVersion = String(published?.version || "").trim();
    if (!publishedVersion || publishedVersion === appBuildVersion) return false;

    const reloadKey = `${publishedVersion}:${appBuildVersion}`;
    if (sessionStorage.getItem(appBuildReloadStorageKey) === reloadKey) return false;
    sessionStorage.setItem(appBuildReloadStorageKey, reloadKey);

    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set("v", publishedVersion);
    location.replace(nextUrl.toString());
    return true;
  } catch (error) {
    console.warn("Version check failed", error.message);
    return false;
  }
}

function clearPrematureCloudSleepForInitialLoad() {
  if (hasCompletedInitialCloudLoad) return;
  if (isCloudSleeping) return;
  isCloudSleeping = false;
  setCloudSleepOverlayVisible(false);
}

async function ensureInitialCloudStateLoaded() {
  if (hasCompletedInitialCloudLoad) return true;
  if (initialCloudLoadPromise) return initialCloudLoadPromise;

  initialCloudLoadPromise = (async () => {
    for (const delay of initialCloudLoadRetryDelays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (isAppInBackground()) continue;

      clearPrematureCloudSleepForInitialLoad();
      await loadStorageFromCloud({ force: true });
      if (hasCompletedInitialCloudLoad) return true;
    }
    return false;
  })();

  try {
    return await initialCloudLoadPromise;
  } finally {
    initialCloudLoadPromise = null;
  }
}

function refreshCloudAfterForeground() {
  if (isCloudSleeping) {
    setCloudSleepOverlayVisible(true);
    return;
  }

  if (!hasCompletedInitialCloudLoad) {
    clearPrematureCloudSleepForInitialLoad();
    ensureInitialCloudStateLoaded().then((loaded) => {
      if (!loaded) return;
      updateAccessLockState();
      refreshDataFromStorage({ keepSelection: true });
    });
    return;
  }

  if (!enforceCloudSleepAfterInactivity()) queueWakeCloudRefreshes();
}

function queueStandaloneCloudRefresh(delay = 0) {
  if (!isStandaloneHomeScreenApp()) return;
  setTimeout(() => {
    loadStorageFromCloud({ force: true, full: true });
  }, delay);
}

function requestAutomaticCloudRefresh(options = {}) {
  if (!supabaseClient || isCloudSleeping || isAppInBackground()) return;
  if (deferCloudRefreshDuringKeyWork()) return;
  const force = options.force !== false;
  const now = Date.now();
  const elapsed = now - lastAutomaticCloudRefreshAt;
  const run = () => {
    lastAutomaticCloudRefreshAt = Date.now();
    retryFailedCloudSyncs().catch((error) => console.warn("Supabase retry failed", error.message));
    loadStorageFromCloud({ force, full: Boolean(options.full) });
  };

  clearTimeout(automaticCloudRefreshTimer);
  if (options.immediate || elapsed >= cloudInteractionRefreshThrottleMs) run();
  else automaticCloudRefreshTimer = setTimeout(run, cloudInteractionRefreshThrottleMs - elapsed);
}

function queueWakeCloudRefreshes() {
  cloudWakeRefreshDelays.forEach((delay, index) => {
    setTimeout(() => {
      requestAutomaticCloudRefresh({
        force: true,
        full: index === cloudWakeRefreshDelays.length - 1,
        immediate: delay === 0 || index === cloudWakeRefreshDelays.length - 1,
      });
    }, delay);
  });
}

function startAutomaticCloudRefreshLoop() {
  setInterval(() => {
    checkCloudSyncHeartbeat();
  }, getAutomaticCloudPollInterval());
  setInterval(() => {
    requestAutomaticCloudRefresh({ force: true });
  }, cloudSafetyRefreshIntervalMs);
  setInterval(() => {
    requestAutomaticCloudRefresh({ force: true, full: true, immediate: true });
  }, fullCloudRefreshIntervalMs);
}

function loadTileViewMode() {
  return getRuntimeStorageValue(tileViewStorageKey) === "photo" ? "photo" : "text";
}

function loadKeyStatusFilter() {
  const saved = getRuntimeStorageValue(keyStatusFilterStorageKey);
  return ["all", "available", "reserved", "out"].includes(saved) ? saved : "all";
}

function setTileViewMode(mode) {
  tileViewMode = mode === "photo" ? "photo" : "text";
  setRuntimeStorageValue(tileViewStorageKey, tileViewMode);
  updateTileViewToggle();
  renderGrid();
}

function setKeyStatusFilter(filter) {
  keyStatusFilter = ["all", "available", "reserved", "out"].includes(filter) ? filter : "all";
  setRuntimeStorageValue(keyStatusFilterStorageKey, keyStatusFilter);
  renderGrid();
}

function updateTileViewToggle() {
  textViewBtn.classList.toggle("is-active", tileViewMode === "text");
  photoViewBtn.classList.toggle("is-active", tileViewMode === "photo");
  textViewBtn.setAttribute("aria-pressed", String(tileViewMode === "text"));
  photoViewBtn.setAttribute("aria-pressed", String(tileViewMode === "photo"));
  grid.dataset.viewMode = tileViewMode;
}

function updateKeyStatusFilterBar() {
  const counts = getKeyStatusCounts();
  keyStatusFilterButtons.forEach((button) => {
    const filter = button.dataset.keyStatusFilter || "all";
    const count = button.querySelector("[data-key-status-count]");
    button.classList.toggle("is-active", filter === keyStatusFilter);
    button.setAttribute("aria-pressed", String(filter === keyStatusFilter));
    if (count) count.textContent = String(counts[filter] || 0);
  });
}

function getDeviceName() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const deviceType = /Mobi|Android|iPhone/i.test(userAgent) ? "Téléphone" : /iPad|Tablet/i.test(userAgent) ? "Tablette" : "PC";
  const browser = userAgent.includes("Firefox")
    ? "Firefox"
    : userAgent.includes("Edg")
      ? "Edge"
      : userAgent.includes("Chrome")
        ? "Chrome"
        : userAgent.includes("Safari")
          ? "Safari"
          : "Navigateur";
  return [deviceType, platform, browser].filter(Boolean).join(" - ");
}

function getDetectedDeviceName() {
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const isIpad = /iPad/i.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIphone = /iPhone/i.test(userAgent);
  const isAndroid = /Android/i.test(userAgent);
  const isMac = /Mac/i.test(platform);
  const isWindows = /Win/i.test(platform);

  if (isIphone) return "iPhone";
  if (isIpad) return "iPad";
  if (isAndroid) return "Téléphone Android";
  if (isMac) return "Mac";
  if (isWindows) return "PC Windows";
  return "Appareil";
}

function ensureDeviceName() {
  const savedName = getRuntimeStorageValue(deviceNameStorageKey)?.trim();
  if (savedName) return savedName;

  const detectedName = getDetectedDeviceName();
  let customName = "";
  try {
    customName = prompt("Nom de cet appareil pour l'historique :", detectedName);
  } catch (error) {
    console.warn("Device name prompt unavailable", error.message);
  }
  const deviceName = customName?.trim() || detectedName;
  setRuntimeStorageValue(deviceNameStorageKey, deviceName);
  return deviceName;
}

function getDeviceName() {
  return getRuntimeStorageValue(deviceNameStorageKey)?.trim() || ensureDeviceName();
}

function loadActivityLog() {
  return parseStoredArray(appActivityLogStorageKey, []);
}

function saveActivityLog(entries) {
  markLocalEdit();
  setRuntimeStorageValue(appActivityLogStorageKey, JSON.stringify(entries.slice(0, 600)));
  scheduleStorageKeySync(appActivityLogStorageKey);
}

function loadHiddenGlobalHistoryIds() {
  return new Set(parseStoredArray(hiddenGlobalHistoryStorageKey, []));
}

function saveHiddenGlobalHistoryIds(hiddenIds) {
  markLocalEdit();
  setRuntimeStorageValue(hiddenGlobalHistoryStorageKey, JSON.stringify([...hiddenIds]));
  scheduleStorageKeySync(hiddenGlobalHistoryStorageKey);
}

function logActivity(action, title, details = "") {
  const entries = loadActivityLog();
  entries.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: new Date().toISOString(),
    action,
    title,
    details,
    device: getDeviceName(),
    registry: activeRegistry,
  });
  saveActivityLog(entries);
}

function updateCreationActivityForKey(key) {
  if (!key || !isKeyFilled(key)) return;
  const keyTitle = keyLabel(key);
  const owner = key.owner ? formatOwner(key.owner) : "";
  const nextTitle = `${keyTitle}${owner ? ` - ${owner}` : ""}`;
  const nextDetails = [key.owner, key.property].filter(Boolean).join(" - ");
  const savedEntries = loadActivityLog();
  const latestCreationEntry = savedEntries
    .filter((entry) => {
      const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
      return entry.registry === activeRegistry && action.includes("cr\u00e9ation fiche") && String(entry.title || "").startsWith(keyTitle);
    })
    .sort((first, second) => parseHistoryTimestamp(second.date) - parseHistoryTimestamp(first.date))[0];
  if (!latestCreationEntry) return;

  let changed = false;
  const entries = savedEntries.map((entry) => {
    if (entry.id !== latestCreationEntry.id) return entry;
    if (entry.title === nextTitle && entry.details === nextDetails) return entry;
    changed = true;
    return { ...entry, title: nextTitle, details: nextDetails };
  });
  if (changed) saveActivityLog(entries);
}

function makeKeySet(id) {
  const option = keySetOptions.find((set) => set.id === id) || keySetOptions[0];
  return {
    id: option.id,
    label: option.label,
    photo: "",
    holder: "",
    holderCompany: "",
    holderPhone: "",
    holderReservationId: "",
    needsCheckIn: false,
    needsCheckInReason: "",
    status: "available",
    reservations: [],
    history: [],
  };
}

function getLatestMovementEntry(history = []) {
  return [...history]
    .filter((entry) => entry.type === "out" || entry.type === "in")
    .sort((first, second) => parseHistoryTimestamp(second.date) - parseHistoryTimestamp(first.date))[0];
}

function shouldKeepSetOut(set) {
  if (set.status !== "out") return false;
  const latestMovement = getLatestMovementEntry(set.history);
  if (!latestMovement || latestMovement.type !== "out") return false;
  if (set.holderReservationId) return latestMovement.reservationId === set.holderReservationId;
  return !latestMovement.reservationId;
}

function repairSetMovementState(set) {
  const reservations = Array.isArray(set.reservations) ? set.reservations.filter(isActiveReservation) : [];
  if (set.status === "out") {
    return { ...set, reservations, status: "out" };
  }

  return {
    ...set,
    holder: "",
    holderCompany: "",
    holderPhone: "",
    holderReservationId: "",
    reservations,
    status: "available",
  };
}

function createHistoryId() {
  return `history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadActiveRegistry() {
  const saved = getRuntimeStorageValue(registryStorageKey);
  return saved === "transaction" ? "transaction" : "location";
}

function saveActiveRegistry() {
  setRuntimeStorageValue(registryStorageKey, activeRegistry);
}

function getBackupStorageKeys() {
  return [
    registryStorageKey,
    sharedContactsStorageKey,
    appActivityLogStorageKey,
    hiddenGlobalHistoryStorageKey,
    tableSettingsStorageKey,
    registryConfig.location.keysStorageKey,
    registryConfig.location.archivesStorageKey,
    registryConfig.transaction.keysStorageKey,
    registryConfig.transaction.archivesStorageKey,
  ];
}

function getCloudStorageKeys() {
  return getBackupStorageKeys().filter((storageKey) => storageKey !== registryStorageKey);
}

function getCloudBaseStorageKeys() {
  return [...getCloudStorageKeys(), cloudSyncHeartbeatStorageKey];
}

function getKeyStorageKeys() {
  return Object.values(registryConfig).map((config) => config.keysStorageKey);
}

function parseStorageValue(value) {
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyCloudValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isKeysStorageKey(storageKey) {
  return Object.values(registryConfig).some((config) => config.keysStorageKey === storageKey);
}

function getKeySlotCloudPrefix(storageKey) {
  return `${storageKey}${keySlotCloudSeparator}`;
}

function getKeySlotCloudKey(storageKey, keyId) {
  return `${getKeySlotCloudPrefix(storageKey)}${keyId}`;
}

function getKeyStorageKeyFromSlotCloudKey(cloudKey) {
  const config = Object.values(registryConfig).find((item) => String(cloudKey || "").startsWith(getKeySlotCloudPrefix(item.keysStorageKey)));
  return config?.keysStorageKey || "";
}

function getKeyIdFromSlotCloudKey(cloudKey) {
  const storageKey = getKeyStorageKeyFromSlotCloudKey(cloudKey);
  return storageKey ? String(cloudKey).slice(getKeySlotCloudPrefix(storageKey).length) : "";
}

function isKeySlotCloudKey(cloudKey) {
  return Boolean(getKeyStorageKeyFromSlotCloudKey(cloudKey));
}

function getKeySlotRecoveryPrefix(storageKey, keyId) {
  return `${keySlotRecoveryBackupPrefix}${storageKey}::${keyId}::`;
}

async function pruneKeySlotRecoveryBackups(storageKey, keyId) {
  const prefix = getKeySlotRecoveryPrefix(storageKey, keyId);
  const { data, error } = await supabaseClient
    .from("app_state")
    .select("key")
    .like("key", `${prefix}%`)
    .order("key", { ascending: false });
  if (error || !Array.isArray(data)) return;

  const oldKeys = data.slice(keySlotRecoveryRetentionCount).map((row) => row.key);
  await Promise.all(oldKeys.map((key) => supabaseClient.from("app_state").delete().eq("key", key)));
}

async function createKeySlotRecoveryBackup(storageKey, keyId, remoteRow) {
  const remoteKey = normalizeCloudSlotKey(remoteRow);
  if (!isKeyFilled(remoteKey)) return;

  const savedAt = new Date().toISOString();
  const backupKey = `${getKeySlotRecoveryPrefix(storageKey, keyId)}${savedAt}-${Math.random().toString(16).slice(2)}`;
  const payload = {
    version: 1,
    savedAt,
    storageKey,
    keyId,
    reason: "before-explicit-clear",
    key: remoteKey,
  };
  const { error } = await supabaseClient.from("app_state").upsert(getCloudWritePayload(backupKey, payload, savedAt));
  if (error) throw error;
  void pruneKeySlotRecoveryBackups(storageKey, keyId).catch(() => {});
}

function parseCloudObjectValue(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}

function normalizeCloudSlotKey(row) {
  const keyId = getKeyIdFromSlotCloudKey(row?.key);
  return normalizeKey({ ...parseCloudObjectValue(row?.value), id: keyId });
}

function rememberSlotCloudSeenAt(row) {
  const nextTime = Date.parse(row?.updated_at || "");
  if (Number.isNaN(nextTime)) return;
  const currentTime = Date.parse(lastSlotCloudSeenAt || "");
  if (!lastSlotCloudSeenAt || Number.isNaN(currentTime) || nextTime > currentTime) lastSlotCloudSeenAt = row.updated_at;
}

function getKeySlotStorageRows() {
  return Object.values(registryConfig).map((config) => ({
    storageKey: config.keysStorageKey,
    prefix: getKeySlotCloudPrefix(config.keysStorageKey),
  }));
}

function getKeyCompletenessScore(key) {
  if (!key) return 0;
  return [
    key.owner,
    key.ownerFirstName,
    key.property,
    key.postalCode,
    key.city,
    key.notes,
    ...(key.sets || []).map((set) => set.photo),
  ].filter((value) => String(value || "").trim()).length;
}

function comparableKeyIdentityValue(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("fr-FR")
    .replace(/\s+/g, " ");
}

function shouldMergeKeyFallback(preferred, fallback) {
  const identityFields = ["owner", "property"];
  return identityFields.every((field) => {
    const preferredValue = comparableKeyIdentityValue(preferred[field]);
    const fallbackValue = comparableKeyIdentityValue(fallback[field]);
    return !preferredValue || !fallbackValue || preferredValue === fallbackValue;
  });
}

function mergeKeyRecord(preferredRaw, fallbackRaw, options = {}) {
  const preferred = normalizeKey(preferredRaw);
  if (!fallbackRaw) return preferred;
  const fallback = normalizeKey(fallbackRaw);
  const preferredScore = getKeyCompletenessScore(preferred);
  const fallbackScore = getKeyCompletenessScore(fallback);
  if (preferredScore === 0 && fallbackScore > 0) {
    return options.keepFallbackWhenPreferredEmpty ? fallback : preferred;
  }
  if (fallbackScore === 0) return preferred;
  if (!shouldMergeKeyFallback(preferred, fallback)) return preferred;

  return normalizeKey({
    ...preferred,
    property: preferred.property || fallback.property,
    postalCode: preferred.postalCode || fallback.postalCode,
    city: preferred.city || fallback.city,
    owner: preferred.owner || fallback.owner,
    ownerFirstName: preferred.ownerFirstName || fallback.ownerFirstName,
    notes: preferred.notes || fallback.notes,
    sets: preferred.sets.map((set) => {
      const fallbackSet = fallback.sets.find((savedSet) => savedSet.id === set.id);
      return fallbackSet && !set.photo ? { ...set, photo: fallbackSet.photo } : set;
    }),
  });
}

function mergeKeyCollections(preferredValue, fallbackValue, options = {}) {
  const preferredKeys = typeof preferredValue === "string" ? parseStorageValue(preferredValue) : preferredValue;
  const fallbackKeys = typeof fallbackValue === "string" ? parseStorageValue(fallbackValue) : fallbackValue;
  if (!Array.isArray(preferredKeys) || !Array.isArray(fallbackKeys)) return preferredValue;

  const fallbackById = new Map(fallbackKeys.map((key) => [key.id, key]));
  return preferredKeys.map((key) => mergeKeyRecord(key, fallbackById.get(key.id), options));
}

function isArchivedEmptySlotLegacyResidue(storageKey, key) {
  const config = Object.values(registryConfig).find((item) => item.keysStorageKey === storageKey);
  if (!config || !key?.id) return false;

  const normalizedKey = normalizeKey(key);
  const hasArchivedCopy = parseStoredArray(config.archivesStorageKey, []).some(
    (record) => record?.key?.id === normalizedKey.id,
  );
  if (!hasArchivedCopy) return false;

  const hasTextContent = [
    normalizedKey.property,
    normalizedKey.postalCode,
    normalizedKey.city,
    normalizedKey.owner,
    normalizedKey.ownerFirstName,
    normalizedKey.notes,
  ].some((value) => String(value || "").trim());
  const hasOperationalResidue = normalizedKey.sets.some(
    (set) =>
      Boolean(set.photo) ||
      set.status === "out" ||
      set.holder ||
      set.holderCompany ||
      set.holderPhone ||
      set.history.length ||
      set.reservations.length,
  );

  return !hasTextContent && hasOperationalResidue;
}

function sanitizeCachedArchivedResidues(storageKey, savedKeys) {
  if (!shouldSanitizeCachedArchivedResidues || !Array.isArray(savedKeys)) return savedKeys;
  return savedKeys.map((key) => (isArchivedEmptySlotLegacyResidue(storageKey, key) ? makeEmptyKey(key) : key));
}

function preserveActiveKeyInfoDraft(storageKey, value) {
  if (!activeKeyInfoDraft || !hasPendingActiveKeyInfoDraft(storageKey)) return value;
  const keyInfo = typeof value === "string" ? parseStorageValue(value) : value;
  if (!Array.isArray(keyInfo)) return value;
  const nextValue = keyInfo.map((key) =>
    key.id === activeKeyInfoDraft.keyId ? normalizeKey({ ...key, ...activeKeyInfoDraft.changes }) : key,
  );
  return typeof value === "string" ? JSON.stringify(nextValue) : nextValue;
}

function getRecentKeySlotMemoryKey(storageKey, keyId) {
  return `${storageKey}${keySlotCloudSeparator}${keyId}`;
}

function getRecentKeySlotMemoryParts(memoryKey) {
  const separatorIndex = String(memoryKey || "").lastIndexOf(keySlotCloudSeparator);
  if (separatorIndex < 0) return { storageKey: getRegistryConfig().keysStorageKey, keyId: String(memoryKey || "") };
  return {
    storageKey: memoryKey.slice(0, separatorIndex),
    keyId: memoryKey.slice(separatorIndex + keySlotCloudSeparator.length),
  };
}

function rememberClearedKeySlot(keyId, storageKey = getRegistryConfig().keysStorageKey) {
  if (!keyId) return;
  recentlyClearedKeySlots.set(getRecentKeySlotMemoryKey(storageKey, keyId), Date.now());
}

function rememberForcedKeySlot(keyId, content, storageKey = getRegistryConfig().keysStorageKey) {
  if (!keyId) return;
  recentlyForcedKeySlots.set(getRecentKeySlotMemoryKey(storageKey, keyId), {
    content: cloneKeyContent(normalizeKey({ id: keyId, ...content })),
    updatedAt: Date.now(),
  });
}

function forgetFilledClearedKeySlots(nextKeys, storageKey = getRegistryConfig().keysStorageKey) {
  nextKeys.forEach((key) => {
    const memoryKey = getRecentKeySlotMemoryKey(storageKey, key.id);
    if (recentlyClearedKeySlots.has(memoryKey) && isKeyFilled(key)) recentlyClearedKeySlots.delete(memoryKey);
  });
}

function preserveRecentlyClearedKeySlots(storageKey, value) {
  if (!recentlyClearedKeySlots.size) return value;
  const keyInfo = typeof value === "string" ? parseStorageValue(value) : value;
  if (!Array.isArray(keyInfo)) return value;

  const now = Date.now();
  [...recentlyClearedKeySlots].forEach(([memoryKey, clearedAt]) => {
    if (now - clearedAt > recentKeySlotMemoryMs) recentlyClearedKeySlots.delete(memoryKey);
  });
  if (!recentlyClearedKeySlots.size) return value;

  const nextValue = keyInfo.map((key) =>
    recentlyClearedKeySlots.has(getRecentKeySlotMemoryKey(storageKey, key.id)) ? makeEmptyKey(key) : key,
  );
  return typeof value === "string" ? JSON.stringify(nextValue) : nextValue;
}

function preserveRecentlyForcedKeySlots(storageKey, value) {
  if (!recentlyForcedKeySlots.size) return value;
  const keyInfo = typeof value === "string" ? parseStorageValue(value) : value;
  if (!Array.isArray(keyInfo)) return value;

  const now = Date.now();
  [...recentlyForcedKeySlots].forEach(([memoryKey, entry]) => {
    if (now - entry.updatedAt > recentKeySlotMemoryMs) recentlyForcedKeySlots.delete(memoryKey);
  });
  if (!recentlyForcedKeySlots.size) return value;

  const nextValue = keyInfo.map((key) => {
    const forced = recentlyForcedKeySlots.get(getRecentKeySlotMemoryKey(storageKey, key.id));
    return forced ? applyKeyContent(key, forced.content) : key;
  });
  return typeof value === "string" ? JSON.stringify(nextValue) : nextValue;
}

function protectLocalKeyEdits(storageKey, value) {
  return preserveActiveKeyInfoDraft(
    storageKey,
    preserveRecentlyForcedKeySlots(storageKey, preserveRecentlyClearedKeySlots(storageKey, value)),
  );
}

function saveStorageValue(storageKey, value) {
  if (typeof value === "string") {
    const nextValue = isKeysStorageKey(storageKey) ? protectLocalKeyEdits(storageKey, value) : value;
    setRuntimeStorageValue(storageKey, nextValue);
  } else {
    removeRuntimeStorageValue(storageKey);
  }
}

function saveKeySlotCloudRow(row, options = {}) {
  const storageKey = getKeyStorageKeyFromSlotCloudKey(row?.key);
  const keyId = getKeyIdFromSlotCloudKey(row?.key);
  if (!storageKey || !keyId) return;

  const pendingWrite = getPendingKeySlotWrite(row.key);
  if (pendingWrite) {
    if (cloudRowMatchesPendingKeySlotWrite(row, pendingWrite)) confirmPendingKeySlotWrite(row.key, row);
    else if (cloudRowIsNewerThanPendingKeySlotWrite(row, pendingWrite)) discardPendingKeySlotWrite(row.key);
    else {
      dirtyCloudKeys.add(storageKey);
      failedCloudSyncKeys.add(storageKey);
      savePendingCloudKeys();
      return;
    }
  }

  const incomingKey = normalizeCloudSlotKey(row);
  const savedKeys = parseStoredArray(storageKey, makeInitialKeys()).map(normalizeKey);
  const hasSavedSlot = savedKeys.some((key) => key.id === keyId);
  const nextKeys = hasSavedSlot
    ? savedKeys.map((key) => (key.id === keyId ? incomingKey : key))
    : [...savedKeys, incomingKey];
  const nextValue = JSON.stringify(nextKeys);
  if (options.protectLocal === false) setRuntimeStorageValue(storageKey, nextValue);
  else saveStorageValue(storageKey, nextValue);
}

function groupSlotRowsByStorageKey(slotRows) {
  const rowsByStorageKey = new Map();
  (Array.isArray(slotRows) ? slotRows : []).forEach((row) => {
    const storageKey = getKeyStorageKeyFromSlotCloudKey(row?.key);
    const keyId = getKeyIdFromSlotCloudKey(row?.key);
    if (!storageKey || !keyId) return;
    if (!rowsByStorageKey.has(storageKey)) rowsByStorageKey.set(storageKey, new Map());
    rowsByStorageKey.get(storageKey).set(keyId, row);
  });
  return rowsByStorageKey;
}

function applyInitialCloudKeyStorageState(legacyKeyRows, slotRows, pendingStartupKeys) {
  const legacyRowsByStorageKey = new Map(
    (Array.isArray(legacyKeyRows) ? legacyKeyRows : [])
      .filter((row) => isKeysStorageKey(row?.key))
      .map((row) => [row.key, row]),
  );
  const slotRowsByStorageKey = groupSlotRowsByStorageKey(slotRows);
  const keepRecentLocalSlots = hasRecentLocalEdit();

  Object.values(registryConfig).forEach((config) => {
    const storageKey = config.keysStorageKey;
    const currentKeysById = new Map(parseStoredArray(storageKey, makeInitialKeys()).map((key) => [key.id, normalizeKey(key)]));
    const legacyValue = legacyRowsByStorageKey.get(storageKey)?.value;
    const legacyKeys = parseStorageValue(stringifyCloudValue(legacyValue));
    const legacyKeysById = new Map(
      (Array.isArray(legacyKeys) ? legacyKeys : []).map((key) => [key.id, normalizeKey(key)]),
    );
    const slotRowsById = slotRowsByStorageKey.get(storageKey) || new Map();

    const nextKeys = makeInitialKeys().map((emptySlot) => {
      const slotRow = slotRowsById.get(emptySlot.id);
      const slotCloudKey = getKeySlotCloudKey(storageKey, emptySlot.id);
      const currentKey = currentKeysById.get(emptySlot.id);
      if (slotRow) {
        const pendingWrite = getPendingKeySlotWrite(slotCloudKey);
        if (pendingWrite) {
          if (cloudRowMatchesPendingKeySlotWrite(slotRow, pendingWrite)) confirmPendingKeySlotWrite(slotCloudKey, slotRow);
          else if (cloudRowIsNewerThanPendingKeySlotWrite(slotRow, pendingWrite)) {
            discardPendingKeySlotWrite(slotCloudKey);
            return normalizeCloudSlotKey(slotRow);
          } else return currentKey || normalizeKey(pendingWrite.value);
        }
        if (keepRecentLocalSlots && hasPendingCloudRowChange(slotCloudKey) && currentKey) return currentKey;
        return normalizeCloudSlotKey(slotRow);
      }
      const pendingWrite = getPendingKeySlotWrite(slotCloudKey);
      if (pendingWrite) return currentKey || normalizeKey(pendingWrite.value);
      if (keepRecentLocalSlots && hasPendingCloudRowChange(slotCloudKey) && currentKey) return currentKey;
      const legacyKey = legacyKeysById.get(emptySlot.id);
      return legacyKey && !isArchivedEmptySlotLegacyResidue(storageKey, legacyKey)
        ? normalizeKey({ ...legacyKey, id: emptySlot.id })
        : emptySlot;
    });
    const visibleLayoutIds = new Set(nextKeys.map((key) => key.id));
    slotRowsById.forEach((slotRow, keyId) => {
      if (!visibleLayoutIds.has(keyId)) {
        nextKeys.push(normalizeCloudSlotKey(slotRow));
        visibleLayoutIds.add(keyId);
      }
    });
    legacyKeysById.forEach((legacyKey, keyId) => {
      if (!visibleLayoutIds.has(keyId) && isKeyFilled(legacyKey)) nextKeys.push(normalizeKey(legacyKey));
    });

    const nextValue = JSON.stringify(nextKeys);
    if (getRuntimeStorageValue(storageKey) !== nextValue) setRuntimeStorageValue(storageKey, nextValue);
  });

  (Array.isArray(slotRows) ? slotRows : []).forEach((row) => {
    rememberSlotCloudSeenAt(row);
    cloudRowVersions.set(row.key, row.updated_at || "");
  });
}

function loadCloudRowVersions() {
  try {
    const saved = JSON.parse(getRuntimeStorageValue(cloudVersionsStorageKey) || "{}");
    return new Map(Object.entries(saved && typeof saved === "object" ? saved : {}));
  } catch {
    return new Map();
  }
}

function saveCloudRowVersions() {
  setRuntimeStorageValue(cloudVersionsStorageKey, JSON.stringify(Object.fromEntries(cloudRowVersions)));
}

function isStaleCloudWriteError(error) {
  const message = String(error?.message || "");
  return /ancienne version|expected_updated_at|stale|concurrent/i.test(message);
}

function getCloudWritePayload(storageKey, value, updatedAt, expectedUpdatedAt = null) {
  return {
    key: storageKey,
    value,
    updated_at: updatedAt,
    expected_updated_at: expectedUpdatedAt || null,
  };
}

async function upsertCloudRow(storageKey, value, expectedUpdatedAt = null, updatedAt = new Date().toISOString()) {
  const payload = getCloudWritePayload(storageKey, value, updatedAt, expectedUpdatedAt);
  if (!expectedUpdatedAt) return supabaseClient.from("app_state").upsert(payload);

  const result = await supabaseClient.from("app_state").update(payload).eq("key", storageKey);
  if (result.error || (Array.isArray(result.data) && result.data.length)) return result;

  return supabaseClient.from("app_state").upsert(getCloudWritePayload(storageKey, value, updatedAt));
}

async function upsertCloudRowWithFreshVersion(storageKey, value) {
  if (!supabaseClient || isCloudSleeping || isAppInBackground()) return null;
  const { data: remoteRow, error: versionError } = await supabaseClient
    .from("app_state")
    .select("key,value,updated_at")
    .eq("key", storageKey)
    .maybeSingle();
  if (versionError) throw versionError;

  let updatedAt = new Date().toISOString();
  let { error } = await upsertCloudRow(storageKey, value, remoteRow?.updated_at || null, updatedAt);
  if (error && isStaleCloudWriteError(error)) {
    const { data: latestRemoteRow, error: latestRemoteError } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .eq("key", storageKey)
      .maybeSingle();
    if (latestRemoteError) throw latestRemoteError;
    updatedAt = new Date().toISOString();
    ({ error } = await upsertCloudRow(storageKey, value, latestRemoteRow?.updated_at || null, updatedAt));
  }
  if (error) throw error;
  cloudRowVersions.set(storageKey, updatedAt);
  return updatedAt;
}

async function writeConfirmedKeySlotsToCloud(storageKey, keyIds, initialKeysById) {
  const uniqueKeyIds = [...new Set(keyIds)].filter((keyId) => initialKeysById.has(keyId));
  const intendedValues = new Map(
    uniqueKeyIds.map((keyId) => [keyId, normalizeKey({ ...initialKeysById.get(keyId), id: keyId })]),
  );
  if (!intendedValues.size) return new Map();

  intendedValues.forEach((value, keyId) => rememberPendingKeySlotWrite(storageKey, keyId, value));
  const recoveryBackupsCreated = new Set();

  for (let attempt = 0; attempt < keySlotWriteMaxAttempts; attempt += 1) {
    const cloudKeys = uniqueKeyIds.map((keyId) => getKeySlotCloudKey(storageKey, keyId));
    const { data: remoteRows, error: readError } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .in("key", cloudKeys);
    if (readError) throw readError;

    const remoteRowsByKey = new Map((Array.isArray(remoteRows) ? remoteRows : []).map((row) => [row.key, row]));
    for (const keyId of uniqueKeyIds) {
      const cloudKey = getKeySlotCloudKey(storageKey, keyId);
      const remoteRow = remoteRowsByKey.get(cloudKey);
      if (!remoteRow?.value) continue;

      const intendedValue = intendedValues.get(keyId);
      const remoteValue = normalizeCloudSlotKey(remoteRow);
      if (!isKeyFilled(remoteValue) || isKeyFilled(intendedValue)) continue;

      const pendingWrite = getPendingKeySlotWrite(cloudKey);
      if (!pendingWrite?.allowClear) {
        intendedValues.set(keyId, remoteValue);
        rememberPendingKeySlotWrite(storageKey, keyId, remoteValue);
        continue;
      }

      if (!recoveryBackupsCreated.has(cloudKey)) {
        await createKeySlotRecoveryBackup(storageKey, keyId, remoteRow);
        recoveryBackupsCreated.add(cloudKey);
      }
    }
    const allRowsAlreadyConfirmed = cloudKeys.every((cloudKey) => {
      const remoteRow = remoteRowsByKey.get(cloudKey);
      return remoteRow && cloudRowMatchesPendingKeySlotWrite(remoteRow);
    });
    if (allRowsAlreadyConfirmed) {
      const confirmedKeys = new Map();
      uniqueKeyIds.forEach((keyId) => {
        const cloudKey = getKeySlotCloudKey(storageKey, keyId);
        const remoteRow = remoteRowsByKey.get(cloudKey);
        confirmPendingKeySlotWrite(cloudKey, remoteRow);
        confirmedKeys.set(keyId, normalizeCloudSlotKey(remoteRow));
      });
      return confirmedKeys;
    }

    intendedValues.forEach((intendedValue, keyId) => {
      const cloudKey = getKeySlotCloudKey(storageKey, keyId);
      const remoteRow = remoteRowsByKey.get(cloudKey);
      if (!remoteRow?.value) return;
      const mergedValue = mergeKeyRecord(intendedValue, parseCloudObjectValue(remoteRow.value));
      intendedValues.set(keyId, mergedValue);
      rememberPendingKeySlotWrite(storageKey, keyId, mergedValue);
    });

    const updatedAt = new Date().toISOString();
    const payloads = uniqueKeyIds.map((keyId) => {
      const cloudKey = getKeySlotCloudKey(storageKey, keyId);
      const intendedValue = intendedValues.get(keyId);
      const remoteRow = remoteRowsByKey.get(cloudKey);
      const isAuthorizedClear =
        getPendingKeySlotWrite(cloudKey)?.allowClear &&
        remoteRow?.value &&
        isKeyFilled(normalizeCloudSlotKey(remoteRow)) &&
        !isKeyFilled(intendedValue);
      return getCloudWritePayload(
        cloudKey,
        isAuthorizedClear ? { ...intendedValue, _quialakeyClearAuthorizedAt: updatedAt } : intendedValue,
        updatedAt,
        remoteRow?.updated_at || null,
      );
    });
    const { error: writeError } = await supabaseClient.from("app_state").upsert(payloads);
    if (writeError) {
      if (isStaleCloudWriteError(writeError) && attempt + 1 < keySlotWriteMaxAttempts) {
        await waitForKeySlotRetry(attempt);
        continue;
      }
      throw writeError;
    }
    scheduleCloudSyncHeartbeat(0);

    const { data: confirmedRows, error: confirmationError } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .in("key", cloudKeys);
    if (confirmationError) throw confirmationError;
    const confirmedRowsByKey = new Map(
      (Array.isArray(confirmedRows) ? confirmedRows : []).map((row) => [row.key, row]),
    );
    const allRowsConfirmed = cloudKeys.every((cloudKey) => {
      const confirmedRow = confirmedRowsByKey.get(cloudKey);
      return confirmedRow && cloudRowMatchesPendingKeySlotWrite(confirmedRow);
    });
    if (allRowsConfirmed) {
      const confirmedKeys = new Map();
      uniqueKeyIds.forEach((keyId) => {
        const cloudKey = getKeySlotCloudKey(storageKey, keyId);
        const confirmedRow = confirmedRowsByKey.get(cloudKey);
        confirmPendingKeySlotWrite(cloudKey, confirmedRow);
        confirmedKeys.set(keyId, normalizeCloudSlotKey(confirmedRow));
      });
      return confirmedKeys;
    }

    intendedValues.forEach((intendedValue, keyId) => {
      const confirmedRow = confirmedRowsByKey.get(getKeySlotCloudKey(storageKey, keyId));
      if (!confirmedRow?.value) return;
      const mergedValue = mergeKeyRecord(intendedValue, parseCloudObjectValue(confirmedRow.value));
      intendedValues.set(keyId, mergedValue);
      rememberPendingKeySlotWrite(storageKey, keyId, mergedValue);
    });
    if (attempt + 1 < keySlotWriteMaxAttempts) await waitForKeySlotRetry(attempt);
  }

  throw new Error(`Les cases ${uniqueKeyIds.join(", ")} n'ont pas été confirmées par Supabase.`);
}

function loadPendingCloudKeys() {
  try {
    const saved = JSON.parse(getRuntimeStorageValue(pendingCloudKeysStorageKey) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function savePendingCloudKeys() {
  setRuntimeStorageValue(pendingCloudKeysStorageKey, JSON.stringify([...dirtyCloudKeys]));
}

function loadDirtyKeySlots() {
  try {
    const saved = JSON.parse(getRuntimeStorageValue(dirtyKeySlotsStorageKey) || "{}");
    return new Map(
      Object.entries(saved && typeof saved === "object" ? saved : {}).map(([storageKey, keyIds]) => [
        storageKey,
        new Set(Array.isArray(keyIds) ? keyIds : []),
      ]),
    );
  } catch {
    return new Map();
  }
}

function saveDirtyKeySlots() {
  setRuntimeStorageValue(
    dirtyKeySlotsStorageKey,
    JSON.stringify(
      Object.fromEntries([...dirtyKeySlots].map(([storageKey, keyIds]) => [storageKey, [...keyIds]])),
    ),
  );
}

function loadPendingKeySlotWrites() {
  try {
    const saved = JSON.parse(getRuntimeStorageValue(pendingKeySlotWritesStorageKey) || "{}");
    return new Map(
      Object.entries(saved && typeof saved === "object" ? saved : {}).filter(([, entry]) => entry?.storageKey && entry?.keyId && entry?.value),
    );
  } catch {
    return new Map();
  }
}

function savePendingKeySlotWrites() {
  setRuntimeStorageValue(pendingKeySlotWritesStorageKey, JSON.stringify(Object.fromEntries(pendingKeySlotWrites)));
}

function getComparableKeySlotValue(value) {
  return JSON.stringify(normalizeKey(value));
}

function getPendingKeySlotWrite(cloudKey) {
  return pendingKeySlotWrites.get(cloudKey) || null;
}

function rememberPendingKeySlotWrite(storageKey, keyId, value) {
  if (!storageKey || !keyId || !value) return;
  const cloudKey = getKeySlotCloudKey(storageKey, keyId);
  const normalizedValue = normalizeKey({ ...value, id: keyId });
  const previousWrite = getPendingKeySlotWrite(cloudKey);
  const memoryKey = getRecentKeySlotMemoryKey(storageKey, keyId);
  pendingKeySlotWrites.set(cloudKey, {
    storageKey,
    keyId,
    value: normalizedValue,
    comparableValue: getComparableKeySlotValue(normalizedValue),
    savedAt: Date.now(),
    allowClear: Boolean(previousWrite?.allowClear || recentlyClearedKeySlots.has(memoryKey)),
  });
  savePendingKeySlotWrites();
}

function rememberDirtyKeySlotSnapshots(storageKey) {
  if (!isKeysStorageKey(storageKey)) return;
  const keyById = new Map(parseStoredArray(storageKey, makeInitialKeys()).map((key) => [key.id, normalizeKey(key)]));
  getDirtyKeySlotIds(storageKey).forEach((keyId) => {
    const key = keyById.get(keyId);
    if (key) rememberPendingKeySlotWrite(storageKey, keyId, key);
  });
}

function cloudRowMatchesPendingKeySlotWrite(row, pendingWrite = getPendingKeySlotWrite(row?.key)) {
  if (!pendingWrite || !row?.value) return false;
  return getComparableKeySlotValue(normalizeCloudSlotKey(row)) === pendingWrite.comparableValue;
}

function cloudRowIsNewerThanPendingKeySlotWrite(row, pendingWrite = getPendingKeySlotWrite(row?.key)) {
  const cloudUpdatedAt = Date.parse(row?.updated_at || "");
  const pendingSavedAt = Number(pendingWrite?.savedAt);
  return Number.isFinite(cloudUpdatedAt) && Number.isFinite(pendingSavedAt) && cloudUpdatedAt > pendingSavedAt;
}

function clearDirtyKeySlot(storageKey, keyId) {
  const savedKeyIds = new Set(dirtyKeySlots.get(storageKey) || []);
  if (!savedKeyIds.delete(keyId)) return;
  if (savedKeyIds.size) dirtyKeySlots.set(storageKey, savedKeyIds);
  else dirtyKeySlots.delete(storageKey);
  saveDirtyKeySlots();
}

function discardPendingKeySlotWrite(cloudKey) {
  const pendingWrite = getPendingKeySlotWrite(cloudKey);
  if (!pendingWrite) return false;

  pendingKeySlotWrites.delete(cloudKey);
  const memoryKey = getRecentKeySlotMemoryKey(pendingWrite.storageKey, pendingWrite.keyId);
  recentlyForcedKeySlots.delete(memoryKey);
  recentlyClearedKeySlots.delete(memoryKey);
  clearDirtyKeySlot(pendingWrite.storageKey, pendingWrite.keyId);
  const activeDraftStorageKey = activeKeyInfoDraft?.storageKey || getRegistryConfig().keysStorageKey;
  if (activeKeyInfoDraft?.keyId === pendingWrite.keyId && activeDraftStorageKey === pendingWrite.storageKey) {
    activeKeyInfoDraft = null;
  }
  if (!getDirtyKeySlotIds(pendingWrite.storageKey).size) {
    dirtyCloudKeys.delete(pendingWrite.storageKey);
    failedCloudSyncKeys.delete(pendingWrite.storageKey);
  }
  savePendingKeySlotWrites();
  savePendingCloudKeys();
  return true;
}

function confirmPendingKeySlotWrite(cloudKey, row) {
  const pendingWrite = getPendingKeySlotWrite(cloudKey);
  if (!pendingWrite || !cloudRowMatchesPendingKeySlotWrite(row, pendingWrite)) return false;
  pendingKeySlotWrites.delete(cloudKey);
  const memoryKey = getRecentKeySlotMemoryKey(pendingWrite.storageKey, pendingWrite.keyId);
  recentlyForcedKeySlots.delete(memoryKey);
  recentlyClearedKeySlots.delete(memoryKey);
  clearDirtyKeySlot(pendingWrite.storageKey, pendingWrite.keyId);
  const activeDraftStorageKey = activeKeyInfoDraft?.storageKey || getRegistryConfig().keysStorageKey;
  if (activeKeyInfoDraft?.keyId === pendingWrite.keyId && activeDraftStorageKey === pendingWrite.storageKey) {
    activeKeyInfoDraft = null;
  }
  if (!getDirtyKeySlotIds(pendingWrite.storageKey).size) {
    dirtyCloudKeys.delete(pendingWrite.storageKey);
    failedCloudSyncKeys.delete(pendingWrite.storageKey);
  }
  cloudRowVersions.set(cloudKey, row.updated_at || "");
  savePendingKeySlotWrites();
  savePendingCloudKeys();
  saveCloudRowVersions();
  return true;
}

function waitForKeySlotRetry(attempt) {
  const jitter = Math.floor(Math.random() * 80);
  return new Promise((resolve) => setTimeout(resolve, keySlotWriteRetryBaseDelayMs * (attempt + 1) + jitter));
}

function resetLegacySyncMetadataIfNeeded() {
  dirtyCloudKeys.delete(registryStorageKey);
  failedCloudSyncKeys.delete(registryStorageKey);
  cloudRowVersions.delete(registryStorageKey);
  savePendingCloudKeys();
  saveCloudRowVersions();

  const previousVersion = getRuntimeStorageValue(syncMetadataVersionStorageKey) || "";
  if (previousVersion === syncMetadataVersion) return;
  const isSameSupabaseProject = previousVersion.endsWith(`-${supabaseProjectRef}`);

  cloudRowVersions = new Map();
  cloudSyncTimers.forEach((timer) => clearTimeout(timer));
  cloudSyncTimers = new Map();
  removeRuntimeStorageValue(cloudVersionsStorageKey);

  if (isSameSupabaseProject) {
    // Les anciennes files pouvaient contenir des fiches simplement restees ouvertes et bloquer les autres appareils.
    getKeyStorageKeys().forEach((storageKey) => {
      dirtyCloudKeys.delete(storageKey);
      failedCloudSyncKeys.delete(storageKey);
    });
    dirtyKeySlots = new Map();
    pendingKeySlotWrites = new Map();
    removeRuntimeStorageValue(dirtyKeySlotsStorageKey);
    removeRuntimeStorageValue(pendingKeySlotWritesStorageKey);
    dirtyCloudKeys.forEach((storageKey) => failedCloudSyncKeys.add(storageKey));
    savePendingCloudKeys();
    saveDirtyKeySlots();
    savePendingKeySlotWrites();
  } else {
    dirtyCloudKeys = new Set();
    failedCloudSyncKeys = new Set();
    dirtyKeySlots = new Map();
    pendingKeySlotWrites = new Map();
    removeRuntimeStorageValue(pendingCloudKeysStorageKey);
    removeRuntimeStorageValue(dirtyKeySlotsStorageKey);
    removeRuntimeStorageValue(pendingKeySlotWritesStorageKey);
  }

  setRuntimeStorageValue(syncMetadataVersionStorageKey, syncMetadataVersion);
}

function markDirtyKeySlot(keyId, storageKey = getRegistryConfig().keysStorageKey) {
  if (!keyId || !isKeysStorageKey(storageKey)) return;
  const savedKeyIds = dirtyKeySlots.get(storageKey) || new Set();
  savedKeyIds.add(keyId);
  dirtyKeySlots.set(storageKey, savedKeyIds);
  saveDirtyKeySlots();
}

function getDirtyKeySlotIds(storageKey) {
  const savedKeyIds = new Set(dirtyKeySlots.get(storageKey) || []);
  pendingKeySlotWrites.forEach((entry) => {
    if (entry.storageKey === storageKey && entry.keyId) savedKeyIds.add(entry.keyId);
  });
  const now = Date.now();
  recentlyForcedKeySlots.forEach((entry, memoryKey) => {
    if (now - entry.updatedAt > recentKeySlotMemoryMs) {
      recentlyForcedKeySlots.delete(memoryKey);
      return;
    }
    const parts = getRecentKeySlotMemoryParts(memoryKey);
    if (parts.storageKey === storageKey) savedKeyIds.add(parts.keyId);
  });
  recentlyClearedKeySlots.forEach((clearedAt, memoryKey) => {
    if (now - clearedAt > recentKeySlotMemoryMs) {
      recentlyClearedKeySlots.delete(memoryKey);
      return;
    }
    const parts = getRecentKeySlotMemoryParts(memoryKey);
    if (parts.storageKey === storageKey) savedKeyIds.add(parts.keyId);
  });
  return savedKeyIds;
}

function pruneStalePendingKeyStorageFlags() {
  let didChange = false;
  let didChangeDirtySlots = false;
  const keepRecentLocalFlags = hasRecentLocalEdit();
  Object.values(registryConfig).forEach((config) => {
    const storageKey = config.keysStorageKey;
    const savedDirtySlots = dirtyKeySlots.get(storageKey);
    if (savedDirtySlots?.size && !keepRecentLocalFlags) {
      dirtyKeySlots.delete(storageKey);
      didChangeDirtySlots = true;
    }
    if (getDirtyKeySlotIds(storageKey).size || (keepRecentLocalFlags && (dirtyCloudKeys.has(storageKey) || failedCloudSyncKeys.has(storageKey)))) {
      return;
    }
    if (dirtyCloudKeys.delete(storageKey)) didChange = true;
    if (failedCloudSyncKeys.delete(storageKey)) didChange = true;
  });
  if (didChangeDirtySlots) saveDirtyKeySlots();
  if (didChange) savePendingCloudKeys();
}

function hasPendingStorageKeyChange(storageKey) {
  if (isKeysStorageKey(storageKey)) {
    return getDirtyKeySlotIds(storageKey).size > 0 || (hasRecentLocalEdit() && (dirtyCloudKeys.has(storageKey) || failedCloudSyncKeys.has(storageKey)));
  }
  return dirtyCloudKeys.has(storageKey) || failedCloudSyncKeys.has(storageKey);
}

function hasPendingCloudRowChange(cloudKey) {
  const slotStorageKey = getKeyStorageKeyFromSlotCloudKey(cloudKey);
  if (!slotStorageKey) return hasPendingStorageKeyChange(cloudKey);
  const keyId = getKeyIdFromSlotCloudKey(cloudKey);
  return getDirtyKeySlotIds(slotStorageKey).has(keyId);
}

function getSyncStorageKeyForCloudKey(cloudKey) {
  return getKeyStorageKeyFromSlotCloudKey(cloudKey) || cloudKey;
}

function getPendingCloudSyncKeys() {
  pruneStalePendingKeyStorageFlags();
  return getCloudStorageKeys().filter(hasPendingStorageKeyChange);
}

function clearDirtyKeySlots(storageKey) {
  if (!dirtyKeySlots.has(storageKey)) return;
  dirtyKeySlots.delete(storageKey);
  saveDirtyKeySlots();
}

function clearSyncedDirtyKeySlots(storageKey, syncedKeySnapshots) {
  if (!dirtyKeySlots.has(storageKey)) return;
  const remainingKeyIds = new Set(dirtyKeySlots.get(storageKey) || []);
  const currentKeysById = new Map(
    parseStoredArray(storageKey, makeInitialKeys()).map((key) => [key.id, JSON.stringify(normalizeKey(key))]),
  );
  syncedKeySnapshots.forEach((syncedValue, keyId) => {
    if (currentKeysById.get(keyId) === syncedValue) remainingKeyIds.delete(keyId);
  });
  if (remainingKeyIds.size) dirtyKeySlots.set(storageKey, remainingKeyIds);
  else dirtyKeySlots.delete(storageKey);
  saveDirtyKeySlots();
}

function markChangedKeySlots(storageKey, nextValue, previousValue) {
  if (!isKeysStorageKey(storageKey)) return;
  const nextKeys = typeof nextValue === "string" ? parseStorageValue(nextValue) : nextValue;
  const previousKeys = typeof previousValue === "string" ? parseStorageValue(previousValue) : previousValue;
  if (!Array.isArray(nextKeys) || !Array.isArray(previousKeys)) return;

  const previousById = new Map(previousKeys.map((key) => [key.id, normalizeKey(key)]));
  nextKeys.forEach((key) => {
    const normalizedKey = normalizeKey(key);
    const previousKey = previousById.get(normalizedKey.id);
    if (JSON.stringify(normalizedKey) !== JSON.stringify(previousKey)) markDirtyKeySlot(normalizedKey.id, storageKey);
  });
}

function rebaseKeyStorageValueForCloud(storageKey, localValue, remoteValue) {
  if (!isKeysStorageKey(storageKey) || localValue === null) return localValue;

  const localKeys = typeof localValue === "string" ? parseStorageValue(localValue) : localValue;
  const remoteKeys = typeof remoteValue === "string" ? parseStorageValue(remoteValue) : remoteValue;
  if (!Array.isArray(localKeys) || !Array.isArray(remoteKeys)) return localValue;

  const dirtyIds = getDirtyKeySlotIds(storageKey);
  if (!dirtyIds.size) return stringifyCloudValue(remoteKeys);

  const localById = new Map(localKeys.map((key) => [key.id, key]));
  const rebasedKeys = remoteKeys.map((remoteKey) => {
    const localKey = localById.get(remoteKey.id);
    return dirtyIds.has(remoteKey.id) && localKey ? normalizeKey(localKey) : normalizeKey(remoteKey);
  });

  return stringifyCloudValue(rebasedKeys);
}

function mergeActivityLogValues(localValue, remoteValue) {
  const localEntries = typeof localValue === "string" ? parseStorageValue(localValue) : localValue;
  const remoteEntries = typeof remoteValue === "string" ? parseStorageValue(remoteValue) : remoteValue;
  if (!Array.isArray(localEntries) || !Array.isArray(remoteEntries)) return localValue;

  const byId = new Map();
  [...remoteEntries, ...localEntries].forEach((entry) => {
    if (!entry?.id) return;
    byId.set(entry.id, entry);
  });
  return stringifyCloudValue(
    [...byId.values()]
      .sort((first, second) => new Date(second.date || 0) - new Date(first.date || 0))
      .slice(0, 600),
  );
}

function mergeHiddenHistoryValues(localValue, remoteValue) {
  const localIds = typeof localValue === "string" ? parseStorageValue(localValue) : localValue;
  const remoteIds = typeof remoteValue === "string" ? parseStorageValue(remoteValue) : remoteValue;
  if (!Array.isArray(localIds) || !Array.isArray(remoteIds)) return localValue;
  return stringifyCloudValue([...new Set([...remoteIds, ...localIds])]);
}

function prepareStorageValueForCloud(storageKey, localValue, remoteValue = null, options = {}) {
  if (localValue === null) return null;
  if (options.fullReplace) {
    return isKeysStorageKey(storageKey) ? protectLocalKeyEdits(storageKey, localValue) : localValue;
  }
  if (isKeysStorageKey(storageKey) && remoteValue !== null) {
    return rebaseKeyStorageValueForCloud(storageKey, localValue, remoteValue);
  }
  if (storageKey === appActivityLogStorageKey && remoteValue !== null) {
    return mergeActivityLogValues(localValue, remoteValue);
  }
  if (storageKey === hiddenGlobalHistoryStorageKey && remoteValue !== null) {
    return mergeHiddenHistoryValues(localValue, remoteValue);
  }
  if (isKeysStorageKey(storageKey)) {
    return protectLocalKeyEdits(storageKey, localValue);
  }
  return localValue;
}

function finishSuccessfulCloudWrite(storageKey, sentValue, updatedAt) {
  failedCloudSyncKeys.delete(storageKey);
  const currentValue = getRuntimeStorageValue(storageKey);
  const localStillMatchesSentValue = sentValue === null ? currentValue === null : currentValue === sentValue;

  if (localStillMatchesSentValue) {
    dirtyCloudKeys.delete(storageKey);
    clearDirtyKeySlots(storageKey);
  } else {
    dirtyCloudKeys.add(storageKey);
    scheduleStorageKeySync(storageKey);
  }

  if (sentValue === null) cloudRowVersions.delete(storageKey);
  else cloudRowVersions.set(storageKey, updatedAt);
  savePendingCloudKeys();
  saveCloudRowVersions();
  scheduleCloudSyncHeartbeat();
}

function scheduleCloudSyncHeartbeat(delay = 150) {
  if (!supabaseClient || isCloudSleeping || isAppInBackground()) return;
  clearTimeout(cloudHeartbeatTimer);
  cloudHeartbeatTimer = setTimeout(() => {
    cloudHeartbeatTimer = null;
    touchCloudSyncHeartbeat().catch((error) => console.warn("Supabase heartbeat failed", error.message));
  }, delay);
}

async function touchCloudSyncHeartbeat() {
  if (!supabaseClient || isCloudSleeping || isAppInBackground()) return;
  const updatedAt = new Date().toISOString();
  const { data: remoteRow, error: versionError } = await supabaseClient
    .from("app_state")
    .select("key,value,updated_at")
    .eq("key", cloudSyncHeartbeatStorageKey)
    .maybeSingle();
  if (versionError) throw versionError;

  let { error } = await upsertCloudRow(
    cloudSyncHeartbeatStorageKey,
    {
      version: appBuildVersion,
      updatedAt,
    },
    remoteRow?.updated_at || null,
    updatedAt,
  );

  if (error && isStaleCloudWriteError(error)) {
    const { data: latestRemoteRow, error: latestRemoteError } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .eq("key", cloudSyncHeartbeatStorageKey)
      .maybeSingle();
    if (latestRemoteError) throw latestRemoteError;
    ({ error } = await upsertCloudRow(
      cloudSyncHeartbeatStorageKey,
      {
        version: appBuildVersion,
        updatedAt,
      },
      latestRemoteRow?.updated_at || null,
      updatedAt,
    ));
  }

  if (error) throw error;
  cloudRowVersions.set(cloudSyncHeartbeatStorageKey, updatedAt);
  saveCloudRowVersions();
}

async function checkCloudSyncHeartbeat() {
  if (
    !supabaseClient ||
    isCloudSleeping ||
    isAppInBackground() ||
    isCloudHeartbeatCheckRunning ||
    isCloudCheckRunning ||
    isResettingTableData
  ) {
    return;
  }

  isCloudHeartbeatCheckRunning = true;
  try {
    const { data: remoteRow, error } = await supabaseClient
      .from("app_state")
      .select("key,updated_at")
      .eq("key", cloudSyncHeartbeatStorageKey)
      .maybeSingle();
    if (error) return;
    if (!remoteRow) {
      await touchCloudSyncHeartbeat();
      return;
    }
    if (cloudRowVersions.get(cloudSyncHeartbeatStorageKey) === (remoteRow.updated_at || "")) return;
    requestAutomaticCloudRefresh({ force: true, immediate: true });
  } catch (error) {
    console.warn("Supabase heartbeat check failed", error.message);
  } finally {
    isCloudHeartbeatCheckRunning = false;
  }
}

function scheduleStorageKeySync(storageKey, delay = cloudWriteDebounceMs) {
  if (!supabaseClient || storageKey === registryStorageKey) return;
  dirtyCloudKeys.add(storageKey);
  if (isKeysStorageKey(storageKey)) rememberDirtyKeySlotSnapshots(storageKey);
  savePendingCloudKeys();
  if (!hasCompletedInitialCloudLoad || isCloudSleeping || isAppInBackground()) return;
  clearTimeout(cloudSyncTimers.get(storageKey));
  cloudSyncTimers.set(
    storageKey,
    setTimeout(() => {
      cloudSyncTimers.delete(storageKey);
      syncStorageKeyToCloud(storageKey);
    }, delay),
  );
}

function scheduleDirectKeyStorageFlush(storageKey, delay = 250) {
  if (!supabaseClient || !isKeysStorageKey(storageKey)) return;
  rememberDirtyKeySlotSnapshots(storageKey);
  if (isCloudSleeping || isAppInBackground()) return;
  clearTimeout(cloudSyncTimers.get(storageKey));
  cloudSyncTimers.delete(storageKey);
  clearTimeout(directCloudFlushTimers.get(storageKey));
  directCloudFlushTimers.set(
    storageKey,
    setTimeout(() => {
      directCloudFlushTimers.delete(storageKey);
      pendingCloudSync = pendingCloudSync.catch(() => {}).then(() => flushKeyStorageDirectlyToCloud(storageKey));
      pendingCloudSync.catch((error) => {
        dirtyCloudKeys.add(storageKey);
        failedCloudSyncKeys.add(storageKey);
        savePendingCloudKeys();
        console.warn("Supabase direct key sync failed", storageKey, error.message);
      });
    }, delay),
  );
}

async function flushKeyStorageDirectlyToCloud(storageKey) {
  let savedKeys = parseStoredArray(storageKey, makeInitialKeys()).map(normalizeKey);
  const keyById = new Map(savedKeys.map((key) => [key.id, key]));
  const keyIds = [...getDirtyKeySlotIds(storageKey)];
  if (!keyIds.length) return;

  const syncedKeySnapshots = new Map();
  const confirmedKeys = await writeConfirmedKeySlotsToCloud(storageKey, keyIds, keyById);
  confirmedKeys.forEach((confirmedKey, keyId) => {
    keyById.set(keyId, confirmedKey);
    savedKeys = savedKeys.map((savedKey) => (savedKey.id === keyId ? confirmedKey : savedKey));
    syncedKeySnapshots.set(keyId, JSON.stringify(confirmedKey));
  });
  setRuntimeStorageValue(storageKey, JSON.stringify(savedKeys));

  clearSyncedDirtyKeySlots(storageKey, syncedKeySnapshots);
  if (!getDirtyKeySlotIds(storageKey).size) {
    dirtyCloudKeys.delete(storageKey);
    failedCloudSyncKeys.delete(storageKey);
  }
  savePendingCloudKeys();
  saveCloudRowVersions();
  scheduleCloudSyncHeartbeat();
}

async function writeKeySlotsToCloud(storageKey, options = {}) {
  let savedKeys = parseStoredArray(storageKey, makeInitialKeys()).map(normalizeKey);
  const keyById = new Map(savedKeys.map((key) => [key.id, key]));
  const keyIds = options.force ? savedKeys.map((key) => key.id) : [...getDirtyKeySlotIds(storageKey)];
  const syncedKeySnapshots = new Map();
  if (!keyIds.length && !options.allowClean) return;

  let confirmedKeys;
  try {
    confirmedKeys = await writeConfirmedKeySlotsToCloud(storageKey, keyIds, keyById);
  } catch (error) {
    dirtyCloudKeys.add(storageKey);
    failedCloudSyncKeys.add(storageKey);
    savePendingCloudKeys();
    console.warn("Supabase key slot sync failed", keyIds.join(", "), error.message);
    throw error;
  }
  confirmedKeys.forEach((confirmedKey, keyId) => {
    keyById.set(keyId, confirmedKey);
    savedKeys = savedKeys.map((savedKey) => (savedKey.id === keyId ? confirmedKey : savedKey));
    syncedKeySnapshots.set(keyId, JSON.stringify(confirmedKey));
  });
  setRuntimeStorageValue(storageKey, JSON.stringify(savedKeys));

  await writeFullKeyStorageMirrorToCloud(storageKey, savedKeys);
  clearSyncedDirtyKeySlots(storageKey, syncedKeySnapshots);
  if (getDirtyKeySlotIds(storageKey).size) {
    dirtyCloudKeys.add(storageKey);
    scheduleStorageKeySync(storageKey);
  } else {
    dirtyCloudKeys.delete(storageKey);
  }
  failedCloudSyncKeys.delete(storageKey);
  savePendingCloudKeys();
  saveCloudRowVersions();
  scheduleCloudSyncHeartbeat();
}

async function writeFullKeyStorageMirrorToCloud(storageKey, savedKeys) {
  const normalizedKeys = (Array.isArray(savedKeys) ? savedKeys : []).map(normalizeKey);
  let updatedAt = new Date().toISOString();
  let expectedUpdatedAt = cloudRowVersions.get(storageKey) || null;
  let { error } = await upsertCloudRow(storageKey, normalizedKeys, expectedUpdatedAt, updatedAt);

  if (error && isStaleCloudWriteError(error)) {
    const { data: remoteRow, error: remoteError } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .eq("key", storageKey)
      .maybeSingle();
    if (remoteError) {
      console.warn("Supabase full key mirror version check failed", storageKey, remoteError.message);
      return;
    }
    updatedAt = new Date().toISOString();
    ({ error } = await upsertCloudRow(storageKey, normalizedKeys, remoteRow?.updated_at || null, updatedAt));
  }

  if (error) {
    console.warn("Supabase full key mirror failed", storageKey, error.message);
    return;
  }
  cloudRowVersions.set(storageKey, updatedAt);
}

function syncStorageKeyToCloud(storageKey, options = {}) {
  if (storageKey === registryStorageKey) {
    dirtyCloudKeys.delete(storageKey);
    failedCloudSyncKeys.delete(storageKey);
    savePendingCloudKeys();
    return Promise.resolve();
  }
  if (!supabaseClient) return Promise.resolve();
  if (isCloudSleeping || isAppInBackground()) {
    dirtyCloudKeys.add(storageKey);
    if (isKeysStorageKey(storageKey)) rememberDirtyKeySlotSnapshots(storageKey);
    savePendingCloudKeys();
    return Promise.resolve();
  }
  if (!hasCompletedInitialCloudLoad) {
    dirtyCloudKeys.add(storageKey);
    savePendingCloudKeys();
    return Promise.resolve();
  }
  const force = Boolean(options.force);
  if (!force && !hasPendingStorageKeyChange(storageKey)) return Promise.resolve();
  clearTimeout(cloudSyncTimers.get(storageKey));
  cloudSyncTimers.delete(storageKey);
  failedCloudSyncKeys.delete(storageKey);

  if (isKeysStorageKey(storageKey)) {
    pendingCloudSync = pendingCloudSync.catch(() => {}).then(() => writeKeySlotsToCloud(storageKey, options));
    return pendingCloudSync;
  }

  pendingCloudSync = pendingCloudSync
    .catch(() => {})
    .then(async () => {
      let value = getRuntimeStorageValue(storageKey);
      let updatedAt = new Date().toISOString();
      const expectedUpdatedAt = cloudRowVersions.get(storageKey) || null;
      const { data: remoteRow, error: versionError } = await supabaseClient
        .from("app_state")
        .select("key,value,updated_at")
        .eq("key", storageKey)
        .maybeSingle();
      if (versionError) throw versionError;

      const remoteUpdatedAt = remoteRow?.updated_at || "";
      const hasRemoteVersionChanged = remoteRow && remoteUpdatedAt !== (expectedUpdatedAt || "");
      const hasLocalKeySlotChanges = isKeysStorageKey(storageKey) && getDirtyKeySlotIds(storageKey).size > 0;
      if (value !== null && remoteRow) {
        value = prepareStorageValueForCloud(storageKey, value, remoteRow.value, { fullReplace: force });
        setRuntimeStorageValue(storageKey, value);
      }
      if (!force && hasRemoteVersionChanged) {
        if ((dirtyCloudKeys.has(storageKey) || hasLocalKeySlotChanges) && value !== null) {
          const { error: localSaveError } = await upsertCloudRow(
            storageKey,
            parseStorageValue(value),
            remoteUpdatedAt || null,
            updatedAt,
          );
          if (localSaveError) {
            dirtyCloudKeys.add(storageKey);
            failedCloudSyncKeys.add(storageKey);
            savePendingCloudKeys();
            console.warn("Supabase sync failed", storageKey, localSaveError.message);
            return;
          }

          finishSuccessfulCloudWrite(storageKey, value, updatedAt);
          return;
        }

        isApplyingCloudState = true;
        saveStorageValue(remoteRow.key, stringifyCloudValue(remoteRow.value));
        isApplyingCloudState = false;
        cloudRowVersions.set(remoteRow.key, remoteUpdatedAt);
        dirtyCloudKeys.delete(storageKey);
        failedCloudSyncKeys.delete(storageKey);
        savePendingCloudKeys();
        saveCloudRowVersions();
        if (!deferCloudRefreshDuringKeyWork()) refreshDataFromStorage({ keepSelection: true });
        return;
      }

      const request =
        value === null
          ? supabaseClient.from("app_state").delete().eq("key", storageKey)
          : upsertCloudRow(storageKey, parseStorageValue(value), expectedUpdatedAt, updatedAt);

      let { error } = await request;
      if (error && isStaleCloudWriteError(error) && value !== null) {
        const { data: latestRemoteRow, error: latestRemoteError } = await supabaseClient
          .from("app_state")
          .select("key,value,updated_at")
          .eq("key", storageKey)
          .maybeSingle();
        if (latestRemoteError) throw latestRemoteError;
        if (latestRemoteRow?.value) {
          value = prepareStorageValueForCloud(storageKey, value, latestRemoteRow.value);
          setRuntimeStorageValue(storageKey, value);
        }
        updatedAt = new Date().toISOString();
        const retryResult = await upsertCloudRow(
          storageKey,
          parseStorageValue(value),
          latestRemoteRow?.updated_at || null,
          updatedAt,
        );
        error = retryResult.error;
      }
      if (error) {
        dirtyCloudKeys.add(storageKey);
        failedCloudSyncKeys.add(storageKey);
        savePendingCloudKeys();
        console.warn("Supabase sync failed", storageKey, error.message);
        return;
      }
      finishSuccessfulCloudWrite(storageKey, value, updatedAt);
    });

  return pendingCloudSync;
}

function retryFailedCloudSyncs() {
  if (isCloudSleeping || isAppInBackground()) return Promise.resolve();
  pruneStalePendingKeyStorageFlags();
  if (!failedCloudSyncKeys.size) return Promise.resolve();
  const keys = [...failedCloudSyncKeys].filter(hasPendingStorageKeyChange);
  failedCloudSyncKeys.clear();
  return Promise.all(keys.map(syncStorageKeyToCloud));
}

function syncAllStorageToCloud() {
  return Promise.all(getCloudStorageKeys().map((storageKey) => syncStorageKeyToCloud(storageKey, { force: true })));
}

function syncCurrentRegistryToCloud() {
  return Promise.all(getPendingCloudSyncKeys().map(syncStorageKeyToCloud));
}

async function loadKeySlotCloudRows(selectColumns = "key,value,updated_at") {
  if (!supabaseClient) return [];
  const results = await Promise.all(
    getKeySlotStorageRows().map(({ prefix }) =>
      supabaseClient
        .from("app_state")
        .select(selectColumns)
        .like("key", `${prefix}%`),
    ),
  );

  return results.flatMap(({ data, error }) => {
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  });
}

async function loadCloudRowsByKeys(keys) {
  if (!supabaseClient || !Array.isArray(keys) || !keys.length) return [];
  const uniqueKeys = [...new Set(keys)];
  const baseKeys = uniqueKeys.filter((key) => !isKeySlotCloudKey(key));
  const slotKeys = new Set(uniqueKeys.filter(isKeySlotCloudKey));
  const rows = [];

  if (baseKeys.length) {
    const { data, error } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .in("key", baseKeys);
    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);
  }

  if (slotKeys.size) {
    const { data, error } = await supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .in("key", [...slotKeys]);
    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);
  }

  return rows;
}

async function writeStorageKeyToCloudNow(storageKey, options = {}) {
  if (!supabaseClient) return;
  if (isCloudSleeping || isAppInBackground()) {
    dirtyCloudKeys.add(storageKey);
    if (isKeysStorageKey(storageKey)) rememberDirtyKeySlotSnapshots(storageKey);
    savePendingCloudKeys();
    return;
  }
  const shouldWrite = options.allowClean || hasPendingStorageKeyChange(storageKey);
  if (!shouldWrite) return;
  if (!hasCompletedInitialCloudLoad) {
    dirtyCloudKeys.add(storageKey);
    savePendingCloudKeys();
    return;
  }
  clearTimeout(cloudSyncTimers.get(storageKey));
  cloudSyncTimers.delete(storageKey);

  if (isKeysStorageKey(storageKey)) {
    clearTimeout(directCloudFlushTimers.get(storageKey));
    directCloudFlushTimers.delete(storageKey);
    pendingCloudSync = pendingCloudSync.catch(() => {}).then(() => writeKeySlotsToCloud(storageKey, options));
    return pendingCloudSync;
  }

  pendingCloudSync = pendingCloudSync
    .catch(() => {})
    .then(async () => {
      let value = getRuntimeStorageValue(storageKey);
      let updatedAt = new Date().toISOString();
      const { data: remoteRow, error: versionError } = await supabaseClient
        .from("app_state")
        .select("key,value,updated_at")
        .eq("key", storageKey)
        .maybeSingle();
      if (versionError) {
        dirtyCloudKeys.add(storageKey);
        failedCloudSyncKeys.add(storageKey);
        savePendingCloudKeys();
        throw versionError;
      }
      if (value !== null) {
        value = prepareStorageValueForCloud(storageKey, value, remoteRow?.value ?? null, options);
        setRuntimeStorageValue(storageKey, value);
      }
      let { error } =
        value === null
          ? await supabaseClient.from("app_state").delete().eq("key", storageKey)
          : await upsertCloudRow(storageKey, parseStorageValue(value), remoteRow?.updated_at || null, updatedAt);

      if (error && isStaleCloudWriteError(error) && value !== null) {
        const { data: latestRemoteRow, error: latestRemoteError } = await supabaseClient
          .from("app_state")
          .select("key,value,updated_at")
          .eq("key", storageKey)
          .maybeSingle();
        if (latestRemoteError) throw latestRemoteError;
        if (latestRemoteRow?.value) {
          value = prepareStorageValueForCloud(storageKey, value, latestRemoteRow.value, options);
          setRuntimeStorageValue(storageKey, value);
        }
        updatedAt = new Date().toISOString();
        const retryResult = await upsertCloudRow(
          storageKey,
          parseStorageValue(value),
          latestRemoteRow?.updated_at || null,
          updatedAt,
        );
        error = retryResult.error;
      }

      if (error) {
        dirtyCloudKeys.add(storageKey);
        failedCloudSyncKeys.add(storageKey);
        savePendingCloudKeys();
        throw error;
      }

      finishSuccessfulCloudWrite(storageKey, value, updatedAt);
    });

  return pendingCloudSync;
}

async function syncCurrentRegistryNow() {
  const activeKeysStorageKey = getRegistryConfig().keysStorageKey;
  const pendingKeys = getPendingCloudSyncKeys().sort((first, second) => {
    if (first === activeKeysStorageKey) return -1;
    if (second === activeKeysStorageKey) return 1;
    if (isKeysStorageKey(first) && !isKeysStorageKey(second)) return -1;
    if (!isKeysStorageKey(first) && isKeysStorageKey(second)) return 1;
    return 0;
  });
  let didSyncEveryKey = true;

  for (const storageKey of pendingKeys) {
    try {
      await writeStorageKeyToCloudNow(storageKey);
    } catch (error) {
      didSyncEveryKey = false;
      console.warn("Supabase action sync failed", storageKey, error.message);
    }
  }

  return didSyncEveryKey;
}

function removeAutomaticBackupsFromLocalStorage() {
  getRuntimeStorageKeys()
    .filter((key) => key.startsWith(automaticBackupKeyPrefix))
    .forEach((key) => removeRuntimeStorageValue(key));
}

function closeKeyPanelAfterAction() {
  activeKeyInfoDraft = null;
  pendingNewKeyDraft = null;
  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  resetKeyInfoEditUnlock(null);
  endKeyWorkProtection();
  render();
}

async function syncCloudAfterAction() {
  try {
    const didSync = await syncCurrentRegistryNow();
    if (!didSync) {
      setTimeout(() => retryFailedCloudSyncs().catch((error) => console.warn("Supabase retry failed", error.message)), 2500);
    }
    return didSync;
  } catch (error) {
    console.warn("Supabase action sync failed", error.message);
    setTimeout(() => retryFailedCloudSyncs().catch((retryError) => console.warn("Supabase retry failed", retryError.message)), 2500);
    return false;
  }
}

function markKeyControlActionForSync(keyId, options = {}) {
  const config = getRegistryConfig();
  const keysChanged = options.keysChanged !== false;
  const archivesChanged = Boolean(options.archivesChanged);

  if (keysChanged) {
    if (keyId) markDirtyKeySlot(keyId, config.keysStorageKey);
    dirtyCloudKeys.add(config.keysStorageKey);
  }
  if (archivesChanged) dirtyCloudKeys.add(config.archivesStorageKey);
  dirtyCloudKeys.add(appActivityLogStorageKey);
  savePendingCloudKeys();
}

async function finishKeyControlAction(keyId, options = {}) {
  markKeyControlActionForSync(keyId, options);
  closeKeyPanelAfterAction();
  await syncCloudAfterAction();
}

function subscribeToCloudChanges() {
  if (!supabaseClient?.channel) return;
  supabaseClient
    .channel("cles-app-state-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state" },
      (payload) => {
        if (isResettingTableData) return;
        const storageKey = payload.new?.key || payload.old?.key || "";
        const slotStorageKey = getKeyStorageKeyFromSlotCloudKey(storageKey);
        if ((getCloudBaseStorageKeys().includes(storageKey) || slotStorageKey) && deferCloudRefreshDuringKeyWork()) return;
        if (slotStorageKey && payload.new?.value && !hasPendingCloudRowChange(storageKey)) {
          isApplyingCloudState = true;
          try {
            saveKeySlotCloudRow(payload.new);
            rememberSlotCloudSeenAt(payload.new);
            cloudRowVersions.set(storageKey, payload.new.updated_at || "");
            saveCloudRowVersions();
            refreshDataFromStorage({ keepSelection: true });
          } finally {
            isApplyingCloudState = false;
          }
          return;
        }
        if (getCloudBaseStorageKeys().includes(storageKey) || slotStorageKey) loadStorageFromCloud({ force: true });
      },
    )
    .subscribe();
}

async function reloadCompleteCloudState() {
  const pendingStorageKeys = new Set(getPendingCloudSyncKeys());
  const previousStorage = new Map(getCloudStorageKeys().map((key) => [key, getRuntimeStorageValue(key)]));
  const fullBaseStorageKeys = getCloudBaseStorageKeys();
  const [{ data: baseRows, error: baseRowsError }, slotRows] = await Promise.all([
    supabaseClient
      .from("app_state")
      .select("key,value,updated_at")
      .in("key", fullBaseStorageKeys),
    loadKeySlotCloudRows(),
  ]);
  if (baseRowsError) throw baseRowsError;
  if (deferCloudRefreshDuringKeyWork()) return false;
  if ((!Array.isArray(baseRows) || !baseRows.length) && !slotRows.length) {
    console.warn("Supabase full refresh returned no app state rows.");
    return false;
  }

  isApplyingCloudState = true;
  try {
    (Array.isArray(baseRows) ? baseRows : []).forEach((row) => {
      if (row.key === cloudSyncHeartbeatStorageKey || isKeysStorageKey(row.key)) return;
      if (!pendingStorageKeys.has(row.key)) saveStorageValue(row.key, stringifyCloudValue(row.value));
    });
    const legacyKeyRows = (Array.isArray(baseRows) ? baseRows : []).filter((row) => isKeysStorageKey(row.key));
    applyInitialCloudKeyStorageState(legacyKeyRows, slotRows, pendingStorageKeys);
  } finally {
    isApplyingCloudState = false;
  }

  (Array.isArray(baseRows) ? baseRows : []).forEach((row) => {
    cloudRowVersions.set(row.key, row.updated_at || "");
  });
  saveCloudRowVersions();
  hasResolvedInitialAccessSettings = true;

  const hasChanged = getCloudStorageKeys().some(
    (key) => previousStorage.get(key) !== getRuntimeStorageValue(key),
  );
  if (hasChanged) {
    updateAccessLockState();
    refreshDataFromStorage({ keepSelection: true });
  }
  return true;
}

async function loadStorageFromCloud(options = {}) {
  const force = Boolean(options.force);
  if (!supabaseClient || isCloudSleeping || isAppInBackground() || isResettingTableData) return;
  if (isPhotoImporting) return;
  if (deferCloudRefreshDuringKeyWork()) return;
  if (isCloudCheckRunning) {
    shouldReloadCloudAfterCurrentCheck = shouldReloadCloudAfterCurrentCheck || force;
    shouldFullyReloadCloudAfterCurrentCheck = shouldFullyReloadCloudAfterCurrentCheck || Boolean(options.full);
    return;
  }
  if (!force && hasLoadedCloudState && document.visibilityState === "hidden") return;
  isCloudCheckRunning = true;
  await pendingCloudSync.catch(() => {});
  if (hasLoadedCloudState) {
    await retryFailedCloudSyncs();
  }
  try {
    if (hasLoadedCloudState && options.full) {
      await reloadCompleteCloudState();
      return;
    }

    if (!hasLoadedCloudState) {
      const pendingStartupKeys = new Set(getPendingCloudSyncKeys());
      const [{ data, error }, { data: legacyKeyRows, error: legacyKeyRowsError }, slotRows] = await Promise.all([
        supabaseClient
          .from("app_state")
          .select("key,value,updated_at")
          .in("key", getCloudBaseStorageKeys()),
        supabaseClient
          .from("app_state")
          .select("key,value,updated_at")
          .in("key", getKeyStorageKeys()),
        loadKeySlotCloudRows(),
      ]);
      if (error) throw error;
      if (legacyKeyRowsError) throw legacyKeyRowsError;
      const cloudBaseRows = Array.isArray(data) ? [...data] : [];
      if (!cloudBaseRows.length && (!Array.isArray(legacyKeyRows) || !legacyKeyRows.length) && !slotRows.length) {
        if (shouldMigrateLegacyStorage) {
          console.warn("Supabase initial load returned no app state rows; cloud writes remain locked.");
          return;
        }

        const initializedAt = new Date().toISOString();
        const initialHeartbeat = {
          version: appBuildVersion,
          initializedAt,
        };
        const cloudUpdatedAt = await upsertCloudRowWithFreshVersion(cloudSyncHeartbeatStorageKey, initialHeartbeat);
        if (!cloudUpdatedAt) return;
        cloudBaseRows.push({
          key: cloudSyncHeartbeatStorageKey,
          value: initialHeartbeat,
          updated_at: cloudUpdatedAt,
        });
      }

      isApplyingCloudState = true;
      cloudBaseRows.forEach((row) => {
        if (row.key === cloudSyncHeartbeatStorageKey) {
          cloudRowVersions.set(row.key, row.updated_at || "");
          return;
        }
        if (!pendingStartupKeys.has(row.key)) saveStorageValue(row.key, stringifyCloudValue(row.value));
        cloudRowVersions.set(row.key, row.updated_at || "");
      });
      tableSettings = loadTableSettings();
      hasResolvedInitialAccessSettings = true;
      applyInitialCloudKeyStorageState(legacyKeyRows, slotRows, pendingStartupKeys);
      isApplyingCloudState = false;
      hasLoadedCloudState = true;
      hasCompletedInitialCloudLoad = true;
      shouldSanitizeCachedArchivedResidues = false;
      saveCloudRowVersions();
      await syncCurrentRegistryToCloud();
      if (pendingStartupKeys.size) {
        const syncablePendingKeys = [...pendingStartupKeys].filter((key) => getCloudStorageKeys().includes(key));
        await Promise.all(syncablePendingKeys.map((key) => syncStorageKeyToCloud(key)));
      }
      updateAccessLockState();
      refreshDataFromStorage({ keepSelection: true });
      return;
    }

    const { data: allMetadata, error: metadataError } = await supabaseClient
      .from("app_state")
      .select("key,updated_at");
    if (metadataError) throw metadataError;
    if (deferCloudRefreshDuringKeyWork()) return;
    const cloudBaseStorageKeys = new Set(getCloudBaseStorageKeys());
    const metadata = (Array.isArray(allMetadata) ? allMetadata : []).filter(
      (row) => cloudBaseStorageKeys.has(row.key) || isKeySlotCloudKey(row.key),
    );
    if (!Array.isArray(metadata)) return;

    const metadataByKey = new Map(metadata.map((row) => [row.key, row]));
    const remoteVersions = new Map(metadata.map((row) => [row.key, row.updated_at || ""]));
    const changedKeys = metadata
      .filter((row) => {
        if (row.key === cloudSyncHeartbeatStorageKey || isKeysStorageKey(row.key)) return false;
        const versionChanged = cloudRowVersions.get(row.key) !== (row.updated_at || "");
        const missingLocalBaseRow = !isKeySlotCloudKey(row.key) && getRuntimeStorageValue(row.key) === null;
        return versionChanged || missingLocalBaseRow;
      })
      .map((row) => row.key);
    const missingRemoteKeys = [...cloudRowVersions.keys()].filter(
      (key) => (getCloudBaseStorageKeys().includes(key) || isKeySlotCloudKey(key)) && !remoteVersions.has(key),
    );
    const locallyDirtyMissingKeys = missingRemoteKeys.filter(hasPendingCloudRowChange);
    if (locallyDirtyMissingKeys.length) {
      await Promise.all([...new Set(locallyDirtyMissingKeys.map(getSyncStorageKeyForCloudKey))].map((key) => syncStorageKeyToCloud(key)));
    }
    const deletedKeys = missingRemoteKeys.filter((key) => !locallyDirtyMissingKeys.includes(key));
    if (!changedKeys.length && !deletedKeys.length) {
      let didUpdateMetadataVersion = false;
      metadata.forEach((row) => {
        const updatedAt = row.updated_at || "";
        if (cloudRowVersions.get(row.key) === updatedAt) return;
        cloudRowVersions.set(row.key, updatedAt);
        didUpdateMetadataVersion = true;
      });
      if (didUpdateMetadataVersion) saveCloudRowVersions();
      return;
    }

    const locallyDirtyChangedKeys = changedKeys.filter((key) => {
      const pendingWrite = isKeySlotCloudKey(key) ? getPendingKeySlotWrite(key) : null;
      if (pendingWrite && cloudRowIsNewerThanPendingKeySlotWrite(metadataByKey.get(key), pendingWrite)) {
        discardPendingKeySlotWrite(key);
        return false;
      }
      return hasPendingCloudRowChange(key);
    });
    if (locallyDirtyChangedKeys.length) {
      await Promise.all([...new Set(locallyDirtyChangedKeys.map(getSyncStorageKeyForCloudKey))].map((key) => syncStorageKeyToCloud(key)));
    }
    const cloudOnlyChangedKeys = changedKeys.filter((key) => !locallyDirtyChangedKeys.includes(key));
    if (!cloudOnlyChangedKeys.length && !deletedKeys.length) return;

    const changedRows = await loadCloudRowsByKeys(cloudOnlyChangedKeys);
    if (deferCloudRefreshDuringKeyWork()) return;

    isApplyingCloudState = true;
    changedRows.forEach((row) => {
      if (row.key === cloudSyncHeartbeatStorageKey) return;
      if (isKeySlotCloudKey(row.key)) {
        saveKeySlotCloudRow(row);
        rememberSlotCloudSeenAt(row);
      } else {
        saveStorageValue(row.key, stringifyCloudValue(row.value));
      }
    });
    deletedKeys.forEach((key) => {
      if (!isKeySlotCloudKey(key) && !isKeysStorageKey(key)) removeRuntimeStorageValue(key);
    });
    isApplyingCloudState = false;
    metadata.forEach((row) => {
      if (!locallyDirtyChangedKeys.includes(row.key)) cloudRowVersions.set(row.key, row.updated_at || "");
    });
    changedRows.forEach((row) => cloudRowVersions.set(row.key, row.updated_at || ""));
    deletedKeys.forEach((key) => cloudRowVersions.delete(key));
    saveCloudRowVersions();
    refreshDataFromStorage({ keepSelection: true });
  } catch (error) {
    console.warn("Supabase load failed", error.message);
  } finally {
    isApplyingCloudState = false;
    isCloudCheckRunning = false;
    if (shouldReloadCloudAfterCurrentCheck) {
      const shouldReloadFully = shouldFullyReloadCloudAfterCurrentCheck;
      shouldReloadCloudAfterCurrentCheck = false;
      shouldFullyReloadCloudAfterCurrentCheck = false;
      setTimeout(() => loadStorageFromCloud({ force: true, full: shouldReloadFully }), 0);
    }
  }
}

function updateUndoButton() {
  undoBtn.disabled = !undoSnapshot;
}

function createUndoSnapshot() {
  const storage = {};
  getBackupStorageKeys().forEach((key) => {
    storage[key] = getRuntimeStorageValue(key);
  });

  return {
    storage,
    selectedId,
    selectedSetId,
    activeContactType,
  };
}

function rememberUndoStep() {
  undoSnapshot = createUndoSnapshot();
  updateUndoButton();
}

function restoreStorageSnapshot(snapshot) {
  const changedKeys = [];
  getBackupStorageKeys().forEach((key) => {
    const value = snapshot.storage[key];
    const previousValue = getRuntimeStorageValue(key);
    if (previousValue === value) return;
    saveStorageValue(key, value);
    markChangedKeySlots(key, getRuntimeStorageValue(key), previousValue);
    changedKeys.push(key);
  });
  changedKeys.forEach((key) => dirtyCloudKeys.add(key));
  savePendingCloudKeys();
  Promise.all(changedKeys.map(syncStorageKeyToCloud));
}

function undoPreviousStep() {
  if (!undoSnapshot) return;

  const snapshot = undoSnapshot;
  undoSnapshot = null;
  restoreStorageSnapshot(snapshot);
  tableSettings = loadTableSettings();
  activeRegistry = loadActiveRegistry();
  keys = loadKeys();
  archives = loadArchives();
  contacts = loadContacts();
  selectedId = snapshot.selectedId;
  selectedSetId = snapshot.selectedSetId || "main";
  activeContactType = snapshot.activeContactType || "internal";
  hoveredKeyId = null;
  isDetailPanelHovered = false;
  clearSignature();
  updateRegistryHeader();
  render();
  updateUndoButton();
}

function getRegistryConfig() {
  return registryConfig[activeRegistry] || registryConfig.location;
}

function updateRegistryHeader() {
  const config = getRegistryConfig();
  const targetRegistry = activeRegistry === "location" ? "transaction" : "location";
  const targetConfig = registryConfig[targetRegistry];
  appTitleText.textContent = config.title;
  if (agencyNameLabel) agencyNameLabel.textContent = tableSettings?.agencyName || "Agence";
  updateAccessLockTitle();
  document.title = "Quialakey";
  registryToggleBtn.textContent = config.toggleLabel;
  rentedBtn.textContent = config.archiveActionLabel;
  transferKeyBtn.textContent = `Transférer vers ${targetConfig.title}`;
  rentedArchiveTitle.textContent = config.rentedArchiveTitle;
  compromisesTabBtn.hidden = activeRegistry !== "transaction";
  topActions?.classList.toggle("is-location-only", activeRegistry === "location");
  rentedArchiveSection.hidden = activeRegistry === "transaction";
  authenticatedArchiveSection.hidden = activeRegistry !== "transaction";
  const orderedArchiveSections =
    activeRegistry === "transaction"
      ? [authenticatedArchiveSection, removedArchiveSection, rentedArchiveSection]
      : [rentedArchiveSection, removedArchiveSection, authenticatedArchiveSection];
  orderedArchiveSections.forEach((section) => archivesPanel.append(section));
  if (registryHistoryDataLabel) {
    registryHistoryDataLabel.textContent = activeRegistry === "location" ? "Historique Location" : "Historique Transaction";
  }
  if (activeRegistry !== "transaction") compromisesPanel.hidden = true;
  registryToggleBtn.title =
    activeRegistry === "location" ? "Basculer vers le registre Transaction" : "Basculer vers le registre Location";
}

function closeSidePanels() {
  contactsPanel.hidden = true;
  compromisesPanel.hidden = true;
  archivesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
}

function switchRegistry() {
  endKeyWorkProtection();
  pendingNewKeyDraft = null;
  activeRegistry = activeRegistry === "location" ? "transaction" : "location";
  saveActiveRegistry();
  tableSettings = loadTableSettings();
  keys = loadKeys();
  archives = loadArchives();
  contacts = loadContacts();
  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  hoveredKeyId = null;
  isDetailPanelHovered = false;
  closeSidePanels();
  clearTimeout(detailCloseTimer);
  clearSignature();
  migrateArchivedSlots();
  updateRegistryHeader();
  render();
}

function makeInitialKeys() {
  return getTableCategories().flatMap((category) =>
    Array.from({ length: getSlotsPerCategory() }, (_, index) => ({
      id: `${category.id}-${index + 1}`,
      category: category.id,
      number: index + 1,
      property: "",
      postalCode: "",
      city: "",
      owner: "",
      ownerFirstName: "",
      notes: "",
      photo: "",
      archived: false,
      sets: [makeKeySet("main")],
    })),
  );
}

function mergeKeysWithCurrentLayout(savedKeys) {
  const normalizedSavedKeys = Array.isArray(savedKeys) ? savedKeys.map(normalizeKey) : [];
  const savedById = new Map(normalizedSavedKeys.map((key) => [key.id, key]));
  const layoutKeys = makeInitialKeys().map((emptyKey) => savedById.get(emptyKey.id) || emptyKey);
  const layoutIds = new Set(layoutKeys.map((key) => key.id));
  const hiddenSavedKeys = normalizedSavedKeys.filter((key) => !layoutIds.has(key.id));
  return [...layoutKeys, ...hiddenSavedKeys];
}

function makeEmptyKey(key) {
  return {
    id: key.id,
    category: key.category,
    number: key.number,
    property: "",
    postalCode: "",
    city: "",
    owner: "",
    ownerFirstName: "",
    notes: "",
    photo: "",
    archived: false,
    sets: [makeKeySet("main")],
  };
}

function normalizeSet(set, index = 0) {
  const fallback = keySetOptions[index] || keySetOptions[0];
  const id = keySetOptions.some((option) => option.id === set.id) ? set.id : fallback.id;
  const option = keySetOptions.find((savedOption) => savedOption.id === id) || fallback;
  const status = set.status === "out" ? "out" : "available";
  const reservations = Array.isArray(set.reservations) ? set.reservations.filter(isActiveReservation) : [];
  const migratedReservationId = `reservation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const migratedReservation =
    set.status === "reserved" && (set.holder || set.holderCompany || set.holderPhone)
      ? [
          {
            id: migratedReservationId,
            person: set.holder || "",
            company: set.holderCompany || "",
            phone: set.holderPhone || "",
            createdAt: "",
            reservationDate: "",
            note: "",
          },
        ]
      : [];

  return repairSetMovementState({
    id: option.id,
    label: option.label,
    photo: set.photo || "",
    holder: set.holder || "",
    holderCompany: set.holderCompany || "",
    holderPhone: set.holderPhone || "",
    holderReservationId: set.holderReservationId || "",
    needsCheckIn: Boolean(set.needsCheckIn),
    needsCheckInReason: set.needsCheckInReason || (set.needsCheckIn ? "added" : ""),
    status,
    reservations: reservations.length ? reservations : migratedReservation,
    history: Array.isArray(set.history)
      ? set.history.map((entry) => ({
          ...entry,
          id: entry.id || createHistoryId(),
          reservationId:
            migratedReservation.length && entry.type === "reserved" && !entry.reservationId
              ? migratedReservationId
              : entry.reservationId,
        }))
      : [],
  });
}

function normalizeKey(key) {
  let sets =
    Array.isArray(key.sets) && key.sets.length
      ? key.sets.slice(0, 4).map(normalizeSet)
      : [
          {
            ...makeKeySet("main"),
            photo: key.photo || "",
            holder: key.holder || "",
            status: key.status === "out" ? "out" : "available",
            reservations:
              key.status === "reserved" && key.holder
                ? [
                    {
                      id: `reservation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                      person: key.holder,
                      company: "",
                      phone: "",
                      createdAt: "",
                      reservationDate: "",
                      note: "",
                    },
                  ]
                : [],
            history: Array.isArray(key.history) ? key.history : [],
          },
        ];

  if (key.photo && !sets.some((set) => set.photo)) {
    sets = sets.map((set, index) => (index === 0 ? { ...set, photo: key.photo } : set));
  }

  return {
    id: key.id,
    category: key.category,
    number: key.number,
    property: formatConfigurablePropertyAddress(key.property || ""),
    postalCode: key.postalCode || "",
    city: key.city || "",
    owner: key.owner || "",
    ownerFirstName: formatFirstName(key.ownerFirstName || ""),
    notes: key.notes || "",
    photo: "",
    archived: Boolean(key.archived),
    sets,
  };
}

function loadKeys() {
  const storageKey = getRegistryConfig().keysStorageKey;
  const saved = getRuntimeStorageValue(storageKey);
  if (!saved) return makeInitialKeys();

  try {
    const parsed = JSON.parse(saved);
    const mergedKeys = Array.isArray(parsed) ? mergeKeysWithCurrentLayout(parsed) : makeInitialKeys();
    return sanitizeCachedArchivedResidues(storageKey, mergedKeys);
  } catch {
    return makeInitialKeys();
  }
}

function loadKeysForRegistry(registry) {
  const config = registryConfig[registry];
  if (!config) return makeInitialKeys();
  const saved = getRuntimeStorageValue(config.keysStorageKey);
  if (!saved) return makeInitialKeys();

  try {
    const parsed = JSON.parse(saved);
    const mergedKeys = Array.isArray(parsed) ? mergeKeysWithCurrentLayout(parsed) : makeInitialKeys();
    return sanitizeCachedArchivedResidues(config.keysStorageKey, mergedKeys);
  } catch {
    return makeInitialKeys();
  }
}

function saveKeys() {
  try {
    const storageKey = getRegistryConfig().keysStorageKey;
    const previousValue = getRuntimeStorageValue(storageKey);
    const nextValue = JSON.stringify(keys);
    markLocalEdit();
    setRuntimeStorageValue(storageKey, nextValue);
    markChangedKeySlots(storageKey, nextValue, previousValue);
    scheduleStorageKeySync(storageKey);
    scheduleDirectKeyStorageFlush(storageKey);
  } catch (error) {
    alert("La sauvegarde a échoué. Une photo est probablement trop lourde : essayez une image plus légère.");
    throw error;
  }
}

function saveKeysForRegistry(registry, nextKeys) {
  const config = registryConfig[registry];
  if (!config) return;

  try {
    const storageKey = config.keysStorageKey;
    const previousValue = getRuntimeStorageValue(storageKey);
    const nextValue = JSON.stringify(nextKeys.map(normalizeKey));
    markLocalEdit();
    setRuntimeStorageValue(storageKey, nextValue);
    markChangedKeySlots(storageKey, nextValue, previousValue);
    scheduleStorageKeySync(storageKey);
    scheduleDirectKeyStorageFlush(storageKey);
  } catch (error) {
    alert("La sauvegarde a échoué. Une photo est probablement trop lourde : essayez une image plus légère.");
    throw error;
  }
}

function normalizeArchive(record) {
  return {
    id: record.id || `archive-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    reason: record.reason || record.archiveReason || "rented",
    archivedAt: record.archivedAt || new Date().toISOString(),
    compromiseSignedAt: record.compromiseSignedAt || "",
    key: normalizeKey(record.key || record),
  };
}

function loadArchives() {
  const saved = getRuntimeStorageValue(getRegistryConfig().archivesStorageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.map(normalizeArchive) : [];
  } catch {
    return [];
  }
}

function saveArchives() {
  try {
    markLocalEdit();
    setRuntimeStorageValue(getRegistryConfig().archivesStorageKey, JSON.stringify(archives));
    scheduleStorageKeySync(getRegistryConfig().archivesStorageKey);
  } catch (error) {
    alert("La sauvegarde a échoué. Une photo ou une signature est probablement trop lourde.");
    throw error;
  }
}

function migrateArchivedSlots() {
  const archivedKeys = keys.filter((key) => key.archived);
  if (!archivedKeys.length) return;

  const existingArchiveIds = new Set(archives.map((record) => record.id));
  const migratedArchives = archivedKeys
    .map((key) => ({
      id: `${key.id}-${key.archivedAt || Date.now()}`,
      reason: key.archiveReason || "rented",
      archivedAt: key.archivedAt || new Date().toISOString(),
      key: { ...key, archived: false },
    }))
    .filter((record) => !existingArchiveIds.has(record.id));

  archives = [...archives, ...migratedArchives];
  keys = keys.map((key) => (key.archived ? makeEmptyKey(key) : key));
  saveArchives();
  saveKeys();
}

function createContactId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `contact-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatPhoneNumber(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  if (!digits) return "";
  return digits.match(/.{1,2}/g).join(" ");
}

function getPhoneDigitCount(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function ensureCompletePhoneNumber(input, label = "num\u00e9ro de t\u00e9l\u00e9phone") {
  const digitCount = getPhoneDigitCount(input.value);
  if (!digitCount || digitCount === 10) return true;

  alert(`Le ${label} semble incomplet : il faut 10 chiffres.`);
  input.focus();
  return false;
}

function ensureTypedMovementPhone(actionLabel) {
  if (contactSelect.value) return true;

  const typedActor = getTypedMovementActor();
  const hasTypedActor = Boolean(typedActor.person || typedActor.company);
  if (!hasTypedActor) return true;

  const digitCount = getPhoneDigitCount(movementPhoneInput.value);
  if (!digitCount) {
    alert(`Renseigne le num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant avant de cliquer sur ${actionLabel}.`);
    movementPhoneInput.focus();
    return false;
  }

  return ensureCompletePhoneNumber(movementPhoneInput, "num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant");
}

function formatCity(value) {
  return String(value || "").replace(/(^|[\s-])(\p{L})/gu, (match, separator, letter) => {
    return `${separator}${letter.toLocaleUpperCase("fr-FR")}`;
  });
}

function formatPropertyAddress(value) {
  const roadTypes = [
    ["avenues?", "av."],
    ["boulevards?", "blv."],
    ["places?", "pl."],
    ["routes?", "rte"],
    ["allées?|allees?", "all."],
    ["chemins?", "ch."],
    ["impasses?", "imp."],
    ["passages?", "pas."],
    ["esplanades?", "esp."],
  ];
  let address = String(value || "").toLocaleLowerCase("fr-FR");
  roadTypes.forEach(([roadType, abbreviation]) => {
    address = address.replace(
      new RegExp(`(^|[^\\p{L}])(?:${roadType})(?=$|[^\\p{L}])`, "giu"),
      (match, prefix) => `${prefix}${abbreviation}`,
    );
  });
  return address.replace(/(^|[\s'\-’])(\p{L})/gu, (match, separator, letter) => {
    return `${separator}${letter.toLocaleUpperCase("fr-FR")}`;
  });
}

function formatConfigurablePropertyAddress(value) {
  let address = String(value || "").toLocaleLowerCase("fr-FR");
  getAddressReplacements().forEach(({ word, replacement }) => {
    const normalizedWord = String(word || "").trim();
    const abbreviation = String(replacement || "").trim();
    if (!normalizedWord || !abbreviation) return;
    const variants = [...new Set([normalizedWord, removeDiacritics(normalizedWord)].map((item) => item.toLocaleLowerCase("fr-FR")))];
    const pattern = variants.map(escapeRegExp).join("|");
    address = address.replace(
      new RegExp(`(^|[^\\p{L}])(?:${pattern})s?(?=$|[^\\p{L}])`, "giu"),
      (match, prefix) => `${prefix}${abbreviation}`,
    );
  });
  return address.replace(/(^|[\s'\-\u2019])(\p{L})/gu, (match, separator, letter) => {
    return `${separator}${letter.toLocaleUpperCase("fr-FR")}`;
  });
}

async function migrateStoredPropertyAddresses() {
  const changedStorageKeys = [];

  ["location", "transaction"].forEach((registry) => {
    const config = registryConfig[registry];
    const savedKeys = parseStoredArray(config.keysStorageKey, []);
    const formattedKeys = savedKeys.map((key) => ({
      ...key,
      property: formatConfigurablePropertyAddress(key.property || ""),
    }));
    if (JSON.stringify(formattedKeys) !== JSON.stringify(savedKeys)) {
      const previousValue = getRuntimeStorageValue(config.keysStorageKey);
      const nextValue = JSON.stringify(formattedKeys);
      setRuntimeStorageValue(config.keysStorageKey, nextValue);
      markChangedKeySlots(config.keysStorageKey, nextValue, previousValue);
      changedStorageKeys.push(config.keysStorageKey);
    }

    const savedArchives = parseStoredArray(config.archivesStorageKey, []);
    const formattedArchives = savedArchives.map((record) => ({
      ...record,
      key: record.key
        ? { ...record.key, property: formatConfigurablePropertyAddress(record.key.property || "") }
        : record.key,
    }));
    if (JSON.stringify(formattedArchives) !== JSON.stringify(savedArchives)) {
      setRuntimeStorageValue(config.archivesStorageKey, JSON.stringify(formattedArchives));
      changedStorageKeys.push(config.archivesStorageKey);
    }
  });

  if (!changedStorageKeys.length) return;
  markLocalEdit();
  changedStorageKeys.forEach((storageKey) => dirtyCloudKeys.add(storageKey));
  savePendingCloudKeys();
  await Promise.all(changedStorageKeys.map(syncStorageKeyToCloud));
  keys = loadKeys();
  archives = loadArchives();
}

function formatFirstName(value) {
  return String(value || "")
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s-])(\p{L})/gu, (match, separator, letter) => `${separator}${letter.toLocaleUpperCase("fr-FR")}`);
}

function formatCompanyName(value) {
  return String(value || "").replace(/(^|[\s-])(\p{L})/gu, (match, separator, letter) => {
    return `${separator}${letter.toLocaleUpperCase("fr-FR")}`;
  });
}

function formatSentenceStart(value) {
  return String(value || "").replace(/^(\s*)(\p{L})/u, (match, spaces, letter) => {
    return `${spaces}${letter.toLocaleUpperCase("fr-FR")}`;
  });
}

function formatLastName(value) {
  return String(value || "").toLocaleUpperCase("fr-FR");
}

function getMovementPersonInputName() {
  return [formatFirstName(movementPersonInput.value).trim(), formatLastName(movementNameInput.value).trim()].filter(Boolean).join(" ");
}

function getTypedMovementActor() {
  return {
    person: getMovementPersonInputName(),
    company: formatCompanyName(movementCompanyInput.value).trim(),
    phone: formatPhoneNumber(movementPhoneInput.value),
  };
}

function ensureMovementActor(actionLabel, fallbackActor = {}) {
  const typedActor = getTypedMovementActor();
  const hasSelectedContact = Boolean(contactSelect.value);
  const hasActor =
    hasSelectedContact ||
    Boolean(typedActor.person || typedActor.company || fallbackActor.person || fallbackActor.company);

  if (hasActor) return true;

  alert(`Renseigne ou choisis un intervenant avant de cliquer sur ${actionLabel}.`);
  movementNameInput.focus();
  return false;
}

function getContactDisplayName(contact) {
  if (contact.type === "external") {
    return [contact.firstName, formatLastName(contact.name), contact.companyName].filter(Boolean).join(" ");
  }

  return [contact.firstName, formatLastName(contact.name)].filter(Boolean).join(" ");
}

function getContactHistoryName(contact) {
  if (contact.type === "external") {
    return [contact.companyName, contact.firstName || formatLastName(contact.name)].filter(Boolean).join(" - ") || "Intervenant externe";
  }

  return contact.firstName || formatLastName(contact.name) || "Intervenant interne";
}

function contactTypeText(type) {
  return type === "external" ? "Intervenant externe" : "Intervenant interne";
}

function getContactSelectName(contact) {
  if (contact.type === "external") {
    return [contact.companyName || contact.name, contact.firstName].filter(Boolean).join(" - ");
  }

  return contact.firstName || contact.name;
}

function getMovementContactName(contact) {
  if (contact.type === "external") {
    return [contact.companyName || contact.name, contact.firstName].filter(Boolean).join(" - ");
  }

  return getContactDisplayName(contact);
}

function getDefaultInternalContactActor() {
  const contact = contacts.find((savedContact) => savedContact.type === "internal");
  if (!contact) return { person: "", phone: "" };

  return {
    person: getContactDisplayName(contact),
    phone: formatPhoneNumber(contact.phone),
  };
}

function getHistoryPersonName(entry) {
  let person = entry.person || entry.company || "Intervenant non pr\u00e9cis\u00e9";
  const company = String(entry.company || "").trim();
  if (company && person.startsWith(`${company} - `)) {
    person = person.slice(company.length + 3).trim();
  }

  return [person, entry.phone ? formatPhoneNumber(entry.phone) : ""].filter(Boolean).join(" - ");
}

function formatReservationHistoryDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})$/);
  if (!match) return text;
  return `${match[1]} \u00e0 ${match[2]}`;
}

function isReturnMovement(entry, history = []) {
  if (entry?.type !== "in") return false;
  if (entry.returnReason === "returned") return true;
  if (entry.returnReason === "created") return false;
  if (/^Rentr\u00e9e?/.test(String(entry.reservationMovement || ""))) return true;

  const movements = [...history]
    .filter((item) => item.type === "out" || item.type === "in")
    .sort((first, second) => parseHistoryTimestamp(second.date) - parseHistoryTimestamp(first.date));
  const entryIndex = movements.findIndex((item) => item.id === entry.id);
  if (entryIndex < 0) return false;

  return movements.slice(entryIndex + 1).find((item) => item.type === "out" || item.type === "in")?.type === "out";
}

function getMovementActionLabel(entry, history = []) {
  if (entry?.type === "out") return "Sorti";
  if (entry?.type === "reserved") return "R\u00e9serv\u00e9";
  if (entry?.type === "cancel-reservation") return "Annulation";
  if (entry?.type === "removed") return "Archiv\u00e9";
  if (entry?.type === "rented") return entry.actionLabel || getRegistryConfig().archiveActionLabel;
  if (entry?.type === "in") return isReturnMovement(entry, history) ? "Rentr\u00e9" : "Entr\u00e9";
  return "Entr\u00e9";
}

function normalizeMovementWords(value) {
  return String(value || "")
    .replace(/\bRentr\u00e9e\b/g, "Rentr\u00e9")
    .replace(/\bEntr\u00e9e\b/g, "Entr\u00e9")
    .replace(/\bSortie\b/g, "Sorti");
}

function sortKeyHistoryEntries(first, second) {
  return parseHistoryTimestamp(second.date) - parseHistoryTimestamp(first.date);
}

function getReservationPersonName(reservation) {
  return [reservation.company, reservation.person].filter(Boolean).join(" - ") || "intervenant non renseign\u00e9";
}

function showCheckoutReservationWarning(set, ignoredReservationId = "") {
  const nextReservation = [...(set.reservations || [])]
    .filter(isActiveReservation)
    .filter((reservation) => reservation.id !== ignoredReservationId)
    .sort((first, second) => parseHistoryTimestamp(first.reservationDate || first.createdAt) - parseHistoryTimestamp(second.reservationDate || second.createdAt))[0];
  if (!nextReservation) return;

  alert(
    `ATTENTION ! Ce jeu de cl\u00e9s est r\u00e9serv\u00e9 par ${getReservationPersonName(nextReservation)} le ${formatReservationHistoryDate(nextReservation.reservationDate || nextReservation.createdAt)} ; pense bien \u00e0 le remettre sur le tableau avant !`,
  );
}

function normalizeContact(contact) {
  const type = contact.type === "external" ? "external" : "internal";

  return {
    id: contact.id || createContactId(),
    firstName: formatFirstName(contact.firstName).trim(),
    name: type === "external" && !contact.companyName ? "" : formatLastName(contact.name).trim(),
    companyName: type === "external" ? formatCompanyName(contact.companyName || contact.name).trim() : "",
    phone: formatPhoneNumber(contact.phone),
    type,
  };
}

function loadContacts() {
  const saved = getRuntimeStorageValue(sharedContactsStorageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? parsed.map(normalizeContact).filter((contact) => contact.name || contact.companyName)
      : [];
  } catch {
    return [];
  }
}

function saveContacts() {
  markLocalEdit();
  setRuntimeStorageValue(sharedContactsStorageKey, JSON.stringify(contacts));
  scheduleStorageKeySync(sharedContactsStorageKey);
}

function getSelectedKey() {
  if (selectedArchiveRecord) {
    return {
      ...normalizeKey(selectedArchiveRecord.key),
      archived: true,
    };
  }
  if (pendingNewKeyDraft?.id === selectedId) return pendingNewKeyDraft;
  return keys.find((key) => key.id === selectedId);
}

function isPendingNewKeyDraft(keyId = selectedId) {
  return Boolean(keyId && pendingNewKeyDraft?.id === keyId);
}

function beginPendingNewKeyDraft(key) {
  pendingNewKeyDraft = key && !isKeyFilled(key) ? normalizeKey(JSON.parse(JSON.stringify(key))) : null;
}

function discardPendingNewKeyDraft() {
  pendingNewKeyDraft = null;
  activeKeyInfoDraft = null;
}

function commitPendingNewKeyDraft() {
  if (!isPendingNewKeyDraft()) return null;
  const draft = normalizeKey(pendingNewKeyDraft);
  const storageKey = getRegistryConfig().keysStorageKey;
  rememberUndoStep();
  pendingNewKeyDraft = null;
  activeKeyInfoDraft = null;
  keys = keys.map((key) => (key.id === draft.id ? draft : key));
  markDirtyKeySlot(draft.id, storageKey);
  saveKeys();
  logActivity(
    "Cr\u00e9ation fiche",
    `${keyLabel(draft)}${draft.owner ? ` - ${formatOwner(draft.owner)}` : ""}`,
    [draft.owner, draft.property].filter(Boolean).join(" - "),
  );
  if (draft.sets.length > 1) {
    logActivity(
      "Ajout jeu",
      `${keyLabel(draft)}${draft.owner ? ` - ${formatOwner(draft.owner)}` : ""}`,
      `${draft.sets.length} jeux au total`,
    );
  }
  return draft;
}

function getSelectedSet(key = getSelectedKey()) {
  if (!key) return null;
  return key.sets.find((set) => set.id === selectedSetId) || key.sets[0];
}

function getSelectedHistoryExpansionId(key = getSelectedKey()) {
  if (!key) return "";
  const setId = selectedSetId || getSelectedSet(key)?.id || "main";
  const sourceId = selectedArchiveRecord ? `archive:${selectedArchiveRecord.id}` : activeRegistry;
  return `${sourceId}:${key.id}:${setId}`;
}

function isSelectedHistoryExpanded(key = getSelectedKey()) {
  const historyId = getSelectedHistoryExpansionId(key);
  return Boolean(historyId && expandedKeyHistoryIds.has(historyId));
}

function toggleSelectedHistory() {
  const historyId = getSelectedHistoryExpansionId();
  if (!historyId) return;
  if (expandedKeyHistoryIds.has(historyId)) expandedKeyHistoryIds.delete(historyId);
  else expandedKeyHistoryIds.add(historyId);
  renderPanel();
}

function getSelectedDetailsExpansionId(key = getSelectedKey()) {
  if (!key) return "";
  const sourceId = selectedArchiveRecord ? `archive:${selectedArchiveRecord.id}` : activeRegistry;
  return `${sourceId}:${key.id}`;
}

function isSelectedDetailsExpanded(key = getSelectedKey()) {
  const detailsId = getSelectedDetailsExpansionId(key);
  return Boolean(detailsId && expandedKeyDetailsIds.has(detailsId));
}

function toggleSelectedDetails() {
  const detailsId = getSelectedDetailsExpansionId();
  if (!detailsId) return;
  if (expandedKeyDetailsIds.has(detailsId)) expandedKeyDetailsIds.delete(detailsId);
  else expandedKeyDetailsIds.add(detailsId);
  renderPanel();
}

function keyLabel(key) {
  const prefix = getCategoryCasePrefix(key.category);
  return `${prefix ? `${prefix} ` : ""}#${key.number}`;
}

function tilePrefix(key) {
  return getCategoryCasePrefix(key.category);
}

function tileLabel(key) {
  const prefix = tilePrefix(key);
  return `${prefix ? `${prefix} ` : ""}#${key.number}`;
}

function keyLabelVariants(key) {
  const category = getCategorySetting(key.category);
  if (!category) return [keyLabel(key)];
  return [...new Set([keyLabel(key), ...getCategoryAliases(category).map((alias) => `${alias} #${key.number}`)])];
}

function isValidPhoto(photo) {
  return typeof photo === "string" && photo.startsWith("data:image/") && photo.length >= 200;
}

function getDisplayPhoto(key) {
  return key.sets?.find((set) => isValidPhoto(set.photo))?.photo || "";
}

function formatOwner(owner) {
  return (owner || "").toLocaleUpperCase("fr-FR");
}

function getStatus(key) {
  if (key.archived) return "archived";
  if (key.sets.some((set) => set.status === "out")) return "out";
  return key.sets.some(hasActiveReservations) ? "reserved" : "available";
}

function isKeyFilled(key) {
  return Boolean(
    key.property?.trim() ||
      key.postalCode?.trim() ||
      key.city?.trim() ||
      key.owner?.trim() ||
      key.ownerFirstName?.trim() ||
      key.notes?.trim() ||
      key.sets?.some((set) => set.photo || set.holder?.trim() || set.history?.length || hasActiveReservations(set)),
  );
}

function hasProtectedKeyInfo(key) {
  return Boolean(
    key?.owner?.trim() ||
      key?.ownerFirstName?.trim() ||
      key?.property?.trim() ||
      key?.postalCode?.trim() ||
      key?.city?.trim() ||
      key?.notes?.trim(),
  );
}

function resetKeyInfoEditUnlock(key) {
  isKeyInfoEditUnlocked = key ? !hasProtectedKeyInfo(key) : false;
}

function unlockKeyInfoEdit(event) {
  const key = getSelectedKey();
  const isArchiveView = Boolean(selectedArchiveRecord);
  if (!key || isArchiveView || isKeyInfoEditUnlocked || !hasProtectedKeyInfo(key)) return;

  const ownerName = key.owner ? formatOwner(key.owner) : "PROPRI\u00c9TAIRE NON RENSEIGN\u00c9";
  const confirmed = confirm(
    `Souhaitez-vous apporter des modifications sur la fiche de cl\u00e9 du bien de monsieur et/ou madame "${ownerName}" ?`,
  );
  if (!confirmed) return;

  isKeyInfoEditUnlocked = true;
  render();
  event?.currentTarget?.focus?.();
}

function hasActiveReservations(set) {
  return Array.isArray(set?.reservations) && set.reservations.some(isActiveReservation);
}

function getSetForReservation(key, reservationId) {
  if (!key || !reservationId) return null;
  return (
    key.sets.find((set) => (set.reservations || []).some((reservation) => reservation.id === reservationId)) ||
    key.sets.find((set) => (set.history || []).some((entry) => entry.reservationId === reservationId)) ||
    null
  );
}

function isActiveReservation(reservation) {
  return Boolean(
    reservation &&
      (String(reservation.reservationDate || "").trim() ||
        String(reservation.createdAt || "").trim() ||
        String(reservation.note || "").trim()),
  );
}

function getSetDisplayStatus(set) {
  if (set.status === "out") return "out";
  return hasActiveReservations(set) ? "reserved" : "available";
}

function getTileStatus(key) {
  if (key.archived) return "archived";
  if (key.sets.some((set) => set.status === "out")) return "out";
  if (key.sets.some(hasActiveReservations)) return "reserved";
  return isKeyFilled(key) ? "available" : "empty";
}

function getCountableSets(key) {
  if (key.archived || !isKeyFilled(key)) return [];
  return key.sets || [];
}

function keyHasSetStatus(key, filter) {
  if (filter === "all") return true;
  return getCountableSets(key).some((set) => getSetDisplayStatus(set) === filter);
}

function getKeyStatusCounts() {
  return keys.reduce(
    (counts, key) => {
      getCountableSets(key).forEach((set) => {
        const status = getSetDisplayStatus(set);
        counts.all += 1;
        if (status === "available") counts.available += 1;
        if (status === "reserved") counts.reserved += 1;
        if (status === "out") counts.out += 1;
      });
      return counts;
    },
    { all: 0, available: 0, reserved: 0, out: 0 },
  );
}

function getCompromiseMovementStatus(record) {
  const sets = record?.key?.sets || [];
  if (sets.some((set) => set.status === "out")) return "out";
  if (sets.some(hasActiveReservations)) return "reserved";
  return "";
}

function statusText(key) {
  if (key.archived) return "Archivée";
  const outCount = key.sets.filter((set) => set.status === "out").length;
  const reservedCount = key.sets.filter(hasActiveReservations).length;
  if (outCount) return key.sets.length === 1 ? "Sorti" : `${outCount} jeu${outCount > 1 ? "x" : ""} sorti${outCount > 1 ? "s" : ""}`;
  if (reservedCount) return key.sets.length === 1 ? "Réservé" : `${reservedCount} jeu${reservedCount > 1 ? "x" : ""} réservé${reservedCount > 1 ? "s" : ""}`;
  return "Disponible";
}

function cloneKeyContent(key) {
  return {
    property: key.property || "",
    postalCode: key.postalCode || "",
    city: key.city || "",
    owner: key.owner || "",
    ownerFirstName: key.ownerFirstName || "",
    notes: key.notes || "",
    photo: key.photo || "",
    archived: false,
    sets: JSON.parse(JSON.stringify(key.sets || [makeKeySet("main")])),
  };
}

function applyKeyContent(slot, content) {
  return {
    ...slot,
    property: content.property || "",
    postalCode: content.postalCode || "",
    city: content.city || "",
    owner: content.owner || "",
    ownerFirstName: content.ownerFirstName || "",
    notes: content.notes || "",
    photo: content.photo || "",
    archived: false,
    sets: JSON.parse(JSON.stringify(content.sets || [makeKeySet("main")])),
  };
}

function clearActiveKeySlotForSync(keyId) {
  const storageKey = getRegistryConfig().keysStorageKey;
  const sourceKey = keys.find((savedKey) => savedKey.id === keyId);
  if (!sourceKey) return null;
  const emptyKey = makeEmptyKey(sourceKey);
  keys = keys.map((savedKey) => (savedKey.id === keyId ? emptyKey : savedKey));
  rememberClearedKeySlot(keyId, storageKey);
  rememberForcedKeySlot(keyId, emptyKey, storageKey);
  markDirtyKeySlot(keyId, storageKey);
  dirtyCloudKeys.add(storageKey);
  savePendingCloudKeys();
  return emptyKey;
}

async function moveKeyToSlot(sourceId, targetId, options = {}) {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const sourceKey = keys.find((key) => key.id === sourceId);
  const targetKey = keys.find((key) => key.id === targetId);
  if (!sourceKey || !targetKey || !isKeyFilled(sourceKey)) return;

  const shouldCopy = false;
  const sourceContent = cloneKeyContent(sourceKey);
  const targetContent = cloneKeyContent(targetKey);
  const targetIsFilled = isKeyFilled(targetKey);
  const message = shouldCopy
    ? targetIsFilled
      ? `Copier ${keyLabel(sourceKey)} vers ${keyLabel(targetKey)} ?\n\nLa case de destination est déjà renseignée : elle sera remplacée.`
      : `Copier ${keyLabel(sourceKey)} vers ${keyLabel(targetKey)} ?`
    : targetIsFilled
      ? `Déplacer ${keyLabel(sourceKey)} vers ${keyLabel(targetKey)} ?\n\nLa case de destination est déjà renseignée : les deux fiches seront échangées.`
      : `Déplacer ${keyLabel(sourceKey)} vers ${keyLabel(targetKey)} ?`;

  if (!confirm(message)) return;
  rememberUndoStep();

  keys = keys.map((key) => {
    if (key.id === targetId) return applyKeyContent(key, sourceContent);
    if (shouldCopy) return key;
    if (key.id === sourceId) return targetIsFilled ? applyKeyContent(key, targetContent) : makeEmptyKey(key);
    return key;
  });
  rememberForcedKeySlot(targetId, sourceContent);
  markDirtyKeySlot(targetId);
  if (targetIsFilled) rememberForcedKeySlot(sourceId, targetContent);
  else {
    const emptySource = makeEmptyKey(sourceKey);
    rememberClearedKeySlot(sourceId);
    rememberForcedKeySlot(sourceId, emptySource);
  }
  markDirtyKeySlot(sourceId);
  forgetFilledClearedKeySlots(keys);

  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  resetKeyInfoEditUnlock(null);
  endKeyWorkProtection();
  saveKeys();
  render();
  await syncCloudAfterAction();
}

async function transferSelectedKeyToOtherRegistry() {
  if (selectedArchiveRecord) return;
  captureActiveKeyInfoDraft();
  endKeyWorkProtection({ refresh: false });
  await loadStorageFromCloud({ force: true });

  const sourceRegistry = activeRegistry;
  const targetRegistry = sourceRegistry === "location" ? "transaction" : "location";
  const sourceConfig = registryConfig[sourceRegistry];
  const targetConfig = registryConfig[targetRegistry];
  const sourceKey = getSelectedKey();

  if (!sourceKey || !isKeyFilled(sourceKey)) {
    alert("Aucune fiche renseignée à transférer.");
    return;
  }

  const targetKeys = loadKeysForRegistry(targetRegistry);
  const targetKey = targetKeys.find((key) => key.category === sourceKey.category && !isKeyFilled(key));

  if (!targetKey) {
    alert(`Aucun emplacement disponible dans les ${getCategoryLabel(sourceKey.category)} du tableau ${targetConfig.title}.`);
    return;
  }

  const ownerText = sourceKey.owner ? ` de ${formatOwner(sourceKey.owner)}` : "";
  const firstConfirmation = confirm(
    `Transférer ${keyLabel(sourceKey)}${ownerText} du tableau ${sourceConfig.title} vers ${keyLabel(targetKey)} du tableau ${targetConfig.title} ?\n\nLa fiche sera retirée de ${keyLabel(sourceKey)} dans ${sourceConfig.title}.`,
  );
  if (!firstConfirmation) return;

  const finalConfirmation = confirm(
    `Confirmez-vous le transfert vers "${targetConfig.title}" ?\n\nDestination : ${keyLabel(targetKey)}.`,
  );
  if (!finalConfirmation) return;

  rememberUndoStep();

  const sourceContent = cloneKeyContent(sourceKey);
  const emptiedSourceKey = makeEmptyKey(sourceKey);
  const sourceStorageKey = sourceConfig.keysStorageKey;
  const targetStorageKey = targetConfig.keysStorageKey;
  const nextSourceKeys = keys.map((key) => (key.id === sourceKey.id ? emptiedSourceKey : key));
  const nextTargetKeys = targetKeys.map((key) => (key.id === targetKey.id ? applyKeyContent(key, sourceContent) : key));
  const nextSelectedSetId = sourceKey.sets.some((set) => set.id === selectedSetId) ? selectedSetId : "main";

  saveKeysForRegistry(sourceRegistry, nextSourceKeys);
  saveKeysForRegistry(targetRegistry, nextTargetKeys);
  rememberClearedKeySlot(sourceKey.id, sourceStorageKey);
  rememberForcedKeySlot(sourceKey.id, emptiedSourceKey, sourceStorageKey);
  rememberForcedKeySlot(targetKey.id, sourceContent, targetStorageKey);
  markDirtyKeySlot(sourceKey.id, sourceStorageKey);
  markDirtyKeySlot(targetKey.id, targetStorageKey);
  dirtyCloudKeys.add(sourceStorageKey);
  dirtyCloudKeys.add(targetStorageKey);
  savePendingCloudKeys();

  activeKeyInfoDraft = null;
  activeRegistry = targetRegistry;
  saveActiveRegistry();
  keys = loadKeysForRegistry(targetRegistry);
  archives = loadArchives();
  contacts = loadContacts();
  selectedId = targetKey.id;
  selectedArchiveRecord = null;
  selectedSetId = nextSelectedSetId;
  resetKeyInfoEditUnlock(getSelectedKey());
  clearSignature();
  closeSidePanels();
  updateRegistryHeader();
  logActivity(
    "Transfert",
    `${keyLabel(targetKey)} - ${targetConfig.title}${sourceKey.owner ? ` - ${formatOwner(sourceKey.owner)}` : ""}`,
    `Depuis ${sourceConfig.title} ${keyLabel(sourceKey)}`,
  );
  render();
  await syncCloudAfterAction();
}

async function deleteKeyWithoutArchive(keyId) {
  const key = keys.find((savedKey) => savedKey.id === keyId);
  if (!key || !isKeyFilled(key)) return;

  const confirmed = confirm(`Supprimer définitivement la fiche ${keyLabel(key)} sans l'archiver ?`);
  if (!confirmed) return;
  rememberUndoStep();

  const emptyKey = makeEmptyKey(key);
  keys = keys.map((savedKey) => (savedKey.id === keyId ? emptyKey : savedKey));
  rememberClearedKeySlot(keyId);
  rememberForcedKeySlot(keyId, emptyKey);
  markDirtyKeySlot(keyId);
  forgetFilledClearedKeySlots(keys);
  if (selectedId === keyId) {
    selectedId = null;
    selectedArchiveRecord = null;
    selectedSetId = "main";
    clearSignature();
  }
  logActivity("Suppression", `${keyLabel(key)}${key.owner ? ` - ${formatOwner(key.owner)}` : ""}`, [key.owner, key.property].filter(Boolean).join(" - "));
  saveKeys();
  render();
  await syncCloudAfterAction();
}

function render() {
  renderGrid();
  renderPanel();
  renderContactSelect();
  renderArchivesPanel();
  renderCompromisesPanel();
  requestAnimationFrame(syncSignatureHeightToActions);
}

function syncSignatureHeightToActions() {
  if (form.hidden) return;
  const movementActions = form.querySelector(".movement-actions");
  if (!movementActions || !rentedBtn) return;

  const movementRect = movementActions.getBoundingClientRect();
  const rentedRect = rentedBtn.getBoundingClientRect();
  const actionsHeight = Math.round(rentedRect.bottom - movementRect.top);
  if (actionsHeight > 0) form.style.setProperty("--signature-actions-height", `${actionsHeight}px`);
}

function isDetailPanelBusy() {
  return isPhotoImporting || Boolean(document.querySelector(".date-dialog[open]")) || form.contains(document.activeElement);
}

function isKeyPanelOpen() {
  return Boolean((selectedId || selectedArchiveRecord) && !detailPanel.hidden && !form.hidden);
}

function isKeyFormBeingEdited() {
  const activeElement = document.activeElement;
  return Boolean(
    selectedId &&
      activeElement &&
      form.contains(activeElement) &&
      ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName),
  );
}

function isProtectedKeyInfoInputActive() {
  return protectedKeyInfoInputs.includes(document.activeElement);
}

function getKeyInfoDraftChanges() {
  return {
    property: formatConfigurablePropertyAddress(propertyInput.value),
    postalCode: postalCodeInput.value,
    city: formatCity(cityInput.value),
    owner: formatOwner(ownerInput.value),
    ownerFirstName: formatFirstName(ownerFirstNameInput.value),
    notes: notesInput.value,
  };
}

function rememberActiveKeyInfoDraft(changes = getKeyInfoDraftChanges()) {
  if (!selectedId || selectedArchiveRecord) return;
  activeKeyInfoDraft = {
    keyId: selectedId,
    storageKey: getRegistryConfig().keysStorageKey,
    changes,
    editedAt: Date.now(),
  };
}

function keyInfoDraftMatchesKey(changes, key) {
  if (!key) return false;
  return Object.entries(changes).every(([field, value]) => String(key[field] || "") === String(value || ""));
}

function hasPendingActiveKeyInfoDraft(storageKey = getRegistryConfig().keysStorageKey) {
  if (!activeKeyInfoDraft) return false;
  const draftStorageKey = activeKeyInfoDraft.storageKey || getRegistryConfig().keysStorageKey;
  if (draftStorageKey !== storageKey) return false;
  const cloudKey = getKeySlotCloudKey(storageKey, activeKeyInfoDraft.keyId);
  return Boolean(getPendingKeySlotWrite(cloudKey) || dirtyKeySlots.get(storageKey)?.has(activeKeyInfoDraft.keyId));
}

function captureActiveKeyInfoDraft() {
  if (!selectedId || selectedArchiveRecord || isSavingKeyInfoDraft) return;
  const changes = getKeyInfoDraftChanges();
  if (isPendingNewKeyDraft()) {
    pendingNewKeyDraft = { ...pendingNewKeyDraft, ...changes };
    return;
  }
  if (keyInfoDraftMatchesKey(changes, getSelectedKey())) return;
  rememberActiveKeyInfoDraft(changes);
  markDirtyKeySlot(selectedId);
  keys = keys.map((key) => (key.id === selectedId ? { ...key, ...changes } : key));
  try {
    markLocalEdit();
    setRuntimeStorageValue(getRegistryConfig().keysStorageKey, JSON.stringify(keys));
    scheduleStorageKeySync(getRegistryConfig().keysStorageKey);
    scheduleDirectKeyStorageFlush(getRegistryConfig().keysStorageKey);
  } catch (error) {
    console.warn("Local draft save failed", error.message);
  }
}

function restoreActiveKeyInfoDraftIfNeeded() {
  if (isPendingNewKeyDraft()) return;
  if (!activeKeyInfoDraft || !selectedId || selectedArchiveRecord) return;
  if (activeKeyInfoDraft.keyId !== selectedId) return;
  if (!hasPendingActiveKeyInfoDraft()) {
    activeKeyInfoDraft = null;
    return;
  }
  keys = keys.map((key) => (key.id === selectedId ? { ...key, ...activeKeyInfoDraft.changes } : key));
}

function updateSelectedKeyInfoFromDraft() {
  isSavingKeyInfoDraft = true;
  try {
    const changes = getKeyInfoDraftChanges();
    if (isPendingNewKeyDraft()) {
      pendingNewKeyDraft = { ...pendingNewKeyDraft, ...changes };
      return;
    }
    rememberActiveKeyInfoDraft(changes);
    markDirtyKeySlot(selectedId);
    updateSelectedKey(changes, { renderPanel: false });
    void syncStorageKeyToCloud(getRegistryConfig().keysStorageKey);
  } finally {
    isSavingKeyInfoDraft = false;
  }
}

function isTouchLayout() {
  return window.matchMedia("(max-width: 1040px), (pointer: coarse)").matches;
}

function isTouchDevice() {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function isLandscapeLayout() {
  return window.innerWidth > window.innerHeight || window.matchMedia("(orientation: landscape)").matches;
}

function beginPhotoImport(event) {
  if (event?.currentTarget instanceof HTMLInputElement) {
    event.currentTarget.value = "";
  }
  isPhotoImporting = true;
  markLocalEdit();
  clearTimeout(detailCloseTimer);
  clearTimeout(photoImportResetTimer);
  photoImportResetTimer = setTimeout(() => {
    isPhotoImporting = false;
  }, 120000);
}

function finishPhotoImport() {
  clearTimeout(photoImportResetTimer);
  isPhotoImporting = false;
}

function scheduleDetailPanelClose() {
  clearTimeout(detailCloseTimer);
}

function renderContactSelect() {
  const currentValue = contactSelect.value;
  contactSelect.innerHTML = '<option value="">Choisir dans la liste</option>';

  [
    ["internal", "Intervenants internes"],
    ["external", "Intervenants externes"],
  ].forEach(([type, label]) => {
    const groupedContacts = contacts.filter((contact) => contact.type === type);

    if (!groupedContacts.length) return;

    const group = document.createElement("optgroup");
    group.label = label;
    groupedContacts.forEach((contact) => {
      const option = document.createElement("option");
      option.value = contact.id;
      option.textContent = getContactSelectName(contact);
      group.append(option);
    });
    contactSelect.append(group);
  });

  contactSelect.value = contacts.some((contact) => contact.id === currentValue) ? currentValue : "";
}

function renderContactsPanel() {
  contactTabs.forEach((tab) => {
    const isActive = tab.dataset.contactType === activeContactType;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  updateContactFormMode();

  contactsList.innerHTML = "";
  const visibleContacts = contacts.filter((contact) => contact.type === activeContactType);

  if (!visibleContacts.length) {
    const item = document.createElement("li");
    item.textContent =
      activeContactType === "internal"
        ? "Aucun intervenant interne enregistré."
        : "Aucun intervenant externe enregistré.";
    contactsList.append(item);
    return;
  }

  visibleContacts.forEach((contact) => {
      const item = document.createElement("li");
      const details = document.createElement("span");
      const name = document.createElement("span");
      const phone = document.createElement("span");
      const actions = document.createElement("span");
      const editButton = document.createElement("button");
      const deleteButton = document.createElement("button");

      item.draggable = true;
      item.dataset.contactId = contact.id;
      name.className = "contact-name";
      phone.className = "contact-phone";
      actions.className = "contact-actions";
      editButton.className = "contact-edit";
      editButton.type = "button";
      deleteButton.className = "contact-delete";
      deleteButton.type = "button";

      if (contact.type === "external") {
        const company = document.createElement("span");
        const person = document.createElement("span");
        company.className = "contact-company";
        person.className = "contact-person";
        company.textContent = contact.companyName || "Soci\u00e9t\u00e9 non renseign\u00e9e";
        person.textContent = [contact.firstName, formatLastName(contact.name)].filter(Boolean).join(" ");
        name.append(company, person);
      } else {
        name.textContent = getContactDisplayName(contact);
      }
      phone.textContent = contact.phone || "Téléphone non renseigné";
      editButton.textContent = "Modifier";
      editButton.addEventListener("click", () => {
        editingContactId = contact.id;
        activeContactType = contact.type;
        contactFirstNameInput.value = contact.firstName || "";
        contactNameInput.value = contact.name;
        contactCompanyInput.value = contact.companyName || "";
        contactPhoneInput.value = contact.phone;
        updateContactFormMode();
        renderContactsPanel();
        (contactFirstNameLabel.hidden ? contactNameInput : contactFirstNameInput).focus();
      });
      deleteButton.textContent = "Supprimer";
      deleteButton.addEventListener("click", () => {
        const confirmed = confirm(`Supprimer l'intervenant ${getContactDisplayName(contact)} ?`);
        if (!confirmed) return;

        rememberUndoStep();
        contacts = contacts.filter((savedContact) => savedContact.id !== contact.id);
        saveContacts();
        logActivity(
          "Suppression intervenant",
          getContactHistoryName(contact),
          contactTypeText(contact.type),
        );
        renderContactSelect();
        renderContactsPanel();
      });

      details.append(name, phone);
      actions.append(editButton, deleteButton);
      item.append(details, actions);
      contactsList.append(item);
    });
}

function updateLegacyContactFormMode() {
  const isExternal = activeContactType === "external";
  contactFirstNameLabel.hidden = !isExternal;
  contactNameLabel.firstChild.textContent = "Nom de l'intervenant\n            ";
  contactNameInput.placeholder = "Nom de l'intervenant";
  contactFirstNameLabel.hidden = false;
  contactFirstNameLabel.firstChild.textContent = "Pr\u00e9nom de l'intervenant\n            ";
  contactNameLabel.firstChild.textContent = "Nom de l'intervenant\n            ";
  contactFirstNameInput.placeholder = "Pr\u00e9nom de l'intervenant";
  contactNameInput.placeholder = "Nom de l'intervenant";
  addContactBtn.textContent = editingContactId ? "Enregistrer" : "Ajouter";
}

function updatePreviousContactFormMode() {
  const isExternal = activeContactType === "external";
  contactFirstNameLabel.hidden = false;
  contactFirstNameLabel.firstChild.textContent = "Prénom de l'intervenant\n            ";
  contactNameLabel.firstChild.textContent = "Nom de l'intervenant\n            ";
  contactFirstNameInput.placeholder = "Prénom de l'intervenant";
  contactNameInput.placeholder = "Nom de l'intervenant";
  addContactBtn.textContent = editingContactId ? "Enregistrer" : "Ajouter";
}

function updateContactFormMode() {
  const isExternal = activeContactType === "external";
  contactFirstNameLabel.hidden = false;
  contactFirstNameLabel.firstChild.textContent = "Pr\u00e9nom de l'intervenant\n            ";
  contactNameLabel.firstChild.textContent = "Nom de l'intervenant\n            ";
  contactCompanyLabel.hidden = !isExternal;
  contactFirstNameInput.placeholder = "Pr\u00e9nom de l'intervenant";
  contactNameInput.placeholder = "Nom de l'intervenant";
  contactCompanyInput.placeholder = "Nom de la soci\u00e9t\u00e9 de l'intervenant";
  addContactBtn.textContent = editingContactId ? "Enregistrer" : "Ajouter";
}

function saveContactOrderFromList() {
  const orderedIds = [...contactsList.querySelectorAll("[data-contact-id]")].map((item) => item.dataset.contactId);
  if (!orderedIds.length) return;
  const previousIds = contacts.filter((contact) => contact.type === activeContactType).map((contact) => contact.id);
  if (orderedIds.join("|") === previousIds.join("|")) return;

  const orderedContacts = orderedIds
    .map((id) => contacts.find((contact) => contact.id === id))
    .filter(Boolean);
  if (!orderedContacts.length) return;

  rememberUndoStep();
  let orderedIndex = 0;
  contacts = contacts.map((contact) =>
    contact.type === activeContactType ? orderedContacts[orderedIndex++] || contact : contact,
  );
  saveContacts();
  renderContactSelect();
  renderContactsPanel();
}

function moveDraggedContactToPoint(clientY) {
  const draggedItem = contactsList.querySelector(".dragging");
  if (!draggedItem) return;

  const target = [...contactsList.querySelectorAll("[data-contact-id]:not(.dragging)")].find((item) => {
    const rect = item.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  contactsList.insertBefore(draggedItem, target || null);
}

function startTouchContactDrag(item, pointerId, clientY) {
  touchContactDrag = { item, pointerId };
  draggedContactId = item.dataset.contactId;
  contactsList.classList.add("is-touch-dragging");
  item.classList.add("dragging");
  item.setPointerCapture?.(pointerId);
  moveDraggedContactToPoint(clientY);
}

function stopTouchContactDrag() {
  if (!touchContactDrag) return;

  saveContactOrderFromList();
  touchContactDrag.item.releasePointerCapture?.(touchContactDrag.pointerId);
  touchContactDrag.item.classList.remove("dragging");
  contactsList.classList.remove("is-touch-dragging");
  draggedContactId = null;
  touchContactDrag = null;
}

function formatArchiveDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateOnly(value) {
  if (!value) return "";
  const date = String(value).includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function archiveReasonText(reason) {
  if (reason === "rented") return getRegistryConfig().rentedArchiveText;
  if (reason === "removed") return "Archivé";
  if (reason === "authenticated") return "Acte authentique";
  return "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function keyToCsvRows(key, archive = null) {
  const rows = [];
  const base = {
    emplacement: keyLabel(key),
    adresse: key.property || "",
    codePostal: key.postalCode || "",
    ville: key.city || "",
    proprietaire: key.owner || "",
    prenomProprietaire: key.ownerFirstName || "",
    notes: key.notes || "",
    archive: archive ? archiveReasonText(archive.reason) : "",
    dateArchive: archive ? formatArchiveDate(archive.archivedAt) : "",
  };

  key.sets.forEach((set) => {
    if (!set.history.length) {
      rows.push({
        ...base,
        jeu: set.label,
        statutJeu: set.status === "out" ? "Sorti" : set.status === "reserved" ? "Réservé" : "Disponible",
        mouvement: "",
        intervenant: set.holder || "",
        telephone: "",
        commentaire: "",
        dateMouvement: "",
        signe: "Non",
        signatureManuscrite: "",
      });
      return;
    }

    set.history.forEach((entry) => {
      rows.push({
        ...base,
        jeu: set.label,
        statutJeu: set.status === "out" ? "Sorti" : set.status === "reserved" ? "Réservé" : "Disponible",
        mouvement: getMovementActionLabel(entry, set.history),
        intervenant: entry.person || "",
        telephone: entry.phone || "",
        commentaire: entry.note || "",
        dateMouvement: entry.date || "",
        signe: entry.signature ? "Oui" : "Non",
        signatureManuscrite: entry.signature || "",
      });
    });
  });

  return rows;
}

function exportKeyExcel(key, archive = null) {
  const headers = [
    "Emplacement",
    "Adresse",
    "Code postal",
    "Ville",
    "Nom du propriétaire / de la société",
    "Prénom du propriétaire",
    "Notes",
    "Archive",
    "Date archive",
    "Jeu",
    "Statut du jeu",
    "Mouvement",
    "Intervenant",
    "Téléphone",
    "Commentaire",
    "Date mouvement",
    "Signé",
    "Signature manuscrite",
  ];
  const rows = keyToCsvRows(key, archive);
  const imageParts = [];
  const tableRows = rows.map((row, rowIndex) => {
    const values = [
    row.emplacement,
    row.adresse,
    row.codePostal,
    row.ville,
    row.proprietaire,
    row.prenomProprietaire,
    row.notes,
    row.archive,
    row.dateArchive,
    row.jeu,
    row.statutJeu,
    row.mouvement,
    row.intervenant,
    row.telephone,
    row.commentaire,
    row.dateMouvement,
    row.signe,
    ];
    let signatureCell = "";
    const signatureMatch = row.signatureManuscrite.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (signatureMatch) {
      const extension = signatureMatch[1].includes("jpeg") ? "jpg" : signatureMatch[1].split("/")[1].replace("+xml", "");
      const location = `signature-${rowIndex + 1}.${extension}`;
      signatureCell = `<img src="${location}" width="240" height="105" alt="Signature manuscrite">`;
      imageParts.push({ mime: signatureMatch[1], location, data: signatureMatch[2] });
    }
    return `<tr>${values.map((value) => `<td>${htmlEscape(value)}</td>`).join("")}<td>${signatureCell}</td></tr>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #999;padding:5px;vertical-align:middle}th{background:#ddd;font-weight:bold}td:last-child{width:250px;height:115px}</style></head><body><table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead><tbody>${tableRows.join("")}</tbody></table></body></html>`;
  const boundary = `----cles-export-${Date.now()}`;
  const parts = [
    `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n`,
    `--${boundary}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\nContent-Location: fiche.html\r\n\r\n${utf8ToBase64(html)}\r\n`,
    ...imageParts.map((image) => `--${boundary}\r\nContent-Type: ${image.mime}\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ${image.location}\r\n\r\n${image.data}\r\n`),
    `--${boundary}--\r\n`,
  ];
  const blob = new Blob(parts, { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const archiveSuffix = archive ? `-${archive.reason}` : "";
  link.href = url;
  link.download = `${key.id}${archiveSuffix}-export.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportFilledDataCsv() {
  const filledKeys = keys.filter((key) => isKeyFilled(key));
  if (!filledKeys.length) {
    alert("Aucune donnée renseignée à exporter dans ce registre.");
    return;
  }

  const headers = [
    "Registre",
    "Emplacement",
    "Catégorie",
    "Numéro",
    "Nom du propriétaire / de la société",
    "Prénom du propriétaire",
    "Adresse",
    "Code postal",
    "Ville",
    "Notes",
    "Nombre de jeux",
    "Statut général",
    "Jeux sortis",
    "Détenteurs actuels",
    "Photos",
  ];
  const registryLabel = activeRegistry === "location" ? "Location" : "Transaction";
  const rows = filledKeys.map((key) => {
    const outSets = key.sets.filter((set) => set.status === "out");
    const holders = key.sets
      .filter((set) => set.holder)
      .map((set) => `${set.label} : ${set.holder}`)
      .join(" | ");
    const photos = key.sets
      .map((set) => `${set.label} : ${set.photo ? "Oui" : "Non"}`)
      .join(" | ");

    return [
      registryLabel,
      keyLabel(key),
      key.category,
      key.number,
      key.owner || "",
      key.ownerFirstName || "",
      key.property || "",
      key.postalCode || "",
      key.city || "",
      key.notes || "",
      key.sets.length,
      statusText(key),
      outSets.map((set) => set.label).join(" | "),
      holders,
      photos,
    ];
  });
  const tableRows = rows
    .map((row) => `<tr>${row.map((value) => `<td>${htmlEscape(value)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #999;padding:5px;vertical-align:top}th{background:#ddd;font-weight:bold}td{mso-number-format:"\\@";}</style></head><body><table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  const blob = new Blob([`\uFEFF${html}`], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `donnees-renseignees-${activeRegistry}-${stamp}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function createDataBackupPayload(options = {}) {
  const data = {};
  getBackupStorageKeys().forEach((key) => {
    data[key] = getRuntimeStorageValue(key);
  });

  return {
    app: "century21-les-minimes-cles",
    version: 1,
    exportedAt: new Date().toISOString(),
    backupDate: options.backupDate || getLocalDateKey(),
    data,
  };
}

function downloadBackupPayload(payload, prefix = "sauvegarde-cles") {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportAllDataBackup() {
  downloadBackupPayload(createDataBackupPayload());
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getAutomaticBackupKey(date = new Date()) {
  return `${automaticBackupKeyPrefix}${getLocalDateKey(date)}`;
}

function isAutomaticBackupRow(row) {
  return String(row?.key || "").startsWith(automaticBackupKeyPrefix);
}

async function loadSavedBackupRows(limit = automaticBackupRetentionCount) {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from("app_state")
    .select("key,value,updated_at")
    .like("key", `${automaticBackupKeyPrefix}%`)
    .order("key", { ascending: false })
    .limit(limit * 2);
  if (error) throw error;
  const uniqueRows = new Map();
  (Array.isArray(data) ? data.filter(isAutomaticBackupRow) : []).forEach((row) => {
    const day = row.value?.backupDate || String(row.key || "").replace(automaticBackupKeyPrefix, "") || row.updated_at || "";
    if (!uniqueRows.has(day)) uniqueRows.set(day, row);
  });
  return [...uniqueRows.values()].slice(0, limit);
}

async function pruneOldAutomaticBackups() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("app_state")
    .select("key")
    .like("key", `${automaticBackupKeyPrefix}%`)
    .order("key", { ascending: false });
  if (error || !Array.isArray(data)) return;

  const oldKeys = data.filter(isAutomaticBackupRow).slice(automaticBackupRetentionCount).map((row) => row.key);
  await Promise.all(oldKeys.map((key) => supabaseClient.from("app_state").delete().eq("key", key)));
}

function getAutomaticBackupTargetDate(date = new Date()) {
  const target = new Date(date);
  target.setHours(automaticBackupHour, automaticBackupMinute, 0, 0);
  if (target <= date) target.setDate(target.getDate() + 1);
  return target;
}

function getLatestAutomaticBackupDate(date = new Date()) {
  const latest = new Date(date);
  latest.setHours(automaticBackupHour, automaticBackupMinute, 0, 0);
  if (latest > date) latest.setDate(latest.getDate() - 1);
  return latest;
}

async function hasAutomaticBackupForDate(date) {
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient
    .from("app_state")
    .select("key")
    .eq("key", getAutomaticBackupKey(date))
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function createAutomaticBackup({ force = false, date = new Date() } = {}) {
  if (!automaticBackupsEnabled || !supabaseClient || isCloudSleeping || isAppInBackground()) return false;
  await pendingCloudSync.catch(() => {});
  await syncCurrentRegistryToCloud();

  const backupKey = getAutomaticBackupKey(date);
  const { data: existingBackup } = await supabaseClient
    .from("app_state")
    .select("key,updated_at")
    .eq("key", backupKey)
    .maybeSingle();
  if (!force && existingBackup) return false;

  const payload = createDataBackupPayload({ backupDate: getLocalDateKey(date) });
  const updatedAt = new Date().toISOString();
  const { error } = await upsertCloudRow(backupKey, payload, existingBackup?.updated_at || null, updatedAt);
  if (error) throw error;
  await pruneOldAutomaticBackups();
  return true;
}

function getNextAutomaticBackupDelay() {
  const now = new Date();
  const target = getAutomaticBackupTargetDate(now);
  return target.getTime() - now.getTime();
}

function scheduleAutomaticBackup() {
  if (!automaticBackupsEnabled) return;
  window.setTimeout(async () => {
    try {
      await createAutomaticBackup();
      if (!savedBackupsPanel.hidden) renderSavedBackupsPanel();
    } catch (error) {
      console.warn("Automatic backup failed", error.message);
    } finally {
      scheduleAutomaticBackup();
    }
  }, getNextAutomaticBackupDelay());
}

async function ensureTodaysAutomaticBackupIfLate() {
  if (!automaticBackupsEnabled) return;
  const now = new Date();
  if (now.getHours() < automaticBackupHour || (now.getHours() === automaticBackupHour && now.getMinutes() < automaticBackupMinute)) return;
  try {
    await createAutomaticBackup();
  } catch (error) {
    console.warn("Automatic backup catch-up failed", error.message);
  }
}

async function ensureMissedAutomaticBackupOnOpen() {
  if (!automaticBackupsEnabled) return;
  const previousDate = getLatestAutomaticBackupDate();
  try {
    if (await hasAutomaticBackupForDate(previousDate)) return;
    await createAutomaticBackup({ date: previousDate });
  } catch (error) {
    console.warn("Automatic backup catch-up failed", error.message);
  }
}

function refreshDataFromStorage({ keepSelection = false } = {}) {
  const previousSelectedId = selectedId;
  const previousSelectedSetId = selectedSetId;
  tableSettings = loadTableSettings();
  activeRegistry = loadActiveRegistry();
  keys = loadKeys();
  archives = loadArchives();
  contacts = loadContacts();
  selectedId = keepSelection && keys.some((key) => key.id === previousSelectedId) ? previousSelectedId : null;
  selectedSetId = keepSelection ? previousSelectedSetId || "main" : "main";
  if (keepSelection) restoreActiveKeyInfoDraftIfNeeded();
  else discardPendingNewKeyDraft();
  hoveredKeyId = null;
  isDetailPanelHovered = false;
  if (!keepSelection) {
    contactsPanel.hidden = true;
    archivesPanel.hidden = true;
    savedBackupsPanel.hidden = true;
    clearSignature();
  }
  updateRegistryHeader();
  render();
}

function parseStoredArray(storageKey, fallback = []) {
  const saved = getRuntimeStorageValue(storageKey);
  if (!saved) return fallback;

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseHistoryTimestamp(value) {
  if (!value) return 0;

  const match = String(value).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const [, day, month, year, hour = "0", minute = "0"] = match;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return new Date(Number(fullYear), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
  }

  const isoTime = Date.parse(value);
  return Number.isNaN(isoTime) ? 0 : isoTime;
}

function getRegistryHistoryEntries(registry) {
  const config = registryConfig[registry];
  const registryLabel = registry === "transaction" ? "Transaction" : "Location";
  const registryKeys = parseStoredArray(config.keysStorageKey, makeInitialKeys()).map(normalizeKey);
  const registryArchives = parseStoredArray(config.archivesStorageKey, []).map(normalizeArchive);
  const entries = [];

  registryKeys.forEach((key) => {
    key.sets.forEach((set) => {
      set.history.forEach((movement) => {
        const isReservationMovement = movement.type === "reserved";
        const movementDetails = isReservationMovement
          ? [
              movement.person ? `Intervenant : ${movement.person}` : "",
              movement.phone ? `T\u00e9l\u00e9phone : ${movement.phone}` : "",
              movement.company ? `Soci\u00e9t\u00e9 : ${movement.company}` : "",
              movement.reservationDate ? `Pour le ${formatReservationHistoryDate(movement.reservationDate)}` : "",
              movement.note || "",
            ]
          : [movement.note || ""];
        entries.push({
          keyId: key.id,
          setId: set.id,
          timestamp: parseHistoryTimestamp(movement.date),
          date: movement.date || "Date non renseignée",
          title: `${keyLabel(key)} - ${registryLabel}${key.owner ? ` - ${formatOwner(key.owner)}` : ""} - ${set.label}`,
          action: getMovementActionLabel(movement, set.history),
          actor: movement.person || movement.company || "Intervenant non renseigné",
          actorPhone: movement.phone || "",
          details: movementDetails.filter(Boolean).join(" | "),
          device: "",
          registry,
        });
      });
    });
  });

  registryArchives.forEach((record) => {
    const key = record.key;
    const archiveMovementType = record.reason === "removed" ? "removed" : "rented";
    const archiveSet = key.sets?.find((set) => set.history?.some((entry) => entry.type === archiveMovementType)) || key.sets?.[0] || {};
    const archiveMovement = [...(archiveSet.history || [])].find((entry) => entry.type === archiveMovementType);
    const latestMovement =
      archiveMovement || (record.reason === "removed" ? null : getLatestMovementEntry(archiveSet.history || []));
    const usesMovementActor = ["removed", "rented", "authenticated"].includes(record.reason);
    const defaultInternalActor = record.reason === "removed" ? { person: "", phone: "" } : getDefaultInternalContactActor();
    const archiveActor = latestMovement?.person || latestMovement?.company || defaultInternalActor.person;
    const archiveActorPhone = latestMovement?.phone || defaultInternalActor.phone;
    const action =
      record.reason === "authenticated"
        ? "Acte authentique"
        : record.reason === "removed"
          ? "Archivé"
          : registry === "transaction"
            ? "Compromis"
            : "Loué";
    entries.push({
      keyId: key.id,
      setId: key.sets?.[0]?.id || "main",
      archiveId: record.id,
      timestamp: parseHistoryTimestamp(record.archivedAt),
      date: formatArchiveDate(record.archivedAt),
      title: `${keyLabel(key)} - ${registryLabel}${key.owner ? ` - ${formatOwner(key.owner)}` : ""}`,
      action,
      actor: usesMovementActor ? archiveActor || "Intervenant non renseigné" : key.owner ? formatOwner(key.owner) : "Fiche clé",
      actorPhone: usesMovementActor ? archiveActorPhone || "" : "",
      details: usesMovementActor ? "" : [key.property || "", [key.postalCode, key.city].filter(Boolean).join(" ")].filter(Boolean).join(" - "),
      device: "",
      registry,
    });
  });

  return entries;
}

function getActionClass(action) {
  const readableAction = String(action || "")
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (readableAction.includes("annul")) return "reserved";
  if (readableAction.includes("entr") || readableAction.includes("rentr") || readableAction.includes("creation") || readableAction.includes("restauration")) return "in";
  if (readableAction.includes("sorti") || readableAction.includes("sortie")) return "out";
  if (readableAction.includes("reserv")) return "reserved";
  if (readableAction.includes("compromis") || readableAction.includes("loue") || readableAction.includes("acte authentique")) return "signed";
  if (readableAction.includes("retir") || readableAction.includes("archiv") || readableAction.includes("suppression")) return "removed";
  if (/\b(?:entr\u00e9e?|rentr\u00e9e?)\b/i.test(String(action || ""))) return "in";
  if (/\b(?:sortie|sorti)\b/i.test(String(action || ""))) return "out";
  if (/r\u00e9serv/i.test(String(action || ""))) return "reserved";
  const normalized = String(action || "").toLowerCase();
  if (normalized.includes("entrée") || normalized.includes("création") || normalized.includes("restauration")) return "in";
  if (normalized.includes("sortie")) return "out";
  if (normalized.includes("rÃ©serv") || normalized.includes("réserv")) return "reserved";
  if (normalized.includes("compromis") || normalized.includes("loué") || normalized.includes("acte authentique")) return "signed";
  if (normalized.includes("retiré") || normalized.includes("archiv") || normalized.includes("suppression")) return "removed";
  return "neutral";
}

function getGlobalHistoryEntryId(entry) {
  const activityId = entry.activityId || (entry.source === "activity" ? entry.id : "");
  if (activityId) return `activity:${activityId}`;

  return `registry:${JSON.stringify([
    entry.registry || "",
    entry.action || "",
    entry.title || "",
    entry.date || "",
    entry.actor || "",
    entry.details || "",
  ])}`;
}

function getKeyIdFromHistoryTitle(title) {
  return parseKeyLabelFromTitle(title)?.id || "";
}

function activateRegistry(registry) {
  if (!registryConfig[registry]) return;
  if (activeRegistry === registry) return;
  activeRegistry = registry;
  saveActiveRegistry();
  keys = loadKeys();
  archives = loadArchives();
  contacts = loadContacts();
  updateRegistryHeader();
}

function openHistoryKey(entryData) {
  const registry = entryData.registry || activeRegistry;
  const keyId = entryData.keyId || "";
  const setId = entryData.setId || "main";
  if (!keyId) {
    alert("Impossible de retrouver la fiche correspondant \u00e0 cette ligne d'historique.");
    return;
  }

  activateRegistry(registry);
  globalHistoryPanel.hidden = true;
  contactsPanel.hidden = true;
  archivesPanel.hidden = true;
  compromisesPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  clearTimeout(detailCloseTimer);
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);

  if (entryData.archiveId) {
    const archiveRecord = archives.find((record) => record.id === entryData.archiveId);
    if (archiveRecord) {
      openArchivedKeyRecord(archiveRecord);
      selectedSetId = setId;
      render();
      return;
    }
  }

  const key = keys.find((savedKey) => savedKey.id === keyId);
  if (!key || !isKeyFilled(key)) {
    alert("Cette fiche n'est plus disponible sur le tableau. Elle a peut-\u00eatre \u00e9t\u00e9 supprim\u00e9e ou remplac\u00e9e.");
    return;
  }

  selectedArchiveRecord = null;
  selectedId = key.id;
  selectedSetId = key.sets.some((set) => set.id === setId) ? setId : key.sets[0]?.id || "main";
  beginKeyWorkProtection();
  resetKeyInfoEditUnlock(key);
  render();
}

function deleteGlobalHistoryEntry(historyId) {
  if (!historyId) return;
  if (!confirm("Supprimer cette ligne de l'historique ?")) return;

  const hiddenIds = loadHiddenGlobalHistoryIds();
  hiddenIds.add(historyId);
  saveHiddenGlobalHistoryIds(hiddenIds);

  if (historyId.startsWith("activity:")) {
    const activityId = historyId.slice("activity:".length);
    saveActivityLog(loadActivityLog().filter((entry) => entry.id !== activityId));
  }

  renderGlobalHistoryPanel(currentGlobalHistoryFilter);
}

function renderGlobalHistoryItems(targetList = globalHistoryList, registryFilter = "") {
  const activeKeyMaps = Object.fromEntries(
    ["location", "transaction"].map((registry) => {
      const config = registryConfig[registry];
      const registryKeys = parseStoredArray(config.keysStorageKey, makeInitialKeys()).map(normalizeKey);
      return [
        registry,
        new Map(registryKeys.flatMap((key) => keyLabelVariants(key).map((label) => [label, key]))),
      ];
    }),
  );
  const ownerMaps = Object.fromEntries(
    ["location", "transaction"].map((registry) => {
      const config = registryConfig[registry];
      const registryKeys = parseStoredArray(config.keysStorageKey, makeInitialKeys()).map(normalizeKey);
      const archivedKeys = parseStoredArray(config.archivesStorageKey, []).map(normalizeArchive).map((record) => record.key);
      return [
        registry,
        new Map(
          [...archivedKeys, ...registryKeys]
            .filter((key) => key.owner)
            .flatMap((key) => keyLabelVariants(key).map((label) => [label, formatOwner(key.owner)])),
        ),
      ];
    }),
  );
  const isActiveSlotFilled = (entry, keyLabelEntry) => {
    const key = (activeKeyMaps[entry.registry] || new Map()).get(keyLabelEntry);
    return Boolean(key && isKeyFilled(key));
  };
  const getActivitySetLabel = (entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    if (!action.includes("ajout jeu") && !action.includes("cr\u00e9ation jeu")) return "";

    const match = String(entry.details || "").match(/(\d+)\s+jeux?\s+au total/i);
    return match ? `Jeu ${match[1]}` : "";
  };
  const isSetCountDetail = (value) => /^\d+\s+jeux?\s+au total$/i.test(String(value || "").trim());
  const getActivityRegistryLabel = (entry) => (entry.registry === "transaction" ? "Transaction" : "Location");
  const getTitleKeyLabel = (title) => parseKeyLabelFromTitle(title)?.text || "";
  const titleHasOwner = (title) => {
    const parts = String(title || "").split(" - ").map((part) => part.trim()).filter(Boolean);
    return Boolean(getTitleKeyLabel(parts[0]) && parts[2] && !/^jeu\s+\d+$/i.test(parts[2]));
  };
  const getHistoryTitleOwner = (title) => {
    const parts = String(title || "").split(" - ").map((part) => part.trim()).filter(Boolean);
    return titleHasOwner(title) ? parts[2] || "" : "";
  };
  const getHistoryPhone = (value) => String(value || "").match(/\b\d{2}(?:\s\d{2}){4}\b/)?.[0] || "";
  const getActivityOwnerFromDetails = (entry) => {
    const owner = String(entry.details || "").split(" - ")[0]?.trim();
    return owner && !isSetCountDetail(owner) ? formatOwner(owner) : "";
  };
  const getHistorySubjectOwner = (entry) => {
    const parts = String(entry.title || "").split(" - ").map((part) => part.trim()).filter(Boolean);
    if (getTitleKeyLabel(parts[0]) && parts[2] && !/^jeu\s+\d+$/i.test(parts[2])) return parts[2];
    if ((parts[0] === "Location" || parts[0] === "Transaction") && parts[1]) return parts[1];

    const ownerMatch = String(entry.details || "").match(/Propriétaire\s*:\s*([^|]+)/i);
    return ownerMatch?.[1]?.trim() || "";
  };
  const buildActivityTitle = (entry, keyLabelEntry = "", owner = "", extraTitle = "") => {
    const setLabel = getActivitySetLabel(entry);
    return [keyLabelEntry, getActivityRegistryLabel(entry), extraTitle || owner, setLabel].filter(Boolean).join(" - ");
  };
  const replaceKeyLabelWithOwner = (entry) => {
    const ownerMap = ownerMaps[entry.registry] || new Map();
    const rawTitle = String(entry.title || "").trim();
    const keyLabelEntry = [...ownerMap.keys()].find(
      (label) => rawTitle === label || rawTitle.startsWith(`${label} - `),
    );
    if (keyLabelEntry) {
      const owner = getActivityOwnerFromDetails(entry) || ownerMap.get(keyLabelEntry);
      const extraTitle = rawTitle.slice(keyLabelEntry.length).replace(/^\s+-\s+/, "");
      return buildActivityTitle(entry, keyLabelEntry, owner, extraTitle || owner);
    }

    const ownerMatch = [...ownerMap.entries()].find(
      ([, owner]) => rawTitle === owner || rawTitle.startsWith(`${owner} - `),
    );
    if (ownerMatch) {
      const [matchedKeyLabel, owner] = ownerMatch;
      const extraTitle = rawTitle.slice(owner.length).replace(/^\s+-\s+/, "");
      return buildActivityTitle(entry, matchedKeyLabel, owner, extraTitle || owner);
    }

    const ownerFromDetails = getActivityOwnerFromDetails(entry);
    return buildActivityTitle(entry, "", "", ownerFromDetails || (isSetCountDetail(rawTitle) ? "" : rawTitle));
  };
  const getActivityTitle = (entry) => {
    if (String(entry.action || "").toLocaleLowerCase("fr-FR").includes("cr\u00e9ation fiche")) {
      const ownerFromDetails = String(entry.details || "").split(" - ")[0]?.trim();
      if (ownerFromDetails) {
        const formattedOwner = formatOwner(ownerFromDetails);
        const ownerMap = ownerMaps[entry.registry] || new Map();
        const keyLabelEntry = [...ownerMap.entries()].find(([, owner]) => owner === formattedOwner)?.[0];
        return buildActivityTitle(entry, keyLabelEntry || "", formattedOwner, formattedOwner);
      }
    }

    return replaceKeyLabelWithOwner(entry);
  };
  const isContactActivity = (entry) => /intervenant/i.test(String(entry.action || ""));
  const cleanContactHistoryName = (entry) => {
    const candidates = [entry.title, entry.details]
      .flatMap((value) => String(value || "").split("|"))
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => !/\d/.test(value))
      .filter((value) => !/^intervenant\s+(interne|externe)$/i.test(value));
    return candidates[0] || String(entry.title || "").replace(/\|.*$/, "").trim() || "Intervenant";
  };
  const cleanContactHistoryDetails = (entry) => {
    return "";
  };
  const shouldKeepStoredActivityEntry = (entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    const isCreationAction =
      action.includes("cr\u00e9ation fiche") ||
      action.includes("ajout jeu") ||
      action.includes("cr\u00e9ation jeu");
    if (!isCreationAction) return true;

    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (!keyLabelEntry) return true;
    if (!isActiveSlotFilled(entry, keyLabelEntry)) return false;

    const currentOwner = (ownerMaps[entry.registry] || new Map()).get(keyLabelEntry) || "";
    if (!currentOwner) return true;

    const titleParts = String(entry.title || "").split(" - ").map((part) => part.trim()).filter(Boolean);
    const titleOwner = titleParts
      .filter((part) => part !== keyLabelEntry)
      .filter((part) => part !== "Location" && part !== "Transaction")
      .filter((part) => !/^jeu\s+\d+$/i.test(part))
      .find((part) => part.toLocaleLowerCase("fr-FR") !== currentOwner.toLocaleLowerCase("fr-FR"));
    const detailsOwner = getActivityOwnerFromDetails(entry);
    const storedOwner = titleOwner || detailsOwner;
    if (!storedOwner) return true;

    return currentOwner.toLocaleLowerCase("fr-FR") === formatOwner(storedOwner).toLocaleLowerCase("fr-FR");
  };
  const storedActivityLog = loadActivityLog();
  const cleanedActivityLog = storedActivityLog.filter(shouldKeepStoredActivityEntry);
  if (cleanedActivityLog.length !== storedActivityLog.length) saveActivityLog(cleanedActivityLog);

  let activityEntries = cleanedActivityLog.map((entry) => ({
    id: entry.id || "",
    timestamp: parseHistoryTimestamp(entry.date),
    date: formatArchiveDate(entry.date),
    title: isContactActivity(entry) ? cleanContactHistoryName(entry) : getActivityTitle(entry),
    action: entry.action,
    actor: "Action enregistrée",
    details: isContactActivity(entry) ? cleanContactHistoryDetails(entry) : entry.details || "",
    device: entry.device || "Appareil non renseigné",
    registry: entry.registry || "location",
    source: "activity",
  }));
  const latestCreationByKey = new Map();
  activityEntries.forEach((entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (!action.includes("cr\u00e9ation fiche") || !keyLabelEntry) return;

    const mapKey = `${entry.registry || ""}|${keyLabelEntry}`.toLocaleLowerCase("fr-FR");
    const savedEntry = latestCreationByKey.get(mapKey);
    if (!savedEntry || entry.timestamp > savedEntry.timestamp) latestCreationByKey.set(mapKey, entry);
  });
  activityEntries = activityEntries.filter((entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    const isCreationSheet = action.includes("cr\u00e9ation fiche");
    if (!isCreationSheet && !action.includes("ajout jeu") && !action.includes("cr\u00e9ation jeu")) return true;

    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (!keyLabelEntry) return true;

    const currentOwner = (ownerMaps[entry.registry] || new Map()).get(keyLabelEntry) || "";
    const entryOwner = getHistoryTitleOwner(entry.title) || getActivityOwnerFromDetails(entry);
    if (
      currentOwner &&
      entryOwner &&
      currentOwner.toLocaleLowerCase("fr-FR") !== entryOwner.toLocaleLowerCase("fr-FR")
    ) {
      return false;
    }

    const mapKey = `${entry.registry || ""}|${keyLabelEntry}`.toLocaleLowerCase("fr-FR");
    const latestCreation = latestCreationByKey.get(mapKey);
    if (isCreationSheet) return !latestCreation || latestCreation.id === entry.id;

    return !latestCreation || latestCreation.timestamp <= entry.timestamp;
  });
  const registryEntries = ["location", "transaction"].flatMap(getRegistryHistoryEntries).map((entry) => ({
    ...entry,
    source: "registry",
  }));
  const completeActivityTitleFromRegistry = (activityEntry) => {
    const activityMinute = Math.floor(activityEntry.timestamp / 60000);
    const activityActionClass = getActionClass(activityEntry.action);
    const activitySearch = `${activityEntry.title} ${activityEntry.details} ${activityEntry.actor}`.toLocaleLowerCase("fr-FR");
    const activityKeyLabel = getTitleKeyLabel(activityEntry.title);
    const matchingRegistryEntries = registryEntries.filter((registryEntry) => {
      if (registryEntry.registry !== activityEntry.registry) return false;
      if (getActionClass(registryEntry.action) !== activityActionClass) return false;
      if (Math.abs(Math.floor(registryEntry.timestamp / 60000) - activityMinute) > 1) return false;
      if (activityKeyLabel && getTitleKeyLabel(registryEntry.title) !== activityKeyLabel) return false;

      const owner = getHistoryTitleOwner(registryEntry.title).toLocaleLowerCase("fr-FR");
      const phone = getHistoryPhone(registryEntry.details);
      const actor = String(registryEntry.actor || "").toLocaleLowerCase("fr-FR");
      return Boolean(
        (activityKeyLabel && !titleHasOwner(activityEntry.title) && owner) ||
        (owner && activitySearch.includes(owner)) ||
          (phone && activitySearch.includes(phone)) ||
          (actor && activitySearch.includes(actor)),
      );
    });
    const matchingRegistryEntry =
      activityKeyLabel || matchingRegistryEntries.length === 1 ? matchingRegistryEntries[0] : null;
    const isAmbiguousMovement =
      !activityKeyLabel && matchingRegistryEntries.length > 1 && ["in", "out", "reserved", "signed"].includes(activityActionClass);

    if (matchingRegistryEntry) return { ...activityEntry, title: matchingRegistryEntry.title, action: matchingRegistryEntry.action };
    return isAmbiguousMovement ? { ...activityEntry, isAmbiguousOwnerMovement: true } : activityEntry;
  };
  activityEntries.forEach((entry, index) => {
    activityEntries[index] = completeActivityTitleFromRegistry(entry);
  });
  const getDeduplicationKey = (entry) => {
    const actionClass = getActionClass(entry.action);
    const normalizedAction = actionClass === "in" && /(?:rentr|entr)/i.test(entry.action)
      ? "entry"
      : String(entry.action || "").trim().toLocaleLowerCase("fr-FR");
    const keyLabelEntry = getTitleKeyLabel(entry.title);
    const normalizedTitle = String(entry.title || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
    const minute = Math.floor(entry.timestamp / 60000);
    return `${normalizedAction}|${keyLabelEntry ? keyLabelEntry.toLocaleLowerCase("fr-FR") : normalizedTitle}|${minute}`;
  };
  const activityEntriesByKey = new Map();
  activityEntries.forEach((entry) => {
    const key = getDeduplicationKey(entry);
    const matchingEntries = activityEntriesByKey.get(key) || [];
    matchingEntries.push(entry);
    activityEntriesByKey.set(key, matchingEntries);
  });
  const deduplicatedEntries = registryEntries.map((registryEntry) => {
    const key = getDeduplicationKey(registryEntry);
    const matchingActivities = activityEntriesByKey.get(key) || [];
    const activityEntry = matchingActivities.shift();
    if (!matchingActivities.length) activityEntriesByKey.delete(key);
    if (!activityEntry) return registryEntry;
    return {
      ...registryEntry,
      timestamp: activityEntry.timestamp || registryEntry.timestamp,
      date: activityEntry.date || registryEntry.date,
      action: registryEntry.action || activityEntry.action,
      device: activityEntry.device || registryEntry.device,
      activityId: activityEntry.id || "",
    };
  });
  activityEntriesByKey.forEach((remainingEntries) => {
    deduplicatedEntries.push(...remainingEntries.filter((entry) => !entry.isAmbiguousOwnerMovement));
  });
  const getGlobalHistoryPriority = (entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    if (action.includes("cr\u00e9ation fiche")) return 0;
    if (/\b(?:entr\u00e9e?|rentr\u00e9e?)\b/.test(action)) return 1;
    if (/\b(?:sortie|sorti)\b/.test(action)) return 2;
    return 3;
  };
  const normalizeMovementWord = (value) =>
    normalizeMovementWords(value);
  const getGlobalHistoryActionLabel = (action) =>
    String(action || "").toLocaleLowerCase("fr-FR").includes("cr\u00e9ation jeu") ? "Ajout jeu" : normalizeMovementWord(action);
  const removeRedundantRegistryLabel = (entry, value) => {
    const action = String(entry.action || "")
      .toLocaleLowerCase("fr-FR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const redundantRegistry =
      action.includes("compromis") || action.includes("acte authentique")
        ? "transaction"
        : action.includes("loue")
          ? "location"
          : "";
    if (!redundantRegistry) return value;

    return String(value || "")
      .split(" - ")
      .map((part) => part.trim())
      .filter((part) => part && part.toLocaleLowerCase("fr-FR") !== redundantRegistry)
      .join(" - ");
  };
  const addMissingOwnerToHistoryRest = (entry, keyLabelEntry, rest) => {
    const owner = (ownerMaps[entry.registry] || new Map()).get(keyLabelEntry) || "";
    if (!owner || titleHasOwner(entry.title)) return rest;

    const parts = String(rest || "").split(" - ").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return owner;
    if (parts.some((part) => part.toLocaleLowerCase("fr-FR") === owner.toLocaleLowerCase("fr-FR"))) return rest;

    const registryIndex = parts.findIndex((part) => part === "Location" || part === "Transaction");
    if (registryIndex >= 0) {
      parts.splice(registryIndex + 1, 0, owner);
      return parts.join(" - ");
    }

    return [owner, ...parts].join(" - ");
  };
  const getTransferDirectionTitle = (entry, keyLabelEntry = "") => {
    const normalizeTransferRegistryLabel = (value) =>
      String(value || "").toLocaleLowerCase("fr-FR") === "transaction" ? "Transaction" : "Location";
    const targetLabel = normalizeTransferRegistryLabel(getActivityRegistryLabel(entry));
    const sourceFromDetails = String(entry.details || "").match(/Depuis\s+(Location|Transaction)\b/i)?.[1] || "";
    const sourceLabel = normalizeTransferRegistryLabel(sourceFromDetails || (targetLabel === "Location" ? "Transaction" : "Location"));
    return [keyLabelEntry, `Transfert de ${sourceLabel} vers ${targetLabel}`].filter(Boolean).join(" - ");
  };
  const getGlobalHistoryTitleText = (entry) => {
    const actionLabel = getGlobalHistoryActionLabel(entry.action);
    const normalizedAction = String(entry.action || "")
      .toLocaleLowerCase("fr-FR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (
      normalizedAction.includes("modification reglages")
    ) {
      return actionLabel;
    }
    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (normalizedAction.includes("transfert")) {
      return normalizeMovementWord(getTransferDirectionTitle(entry, keyLabelEntry));
    }
    if (!keyLabelEntry) {
      return normalizeMovementWord(removeRedundantRegistryLabel(entry, `${actionLabel} - ${entry.title}`));
    }

    const rest = removeRedundantRegistryLabel(
      entry,
      addMissingOwnerToHistoryRest(
        entry,
        keyLabelEntry,
        String(entry.title || "").slice(keyLabelEntry.length).replace(/^\s+-\s+/, ""),
      ),
    );
    return normalizeMovementWord(`${keyLabelEntry} - ${actionLabel}${rest ? ` - ${rest}` : ""}`);
  };
  const getGlobalHistorySubject = (entry) => {
    const owner = getHistorySubjectOwner(entry);
    if (owner) return `${entry.registry || ""}|${owner}`.replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");

    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (keyLabelEntry) return `${entry.registry || ""}|${keyLabelEntry}`.toLocaleLowerCase("fr-FR");

    return String(entry.title || "")
      .trim()
      .replace(/\s+-\s+jeu\s+\d+\s*$/i, "")
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("fr-FR");
  };
  const filteredEntries = registryFilter
    ? deduplicatedEntries.filter((entry) => entry.registry === registryFilter)
    : deduplicatedEntries;
  const hiddenGlobalHistoryIds = loadHiddenGlobalHistoryIds();
  const creationEntryMinutesBySubject = new Set(
    filteredEntries
      .filter((entry) => String(entry.action || "").toLocaleLowerCase("fr-FR").includes("cr\u00e9ation fiche"))
      .map((entry) => `${getGlobalHistorySubject(entry)}|${Math.floor(entry.timestamp / 60000)}`),
  );
  const sortedEntries = filteredEntries
    .map((entry, index) => ({ ...entry, orderIndex: index }))
    .filter((entry) => !hiddenGlobalHistoryIds.has(getGlobalHistoryEntryId(entry)))
    .filter((entry) => {
      const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
      if (!/\bentr\u00e9e?\b/.test(action)) return true;
      return !creationEntryMinutesBySubject.has(`${getGlobalHistorySubject(entry)}|${Math.floor(entry.timestamp / 60000)}`);
    })
    .sort((first, second) => {
      const firstMinute = Math.floor(first.timestamp / 60000);
      const secondMinute = Math.floor(second.timestamp / 60000);
      const isSameSubject = getGlobalHistorySubject(first) === getGlobalHistorySubject(second);
      return (
        secondMinute - firstMinute ||
        second.timestamp - first.timestamp ||
        (isSameSubject ? getGlobalHistoryPriority(first) - getGlobalHistoryPriority(second) : 0) ||
        first.orderIndex - second.orderIndex
      );
    });
  const hasMovementForSetCountEntry = (entry) => {
    const action = String(entry.action || "").toLocaleLowerCase("fr-FR");
    if (!action.includes("ajout jeu") && !action.includes("cr\u00e9ation jeu")) return false;

    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (!keyLabelEntry) return false;

    const setLabel = String(entry.title || "").match(/\bJeu\s+\d+\b/i)?.[0] || getActivitySetLabel(entry);
    const minute = Math.floor(entry.timestamp / 60000);
    return sortedEntries.some((otherEntry) => {
      if (otherEntry === entry) return false;
      if (otherEntry.registry !== entry.registry) return false;
      if (!["in", "out", "reserved"].includes(getActionClass(otherEntry.action))) return false;
      if (getTitleKeyLabel(otherEntry.title) !== keyLabelEntry) return false;

      const otherSetLabel = String(otherEntry.title || "").match(/\bJeu\s+\d+\b/i)?.[0] || otherEntry.setId || "";
      if (setLabel && otherSetLabel && setLabel.toLocaleLowerCase("fr-FR") !== otherSetLabel.toLocaleLowerCase("fr-FR")) {
        return false;
      }

      return Math.floor(otherEntry.timestamp / 60000) === minute;
    });
  };
  const seenMovementEntries = new Set();
  const entries = sortedEntries.filter((entry) => {
    if (hasMovementForSetCountEntry(entry)) return false;

    const actionClass = getActionClass(entry.action);
    if (!["in", "out", "reserved"].includes(actionClass)) return true;

    const keyLabelEntry = getTitleKeyLabel(entry.title);
    if (!keyLabelEntry) return true;

    const setLabel = String(entry.title || "").match(/\bJeu\s+\d+\b/i)?.[0] || entry.setId || "";
    const minute = Math.floor(entry.timestamp / 60000);
    const movementKey = [entry.registry || "", keyLabelEntry, setLabel, actionClass, minute].join("|").toLocaleLowerCase("fr-FR");
    if (seenMovementEntries.has(movementKey)) return false;

    seenMovementEntries.add(movementKey);
    return true;
  });

  targetList.innerHTML = "";
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "Aucun historique enregistré.";
    targetList.append(item);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const reservationDateLine = document.createElement("strong");
    const meta = document.createElement("small");
    const details = document.createElement("span");
    const deviceButton = document.createElement("button");
    const device = document.createElement("em");
    const historyKeyId = entry.keyId || getKeyIdFromHistoryTitle(entry.title);
    const actionClass = getActionClass(entry.action);
    item.dataset.globalHistoryId = getGlobalHistoryEntryId(entry);
    item.dataset.historyRegistry = entry.registry || "";
    item.dataset.historyKeyId = historyKeyId;
    item.dataset.historySetId = entry.setId || "";
    item.dataset.historyArchiveId = entry.archiveId || "";
    item.dataset.historyAction = actionClass;
    item.title = historyKeyId
      ? "Cliquer pour ouvrir la fiche. Ctrl + clic pour supprimer cette ligne d'historique"
      : "Ctrl + clic pour supprimer cette ligne d'historique";
    const detailParts = String(entry.details || "").split("|").map((part) => part.trim()).filter(Boolean);
    const reservationDateSource =
      actionClass === "reserved"
        ? detailParts.find((part) => /^Pour le\s+/i.test(part)) ||
          detailParts.find((part) => /^Annulation\s+(?:de\s+)?r[ée]servation\s+du\s+/i.test(part))
        : "";
    const isReservationCancellation = /^Annulation\s+/i.test(reservationDateSource || "");
    const reservationDateDetail = isReservationCancellation
      ? reservationDateSource
          .replace(/^Annulation\s+(?:de\s+)?/i, "")
          .replace(/^r/, "R")
          .replace(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})\b/, "$1 \u00e0 $2")
      : reservationDateSource;
    const reservationPersonDetail =
      actionClass === "reserved"
        ? detailParts.find((part) => /^Intervenant\s*:/i.test(part))
        : "";
    const reservationPhoneDetail =
      actionClass === "reserved"
        ? detailParts.find((part) => /^T\u00e9l\u00e9phone\s*:/i.test(part))
        : "";
    const reservationPerson = reservationPersonDetail?.replace(/^Intervenant\s*:\s*/i, "").trim() || entry.actor || "";
    const reservationPhone =
      reservationPhoneDetail?.replace(/^T\u00e9l\u00e9phone\s*:\s*/i, "").trim() || entry.actorPhone || "";
    let visibleDetails = reservationDateSource
      ? detailParts
          .filter((part) => part !== reservationDateSource)
          .filter((part) => part !== reservationPersonDetail)
          .filter((part) => part !== reservationPhoneDetail)
          .join(" | ")
      : entry.details;
    const normalizedEntryAction = String(entry.action || "")
      .toLocaleLowerCase("fr-FR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const isInlineDetailAction =
      normalizedEntryAction.includes("transfert") ||
      normalizedEntryAction.includes("ajout jeu") ||
      normalizedEntryAction.includes("creation jeu");
    const isRegisteredAction = String(entry.actor || "").toLocaleLowerCase("fr-FR") === "action enregistr\u00e9e";
    const fallbackActorParts =
      isRegisteredAction && ["in", "out", "signed", "removed"].includes(actionClass)
        ? detailParts.filter((part) => !/^propri\u00e9taire\s*:/i.test(part) && !/^t\u00e9l\u00e9phone\s*:/i.test(part))
        : [];
    const fallbackActorPhone = fallbackActorParts.find((part) => getHistoryPhone(part)) || "";
    const fallbackActorName = fallbackActorParts
      .find((part) => part !== fallbackActorPhone && !/\d{2}(?:\s\d{2}){3,4}/.test(part))
      ?.replace(/\s*-\s*$/, "")
      .trim() || "";
    const movementActor = isRegisteredAction && fallbackActorName ? fallbackActorName : entry.actor;
    const movementPhone = entry.actorPhone || getHistoryPhone(fallbackActorPhone);
    if (["in", "out", "signed", "removed"].includes(actionClass)) visibleDetails = "";
    if (normalizedEntryAction.includes("modification reglages")) visibleDetails = "";
    if (normalizedEntryAction.includes("transfert")) visibleDetails = "";
    title.textContent = getGlobalHistoryTitleText(entry);
    reservationDateLine.className = "reservation-date-line";
    reservationDateLine.textContent = reservationDateDetail || "";
    const actorText =
      actionClass === "reserved"
        ? [reservationPerson, reservationPhone].filter(Boolean).join(" - ")
        : [movementActor === "Action enregistr\u00e9e" ? "" : movementActor, movementPhone].filter(Boolean).join(" - ");
    const inlineDetailText = isInlineDetailAction ? String(visibleDetails || "").trim() : "";
    if (isInlineDetailAction) visibleDetails = "";
    meta.textContent = `${entry.date}${actorText ? ` - ${actorText}` : ""}${inlineDetailText ? ` - ${inlineDetailText}` : ""}`;
    details.textContent = visibleDetails;
    deviceButton.className = "history-device-button";
    deviceButton.type = "button";
    deviceButton.textContent = "...";
    device.hidden = true;
    device.textContent = entry.device || "Ancienne action sans appareil enregistré";
    deviceButton.addEventListener("click", () => {
      device.hidden = !device.hidden;
    });
    item.append(title);
    if (reservationDateDetail) item.append(reservationDateLine);
    if (actionClass === "reserved" && visibleDetails) item.append(details);
    item.append(meta, deviceButton);
    if (actionClass !== "reserved" && visibleDetails) item.append(details);
    item.append(device);
    targetList.append(item);
  });
}

function renderGlobalHistoryPanel(registryFilter = "") {
  currentGlobalHistoryFilter = registryFilter;
  const isRegistryHistory = Boolean(registryFilter);
  const registryLabel = registryFilter === "location" ? "Location" : "Transaction";
  globalHistoryEyebrow.textContent = isRegistryHistory ? `Tableau ${registryLabel.toLowerCase()}` : "Tableaux location et transaction";
  globalHistoryTitle.textContent = isRegistryHistory ? `Historique ${registryLabel}` : "Historique Global";
  globalHistoryPanel.setAttribute("aria-label", globalHistoryTitle.textContent);
  renderGlobalHistoryItems(globalHistoryList, registryFilter);
}

function openGlobalHistoryPanel(registryFilter = "") {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  contactsPanel.hidden = true;
  archivesPanel.hidden = true;
  compromisesPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  globalHistoryPanel.hidden = false;
  renderGlobalHistoryPanel(registryFilter);
}

function formatSavedBackupDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function formatSavedBackupTitleDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
  }).format(date);
}

function formatSavedBackupDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(
      new Date(Number(year), Number(month) - 1, Number(day)),
    );
  }
  return formatSavedBackupTitleDate(value);
}

function parseBackupStorageArray(payload, storageKey) {
  const value = payload?.data?.[storageKey];
  if (!value) return [];

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeBackupRegistry(payload, registry) {
  const config = registryConfig[registry];
  const backupKeys = parseBackupStorageArray(payload, config.keysStorageKey).map(normalizeKey);
  return backupKeys.reduce(
    (summary, key) => {
      if (key.archived || !isKeyFilled(key)) return summary;

      (key.sets || []).forEach((set) => {
        const status = getSetDisplayStatus(set);
        summary.total += 1;
        if (status === "out") summary.out += 1;
        else if (status === "reserved") summary.reserved += 1;
        else summary.available += 1;
        if (set.photo) summary.photos += 1;
      });

      return summary;
    },
    { total: 0, available: 0, reserved: 0, out: 0, photos: 0 },
  );
}

function createSavedBackupSummaryElement(payload) {
  const summary = document.createElement("div");
  summary.className = "saved-backup-summary";

  [
    ["Location", summarizeBackupRegistry(payload, "location")],
    ["Transaction", summarizeBackupRegistry(payload, "transaction")],
  ].forEach(([label, counts]) => {
    const row = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("strong");
    const photos = document.createElement("span");
    const stats = document.createElement("div");

    row.className = "saved-backup-summary-row";
    header.className = "saved-backup-summary-header";
    title.textContent = label;
    photos.textContent = `${counts.photos} photo${counts.photos > 1 ? "s" : ""}`;
    stats.className = "saved-backup-summary-stats";
    [
      ["total", "Total", counts.total],
      ["available", "Disponibles", counts.available],
      ["reserved", "Réservés", counts.reserved],
      ["out", "Indisponibles", counts.out],
    ].forEach(([status, statLabel, value]) => {
      const stat = document.createElement("span");
      stat.dataset.backupStat = status;
      stat.textContent = `${statLabel} ${value}`;
      stats.append(stat);
    });

    header.append(title, photos);
    row.append(header, stats);
    summary.append(row);
  });

  return summary;
}

function applyBackupPayload(payload, sourceLabel = "cette sauvegarde") {
  if (payload?.app !== "century21-les-minimes-cles" || !payload.data || typeof payload.data !== "object") {
    alert("Cette sauvegarde n'est pas lisible.");
    return;
  }

  const confirmed = confirm(`Appliquer ${sourceLabel} remplacera les données actuelles du tableau. Continuer ?`);
  if (!confirmed) return;

  rememberUndoStep();
  const changedKeys = [];
  getBackupStorageKeys().forEach((key) => {
    const value = payload.data[key];
    const previousValue = getRuntimeStorageValue(key);
    if (previousValue === value) return;
    saveStorageValue(key, value);
    markChangedKeySlots(key, getRuntimeStorageValue(key), previousValue);
    changedKeys.push(key);
  });
  changedKeys.forEach((key) => dirtyCloudKeys.add(key));
  savePendingCloudKeys();
  Promise.all(changedKeys.map((key) => syncStorageKeyToCloud(key, { force: true })));
  logActivity("Application sauvegarde", "Liste des sauvegardes", sourceLabel);
  refreshDataFromStorage();
  alert("Sauvegarde appliquée.");
}

async function renderSavedBackupsPanel() {
  savedBackupsList.innerHTML = "";
  const loading = document.createElement("li");
  loading.textContent = "Chargement des sauvegardes...";
  savedBackupsList.append(loading);

  try {
    const rows = await loadSavedBackupRows();
    savedBackupsList.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.textContent = "Aucune sauvegarde automatique disponible.";
      savedBackupsList.append(empty);
      return;
    }

    rows.forEach((row, index) => {
      const payload = row.value || {};
      const item = document.createElement("li");
      const title = document.createElement("strong");
      const summary = createSavedBackupSummaryElement(payload);
      const actions = document.createElement("div");
      const applyButton = document.createElement("button");
      const downloadButton = document.createElement("button");
      const createdAt = payload.exportedAt || row.updated_at;
      const savedDay = payload.backupDate || String(row.key || "").replace(automaticBackupKeyPrefix, "") || createdAt;

      title.textContent = `Sauvegarde du ${formatSavedBackupDay(savedDay)}`;
      actions.className = "saved-backup-actions";
      applyButton.type = "button";
      applyButton.textContent = "Appliquer";
      downloadButton.type = "button";
      downloadButton.textContent = "Télécharger";

      applyButton.addEventListener("click", () => applyBackupPayload(payload, `la sauvegarde du ${formatSavedBackupDate(createdAt)}`));
      downloadButton.addEventListener("click", () => downloadBackupPayload(payload, "sauvegarde-auto-cles"));

      actions.append(applyButton, downloadButton);
      item.append(title, summary, actions);
      savedBackupsList.append(item);
    });
  } catch (error) {
    savedBackupsList.innerHTML = "";
    const item = document.createElement("li");
    item.textContent = "Impossible de charger les sauvegardes automatiques.";
    savedBackupsList.append(item);
    console.warn("Saved backups load failed", error.message);
  }
}

function cloneTableSettings(settings = tableSettings) {
  return normalizeTableSettings(JSON.parse(JSON.stringify(settings || getDefaultTableSettings())));
}

function updateSettingsDraftFromDom() {
  if (!settingsDraft) return;

  if (settingsAgencyNameInput) {
    settingsDraft.agencyName = settingsAgencyNameInput.value.trim() || "Agence";
  }

  const previousCategories = settingsDraft.categories || [];
  const categoryItems = settingsCategoriesList ? [...settingsCategoriesList.querySelectorAll("[data-settings-category-index]")] : [];
  if (categoryItems.length) {
    settingsDraft.categories = categoryItems.map((item, index) => {
      const previous = previousCategories[Number(item.dataset.settingsCategoryIndex)] || {};
      const labelInput = item.querySelector("[data-settings-category-label]");
      const prefixInput = item.querySelector("[data-settings-category-prefix]");
      const label = labelInput?.value.trim() || defaultCategoryLabels[index] || `Catégorie ${index + 1}`;
      const prefix = prefixInput ? prefixInput.value.trim() : String(previous.prefix || "").trim();
      return { ...previous, label, prefix };
    });
  }

  if (settingsSlotsInput) {
    settingsDraft.slotsPerCategory = normalizeEvenSlotCount(settingsSlotsInput.value);
  }
  if (settingsCasesPerLineInput) {
    settingsDraft.casesPerLine = normalizeCasesPerLine(
      settingsCasesPerLineInput.value,
      settingsDraft.slotsPerCategory,
      settingsDraft.casesPerLine,
    );
  }
  if (settingsCelebrationInput) {
    settingsDraft.saleCelebrationEnabled = settingsCelebrationInput.checked;
  }
  if (settingsAccessLockInput) {
    const wasEnabled = tableSettings?.accessLockEnabled !== false;
    const previousAccessCode = String(tableSettings?.accessCode || defaultAccessCode).trim() || defaultAccessCode;
    const nextAccessCode = String(settingsDraft.accessCode || defaultAccessCode).trim() || defaultAccessCode;
    const accessCodeChanged = nextAccessCode !== previousAccessCode;
    settingsDraft.accessLockEnabled = settingsAccessLockInput.checked;
    settingsDraft.accessLockVersion =
      (!wasEnabled && settingsDraft.accessLockEnabled) || accessCodeChanged
        ? Date.now()
        : tableSettings?.accessLockVersion || settingsDraft.accessLockVersion || 1;
  }

  const replacementItems = settingsReplacementsList ? [...settingsReplacementsList.querySelectorAll("[data-settings-replacement-index]")] : [];
  settingsDraft.addressReplacements = replacementItems.map((item) => {
    const previous = settingsDraft.addressReplacements?.[Number(item.dataset.settingsReplacementIndex)] || {};
    return {
      ...previous,
      word: item.querySelector("[data-settings-replacement-word]")?.value.trim() || "",
      replacement: item.querySelector("[data-settings-replacement-value]")?.value.trim() || "",
    };
  });
}

function setSettingsDraftRowCount(rowCount) {
  if (!settingsDraft) settingsDraft = cloneTableSettings();
  const safeRowCount = Math.max(1, Math.min(12, Number.parseInt(rowCount, 10) || defaultCategoryLabels.length));
  const nextCategories = [...settingsDraft.categories];

  while (nextCategories.length < safeRowCount) {
    const usedIds = new Set(nextCategories.map((category) => category.id));
    const label = defaultCategoryLabels[nextCategories.length] || `Catégorie ${nextCategories.length + 1}`;
    const id = defaultCategoryLabels.includes(label) && !usedIds.has(label) ? label : createCategoryId(label);
    nextCategories.push({ id, label, prefix: defaultCategoryPrefixes[label] || label, aliases: [] });
  }

  settingsDraft.categories = nextCategories.slice(0, safeRowCount);
}

function createSettingsCategoryRow(category, index) {
  const item = document.createElement("li");
  const indexBadge = document.createElement("span");
  const nameLabel = document.createElement("label");
  const nameInput = document.createElement("input");
  const prefixLabel = document.createElement("label");
  const prefixInput = document.createElement("input");
  const removeButton = document.createElement("button");

  item.className = "settings-row";
  item.dataset.settingsCategoryIndex = String(index);
  indexBadge.className = "settings-row-index";
  indexBadge.textContent = String(index + 1);
  nameLabel.textContent = "Nom de la catégorie";
  nameInput.type = "text";
  nameInput.value = category.label;
  nameInput.dataset.settingsCategoryLabel = "true";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  prefixLabel.textContent = "Préfixe";
  prefixInput.type = "text";
  prefixInput.value = category.prefix ?? "";
  prefixInput.placeholder = "M";
  prefixInput.dataset.settingsCategoryPrefix = "true";
  prefixInput.autocomplete = "off";
  prefixInput.spellcheck = false;
  removeButton.type = "button";
  removeButton.className = "settings-remove-button";
  removeButton.textContent = "Supprimer";
  removeButton.disabled = settingsDraft.categories.length <= 1;
  removeButton.addEventListener("click", () => {
    updateSettingsDraftFromDom();
    settingsDraft.categories.splice(index, 1);
    if (settingsRowCountInput) settingsRowCountInput.value = String(settingsDraft.categories.length);
    renderSettingsPanel();
  });

  nameLabel.append(nameInput);
  prefixLabel.append(prefixInput);
  item.append(indexBadge, nameLabel, prefixLabel, removeButton);
  return item;
}

function createSettingsReplacementRow(replacement, index) {
  const item = document.createElement("li");
  const wordLabel = document.createElement("label");
  const wordInput = document.createElement("input");
  const replacementLabel = document.createElement("label");
  const replacementInput = document.createElement("input");
  const removeButton = document.createElement("button");

  item.className = "settings-replacement-row";
  item.dataset.settingsReplacementIndex = String(index);
  wordLabel.textContent = "Mot";
  wordInput.type = "text";
  wordInput.value = replacement.word || "";
  wordInput.placeholder = "Chemin";
  wordInput.dataset.settingsReplacementWord = "true";
  wordInput.autocomplete = "off";
  wordInput.spellcheck = false;
  wordInput.addEventListener("blur", () => {
    wordInput.value = formatSentenceStart(wordInput.value).trim();
  });
  replacementLabel.textContent = "Remplacement";
  replacementInput.type = "text";
  replacementInput.value = replacement.replacement || "";
  replacementInput.placeholder = "Ch.";
  replacementInput.dataset.settingsReplacementValue = "true";
  replacementInput.autocomplete = "off";
  replacementInput.spellcheck = false;
  replacementInput.addEventListener("blur", () => {
    replacementInput.value = formatSentenceStart(replacementInput.value).trim();
  });
  removeButton.type = "button";
  removeButton.className = "settings-remove-button";
  removeButton.textContent = "Supprimer";
  removeButton.addEventListener("click", () => {
    updateSettingsDraftFromDom();
    settingsDraft.addressReplacements.splice(index, 1);
    renderSettingsPanel();
  });

  wordLabel.append(wordInput);
  replacementLabel.append(replacementInput);
  item.append(wordLabel, replacementLabel, removeButton);
  return item;
}

function renderSettingsPanel() {
  if (!settingsPanel || !settingsForm) return;
  if (!settingsDraft) settingsDraft = cloneTableSettings();

  if (settingsAgencyNameInput) settingsAgencyNameInput.value = settingsDraft.agencyName || "Agence";
  if (settingsRowCountInput) settingsRowCountInput.value = String(settingsDraft.categories.length);
  if (settingsCasesPerLineInput) {
    settingsCasesPerLineInput.max = String(settingsDraft.slotsPerCategory || defaultSlotsPerCategory);
    settingsCasesPerLineInput.value = String(settingsDraft.casesPerLine || defaultCasesPerLine);
  }
  if (settingsSlotsInput) settingsSlotsInput.value = String(settingsDraft.slotsPerCategory || defaultSlotsPerCategory);
  if (settingsCelebrationInput) settingsCelebrationInput.checked = settingsDraft.saleCelebrationEnabled !== false;
  if (settingsAccessLockInput) settingsAccessLockInput.checked = settingsDraft.accessLockEnabled !== false;
  if (settingsAccessCodeText) {
    settingsAccessCodeText.hidden = settingsDraft.accessLockEnabled === false;
    settingsAccessCodeText.textContent = `(Mot de passe : ${settingsDraft.accessCode || defaultAccessCode})`;
  }
  if (editSettingsAccessCodeBtn) {
    editSettingsAccessCodeBtn.hidden = settingsDraft.accessLockEnabled === false;
  }
  if (toggleSettingsOrganizationBtn) {
    toggleSettingsOrganizationBtn.setAttribute("aria-expanded", String(areSettingsOrganizationVisible));
  }
  if (settingsOrganizationContent) {
    settingsOrganizationContent.hidden = !areSettingsOrganizationVisible;
  }
  if (toggleSettingsReplacementsBtn) {
    toggleSettingsReplacementsBtn.setAttribute("aria-expanded", String(areSettingsReplacementsVisible));
  }

  if (settingsCategoriesList) {
    settingsCategoriesList.innerHTML = "";
    settingsDraft.categories.forEach((category, index) => {
      settingsCategoriesList.append(createSettingsCategoryRow(category, index));
    });
  }

  if (settingsReplacementsList) {
    settingsReplacementsList.hidden = !areSettingsReplacementsVisible;
    settingsReplacementsList.innerHTML = "";
    const replacements = settingsDraft.addressReplacements?.length
      ? sortAddressReplacements(settingsDraft.addressReplacements)
      : [{ id: createReplacementId(), word: "", replacement: "" }];
    settingsDraft.addressReplacements = replacements;
    replacements.forEach((replacement, index) => {
      settingsReplacementsList.append(createSettingsReplacementRow(replacement, index));
    });
  }
}

function saveTableSettings(nextSettings) {
  const previousSettings = tableSettings || getDefaultTableSettings();
  const normalized = normalizeTableSettings(nextSettings);
  normalized.categories = normalized.categories.map((category) => {
    const previousCategory = previousSettings.categories?.find((item) => item.id === category.id);
    const aliases = new Set(category.aliases || []);
    if (previousCategory?.label && previousCategory.label !== category.label) aliases.add(previousCategory.label);
    if (previousCategory?.prefix && previousCategory.prefix !== category.prefix) aliases.add(previousCategory.prefix);
    return {
      ...category,
      aliases: [...aliases].filter((alias) => alias !== category.label && alias !== category.prefix),
    };
  });

  const previousValue = getRuntimeStorageValue(tableSettingsStorageKey);
  const nextValue = JSON.stringify(normalized);
  if (previousValue === nextValue) return false;

  rememberUndoStep();
  markLocalEdit();
  setRuntimeStorageValue(tableSettingsStorageKey, nextValue);
  dirtyCloudKeys.add(tableSettingsStorageKey);
  savePendingCloudKeys();
  scheduleStorageKeySync(tableSettingsStorageKey, 0);
  tableSettings = normalized;
  hasResolvedInitialAccessSettings = true;
  updateAccessLockState();
  keys = loadKeys();
  archives = loadArchives();
  return true;
}

function openSettingsPanel() {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  contactsPanel.hidden = true;
  archivesPanel.hidden = true;
  compromisesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  detailPanel.hidden = true;
  settingsDraft = cloneTableSettings();
  areSettingsOrganizationVisible = false;
  areSettingsReplacementsVisible = false;
  settingsPanel.hidden = false;
  renderSettingsPanel();
  updateResetTablesButtonAvailability();
}

function closeSettingsPanel() {
  if (settingsPanel) settingsPanel.hidden = true;
  settingsDraft = null;
  updateResetTablesButtonAvailability();
}

function openSavedBackupsPanel() {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  contactsPanel.hidden = true;
  archivesPanel.hidden = true;
  compromisesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  savedBackupsPanel.hidden = false;
  renderSavedBackupsPanel();
}

function updateImportButtonAvailability(event = {}) {
  const isUnlocked = Boolean(event.ctrlKey && event.shiftKey);
  importDataBtn.classList.toggle("is-unlocked", isUnlocked);
  importDataBtn.setAttribute("aria-disabled", String(!isUnlocked));

  const isSavedBackupsUnlocked = Boolean(event.ctrlKey && event.shiftKey);
  savedBackupsBtn.classList.toggle("is-unlocked", isSavedBackupsUnlocked);
  savedBackupsBtn.setAttribute("aria-disabled", String(!isSavedBackupsUnlocked));
}

function updateSettingsButtonAvailability(event = {}) {
  if (!settingsDataBtn) return;
  const isUnlocked = Boolean(event.ctrlKey && event.altKey && settingsDataBtn.matches(":hover"));
  settingsDataBtn.classList.toggle("is-unlocked", isUnlocked);
  settingsDataBtn.setAttribute("aria-disabled", String(!isUnlocked));
}

function updateResetTablesButtonAvailability(event = {}) {
  if (!resetTablesBtn) return;
  const isUnlocked = Boolean(settingsPanel && !settingsPanel.hidden && event.ctrlKey && event.shiftKey);
  resetTablesBtn.hidden = !isUnlocked;
}

function getResettableStorageKeys() {
  return [
    sharedContactsStorageKey,
    appActivityLogStorageKey,
    hiddenGlobalHistoryStorageKey,
    tableSettingsStorageKey,
    registryConfig.location.keysStorageKey,
    registryConfig.location.archivesStorageKey,
    registryConfig.transaction.keysStorageKey,
    registryConfig.transaction.archivesStorageKey,
  ];
}

async function deleteResetKeySlotsFromCloud() {
  if (!supabaseClient) return;

  for (const { prefix } of getKeySlotStorageRows()) {
    const { error } = await supabaseClient.from("app_state").delete().like("key", `${prefix}%`);
    if (error) throw error;
  }
}

async function deleteAutomaticBackupsFromCloud() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("app_state").delete().like("key", `${automaticBackupKeyPrefix}%`);
  if (error) throw error;
}

function getResetTableSettings(settings = tableSettings) {
  const organization = normalizeTableSettings(settings);
  return normalizeTableSettings({
    ...getDefaultTableSettings(),
    categories: JSON.parse(JSON.stringify(organization.categories)),
    slotsPerCategory: organization.slotsPerCategory,
    casesPerLine: organization.casesPerLine,
    accessCode: defaultAccessCode,
    accessLockEnabled: false,
    accessLockVersion: Date.now(),
  });
}

function resetTableSettingsKeepingOrganization() {
  tableSettings = getResetTableSettings();
  setRuntimeStorageValue(tableSettingsStorageKey, JSON.stringify(tableSettings));
  removeRuntimeStorageValue(accessUnlockedStorageKey);
  updateAccessLockState();
}

async function syncResetDataToCloud() {
  if (!supabaseClient) return;
  await deleteResetKeySlotsFromCloud();
  await deleteAutomaticBackupsFromCloud();
  dirtyCloudKeys = new Set(getResettableStorageKeys());
  Object.values(registryConfig).forEach((config) => {
    dirtyKeySlots.set(config.keysStorageKey, new Set(makeInitialKeys().map((key) => key.id)));
  });
  savePendingCloudKeys();
  saveDirtyKeySlots();
  await Promise.all(
    getResettableStorageKeys().map((storageKey) =>
      writeStorageKeyToCloudNow(storageKey, { force: true, fullReplace: true }),
    ),
  );
}

async function waitForCurrentCloudLoadToFinish() {
  const timeoutAt = Date.now() + 10 * 1000;
  while (isCloudCheckRunning && Date.now() < timeoutAt) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (isCloudCheckRunning) throw new Error("Une actualisation Supabase est toujours en cours.");
}

async function performTableDataReset() {
  cloudSyncTimers.forEach((timer) => clearTimeout(timer));
  cloudSyncTimers.clear();
  directCloudFlushTimers.forEach((timer) => clearTimeout(timer));
  directCloudFlushTimers.clear();
  await pendingCloudSync.catch(() => {});
  await waitForCurrentCloudLoadToFinish();
  pendingCloudSync = Promise.resolve();
  dirtyCloudKeys = new Set();
  failedCloudSyncKeys = new Set();
  dirtyKeySlots = new Map();
  pendingKeySlotWrites = new Map();
  recentlyForcedKeySlots.clear();
  recentlyClearedKeySlots.clear();
  cloudRowVersions = new Map();
  savePendingCloudKeys();
  saveDirtyKeySlots();
  savePendingKeySlotWrites();
  saveCloudRowVersions();

  getResettableStorageKeys().forEach((storageKey) => {
    if (!isKeysStorageKey(storageKey) && storageKey !== tableSettingsStorageKey) {
      setRuntimeStorageValue(storageKey, "[]");
    }
  });
  removeAutomaticBackupsFromLocalStorage();
  resetTableSettingsKeepingOrganization();
  Object.values(registryConfig).forEach((config) => {
    setRuntimeStorageValue(config.keysStorageKey, JSON.stringify(makeInitialKeys()));
  });

  undoSnapshot = null;
  activeKeyInfoDraft = null;
  pendingNewKeyDraft = null;
  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  contacts = loadContacts();
  keys = loadKeys();
  archives = loadArchives();
  settingsDraft = cloneTableSettings();
  renderSettingsPanel();
  render();
  updateUndoButton();
  await syncResetDataToCloud();
}

async function resetAllTableData() {
  const firstConfirmation = window.confirm(
    "Cette action va supprimer toutes les fiches de clés enregistrées des tableaux Location et Transaction, ainsi que les archives, les historiques, les intervenants, les sauvegardes et le mot de passe. Seule l'organisation des catégories, des cases et des lignes sera conservée. Continuer ?",
  );
  if (!firstConfirmation) return;

  const typedConfirmation = window.prompt('Pour confirmer, tape exactement : REINITIALISER');
  if (typedConfirmation !== "REINITIALISER") return;

  let didReset = false;
  isResettingTableData = true;
  try {
    await performTableDataReset();
    didReset = true;
  } catch (error) {
    console.warn("Supabase reset failed", error.message);
    alert("La réinitialisation n'a pas pu être terminée. Vérifie la connexion puis réessaie.");
  } finally {
    isResettingTableData = false;
  }

  if (didReset) await loadStorageFromCloud({ force: true, full: true });
}

function importAllDataBackup(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      alert("Le fichier de sauvegarde n'est pas lisible.");
      return;
    }

    applyBackupPayload(parsed, file.name || "ce fichier JSON");
    return;
  });
  reader.readAsText(file);
}

function buildCelebrationPieces() {
  if (!celebrationSky) return;

  const colors = ["#ffd94f", "#ff5c7a", "#46d37d", "#4eb6ff", "#ff8a2a", "#c8b98d", "#ffffff", "#9b7cff"];
  celebrationSky.innerHTML = "";

  const fragment = document.createDocumentFragment();
  const balloonCount = 140;
  const confettiCount = window.innerWidth > 1200 ? 1400 : 900;

  Array.from({ length: balloonCount }, (_, index) => {
    const balloon = document.createElement("span");
    const size = 34 + Math.round(Math.random() * 54);
    balloon.className = "balloon";
    balloon.style.left = `${Math.random() * 100}%`;
    balloon.style.width = `${size}px`;
    balloon.style.height = `${Math.round(size * 1.28)}px`;
    balloon.style.background = colors[index % colors.length];
    balloon.style.animationDelay = `${Math.random() * 2.2}s`;
    balloon.style.animationDuration = `${6.2 + Math.random() * 2.4}s`;
    balloon.style.opacity = `${0.72 + Math.random() * 0.28}`;
    fragment.append(balloon);
  });

  Array.from({ length: confettiCount }, (_, index) => {
    const confetti = document.createElement("span");
    const size = 4 + Math.round(Math.random() * 10);
    confetti.className = "confetti";
    confetti.style.left = `${Math.random() * 100}%`;
    confetti.style.width = `${size}px`;
    confetti.style.height = `${Math.round(size * (1.2 + Math.random()))}px`;
    confetti.style.background = colors[index % colors.length];
    confetti.style.animationDelay = `${Math.random() * 2.4}s`;
    confetti.style.animationDuration = `${4.8 + Math.random() * 3.4}s`;
    confetti.style.borderRadius = Math.random() > 0.55 ? "999px" : "3px";
    fragment.append(confetti);
  });

  celebrationSky.append(fragment);
}

function playCelebrationSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(0.42, audioContext.currentTime + 0.03);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 6.8);
  masterGain.connect(audioContext.destination);

  [0, 0.1, 0.2, 0.32, 0.46, 0.62, 0.8, 1, 1.24, 1.5, 1.82, 2.18].forEach((offset, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime + offset;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(820 + index * 55, start);
    oscillator.frequency.exponentialRampToValueAtTime(1680 + index * 90, start + 0.14);
    oscillator.frequency.exponentialRampToValueAtTime(690 + index * 45, start + 0.34);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.44);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(start + 0.46);
  });

  const applauseDuration = 6.4;
  const sampleRate = audioContext.sampleRate;
  const noiseBuffer = audioContext.createBuffer(1, sampleRate * applauseDuration, sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.random() * 2 - 1;
  }

  Array.from({ length: 180 }, () => {
    const start = audioContext.currentTime + 0.08 + Math.random() * 5.2;
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer = noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = 900 + Math.random() * 1800;
    filter.Q.value = 0.9 + Math.random() * 1.2;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.2 + Math.random() * 0.12, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12 + Math.random() * 0.12);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(start, Math.random() * (applauseDuration - 0.3));
    source.stop(start + 0.3);
  });

  window.setTimeout(() => audioContext.close(), 7200);
}

function playCelebrationAudioFiles() {
  celebrationAudioPlayers.forEach((player) => {
    player.pause();
    player.currentTime = 0;
  });

  celebrationAudioPlayers = celebrationAudioFiles.map((fileName) => {
    const player = new Audio(fileName);
    player.volume = 1;
    player.currentTime = 0;
    player.play().catch(() => {});
    return player;
  });
}

function showSaleCelebration() {
  if (!saleCelebration) return;

  clearTimeout(saleCelebrationTimer);
  buildCelebrationPieces();
  saleCelebration.hidden = true;
  saleCelebration.getBoundingClientRect();
  saleCelebration.hidden = false;
  playCelebrationSound();
  playCelebrationAudioFiles();

  saleCelebrationTimer = window.setTimeout(() => {
    saleCelebration.hidden = true;
    if (celebrationSky) celebrationSky.innerHTML = "";
    celebrationAudioPlayers.forEach((player) => {
      player.pause();
      player.currentTime = 0;
    });
  }, 9200);
}

function markCompromiseAsAuthenticated(recordId) {
  const record = archives.find((archive) => archive.id === recordId && archive.reason === "rented");
  if (!record) return;

  const confirmed = confirm(`Passer ${keyLabel(record.key)} en acte authentique et l'envoyer dans Archives ?`);
  if (!confirmed) return;

  rememberUndoStep();
  archives = archives.map((archive) =>
    archive.id === recordId
      ? {
          ...archive,
          reason: "authenticated",
          archivedAt: new Date().toISOString(),
        }
      : archive,
  );
  const authenticatedSet =
    record.key.sets?.find((set) => set.history?.some((entry) => entry.type === "rented")) || record.key.sets?.[0] || {};
  const authenticatedMovement =
    [...(authenticatedSet.history || [])].find((entry) => entry.type === "rented") ||
    getLatestMovementEntry(authenticatedSet.history || []);
  const defaultInternalActor = getDefaultInternalContactActor();
  logActivity(
    "Acte authentique",
    keyLabel(record.key),
    [
      authenticatedMovement?.person || defaultInternalActor.person,
      authenticatedMovement?.phone || defaultInternalActor.phone,
    ].filter(Boolean).join(" | "),
  );
  saveArchives();
  render();
  if (tableSettings.saleCelebrationEnabled !== false) showSaleCelebration();
}

async function editCompromiseDate(recordId) {
  const record = archives.find((archive) => archive.id === recordId && archive.reason === "rented");
  if (!record) return;

  const nextDate = await promptCompromiseDate(record.compromiseSignedAt || new Date().toISOString().slice(0, 10));
  if (!nextDate) return;

  rememberUndoStep();
  archives = archives.map((archive) =>
    archive.id === recordId
      ? {
          ...archive,
          compromiseSignedAt: nextDate,
        }
      : archive,
  );
  logActivity("Modification compromis", keyLabel(record.key), `Date : ${formatDateOnly(nextDate)}`);
  saveArchives();
  renderCompromisesPanel();
}

function openArchivedKeyRecord(record) {
  selectedArchiveRecord = record;
  selectedId = `archive-${record.id}`;
  selectedSetId = record.key.sets?.[0]?.id || "main";
  beginKeyWorkProtection();
  resetKeyInfoEditUnlock(record.key);
  clearTimeout(detailCloseTimer);
  clearTimeout(archivesCloseTimer);
  archivesPanel.hidden = true;
  compromisesPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  render();
}

function renderArchiveList(list, reason, emptyText, options = {}) {
  const normalizeArchiveSearchText = (value) =>
    String(value || "")
      .toLocaleLowerCase("fr-FR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const archiveQuery = normalizeArchiveSearchText(archiveSearchInput?.value).trim();
  const archivedRecords = archives
    .filter((record) => record.reason === reason)
    .filter((record) => {
      if (!archiveQuery) return true;

      const key = record.key;
      const searchableText = [
        keyLabel(key),
        key.owner,
        key.ownerFirstName,
        key.property,
        key.postalCode,
        key.city,
        key.notes,
        ...key.sets.flatMap((set) =>
          (set.history || []).flatMap((entry) => [entry.person, entry.company, entry.phone, entry.note]),
        ),
      ].join(" ");
      return normalizeArchiveSearchText(searchableText).includes(archiveQuery);
    })
    .sort((first, second) => {
      if (!options.sortByCompromiseDate) return 0;
      return String(first.compromiseSignedAt || first.archivedAt).localeCompare(
        String(second.compromiseSignedAt || second.archivedAt),
      );
    });
  list.innerHTML = "";

  if (!archivedRecords.length) {
    const item = document.createElement("li");
    item.textContent = archiveQuery ? "Aucun résultat." : emptyText;
    list.append(item);
    return;
  }

  archivedRecords.forEach((record) => {
    const key = record.key;
    const item = document.createElement("li");
    const details = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    const actions = document.createElement("span");
    const exportButton = document.createElement("button");
    const restoreButton = document.createElement("button");
    const archiveCity = [key.postalCode, key.city].filter(Boolean).join(" ");
    const address = [key.property, archiveCity].filter(Boolean).join(" - ");
    const compromiseAddress = `${key.property || "Adresse non renseignée"}, ${[
      key.postalCode || "Code postal non renseigné",
      key.city ? key.city.toUpperCase() : "VILLE NON RENSEIGNÉE",
    ].join(" ")}`;
    const archiveAction = options.showCompromiseDetails
      ? "Compromis"
      : record.reason === "removed"
        ? "Archivé"
        : record.reason === "authenticated"
          ? "Acte authentique"
          : getRegistryConfig().rentedArchiveText;
    item.dataset.historyAction = getActionClass(archiveAction);
    if (options.showCompromiseDetails) {
      const movementStatus = getCompromiseMovementStatus(record);
      if (movementStatus) item.dataset.movementStatus = movementStatus;
    }

    title.textContent = `${keyLabel(key)}${key.owner ? ` - ${formatOwner(key.owner)}` : ""}`;
    if (options.showCompromiseDetails) {
      const compromiseDate = formatDateOnly(record.compromiseSignedAt || record.archivedAt);
      [
        compromiseAddress,
        compromiseDate ? `Compromis signé le : ${compromiseDate}` : "Date de signature non renseignée",
      ]
        .forEach((line) => {
          const lineElement = document.createElement("span");
          lineElement.textContent = line;
          meta.append(lineElement);
        });
    } else {
      [address || "Adresse non renseignée", formatArchiveDate(record.archivedAt)].forEach((line) => {
        const lineElement = document.createElement("span");
        lineElement.textContent = line;
        meta.append(lineElement);
      });
    }
    actions.className = "archive-item-actions";
    exportButton.type = "button";
    exportButton.textContent = "Exporter";
    exportButton.title = "Exporter cette archive avec les signatures";
    exportButton.addEventListener("click", (event) => {
      event.stopPropagation();
      exportKeyExcel(key, record);
    });
    restoreButton.type = "button";
    restoreButton.textContent = "Restaurer";
    restoreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const confirmed = confirm(`Restaurer ${keyLabel(key)} dans le tableau ?`);
      if (!confirmed) return;

      restoreArchive(record.id);
      renderArchivesPanel();
    });

    details.append(title, meta);
    if (!options.hideExport) actions.append(exportButton);
    actions.append(restoreButton);
    item.append(details, actions);
    item.classList.add("is-clickable");
    if (options.showCompromiseDetails && !isPhoneOrTabletDevice()) {
      item.dataset.quickTip = "Appuyer sur Ctrl + clic pour modifier la date du compromis";
    } else if (!options.showCompromiseDetails) {
      item.title = "Cliquer pour consulter la fiche et son historique";
    }
    item.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.ctrlKey && event.altKey) {
        const confirmed = confirm(`Supprimer d\u00e9finitivement l'archive ${keyLabel(key)} ?`);
        if (!confirmed) return;

        archives = archives.filter((archive) => archive.id !== record.id);
        if (selectedArchiveRecord?.id === record.id) {
          selectedArchiveRecord = null;
          selectedId = null;
          selectedSetId = "main";
        }
        saveArchives();
        renderArchivesPanel();
        renderCompromisesPanel();
        render();
        return;
      }
      if (options.showCompromiseDetails && event.ctrlKey) {
        editCompromiseDate(record.id);
        return;
      }
      openArchivedKeyRecord(record);
    });

    if (options.showAuthenticatedAction) {
      const authenticatedButton = document.createElement("button");
      item.classList.add("has-full-action");
      authenticatedButton.className = "authenticated-button";
      authenticatedButton.type = "button";
      authenticatedButton.textContent = "R\u00c9IT\u00c9RATION PAR ACTE AUTHENTIQUE";
      authenticatedButton.addEventListener("click", (event) => {
        event.stopPropagation();
        markCompromiseAsAuthenticated(record.id);
      });
      item.append(authenticatedButton);
    }

    list.append(item);
  });
}

function renderArchivesPanel() {
  renderArchiveList(rentedList, "rented", getRegistryConfig().rentedArchiveEmpty);
  renderArchiveList(removedList, "removed", "Aucun bien archivé.");
  renderArchiveList(authenticatedList, "authenticated", "Aucun acte authentique archivé.");
}

function renderCompromisesPanel() {
  renderArchiveList(compromisesList, "rented", "Aucun bien en compromis.", {
    showAuthenticatedAction: true,
    showCompromiseDetails: true,
    sortByCompromiseDate: true,
    hideExport: true,
  });
  const compromisedRecords = archives.filter((record) => record.reason === "rented");
  const tabStatus = compromisedRecords.some((record) => getCompromiseMovementStatus(record) === "out")
    ? "out"
    : compromisedRecords.some((record) => getCompromiseMovementStatus(record) === "reserved")
      ? "reserved"
      : "";
  compromisesTabBtn.dataset.movementStatus = tabStatus;
}

function findRestoreSlot(archivedKey) {
  const originalSlot = keys.find((key) => key.id === archivedKey.id);
  if (originalSlot && !isKeyFilled(originalSlot)) return originalSlot;

  return keys
    .filter((key) => key.category === archivedKey.category)
    .sort((first, second) => first.number - second.number)
    .find((key) => !isKeyFilled(key));
}

function restoreArchive(recordId) {
  const record = archives.find((archive) => archive.id === recordId);
  if (!record) return;

  const targetKey = findRestoreSlot(record.key);
  if (!targetKey) {
    alert("Aucune case libre n'est disponible sur cette ligne pour restaurer ce bien.");
    return;
  }

  const restoredKey = {
    ...normalizeKey(record.key),
    id: targetKey.id,
    category: targetKey.category,
    number: targetKey.number,
  };

  rememberUndoStep();
  keys = keys.map((key) => (key.id === targetKey.id ? restoredKey : key));
  markDirtyKeySlot(targetKey.id);
  archives = archives.filter((archive) => archive.id !== recordId);
  selectedId = targetKey.id;
  selectedSetId = record.key.sets?.[0]?.id || "main";
  resetKeyInfoEditUnlock(restoredKey);
  logActivity("Restauration", keyLabel(restoredKey), [restoredKey.owner, restoredKey.property].filter(Boolean).join(" - "));
  saveKeys();
  saveArchives();
  render();
}

function matchesFilter(key) {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter?.value || "active";
  const haystack = [
    keyLabel(key),
    key.property,
    key.postalCode,
    key.city,
    key.owner,
    key.notes,
    ...key.sets.flatMap((set) => [
      set.label,
      set.holder,
      ...set.history.flatMap((entry) => [entry.person, entry.phone, entry.note]),
    ]),
  ]
    .join(" ")
    .toLowerCase();

  const statusMatches =
    status === "all" ||
    (status === "active" && !key.archived) ||
    (status === "archived" && key.archived) ||
    (status === "available" && !key.archived && key.sets.some((set) => set.status === "available")) ||
    (status === "out" && !key.archived && key.sets.some((set) => set.status === "out"));

  return statusMatches && keyHasSetStatus(key, keyStatusFilter) && (!query || haystack.includes(query));
}

function renderGrid() {
  grid.innerHTML = "";
  updateKeyStatusFilterBar();

  getTableCategories().forEach((category) => {
    const row = document.createElement("section");
    row.className = "category-row";

    const title = document.createElement("div");
    title.className = "category-title";
    title.textContent = category.label;

    const keyRow = document.createElement("div");
    keyRow.className = "key-row";
    keyRow.style.setProperty("--key-column-count", String(getCasesPerLine()));

    const visibleKeys = keys
      .filter((key) => key.category === category.id && key.number <= getSlotsPerCategory())
      .filter(matchesFilter);

    visibleKeys.forEach((key) => {
      const tileShell = document.createElement("span");
      const button = document.createElement("button");
      const ownerName = formatOwner(key.owner);
      const hasTileDetails = Boolean(ownerName && key.property?.trim());
      const shouldShowSetStrip = isKeyFilled(key);
      const displayPhoto = getDisplayPhoto(key);
      const shouldShowPhotoTile = tileViewMode === "photo" && shouldShowSetStrip;
      tileShell.className = `key-tile-shell${shouldShowPhotoTile ? " photo-view-shell" : ""}`;
      button.type = "button";
      button.draggable = shouldShowSetStrip;
      button.className = `key-tile ${getTileStatus(key)}${hasTileDetails ? " has-details" : ""}${
        shouldShowSetStrip ? " has-set-strip" : ""
      }${shouldShowPhotoTile ? " photo-view" : ""}${key.id === selectedId ? " is-selected" : ""}`;
      button.title = `${keyLabel(key)} - ${statusText(key)}`;

      if (shouldShowPhotoTile) {
        const photoContent = document.createElement("span");
        photoContent.className = `key-photo-content${displayPhoto ? "" : " is-empty"}`;
        if (displayPhoto) {
          const photoImage = document.createElement("img");
          photoImage.src = displayPhoto;
          photoImage.alt = `Photo de ${keyLabel(key)}`;
          photoContent.append(photoImage);
        } else {
          photoContent.textContent = "Aucune photo";
        }
        button.append(photoContent);
      } else if (hasTileDetails) {
        const details = document.createElement("span");
        const heading = document.createElement("span");
        const number = document.createElement("span");
        const owner = document.createElement("span");
        const address = document.createElement("span");
        const city = document.createElement("span");
        details.className = "key-details";
        heading.className = "key-heading";
        number.className = "key-number";
        owner.className = "key-owner";
        address.className = "key-address";
        city.className = "key-city";
        number.textContent = `${tileLabel(key)} :`;
        owner.textContent = ownerName;
        address.textContent = key.property.trim();
        city.textContent = [key.postalCode, key.city].filter(Boolean).join(" ");
        heading.append(number, owner);
        details.append(heading, address);
        if (city.textContent) details.append(city);
        button.append(details);
      } else {
        const number = document.createElement("span");
        number.className = "key-number";
        number.textContent = tileLabel(key);
        button.append(number);
      }

        const previewSet = key.sets.find((set) => set.photo);
        if (previewSet?.photo && !shouldShowPhotoTile) {
          const preview = document.createElement("span");
          const previewImage = document.createElement("img");
          button.classList.add("has-photo");
          preview.className = "photo-hover";
          previewImage.src = previewSet.photo;
          previewImage.alt = `Photo ${previewSet.label} de ${keyLabel(key)}`;
          preview.append(previewImage);
          button.append(preview);
        }

        if (shouldShowSetStrip) {
          const strip = document.createElement("span");
          strip.className = "key-set-strip";
          key.sets.forEach((set) => {
            const segment = document.createElement("span");
            const displayStatus = getSetDisplayStatus(set);
            segment.className = `key-set-segment ${displayStatus}`;
            segment.title = `${set.label} - ${displayStatus === "out" ? "Sorti" : displayStatus === "reserved" ? "R\u00e9serv\u00e9" : "Disponible"}`;
            strip.append(segment);
          });
          button.append(strip);
        }

        button.addEventListener("click", (event) => {
          if (Date.now() < suppressKeyTileClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (selectedId !== key.id) discardPendingNewKeyDraft();
          closeSidePanels();
          selectedArchiveRecord = null;
          selectedId = key.id;
          selectedSetId = key.sets[0]?.id || "main";
          beginKeyWorkProtection();
          if (!isKeyFilled(key) && !isPendingNewKeyDraft(key.id)) beginPendingNewKeyDraft(key);
          else pendingNewKeyDraft = null;
          resetKeyInfoEditUnlock(key);
          render();
        });
        button.addEventListener("mouseenter", () => {
          hoveredKeyId = key.id;
          if (selectedId === key.id) clearTimeout(detailCloseTimer);
        });
        button.addEventListener("mouseleave", () => {
          if (hoveredKeyId === key.id) hoveredKeyId = null;
        });
        button.addEventListener("dragstart", (event) => {
          if (!isKeyFilled(key)) {
            event.preventDefault();
            return;
          }

          draggedKeyId = key.id;
          document.body.classList.add("is-moving-key");
          button.classList.add("is-dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key.id);

          const dragImage = document.createElement("span");
          dragImage.style.position = "fixed";
          dragImage.style.left = "-9999px";
          dragImage.style.top = "-9999px";
          dragImage.style.width = "1px";
          dragImage.style.height = "1px";
          document.body.append(dragImage);
          event.dataTransfer.setDragImage(dragImage, 0, 0);
          setTimeout(() => dragImage.remove(), 0);
        });
        button.addEventListener("dragend", () => {
          draggedKeyId = null;
          suppressKeyTileClickUntil = Date.now() + 500;
          document.body.classList.remove("is-moving-key");
          button.classList.remove("is-dragging");
          document.querySelectorAll(".key-tile.is-drop-target").forEach((tile) => {
            tile.classList.remove("is-drop-target");
          });
        });
        button.addEventListener("dragover", (event) => {
          if (!draggedKeyId || draggedKeyId === key.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          button.classList.add("is-drop-target");
        });
        button.addEventListener("dragleave", () => {
          button.classList.remove("is-drop-target");
        });
        button.addEventListener("drop", (event) => {
          event.preventDefault();
          suppressKeyTileClickUntil = Date.now() + 500;
          button.classList.remove("is-drop-target");
          void moveKeyToSlot(event.dataTransfer.getData("text/plain") || draggedKeyId, key.id, {
            copy: event.ctrlKey,
          });
        });

        tileShell.append(button);
        if (shouldShowSetStrip) {
          const deleteButton = document.createElement("button");
          deleteButton.className = "key-delete-button";
          deleteButton.type = "button";
          deleteButton.textContent = "\u00d7";
          deleteButton.title = `Supprimer ${keyLabel(key)} sans archiver`;
          deleteButton.setAttribute("aria-label", `Supprimer ${keyLabel(key)} sans archiver`);
          deleteButton.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!event.ctrlKey) return;
            deleteKeyWithoutArchive(key.id);
          });
          tileShell.append(deleteButton);
        }

        keyRow.append(tileShell);
      });

    row.append(title, keyRow);
    grid.append(row);
  });
}

function renderKeySetSelect(key) {
  const selectedSet = getSelectedSet(key);
  keySetSelect.innerHTML = "";

  key.sets.forEach((set) => {
    const option = document.createElement("option");
    option.value = set.id;
    option.textContent = set.label;
    keySetSelect.append(option);
  });

  selectedSetId = selectedSet?.id || key.sets[0].id;
  keySetSelect.value = selectedSetId;
}

function compressPhotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("Photo illisible.")));
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", () => reject(new Error("Photo illisible.")));
      image.addEventListener("load", () => {
        const photo = compressLoadedImage(image);
        if (!photo.startsWith("data:image/") || photo.length < 200) {
          reject(new Error("Photo compressée invalide."));
          return;
        }
        resolve(photo);
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

function compressLoadedImage(image) {
  const variants = [
    [photoMaxSize, photoJpegQuality],
    [500, 0.32],
    [440, 0.28],
    [380, 0.24],
  ];
  let fallbackPhoto = "";

  for (const [maxSize, quality] of variants) {
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const photo = canvas.toDataURL("image/jpeg", quality);
    fallbackPhoto = photo;
    if (photo.startsWith("data:image/") && photo.length <= photoMaxDataUrlLength) return photo;
  }

  return fallbackPhoto;
}

function compressPhotoDataUrl(photo) {
  return new Promise((resolve) => {
    if (!photo || !photo.startsWith("data:image/")) {
      resolve(photo || "");
      return;
    }

    const image = new Image();
    image.addEventListener("error", () => resolve(photo));
    image.addEventListener("load", () => {
      const nextPhoto = compressLoadedImage(image);
      resolve(nextPhoto.startsWith("data:image/") && nextPhoto.length >= 200 ? nextPhoto : photo);
    });
    image.src = photo;
  });
}

async function compressKeyPhotos(key) {
  let changed = false;
  const sets = [];

  for (const set of key.sets || []) {
    const nextPhoto = await compressPhotoDataUrl(set.photo);
    changed = changed || nextPhoto !== set.photo;
    sets.push({ ...set, photo: nextPhoto });
  }

  return [{ ...key, sets }, changed];
}

async function optimizeStoredPhotos() {
  if (getRuntimeStorageValue(photoOptimizationStorageKey) === "done") return;

  markLocalEdit();
  const registries = ["location", "transaction"];
  for (const registry of registries) {
    const config = registryConfig[registry];
    const storedKeys = parseStoredArray(config.keysStorageKey, makeInitialKeys()).map(normalizeKey);
    const storedArchives = parseStoredArray(config.archivesStorageKey, []).map(normalizeArchive);
    let changed = false;
    const changedKeyIds = [];
    const nextKeys = [];
    const nextArchives = [];

    for (const key of storedKeys) {
      const [nextKey, keyChanged] = await compressKeyPhotos(key);
      changed = changed || keyChanged;
      if (keyChanged) changedKeyIds.push(key.id);
      nextKeys.push(nextKey);
    }

    for (const record of storedArchives) {
      const [nextKey, keyChanged] = await compressKeyPhotos(record.key);
      changed = changed || keyChanged;
      nextArchives.push({ ...record, key: nextKey });
    }

    if (changed) {
      setRuntimeStorageValue(config.keysStorageKey, JSON.stringify(nextKeys));
      setRuntimeStorageValue(config.archivesStorageKey, JSON.stringify(nextArchives));
      changedKeyIds.forEach((keyId) => markDirtyKeySlot(keyId, config.keysStorageKey));
      dirtyCloudKeys.add(config.keysStorageKey);
      dirtyCloudKeys.add(config.archivesStorageKey);
      savePendingCloudKeys();
      syncStorageKeyToCloud(config.keysStorageKey);
      syncStorageKeyToCloud(config.archivesStorageKey);
    }
  }

  setRuntimeStorageValue(photoOptimizationStorageKey, "done");
  keys = loadKeys();
  archives = loadArchives();
  render();
}

function isSelectedCompromiseEditable() {
  return activeRegistry === "transaction" && selectedArchiveRecord?.reason === "rented";
}

function renderKeySetPhotos(key) {
  keySetPhotoList.innerHTML = "";
  const isArchiveView = Boolean(selectedArchiveRecord);
  const canEditPhotos = !isArchiveView || isSelectedCompromiseEditable();

  key.sets.forEach((set) => {
    const item = document.createElement("article");
    const title = document.createElement("strong");
    const preview = document.createElement("div");
    const actions = document.createElement("div");
    const cameraButton = document.createElement("label");
    const cameraButtonText = document.createElement("span");
    const cameraInput = document.createElement("input");
    const importButton = document.createElement("label");
    const importButtonText = document.createElement("span");
    const importInput = document.createElement("input");

    item.className = `key-set-photo-card${set.id === selectedSetId ? " is-selected" : ""}`;
    title.textContent = set.label;
    preview.className = "photo-preview";
    preview.innerHTML = set.photo
      ? `<img src="${set.photo}" alt="Photo du jeu ${set.label} de ${keyLabel(key)}" />`
      : `<span>Aucune photo</span>`;
    if (set.photo) {
      preview.tabIndex = 0;
      preview.setAttribute("role", "button");
      preview.setAttribute("aria-label", `Afficher la photo du ${set.label}`);
      preview.addEventListener("click", () => openPhotoViewer(set.photo, `${set.label} - ${keyLabel(key)}`));
      preview.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openPhotoViewer(set.photo, `${set.label} - ${keyLabel(key)}`);
      });
    }
    actions.className = "photo-actions";
    cameraButton.className = "photo-button";
    cameraButtonText.textContent = set.photo ? "Reprendre une photo" : "Prendre une photo";
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.dataset.setId = set.id;
    cameraButton.style.display = canEditPhotos ? "" : "none";
    cameraInput.addEventListener("click", beginPhotoImport);
    cameraInput.addEventListener("cancel", finishPhotoImport);

    importButton.className = "photo-button photo-import-button";
    importButtonText.textContent = "Importer une photo";
    importInput.type = "file";
    importInput.accept = "image/*";
    importInput.dataset.setId = set.id;
    importButton.style.display = canEditPhotos ? "" : "none";
    importInput.addEventListener("click", beginPhotoImport);
    importInput.addEventListener("cancel", finishPhotoImport);
    importButton.append(importButtonText, importInput);

    cameraButton.append(cameraButtonText, cameraInput);
    actions.append(cameraButton, importButton);

    if (set.photo && canEditPhotos) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "photo-delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Supprimer la photo";
      deleteButton.addEventListener("click", () => {
        const confirmed = confirm(`Supprimer la photo du ${set.label} ?`);
        if (!confirmed) return;

        const currentKey = getSelectedKey();
        if (!currentKey) return;

        const sets = currentKey.sets.map((savedSet) =>
          savedSet.id === set.id ? { ...savedSet, photo: "" } : savedSet,
        );
        updateSelectedKeySets(sets);
      });
      actions.append(deleteButton);
    }

    item.append(title, preview, actions);
    keySetPhotoList.append(item);
  });
}

function closePhotoViewer() {
  if (!photoViewer) return;
  photoViewer.hidden = true;
}

function openPhotoViewer(src, label) {
  if (!photoViewer) {
    photoViewer = document.createElement("div");
    photoViewer.className = "photo-viewer";
    photoViewer.hidden = true;
    photoViewer.innerHTML = `
      <div class="photo-viewer-content" role="dialog" aria-modal="true">
        <button class="photo-viewer-close" type="button" aria-label="Fermer la photo"></button>
        <img alt="" />
      </div>
    `;
    photoViewer.querySelector(".photo-viewer-close").addEventListener("click", closePhotoViewer);
    photoViewer.addEventListener("click", (event) => {
      if (event.target === photoViewer) closePhotoViewer();
    });
    document.body.append(photoViewer);
  }

  const image = photoViewer.querySelector("img");
  image.src = src;
  image.alt = label;
  photoViewer.hidden = false;
}

function renderPanel() {
  const key = getSelectedKey();
  if (!key) {
    detailPanel.hidden = true;
    form.hidden = true;
    return;
  }

  const selectedSet = getSelectedSet(key);
  const isArchiveView = Boolean(selectedArchiveRecord);
  const isCompromiseView = isSelectedCompromiseEditable();
  const isReadOnlyArchive = isArchiveView && !isSelectedCompromiseEditable();
  const isNewKeyDraft = isPendingNewKeyDraft(key.id);
  selectedSetId = selectedSet.id;
  detailPanel.hidden = false;
  form.hidden = false;
  form.classList.toggle("is-archive-view", isArchiveView);
  form.classList.toggle("is-compromise-view", isCompromiseView);
  form.classList.toggle("can-edit-archive-photos", isCompromiseView && !isReadOnlyArchive);
  selectedTitle.textContent = keyLabel(key);
  statusPill.className = "status-pill status-summary";
  statusPill.innerHTML = "";
  key.sets.forEach((set, index) => {
    const item = document.createElement("span");
    const displayStatus = getSetDisplayStatus(set);
    item.className = `set-status ${displayStatus}`;
    item.textContent = `${index + 1} : ${displayStatus === "out" ? "indisponible" : displayStatus === "reserved" ? "r\u00e9serv\u00e9" : "disponible"}`;
    statusPill.append(item);
  });
  keySetCountSelect.value = String(key.sets.length);
  renderKeySetSelect(key);
  renderKeySetPhotos(key);
  if (!isSavingKeyInfoDraft && !isProtectedKeyInfoInputActive()) {
    propertyInput.value = key.property;
    postalCodeInput.value = key.postalCode || "";
    cityInput.value = key.city || "";
    ownerInput.value = formatOwner(key.owner);
    ownerFirstNameInput.value = formatFirstName(key.ownerFirstName);
    notesInput.value = key.notes;
  }
  const isKeyInfoLocked =
    !isArchiveView &&
    !isNewKeyDraft &&
    hasProtectedKeyInfo(key) &&
    !isKeyInfoEditUnlocked &&
    !isSavingKeyInfoDraft &&
    !isProtectedKeyInfoInputActive();
  form.classList.toggle("is-key-info-locked", isKeyInfoLocked);
  protectedKeyInfoInputs.forEach((input) => {
    input.readOnly = isKeyInfoLocked;
    input.classList.toggle("key-info-lockable", isKeyInfoLocked);
    input.title = isKeyInfoLocked ? "Double-cliquez pour modifier" : "";
    input.setAttribute("aria-readonly", String(isKeyInfoLocked));
  });
  const canCollapseKeyDetails = hasProtectedKeyInfo(key) && !isNewKeyDraft;
  const forceShowKeyDetails = !canCollapseKeyDetails || isKeyInfoEditUnlocked || isProtectedKeyInfoInputActive();
  const areKeyDetailsExpanded = forceShowKeyDetails || isSelectedDetailsExpanded(key);
  keyDetailsHeading.hidden = !canCollapseKeyDetails;
  keyDetailsContent.hidden = !areKeyDetailsExpanded;
  keyDetailsToggleBtn.classList.toggle("is-expanded", areKeyDetailsExpanded);
  keyDetailsToggleBtn.setAttribute("aria-expanded", String(areKeyDetailsExpanded));
  keyDetailsToggleBtn.setAttribute("aria-label", areKeyDetailsExpanded ? "Masquer les détails" : "Afficher les détails");
  const canMoveSelectedKey = !isArchiveView || isSelectedCompromiseEditable();
  const isSelectedSetOut = selectedSet.status === "out";
  const isSelectedSetOutForReservation = isSelectedSetOut && Boolean(selectedSet.holderReservationId);
  const needsSelectedSetCheckIn = Boolean(selectedSet.needsCheckIn);
  const needsSelectedSetCheckInReason = selectedSet.needsCheckInReason || "";
  const isMainMovementLocked = isReadOnlyArchive || isSelectedSetOutForReservation;
  const canCheckInSelectedKey = canMoveSelectedKey && (isNewKeyDraft || isSelectedSetOut || needsSelectedSetCheckIn) && !isSelectedSetOutForReservation;
  checkinBtn.textContent = selectedSet.status === "out" ? "Rentr\u00e9" : "Entr\u00e9";
  reservedBtn.textContent = "R\u00e9serv\u00e9";
  checkoutBtn.textContent = "Sorti";
  checkoutBtn.disabled = isNewKeyDraft || !canMoveSelectedKey || isSelectedSetOut || needsSelectedSetCheckIn;
  checkinBtn.disabled = !canCheckInSelectedKey;
  reservedBtn.disabled = isNewKeyDraft || !canMoveSelectedKey;
  rentedBtn.disabled = isNewKeyDraft || isArchiveView || key.archived;
  removedBtn.disabled = isNewKeyDraft || isArchiveView || key.archived;
  transferKeyBtn.disabled = isNewKeyDraft || isArchiveView || key.archived;
  keySetCountSelect.disabled = isReadOnlyArchive;
  propertyInput.disabled = isArchiveView;
  postalCodeInput.disabled = isArchiveView;
  cityInput.disabled = isArchiveView;
  ownerInput.disabled = isArchiveView;
  ownerFirstNameInput.disabled = isArchiveView;
  notesInput.disabled = isArchiveView;
  contactSelect.disabled = isReadOnlyArchive;
  movementPersonInput.disabled = isReadOnlyArchive;
  movementNameInput.disabled = isReadOnlyArchive;
  movementCompanyInput.disabled = isReadOnlyArchive;
  movementPhoneInput.disabled = isReadOnlyArchive;
  movementNoteInput.disabled = isReadOnlyArchive;
  clearSignatureBtn.disabled = isMainMovementLocked;
  signatureCanvas.classList.toggle("is-readonly", isMainMovementLocked);

  historyList.innerHTML = "";
  activeReservationPanel.innerHTML = "";
  activeReservationPanel.hidden = true;
  const isHistoryExpanded = isSelectedHistoryExpanded(key);
  historyList.hidden = false;
  keyHistoryToggleBtn.classList.toggle("is-expanded", isHistoryExpanded);
  keyHistoryToggleBtn.setAttribute("aria-expanded", String(isHistoryExpanded));
  keyHistoryToggleBtn.setAttribute("aria-label", isHistoryExpanded ? "Masquer l'historique" : "Afficher l'historique");
  const displayedHistory = [...selectedSet.history];
  const latestMovementEntry = getLatestMovementEntry(displayedHistory) || {};
  if (selectedArchiveRecord?.reason === "removed" && !displayedHistory.some((entry) => entry.type === "removed")) {
    displayedHistory.unshift({
      id: `${selectedArchiveRecord.id}-removed`,
      type: "removed",
      person: "",
      company: "",
      phone: "",
      note: "",
      signature: "",
      date: formatArchiveDate(selectedArchiveRecord.archivedAt),
    });
  }
  if (selectedArchiveRecord?.reason === "rented" && !displayedHistory.some((entry) => entry.type === "rented")) {
    displayedHistory.unshift({
      id: `${selectedArchiveRecord.id}-rented`,
      type: "rented",
      actionLabel: getRegistryConfig().archiveActionLabel,
      person: latestMovementEntry.person || "",
      company: latestMovementEntry.company || "",
      phone: latestMovementEntry.phone || "",
      note: "",
      signature: "",
      date: formatArchiveDate(selectedArchiveRecord.archivedAt),
    });
  }
  const activeReservationItems = [];
  const createActiveReservationItem = (entry, reservation, reservationSet) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const reservationDate = document.createElement("strong");
    const date = document.createElement("small");
    const reservationEntry = {
      ...entry,
      person: entry.person || reservation.person || "",
      company: entry.company || reservation.company || "",
      phone: entry.phone || reservation.phone || "",
      note: entry.note || reservation.note || "",
    };
    const historyPersonName = getHistoryPersonName(reservationEntry);
    const hasHistoryPerson = Boolean(
      String(reservationEntry.person || "").trim() ||
        String(reservationEntry.company || "").trim() ||
        String(reservationEntry.phone || "").trim(),
    );
    const isReservationOut = reservationSet.status === "out" && reservationSet.holderReservationId === entry.reservationId;
    const isOutForAnotherReason = reservationSet.status === "out" && reservationSet.holderReservationId !== entry.reservationId;

    item.dataset.historyId = entry.id;
    item.dataset.historyAction = "reserved";
    item.title = "Ctrl + clic pour supprimer cette ligne d'historique";
    title.textContent = `${reservationSet.label} - ${hasHistoryPerson ? `R\u00e9serv\u00e9 : ${historyPersonName}` : "R\u00e9serv\u00e9"}`;
    reservationDate.textContent = `Pour le ${formatReservationHistoryDate(entry.reservationDate || reservation.reservationDate || entry.date)}`;
    item.append(title, reservationDate);

    if (reservationEntry.company) {
      const company = document.createElement("p");
      company.textContent = `Soci\u00e9t\u00e9 : ${reservationEntry.company}`;
      item.append(company);
    }
    if (reservationEntry.note) {
      const note = document.createElement("p");
      const normalizedComment = reservationEntry.note.replace(/^Commentaire\s*:\s*/i, "");
      note.textContent = `Commentaire : ${formatSentenceStart(normalizedComment)}`;
      item.append(note);
    }

    const reservationCommentField = document.createElement("label");
    const reservationCommentLabel = document.createElement("span");
    const reservationComment = document.createElement("textarea");
    const actions = document.createElement("div");
    const movementButton = document.createElement("button");
    const removeButton = document.createElement("button");
    const cancelButton = document.createElement("button");
    const signatureField = document.createElement("div");
    const signatureLabel = document.createElement("div");
    const signatureCanvas = document.createElement("canvas");
    const clearReservationSignatureBtn = document.createElement("button");

    reservationCommentField.className = "reservation-comment-field";
    reservationCommentLabel.textContent = "Commentaire";
    reservationComment.className = "reservation-comment-input";
    reservationComment.rows = 2;
    reservationComment.placeholder = "Motif, rendez-vous, r\u00e9f\u00e9rence...";
    reservationComment.dataset.reservationId = entry.reservationId;
    reservationComment.disabled = isReadOnlyArchive;
    reservationCommentField.append(reservationCommentLabel, reservationComment);
    item.append(reservationCommentField);

    signatureField.className = "reservation-signature-field";
    signatureLabel.className = "reservation-signature-label";
    signatureLabel.innerHTML = "<span>Signature</span>";
    clearReservationSignatureBtn.type = "button";
    clearReservationSignatureBtn.textContent = "Effacer";
    clearReservationSignatureBtn.disabled = isReadOnlyArchive;
    signatureCanvas.className = "reservation-signature-canvas";
    signatureCanvas.width = 320;
    signatureCanvas.height = 212;
    signatureCanvas.dataset.reservationId = entry.reservationId;
    signatureCanvas.classList.toggle("is-readonly", isReadOnlyArchive);
    signatureCanvas.setAttribute("aria-label", "Zone de signature de la r\u00e9servation");
    clearReservationSignatureBtn.addEventListener("click", () => clearInlineSignature(signatureCanvas));
    signatureLabel.append(clearReservationSignatureBtn);
    signatureField.append(signatureLabel, signatureCanvas);
    item.append(signatureField);
    if (!isReadOnlyArchive) setupInlineSignatureCanvas(signatureCanvas);

    actions.className = "reservation-history-actions";
    movementButton.type = "button";
    movementButton.className = `reservation-history-button ${isReservationOut ? "in" : "out"}`;
    movementButton.textContent = isReservationOut ? "Rentr\u00e9" : "Sorti";
    movementButton.disabled = isReadOnlyArchive || isOutForAnotherReason;
    movementButton.addEventListener("click", () => {
      selectedSetId = reservationSet.id;
      toggleReservationMovement(entry.reservationId);
    });

    removeButton.type = "button";
    removeButton.className = "reservation-history-button removed";
    removeButton.textContent = "Archiv\u00e9";
    removeButton.disabled = isReadOnlyArchive || isOutForAnotherReason;
    removeButton.addEventListener("click", () => {
      selectedSetId = reservationSet.id;
      archiveReservationKey(entry.reservationId);
    });

    cancelButton.type = "button";
    cancelButton.className = "reservation-history-button cancel";
    cancelButton.textContent = "Annulation";
    cancelButton.disabled = isReadOnlyArchive || isReservationOut;
    cancelButton.addEventListener("click", () => {
      selectedSetId = reservationSet.id;
      void cancelReservation(entry.reservationId);
    });

    actions.append(movementButton, removeButton, cancelButton);
    item.append(actions);
    date.textContent = `R\u00e9serv\u00e9 le ${entry.createdAt || reservation.createdAt || entry.date}`;
    item.append(date);

    return {
      item,
      reservationId: entry.reservationId,
      timestamp: parseHistoryTimestamp(reservation.reservationDate || reservation.createdAt || entry.reservationDate || entry.date),
    };
  };
  const renderActiveReservations = () => {
    const knownReservationIds = new Set(activeReservationItems.map((entry) => entry.reservationId).filter(Boolean));
    key.sets.forEach((reservationSet) => {
      (reservationSet.history || []).forEach((entry) => {
        if (entry.type !== "reserved" || !entry.reservationId || knownReservationIds.has(entry.reservationId)) return;
        const reservation = (reservationSet.reservations || []).find(
          (savedReservation) => savedReservation.id === entry.reservationId && isActiveReservation(savedReservation),
        );
        if (!reservation) return;
        activeReservationItems.push(createActiveReservationItem(entry, reservation, reservationSet));
        knownReservationIds.add(entry.reservationId);
      });
    });
    activeReservationItems
      .sort((first, second) => first.timestamp - second.timestamp)
      .forEach(({ item }) => activeReservationPanel.append(item));
    activeReservationPanel.hidden = !activeReservationItems.length;
  };

  if (!displayedHistory.length) {
    const item = document.createElement("li");
    item.textContent = "Aucun mouvement enregistré pour ce jeu.";
    if (isHistoryExpanded) historyList.append(item);
    renderActiveReservations();
    return;
  }

  const sortedDisplayedHistory = displayedHistory.sort(sortKeyHistoryEntries);
  const latestHistoryEntryId = sortedDisplayedHistory[0]?.id || "";

  sortedDisplayedHistory
    .forEach((entry) => {
      const activeReservation =
        entry.type === "reserved"
          ? (selectedSet.reservations || []).find((reservation) => reservation.id === entry.reservationId && isActiveReservation(reservation))
          : null;
      const shouldShowHistoryEntry = isHistoryExpanded || entry.id === latestHistoryEntryId;
      if (!shouldShowHistoryEntry && !activeReservation) return;

      const item = document.createElement("li");
      const title = document.createElement("strong");
      const date = document.createElement("small");
    item.dataset.historyId = entry.id;
    item.title = "Ctrl + clic pour supprimer cette ligne d'historique";
    item.dataset.historyAction =
      entry.type === "out"
        ? "out"
        : entry.type === "removed"
          ? "removed"
          : entry.type === "rented"
            ? "signed"
            : entry.type === "reserved" || entry.type === "cancel-reservation"
              ? "reserved"
              : "in";
    const actionTitle = getMovementActionLabel(entry, displayedHistory);
    const historyPersonName = getHistoryPersonName(entry);
    const hasHistoryPerson =
      Boolean(String(entry.person || "").trim() || String(entry.company || "").trim() || String(entry.phone || "").trim());
    title.textContent = hasHistoryPerson ? `${actionTitle} : ${historyPersonName}` : actionTitle;
    date.textContent =
      entry.type === "reserved"
        ? `R\u00e9serv\u00e9 le ${entry.createdAt || entry.date}`
        : entry.type === "cancel-reservation" && entry.note
          ? `${entry.date} - ${entry.note}`
        : entry.date;
    item.append(title);
    if (entry.type === "reserved") {
      const reservationDate = document.createElement("strong");
      reservationDate.textContent = `Pour le ${formatReservationHistoryDate(entry.reservationDate || entry.date)}`;
      item.append(reservationDate);
    }
    if (entry.company) {
      const company = document.createElement("p");
      company.textContent = `Soci\u00e9t\u00e9 : ${entry.company}`;
      item.append(company);
    }
    const legacyReservationNoteParts =
      !entry.reservationMovement && entry.note?.includes(" | ") ? entry.note.split(" | ") : [];
    const reservationMovementText = entry.reservationMovement || legacyReservationNoteParts[0] || "";
    const commentText =
      entry.note && legacyReservationNoteParts.length > 1
        ? `Commentaire : ${legacyReservationNoteParts.slice(1).join(" | ")}`
        : entry.note || "";
    if (reservationMovementText) {
      const reservationMovement = document.createElement("p");
      reservationMovement.textContent = normalizeMovementWords(reservationMovementText);
      item.append(reservationMovement);
    }
    if (commentText && entry.type !== "cancel-reservation") {
      const note = document.createElement("p");
      const normalizedComment = commentText.replace(/^Commentaire\s*:\s*/i, "");
      note.textContent = `Commentaire : ${formatSentenceStart(normalizedComment)}`;
      item.append(note);
    }
    if (entry.signature) {
      const signature = document.createElement("img");
      signature.className = "history-signature";
      signature.src = entry.signature;
      signature.alt = `Signature ${entry.type === "out" ? "Sorti" : "Entr\u00e9"}`;
      item.append(signature);
    }
    let historySummary = null;
    if (activeReservation) {
      historySummary = item.cloneNode(true);
      const reservationCommentField = document.createElement("label");
      const reservationCommentLabel = document.createElement("span");
      const reservationComment = document.createElement("textarea");
      const actions = document.createElement("div");
      const movementButton = document.createElement("button");
      const removeButton = document.createElement("button");
      const cancelButton = document.createElement("button");
      const isReservationOut = selectedSet.status === "out" && selectedSet.holderReservationId === entry.reservationId;
      const isOutForAnotherReason = selectedSet.status === "out" && selectedSet.holderReservationId !== entry.reservationId;

      reservationCommentField.className = "reservation-comment-field";
      reservationCommentLabel.textContent = "Commentaire";
      reservationComment.className = "reservation-comment-input";
      reservationComment.rows = 2;
      reservationComment.placeholder = "Motif, rendez-vous, r\u00e9f\u00e9rence...";
      reservationComment.dataset.reservationId = entry.reservationId;
      reservationComment.disabled = isReadOnlyArchive;
      reservationCommentField.append(reservationCommentLabel, reservationComment);
      item.append(reservationCommentField);

      actions.className = "reservation-history-actions";
      movementButton.type = "button";
      movementButton.className = `reservation-history-button ${isReservationOut ? "in" : "out"}`;
      movementButton.textContent = isReservationOut ? "Rentr\u00e9" : "Sorti";
      movementButton.disabled = isReadOnlyArchive || isOutForAnotherReason;
      movementButton.addEventListener("click", () => toggleReservationMovement(entry.reservationId));

      removeButton.type = "button";
      removeButton.className = "reservation-history-button removed";
      removeButton.textContent = "Archivé";
      removeButton.disabled = isReadOnlyArchive || isOutForAnotherReason;
      removeButton.addEventListener("click", () => archiveReservationKey(entry.reservationId));

      cancelButton.type = "button";
      cancelButton.className = "reservation-history-button cancel";
      cancelButton.textContent = "Annulation";
      cancelButton.disabled = isReadOnlyArchive || isReservationOut;
      cancelButton.addEventListener("click", () => {
        void cancelReservation(entry.reservationId);
      });

      const signatureField = document.createElement("div");
      const signatureLabel = document.createElement("div");
      const signatureCanvas = document.createElement("canvas");
      const clearReservationSignatureBtn = document.createElement("button");

      signatureField.className = "reservation-signature-field";
      signatureLabel.className = "reservation-signature-label";
      signatureLabel.innerHTML = "<span>Signature</span>";
      clearReservationSignatureBtn.type = "button";
      clearReservationSignatureBtn.textContent = "Effacer";
      clearReservationSignatureBtn.disabled = isReadOnlyArchive;
      signatureCanvas.className = "reservation-signature-canvas";
      signatureCanvas.width = 320;
      signatureCanvas.height = 212;
      signatureCanvas.dataset.reservationId = entry.reservationId;
      signatureCanvas.classList.toggle("is-readonly", isReadOnlyArchive);
      signatureCanvas.setAttribute("aria-label", "Zone de signature de la réservation");
      clearReservationSignatureBtn.addEventListener("click", () => clearInlineSignature(signatureCanvas));
      signatureLabel.append(clearReservationSignatureBtn);
      signatureField.append(signatureLabel, signatureCanvas);
      item.append(signatureField);
      if (!isReadOnlyArchive) setupInlineSignatureCanvas(signatureCanvas);

      actions.append(movementButton, removeButton, cancelButton);
      item.append(actions);
    }
    item.append(date);
    if (historySummary) {
      historySummary.append(date.cloneNode(true));
      title.textContent = `${selectedSet.label} - ${title.textContent}`;
      activeReservationItems.push({
        item,
        reservationId: entry.reservationId,
        timestamp: parseHistoryTimestamp(activeReservation.reservationDate || activeReservation.createdAt || entry.reservationDate || entry.date),
      });
      if (shouldShowHistoryEntry) historyList.append(historySummary);
    } else if (shouldShowHistoryEntry) {
      historyList.append(item);
    }
  });
  renderActiveReservations();
}

function deleteHistoryEntry(historyId) {
  const key = getSelectedKey();
  const selectedSet = getSelectedSet(key);
  if (!key || !selectedSet || !historyId) return;

  const entry = selectedSet.history.find((item) => item.id === historyId);
  if (!entry) return;
  if (entry.type === "reserved" && selectedSet.status === "out" && selectedSet.holderReservationId === entry.reservationId) {
    alert("Cette r\u00e9servation est sortie : fais d'abord Rentr\u00e9 avant de supprimer cette ligne.");
    return;
  }

  const confirmed = confirm("Supprimer cette ligne d'historique ?");
  if (!confirmed) return;

  const nextHistory = selectedSet.history.filter((item) => item.id !== historyId);
  const nextReservations =
    entry.type === "reserved" && entry.reservationId
      ? (selectedSet.reservations || []).filter((reservation) => reservation.id !== entry.reservationId)
      : selectedSet.reservations || [];
  const repairedSet = repairSetMovementState({
    ...selectedSet,
    reservations: nextReservations,
    history: nextHistory,
  });

  updateSelectedSet({
    status: repairedSet.status,
    holder: repairedSet.holder,
    holderCompany: repairedSet.holderCompany,
    holderPhone: repairedSet.holderPhone,
    holderReservationId: repairedSet.holderReservationId,
    reservations: repairedSet.reservations,
    history: repairedSet.history,
  });
}

function updateSelectedKey(changes, options = {}) {
  if (selectedArchiveRecord) return;
  const shouldRenderPanel = options.renderPanel !== false;
  if (isPendingNewKeyDraft()) {
    pendingNewKeyDraft = { ...pendingNewKeyDraft, ...changes };
    if (shouldRenderPanel) render();
    else {
      renderGrid();
      renderCompromisesPanel();
    }
    return;
  }
  const previousKey = getSelectedKey();
  const wasFilled = previousKey ? isKeyFilled(previousKey) : false;
  markDirtyKeySlot(selectedId);
  rememberUndoStep();
  keys = keys.map((key) => (key.id === selectedId ? { ...key, ...changes } : key));
  let nextKey = getSelectedKey();
  if (nextKey && !wasFilled && isKeyFilled(nextKey)) {
    keys = keys.map((key) =>
      key.id === selectedId
        ? {
            ...key,
            sets: key.sets.map((set, index) =>
              set.id === selectedSetId || (!selectedSetId && index === 0)
                ? { ...set, needsCheckIn: true, needsCheckInReason: "created" }
                : set,
            ),
          }
        : key,
    );
    nextKey = getSelectedKey();
    logActivity(
      "Création fiche",
      `${keyLabel(nextKey)}${nextKey.owner ? ` - ${formatOwner(nextKey.owner)}` : ""}`,
      [nextKey.owner, nextKey.property].filter(Boolean).join(" - "),
    );
  } else if (nextKey && wasFilled && isKeyFilled(nextKey)) {
    updateCreationActivityForKey(nextKey);
  }
  saveKeys();
  if (shouldRenderPanel) {
    render();
  } else {
    renderGrid();
    renderCompromisesPanel();
  }
}

function updateSelectedSet(changes) {
  const key = getSelectedKey();
  if (!key) return;

  const sets = key.sets.map((set) => (set.id === selectedSetId ? { ...set, ...changes } : set));
  if (selectedArchiveRecord) {
    const nextArchiveRecord = {
      ...selectedArchiveRecord,
      key: {
        ...selectedArchiveRecord.key,
        sets,
      },
    };
    selectedArchiveRecord = nextArchiveRecord;
    archives = archives.map((archive) => (archive.id === nextArchiveRecord.id ? nextArchiveRecord : archive));
    saveArchives();
    render();
    return;
  }
  updateSelectedKey({ sets });
}

function updateSelectedKeySets(sets) {
  if (selectedArchiveRecord) {
    const nextArchiveRecord = {
      ...selectedArchiveRecord,
      key: {
        ...selectedArchiveRecord.key,
        sets,
      },
    };
    selectedArchiveRecord = nextArchiveRecord;
    archives = archives.map((archive) => (archive.id === nextArchiveRecord.id ? nextArchiveRecord : archive));
    saveArchives();
    renderCompromisesPanel();
    render();
    return;
  }
  updateSelectedKey({ sets });
}

function setKeySetCount(count) {
  if (selectedArchiveRecord && !isSelectedCompromiseEditable()) return;
  const key = getSelectedKey();
  if (!key) return;

  const nextCount = Math.max(1, Math.min(4, count));
  const previousCount = key.sets.length;
  if (nextCount === previousCount) return;

  const ownerName = key.owner ? formatOwner(key.owner) : "PROPRI\u00c9TAIRE NON RENSEIGN\u00c9";
  const keyCountWord = nextCount > 1 ? "jeux" : "jeu";
  const confirmedCount = confirm(
    `Confirmez-vous la pr\u00e9sence de ${nextCount} ${keyCountWord} de cl\u00e9 pour le bien de monsieur et/ou madame "${ownerName}" ?`
  );
  if (!confirmedCount) {
    keySetCountSelect.value = String(previousCount);
    return;
  }

  const nextIds = keySetOptions.slice(0, nextCount).map((option) => option.id);
  const removedSets = key.sets.filter((set) => !nextIds.includes(set.id));
  const removedHasData = removedSets.some((set) => set.status === "out" || set.holder || set.history.length || hasActiveReservations(set));

  if (removedHasData) {
    const confirmed = confirm("Réduire le nombre de jeux supprimera l'historique des jeux retirés. Continuer ?");
    if (!confirmed) {
      keySetCountSelect.value = String(key.sets.length);
      return;
    }
  }

  const nextSets = nextIds.map((id, index) => {
    const savedSet = key.sets.find((set) => set.id === id);
    return savedSet || { ...makeKeySet(id), needsCheckIn: index >= previousCount, needsCheckInReason: "added" };
  });
  selectedSetId = nextSets.some((set) => set.id === selectedSetId) ? selectedSetId : nextSets[0].id;
  if (nextCount > previousCount) {
    selectedSetId = nextSets[nextCount - 1]?.id || selectedSetId;
    if (!isPendingNewKeyDraft()) {
      logActivity("Ajout jeu", `${keyLabel(key)}${key.owner ? ` - ${formatOwner(key.owner)}` : ""}`, [key.owner, `${nextCount} jeux au total`].filter(Boolean).join(" - "));
    }
  } else if (nextCount < previousCount) {
    if (!isPendingNewKeyDraft()) {
      logActivity("Suppression jeu", keyLabel(key), `${removedSets.map((set) => set.label).join(", ")} supprimé(s)`);
    }
  }
  if (selectedArchiveRecord) {
    const nextArchiveRecord = {
      ...selectedArchiveRecord,
      key: {
        ...selectedArchiveRecord.key,
        sets: nextSets,
      },
    };
    selectedArchiveRecord = nextArchiveRecord;
    archives = archives.map((archive) => (archive.id === nextArchiveRecord.id ? nextArchiveRecord : archive));
    saveArchives();
    renderCompromisesPanel();
    render();
    return;
  }
  updateSelectedKey({ sets: nextSets });
}

async function addMovement(type) {
  if (selectedArchiveRecord && !isSelectedCompromiseEditable()) return;
  const key = getSelectedKey();
  const selectedSet = getSelectedSet(key);
  if (!key || !selectedSet || (key.archived && !selectedArchiveRecord)) return;
  const isNewKeyDraft = isPendingNewKeyDraft(key.id);
  if (isNewKeyDraft && type !== "in") {
    alert("Valide d'abord la création de cette fiche avec le bouton Entré.");
    return;
  }
  if (selectedSet.status === "out" && selectedSet.holderReservationId) {
    alert("Cette sortie vient d'une r\u00e9servation : utilise la case orange de r\u00e9servation au-dessus.");
    return;
  }
  const forcedPerson = type === "in" && selectedSet.status === "out" ? selectedSet.holder : "";
  const forcedPhone = type === "in" && selectedSet.status === "out" ? selectedSet.holderPhone : "";
  const forcedCompany = type === "in" && selectedSet.status === "out" ? selectedSet.holderCompany : "";
  const isReturningAfterCheckout = type === "in" && selectedSet.status === "out";
  if (!ensureMovementActor(type === "out" ? "Sorti" : "Entr\u00e9", { person: forcedPerson, company: forcedCompany })) return;
  if (type === "out" && !ensureTypedMovementPhone("Sorti")) return;
  if (type !== "out" && !ensureCompletePhoneNumber(movementPhoneInput, "num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant")) return;
  if (type === "out") showCheckoutReservationWarning(selectedSet);
  const signature = await promptMovementSignature(type === "out" ? "Sorti" : isReturningAfterCheckout ? "Rentr\u00e9" : "Entr\u00e9");
  if (signature === null) return;

  const entry = {
    id: createHistoryId(),
    type,
    person: forcedPerson || getMovementPersonInputName(),
    company: forcedCompany || formatCompanyName(movementCompanyInput.value).trim(),
    phone: formatPhoneNumber(forcedPhone || movementPhoneInput.value),
    note: formatSentenceStart(movementNoteInput.value).trim(),
    signature,
    returnReason: type === "in" && isReturningAfterCheckout ? "returned" : "created",
    date: new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date()),
  };

  updateSelectedSet({
    status: type === "out" ? "out" : "available",
    needsCheckIn: false,
    needsCheckInReason: "",
    holder: type === "out" ? entry.person || selectedSet.holder : "",
    holderCompany: type === "out" ? entry.company || selectedSet.holderCompany : "",
    holderPhone: type === "out" ? entry.phone || selectedSet.holderPhone : "",
    holderReservationId: "",
    reservations:
      type === "in" && selectedSet.holderReservationId
        ? (selectedSet.reservations || []).filter((reservation) => reservation.id !== selectedSet.holderReservationId)
        : selectedSet.reservations || [],
    history: [entry, ...selectedSet.history],
  });
  if (isNewKeyDraft) commitPendingNewKeyDraft();
  logActivity(getMovementActionLabel(entry), `${keyLabel(key)}${key.owner ? ` - ${formatOwner(key.owner)}` : ""} - ${selectedSet.label}`, [entry.person || entry.company, entry.phone, entry.note].filter(Boolean).join(" | "));

  movementPersonInput.value = "";
  movementNameInput.value = "";
  movementCompanyInput.value = "";
  movementPhoneInput.value = "";
  movementNoteInput.value = "";
  contactSelect.value = "";
  clearSignature();
  const actionArchivesChanged = Boolean(selectedArchiveRecord);
  if (selectedArchiveRecord) renderCompromisesPanel();
  await finishKeyControlAction(key.id, { keysChanged: !actionArchivesChanged, archivesChanged: actionArchivesChanged });
}

function getMovementDateText() {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

function getInlineReservationSignature(reservationId) {
  const canvas = activeReservationPanel.querySelector(`.reservation-signature-canvas[data-reservation-id="${reservationId}"]`);
  return canvas?.dataset.signed === "true" ? canvas.toDataURL("image/png") : "";
}

function getInlineReservationComment(reservationId) {
  const input = activeReservationPanel.querySelector(`.reservation-comment-input[data-reservation-id="${reservationId}"]`);
  return input?.value.trim() || "";
}

function clearInlineSignature(canvas) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  canvas.dataset.signed = "false";
}

function setupInlineSignatureCanvas(canvas) {
  let isDrawing = false;
  const context = canvas.getContext("2d");
  context.lineWidth = 2.4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#1e2528";

  const getPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const clampedX = Math.min(Math.max(event.clientX, rect.left), rect.right);
    const clampedY = Math.min(Math.max(event.clientY, rect.top), rect.bottom);
    return {
      x: ((clampedX - rect.left) / rect.width) * canvas.width,
      y: ((clampedY - rect.top) / rect.height) * canvas.height,
    };
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    isDrawing = true;
    canvas.dataset.signed = "true";
    canvas.setPointerCapture?.(event.pointerId);
    const point = getPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  });
  const stopDrawing = (event) => {
    if (event?.pointerId !== undefined) canvas.releasePointerCapture?.(event.pointerId);
    isDrawing = false;
  };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
}

function canvasHasInk(canvas) {
  const context = canvas.getContext("2d");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

function promptMovementSignature(actionLabel) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    const title = document.createElement("h3");
    const field = document.createElement("div");
    const label = document.createElement("div");
    const canvas = document.createElement("canvas");
    const clearButton = document.createElement("button");
    const actions = document.createElement("div");
    const cancelButton = document.createElement("button");
    const validateButton = document.createElement("button");

    dialog.className = "movement-signature-dialog";
    dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
    dialog.addEventListener("click", (event) => event.stopPropagation());
    title.textContent = `Signature - ${actionLabel}`;
    field.className = "movement-signature-field";
    label.className = "movement-signature-label";
    label.innerHTML = "<span>Signature</span>";
    canvas.className = "movement-signature-canvas";
    canvas.width = 320;
    canvas.height = 180;
    canvas.setAttribute("aria-label", `Zone de signature ${actionLabel}`);

    clearButton.type = "button";
    clearButton.textContent = "Effacer";
    clearButton.addEventListener("click", () => clearInlineSignature(canvas));

    cancelButton.type = "button";
    cancelButton.textContent = "Annuler";
    cancelButton.className = "movement-signature-cancel";
    cancelButton.addEventListener("click", () => dialog.close("cancel"));

    validateButton.type = "button";
    validateButton.textContent = "Valider";
    validateButton.className = "movement-signature-validate";
    validateButton.addEventListener("click", () => {
      const signature = canvasHasInk(canvas) ? canvas.toDataURL("image/png") : "";
      dialog.close("validate");
      resolve(signature);
    });

    label.append(clearButton);
    field.append(label, canvas);
    actions.className = "movement-signature-actions";
    actions.append(cancelButton, validateButton);
    dialog.append(title, field, actions);
    document.body.append(dialog);
    setupInlineSignatureCanvas(canvas);
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue !== "validate") resolve(null);
        dialog.remove();
      },
      { once: true },
    );
    dialog.showModal();
  });
}

async function toggleReservationMovement(reservationId) {
  if (selectedArchiveRecord && !isSelectedCompromiseEditable()) return;
  const key = getSelectedKey();
  const selectedSet = getSetForReservation(key, reservationId) || getSelectedSet(key);
  if (!key || !selectedSet || (key.archived && !selectedArchiveRecord)) return;
  selectedSetId = selectedSet.id;

  const reservation = (selectedSet.reservations || []).find((item) => item.id === reservationId);
  if (!reservation) return;

  const isReservationOut = selectedSet.status === "out" && selectedSet.holderReservationId === reservationId;
  if (!isReservationOut) showCheckoutReservationWarning(selectedSet, reservationId);
  const signature = await promptMovementSignature(isReservationOut ? "Rentr\u00e9" : "Sorti");
  if (signature === null) return;
  const inlineComment = formatSentenceStart(getInlineReservationComment(reservationId)).trim();
  const reservationMovement = isReservationOut
    ? `Rentr\u00e9 r\u00e9servation du ${reservation.reservationDate || ""}`.trim()
    : `Sorti r\u00e9servation du ${reservation.reservationDate || ""}`.trim();
  const entry = {
    id: createHistoryId(),
    type: isReservationOut ? "in" : "out",
    person: reservation.person || "",
    company: reservation.company || "",
    phone: formatPhoneNumber(reservation.phone || ""),
    reservationMovement,
    note: inlineComment ? `Commentaire : ${inlineComment}` : "",
    signature,
    returnReason: isReservationOut ? "returned" : "",
    date: getMovementDateText(),
    reservationId,
  };

  updateSelectedSet({
    status: isReservationOut ? "available" : "out",
    holder: isReservationOut ? "" : entry.person,
    holderCompany: isReservationOut ? "" : entry.company,
    holderPhone: isReservationOut ? "" : entry.phone,
    holderReservationId: isReservationOut ? "" : reservationId,
    reservations: isReservationOut
      ? (selectedSet.reservations || []).filter((item) => item.id !== reservationId)
      : selectedSet.reservations || [],
    history: [entry, ...selectedSet.history],
  });
  logActivity(
    getMovementActionLabel(entry),
    `${keyLabel(key)}${key.owner ? ` - ${formatOwner(key.owner)}` : ""} - ${selectedSet.label}`,
    [entry.person || entry.company, entry.phone, entry.note].filter(Boolean).join(" | "),
  );
  const actionArchivesChanged = Boolean(selectedArchiveRecord);
  if (selectedArchiveRecord) renderCompromisesPanel();
  markKeyControlActionForSync(key.id, { keysChanged: !actionArchivesChanged, archivesChanged: actionArchivesChanged });
  await syncCloudAfterAction();
}

async function cancelReservation(reservationId) {
  if (selectedArchiveRecord && !isSelectedCompromiseEditable()) return;
  const key = getSelectedKey();
  const selectedSet = getSetForReservation(key, reservationId) || getSelectedSet(key);
  if (!key || !selectedSet || (key.archived && !selectedArchiveRecord)) return;
  selectedSetId = selectedSet.id;

  const reservation = (selectedSet.reservations || []).find((item) => item.id === reservationId);
  if (!reservation) return;
  if (selectedSet.status === "out" && selectedSet.holderReservationId === reservationId) {
    alert("Cette r\u00e9servation est sortie : fais d'abord Rentr\u00e9.");
    return;
  }

  const entry = {
    id: createHistoryId(),
    type: "cancel-reservation",
    person: reservation.person || "R\u00e9servation annul\u00e9e",
    company: reservation.company || "",
    phone: formatPhoneNumber(reservation.phone || ""),
    note: `Annulation r\u00e9servation du ${reservation.reservationDate || ""}`.trim(),
    signature: "",
    date: getMovementDateText(),
    reservationId,
  };

  updateSelectedSet({
    reservations: (selectedSet.reservations || []).filter((item) => item.id !== reservationId),
    history: [entry, ...selectedSet.history],
  });
  logActivity("Annulation r\u00e9servation", `${key.owner ? formatOwner(key.owner) : keyLabel(key)} - ${selectedSet.label}`, entry.person);
  const actionArchivesChanged = Boolean(selectedArchiveRecord);
  if (selectedArchiveRecord) renderCompromisesPanel();
  markKeyControlActionForSync(key.id, { keysChanged: !actionArchivesChanged, archivesChanged: actionArchivesChanged });
  await syncCloudAfterAction();
}

async function archiveReservationKey(reservationId) {
  if (selectedArchiveRecord) return;
  const key = getSelectedKey();
  const selectedSet = getSetForReservation(key, reservationId) || getSelectedSet(key);
  if (!key || !selectedSet || key.archived) return;
  selectedSetId = selectedSet.id;

  const reservation = (selectedSet.reservations || []).find((item) => item.id === reservationId);
  if (!reservation) return;
  if (selectedSet.status === "out" && selectedSet.holderReservationId !== reservationId) {
    alert("Ce jeu est sorti pour une autre action : fais d'abord Rentr\u00e9 avant de l'archiver.");
    return;
  }

  const actionLabel = "Archiv\u00e9";
  if (!ensureMovementActor(actionLabel)) return;
  if (!ensureCompletePhoneNumber(movementPhoneInput, "num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant")) return;
  const archiveActor = getTypedMovementActor();
  const confirmed = confirm(`Archiver ${keyLabel(key)} et lib\u00e9rer la case ?`);
  if (!confirmed) return;
  const signature = await promptMovementSignature(actionLabel);
  if (signature === null) return;
  rememberUndoStep();

  const archivedAt = new Date().toISOString();
  const entry = {
    id: createHistoryId(),
    type: "removed",
    actionLabel,
    person: archiveActor.person,
    company: archiveActor.company,
    phone: archiveActor.phone,
    note: formatSentenceStart(getInlineReservationComment(reservationId)).trim(),
    signature,
    date: getMovementDateText(),
    reservationId,
  };
  const archivedKey = {
    ...key,
    sets: key.sets.map((set) =>
      set.id === selectedSet.id
        ? {
            ...set,
            status: "available",
            holder: "",
            holderCompany: "",
            holderPhone: "",
            holderReservationId: "",
            reservations: (set.reservations || []).filter((item) => item.id !== reservationId),
            history: [entry, ...set.history],
          }
        : set,
    ),
  };

  archives = [
    {
      id: `${key.id}-${archivedAt}`,
      reason: "removed",
      archivedAt,
      compromiseSignedAt: "",
      key: { ...archivedKey, archived: false },
    },
    ...archives,
  ];
  clearActiveKeySlotForSync(key.id);
  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  logActivity(actionLabel, keyLabel(key), [key.owner, key.property, entry.person || entry.company, entry.phone].filter(Boolean).join(" - "));
  saveArchives();
  saveKeys();
  await finishKeyControlAction(key.id, { keysChanged: true, archivesChanged: true });
}

async function reserveSelectedSet() {
  if (selectedArchiveRecord && !isSelectedCompromiseEditable()) return;
  const key = getSelectedKey();
  const selectedSet = getSelectedSet(key);
  if (!key || !selectedSet || (key.archived && !selectedArchiveRecord)) return;
  clearTimeout(detailCloseTimer);

  const contact = contacts.find((savedContact) => savedContact.id === contactSelect.value);
  const person = getMovementPersonInputName();
  const company = contact?.type === "external" ? formatCompanyName(contact.companyName || "").trim() : formatCompanyName(movementCompanyInput.value).trim();
  const phone = formatPhoneNumber(contact?.phone || movementPhoneInput.value);
  if (!ensureMovementActor("R\u00e9serv\u00e9")) return;
  if (!ensureTypedMovementPhone("R\u00e9serv\u00e9")) return;

  const reservationDateTime = await promptReservationDateTime();
  if (!reservationDateTime) return;
  clearTimeout(detailCloseTimer);

  const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const createdAt = dateTimeFormatter.format(new Date());
  const formattedDate = dateTimeFormatter.format(new Date(reservationDateTime));
  const entry = {
    id: createHistoryId(),
    type: "reserved",
    reservationId: `reservation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    person,
    company,
    phone,
    note: formatSentenceStart(movementNoteInput.value).trim(),
    signature: "",
    date: createdAt,
    createdAt,
    reservationDate: formattedDate,
  };

  updateSelectedSet({
    reservations: [
      {
        id: entry.reservationId,
        person,
        company: entry.company || "",
        phone: entry.phone || "",
        note: entry.note || "",
        createdAt,
        reservationDate: formattedDate,
      },
      ...(selectedSet.reservations || []),
    ],
    history: [entry, ...selectedSet.history],
  });
  logActivity(
    "R\u00e9serv\u00e9",
    `${key.owner ? formatOwner(key.owner) : keyLabel(key)} - ${selectedSet.label}`,
    [person ? `Intervenant : ${person}` : "", phone ? `T\u00e9l\u00e9phone : ${phone}` : "", company ? `Soci\u00e9t\u00e9 : ${company}` : "", `Pour le ${formattedDate}`, entry.note].filter(Boolean).join(" | "),
  );

  movementPersonInput.value = "";
  movementNameInput.value = "";
  movementCompanyInput.value = "";
  movementPhoneInput.value = "";
  movementNoteInput.value = "";
  contactSelect.value = "";
  clearSignature();
  const actionArchivesChanged = Boolean(selectedArchiveRecord);
  if (selectedArchiveRecord) renderCompromisesPanel();
  await finishKeyControlAction(key.id, { keysChanged: !actionArchivesChanged, archivesChanged: actionArchivesChanged });
}

function promptReservationDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const defaultValue = now.toISOString().slice(0, 16);
  const dialog = document.createElement("dialog");
  dialog.className = "date-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <h3>Date et heure de r\u00e9servation</h3>
      <input type="datetime-local" value="${defaultValue}" required />
      <div>
        <button value="cancel" type="submit">Annuler</button>
        <button value="confirm" type="submit">Valider</button>
      </div>
    </form>
  `;
  document.body.append(dialog);

  const input = dialog.querySelector("input");
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const value = dialog.returnValue === "confirm" ? input.value : "";
        dialog.remove();
        resolve(value);
      },
      { once: true },
    );
  });
}

function promptCompromiseDate(defaultValue = new Date().toISOString().slice(0, 10), title = "Date de signature du compromis") {
  const dialog = document.createElement("dialog");
  dialog.className = "date-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <h3>${title}</h3>
      <input type="date" value="${defaultValue}" required />
      <div>
        <button value="cancel" type="submit">Annuler</button>
        <button value="confirm" type="submit">Valider</button>
      </div>
    </form>
  `;
  document.body.append(dialog);

  const input = dialog.querySelector("input");
  dialog.showModal();
  input.focus();

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const value = dialog.returnValue === "confirm" ? input.value : "";
        dialog.remove();
        resolve(value);
      },
      { once: true },
    );
  });
}

async function archiveSelectedKey(reason) {
  const key = getSelectedKey();
  if (!key || key.archived) return;

  const actionLabel = reason === "rented" ? getRegistryConfig().archiveActionLabel : "Archivé";
  if (!ensureMovementActor(actionLabel)) return;
  if (!ensureCompletePhoneNumber(movementPhoneInput, "num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant")) return;
  let compromiseSignedAt = "";
  if (reason === "rented" && activeRegistry === "transaction") {
    compromiseSignedAt = await promptCompromiseDate();
    if (!compromiseSignedAt) return;
  }

  const confirmed = confirm(`${actionLabel} ${keyLabel(key)} et libérer la case ?`);
  if (!confirmed) return;
  const signature = await promptMovementSignature(actionLabel);
  if (signature === null) return;
  rememberUndoStep();

  const archivedAt = new Date().toISOString();
  const selectedSet = getSelectedSet(key);
  const archiveEntry =
    selectedSet
      ? {
          id: createHistoryId(),
          type: reason === "removed" ? "removed" : "rented",
          actionLabel,
          person: getMovementPersonInputName(),
          company: formatCompanyName(movementCompanyInput.value).trim(),
          phone: formatPhoneNumber(movementPhoneInput.value),
          note: formatSentenceStart(movementNoteInput.value).trim(),
          signature,
          date: new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date()),
        }
      : null;
  const archivedKey = archiveEntry
    ? {
        ...key,
        sets: key.sets.map((set) =>
          set.id === selectedSet.id
            ? {
                ...set,
                history: [archiveEntry, ...set.history],
              }
            : set,
        ),
      }
    : key;
  archives = [
    {
      id: `${key.id}-${archivedAt}`,
      reason,
      archivedAt,
      compromiseSignedAt,
      key: { ...archivedKey, archived: false },
    },
    ...archives,
  ];
  clearActiveKeySlotForSync(key.id);
  selectedId = null;
  selectedArchiveRecord = null;
  selectedSetId = "main";
  const movementActor = getTypedMovementActor();
  logActivity(actionLabel, keyLabel(key), [key.owner, key.property, movementActor.person || movementActor.company, compromiseSignedAt ? `Signature : ${formatDateOnly(compromiseSignedAt)}` : ""].filter(Boolean).join(" - "));
  saveArchives();
  saveKeys();
  await finishKeyControlAction(key.id, { keysChanged: true, archivesChanged: true });
}

function openContactsPanel() {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  compromisesPanel.hidden = true;
  archivesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  contactsPanel.hidden = false;
  renderContactsPanel();
}

function openCompromisesPanel() {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  contactsPanel.hidden = true;
  archivesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  compromisesPanel.hidden = false;
  renderCompromisesPanel();
}

function openArchivesPanel() {
  clearTimeout(contactsCloseTimer);
  clearTimeout(archivesCloseTimer);
  contactsPanel.hidden = true;
  compromisesPanel.hidden = true;
  globalHistoryPanel.hidden = true;
  savedBackupsPanel.hidden = true;
  if (settingsPanel) settingsPanel.hidden = true;
  archivesPanel.hidden = false;
  renderArchivesPanel();
}

function scheduleCloseContactsPanel() {
  clearTimeout(contactsCloseTimer);
}

function scheduleCloseArchivesPanel() {
  clearTimeout(archivesCloseTimer);
}

function debounce(callback, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function getSignatureContext() {
  const context = signatureCanvas.getContext("2d");
  context.lineWidth = 2.4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#1e2528";
  return context;
}

function getSignaturePoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  const source = event.touches?.[0] || event;
  const clampedX = Math.min(Math.max(source.clientX, rect.left), rect.right);
  const clampedY = Math.min(Math.max(source.clientY, rect.top), rect.bottom);

  return {
    x: ((clampedX - rect.left) / rect.width) * signatureCanvas.width,
    y: ((clampedY - rect.top) / rect.height) * signatureCanvas.height,
  };
}

function startSignature(event) {
  event.preventDefault();
  isSigning = true;
  hasSignature = true;
  signatureCanvas.setPointerCapture?.(event.pointerId);
  const point = getSignaturePoint(event);
  const context = getSignatureContext();
  context.beginPath();
  context.moveTo(point.x, point.y);
}

function drawSignature(event) {
  if (!isSigning) return;
  event.preventDefault();
  const point = getSignaturePoint(event);
  const context = getSignatureContext();
  context.lineTo(point.x, point.y);
  context.stroke();
}

function stopSignature(event) {
  if (event?.pointerId !== undefined) signatureCanvas.releasePointerCapture?.(event.pointerId);
  isSigning = false;
}

function signatureCanvasHasInk() {
  const context = signatureCanvas.getContext("2d");
  const { data } = context.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

function getMainSignatureDataUrl() {
  return hasSignature || signatureCanvasHasInk() ? signatureCanvas.toDataURL("image/png") : "";
}

function clearSignature() {
  const context = signatureCanvas.getContext("2d");
  context.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  hasSignature = false;
}

propertyInput.addEventListener(
  "input",
  debounce(updateSelectedKeyInfoFromDraft),
);
propertyInput.addEventListener("blur", () => {
  propertyInput.value = formatConfigurablePropertyAddress(propertyInput.value);
  updateSelectedKeyInfoFromDraft();
});
postalCodeInput.addEventListener("input", debounce(updateSelectedKeyInfoFromDraft));
cityInput.addEventListener("input", debounce(updateSelectedKeyInfoFromDraft));
cityInput.addEventListener("blur", () => {
  cityInput.value = formatCity(cityInput.value);
  updateSelectedKeyInfoFromDraft();
});
ownerInput.addEventListener(
  "input",
  debounce(updateSelectedKeyInfoFromDraft),
);
ownerInput.addEventListener("blur", () => {
  ownerInput.value = formatOwner(ownerInput.value).trim();
  updateSelectedKeyInfoFromDraft();
});
ownerFirstNameInput.addEventListener(
  "input",
  debounce(updateSelectedKeyInfoFromDraft),
);
ownerFirstNameInput.addEventListener("blur", () => {
  ownerFirstNameInput.value = formatFirstName(ownerFirstNameInput.value);
  updateSelectedKeyInfoFromDraft();
});
notesInput.addEventListener("input", debounce(updateSelectedKeyInfoFromDraft));
protectedKeyInfoInputs.forEach((input) => {
  input.addEventListener("input", captureActiveKeyInfoDraft);
});
protectedKeyInfoInputs.forEach((input) => {
  input.addEventListener("dblclick", unlockKeyInfoEdit);
});
keySetCountSelect.addEventListener("change", () => setKeySetCount(Number(keySetCountSelect.value)));
keySetSelect.addEventListener("change", () => {
  selectedSetId = keySetSelect.value;
  clearSignature();
  render();
});
checkoutBtn.addEventListener("click", () => addMovement("out"));
checkinBtn.addEventListener("click", () => addMovement("in"));
reservedBtn.addEventListener("click", reserveSelectedSet);
rentedBtn.addEventListener("click", () => archiveSelectedKey("rented"));
removedBtn.addEventListener("click", () => archiveSelectedKey("removed"));
clearSignatureBtn.addEventListener("click", clearSignature);
keyDetailsToggleBtn.addEventListener("click", toggleSelectedDetails);
keyHistoryToggleBtn.addEventListener("click", toggleSelectedHistory);
historyList.addEventListener("click", (event) => {
  if (!event.ctrlKey) return;
  if (event.target.closest("button")) return;

  const item = event.target.closest("[data-history-id]");
  if (!item) return;
  event.preventDefault();
  deleteHistoryEntry(item.dataset.historyId);
});
globalHistoryList.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;

  const item = event.target.closest("[data-global-history-id]");
  if (!item) return;
  event.preventDefault();
  if (event.ctrlKey) {
    deleteGlobalHistoryEntry(item.dataset.globalHistoryId);
    return;
  }

  openHistoryKey({
    registry: item.dataset.historyRegistry,
    keyId: item.dataset.historyKeyId,
    setId: item.dataset.historySetId,
    archiveId: item.dataset.historyArchiveId,
  });
});
contactSelect.addEventListener("change", () => {
  const contact = contacts.find((savedContact) => savedContact.id === contactSelect.value);
  if (!contact) {
    movementNameInput.value = "";
    movementCompanyInput.value = "";
    return;
  }

  movementPersonInput.value = formatFirstName(contact.firstName || "");
  movementNameInput.value = formatLastName(contact.name || "");
  movementCompanyInput.value = contact.type === "external" ? formatCompanyName(contact.companyName || "") : "";
  movementPhoneInput.value = formatPhoneNumber(contact.phone);
});
movementPersonInput.addEventListener("input", () => {
  movementPersonInput.value = formatFirstName(movementPersonInput.value);
});
movementNameInput.addEventListener("input", () => {
  movementNameInput.value = formatLastName(movementNameInput.value);
});
movementNameInput.addEventListener("blur", () => {
  movementNameInput.value = formatLastName(movementNameInput.value).trim();
});
movementCompanyInput.addEventListener("input", () => {
  movementCompanyInput.value = formatCompanyName(movementCompanyInput.value);
});
movementCompanyInput.addEventListener("blur", () => {
  movementCompanyInput.value = formatCompanyName(movementCompanyInput.value).trim();
});
movementPhoneInput.addEventListener("input", () => {
  movementPhoneInput.value = formatPhoneNumber(movementPhoneInput.value);
});
movementNoteInput.addEventListener("input", () => {
  movementNoteInput.value = formatSentenceStart(movementNoteInput.value);
});
contactsTabBtn.addEventListener("click", openContactsPanel);
contactsPanel.addEventListener("mouseenter", () => clearTimeout(contactsCloseTimer));
closeContactsBtn.addEventListener("click", () => {
  contactsPanel.hidden = true;
});
contactPhoneInput.addEventListener("input", () => {
  contactPhoneInput.value = formatPhoneNumber(contactPhoneInput.value);
});
contactFirstNameInput.addEventListener("input", () => {
  contactFirstNameInput.value = formatFirstName(contactFirstNameInput.value);
});
contactNameInput.addEventListener("input", () => {
  contactNameInput.value = formatLastName(contactNameInput.value);
});
contactNameInput.addEventListener("blur", () => {
  contactNameInput.value = formatLastName(contactNameInput.value).trim();
});
contactCompanyInput.addEventListener("input", () => {
  contactCompanyInput.value = formatCompanyName(contactCompanyInput.value);
});
contactCompanyInput.addEventListener("blur", () => {
  contactCompanyInput.value = formatCompanyName(contactCompanyInput.value).trim();
});
contactsList.addEventListener("dragstart", (event) => {
  const item = event.target.closest("[data-contact-id]");
  if (!item) return;

  draggedContactId = item.dataset.contactId;
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});
contactsList.addEventListener("dragend", () => {
  saveContactOrderFromList();
  draggedContactId = null;
  contactsList.querySelectorAll(".drag-over, .dragging").forEach((item) => {
    item.classList.remove("drag-over", "dragging");
  });
});
contactsList.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const draggedItem = contactsList.querySelector(".dragging");
  const item = event.target.closest("[data-contact-id]");
  if (!draggedItem || !item || item === draggedItem) return;

  const rect = item.getBoundingClientRect();
  const placeAfter = event.clientY > rect.top + rect.height / 2;
  contactsList.insertBefore(draggedItem, placeAfter ? item.nextSibling : item);
});
contactsList.addEventListener("drop", (event) => {
  event.preventDefault();
  saveContactOrderFromList();
});
contactsList.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return;
  if (event.target.closest("button")) return;

  const item = event.target.closest("[data-contact-id]");
  if (!item) return;

  const timer = setTimeout(() => startTouchContactDrag(item, event.pointerId, event.clientY), 220);
  touchContactDrag = {
    item,
    pointerId: event.pointerId,
    timer,
    startX: event.clientX,
    startY: event.clientY,
  };
});
contactsList.addEventListener("pointermove", (event) => {
  if (!touchContactDrag || touchContactDrag.pointerId !== event.pointerId) return;

  if (touchContactDrag.timer) {
    const moved = Math.hypot(event.clientX - touchContactDrag.startX, event.clientY - touchContactDrag.startY);
    if (moved > 10) {
      clearTimeout(touchContactDrag.timer);
      touchContactDrag = null;
    }
    return;
  }

  event.preventDefault();
  moveDraggedContactToPoint(event.clientY);
});
contactsList.addEventListener("pointerup", (event) => {
  if (!touchContactDrag || touchContactDrag.pointerId !== event.pointerId) return;
  if (touchContactDrag.timer) {
    clearTimeout(touchContactDrag.timer);
    touchContactDrag = null;
    return;
  }
  stopTouchContactDrag();
});
contactsList.addEventListener("pointercancel", (event) => {
  if (!touchContactDrag || touchContactDrag.pointerId !== event.pointerId) return;
  if (touchContactDrag.timer) clearTimeout(touchContactDrag.timer);
  stopTouchContactDrag();
});
registryToggleBtn.addEventListener("click", switchRegistry);
compromisesTabBtn.addEventListener("click", openCompromisesPanel);
compromisesPanel.addEventListener("mouseenter", () => clearTimeout(archivesCloseTimer));
closeCompromisesBtn.addEventListener("click", () => {
  compromisesPanel.hidden = true;
});
archivesTabBtn.addEventListener("click", openArchivesPanel);
archivesPanel.addEventListener("mouseenter", () => clearTimeout(archivesCloseTimer));
closeArchivesBtn.addEventListener("click", () => {
  archivesPanel.hidden = true;
});
contactTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeContactType = tab.dataset.contactType === "external" ? "external" : "internal";
    editingContactId = null;
    contactForm.reset();
    updateContactFormMode();
    renderContactsPanel();
  });
});
contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ensureCompletePhoneNumber(contactPhoneInput, "num\u00e9ro de t\u00e9l\u00e9phone de l'intervenant")) return;

  const name = formatLastName(contactNameInput.value).trim();
  const firstName = formatFirstName(contactFirstNameInput.value).trim();
  const companyName = activeContactType === "external" ? formatCompanyName(contactCompanyInput.value).trim() : "";
  const phone = formatPhoneNumber(contactPhoneInput.value);
  if (!name && !companyName) return;

  rememberUndoStep();
  if (editingContactId) {
    const previousContact = contacts.find((contact) => contact.id === editingContactId);
    const nextContact = {
      ...(previousContact || {}),
      firstName,
      name,
      companyName,
      phone,
      type: activeContactType,
    };
    contacts = contacts.map((contact) =>
      contact.id === editingContactId
        ? nextContact
        : contact,
    );
    logActivity(
      "Modification intervenant",
      getContactHistoryName(nextContact),
      contactTypeText(nextContact.type),
    );
  } else {
    const newContact = {
      id: createContactId(),
      firstName,
      name,
      companyName,
      phone,
      type: activeContactType,
    };
    contacts = [
      ...contacts,
      newContact,
    ];
    logActivity(
      "Ajout intervenant",
      getContactHistoryName(newContact),
      contactTypeText(newContact.type),
    );
  }
  editingContactId = null;
  saveContacts();
  contactForm.reset();
  updateContactFormMode();
  renderContactSelect();
  renderContactsPanel();
});
signatureCanvas.addEventListener("pointerdown", startSignature);
signatureCanvas.addEventListener("pointermove", drawSignature);
signatureCanvas.addEventListener("pointerup", stopSignature);
signatureCanvas.addEventListener("pointercancel", stopSignature);
searchInput.addEventListener("input", render);
archiveSearchInput?.addEventListener("input", renderArchivesPanel);
textViewBtn.addEventListener("click", () => setTileViewMode("text"));
photoViewBtn.addEventListener("click", () => setTileViewMode("photo"));
keyStatusFilterButtons.forEach((button) => {
  button.addEventListener("click", () => setKeyStatusFilter(button.dataset.keyStatusFilter));
});
statusFilter?.addEventListener("change", render);
undoBtn.addEventListener("click", undoPreviousStep);
historyDataBtn.addEventListener("click", () => openGlobalHistoryPanel());
registryHistoryDataBtn.addEventListener("click", () => openGlobalHistoryPanel(activeRegistry));
closeGlobalHistoryBtn.addEventListener("click", () => {
  globalHistoryPanel.hidden = true;
});
exportFilledDataBtn.addEventListener("click", exportFilledDataCsv);
backupDataBtn.addEventListener("click", exportAllDataBackup);
settingsDataBtn?.addEventListener("mouseenter", updateSettingsButtonAvailability);
settingsDataBtn?.addEventListener("mouseleave", () => updateSettingsButtonAvailability());
settingsDataBtn?.addEventListener("click", (event) => {
  if (!event.ctrlKey || !event.altKey || !settingsDataBtn.matches(":hover")) return;
  openSettingsPanel();
});
closeSettingsBtn?.addEventListener("click", closeSettingsPanel);
settingsRowCountInput?.addEventListener("change", () => {
  updateSettingsDraftFromDom();
  setSettingsDraftRowCount(settingsRowCountInput.value);
  renderSettingsPanel();
});
settingsCasesPerLineInput?.addEventListener("blur", () => {
  const slotsPerCategory = normalizeEvenSlotCount(settingsSlotsInput?.value);
  settingsCasesPerLineInput.value = String(
    normalizeCasesPerLine(settingsCasesPerLineInput.value, slotsPerCategory, defaultCasesPerLine),
  );
});
settingsSlotsInput?.addEventListener("blur", () => {
  const slots = normalizeEvenSlotCount(settingsSlotsInput.value);
  settingsSlotsInput.value = String(slots);
  if (settingsCasesPerLineInput) {
    settingsCasesPerLineInput.max = String(slots);
    settingsCasesPerLineInput.value = String(
      normalizeCasesPerLine(settingsCasesPerLineInput.value, slots, defaultCasesPerLine),
    );
  }
});
addSettingsReplacementBtn?.addEventListener("click", () => {
  if (!settingsDraft) settingsDraft = cloneTableSettings();
  updateSettingsDraftFromDom();
  settingsDraft.addressReplacements.push({ id: createReplacementId(), word: "", replacement: "" });
  renderSettingsPanel();
});
settingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateSettingsDraftFromDom();
  const saved = saveTableSettings(settingsDraft);
  if (saved) {
    logActivity("Modification r\u00e9glages", "", "");
  }
  closeSettingsPanel();
  updateRegistryHeader();
  render();
  if (saved) await syncCloudAfterAction();
});
savedBackupsBtn.addEventListener("click", (event) => {
  if (!event.ctrlKey || !event.shiftKey) {
    return;
  }

  openSavedBackupsPanel();
});
closeSavedBackupsBtn.addEventListener("click", () => {
  savedBackupsPanel.hidden = true;
});
function updateCtrlMode(event = {}) {
  document.body.classList.toggle("is-ctrl-pressed", Boolean(event.ctrlKey));
}

document.addEventListener("keydown", (event) => {
  updateImportButtonAvailability(event);
  updateSettingsButtonAvailability(event);
  updateResetTablesButtonAvailability(event);
  updateCtrlMode(event);
});
document.addEventListener("keyup", (event) => {
  updateImportButtonAvailability(event);
  updateSettingsButtonAvailability(event);
  updateResetTablesButtonAvailability(event);
  updateCtrlMode(event);
});
window.addEventListener("blur", () => {
  updateImportButtonAvailability();
  updateSettingsButtonAvailability();
  updateResetTablesButtonAvailability();
  updateCtrlMode();
});
importDataBtn.addEventListener("click", (event) => {
  if (!event.ctrlKey || !event.shiftKey) {
    return;
  }

  backupFileInput.value = "";
  backupFileInput.click();
});
backupFileInput.addEventListener("change", () => {
  const file = backupFileInput.files?.[0];
  if (!file) return;

  importAllDataBackup(file);
  backupFileInput.value = "";
});
closePanelBtn.addEventListener("click", () => {
  clearTimeout(detailCloseTimer);
  if (!isPendingNewKeyDraft()) syncCurrentRegistryNow();
  discardPendingNewKeyDraft();
  selectedId = null;
  selectedArchiveRecord = null;
  resetKeyInfoEditUnlock(null);
  endKeyWorkProtection();
  render();
});
document.addEventListener("pointerdown", (event) => {
  if (!selectedId) return;
  if (detailPanel.hidden) return;
  if (detailPanel.contains(event.target)) return;
  if (event.target.closest(".key-tile")) return;
  if (event.target.closest(".photo-viewer, .date-dialog, .movement-signature-dialog")) return;

  clearTimeout(detailCloseTimer);
  discardPendingNewKeyDraft();
  selectedId = null;
  selectedArchiveRecord = null;
  resetKeyInfoEditUnlock(null);
  clearSignature();
  endKeyWorkProtection();
  render();
});
form.addEventListener("focusin", () => {
  beginKeyWorkProtection();
  clearTimeout(detailCloseTimer);
});
detailPanel.addEventListener("mouseenter", () => {
  isDetailPanelHovered = true;
  clearTimeout(detailCloseTimer);
});
detailPanel.addEventListener("mouseleave", () => {
  isDetailPanelHovered = false;
});
exportKeyCsvBtn.addEventListener("click", () => {
  const key = getSelectedKey();
  if (!key) return;
  exportKeyExcel(key, selectedArchiveRecord);
});
transferKeyBtn.addEventListener("click", () => {
  void transferSelectedKeyToOtherRegistry();
});
keySetPhotoList.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return;

  const file = input.files?.[0];
  const setId = input.dataset.setId;
  if (!file) {
    finishPhotoImport();
    return;
  }

  compressPhotoFile(file)
    .then((photo) => {
      const key = getSelectedKey();
      if (!key) return;

      const sets = key.sets.map((set) => (set.id === setId ? { ...set, photo } : set));
      updateSelectedKeySets(sets);
    })
    .catch(() => {
      alert("La photo n'a pas pu être importée.");
    })
    .finally(finishPhotoImport);
  input.value = "";
});

cloudSleepOverlay?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  resumeCloudSyncFromInactivity();
});

async function initializeApp() {
  document.documentElement.classList.toggle("is-tablet-device", isTabletDevice());
  updateAccessLockState();
  updateRegistryHeader();
  updateTileViewToggle();
  updateUndoButton();
  render();
  if (await ensureFreshPublishedAppVersion()) return;
  resetLegacySyncMetadataIfNeeded();
  removeAutomaticBackupsFromLocalStorage();
  updateAccessLockState();
  ensureDeviceName();
  await ensureInitialCloudStateLoaded();
  updateAccessLockState();
  migrateArchivedSlots();
  subscribeToCloudChanges();
  await migrateStoredPropertyAddresses();
  setRuntimeStorageValue(photoOptimizationStorageKey, "done");
  await ensureMissedAutomaticBackupOnOpen();
  await ensureTodaysAutomaticBackupIfLate();
  scheduleAutomaticBackup();
  updateRegistryHeader();
  updateTileViewToggle();
  updateUndoButton();
  render();
  queueWakeCloudRefreshes();
  startAutomaticCloudRefreshLoop();
  startCloudInactivityTracking();
  setInterval(retryFailedCloudSyncs, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (isPhoneOrTabletDevice()) enterCloudSleep();
    else pauseCloudWorkWhileBackgrounded();
  } else refreshCloudAfterForeground();
});
window.addEventListener("pagehide", () => {
  if (isPhoneOrTabletDevice()) enterCloudSleep();
  else pauseCloudWorkWhileBackgrounded();
});
window.addEventListener("online", () => {
  if (isCloudSleeping || isAppInBackground()) return;
  requestAutomaticCloudRefresh({ force: true, immediate: true });
  queueWakeCloudRefreshes();
});
window.addEventListener("focus", () => {
  refreshCloudAfterForeground();
});
window.addEventListener("pageshow", () => {
  refreshCloudAfterForeground();
});
window.addEventListener("resize", () => requestAnimationFrame(syncSignatureHeightToActions));

accessForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const typedCode = String(accessCodeInput?.value || "").trim();
  const expectedCode = String(tableSettings?.accessCode || defaultAccessCode).trim();
  if (typedCode === expectedCode) {
    if (accessError) accessError.hidden = true;
    unlockAccess();
    return;
  }
  if (accessError) accessError.hidden = false;
  accessCodeInput?.select();
});

accessCodeInput?.addEventListener("input", () => {
  if (accessError) accessError.hidden = true;
});

toggleSettingsOrganizationBtn?.addEventListener("click", () => {
  updateSettingsDraftFromDom();
  areSettingsOrganizationVisible = !areSettingsOrganizationVisible;
  renderSettingsPanel();
});

toggleSettingsReplacementsBtn?.addEventListener("click", () => {
  updateSettingsDraftFromDom();
  areSettingsReplacementsVisible = !areSettingsReplacementsVisible;
  renderSettingsPanel();
});

settingsAccessLockInput?.addEventListener("change", () => {
  if (!settingsDraft) settingsDraft = cloneTableSettings();
  settingsDraft.accessLockEnabled = settingsAccessLockInput.checked;
  renderSettingsPanel();
});

editSettingsAccessCodeBtn?.addEventListener("click", () => {
  if (!settingsDraft) settingsDraft = cloneTableSettings();
  updateSettingsDraftFromDom();
  const currentCode = settingsDraft.accessCode || defaultAccessCode;
  const nextCode = window.prompt("Nouveau mot de passe du tableau :", currentCode);
  if (nextCode === null) return;
  const normalizedCode = String(nextCode).trim();
  if (!normalizedCode) {
    window.alert("Le mot de passe ne peut pas être vide.");
    return;
  }
  settingsDraft.accessCode = normalizedCode;
  settingsDraft.accessLockVersion = Date.now();
  renderSettingsPanel();
});

resetTablesBtn?.addEventListener("click", () => {
  void resetAllTableData();
});

forgotPasswordBtn?.addEventListener("click", () => {
  if (forgotPasswordMessage) forgotPasswordMessage.hidden = false;
});

initializeApp();
