import { hostnamePreferenceKey, setMasterEnabled, toggleSiteEnabled } from "../shared/config";
import { hostnameFromUrl, type PageState } from "../shared/extension-api";
import { t } from "../shared/i18n";
import {
  loadPreferences,
  needsOnboarding,
  type StorageAreaLike,
  savePreferences,
} from "../shared/preferences";

interface BackgroundApi {
  runtime: {
    onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    onMessage: {
      addListener(
        listener: (
          message: { type?: string; state?: PageState },
          sender: { tab?: { id?: number; url?: string } },
          sendResponse: (response: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
    openOptionsPage(): Promise<void>;
    getURL(path: string): string;
  };
  storage: { local: StorageAreaLike };
  /** Needs the `scripting` permission; absent in some browsers. */
  scripting?: {
    executeScript(injection: {
      target: { tabId: number; allFrames?: boolean };
      files: string[];
    }): Promise<unknown>;
  };
  tabs?: {
    create?(properties: { url: string }): Promise<unknown>;
    query(query: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string[];
    }): Promise<Array<{ id?: number; url?: string }>>;
  };
  /** Not available in every browser (Safari has no keyboard commands). */
  commands?: {
    onCommand: { addListener(listener: (command: string) => void): void };
  };
  action?: {
    setBadgeText(details: { tabId: number; text: string }): Promise<void> | void;
    setBadgeBackgroundColor?(details: { tabId: number; color: string }): Promise<void> | void;
    setTitle?(details: { tabId: number; title: string }): Promise<void> | void;
  };
}

const scope = globalThis as typeof globalThis & { browser?: BackgroundApi; chrome?: BackgroundApi };
const api = scope.browser ?? scope.chrome;

const titleFor = (state: PageState): string =>
  state === "on"
    ? t("badgeOn", "Darkr — on for this site")
    : state === "off-site"
      ? t("badgeOffSite", "Darkr — off for this site")
      : state === "paused"
        ? t("badgePaused", "Darkr — paused everywhere")
        : t("badgeUnavailable", "Darkr — unavailable on this page");

async function showState(tabId: number, state: PageState): Promise<void> {
  const action = api?.action;
  if (!action) {
    return;
  }
  const badge = state === "on" ? "" : state === "unavailable" ? "" : "off";
  try {
    await action.setBadgeText({ tabId, text: badge });
    await action.setBadgeBackgroundColor?.({ tabId, color: "#5c5f62" });
    await action.setTitle?.({ tabId, title: titleFor(state) });
  } catch {
    // The tab may have closed; nothing to show.
  }
}

/**
 * Tabs opened before the extension was installed or updated have no content
 * script (or an orphaned one). Inject into them so the first thing a new user
 * tries works without a reload. Skipped where `scripting` is unavailable.
 */
async function injectIntoOpenTabs(): Promise<void> {
  const scripting = api?.scripting;
  const tabs = await api?.tabs?.query({ url: ["http://*/*", "https://*/*"] });
  if (!scripting || !tabs) {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }
      try {
        await scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ["content.js"],
        });
      } catch {
        // Restricted pages (the web store, error pages) cannot be scripted.
      }
    }),
  );
}

async function runCommand(command: string): Promise<void> {
  if (!api) {
    return;
  }
  const preferences = await loadPreferences(api.storage.local);
  if (command === "toggle-everywhere") {
    await savePreferences(api.storage.local, setMasterEnabled(preferences, !preferences.enabled));
    return;
  }
  if (command === "toggle-site") {
    const [tab] = (await api.tabs?.query({ active: true, currentWindow: true })) ?? [];
    const host = hostnamePreferenceKey(hostnameFromUrl(tab?.url));
    if (!host) {
      return;
    }
    const environment = { systemDark: true };
    // Same rule as the popup's switch; the system appearance is unknown here,
    // so "Automatic" is judged as if the system were dark.
    await savePreferences(api.storage.local, toggleSiteEnabled(preferences, host, environment));
  }
}

if (api) {
  // Frames resolve preferences against the top-level site. Browsers without
  // `location.ancestorOrigins` (Safari) ask here; the sender's tab URL is the
  // top-level document's URL.
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "darkr:get-top-host") {
      sendResponse({ hostname: hostnameFromUrl(sender.tab?.url) });
      return false;
    }
    if (message?.type === "darkr:state" && message.state && sender.tab?.id !== undefined) {
      void showState(sender.tab.id, message.state);
    }
    return false;
  });

  api.commands?.onCommand.addListener((command) => {
    void runCommand(command);
  });

  api.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install" || details.reason === "update") {
      void injectIntoOpenTabs();
    }
    if (details.reason !== "install") {
      return;
    }
    void needsOnboarding(api.storage.local).then((required) => {
      if (required) {
        const welcome = api.runtime.getURL("welcome.html");
        const opened = api.tabs?.create?.({ url: welcome });
        // Safari may decline programmatic opening. The permanent settings
        // entry point remains available from the toolbar popup.
        void (opened ?? api.runtime.openOptionsPage()).catch(() => undefined);
      }
    });
  });
}
