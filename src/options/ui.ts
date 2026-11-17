import {
  canIncludeSubdomains,
  clearAllSiteAppearances,
  removeSiteRule,
  normalizePreferences,
  normalizeThemeConfig,
  resolveAppearance,
  restoreDefaultValues,
  setAutoMode,
  setDefaultAppearance,
  setGlobalNativeDarkOverride,
  setMasterEnabled,
  setSiteIncludeSubdomains,
  setSitePolicy,
} from "../shared/config";
import { getBrowserApi } from "../shared/extension-api";
import { localizeDocument, t } from "../shared/i18n";
import {
  completeOnboarding,
  loadPreferences,
  needsOnboarding,
  savePreferences,
} from "../shared/preferences";
import {
  buildThemeTokens,
  contrastDescription,
  darknessDescription,
  themeVariables,
  warmthDescription,
} from "../shared/theme";
import {
  DEFAULT_THEME_CONFIG,
  MODE_LABELS,
  type AutoMode,
  type DarkrPreferences,
  type SitePolicy,
  type ThemeConfig,
} from "../shared/types";
import { PREFERENCES_STORAGE_KEY } from "../shared/preferences";

localizeDocument();
const browser = getBrowserApi();
let preferences: DarkrPreferences | null = null;
let saveTimer: number | null = null;
let lastSerializedPreferences = "";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Darkr settings are missing #${id}`);
  }
  return element as unknown as T;
}

const mode = byId<HTMLSelectElement>("default-mode");
const background = byId<HTMLInputElement>("default-dark-background");
const contrast = byId<HTMLInputElement>("default-dark-contrast");
const sepia = byId<HTMLInputElement>("default-sepia");
const grayscale = byId<HTMLInputElement>("default-grayscale");
const warmth = byId<HTMLInputElement>("default-warmth");
const backgroundValue = byId<HTMLOutputElement>("default-dark-background-value");
const contrastValue = byId<HTMLOutputElement>("default-dark-contrast-value");
const sepiaValue = byId<HTMLOutputElement>("default-sepia-value");
const grayscaleValue = byId<HTMLOutputElement>("default-grayscale-value");
const warmthValue = byId<HTMLOutputElement>("default-warmth-value");
const sitesList = byId<HTMLUListElement>("sites-list");
const sitesEmpty = byId<HTMLElement>("sites-empty");
const clearSites = byId<HTMLButtonElement>("clear-sites");
const siteForm = byId<HTMLFormElement>("site-form");
const siteHostname = byId<HTMLInputElement>("site-hostname");
const sitePolicy = byId<HTMLSelectElement>("site-policy");
const autoMode = byId<HTMLSelectElement>("auto-mode");
const nativeDarkPolicy = byId<HTMLSelectElement>("native-dark-policy");
const restoreDefaults = byId<HTMLButtonElement>("restore-defaults");
const extensionStatus = byId<HTMLElement>("extension-status");
const versionLine = byId<HTMLElement>("version-line");
const onboardingCard = byId<HTMLElement>("onboarding-card");
const onboardingDismiss = byId<HTMLButtonElement>("onboarding-dismiss");
const aboutButton = byId<HTMLButtonElement>("about-button");
const aboutDialog = byId<HTMLDialogElement>("about-dialog");
const aboutClose = byId<HTMLButtonElement>("about-close");
const aboutVersion = byId<HTMLElement>("about-version");
const preview = byId<HTMLElement>("settings-preview");
const siteSearch = byId<HTMLInputElement>("site-search");
const siteError = byId<HTMLElement>("site-error");
const exportButton = byId<HTMLButtonElement>("export-settings");
const importButton = byId<HTMLButtonElement>("import-settings");
const importFile = byId<HTMLInputElement>("import-file");
const dataMessage = byId<HTMLElement>("data-message");
const undoBar = byId<HTMLElement>("undo-bar");
const undoMessage = byId<HTMLElement>("undo-message");
const undoButton = byId<HTMLButtonElement>("undo-button");

/** Offers to revert a destructive change instead of asking for confirmation first. */
let undoSnapshot: DarkrPreferences | null = null;
let undoTimer: number | null = null;
function offerUndo(message: string, previous: DarkrPreferences): void {
  undoSnapshot = previous;
  undoMessage.textContent = message;
  undoBar.hidden = false;
  if (undoTimer !== null) {
    window.clearTimeout(undoTimer);
  }
  undoTimer = window.setTimeout(hideUndo, 12000);
}
function hideUndo(): void {
  undoSnapshot = null;
  undoBar.hidden = true;
  if (undoTimer !== null) {
    window.clearTimeout(undoTimer);
    undoTimer = null;
  }
}
undoButton.addEventListener("click", () => {
  if (undoSnapshot) {
    preferences = undoSnapshot;
    hideUndo();
    void persistAndRender();
  }
});

const PREVIEW_FALLBACK = { surface: "#f2f2f2", text: "#151515", link: "#3a3a3a", muted: "#555555" };
function renderPreview(config: ThemeConfig): void {
  const tokens = buildThemeTokens(config);
  const variables = tokens && config.mode !== "grayscale" ? themeVariables(tokens) : null;
  const palette = variables
    ? {
        surface: variables["--darkr-bg"] ?? PREVIEW_FALLBACK.surface,
        text: variables["--darkr-text"] ?? PREVIEW_FALLBACK.text,
        link: variables["--darkr-link"] ?? PREVIEW_FALLBACK.link,
        muted: variables["--darkr-muted"] ?? PREVIEW_FALLBACK.muted,
      }
    : PREVIEW_FALLBACK;
  for (const swatch of preview.querySelectorAll<HTMLElement>("[data-role]")) {
    const role = swatch.dataset.role as keyof typeof palette;
    swatch.style.background = palette.surface;
    swatch.style.color = palette[role === "surface" ? "text" : role];
  }
}

function setSliderProgress(input: HTMLInputElement): void {
  const minimum = Number(input.min || 0);
  const maximum = Number(input.max || 100);
  const value = Number(input.value);
  const percent = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--slider-progress", `${percent}%`);
}

function renderDefaults(config: ThemeConfig): void {
  mode.value = config.mode;
  background.value = String(config.darkBackground);
  contrast.value = String(config.darkContrast);
  sepia.value = String(config.sepiaIntensity);
  grayscale.value = String(config.grayscaleIntensity);
  warmth.value = String(config.warmth);
  backgroundValue.textContent = darknessDescription(config.darkBackground);
  contrastValue.textContent = contrastDescription(config.darkContrast);
  sepiaValue.textContent =
    config.sepiaIntensity < 35
      ? t("levelSubtle", "Subtle")
      : config.sepiaIntensity < 70
        ? t("levelPaper", "Paper")
        : t("levelStrong", "Strong");
  grayscaleValue.textContent =
    config.grayscaleIntensity >= 99 ? t("levelFull", "Full") : `${config.grayscaleIntensity}%`;
  warmthValue.textContent = warmthDescription(config.warmth);
  for (const input of [background, contrast, sepia, grayscale, warmth]) {
    setSliderProgress(input);
  }
  // Only the active mode's sliders are shown.
  for (const row of document.querySelectorAll<HTMLElement>("[data-mode-group]")) {
    row.hidden = row.dataset.modeGroup !== config.mode;
  }
  renderPreview(config);
}

function describeConfig(config: ThemeConfig): string {
  if (config.mode === "dark") {
    const level = contrastDescription(config.darkContrast);
    return `${t("optModeDarkLabel", "Dark")} · ${darknessDescription(config.darkBackground)} · ${t("optContrastSuffix", `${level} contrast`, level)}`;
  }
  if (config.mode === "sepia") {
    return `${t("optModeSepiaLabel", "Sepia")} · ${t("optIntensity", `${config.sepiaIntensity}% intensity`, String(config.sepiaIntensity))}`;
  }
  if (config.mode === "grayscale") {
    return `${t("optModeGrayLabel", "Grayscale")} · ${config.grayscaleIntensity >= 99 ? t("levelFull", "Full") : `${config.grayscaleIntensity}%`}`;
  }
  if (config.mode === "warm") {
    return `${t("optModeWarmLabel", "Warm Light")} · ${warmthDescription(config.warmth)}`;
  }
  return MODE_LABELS[config.mode];
}

function renderSites(): void {
  if (!preferences) {
    return;
  }
  const total = Object.keys(preferences.sites).length;
  const query = siteSearch.value.trim().toLowerCase();
  const entries = Object.entries(preferences.sites)
    .filter(([host]) => host.includes(query))
    .sort(([a], [b]) => a.localeCompare(b));
  sitesList.replaceChildren();
  sitesEmpty.hidden = entries.length > 0;
  sitesEmpty.querySelector("p")!.textContent =
    total === 0 ? t("optNoRules", "No site rules yet.") : t("optNoMatch", "No rules match.");
  clearSites.disabled = total === 0;

  for (const [host, rule] of entries) {
    const resolved = resolveAppearance(preferences, host);
    const row = document.createElement("li");
    row.className = "site-row";

    const copy = document.createElement("div");
    copy.className = "site-row-copy";
    const hostname = document.createElement("p");
    hostname.className = "site-row-host";
    hostname.textContent = host;
    const detail = document.createElement("p");
    detail.className = "site-row-detail";
    const base =
      rule.policy === "block"
        ? t("optNeverTheme", "Never theme")
        : rule.policy === "allow"
          ? `${t("optAlways", "Always")} · ${describeConfig(resolved.config)}`
          : `${describeConfig(resolved.config)} · ${t("optAutomatic", "Automatic")}`;
    detail.textContent =
      rule.overrideNativeDark === undefined || rule.policy === "block"
        ? base
        : `${base} · ${rule.overrideNativeDark ? t("optOverNativeDark", "over native dark") : t("optNativeDarkKept", "native dark kept")}`;
    copy.append(hostname, detail);

    const actions = document.createElement("div");
    actions.className = "site-row-actions";

    const policy = document.createElement("select");
    policy.className = "select site-row-policy";
    policy.setAttribute("aria-label", t("optPolicyFor", `Policy for ${host}`, host));
    const policies: Array<[SitePolicy, string]> = [
      ["auto", t("optAutomatic", "Automatic")],
      ["allow", t("optAlways", "Always")],
      ["block", t("optNever", "Never")],
    ];
    for (const [value, label] of policies) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      policy.append(option);
    }
    policy.value = rule.policy;
    policy.addEventListener("change", () => {
      if (!preferences) {
        return;
      }
      preferences = setSitePolicy(preferences, host, policy.value as SitePolicy);
      void persistAndRender();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = t("optRemove", "Remove");
    remove.setAttribute("aria-label", t("optRemoveRuleFor", `Remove site rule for ${host}`, host));
    remove.addEventListener("click", () => {
      if (!preferences) {
        return;
      }
      preferences = removeSiteRule(preferences, host);
      void persistAndRender();
    });

    const subdomains = document.createElement("label");
    subdomains.className = "site-row-sub";
    const subdomainsBox = document.createElement("input");
    subdomainsBox.type = "checkbox";
    subdomainsBox.checked = rule.includeSubdomains === true;
    subdomainsBox.disabled = !canIncludeSubdomains(host);
    if (subdomainsBox.disabled) {
      subdomainsBox.title = t(
        "optSubdomainsUnavailable",
        "Not available for shared or top-level domains",
      );
    }
    subdomainsBox.addEventListener("change", () => {
      if (!preferences) {
        return;
      }
      preferences = setSiteIncludeSubdomains(preferences, host, subdomainsBox.checked);
      void persistAndRender();
    });
    subdomains.append(subdomainsBox, t("optIncludeSubdomains", "Include subdomains"));

    actions.append(subdomains, policy, remove);
    row.append(copy, actions);
    sitesList.append(row);
  }
}

function render(): void {
  if (!preferences) {
    return;
  }
  renderDefaults(preferences.defaults);
  autoMode.value = preferences.autoMode;
  nativeDarkPolicy.value = preferences.overrideNativeDark ? "override" : "keep";
  renderSites();
  extensionStatus.classList.toggle("is-off", !preferences.enabled);
  extensionStatus.setAttribute("aria-checked", String(preferences.enabled));
  extensionStatus.lastElementChild!.textContent = preferences.enabled
    ? t("optExtensionEnabled", "Extension enabled")
    : t("optExtensionPaused", "Extension paused");
}

async function persistAndRender(): Promise<void> {
  if (!browser || !preferences) {
    return;
  }
  try {
    await savePreferences(browser.storage.local, preferences);
    lastSerializedPreferences = JSON.stringify(preferences);
    extensionStatus.removeAttribute("data-error");
  } catch {
    extensionStatus.setAttribute("data-error", "");
    extensionStatus.lastElementChild!.textContent = t("optSaveError", "Couldn’t save settings");
    return;
  }
  render();
}

function schedulePersist(): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistAndRender();
  }, 180);
}

function readDefaults(): ThemeConfig {
  return normalizeThemeConfig({
    mode: mode.value,
    darkBackground: Number(background.value),
    darkContrast: Number(contrast.value),
    sepiaIntensity: Number(sepia.value),
    grayscaleIntensity: Number(grayscale.value),
    warmth: Number(warmth.value),
  });
}

function applyDefaultChange(): void {
  if (!preferences) {
    return;
  }
  const config = readDefaults();
  preferences = setDefaultAppearance(preferences, config);
  renderDefaults(config);
  schedulePersist();
}

mode.addEventListener("change", applyDefaultChange);
for (const input of [background, contrast, sepia, grayscale, warmth]) {
  input.addEventListener("input", applyDefaultChange);
}

autoMode.addEventListener("change", () => {
  if (!preferences) {
    return;
  }
  preferences = setAutoMode(preferences, autoMode.value as AutoMode);
  void persistAndRender();
});

nativeDarkPolicy.addEventListener("change", () => {
  if (!preferences) {
    return;
  }
  preferences = setGlobalNativeDarkOverride(preferences, nativeDarkPolicy.value === "override");
  void persistAndRender();
});

restoreDefaults.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  const previous = preferences;
  preferences = restoreDefaultValues(preferences);
  renderDefaults({ ...DEFAULT_THEME_CONFIG });
  offerUndo(t("optDefaultsRestored", "Default appearance restored."), previous);
  void persistAndRender();
});

clearSites.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  const count = Object.keys(preferences.sites).length;
  const previous = preferences;
  preferences = clearAllSiteAppearances(preferences);
  offerUndo(
    count === 1
      ? t("optRemovedOne", "Removed 1 site rule.")
      : t("optRemovedMany", `Removed ${count} site rules.`, String(count)),
    previous,
  );
  void persistAndRender();
});

/** Accepts a bare hostname or a pasted address such as https://example.com/a. */
function hostFromInput(value: string): string {
  const trimmed = value.trim();
  if (!/[/?#@]/.test(trimmed) && !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      .hostname;
  } catch {
    return trimmed;
  }
}

siteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!preferences) {
    return;
  }
  const host = hostFromInput(siteHostname.value);
  const fail = (message: string): void => {
    siteHostname.setAttribute("aria-invalid", "true");
    siteError.textContent = message;
    siteError.hidden = false;
    siteHostname.focus();
  };
  if (!host) {
    fail(t("optEnterHost", "Enter a hostname such as example.com."));
    return;
  }
  const next = setSitePolicy(preferences, host, sitePolicy.value as SitePolicy);
  if (next === preferences) {
    fail(
      /:\d+$/.test(host)
        ? t("optNoPorts", "Rules match hostnames only; remove the port number.")
        : t("optInvalidHost", `“${host}” is not a valid hostname.`, host),
    );
    return;
  }
  siteHostname.removeAttribute("aria-invalid");
  siteError.hidden = true;
  preferences = next;
  siteHostname.value = "";
  sitePolicy.value = "block";
  void persistAndRender();
});

async function initialize(): Promise<void> {
  if (!browser) {
    extensionStatus.lastElementChild!.textContent = t(
      "optExtensionUnavailable",
      "Extension unavailable",
    );
    return;
  }
  preferences = await loadPreferences(browser.storage.local);
  onboardingCard.hidden = !(await needsOnboarding(browser.storage.local));
  lastSerializedPreferences = JSON.stringify(preferences);
  const version = browser.runtime.getManifest().version;
  versionLine.textContent = t("optLocalSettings", `Darkr ${version} · Local settings`, version);
  aboutVersion.textContent = versionLine.textContent;
  render();

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const change = changes[PREFERENCES_STORAGE_KEY];
    if (!change) {
      return;
    }
    const updated = normalizePreferences(change.newValue);
    const serialized = JSON.stringify(updated);
    if (serialized === lastSerializedPreferences) {
      return;
    }
    lastSerializedPreferences = serialized;
    // Keep defaults the user is still dragging; the pending save will write
    // them. Everything else (sites, switches) takes the remote value.
    preferences =
      saveTimer !== null && preferences ? { ...updated, defaults: preferences.defaults } : updated;
    render();
  });
}

extensionStatus.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  preferences = setMasterEnabled(preferences, !preferences.enabled);
  void persistAndRender();
});

siteSearch.addEventListener("input", renderSites);

exportButton.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  const blob = new Blob([`${JSON.stringify(preferences, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "darkr-settings.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  dataMessage.textContent = t("optExported", "Settings exported.");
});

importButton.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file || !preferences) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    const previous = preferences;
    preferences = normalizePreferences(parsed);
    const count = Object.keys(preferences.sites).length;
    dataMessage.textContent =
      count === 1
        ? t("optImportedOne", "Imported settings with 1 site rule.")
        : t("optImportedMany", `Imported settings with ${count} site rules.`, String(count));
    offerUndo(t("optImported", "Settings imported."), previous);
    await persistAndRender();
  } catch {
    dataMessage.textContent = t(
      "optBadFile",
      "That file is not a Darkr settings export. Nothing was changed.",
    );
  }
});

onboardingDismiss.addEventListener("click", async () => {
  if (!browser) {
    return;
  }
  await completeOnboarding(browser.storage.local);
  onboardingCard.hidden = true;
});

aboutButton.addEventListener("click", () => {
  aboutDialog.showModal();
});

aboutClose.addEventListener("click", () => {
  aboutDialog.close();
});

aboutDialog.addEventListener("click", (event) => {
  if (event.target === aboutDialog) {
    aboutDialog.close();
  }
});

void initialize();
