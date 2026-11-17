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

// Underscores occur in real hostnames (CI previews, internal services) and
// browsers load them, so they are accepted inside labels.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

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
  return typeof value === "string" && (APPEARANCE_MODES as readonly string[]).includes(value);
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
/**
 * The rule that governs `host`: its own exact rule, otherwise the nearest
 * parent domain whose rule opted in with `includeSubdomains`. Hostnames that
 * are addresses (IPv4, IPv6) have no parents.
 */
export function matchSiteRule(preferences: DarkrPreferences, host: string): SiteRule | undefined {
  const exact = getSiteRule(preferences, host);
  if (exact || host.startsWith("[") || /^[\d.]+$/.test(host)) {
    return exact;
  }
  const labels = host.split(".");
  for (let start = 1; start < labels.length - 1; start += 1) {
    const rule = getSiteRule(preferences, labels.slice(start).join("."));
    if (rule?.includeSubdomains) {
      return rule;
    }
  }
  return undefined;
}

/** Sets or clears the "include subdomains" flag of an existing rule. */
export function setSiteIncludeSubdomains(
  preferences: DarkrPreferences,
  hostname: string,
  include: boolean,
): DarkrPreferences {
  const host = hostnamePreferenceKey(hostname);
  const existing = host ? getSiteRule(preferences, host) : undefined;
  if (!host || !existing) {
    return preferences;
  }
  return withRule(preferences, host, {
    ...existing,
    includeSubdomains: include || undefined,
  } as SiteRule);
}

export function getSiteRule(preferences: DarkrPreferences, host: string): SiteRule | undefined {
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
  includeSubdomains?: boolean,
): SiteRule | null {
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  if (policy === "auto" && !hasOverrides && overrideNativeDark === undefined) {
    return null;
  }
  return {
    policy,
    ...(includeSubdomains ? { includeSubdomains: true } : {}),
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
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");

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
  const normalizedNumber = (key: keyof Omit<ThemeConfig, "mode">): number => {
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

/** Current stored schema. Bump together with a new entry in MIGRATIONS. */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Upgrades stored data one version at a time. `MIGRATIONS[n]` turns a version-n
 * payload into version n+1. Empty while version 1 is the only schema; stored
 * payloads without a version are treated as version 1.
 */
const MIGRATIONS: Record<number, (stored: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: "Original" stops being a mode. A global default of Original
  // becomes the master switch off; a site whose mode was Original becomes Never.
  1: (stored) => {
    const next: Record<string, unknown> = { ...stored, schemaVersion: 2 };
    if (isRecord(stored.defaults) && stored.defaults.mode === "original") {
      next.enabled = false;
      next.defaults = { ...stored.defaults, mode: DEFAULT_THEME_CONFIG.mode };
    }
    if (isRecord(stored.sites)) {
      const sites: Record<string, unknown> = {};
      for (const [host, rule] of Object.entries(stored.sites)) {
        if (!isRecord(rule)) {
          sites[host] = rule;
          continue;
        }
        const nested = isRecord(rule.overrides) ? rule.overrides : null;
        const source = nested ?? rule;
        if (source.mode !== "original") {
          sites[host] = rule;
          continue;
        }
        const { mode: _dropped, ...rest } = source;
        sites[host] = nested
          ? { ...rule, policy: "block", overrides: rest }
          : { ...rest, policy: "block" };
      }
      next.sites = sites;
    }
    return next;
  },
};

function migratePreferences(stored: Record<string, unknown>): Record<string, unknown> {
  let version = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 1;
  let current = stored;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      break;
    }
    current = migrate(current);
    version += 1;
  }
  return current;
}

export function normalizePreferences(input: unknown): DarkrPreferences {
  if (!isRecord(input)) {
    return cloneDefaultPreferences();
  }
  const value = migratePreferences(input);

  const defaults = normalizeThemeConfig(value.defaults, DEFAULT_THEME_CONFIG);
  const sites: Record<string, SiteRule> = {};

  if (isRecord(value.sites)) {
    for (const [rawHost, rawConfig] of Object.entries(value.sites)) {
      const host = normalizeHostname(rawHost);
      if (!host || !isRecord(rawConfig)) {
        continue;
      }
      const rawOverrides = isRecord(rawConfig.overrides) ? rawConfig.overrides : rawConfig;
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
        rawConfig.includeSubdomains === true,
      );
      if (rule) {
        sites[host] = rule;
      }
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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

export function themeConfigsEqual(left: ThemeConfig, right: ThemeConfig): boolean {
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
  const rule = host ? matchSiteRule(preferences, host) : undefined;
  const policy = rule?.policy ?? "auto";
  const overrides = rule?.overrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;
  const automaticallyOn =
    preferences.enabled && (preferences.autoMode === "globals" || environment.systemDark !== false);
  return {
    enabled: policy === "block" ? false : policy === "allow" ? true : automaticallyOn,
    config: hasOverrides
      ? normalizeThemeConfig({ ...preferences.defaults, ...overrides }, preferences.defaults)
      : { ...preferences.defaults },
    overrideNativeDark: rule?.overrideNativeDark ?? preferences.overrideNativeDark,
    source: hasOverrides ? "site" : "defaults",
    policy,
  };
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
    composeRule(
      existing?.policy ?? "auto",
      overrides,
      existing?.overrideNativeDark,
      existing?.includeSubdomains,
    ),
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
    composeRule(rule.policy, undefined, rule.overrideNativeDark, rule.includeSubdomains),
  );
}

export function removeSiteRule(preferences: DarkrPreferences, hostname: string): DarkrPreferences {
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
    composeRule(
      policy,
      existing?.overrides,
      existing?.overrideNativeDark,
      existing?.includeSubdomains,
    ),
  );
}

/**
 * Chooses whether one site is themed over its own dark appearance. Passing
 * the global value stores nothing, so the site keeps following the global.
 */
/**
 * Flips Darkr on or off for one site. Off is the "Never" policy. On prefers
 * "Automatic" and falls back to "Always" when pausing or the system appearance
 * would otherwise keep the site unthemed.
 */
export function toggleSiteEnabled(
  preferences: DarkrPreferences,
  hostname: string,
  environment: AppearanceEnvironment = {},
): DarkrPreferences {
  if (resolveAppearance(preferences, hostname, environment).enabled) {
    return setSitePolicy(preferences, hostname, "block");
  }
  const automatic = setSitePolicy(preferences, hostname, "auto");
  return resolveAppearance(automatic, hostname, environment).enabled
    ? automatic
    : setSitePolicy(preferences, hostname, "allow");
}

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
    composeRule(
      existing?.policy ?? "auto",
      existing?.overrides,
      stored,
      existing?.includeSubdomains,
    ),
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

export function restoreDefaultValues(preferences: DarkrPreferences): DarkrPreferences {
  return {
    ...preferences,
    defaults: { ...DEFAULT_THEME_CONFIG },
  };
}

export function clearAllSiteAppearances(preferences: DarkrPreferences): DarkrPreferences {
  return { ...preferences, sites: {} };
}

export function setAutoMode(preferences: DarkrPreferences, autoMode: AutoMode): DarkrPreferences {
  return { ...preferences, autoMode };
}
