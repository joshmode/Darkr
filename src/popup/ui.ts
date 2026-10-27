import {
  getSiteRule,
  hostnamePreferenceKey,
  normalizeThemeConfig,
  removeSiteRule,
  resolveAppearance,
  setMasterEnabled,
  setSiteNativeDarkOverride,
  setSitePolicy,
  setSiteAppearance,
  themeConfigsEqual,
} from "../shared/config";
import {
  getActiveTab,
  getBrowserApi,
  hostnameFromUrl,
  type ContentStatus,
} from "../shared/extension-api";
import {
  loadPreferences,
  preferencesFromStorageChange,
  savePreferences as writePreferences,
  type StorageAreaLike,
} from "../shared/preferences";
import type {
  AppearanceMode,
  DarkrPreferences,
  SitePolicy,
  ThemeConfig,
} from "../shared/types";
import {
  buildThemeTokens,
  contrastDescription,
  darknessDescription,
  themeVariables,
  warmthDescription,
} from "../shared/theme";

interface PopupView {
  enabled: HTMLButtonElement;
  hostname: HTMLElement;
  hostStatus: HTMLElement;
  siteBadge: HTMLElement;
  policyButtons: HTMLButtonElement[];
  statusText: HTMLElement;
  controls: HTMLElement;
  modeButtons: HTMLButtonElement[];
  darkControls: HTMLElement;
  sepiaControls: HTMLElement;
  grayscaleControls: HTMLElement;
  warmControls: HTMLElement;
  darkBackground: HTMLInputElement;
  darkContrast: HTMLInputElement;
  sepiaIntensity: HTMLInputElement;
  grayscaleIntensity: HTMLInputElement;
  warmth: HTMLInputElement;
  darkBackgroundValue: HTMLElement;
  darkContrastValue: HTMLElement;
  sepiaValue: HTMLElement;
  grayscaleValue: HTMLElement;
  warmthValue: HTMLElement;
  reset: HTMLButtonElement;
  settings: HTMLButtonElement;
  nativeDarkNotice: HTMLElement;
  nativeDarkCopy: HTMLElement;
  nativeDarkToggle: HTMLButtonElement;
  nativeDarkAction: HTMLElement;
  permissionNotice: HTMLElement;
}

const view = {
  enabled: required<HTMLButtonElement>("master-toggle"),
  hostname: required<HTMLElement>("hostname"),
  hostStatus: required<HTMLElement>("host-status"),
  siteBadge: required<HTMLElement>("site-badge"),
  policyButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-policy]")],
  statusText: required<HTMLElement>("status-text"),
  controls: required<HTMLElement>("controls"),
  modeButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")],
  darkControls: required<HTMLElement>("dark-controls"),
  sepiaControls: required<HTMLElement>("sepia-controls"),
  grayscaleControls: required<HTMLElement>("grayscale-controls"),
  warmControls: required<HTMLElement>("warm-controls"),
  darkBackground: required<HTMLInputElement>("dark-background"),
  darkContrast: required<HTMLInputElement>("dark-contrast"),
  sepiaIntensity: required<HTMLInputElement>("sepia-intensity"),
  grayscaleIntensity: required<HTMLInputElement>("grayscale-intensity"),
  warmth: required<HTMLInputElement>("warmth"),
  darkBackgroundValue: required<HTMLElement>("dark-background-value"),
  darkContrastValue: required<HTMLElement>("dark-contrast-value"),
  sepiaValue: required<HTMLElement>("sepia-value"),
  grayscaleValue: required<HTMLElement>("grayscale-value"),
  warmthValue: required<HTMLElement>("warmth-value"),
  reset: required<HTMLButtonElement>("reset"),
  settings: required<HTMLButtonElement>("settings"),
  nativeDarkNotice: required<HTMLElement>("native-dark-notice"),
  nativeDarkCopy: required<HTMLElement>("native-dark-copy"),
  nativeDarkToggle: required<HTMLButtonElement>("native-dark-toggle"),
  nativeDarkAction: required<HTMLElement>("native-dark-toggle").parentElement!,
  permissionNotice: required<HTMLElement>("permission-notice"),
} satisfies PopupView;

const SAVE_ERROR = "Couldn’t save settings";
const browser = getBrowserApi();
const app = {
  preferences: null as DarkrPreferences | null,
  preview: null as ThemeConfig | null,
  hostname: "",
  tabId: undefined as number | undefined,
  storageTimer: null as number | null,
  pageStatus: null as ContentStatus | null,
  tabReachable: false,
  loading: true,
  lastError: "",
};

function required<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Darkr popup is missing #${id}`);
  }
  return element as unknown as T;
}

/** Persists preferences; a failed write is reported instead of thrown. */
async function savePreferences(
  storage: StorageAreaLike,
  preferences: DarkrPreferences,
): Promise<void> {
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

function isSiteOverride(): boolean {
  if (!app.preferences) {
    return false;
  }
  const rule = getSiteRule(app.preferences, app.hostname);
  return Boolean(rule && Object.keys(rule.overrides ?? {}).length > 0);
}

function hasSiteRule(): boolean {
  return Boolean(
    app.preferences && getSiteRule(app.preferences, app.hostname),
  );
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
  view.controls.dataset.mode = config.mode;

  view.darkBackground.value = String(config.darkBackground);
  view.darkContrast.value = String(config.darkContrast);
  view.sepiaIntensity.value = String(config.sepiaIntensity);
  view.grayscaleIntensity.value = String(config.grayscaleIntensity);
  view.warmth.value = String(config.warmth);

  view.darkBackgroundValue.textContent = darknessDescription(
    config.darkBackground,
  );
  view.darkBackground.setAttribute(
    "aria-valuetext",
    `${darknessDescription(config.darkBackground)}, ${config.darkBackground} percent`,
  );
  view.darkContrastValue.textContent = contrastDescription(config.darkContrast);
  view.darkContrast.setAttribute(
    "aria-valuetext",
    `${contrastDescription(config.darkContrast)}, ${config.darkContrast} percent`,
  );
  view.sepiaValue.textContent =
    config.sepiaIntensity < 35
      ? "Subtle"
      : config.sepiaIntensity < 70
        ? "Paper"
        : "Strong";
  view.grayscaleValue.textContent =
    config.grayscaleIntensity >= 99 ? "Full" : `${config.grayscaleIntensity}%`;
  view.sepiaIntensity.setAttribute(
    "aria-valuetext",
    `${view.sepiaValue.textContent}, ${config.sepiaIntensity} percent`,
  );
  view.grayscaleIntensity.setAttribute(
    "aria-valuetext",
    `${view.grayscaleValue.textContent}, ${config.grayscaleIntensity} percent`,
  );
  view.warmthValue.textContent = warmthDescription(config.warmth);
  view.warmth.setAttribute(
    "aria-valuetext",
    `${warmthDescription(config.warmth)}, ${config.warmth} percent`,
  );

  updateSliderFill(view.darkBackground);
  updateSliderFill(view.darkContrast);
  updateSliderFill(view.sepiaIntensity);
  updateSliderFill(view.grayscaleIntensity);
  updateSliderFill(view.warmth);
  applyPopupTheme(config);
}

function updateSliderFill(input: HTMLInputElement): void {
  const minimum = Number(input.min || 0);
  const maximum = Number(input.max || 100);
  const value = Number(input.value);
  const percent = ((value - minimum) / (maximum - minimum)) * 100;
  input.style.setProperty("--slider-progress", `${percent}%`);
}

function renderStatus(): void {
  if (!app.preferences) {
    return;
  }
  const enabled = app.preferences.enabled;
  view.enabled.setAttribute("aria-checked", String(enabled));
  view.enabled.classList.toggle("is-on", enabled);
  // The header mirrors the master switch beside it. What happens on this
  // particular site is shown by the "On this site" control and the notices.
  view.statusText.textContent = app.loading ? "Loading…" : enabled ? "On" : "Paused";

  const siteOverride = isSiteOverride();
  const siteRule = hasSiteRule();
  const resolved = resolveCurrent(app.preferences);
  view.siteBadge.hidden = !siteRule;
  view.siteBadge.textContent = siteOverride ? "Site override" : siteRule ? "Site rule" : "";
  view.hostname.textContent = app.hostname || "Unavailable on this page";
  view.hostStatus.textContent = !app.hostname
    ? "Only available on standard webpages"
    : app.lastError
      ? app.lastError
      : resolved.policy === "block"
        ? "Excluded from theming"
        : resolved.policy === "allow"
          ? "Always themed on this domain"
      : siteOverride
        ? "Saved for this domain"
        : "Changes create a site rule";
  const config = currentConfig();
  for (const button of view.policyButtons) {
    const active = button.dataset.policy === resolved.policy;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
    button.disabled = !app.hostname || !app.tabReachable;
  }
  view.reset.textContent = siteRule
    ? resolved.policy === "auto"
      ? "Use global settings"
      : "Remove site rule"
    : "Use global settings";
  // Nothing to reset without a saved rule; a permanently dim control reads as
  // missing text, so hide it instead.
  view.reset.hidden = !siteRule;
  view.reset.disabled = !app.hostname || !app.tabReachable;

  if (app.pageStatus?.nativeDark) {
    const grayscale = config?.mode === "grayscale";
    view.nativeDarkNotice.hidden = false;
    // Grayscale is applied to dark pages regardless, so there is nothing to choose.
    view.nativeDarkAction.hidden = grayscale;
    view.nativeDarkToggle.setAttribute("aria-checked", String(resolved.overrideNativeDark));
    view.nativeDarkToggle.classList.toggle("is-on", resolved.overrideNativeDark);
    view.nativeDarkToggle.disabled = !app.hostname || !app.tabReachable;
    view.nativeDarkCopy.textContent = grayscale
      ? "This site already has a dark appearance. Grayscale is the active effect."
      : resolved.overrideNativeDark
        ? "This site has its own dark appearance. Darkr is applied over it."
        : "This site already has a dark appearance, so Darkr leaves it untouched.";
  } else {
    view.nativeDarkNotice.hidden = true;
  }

  const canChangePage =
    Boolean(app.tabId) && Boolean(app.hostname) && app.tabReachable;
  view.controls.classList.toggle("is-disabled", !canChangePage);
  view.permissionNotice.hidden = canChangePage || app.loading;
  for (const button of view.modeButtons) {
    button.disabled = !canChangePage;
  }
  for (const input of [
    view.darkBackground,
    view.darkContrast,
    view.sepiaIntensity,
    view.grayscaleIntensity,
    view.warmth,
  ]) {
    input.disabled = !canChangePage;
  }
}

function render(): void {
  const config = currentConfig();
  if (!config) {
    return;
  }
  applyPopupTheme(config);
  renderMode(config);
  renderStatus();
}

function applyPopupTheme(config: ThemeConfig): void {
  const root = document.documentElement;
  const tokens = buildThemeTokens(config);
  if (!tokens) {
    root.classList.remove("theme-sepia", "theme-warm", "theme-grayscale");
    for (const name of [
      "--ui-bg",
      "--ui-panel",
      "--ui-selected",
      "--ui-border",
      "--ui-border-strong",
      "--ui-text",
      "--ui-text-secondary",
      "--ui-text-tertiary",
      "--ui-accent",
      "--ui-accent-ink",
      "--ui-track",
      "--ui-inset",
    ]) {
      root.style.removeProperty(name);
    }
    return;
  }
  root.classList.toggle("theme-sepia", config.mode === "sepia");
  root.classList.toggle("theme-warm", config.mode === "warm");
  root.classList.toggle("theme-grayscale", config.mode === "grayscale");
  if (config.mode === "grayscale") {
    root.style.setProperty("--ui-bg", "#e9e9e6");
    root.style.setProperty("--ui-panel", "#f6f6f2");
    root.style.setProperty("--ui-selected", "#d8d8d3");
    root.style.setProperty("--ui-border", "#c5c5c0");
    root.style.setProperty("--ui-border-strong", "#a6a6a0");
    root.style.setProperty("--ui-text", "#151515");
    root.style.setProperty("--ui-text-secondary", "#4a4a46");
    root.style.setProperty("--ui-text-tertiary", "#5d5d59");
    root.style.setProperty("--ui-accent", "#151515");
    root.style.setProperty("--ui-accent-ink", "#f6f6f2");
    root.style.setProperty("--ui-track", "#c5c5c0");
    root.style.setProperty("--ui-inset", "#deded9");
    return;
  }
  const variables = themeVariables(tokens);
  root.style.setProperty("--ui-bg", variables["--darkr-bg"] ?? "#0b0c0d");
  root.style.setProperty(
    "--ui-panel",
    variables[tokens.scheme === "light" ? "--darkr-sunken" : "--darkr-raised"] ?? "#111213",
  );
  root.style.setProperty(
    "--ui-selected",
    variables[tokens.scheme === "light" ? "--darkr-raised" : "--darkr-sunken"] ?? "#232526",
  );
  root.style.setProperty("--ui-border", variables["--darkr-border"] ?? "#252729");
  root.style.setProperty("--ui-border-strong", variables["--darkr-border"] ?? "#3b3e40");
  root.style.setProperty("--ui-text", variables["--darkr-text"] ?? "#e8e8e5");
  root.style.setProperty("--ui-text-secondary", variables["--darkr-muted"] ?? "#9c9e9b");
  root.style.setProperty("--ui-text-tertiary", variables["--darkr-muted"] ?? "#8a8d8a");
  root.style.setProperty("--ui-accent", variables["--darkr-text"] ?? "#e8e8e5");
  root.style.setProperty("--ui-accent-ink", variables["--darkr-bg"] ?? "#111212");
  root.style.setProperty("--ui-track", variables["--darkr-border"] ?? "#303234");
  root.style.setProperty("--ui-inset", variables["--darkr-sunken"] ?? "#080909");
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
  if (!browser || !app.preferences || !app.preview || !app.hostname) {
    return;
  }
  const saving = app.preview;
  app.preferences = setSiteAppearance(app.preferences, app.hostname, saving);
  await savePreferences(browser.storage.local, app.preferences);
  // Keep a newer preview made while the write was in flight; its own debounce
  // timer will persist it. Clearing it here would silently drop that change.
  if (app.preview === saving) {
    app.preview = null;
  }
  app.pageStatus = {
    hostname: app.hostname,
    mode: resolveCurrent(app.preferences).config.mode,
    active: true,
    semanticActive: true,
    nativeDark: app.pageStatus?.nativeDark ?? false,
    permissionWarning: false,
  };
  render();
}

async function sendPreview(config: ThemeConfig): Promise<void> {
  if (!browser || !app.tabId) {
    return;
  }
  try {
    await browser.tabs.sendMessage(app.tabId, {
      type: "darkr:preview",
      config,
    });
    app.tabReachable = true;
    app.lastError = "";
  } catch {
    app.tabReachable = false;
    app.lastError = "Reload this page to apply changes";
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

function bindSlider(
  input: HTMLInputElement,
  key: keyof Pick<
    ThemeConfig,
    | "darkBackground"
    | "darkContrast"
    | "sepiaIntensity"
    | "grayscaleIntensity"
    | "warmth"
  >,
): void {
  input.addEventListener("input", () => {
    const config = currentConfig();
    if (!config) {
      return;
    }
    const next = normalizeThemeConfig({
      ...config,
      [key]: Number(input.value),
    });
    scheduleSave(next);
    renderMode(next);
    renderStatus();
  });
  input.addEventListener("change", () => {
    updateSliderFill(input);
    void commitPreview();
  });
}

for (const button of view.modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as AppearanceMode | undefined;
    if (mode) {
      selectMode(mode);
    }
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const index = view.modeButtons.indexOf(button);
    const delta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : 0;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? view.modeButtons.length - 1
          : (index + delta + view.modeButtons.length) % view.modeButtons.length;
    const next = view.modeButtons[nextIndex];
    if (next) {
      next.focus();
      selectMode(next.dataset.mode as AppearanceMode);
    }
  });
}

view.enabled.addEventListener("click", async () => {
  if (!browser || !app.preferences) {
    return;
  }
  app.preferences = setMasterEnabled(
    app.preferences,
    !app.preferences.enabled,
  );
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

view.reset.addEventListener("click", async () => {
  if (!browser || !app.preferences) {
    return;
  }
  app.preferences = removeSiteRule(app.preferences, app.hostname);
  app.preview = null;
  await sendPreview(app.preferences.defaults);
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

async function setPolicy(policy: SitePolicy): Promise<void> {
  if (!browser || !app.preferences || !app.hostname || !app.tabReachable) {
    return;
  }
  app.preferences = setSitePolicy(app.preferences, app.hostname, policy);
  app.preview = null;
  if (policy === "block") {
    await sendPreview({ ...app.preferences.defaults, mode: "original" });
  } else {
    await sendPreview(resolveCurrent(app.preferences).config);
  }
  await savePreferences(browser.storage.local, app.preferences);
  if (app.storageTimer !== null) {
    window.clearTimeout(app.storageTimer);
    app.storageTimer = null;
  }
  render();
}

for (const button of view.policyButtons) {
  button.addEventListener("click", () => {
    const policy = button.dataset.policy as SitePolicy | undefined;
    if (policy) {
      void setPolicy(policy);
    }
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const index = view.policyButtons.indexOf(button);
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? view.policyButtons.length - 1
          : (index + delta + view.policyButtons.length) % view.policyButtons.length;
    const next = view.policyButtons[nextIndex];
    if (next) {
      next.focus();
      void setPolicy(next.dataset.policy as SitePolicy);
    }
  });
}

view.nativeDarkToggle.addEventListener("click", async () => {
  if (!browser || !app.preferences || !app.hostname || !app.tabReachable) {
    return;
  }
  const next = !resolveCurrent(app.preferences).overrideNativeDark;
  app.preferences = setSiteNativeDarkOverride(app.preferences, app.hostname, next);
  await savePreferences(browser.storage.local, app.preferences);
  render();
});

view.settings.addEventListener("click", async () => {
  if (!browser) {
    return;
  }
  try {
    await browser.runtime.openOptionsPage();
  } catch {
    app.lastError = "Settings unavailable";
    renderStatus();
  }
});

view.darkBackground.addEventListener("keydown", (event) => {
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    view.darkBackground.value =
      event.key === "Home" ? "0" : view.darkBackground.max;
    view.darkBackground.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

bindSlider(view.darkBackground, "darkBackground");
bindSlider(view.darkContrast, "darkContrast");
bindSlider(view.sepiaIntensity, "sepiaIntensity");
bindSlider(view.grayscaleIntensity, "grayscaleIntensity");
bindSlider(view.warmth, "warmth");

async function initialize(): Promise<void> {
  if (!browser) {
    view.statusText.textContent = "Extension unavailable";
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
      app.pageStatus = await browser.tabs.sendMessage<ContentStatus>(
        app.tabId,
        { type: "darkr:get-status" },
      );
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
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => render());

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const updated = preferencesFromStorageChange(changes);
    if (!updated) {
      return;
    }
    app.preferences = updated;
    app.preview = null;
    render();
  });
}

void initialize();
