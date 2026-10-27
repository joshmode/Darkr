import {
  APPEARANCE_MODES,
  DEFAULT_PREFERENCES,
  DEFAULT_THEME_CONFIG,
  type AppearanceEnvironment,
  type AppearanceMode,
  type AutoMode,
  type DarkrPreferences,
  type DomainPreferences,
  type ResolvedAppearance,
  type SitePolicy,
  type SiteRule,
  type ThemeConfig,
} from "./types";

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function clamp(value: number, minimum = 0, maximum = 100): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

export function roundSetting(value: number): number {
  return Math.round(clamp(value));
}

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return (
    typeof value === "string" &&
    (APPEARANCE_MODES as readonly string[]).includes(value)
  );
}

export function isAutoMode(value: unknown): value is AutoMode {
  return value === "globals" || value === "system";
}

export function isSitePolicy(value: unknown): value is SitePolicy {
  return value === "auto" || value === "allow" || value === "block";
}

/**
 * Looks up a site rule by own key only. Hostnames such as "constructor" are
 * valid and must not resolve to Object.prototype members.
 */
export function getSiteRule(
  preferences: DarkrPreferences,
  host: string,
): SiteRule | undefined {
  return Object.prototype.hasOwnProperty.call(preferences.sites, host)
    ? preferences.sites[host]
    : undefined;
}

/**
 * Builds a stored rule, or null when it carries nothing beyond the defaults
 * (an automatic policy with no overrides and no native-dark choice).
 */
function composeRule(
  policy: SitePolicy,
  overrides: DomainPreferences | undefined,
  overrideNativeDark: boolean | undefined,
): SiteRule | null {
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  if (policy === "auto" && !hasOverrides && overrideNativeDark === undefined) {
    return null;
  }
  return {
    policy,
    ...(hasOverrides ? { overrides } : {}),
    ...(overrideNativeDark !== undefined ? { overrideNativeDark } : {}),
  };
}

function withRule(
  preferences: DarkrPreferences,
  host: string,
  rule: SiteRule | null,
): DarkrPreferences {
  const sites = { ...preferences.sites };
  if (rule) {
    sites[host] = rule;
  } else {
    delete sites[host];
  }
  return { ...preferences, sites };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeHostname(hostname: string): string {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  if (/^\[[0-9a-f:.]+\]$/i.test(normalized)) {
    return normalized;
  }

  const withoutWwwAlias = normalized.replace(/^www\.(?=[^.]+\..+)/, "");
  if (!withoutWwwAlias || !HOSTNAME_PATTERN.test(withoutWwwAlias)) {
    return "";
  }

  return withoutWwwAlias;
}

/**
 * Exact-host matching is intentional. A setting for example.com does not leak
 * to docs.example.com or to unrelated subdomains. The leading `www.` alias is
 * normalized so www.example.com and example.com share one preference.
 */
export function hostnamePreferenceKey(input: string | URL): string {
  const hostname = input instanceof URL ? input.hostname : input;
  return normalizeHostname(hostname);
}

export function normalizeThemeConfig(
  value: unknown,
  fallback: ThemeConfig = DEFAULT_THEME_CONFIG,
): ThemeConfig {
  const candidate = isRecord(value) ? value : {};
  const normalizedNumber = (
    key: keyof Omit<ThemeConfig, "mode">,
  ): number => {
    const current = candidate[key];
    if (typeof current === "number" && Number.isFinite(current)) {
      return roundSetting(current);
    }
    return fallback[key];
  };
  return {
    mode: isAppearanceMode(candidate.mode) ? candidate.mode : fallback.mode,
    darkBackground: normalizedNumber("darkBackground"),
    darkContrast: normalizedNumber("darkContrast"),
    sepiaIntensity: normalizedNumber("sepiaIntensity"),
    grayscaleIntensity: normalizedNumber("grayscaleIntensity"),
    warmth: normalizedNumber("warmth"),
  };
}

export function normalizePreferences(value: unknown): DarkrPreferences {
  if (!isRecord(value)) {
    return cloneDefaultPreferences();
  }

  const defaults = normalizeThemeConfig(
    value.defaults,
    DEFAULT_THEME_CONFIG,
  );
  const sites: Record<string, SiteRule> = {};

  if (isRecord(value.sites)) {
    for (const [rawHost, rawConfig] of Object.entries(value.sites)) {
      const host = normalizeHostname(rawHost);
      if (!host || !isRecord(rawConfig)) {
        continue;
      }
      const rawOverrides = isRecord(rawConfig.overrides)
        ? rawConfig.overrides
        : rawConfig;
      const normalized = normalizeThemeConfig(rawOverrides, defaults);
      const overrides: DomainPreferences = {};
      for (const key of [
        "mode",
        "darkBackground",
        "darkContrast",
        "sepiaIntensity",
        "grayscaleIntensity",
        "warmth",
      ] as const) {
        if (rawOverrides[key] !== undefined) {
          overrides[key] = normalized[key] as never;
        }
      }
      const rawPolicy = rawConfig.policy;
      const policy: SitePolicy = isSitePolicy(rawPolicy) ? rawPolicy : "auto";
      const rule = composeRule(
        policy,
        overrides,
        typeof rawConfig.overrideNativeDark === "boolean"
          ? rawConfig.overrideNativeDark
          : undefined,
      );
      if (rule) {
        sites[host] = rule;
      }
    }
  }

  return {
    schemaVersion: 1,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    autoMode: isAutoMode(value.autoMode) ? value.autoMode : "globals",
    overrideNativeDark: value.overrideNativeDark === true,
    defaults,
    sites,
  };
}

export function cloneDefaultPreferences(): DarkrPreferences {
  return {
    schemaVersion: DEFAULT_PREFERENCES.schemaVersion,
    enabled: DEFAULT_PREFERENCES.enabled,
    autoMode: DEFAULT_PREFERENCES.autoMode,
    overrideNativeDark: DEFAULT_PREFERENCES.overrideNativeDark,
    defaults: { ...DEFAULT_THEME_CONFIG },
    sites: {},
  };
}

export function cloneThemeConfig(config: ThemeConfig): ThemeConfig {
  return { ...config };
}

export function themeConfigsEqual(
  left: ThemeConfig,
  right: ThemeConfig,
): boolean {
  return (
    left.mode === right.mode &&
    left.darkBackground === right.darkBackground &&
    left.darkContrast === right.darkContrast &&
    left.sepiaIntensity === right.sepiaIntensity &&
    left.grayscaleIntensity === right.grayscaleIntensity &&
    left.warmth === right.warmth
  );
}

export function themeConfigToOverrides(
  defaults: ThemeConfig,
  config: ThemeConfig,
): DomainPreferences {
  const overrides: DomainPreferences = {};
  for (const key of [
    "mode",
    "darkBackground",
    "darkContrast",
    "sepiaIntensity",
    "grayscaleIntensity",
    "warmth",
  ] as const) {
    if (config[key] !== defaults[key]) {
      overrides[key] = config[key] as never;
    }
  }
  return overrides;
}

/**
 * Decides whether a site is themed:
 * - Never: untouched.
 * - Always: themed, even while the master switch is off.
 * - Automatic: follows the master switch and, when `autoMode` is "system",
 *   only while the OS is in dark appearance.
 */
export function resolveAppearance(
  preferences: DarkrPreferences,
  hostname: string,
  environment: AppearanceEnvironment = {},
): ResolvedAppearance {
  const host = hostnamePreferenceKey(hostname);
  const rule = host ? getSiteRule(preferences, host) : undefined;
  const policy = rule?.policy ?? "auto";
  const overrides = rule?.overrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;
  const automaticallyOn =
    preferences.enabled &&
    (preferences.autoMode === "globals" || environment.systemDark !== false);
  return {
    enabled:
      policy === "block" ? false : policy === "allow" ? true : automaticallyOn,
    config: hasOverrides
      ? normalizeThemeConfig(
          { ...preferences.defaults, ...overrides },
          preferences.defaults,
        )
      : { ...preferences.defaults },
    overrideNativeDark: rule?.overrideNativeDark ?? preferences.overrideNativeDark,
    source: hasOverrides ? "site" : "defaults",
    policy,
  };
}

export function resolvedThemeConfig(
  preferences: DarkrPreferences,
  hostname: string,
): ThemeConfig {
  return resolveAppearance(preferences, hostname).config;
}

export function setSiteAppearance(
  preferences: DarkrPreferences,
  hostname: string,
  config: ThemeConfig,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  if (!host) {
    return preferences;
  }
  const existing = getSiteRule(preferences, host);
  const overrides =
    config.mode === "original"
      ? { mode: "original" as const }
      : themeConfigToOverrides(
          preferences.defaults,
          normalizeThemeConfig(config, preferences.defaults),
        );
  return withRule(
    preferences,
    host,
    composeRule(existing?.policy ?? "auto", overrides, existing?.overrideNativeDark),
  );
}

/** Drops a site's appearance overrides but keeps its policy and native-dark choice. */
export function clearSiteAppearance(
  preferences: DarkrPreferences,
  hostname: string,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  const rule = host ? getSiteRule(preferences, host) : undefined;
  if (!host || !rule) {
    return preferences;
  }
  return withRule(
    preferences,
    host,
    composeRule(rule.policy, undefined, rule.overrideNativeDark),
  );
}

export function removeSiteRule(
  preferences: DarkrPreferences,
  hostname: string,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  if (!host || !getSiteRule(preferences, host)) {
    return preferences;
  }
  return withRule(preferences, host, null);
}

export function setSitePolicy(
  preferences: DarkrPreferences,
  hostname: string,
  policy: SitePolicy,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  if (!host) {
    return preferences;
  }
  const existing = getSiteRule(preferences, host);
  return withRule(
    preferences,
    host,
    composeRule(policy, existing?.overrides, existing?.overrideNativeDark),
  );
}

export function setSiteOverride(
  preferences: DarkrPreferences,
  hostname: string,
  overrides: DomainPreferences,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  if (!host) {
    return preferences;
  }
  const existing = getSiteRule(preferences, host);
  return withRule(
    preferences,
    host,
    composeRule(existing?.policy ?? "auto", { ...overrides }, existing?.overrideNativeDark),
  );
}

/**
 * Chooses whether one site is themed over its own dark appearance. Passing
 * the global value stores nothing, so the site keeps following the global.
 */
export function setSiteNativeDarkOverride(
  preferences: DarkrPreferences,
  hostname: string,
  override: boolean,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  if (!host) {
    return preferences;
  }
  const existing = getSiteRule(preferences, host);
  const stored = override === preferences.overrideNativeDark ? undefined : override;
  return withRule(
    preferences,
    host,
    composeRule(existing?.policy ?? "auto", existing?.overrides, stored),
  );
}

export function setGlobalNativeDarkOverride(
  preferences: DarkrPreferences,
  overrideNativeDark: boolean,
): DarkrPreferences {
  return { ...preferences, overrideNativeDark };
}

export function setDefaultAppearance(
  preferences: DarkrPreferences,
  config: ThemeConfig,
): DarkrPreferences {
  return {
    ...preferences,
    defaults: normalizeThemeConfig(config, DEFAULT_THEME_CONFIG),
  };
}

export function setMasterEnabled(
  preferences: DarkrPreferences,
  enabled: boolean,
): DarkrPreferences {
  return { ...preferences, enabled };
}

export function restoreDefaultValues(
  preferences: DarkrPreferences,
): DarkrPreferences {
  return {
    ...preferences,
    defaults: { ...DEFAULT_THEME_CONFIG },
  };
}

export function clearAllSiteAppearances(
  preferences: DarkrPreferences,
): DarkrPreferences {
  return { ...preferences, sites: {} };
}

export function setAutoMode(
  preferences: DarkrPreferences,
  autoMode: AutoMode,
): DarkrPreferences {
  return { ...preferences, autoMode };
}
