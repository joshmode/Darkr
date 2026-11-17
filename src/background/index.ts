import { hostnamePreferenceKey, setMasterEnabled, toggleSiteEnabled } from "../shared/config";
import { hostnameFromUrl, type PageState } from "../shared/extension-api";
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
        ) => boolean | void,
      ): void;
    };
    openOptionsPage(): Promise<void>;
  };
  storage: { local: StorageAreaLike };
  tabs?: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ url?: string }>>;
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

const TITLES: Record<PageState, string> = {
  on: "Darkr — on for this site",
  "off-site": "Darkr — off for this site",
  paused: "Darkr — paused everywhere",
  unavailable: "Darkr — unavailable on this page",
};

async function showState(tabId: number, state: PageState): Promise<void> {
  const action = api?.action;
  if (!action) {
    return;
  }
  const badge = state === "on" ? "" : state === "unavailable" ? "" : "off";
  try {
    await action.setBadgeText({ tabId, text: badge });
    await action.setBadgeBackgroundColor?.({ tabId, color: "#5c5f62" });
    await action.setTitle?.({ tabId, title: TITLES[state] });
  } catch {
    // The tab may have closed; nothing to show.
  }
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
    if (details.reason !== "install") {
      return;
    }
    void needsOnboarding(api.storage.local).then((required) => {
      if (required) {
        void api.runtime.openOptionsPage().catch(() => {
          // Safari may decline programmatic opening. The permanent settings
          // entry point remains available from the toolbar popup.
        });
      }
    });
  });
}
