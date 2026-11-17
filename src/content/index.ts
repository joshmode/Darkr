import {
  hostnamePreferenceKey,
  normalizeThemeConfig,
  resolveAppearance,
  themeConfigsEqual,
} from "../shared/config";
import {
  getBrowserApi,
  topHostnameFromAncestorOrigins,
  type ContentStatus,
} from "../shared/extension-api";
import { loadPreferences, preferencesFromStorageChange } from "../shared/preferences";
import type { DarkrPreferences, ThemeConfig } from "../shared/types";
import { ThemeEngine } from "./theme-engine";

declare global {
  interface Window {
    __DARKR_CONTENT__?: boolean;
  }
}

if (!window.__DARKR_CONTENT__) {
  window.__DARKR_CONTENT__ = true;

  const browser = getBrowserApi();
  const engine = new ThemeEngine();
  let currentConfig: ThemeConfig | null = null;
  let currentOverrideNativeDark = false;
  let livePreviewTimer: number | null = null;
  // Whether stored preferences currently allow theming this page. Popup
  // previews must not override a paused extension or a blocked site.
  let themingAllowed = false;

  // Preferences are resolved against the top-level site for every frame, so a
  // site's rule (or Never) also governs the frames it embeds. In a subframe the
  // top site comes from `location.ancestorOrigins` where the browser has it
  // (Chromium); otherwise (Safari, opaque origins) the background answers from
  // the sender's tab URL.
  const isTopFrame = window === window.top;
  let topHostname: string | null = isTopFrame
    ? location.hostname
    : topHostnameFromAncestorOrigins(
        (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins,
      );
  const topHostnameReady: Promise<void> =
    topHostname !== null || !browser
      ? Promise.resolve()
      : browser.runtime
          .sendMessage<{ hostname?: string } | undefined>({ type: "darkr:get-top-host" })
          .then((response) => {
            topHostname = response?.hostname || location.hostname;
          })
          .catch(() => {
            topHostname = location.hostname;
          });
  const hostname = hostnamePreferenceKey(topHostname ?? location.hostname);

  // Preferences live in asynchronous extension storage, so at document_start
  // the page would paint unthemed for a few frames. Hold painting until the
  // first resolution, with a hard timeout so a stalled storage call can never
  // leave a page blank.
  const PREPAINT_ID = "darkr-prepaint";
  const PREPAINT_TIMEOUT_MS = 400;
  let prepaintStyle: HTMLStyleElement | null = null;
  let prepaintTimer: number | null = null;
  const holdPainting = (): void => {
    if (!browser || !document.documentElement) {
      return;
    }
    prepaintStyle = document.createElement("style");
    prepaintStyle.id = PREPAINT_ID;
    prepaintStyle.textContent = "html { visibility: hidden !important; }";
    document.documentElement.append(prepaintStyle);
    prepaintTimer = window.setTimeout(releasePainting, PREPAINT_TIMEOUT_MS);
  };
  function releasePainting(): void {
    if (prepaintTimer !== null) {
      window.clearTimeout(prepaintTimer);
      prepaintTimer = null;
    }
    prepaintStyle?.remove();
    prepaintStyle = null;
  }
  holdPainting();

  const systemDarkQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  // Under forced colors the user's own high-contrast palette must win, so
  // Darkr applies nothing. Browsers without the media feature report no match.
  const forcedColorsQuery =
    typeof window.matchMedia === "function" ? window.matchMedia("(forced-colors: active)") : null;
  const isSystemDark = (): boolean => systemDarkQuery?.matches ?? true;
  let latestPreferences: DarkrPreferences | null = null;

  const applyConfig = (
    config: ThemeConfig,
    overrideNativeDark = currentOverrideNativeDark,
  ): void => {
    if (
      currentConfig &&
      currentOverrideNativeDark === overrideNativeDark &&
      themeConfigsEqual(currentConfig, config)
    ) {
      return;
    }
    currentConfig = { ...config };
    currentOverrideNativeDark = overrideNativeDark;
    engine.apply(config, { overrideNativeDark });
  };

  const applyResolvedPreferences = async (): Promise<void> => {
    if (!browser) {
      return;
    }
    const [preferences] = await Promise.all([
      loadPreferences(browser.storage.local),
      topHostnameReady,
    ]);
    syncToPreferences(preferences);
  };

  const syncToPreferences = (preferences: DarkrPreferences): void => {
    latestPreferences = preferences;
    if (topHostname === null) {
      // The top-level host is still being resolved; the initial load applies
      // the latest preferences once it is known.
      return;
    }
    const resolved = resolveAppearance(preferences, topHostname, {
      systemDark: isSystemDark(),
    });
    const enabled = resolved.enabled && !forcedColorsQuery?.matches;
    themingAllowed = enabled;
    if (enabled) {
      applyConfig(resolved.config, resolved.overrideNativeDark);
    } else {
      engine.clear();
      currentConfig = null;
    }
  };

  // The content document has not painted at document_start; persistence is
  // still synchronous-looking from the page's perspective once loaded below.
  const initialLoad = applyResolvedPreferences()
    .catch(() => undefined)
    .finally(releasePainting);

  forcedColorsQuery?.addEventListener("change", () => {
    if (latestPreferences) {
      syncToPreferences(latestPreferences);
    }
  });

  // "Automatic" sites can follow the operating system's appearance.
  systemDarkQuery?.addEventListener("change", () => {
    if (latestPreferences) {
      syncToPreferences(latestPreferences);
    }
  });

  let hasRefreshedAfterLoad = false;
  const refreshForSettledDocument = async (): Promise<void> => {
    await initialLoad;
    if (hasRefreshedAfterLoad || !currentConfig) {
      return;
    }
    hasRefreshedAfterLoad = true;
    await applyResolvedPreferences();
    engine.refresh();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void refreshForSettledDocument();
      },
      { once: true },
    );
  } else {
    void refreshForSettledDocument();
  }

  browser?.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Each frame themes itself from storage. Only the top frame answers popup
    // requests so an iframe cannot report or apply state for the host page.
    if (window !== window.top) {
      return false;
    }
    if (message.type === "darkr:preview" && message.config) {
      if (livePreviewTimer !== null) {
        window.clearTimeout(livePreviewTimer);
      }
      if (!themingAllowed) {
        sendResponse({ ok: true, ignored: true });
        return false;
      }
      // Messages come only from the extension's own pages, but treat the
      // payload as untrusted data anyway: clamp it before it reaches the DOM.
      const config = normalizeThemeConfig(message.config);
      // Acknowledge immediately and coalesce the expensive DOM work. The popup
      // already debounces storage writes, so this only smooths slider input.
      sendResponse({ ok: true });
      schedulePreview(config);
      return false;
    }

    if (message.type === "darkr:get-status") {
      const status: ContentStatus = {
        hostname,
        mode: engine.status.mode,
        semanticActive: engine.status.semanticActive,
        nativeDark: engine.status.nativeDark,
        active: engine.status.active,
        permissionWarning: !browser,
      };
      sendResponse(status);
      return false;
    }

    if (message.type === "darkr:refresh") {
      // Always answer, even if storage is unavailable (for example after the
      // extension was reloaded), so the popup is never left waiting.
      void applyResolvedPreferences()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    return false;
  });

  browser?.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const preferences = preferencesFromStorageChange(changes);
    if (!preferences) {
      return;
    }
    syncToPreferences(preferences);
  });

  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) {
        void applyResolvedPreferences().then(() => engine.resume());
      }
    },
    { passive: true },
  );

  window.addEventListener("pagehide", () => engine.suspend(), { passive: true });

  function schedulePreview(config: ThemeConfig): void {
    if (livePreviewTimer !== null) {
      window.clearTimeout(livePreviewTimer);
    }
    livePreviewTimer = window.setTimeout(() => {
      livePreviewTimer = null;
      applyConfig(config);
    }, 28);
  }
}
