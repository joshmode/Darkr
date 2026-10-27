import {
  clearAllSiteAppearances,
  removeSiteRule,
  normalizePreferences,
  normalizeThemeConfig,
  resolveAppearance,
  restoreDefaultValues,
  setAutoMode,
  setDefaultAppearance,
  setGlobalNativeDarkOverride,
  setSitePolicy,
} from "../shared/config";
import { getBrowserApi } from "../shared/extension-api";
import {
  completeOnboarding,
  loadPreferences,
  needsOnboarding,
  savePreferences,
} from "../shared/preferences";
import {
  contrastDescription,
  darknessDescription,
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
const backgroundValue = byId<HTMLOutputElement>(
  "default-dark-background-value",
);
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
      ? "Subtle"
      : config.sepiaIntensity < 70
        ? "Paper"
        : "Strong";
  grayscaleValue.textContent =
    config.grayscaleIntensity >= 99 ? "Full" : `${config.grayscaleIntensity}%`;
  warmthValue.textContent = warmthDescription(config.warmth);
  for (const input of [background, contrast, sepia, grayscale, warmth]) {
    setSliderProgress(input);
  }
}

function describeConfig(config: ThemeConfig): string {
  if (config.mode === "dark") {
    return `Dark · ${darknessDescription(config.darkBackground)} · ${contrastDescription(config.darkContrast)} contrast`;
  }
  if (config.mode === "sepia") {
    return `Sepia · ${config.sepiaIntensity}% intensity`;
  }
  if (config.mode === "grayscale") {
    return `Grayscale · ${config.grayscaleIntensity >= 99 ? "Full" : `${config.grayscaleIntensity}%`}`;
  }
  if (config.mode === "warm") {
    return `Warm Light · ${warmthDescription(config.warmth)}`;
  }
  return MODE_LABELS.original;
}

function renderSites(): void {
  if (!preferences) {
    return;
  }
  const entries = Object.entries(preferences.sites).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  sitesList.replaceChildren();
  sitesEmpty.hidden = entries.length > 0;
  clearSites.disabled = entries.length === 0;

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
        ? "Never theme"
        : rule.policy === "allow"
          ? `Always · ${describeConfig(resolved.config)}`
          : `${describeConfig(resolved.config)} · Automatic`;
    detail.textContent =
      rule.overrideNativeDark === undefined || rule.policy === "block"
        ? base
        : `${base} · ${rule.overrideNativeDark ? "over native dark" : "native dark kept"}`;
    copy.append(hostname, detail);

    const actions = document.createElement("div");
    actions.className = "site-row-actions";

    const policy = document.createElement("select");
    policy.className = "select site-row-policy";
    policy.setAttribute("aria-label", `Policy for ${host}`);
    const policies: Array<[SitePolicy, string]> = [
      ["auto", "Automatic"],
      ["allow", "Always"],
      ["block", "Never"],
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
      preferences = setSitePolicy(
        preferences,
        host,
        policy.value as SitePolicy,
      );
      void persistAndRender();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove site rule for ${host}`);
    remove.addEventListener("click", () => {
      if (!preferences) {
        return;
      }
      preferences = removeSiteRule(preferences, host);
      void persistAndRender();
    });

    actions.append(policy, remove);
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
  extensionStatus.lastElementChild!.textContent = preferences.enabled
    ? "Extension enabled"
    : "Extension paused";
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
    extensionStatus.lastElementChild!.textContent = "Couldn’t save settings";
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
  preferences = setGlobalNativeDarkOverride(
    preferences,
    nativeDarkPolicy.value === "override",
  );
  void persistAndRender();
});

restoreDefaults.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  preferences = restoreDefaultValues(preferences);
  renderDefaults({ ...DEFAULT_THEME_CONFIG });
  void persistAndRender();
});

clearSites.addEventListener("click", () => {
  if (!preferences) {
    return;
  }
  const count = Object.keys(preferences.sites).length;
  if (count > 0 && !window.confirm(`Remove all ${count} saved site rule${count === 1 ? "" : "s"}?`)) {
    return;
  }
  preferences = clearAllSiteAppearances(preferences);
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
  if (!host) {
    siteHostname.focus();
    return;
  }
  const next = setSitePolicy(
    preferences,
    host,
    sitePolicy.value as SitePolicy,
  );
  if (next === preferences) {
    siteHostname.setAttribute("aria-invalid", "true");
    siteHostname.focus();
    return;
  }
  siteHostname.removeAttribute("aria-invalid");
  preferences = next;
  siteHostname.value = "";
  sitePolicy.value = "block";
  void persistAndRender();
});

async function initialize(): Promise<void> {
  if (!browser) {
    extensionStatus.lastElementChild!.textContent = "Extension unavailable";
    return;
  }
  preferences = await loadPreferences(browser.storage.local);
  onboardingCard.hidden = !(await needsOnboarding(browser.storage.local));
  lastSerializedPreferences = JSON.stringify(preferences);
  versionLine.textContent = `Darkr ${browser.runtime.getManifest().version} · Local settings`;
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
      saveTimer !== null && preferences
        ? { ...updated, defaults: preferences.defaults }
        : updated;
    render();
  });
}

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
