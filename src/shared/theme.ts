import {
  colorForContrast,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  interpolateHex,
  mixRgb,
  preferredTextDirection,
  rgb,
  rgbToCss,
  type Rgb,
  type TextDirection,
} from "./color";
import { clamp } from "./config";
import type { ThemeConfig } from "./types";

export interface ThemeTokens {
  mode: Exclude<ThemeConfig["mode"], "original">;
  isSemantic: boolean;
  scheme: "dark" | "light" | "normal";
  background: Rgb;
  raised: Rgb;
  sunken: Rgb;
  text: Rgb;
  muted: Rgb;
  border: Rgb;
  link: Rgb;
  visited: Rgb;
  inputBackground: Rgb;
  inputText: Rgb;
  codeBackground: Rgb;
  codeText: Rgb;
  selection: Rgb;
  direction: TextDirection;
  primaryContrast: number;
  grayscale: number;
}

const DARK_BACKGROUND_ANCHORS: ReadonlyArray<{
  position: number;
  color: string;
}> = [
  { position: 0, color: "#000000" },
  { position: 3, color: "#030303" },
  { position: 12, color: "#151619" },
  { position: 28, color: "#242529" },
  { position: 50, color: "#48494e" },
  { position: 72, color: "#74757b" },
  { position: 100, color: "#a4a5aa" },
];

const OFF_WHITE = rgb(247, 244, 237);
const WARM_BLACK = rgb(34, 27, 21);
const COOL_BLACK = rgb(25, 27, 30);

function backgroundForDarkness(value: number): Rgb {
  const position = clamp(value);
  for (let index = 0; index < DARK_BACKGROUND_ANCHORS.length - 1; index += 1) {
    const start = DARK_BACKGROUND_ANCHORS[index];
    const end = DARK_BACKGROUND_ANCHORS[index + 1];
    if (!start || !end) {
      continue;
    }
    if (position >= start.position && position <= end.position) {
      const span = end.position - start.position;
      const amount = span === 0 ? 0 : (position - start.position) / span;
      return interpolateHex(start.color, end.color, amount);
    }
  }
  return hexToRgb(DARK_BACKGROUND_ANCHORS.at(-1)?.color ?? "#a4a5aa") ?? rgb(
    164,
    165,
    170,
  );
}

function primaryContrastForSetting(value: number): number {
  return 4.6 + (clamp(value) / 100) * 12.4;
}

function secondaryTarget(primaryContrast: number): number {
  return Math.min(primaryContrast - 0.15, Math.max(4.5, primaryContrast * 0.66));
}

function textBaseForDirection(direction: TextDirection): Rgb {
  return direction === "light" ? OFF_WHITE : WARM_BLACK;
}

function buildSemanticTokens(
  mode: "dark" | "sepia" | "warm",
  background: Rgb,
  primaryContrast: number,
  scheme: "dark" | "light",
): ThemeTokens {
  const direction = preferredTextDirection(background);
  const textBase = textBaseForDirection(direction);
  const text = colorForContrast(
    textBase,
    background,
    primaryContrast,
    direction,
  );
  const muted = colorForContrast(
    mixRgb(text, background, 0.25),
    background,
    secondaryTarget(primaryContrast),
    direction,
  );
  const isLightSurface = scheme === "light";
  const raised = mixRgb(background, text, isLightSurface ? 0.035 : 0.055);
  const sunken = mixRgb(
    background,
    isLightSurface ? rgb(255, 252, 244) : rgb(0, 0, 0),
    isLightSurface ? 0.35 : 0.14,
  );
  const border = mixRgb(background, text, isLightSurface ? 0.2 : 0.16);
  const inputBackground = mixRgb(background, text, isLightSurface ? 0.045 : 0.07);
  const codeBackground = mixRgb(background, text, isLightSurface ? 0.06 : 0.085);
  const accentBase =
    mode === "warm"
      ? rgb(35, 92, 128)
      : mode === "sepia"
        ? rgb(125, 72, 38)
        : direction === "light"
          ? rgb(132, 174, 246)
          : rgb(31, 88, 153);
  const linkTarget = Math.max(4.6, Math.min(primaryContrast, 8.5));
  const link = ensureContrast(accentBase, background, linkTarget, direction);
  const visitedBase =
    mode === "dark"
      ? rgb(191, 154, 235)
      : mode === "sepia"
        ? rgb(107, 58, 91)
        : rgb(101, 66, 122);
  const visited = ensureContrast(visitedBase, background, linkTarget, direction);
  const selection =
    mode === "dark"
      ? mixRgb(direction === "light" ? rgb(72, 100, 140) : rgb(43, 77, 113), background, 0.2)
      : mixRgb(rgb(222, 184, 118), background, 0.2);
  const codeText = direction === "light" ? rgb(231, 225, 210) : rgb(49, 36, 24);

  return {
    mode,
    isSemantic: true,
    scheme,
    background,
    raised,
    sunken,
    text,
    muted,
    border,
    link,
    visited,
    inputBackground,
    inputText: colorForContrast(
      textBase,
      inputBackground,
      Math.max(4.6, primaryContrast - 1),
      preferredTextDirection(inputBackground),
    ),
    codeBackground,
    codeText: ensureContrast(
      codeText,
      codeBackground,
      Math.max(4.6, primaryContrast - 1),
      preferredTextDirection(codeBackground),
    ),
    selection,
    direction,
    primaryContrast,
    grayscale: 0,
  };
}

function buildDarkTokens(config: ThemeConfig): ThemeTokens {
  const background = backgroundForDarkness(config.darkBackground);
  const tokens = buildSemanticTokens(
    "dark",
    background,
    primaryContrastForSetting(config.darkContrast),
    "dark",
  );
  // OLED black should stay black on flat surfaces while raised elements remain
  // distinguishable for controls, inputs, and cards.
  if (config.darkBackground <= 3) {
    tokens.raised = mixRgb(background, tokens.text, 0.045);
    tokens.sunken = background;
    tokens.border = mixRgb(background, tokens.text, 0.11);
    tokens.inputBackground = mixRgb(background, tokens.text, 0.055);
    tokens.codeBackground = mixRgb(background, tokens.text, 0.07);
  }
  return tokens;
}

function buildSepiaTokens(config: ThemeConfig): ThemeTokens {
  const intensity = clamp(config.sepiaIntensity) / 100;
  const background = interpolateHex("#fffdf7", "#e7cfaa", intensity);
  const tokens = buildSemanticTokens(
    "sepia",
    background,
    Math.max(7.5, primaryContrastForSetting(config.darkContrast) - 2.4),
    "light",
  );
  tokens.text = ensureContrast(rgb(61, 46, 33), background, 8.2, "dark");
  tokens.muted = ensureContrast(rgb(99, 79, 61), background, 4.6, "dark");
  tokens.codeText = tokens.text;
  return tokens;
}

function buildWarmTokens(config: ThemeConfig): ThemeTokens {
  const warmth = clamp(config.warmth) / 100;
  const background = interpolateHex("#ffffff", "#f2d8aa", warmth * 0.86);
  const tokens = buildSemanticTokens(
    "warm",
    background,
    Math.max(8, primaryContrastForSetting(config.darkContrast) - 2),
    "light",
  );
  const warmText = mixRgb(rgb(23, 22, 20), rgb(67, 42, 20), warmth * 0.72);
  tokens.text = ensureContrast(warmText, background, 8.5, "dark");
  tokens.muted = ensureContrast(
    mixRgb(warmText, background, 0.38),
    background,
    4.6,
    "dark",
  );
  tokens.codeText = tokens.text;
  return tokens;
}

function buildGrayscaleTokens(config: ThemeConfig): ThemeTokens {
  const neutral = rgb(128, 128, 128);
  return {
    mode: "grayscale",
    isSemantic: false,
    scheme: "normal",
    background: neutral,
    raised: neutral,
    sunken: neutral,
    text: neutral,
    muted: neutral,
    border: neutral,
    link: neutral,
    visited: neutral,
    inputBackground: neutral,
    inputText: neutral,
    codeBackground: neutral,
    codeText: neutral,
    selection: neutral,
    direction: "light",
    primaryContrast: 1,
    grayscale: clamp(config.grayscaleIntensity) / 100,
  };
}

export function buildThemeTokens(config: ThemeConfig): ThemeTokens | null {
  if (config.mode === "original") {
    return null;
  }
  if (config.mode === "grayscale") {
    if (config.grayscaleIntensity <= 0) {
      return null;
    }
    return buildGrayscaleTokens(config);
  }
  if (config.mode === "warm" && config.warmth <= 0) {
    return null;
  }
  if (config.mode === "sepia" && config.sepiaIntensity <= 0) {
    return null;
  }
  if (config.mode === "dark") {
    return buildDarkTokens(config);
  }
  if (config.mode === "sepia") {
    return buildSepiaTokens(config);
  }
  return buildWarmTokens(config);
}

export function themeVariables(tokens: ThemeTokens): Record<string, string> {
  return {
    "--darkr-bg": rgbToCss(tokens.background),
    "--darkr-raised": rgbToCss(tokens.raised),
    "--darkr-sunken": rgbToCss(tokens.sunken),
    "--darkr-text": rgbToCss(tokens.text),
    "--darkr-muted": rgbToCss(tokens.muted),
    "--darkr-border": rgbToCss(tokens.border),
    "--darkr-link": rgbToCss(tokens.link),
    "--darkr-visited": rgbToCss(tokens.visited),
    "--darkr-input-bg": rgbToCss(tokens.inputBackground),
    "--darkr-input-text": rgbToCss(tokens.inputText),
    "--darkr-code-bg": rgbToCss(tokens.codeBackground),
    "--darkr-code-text": rgbToCss(tokens.codeText),
    "--darkr-selection": rgbToCss(tokens.selection),
    "--darkr-scheme": tokens.scheme,
    "--darkr-grayscale": String(tokens.grayscale),
  };
}

export function tokenContrastSummary(tokens: ThemeTokens): {
  text: number;
  muted: number;
  link: number;
} {
  return {
    text: contrastRatio(tokens.text, tokens.background),
    muted: contrastRatio(tokens.muted, tokens.background),
    link: contrastRatio(tokens.link, tokens.background),
  };
}

export function warmthDescription(value: number): string {
  if (value <= 5) return "Original";
  if (value < 35) return "Subtle";
  if (value < 70) return "Creamy";
  return "Warm ivory";
}

export function darknessDescription(value: number): string {
  if (value <= 3) return "OLED black";
  if (value < 18) return "Near black";
  if (value < 45) return "Charcoal";
  if (value < 72) return "Dark grey";
  return "Light grey";
}

export function contrastDescription(value: number): string {
  if (value < 30) return "Soft";
  if (value < 70) return "Balanced";
  return "High";
}
