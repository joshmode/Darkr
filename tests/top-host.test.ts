import { afterEach, describe, expect, it, vi } from "vitest";
import { topHostnameFromAncestorOrigins } from "../src/shared/extension-api";

describe("topHostnameFromAncestorOrigins", () => {
  it("uses the last (top-level) origin", () => {
    expect(
      topHostnameFromAncestorOrigins(["https://viewer.example", "https://top.example:8080"]),
    ).toBe("top.example");
  });

  it("returns null when the list is missing, empty or opaque", () => {
    expect(topHostnameFromAncestorOrigins(undefined)).toBeNull();
    expect(topHostnameFromAncestorOrigins([])).toBeNull();
    expect(topHostnameFromAncestorOrigins(["null"])).toBeNull();
  });
});

describe("background top-host answer", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("answers from the sender's tab URL", async () => {
    let listener:
      | ((message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown)
      | undefined;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
        openOptionsPage: async () => undefined,
      },
      storage: { local: { get: async () => ({}), set: async () => undefined } },
    };
    await import("../src/background/index");
    const respond = vi.fn();
    listener?.(
      { type: "darkr:get-top-host" },
      { tab: { url: "https://top.example/page" } },
      respond,
    );
    expect(respond).toHaveBeenCalledWith({ hostname: "top.example" });
    const other = vi.fn();
    expect(listener?.({ type: "something-else" }, {}, other)).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });
});

describe("keyboard commands", () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "chrome");
  });

  it("toggle-site blocks the active tab's site and toggle-everywhere pauses", async () => {
    const store: Record<string, unknown> = {};
    let onCommand: ((command: string) => void) | undefined;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        onInstalled: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
        openOptionsPage: async () => undefined,
      },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(store, items),
        },
      },
      tabs: { query: async () => [{ url: "https://news.example/story" }] },
      commands: { onCommand: { addListener: (fn: typeof onCommand) => (onCommand = fn) } },
    };
    await import("../src/background/index");
    onCommand?.("toggle-site");
    await vi.waitFor(() => {
      const stored = store["darkr.preferences.v1"] as {
        sites?: Record<string, { policy: string }>;
      };
      expect(stored?.sites?.["news.example"]?.policy).toBe("block");
    });
    onCommand?.("toggle-site");
    await vi.waitFor(() => {
      const stored = store["darkr.preferences.v1"] as { sites?: Record<string, unknown> };
      expect(stored?.sites?.["news.example"]).toBeUndefined();
    });
    onCommand?.("toggle-everywhere");
    await vi.waitFor(() => {
      expect((store["darkr.preferences.v1"] as { enabled: boolean }).enabled).toBe(false);
    });
  });
});
