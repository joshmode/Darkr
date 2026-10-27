import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, relativeLuminance } from "../src/shared/color";
import {
  buildThemeTokens,
  contrastDescription,
  darknessDescription,
  themeVariables,
  tokenContrastSummary,
  warmthDescription,
} from "../src/shared/theme";
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from "../src/shared/types";

function config(overrides: Partial<ThemeConfig>): ThemeConfig {
  return { ...DEFAULT_THEME_CONFIG, ...overrides };
}

describe("semantic theme tokens", () => {
  it("returns no tokens for Original", () => {
    expect(buildThemeTokens(config({ mode: "original" }))).toBeNull();
  });

  it("builds a dark charcoal default with readable text", () => {
    const tokens = buildThemeTokens(config({ mode: "dark", darkBackground: 20 }));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    expect(relativeLuminance(tokens.background)).toBeGreaterThan(0.01);
    expect(relativeLuminance(tokens.background)).toBeLessThan(0.08);
    expect(tokens.background.b).toBeGreaterThan(tokens.background.r);
    expect(tokens.text.r).toBeGreaterThan(tokens.text.b);
    const summary = tokenContrastSummary(tokens);
    expect(summary.text).toBeGreaterThanOrEqual(4.5);
    expect(summary.muted).toBeGreaterThanOrEqual(4.4);
    expect(summary.link).toBeGreaterThanOrEqual(4.5);
  });

  it("moves toward light grey at the background slider maximum", () => {
    const nearBlack = buildThemeTokens(config({ mode: "dark", darkBackground: 0 }));
    const lightGrey = buildThemeTokens(config({ mode: "dark", darkBackground: 100 }));
    expect(nearBlack).not.toBeNull();
    expect(lightGrey).not.toBeNull();
    if (!nearBlack || !lightGrey) return;
    expect(relativeLuminance(lightGrey.background)).toBeGreaterThan(relativeLuminance(nearBlack.background) + 0.2);
    expect(lightGrey.direction).toBe("dark");
    expect(contrastRatio(lightGrey.text, lightGrey.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps text contrast across the entire dark range", () => {
    for (let bg = 0; bg <= 100; bg += 5) {
      for (let contrast = 0; contrast <= 100; contrast += 10) {
        const tokens = buildThemeTokens(config({ mode: "dark", darkBackground: bg, darkContrast: contrast }));
        expect(tokens).not.toBeNull();
        if (!tokens) continue;
        expect(contrastRatio(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.45);
        expect(contrastRatio(tokens.muted, tokens.background)).toBeGreaterThanOrEqual(4.4);
        expect(contrastRatio(tokens.link, tokens.background)).toBeGreaterThanOrEqual(4.45);
      }
    }
  });

  it("builds a warm light palette without darkening neutral surfaces", () => {
    const tokens = buildThemeTokens(config({ mode: "warm", warmth: 35 }));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    expect(tokens.scheme).toBe("light");
    expect(relativeLuminance(tokens.background)).toBeGreaterThan(0.6);
    expect(tokens.background.r).toBeGreaterThan(tokens.background.b);
    expect(contrastRatio(tokens.text, tokens.background)).toBeGreaterThanOrEqual(7);
    expect(tokens.direction).toBe("dark");
  });

  it("strengthens sepia as intensity rises", () => {
    const subtle = buildThemeTokens(config({ mode: "sepia", sepiaIntensity: 10 }));
    const strong = buildThemeTokens(config({ mode: "sepia", sepiaIntensity: 95 }));
    expect(subtle).not.toBeNull();
    expect(strong).not.toBeNull();
    if (!subtle || !strong) return;
    expect(relativeLuminance(strong.background)).toBeLessThan(relativeLuminance(subtle.background));
    expect(strong.background.b).toBeLessThan(subtle.background.b);
    expect(contrastRatio(strong.text, strong.background)).toBeGreaterThanOrEqual(7);
  });

  it("builds grayscale as a filter-only token with no semantic surface", () => {
    const tokens = buildThemeTokens(config({ mode: "grayscale", grayscaleIntensity: 100 }));
    expect(tokens?.isSemantic).toBe(false);
    expect(tokens?.scheme).toBe("normal");
    expect(tokens?.grayscale).toBe(1);
    expect(buildThemeTokens(config({ mode: "grayscale", grayscaleIntensity: 0 }))).toBeNull();
  });

  it("serializes all expected CSS variables", () => {
    const tokens = buildThemeTokens(config({ mode: "dark" }));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    const variables = themeVariables(tokens);
    expect(variables["--darkr-bg"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables["--darkr-scheme"]).toBe("dark");
    expect(variables["--darkr-grayscale"]).toBe("0");
  });

  it("provides user-facing value descriptions", () => {
    expect(darknessDescription(4)).toBe("Near black");
    expect(darknessDescription(20)).toBe("Charcoal");
    expect(contrastDescription(20)).toBe("Soft");
    expect(warmthDescription(10)).toBe("Subtle");
    expect(warmthDescription(90)).toBe("Warm ivory");
  });

  it("supports a true black OLED endpoint", () => {
    const tokens = buildThemeTokens(config({ mode: "dark", darkBackground: 0 }));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    expect(tokens.background).toEqual({ r: 0, g: 0, b: 0 });
    expect(tokens.raised.r + tokens.raised.g + tokens.raised.b).toBeGreaterThan(0);
    expect(tokens.raised.r + tokens.raised.g + tokens.raised.b).toBeLessThan(90);
    expect(contrastRatio(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("anchors near-black and light-grey endpoints to the intended tone", () => {
    const black = hexToRgb("#09090b");
    const grey = hexToRgb("#a4a5aa");
    expect(black).not.toBeNull();
    expect(grey).not.toBeNull();
  });
});
