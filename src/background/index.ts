import { hostnameFromUrl } from "../shared/extension-api";
import { needsOnboarding } from "../shared/preferences";

interface InstallApi {
  runtime: {
    onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    openOptionsPage(): Promise<void>;
    onMessage: {
      addListener(
        listener: (
          message: { type?: string },
          sender: { tab?: { url?: string } },
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

const api =
  (globalThis as typeof globalThis & { browser?: InstallApi; chrome?: InstallApi }).browser ??
  (globalThis as typeof globalThis & { browser?: InstallApi; chrome?: InstallApi }).chrome;

if (api) {
  // Frames resolve preferences against the top-level site. Browsers without
  // `location.ancestorOrigins` (Safari) ask here; the sender's tab URL is the
  // top-level document's URL.
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "darkr:get-top-host") {
      return false;
    }
    sendResponse({ hostname: hostnameFromUrl(sender.tab?.url) });
    return false;
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
