export const APPEARANCE_MODES = [
  "original",
  "dark",
  "sepia",
  "grayscale",
  "warm",
] as const;

export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export interface ThemeConfig {
  mode: AppearanceMode;
  /**
   * 0 is true OLED black and 100 is a light neutral grey in Dark mode.
   */
  darkBackground: number;
  /**
   * 0 favours softer separation; 100 favours maximum legibility.
   */
  darkContrast: number;
  sepiaIntensity: number;
  grayscaleIntensity: number;
  warmth: number;
}

export type DomainPreferences = Partial<ThemeConfig>;

export type SitePolicy = "auto" | "allow" | "block";

export interface SiteRule {
  policy: SitePolicy;
  overrides?: DomainPreferences;
  /**
   * Theme this site even though it already has its own dark appearance.
   * Unset follows the global `overrideNativeDark` setting.
   */
  overrideNativeDark?: boolean;
}

/**
 * How sites on the "Automatic" policy decide whether to be themed:
 * "globals" follows the master on/off switch; "system" additionally themes
 * only while the operating system is in its dark appearance.
 */
export type AutoMode = "globals" | "system";

export interface DarkrPreferences {
  schemaVersion: 1;
  /** Master switch. "Always" sites are themed even while this is off. */
  enabled: boolean;
  autoMode: AutoMode;
  /** Theme every site, including those with their own dark appearance. */
  overrideNativeDark: boolean;
  defaults: ThemeConfig;
  /** Exact lowercase hostname to configuration. Subdomains are independent. */
  sites: Record<string, SiteRule>;
}

export type PreferenceSource = "site" | "defaults";

export interface AppearanceEnvironment {
  /** Whether the OS is currently in dark appearance. Unknown counts as dark. */
  systemDark?: boolean;
}

export interface ResolvedAppearance {
  enabled: boolean;
  config: ThemeConfig;
  /** Whether a site's own dark appearance should be themed over anyway. */
  overrideNativeDark: boolean;
  source: PreferenceSource;
  policy: SitePolicy;
}

export const DEFAULT_THEME_CONFIG: Readonly<ThemeConfig> = Object.freeze({
  mode: "dark",
  darkBackground: 12,
  darkContrast: 62,
  sepiaIntensity: 58,
  grayscaleIntensity: 100,
  warmth: 35,
});

export const DEFAULT_PREFERENCES: Readonly<DarkrPreferences> = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  autoMode: "globals",
  overrideNativeDark: false,
  defaults: { ...DEFAULT_THEME_CONFIG },
  sites: {},
});

export const MODE_LABELS: Readonly<Record<AppearanceMode, string>> = {
  original: "Original",
  dark: "Dark",
  sepia: "Sepia",
  grayscale: "Grayscale",
  warm: "Warm Light",
};
