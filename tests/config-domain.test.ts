import { describe, expect, it } from "vitest";
import {
  normalizeHostname,
  normalizePreferences,
  removeSiteRule,
  resolveAppearance,
  setSiteAppearance,
  clearSiteAppearance,
  setAutoMode,
  setGlobalNativeDarkOverride,
  setMasterEnabled,
  setSiteNativeDarkOverride,
  setSitePolicy,
  themeConfigToOverrides,
} from "../src/shared/config";
import { DEFAULT_THEME_CONFIG } from "../src/shared/types";

describe("domain edge cases", () => {
  it("preserves a valid www hostname when stripping would leave no registrable label", () => {
    expect(normalizeHostname("www.com")).toBe("www.com");
    expect(normalizeHostname("www.example.com")).toBe("example.com");
    expect(normalizeHostname("localhost")).toBe("localhost");
    expect(normalizeHostname("[2001:db8::1]")).toBe("[2001:db8::1]");
  });
});

describe("partial domain overrides", () => {
  it("stores only fields that differ from defaults", () => {
    const preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      { ...DEFAULT_THEME_CONFIG, mode: "sepia" },
    );
    expect(preferences.sites["example.com"]?.overrides).toEqual({
      mode: "sepia",
    });
    expect(resolveAppearance(preferences, "example.com").config.mode).toBe(
      "sepia",
    );
  });

  it("inherits later global changes for unstored values", () => {
    let preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      { ...DEFAULT_THEME_CONFIG, mode: "sepia", sepiaIntensity: 90 },
    );
    preferences = {
      ...preferences,
      defaults: { ...preferences.defaults, darkBackground: 65 },
    };
    const resolved = resolveAppearance(preferences, "example.com").config;
    expect(resolved.darkBackground).toBe(65);
    expect(resolved.sepiaIntensity).toBe(90);
  });

  it("does not create an empty site entry", () => {
    const preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      { ...DEFAULT_THEME_CONFIG },
    );
    expect(preferences.sites).toEqual({});
  });

  it("computes partial overrides from current global defaults", () => {
    expect(
      themeConfigToOverrides(DEFAULT_THEME_CONFIG, {
        ...DEFAULT_THEME_CONFIG,
        warmth: 80,
      }),
    ).toEqual({ warmth: 80 });
  });
});

describe("site policies", () => {
  it("blocks a site independently of the global switch", () => {
    const preferences = setSitePolicy(
      normalizePreferences(null),
      "example.com",
      "block",
    );
    expect(resolveAppearance(preferences, "example.com").enabled).toBe(false);
    expect(resolveAppearance(preferences, "example.com").policy).toBe("block");
    expect(resolveAppearance(preferences, "other.example").enabled).toBe(true);
  });

  it("allows a site while preserving an appearance override", () => {
    let preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      { ...DEFAULT_THEME_CONFIG, mode: "warm" },
    );
    preferences = setSitePolicy(preferences, "example.com", "allow");
    const resolved = resolveAppearance(preferences, "example.com");
    expect(resolved.enabled).toBe(true);
    expect(resolved.policy).toBe("allow");
    expect(resolved.config.mode).toBe("warm");
  });

  it("keeps a policy when appearance overrides reset", () => {
    let preferences = setSitePolicy(
      normalizePreferences(null),
      "example.com",
      "block",
    );
    preferences = setSiteAppearance(
      preferences,
      "example.com",
      DEFAULT_THEME_CONFIG,
    );
    expect(preferences.sites["example.com"]).toEqual({ policy: "block" });
  });

  it("removes a policy and appearance override together when requested", () => {
    let preferences = setSiteAppearance(
      normalizePreferences(null),
      "example.com",
      { ...DEFAULT_THEME_CONFIG, mode: "warm" },
    );
    preferences = setSitePolicy(preferences, "example.com", "allow");
    preferences = removeSiteRule(preferences, "example.com");
    expect(preferences.sites).toEqual({});
  });

  it("migrates legacy flat site overrides", () => {
    const preferences = normalizePreferences({
      sites: { "example.com": { mode: "warm", warmth: 70 } },
    });
    expect(preferences.sites["example.com"]).toEqual({
      policy: "auto",
      overrides: { mode: "warm", warmth: 70 },
    });
  });
});

describe("prototype-named hosts", () => {
  it("does not treat Object.prototype members as saved rules", () => {
    const preferences = normalizePreferences(null);
    expect(resolveAppearance(preferences, "constructor").policy).toBe("auto");
    expect(removeSiteRule(preferences, "constructor")).toBe(preferences);
    const blocked = setSitePolicy(preferences, "constructor", "block");
    expect(resolveAppearance(blocked, "constructor").enabled).toBe(false);
    expect(resolveAppearance(blocked, "toString").enabled).toBe(true);
  });
});

describe("site policy semantics", () => {
  const base = normalizePreferences(null);
  const paused = setMasterEnabled(base, false);

  it("Always themes even while Darkr is paused; Never never does", () => {
    const always = setSitePolicy(paused, "example.com", "allow");
    expect(resolveAppearance(always, "example.com").enabled).toBe(true);
    expect(resolveAppearance(always, "other.example").enabled).toBe(false);
    const never = setSitePolicy(base, "example.com", "block");
    expect(resolveAppearance(never, "example.com", { systemDark: true }).enabled).toBe(false);
  });

  it("Automatic follows the master switch with global settings", () => {
    expect(resolveAppearance(base, "example.com", { systemDark: false }).enabled).toBe(true);
    expect(resolveAppearance(paused, "example.com").enabled).toBe(false);
  });

  it("Automatic can follow the system appearance instead", () => {
    const system = setAutoMode(base, "system");
    expect(resolveAppearance(system, "example.com", { systemDark: true }).enabled).toBe(true);
    expect(resolveAppearance(system, "example.com", { systemDark: false }).enabled).toBe(false);
    expect(resolveAppearance(system, "example.com").enabled).toBe(true);
    expect(resolveAppearance(setMasterEnabled(system, false), "example.com", { systemDark: true }).enabled).toBe(false);
    const always = setSitePolicy(system, "example.com", "allow");
    expect(resolveAppearance(always, "example.com", { systemDark: false }).enabled).toBe(true);
  });

  it("migrates stored preferences without autoMode to global behaviour", () => {
    expect(normalizePreferences({ enabled: true }).autoMode).toBe("globals");
    expect(normalizePreferences({ autoMode: "system" }).autoMode).toBe("system");
    expect(normalizePreferences({ autoMode: "bogus" }).autoMode).toBe("globals");
  });
});

describe("native dark override", () => {
  const base = normalizePreferences(null);

  it("follows the global setting unless a site chooses otherwise", () => {
    expect(resolveAppearance(base, "example.com").overrideNativeDark).toBe(false);
    const global = setGlobalNativeDarkOverride(base, true);
    expect(resolveAppearance(global, "example.com").overrideNativeDark).toBe(true);
    const siteOff = setSiteNativeDarkOverride(global, "example.com", false);
    expect(resolveAppearance(siteOff, "example.com").overrideNativeDark).toBe(false);
    expect(resolveAppearance(siteOff, "other.example").overrideNativeDark).toBe(true);
  });

  it("stores nothing when a site's choice matches the global", () => {
    const on = setSiteNativeDarkOverride(base, "example.com", true);
    expect(on.sites["example.com"]).toEqual({ policy: "auto", overrideNativeDark: true });
    expect(setSiteNativeDarkOverride(on, "example.com", false).sites).toEqual({});
  });

  it("survives every other site edit", () => {
    let preferences = setSiteNativeDarkOverride(base, "example.com", true);
    preferences = setSitePolicy(preferences, "example.com", "allow");
    preferences = setSiteAppearance(preferences, "example.com", {
      ...DEFAULT_THEME_CONFIG,
      mode: "sepia",
    });
    expect(preferences.sites["example.com"]?.overrideNativeDark).toBe(true);
    expect(preferences.sites["example.com"]?.overrides?.mode).toBe("sepia");
    preferences = clearSiteAppearance(preferences, "example.com");
    expect(preferences.sites["example.com"]).toEqual({ policy: "allow", overrideNativeDark: true });
    preferences = setSitePolicy(preferences, "example.com", "auto");
    expect(preferences.sites["example.com"]).toEqual({ policy: "auto", overrideNativeDark: true });
    expect(removeSiteRule(preferences, "example.com").sites).toEqual({});
  });

  it("round-trips through normalization and rejects non-booleans", () => {
    const stored = normalizePreferences({
      overrideNativeDark: true,
      sites: { "a.com": { policy: "auto", overrideNativeDark: false }, "b.com": { overrideNativeDark: "yes" } },
    });
    expect(stored.overrideNativeDark).toBe(true);
    expect(stored.sites["a.com"]).toEqual({ policy: "auto", overrideNativeDark: false });
    expect(stored.sites["b.com"]).toBeUndefined();
    expect(normalizePreferences({ overrideNativeDark: "true" }).overrideNativeDark).toBe(false);
  });
});
