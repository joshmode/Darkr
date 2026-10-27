import { describe, expect, it } from "vitest";
import {
  colorAtLuminance,
  colorForContrast,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  interpolateHex,
  parseCssColor,
  preferredTextDirection,
  relativeLuminance,
  rgb,
  rgbToCss,
  rgbToHex,
} from "../src/shared/color";

describe("colour parsing", () => {
  it("parses legacy and modern rgb syntax", () => {
    expect(parseCssColor("rgb(12, 34, 56)")).toEqual({ r: 12, g: 34, b: 56, a: 1 });
    expect(parseCssColor("rgba(12, 34, 56, 0.5)")).toEqual({ r: 12, g: 34, b: 56, a: 0.5 });
    expect(parseCssColor("rgb(12 34 56 / 50%)")).toEqual({ r: 12, g: 34, b: 56, a: 0.5 });
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("not-a-colour")).toBeNull();
  });

  it("parses short and long hex colours", () => {
    expect(hexToRgb("#fff")).toEqual(rgb(255, 255, 255));
    expect(hexToRgb("#112233")).toEqual(rgb(17, 34, 51));
    expect(hexToRgb("garbage")).toBeNull();
  });

  it("serializes opaque and translucent colours", () => {
    expect(rgbToHex(rgb(255, 0, 16))).toBe("#ff0010");
    expect(rgbToCss({ ...rgb(1, 2, 3), a: 0.42 })).toBe("rgba(1, 2, 3, 0.42)");
  });
});

describe("relative luminance and contrast", () => {
  it("matches WCAG extremes", () => {
    expect(relativeLuminance(rgb(0, 0, 0))).toBe(0);
    expect(relativeLuminance(rgb(255, 255, 255))).toBeCloseTo(1, 6);
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 4);
    expect(contrastRatio(rgb(255, 255, 255), rgb(255, 255, 255))).toBe(1);
  });

  it("chooses a directional text palette from the background", () => {
    expect(preferredTextDirection(rgb(16, 17, 19))).toBe("light");
    expect(preferredTextDirection(rgb(242, 239, 233))).toBe("dark");
  });

  it("adjusts a colour toward a requested luminance", () => {
    const result = colorAtLuminance(rgb(250, 250, 250), 0.1);
    expect(relativeLuminance(result)).toBeCloseTo(0.1, 2);
  });

  it("honours a requested contrast direction", () => {
    const background = rgb(28, 30, 34);
    const text = colorForContrast(rgb(120, 130, 150), background, 7, "light");
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(6.8);
    expect(text.r).toBeGreaterThan(background.r);
    expect(relativeLuminance(text)).toBeGreaterThan(relativeLuminance(background));
  });

  it("leaves an already accessible colour unchanged and repairs a failing one", () => {
    const background = rgb(245, 240, 232);
    const strong = rgb(30, 27, 22);
    expect(ensureContrast(strong, background, 4.5)).toBe(strong);
    expect(contrastRatio(ensureContrast(rgb(170, 168, 162), background, 4.5), background)).toBeGreaterThanOrEqual(4.45);
  });

  it("interpolates anchored colours", () => {
    expect(interpolateHex("#000000", "#ffffff", 0.5)).toEqual(rgb(128, 128, 128));
  });
});

describe("modern computed colour spaces", () => {
  const near = (value: string, expected: [number, number, number], tolerance = 3) => {
    const parsed = parseCssColor(value);
    expect(parsed, value).not.toBeNull();
    if (!parsed) return;
    expect(Math.abs(parsed.r - expected[0]), `${value} r=${parsed.r}`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(parsed.g - expected[1]), `${value} g=${parsed.g}`).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(parsed.b - expected[2]), `${value} b=${parsed.b}`).toBeLessThanOrEqual(tolerance);
  };

  it("parses oklch and oklab", () => {
    near("oklch(1 0 0)", [255, 255, 255]);
    near("oklch(0 0 0)", [0, 0, 0]);
    near("oklch(0.985 0 0)", [250, 250, 250]);
    near("oklab(0.628 0.2249 0.1258)", [255, 0, 0]);
    near("oklch(62.8% 0.2577 29.23)", [255, 0, 0]);
  });

  it("parses lab and lch", () => {
    near("lab(100 0 0)", [255, 255, 255]);
    near("lab(54.29 80.8 69.89)", [255, 0, 0], 3);
    near("lch(100 0 0)", [255, 255, 255]);
  });

  it("parses the color() function", () => {
    near("color(srgb 1 0.5 0)", [255, 128, 0]);
    near("color(srgb-linear 1 1 1)", [255, 255, 255]);
    near("color(display-p3 1 1 1)", [255, 255, 255]);
    near("color(display-p3 0 0 0)", [0, 0, 0]);
  });

  it("keeps alpha and rejects malformed or unknown spaces", () => {
    expect(parseCssColor("oklch(0.5 0.1 200 / 40%)")?.a).toBeCloseTo(0.4);
    expect(parseCssColor("color(srgb 1 1 1 / 0.25)")?.a).toBeCloseTo(0.25);
    expect(parseCssColor("color(rec2020 1 1 1)")).toBeNull();
    expect(parseCssColor("oklch(abc)")).toBeNull();
    expect(parseCssColor("#ffffff80")?.a).toBeCloseTo(0.5, 1);
  });
});
