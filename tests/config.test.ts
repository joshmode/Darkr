import { describe, expect, it } from "vitest";
import {
  clearAllSiteAppearances,
  clearSiteAppearance,
  hostnamePreferenceKey,
  normalizeHostname,
  normalizePreferences,
  normalizeThemeConfig,
  resolveAppearance,
  restoreDefaultValues,
  setDefaultAppearance,
  setMasterEnabled,
  setSiteAppearance,
  themeConfigsEqual,
} from "../src/shared/config";
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from "../src/shared/types";

const warmConfig: ThemeConfig = {
  mode: "warm",
  darkBackground: 12,
  darkContrast: 75,
  sepiaIntensity: 40,
  grayscaleIntensity: 100,
  warmth: 55,
};

describe("domain matching", () => {
  it("normalizes case, whitespace, trailing dots, and www aliases", () => {
    expect(normalizeHostname(" WWW.Example.COM. ")).toBe("example.com");
    expect(hostnamePreferenceKey(new URL("https://docs.example.com/path"))).toBe("docs.example.com");
    expect(normalizeHostname("not a host")).toBe("");
  });

  it("keeps subdomains independent", () => {
    const preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      warmConfig,
    );
    expect(resolveAppearance(preferences, "example.com").source).toBe("site");
    expect(resolveAppearance(preferences, "docs.example.com").source).toBe("defaults");
    expect(resolveAppearance(preferences, "www.example.com").source).toBe("site");
  });
});

describe("configuration validation", () => {
  it("clamps numeric values and falls back for invalid fields", () => {
    expect(
      normalizeThemeConfig({
        mode: "sepia",
        darkBackground: 900,
        darkContrast: -20,
        sepiaIntensity: Number.NaN,
        grayscaleIntensity: 22.6,
        warmth: "70",
      }),
    ).toEqual({
      mode: "sepia",
      darkBackground: 100,
      darkContrast: 0,
      sepiaIntensity: DEFAULT_THEME_CONFIG.sepiaIntensity,
      grayscaleIntensity: 23,
      warmth: DEFAULT_THEME_CONFIG.warmth,
    });
  });

  it("rejects unknown modes and non-object storage", () => {
    expect(normalizeThemeConfig({ mode: "neon" }).mode).toBe(DEFAULT_THEME_CONFIG.mode);
    expect(normalizePreferences("broken")).toEqual({
      schemaVersion: 1,
      enabled: true,
      autoMode: "globals",
      overrideNativeDark: false,
      defaults: { ...DEFAULT_THEME_CONFIG },
      sites: {},
    });
  });

  it("drops invalid site keys and normalizes valid ones", () => {
    const preferences = normalizePreferences({
      enabled: false,
      defaults: { mode: "dark" },
      sites: {
        "WWW.Example.com": { mode: "sepia" },
        "bad host": { mode: "warm" },
        "docs.example.com": "not-an-object",
      },
    });
    expect(preferences.enabled).toBe(false);
    expect(preferences.defaults.mode).toBe("dark");
    expect(preferences.sites["example.com"]?.overrides?.mode).toBe("sepia");
    expect(preferences.sites["docs.example.com"]).toBeUndefined();
  });
});

describe("theme state transitions", () => {
  it("sets, resolves, clears, and restores site preferences", () => {
    let preferences = normalizePreferences(null);
    preferences = setSiteAppearance(preferences, "www.example.com", warmConfig);
    expect(resolveAppearance(preferences, "example.com").config).toEqual(warmConfig);
    preferences = clearSiteAppearance(preferences, "example.com");
    expect(resolveAppearance(preferences, "example.com").source).toBe("defaults");
  });

  it("updates master enable and default values", () => {
    let preferences = normalizePreferences(null);
    preferences = setMasterEnabled(preferences, false);
    expect(resolveAppearance(preferences, "example.com").enabled).toBe(false);
    preferences = setDefaultAppearance(preferences, { ...warmConfig, mode: "warm" });
    expect(preferences.defaults.mode).toBe("warm");
    preferences = restoreDefaultValues(preferences);
    expect(themeConfigsEqual(preferences.defaults, DEFAULT_THEME_CONFIG)).toBe(true);
  });

  it("clears all sites without changing defaults", () => {
    let preferences = setSiteAppearance(normalizePreferences(null), "a.test", warmConfig);
    preferences = setSiteAppearance(preferences, "b.test", { ...warmConfig, mode: "sepia" });
    preferences = clearAllSiteAppearances(preferences);
    expect(preferences.sites).toEqual({});
    expect(preferences.defaults).toEqual(DEFAULT_THEME_CONFIG);
  });
});
