import {
  clampChannel,
  colorForContrast,
  contrastRatio,
  ensureContrast,
  hexToRgb,
  mixRgb,
  parseCssColor,
  preferredTextDirection,
  relativeLuminance,
  rgb,
  rgbToCss,
  type Rgb,
  type Rgba,
} from "../shared/color";
import type { ThemeTokens } from "../shared/theme";

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl(color: Rgb): Hsl {
  const red = color.r / 255;
  const green = color.g / 255;
  const blue = color.b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;

  if (maximum === minimum) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = maximum - minimum;
  const saturation =
    lightness > 0.5
      ? delta / (2 - maximum - minimum)
      : delta / (maximum + minimum);

  let hue: number;
  if (maximum === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (maximum === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return { h: hue * 60, s: saturation, l: lightness };
}

function hueToRgb(p: number, q: number, input: number): number {
  let t = input;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    return rgb(l * 255, l * 255, l * 255);
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgb(
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255,
  );
}

function tintedDarkSurface(original: Rgba, tokens: ThemeTokens): Rgb {
  const hsl = rgbToHsl(original);
  if (hsl.s < 0.14) {
    const luminance = relativeLuminance(original);
    if (luminance > 0.72) {
      return mixRgb(tokens.background, tokens.text, 0.045);
    }
    if (luminance < 0.13) {
      return mixRgb(tokens.background, original, 0.18);
    }
    return mixRgb(tokens.background, tokens.text, 0.025);
  }

  // Preserve the hue and a reduced amount of saturation of accent surfaces.
  // Converting every coloured card to the same grey is what makes badges,
  // alerts, and controls feel disconnected from the page.
  const lightness = Math.min(
    0.34,
    0.055 + hsl.l * 0.14 + (hsl.s > 0.5 ? 0.03 : 0),
  );
  const tint = hslToRgb({
    h: hsl.h,
    s: Math.min(0.52, Math.max(0.2, hsl.s * 0.62)),
    l: lightness,
  });
  return mixRgb(tokens.background, tint, 0.68);
}

function tintedLightSurface(original: Rgba, tokens: ThemeTokens): Rgb {
  const hsl = rgbToHsl(original);
  if (hsl.s > 0.23) {
    // Keep meaningful accent surfaces intact. Warmth should shift neutral
    // reading surfaces, not indiscriminately tint controls and images.
    return mixRgb(original, tokens.background, 0.06);
  }

  const luminance = relativeLuminance(original);
  if (luminance > 0.55) {
    return mixRgb(tokens.background, original, 0.16);
  }
  return mixRgb(tokens.background, original, 0.1);
}

export function mapSurfaceColor(
  original: Rgba,
  tokens: ThemeTokens,
): string {
  const mapped =
    tokens.scheme === "dark"
      ? tintedDarkSurface(original, tokens)
      : tintedLightSurface(original, tokens);
  return rgbToCss(mapped);
}

function textContrastTarget(
  original: Rgb,
  tokens: ThemeTokens,
): number {
  const luminance = relativeLuminance(original);
  if (luminance >= 0.48) {
    return tokens.primaryContrast;
  }
  if (luminance >= 0.18) {
    return Math.max(4.8, tokens.primaryContrast * 0.82);
  }
  return Math.max(4.5, tokens.primaryContrast * 0.7);
}

export function mapTextColor(
  original: Rgba,
  surface: Rgb,
  tokens: ThemeTokens,
): string {
  const direction = preferredTextDirection(surface);
  const target = textContrastTarget(original, tokens);
  const hsl = rgbToHsl(original);
  const saturated =
    hsl.s > 0.18
      ? hslToRgb({
          h: hsl.h,
          s: Math.min(0.72, hsl.s * 0.72),
          l: Math.max(0.62, Math.min(0.84, hsl.l)),
        })
      : original;
  const mapped = colorForContrast(saturated, surface, target, direction);
  return rgbToCss(
    ensureContrast(mapped, surface, Math.max(4.5, target * 0.93), direction),
  );
}

export function mapBorderColor(
  original: Rgba,
  surface: Rgb,
  tokens: ThemeTokens,
): string {
  const originalLuminance = relativeLuminance(original);
  const base =
    originalLuminance > 0.5
      ? tokens.border
      : mixRgb(tokens.border, original, 0.16);
  const blended = mixRgb(base, surface, 0.04);
  return rgbToCss(blended);
}

export function parseColorOrNull(value: string): Rgba | null {
  return parseCssColor(value);
}

export function opaqueColor(value: string): Rgba | null {
  const parsed = parseCssColor(value);
  return parsed && parsed.a >= 0.82 ? parsed : null;
}

export function isNeutralColor(color: Rgba): boolean {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  return maximum - minimum < 12;
}

export function safeHex(value: Rgba): string {
  return rgbToCss(rgb(clampChannel(value.r), clampChannel(value.g), clampChannel(value.b)));
}

export function contrastSummary(
  foreground: Rgb,
  background: Rgb,
): number {
  return Number(contrastRatio(foreground, background).toFixed(2));
}

export function fallbackSurface(): Rgb {
  return hexToRgb("#17181b") ?? rgb(23, 24, 27);
}
