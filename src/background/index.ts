import { needsOnboarding } from "../shared/preferences";

interface InstallApi {
  runtime: {
    onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    openOptionsPage(): Promise<void>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

const api = (
  globalThis as typeof globalThis & { browser?: InstallApi; chrome?: InstallApi }
).browser ?? (
  globalThis as typeof globalThis & { browser?: InstallApi; chrome?: InstallApi }
).chrome;

if (api) {
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
