import { describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  completeOnboarding,
  loadPreferences,
  needsOnboarding,
  preferencesFromStorageChange,
  savePreferences,
} from "../src/shared/preferences";
import { normalizePreferences, setSiteAppearance } from "../src/shared/config";
import { DEFAULT_THEME_CONFIG } from "../src/shared/types";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  };
}

describe("durable preference storage", () => {
  it("loads defaults when storage is empty", async () => {
    const storage = memoryStorage();
    const preferences = await loadPreferences(storage);
    expect(preferences.defaults).toEqual(DEFAULT_THEME_CONFIG);
    expect(preferences.sites).toEqual({});
  });

  it("saves normalized settings and reads them back", async () => {
    const storage = memoryStorage();
    const preferences = setSiteAppearance(normalizePreferences(null), "example.com", {
      ...DEFAULT_THEME_CONFIG,
      mode: "sepia",
    });
    await savePreferences(storage, preferences);
    expect(storage.set).toHaveBeenCalledOnce();
    const loaded = await loadPreferences(storage);
    expect(loaded.sites["example.com"]?.overrides?.mode).toBe("sepia");
  });

  it("normalizes corrupt data instead of throwing", async () => {
    const storage = memoryStorage({ [PREFERENCES_STORAGE_KEY]: { enabled: "yes" } });
    const loaded = await loadPreferences(storage);
    expect(loaded.enabled).toBe(true);
    expect(loaded.defaults).toEqual(DEFAULT_THEME_CONFIG);
  });

  it("ignores storage errors", async () => {
    const storage = {
      get: vi.fn(async () => {
        throw new Error("denied");
      }),
      set: vi.fn(),
    };
    const loaded = await loadPreferences(storage);
    expect(loaded.defaults).toEqual(DEFAULT_THEME_CONFIG);
  });

  it("extracts only the preferences storage change", () => {
    expect(
      preferencesFromStorageChange({ [PREFERENCES_STORAGE_KEY]: { newValue: { enabled: false } } })
        ?.enabled,
    ).toBe(false);
    expect(preferencesFromStorageChange({ other: { newValue: {} } })).toBeNull();
  });

  it("persists a one-time onboarding acknowledgment", async () => {
    const storage = memoryStorage();
    expect(await needsOnboarding(storage)).toBe(true);
    await completeOnboarding(storage);
    expect(storage.data[ONBOARDING_STORAGE_KEY]).toBe(true);
    expect(await needsOnboarding(storage)).toBe(false);
  });
});

describe("schema versions", () => {
  it("loads a version 1 payload unchanged and tolerates a missing version", async () => {
    const { normalizePreferences, CURRENT_SCHEMA_VERSION } = await import("../src/shared/config");
    const v1 = {
      schemaVersion: 1,
      enabled: false,
      autoMode: "system",
      defaults: { mode: "sepia", sepiaIntensity: 40 },
      sites: { "example.com": { policy: "block" } },
    };
    const loaded = normalizePreferences(v1);
    expect(loaded.enabled).toBe(false);
    expect(loaded.defaults.mode).toBe("sepia");
    expect(loaded.sites["example.com"]?.policy).toBe("block");
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalizePreferences({ ...v1, schemaVersion: undefined }).enabled).toBe(false);
  });
});
