import {
  clearSiteAppearance,
  getSiteRule,
  hostnamePreferenceKey,
  normalizePreferences,
  normalizeThemeConfig,
  resolveAppearance,
  setDefaultAppearance,
  setMasterEnabled,
  setSiteAppearance,
  setSiteNativeDarkOverride,
  toggleSiteEnabled,
} from "../shared/config";
import {
  type ContentStatus,
  getActiveTab,
  getBrowserApi,
  hostnameFromUrl,
} from "../shared/extension-api";
import {
  loadPreferences,
  preferencesFromStorageChange,
  type StorageAreaLike,
  savePreferences as writePreferences,
} from "../shared/preferences";
import { localizeDocument, t } from "../shared/i18n";
import {
  buildThemeTokens,
  contrastDescription,
  darknessDescription,
  themeVariables,
  warmthDescription,
} from "../shared/theme";
import type { AppearanceMode, DarkrPreferences, ThemeConfig } from "../shared/types";

type Scope = "site" | "all";
type SliderKey =
  | "darkBackground"
  | "darkContrast"
  | "sepiaIntensity"
  | "grayscaleIntensity"
  | "warmth";

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Darkr popup is missing #${id}`);
  }
  return element as unknown as T;
}

localizeDocument();

const view = {
  siteToggle: required<HTMLButtonElement>("site-toggle"),
  hostname: required<HTMLElement>("hostname"),
  hostStatus: required<HTMLElement>("host-status"),
  appearance: required<HTMLElement>("appearance"),
  preview: required<HTMLElement>("preview"),
  scopeButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-scope]")],
  scopeNote: required<HTMLElement>("scope-note-text"),
  reset: required<HTMLButtonElement>("reset"),
  modeButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")],
  darkControls: required<HTMLElement>("dark-controls"),
  sepiaControls: required<HTMLElement>("sepia-controls"),
  grayscaleControls: required<HTMLElement>("grayscale-controls"),
  warmControls: required<HTMLElement>("warm-controls"),
  sliders: {
    darkBackground: required<HTMLInputElement>("dark-background"),
    darkContrast: required<HTMLInputElement>("dark-contrast"),
    sepiaIntensity: required<HTMLInputElement>("sepia-intensity"),
    grayscaleIntensity: required<HTMLInputElement>("grayscale-intensity"),
    warmth: required<HTMLInputElement>("warmth"),
  } satisfies Record<SliderKey, HTMLInputElement>,
  values: {
    darkBackground: required<HTMLElement>("dark-background-value"),
    darkContrast: required<HTMLElement>("dark-contrast-value"),
    sepiaIntensity: required<HTMLElement>("sepia-value"),
    grayscaleIntensity: required<HTMLElement>("grayscale-value"),
    warmth: required<HTMLElement>("warmth-value"),
  } satisfies Record<SliderKey, HTMLElement>,
  pause: required<HTMLButtonElement>("pause"),
  settings: required<HTMLButtonElement>("settings"),
  nativeDarkNotice: required<HTMLElement>("native-dark-notice"),
  nativeDarkCopy: required<HTMLElement>("native-dark-copy"),
  nativeDarkToggle: required<HTMLButtonElement>("native-dark-toggle"),
  nativeDarkAction: required<HTMLElement>("native-dark-toggle").parentElement as HTMLElement,
  permissionNotice: required<HTMLElement>("permission-notice"),
  reload: required<HTMLButtonElement>("reload"),
};

const SAVE_ERROR = t("popupSaveError", "Couldn’t save settings");
const browser = getBrowserApi();
const app = {
  preferences: null as DarkrPreferences | null,
  preview: null as ThemeConfig | null,
  scope: "all" as Scope,
  hostname: "",
  tabId: undefined as number | undefined,
  storageTimer: null as number | null,
  pageStatus: null as ContentStatus | null,
  tabReachable: false,
  loading: true,
  lastError: "",
  /** Our own recent writes (serialised), so their echoes from storage are ignored. */
  written: [] as string[],
};

/** Persists preferences; a failed write is reported instead of thrown. */
async function savePreferences(
  storage: StorageAreaLike,
  preferences: DarkrPreferences,
): Promise<void> {
  app.written.push(JSON.stringify(normalizePreferences(preferences)));
  app.written.splice(0, Math.max(0, app.written.length - 8));
  try {
    await writePreferences(storage, preferences);
    if (app.lastError === SAVE_ERROR) {
      app.lastError = "";
    }
  } catch {
    app.lastError = SAVE_ERROR;
  }
}

function resolveCurrent(preferences: DarkrPreferences) {
  return resolveAppearance(preferences, app.hostname, {
    systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
}

function currentConfig(): ThemeConfig | null {
  if (!app.preferences) {
    return null;
  }
  return app.preview ?? resolveCurrent(app.preferences).config;
}

function hasSiteOverride(): boolean {
  if (!app.preferences) {
    return false;
  }
  const rule = getSiteRule(app.preferences, app.hostname);
  return Boolean(rule && Object.keys(rule.overrides ?? {}).length > 0);
}

/** A customised site always edits its own settings; otherwise the user chooses. */
function effectiveScope(): Scope {
  return hasSiteOverride() ? "site" : app.scope;
}

const PREVIEW_FALLBACK = {
  surface: "#f2f2f2",
  text: "#151515",
  link: "#3a3a3a",
  muted: "#555555",
};

function renderPreview(config: ThemeConfig): void {
  const tokens = buildThemeTokens(config);
  const variables = tokens ? themeVariables(tokens) : null;
  const palette =
    variables && config.mode !== "grayscale"
      ? {
          surface: variables["--darkr-bg"] ?? PREVIEW_FALLBACK.surface,
          text: variables["--darkr-text"] ?? PREVIEW_FALLBACK.text,
          link: variables["--darkr-link"] ?? PREVIEW_FALLBACK.link,
          muted: variables["--darkr-muted"] ?? PREVIEW_FALLBACK.muted,
        }
      : PREVIEW_FALLBACK;
  for (const swatch of view.preview.querySelectorAll<HTMLElement>("[data-role]")) {
    const role = swatch.dataset.role as keyof typeof palette;
    swatch.style.background = palette.surface;
    swatch.style.color = palette[role === "surface" ? "text" : role];
  }
}

function describeSlider(key: SliderKey, config: ThemeConfig): string {
  switch (key) {
    case "darkBackground":
      return darknessDescription(config.darkBackground);
    case "darkContrast":
      return contrastDescription(config.darkContrast);
    case "sepiaIntensity":
      return config.sepiaIntensity < 35
        ? t("levelSubtle", "Subtle")
        : config.sepiaIntensity < 70
          ? t("levelPaper", "Paper")
          : t("levelStrong", "Strong");
    case "grayscaleIntensity":
      return config.grayscaleIntensity >= 99
        ? t("levelFull", "Full")
        : `${config.grayscaleIntensity}%`;
    case "warmth":
      return warmthDescription(config.warmth);
  }
}

function updateSliderFill(input: HTMLInputElement): void {
  const minimum = Number(input.min || 0);
  const maximum = Number(input.max || 100);
  const percent = ((Number(input.value) - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--slider-progress", `${percent}%`);
}

function renderMode(config: ThemeConfig): void {
  for (const button of view.modeButtons) {
    const active = button.dataset.mode === config.mode;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  view.darkControls.hidden = config.mode !== "dark";
  view.sepiaControls.hidden = config.mode !== "sepia";
  view.grayscaleControls.hidden = config.mode !== "grayscale";
  view.warmControls.hidden = config.mode !== "warm";
  for (const key of Object.keys(view.sliders) as SliderKey[]) {
    const input = view.sliders[key];
    input.value = String(config[key]);
    const description = describeSlider(key, config);
    view.values[key].textContent = description;
    input.setAttribute(
      "aria-valuetext",
      t(
        "valueTextPercent",
        `${description}, ${config[key]} percent`,
        description,
        String(config[key]),
      ),
    );
    updateSliderFill(input);
  }
  renderPreview(config);
}

function renderStatus(): void {
  if (!app.preferences) {
    return;
  }
  const preferences = app.preferences;
  const resolved = resolveCurrent(preferences);
  const hostKnown = Boolean(app.hostname);
  const canChangePage = Boolean(app.tabId) && hostKnown && app.tabReachable;

  view.hostname.textContent = app.hostname || t("popupUnavailable", "Unavailable on this page");
  const nativeDarkSkipped = Boolean(app.pageStatus?.nativeDark) && !resolved.overrideNativeDark;
  view.hostStatus.textContent = !hostKnown
    ? t("popupOnlyStandard", "Only available on standard webpages")
    : app.lastError
      ? app.lastError
      : resolved.policy === "block"
        ? t("popupOffSite", "Off for this site")
        : !resolved.enabled
          ? t("popupPausedEverywhere", "Paused everywhere")
          : nativeDarkSkipped
            ? t("popupSiteAlreadyDark", "Site already has a dark appearance")
            : t("popupOn", "On");

  view.siteToggle.setAttribute("aria-checked", String(resolved.enabled));
  view.siteToggle.classList.toggle("is-on", resolved.enabled);
  view.siteToggle.disabled = !canChangePage;

  view.pause.textContent = preferences.enabled
    ? t("popupPauseEverywhere", "Pause everywhere")
    : t("popupResume", "Resume everywhere");

  // Collapse the appearance controls when they would do nothing.
  view.appearance.hidden = !canChangePage || !resolved.enabled;
  view.permissionNotice.hidden = canChangePage || app.loading || !hostKnown;

  const scope = effectiveScope();
  const customised = hasSiteOverride();
  for (const button of view.scopeButtons) {
    const active = button.dataset.scope === scope;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
    button.disabled = customised && button.dataset.scope === "all";
  }
  view.scopeNote.textContent = customised
    ? t("popupCustomised", "Customised for this site.")
    : scope === "site"
      ? t("popupScopeSite", "Changes apply to this site only.")
      : t("popupScopeAll", "Changes apply to every site.");
  view.reset.hidden = !customised;

  if (app.pageStatus?.nativeDark) {
    const grayscale = currentConfig()?.mode === "grayscale";
    view.nativeDarkNotice.hidden = false;
    view.nativeDarkAction.hidden = grayscale;
    view.nativeDarkToggle.setAttribute("aria-checked", String(resolved.overrideNativeDark));
    view.nativeDarkToggle.classList.toggle("is-on", resolved.overrideNativeDark);
    view.nativeDarkToggle.disabled = !canChangePage;
    view.nativeDarkCopy.textContent = grayscale
      ? t(
          "popupNativeGrayscale",
          "This site already has a dark appearance. Grayscale is the active effect.",
        )
      : resolved.overrideNativeDark
        ? t("popupNativeOver", "This site has its own dark appearance. Darkr is applied over it.")
        : t(
            "popupNativeLeft",
            "This site already has a dark appearance, so Darkr leaves it untouched.",
          );
  } else {
    view.nativeDarkNotice.hidden = true;
  }
}

function render(): void {
  const config = currentConfig();
  if (!config) {
    return;
  }
  renderMode(config);
  renderStatus();
}

function scheduleSave(config: ThemeConfig): void {
  app.preview = config;
  void sendPreview(config);
  if (app.storageTimer !== null) {
    window.clearTimeout(app.storageTimer);
  }
  app.storageTimer = window.setTimeout(() => {
    app.storageTimer = null;
    void persistPreview();
  }, 160);
}

async function commitPreview(): Promise<void> {
  if (app.storageTimer !== null) {
    window.clearTimeout(app.storageTimer);
    app.storageTimer = null;
  }
  await persistPreview();
}

async function persistPreview(): Promise<void> {
  if (!browser || !app.preferences || !app.preview) {
    return;
  }
  const saving = app.preview;
  if (effectiveScope() === "all") {
    app.preferences = setDefaultAppearance(app.preferences, saving);
  } else if (app.hostname) {
    app.preferences = setSiteAppearance(app.preferences, app.hostname, saving);
  }
  await savePreferences(browser.storage.local, app.preferences);
  // Keep a newer preview made while the write was in flight; its own debounce
  // timer will persist it. Clearing it here would silently drop that change.
  if (app.preview === saving) {
    app.preview = null;
  }
  render();
}

async function sendPreview(config: ThemeConfig): Promise<void> {
  if (!browser || !app.tabId) {
    return;
  }
  try {
    await browser.tabs.sendMessage(app.tabId, { type: "darkr:preview", config });
    app.tabReachable = true;
    app.lastError = "";
  } catch {
    app.tabReachable = false;
    app.lastError = t("popupReloadToApply", "Reload this page to apply changes");
  }
}

function selectMode(mode: AppearanceMode): void {
  const config = currentConfig();
  if (!config || config.mode === mode) {
    return;
  }
  scheduleSave({ ...config, mode });
  void commitPreview();
  render();
}

function bindSlider(key: SliderKey): void {
  const input = view.sliders[key];
  input.addEventListener("input", () => {
    const config = currentConfig();
    if (!config) {
      return;
    }
    const next = normalizeThemeConfig({ ...config, [key]: Number(input.value) });
    scheduleSave(next);
    renderMode(next);
    renderStatus();
  });
  input.addEventListener("change", () => {
    updateSliderFill(input);
    void commitPreview();
  });
}

/** Arrow keys (all four), Home and End move through a radio group. */
function bindRadioKeys<T extends HTMLButtonElement>(buttons: T[], choose: (button: T) => void) {
  for (const button of buttons) {
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const enabled = buttons.filter((candidate) => !candidate.disabled);
      const index = enabled.indexOf(button);
      const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
      const next =
        event.key === "Home"
          ? enabled[0]
          : event.key === "End"
            ? enabled[enabled.length - 1]
            : enabled[(index + (backwards ? -1 : 1) + enabled.length) % enabled.length];
      if (next) {
        next.focus();
        choose(next);
      }
    });
  }
}

for (const button of view.modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as AppearanceMode | undefined;
    if (mode) {
      selectMode(mode);
    }
  });
}
bindRadioKeys(view.modeButtons, (button) => selectMode(button.dataset.mode as AppearanceMode));

function selectScope(scope: Scope): void {
  if (hasSiteOverride()) {
    return;
  }
  app.scope = scope;
  render();
}
for (const button of view.scopeButtons) {
  button.addEventListener("click", () => selectScope(button.dataset.scope as Scope));
}
bindRadioKeys(view.scopeButtons, (button) => selectScope(button.dataset.scope as Scope));

view.siteToggle.addEventListener("click", async () => {
  if (!browser || !app.preferences || !app.hostname || !app.tabReachable) {
    return;
  }
  const next = toggleSiteEnabled(app.preferences, app.hostname, {
    systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
  app.preferences = next;
  app.preview = null;
  const resolved = resolveCurrent(next);
  await sendPreview(resolved.enabled ? resolved.config : { ...next.defaults, mode: "original" });
  await savePreferences(browser.storage.local, next);
  render();
});

view.pause.addEventListener("click", async () => {
  if (!browser || !app.preferences) {
    return;
  }
  app.preferences = setMasterEnabled(app.preferences, !app.preferences.enabled);
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

view.reset.addEventListener("click", async () => {
  if (!browser || !app.preferences) {
    return;
  }
  app.preferences = clearSiteAppearance(app.preferences, app.hostname);
  app.preview = null;
  app.scope = "all";
  await sendPreview(app.preferences.defaults);
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

view.nativeDarkToggle.addEventListener("click", async () => {
  if (!browser || !app.preferences || !app.hostname || !app.tabReachable) {
    return;
  }
  const next = !resolveCurrent(app.preferences).overrideNativeDark;
  app.preferences = setSiteNativeDarkOverride(app.preferences, app.hostname, next);
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

view.reload.addEventListener("click", async () => {
  if (!browser || !app.tabId) {
    return;
  }
  try {
    await browser.tabs.reload(app.tabId);
    window.close();
  } catch {
    app.lastError = t("popupReloadFailed", "Couldn’t reload the page");
    renderStatus();
  }
});

view.settings.addEventListener("click", async () => {
  if (!browser) {
    return;
  }
  try {
    await browser.runtime.openOptionsPage();
  } catch {
    app.lastError = t("popupSettingsUnavailable", "Settings unavailable");
    renderStatus();
  }
});

view.sliders.darkBackground.addEventListener("keydown", (event) => {
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    view.sliders.darkBackground.value =
      event.key === "Home" ? "0" : view.sliders.darkBackground.max;
    view.sliders.darkBackground.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

for (const key of Object.keys(view.sliders) as SliderKey[]) {
  bindSlider(key);
}

async function initialize(): Promise<void> {
  if (!browser) {
    view.hostStatus.textContent = t("popupExtensionUnavailable", "Extension unavailable");
    return;
  }

  const [preferences, tab] = await Promise.all([
    loadPreferences(browser.storage.local),
    getActiveTab(browser),
  ]);
  app.preferences = preferences;
  app.hostname = hostnamePreferenceKey(hostnameFromUrl(tab?.url));
  app.tabId = tab?.id;

  if (app.tabId) {
    try {
      app.pageStatus = await browser.tabs.sendMessage<ContentStatus>(app.tabId, {
        type: "darkr:get-status",
      });
      app.tabReachable = true;
    } catch {
      app.pageStatus = null;
      app.tabReachable = false;
    }
  }

  app.loading = false;
  render();

  // "Automatic" sites may follow the OS appearance; keep the status in step
  // while the popup is open. The popup's lifetime bounds this listener.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render());

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const updated = preferencesFromStorageChange(changes);
    if (!updated) {
      return;
    }
    // Our own write echoes back through storage. Treating it as an outside
    // change would drop a newer in-flight preview.
    if (app.written.includes(JSON.stringify(updated))) {
      return;
    }
    app.preferences = updated;
    app.preview = null;
    render();
  });
}

void initialize();
