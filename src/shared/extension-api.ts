import type { ThemeConfig } from "./types";

export interface RuntimeMessage {
  type: "darkr:preview" | "darkr:get-status" | "darkr:get-top-host" | "darkr:state";
  config?: ThemeConfig;
  /** For darkr:state: what the toolbar should show for the sending tab. */
  state?: PageState;
}

export type PageState = "on" | "off-site" | "paused" | "unavailable";

export interface StorageChange {
  newValue?: unknown;
  oldValue?: unknown;
}

export interface StorageChangedEvent {
  addListener(listener: (changes: Record<string, StorageChange>, areaName: string) => void): void;
}

export interface ContentStatus {
  hostname: string;
  mode: ThemeConfig["mode"];
  active: boolean;
  semanticActive: boolean;
  nativeDark: boolean;
}

export interface BrowserApi {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    onChanged: {
      addListener(
        listener: (
          changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
  i18n?: { getMessage(key: string, substitutions?: string[]): string };
  tabs: {
    reload(tabId: number): Promise<void>;
    query(query: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<Array<{ id?: number; url?: string; title?: string }>>;
    sendMessage<TResponse>(tabId: number, message: RuntimeMessage): Promise<TResponse>;
  };
  runtime: {
    id?: string;
    lastError?: { message?: string };
    openOptionsPage(): Promise<void>;
    getURL(path: string): string;
    getManifest(): { version: string; name?: string };
    sendMessage<TResponse>(message: RuntimeMessage): Promise<TResponse>;
    onMessage: {
      addListener(
        listener: (
          message: RuntimeMessage,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
}

export function getBrowserApi(): BrowserApi | null {
  const scope = globalThis as typeof globalThis & {
    browser?: BrowserApi;
    chrome?: BrowserApi;
  };
  return scope.browser ?? scope.chrome ?? null;
}

export async function getActiveTab(
  api: BrowserApi,
): Promise<{ id?: number; url?: string; title?: string } | null> {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

export function hostnameFromUrl(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    return "";
  }
}

/**
 * Hostname of the top-level site as reported by `location.ancestorOrigins`
 * (the last entry is the top-level origin). Returns null when the list is
 * missing (Safari, Firefox) or unusable (opaque "null" origins from sandboxed
 * frames), so callers can fall back to asking the background.
 */
export function topHostnameFromAncestorOrigins(
  origins: ArrayLike<string> | null | undefined,
): string | null {
  if (!origins || origins.length === 0) {
    return null;
  }
  return hostnameFromUrl(origins[origins.length - 1]) || null;
}
