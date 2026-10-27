export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function rgb(r: number, g: number, b: number): Rgb {
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

export function rgbToHex(color: Rgb): string {
  const channel = (value: number) =>
    clampChannel(value).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function rgbToCss(color: Rgba | Rgb): string {
  if ("a" in color && color.a < 0.999) {
    const alpha = Math.max(0, Math.min(1, color.a));
    return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${Number(alpha.toFixed(3))})`;
  }
  return rgbToHex(color);
}

export function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, "");
  if (![3, 6, 8].includes(value.length)) {
    return null;
  }

  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value.slice(0, 6);

  if (!/^[\da-f]{6}$/i.test(expanded)) {
    return null;
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * Parses the forms Safari returns from getComputedStyle. Legacy comma syntax,
 * modern space syntax, hex, and named transparent are supported.
 */
export function parseCssColor(value: string): Rgba | null {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "none"
  ) {
    return null;
  }

  if (normalized.startsWith("#")) {
    const parsed = hexToRgb(normalized);
    if (!parsed) {
      return null;
    }
    const digits = normalized.slice(1);
    const alpha =
      digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { ...parsed, a: alpha };
  }

  const modern = parseModernColor(normalized);
  if (modern) {
    return modern;
  }

  const rgbMatch = normalized.match(
    /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*(?:,|\/)\s*([\d.]+%?))?\s*\)$/,
  );
  if (!rgbMatch) {
    return null;
  }

  const [, red = "0", green = "0", blue = "0", alpha] = rgbMatch;
  const parsedAlpha = alpha
    ? alpha.endsWith("%")
      ? Number.parseFloat(alpha) / 100
      : Number.parseFloat(alpha)
    : 1;

  return {
    r: clampChannel(Number.parseFloat(red)),
    g: clampChannel(Number.parseFloat(green)),
    b: clampChannel(Number.parseFloat(blue)),
    a: Number.isFinite(parsedAlpha) ? Math.max(0, Math.min(1, parsedAlpha)) : 1,
  };
}

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

function multiply(matrix: Matrix, v: readonly [number, number, number]): [number, number, number] {
  return [
    matrix[0] * v[0] + matrix[1] * v[1] + matrix[2] * v[2],
    matrix[3] * v[0] + matrix[4] * v[1] + matrix[5] * v[2],
    matrix[6] * v[0] + matrix[7] * v[1] + matrix[8] * v[2],
  ];
}

const XYZ_D65_TO_LINEAR_SRGB: Matrix = [
  3.2409699419, -1.5373831776, -0.4986107603,
  -0.9692436363, 1.8759675015, 0.0415550574,
  0.0556300797, -0.2039769589, 1.0569715142,
];
const XYZ_D50_TO_D65: Matrix = [
  0.9555766, -0.0230393, 0.0631636,
  -0.0282895, 1.0099416, 0.0210077,
  0.0122982, -0.020483, 1.3299098,
];
const LINEAR_P3_TO_XYZ_D65: Matrix = [
  0.4865709486, 0.2656676932, 0.1982172852,
  0.2289745641, 0.6917385218, 0.0792869141,
  0, 0.0451133819, 1.0439443689,
];

function linearSrgbToRgb(linear: readonly [number, number, number], a: number): Rgba {
  // Out-of-gamut colours are clipped; page colours only need to be close.
  return {
    r: clampChannel(linearToSrgb(linear[0])),
    g: clampChannel(linearToSrgb(linear[1])),
    b: clampChannel(linearToSrgb(linear[2])),
    a,
  };
}

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function labToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > epsilon ? fx ** 3 : (116 * fx - 16) / kappa;
  const y = L > kappa * epsilon ? fy ** 3 : L / kappa;
  const z = fz ** 3 > epsilon ? fz ** 3 : (116 * fz - 16) / kappa;
  const d50: [number, number, number] = [x * 0.96422, y, z * 0.82521];
  return multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(XYZ_D50_TO_D65, d50));
}

function parseAngle(token: string): number {
  const value = Number.parseFloat(token);
  if (token.endsWith("grad")) return value * 0.9;
  if (token.endsWith("rad")) return (value * 180) / Math.PI;
  if (token.endsWith("turn")) return value * 360;
  return value;
}

/**
 * Computed styles keep authored colour spaces: Chrome reports oklch(), oklab(),
 * lab(), lch() and color() as written (Tailwind v4 emits oklch). Without this
 * those surfaces would look transparent to the engine and stay light.
 */
function parseModernColor(value: string): Rgba | null {
  const match = value.match(/^(oklab|oklch|lab|lch|color)\(\s*(.+?)\s*\)$/);
  if (!match) {
    return null;
  }
  const [, name = "", body = ""] = match;
  const [channels = "", alphaToken] = body.split(/\s*\/\s*/);
  const tokens = channels.split(/[\s,]+/).filter(Boolean);
  let alpha = 1;
  if (alphaToken !== undefined) {
    alpha = alphaToken.endsWith("%")
      ? Number.parseFloat(alphaToken) / 100
      : Number.parseFloat(alphaToken);
    if (alphaToken === "none") alpha = 1;
    if (!Number.isFinite(alpha)) return null;
    alpha = Math.max(0, Math.min(1, alpha));
  }
  const num = (token: string | undefined, percentScale = 1): number | null => {
    if (token === undefined) return null;
    if (token === "none") return 0;
    const parsed = Number.parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    return token.endsWith("%") ? (parsed / 100) * percentScale : parsed;
  };

  if (name === "color") {
    const space = tokens[0];
    const c = [num(tokens[1]), num(tokens[2]), num(tokens[3])];
    if (c.some((entry) => entry === null)) return null;
    const [x, y, z] = c as [number, number, number];
    switch (space) {
      case "srgb":
        return { r: clampChannel(x * 255), g: clampChannel(y * 255), b: clampChannel(z * 255), a: alpha };
      case "srgb-linear":
        return linearSrgbToRgb([x, y, z], alpha);
      case "display-p3": {
        const linear: [number, number, number] = [srgbToLinear(x * 255), srgbToLinear(y * 255), srgbToLinear(z * 255)];
        return linearSrgbToRgb(multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(LINEAR_P3_TO_XYZ_D65, linear)), alpha);
      }
      case "xyz":
      case "xyz-d65":
        return linearSrgbToRgb(multiply(XYZ_D65_TO_LINEAR_SRGB, [x, y, z]), alpha);
      case "xyz-d50":
        return linearSrgbToRgb(multiply(XYZ_D65_TO_LINEAR_SRGB, multiply(XYZ_D50_TO_D65, [x, y, z])), alpha);
      default:
        return null;
    }
  }

  if (name === "oklab" || name === "lab") {
    const lightnessScale = name === "oklab" ? 1 : 100;
    const axisScale = name === "oklab" ? 0.4 : 125;
    const L = num(tokens[0], lightnessScale);
    const a = num(tokens[1], axisScale);
    const b = num(tokens[2], axisScale);
    if (L === null || a === null || b === null) return null;
    return linearSrgbToRgb(
      name === "oklab" ? oklabToLinearSrgb(L, a, b) : labToLinearSrgb(L, a, b),
      alpha,
    );
  }

  const lightnessScale = name === "oklch" ? 1 : 100;
  const chromaScale = name === "oklch" ? 0.4 : 150;
  const L = num(tokens[0], lightnessScale);
  const C = num(tokens[1], chromaScale);
  const hueToken = tokens[2];
  if (L === null || C === null || hueToken === undefined) return null;
  const hue = hueToken === "none" ? 0 : parseAngle(hueToken);
  if (!Number.isFinite(hue)) return null;
  const radians = (hue * Math.PI) / 180;
  const a = C * Math.cos(radians);
  const b = C * Math.sin(radians);
  return linearSrgbToRgb(
    name === "oklch" ? oklabToLinearSrgb(L, a, b) : labToLinearSrgb(L, a, b),
    alpha,
  );
}

export function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return encoded * 255;
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * srgbToLinear(color.r) +
    0.7152 * srgbToLinear(color.g) +
    0.0722 * srgbToLinear(color.b)
  );
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.max(0, Math.min(1, amount));
  return rgb(
    from.r + (to.r - from.r) * ratio,
    from.g + (to.g - from.g) * ratio,
    from.b + (to.b - from.b) * ratio,
  );
}

export function mixRgbContinuous(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
}

function mixLinear(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.max(0, Math.min(1, amount));
  return {
    r: linearToSrgb(
      srgbToLinear(from.r) +
        (srgbToLinear(to.r) - srgbToLinear(from.r)) * ratio,
    ),
    g: linearToSrgb(
      srgbToLinear(from.g) +
        (srgbToLinear(to.g) - srgbToLinear(from.g)) * ratio,
    ),
    b: linearToSrgb(
      srgbToLinear(from.b) +
        (srgbToLinear(to.b) - srgbToLinear(from.b)) * ratio,
    ),
  };
}

/**
 * Returns a colour close to `base`, adjusted to the requested relative
 * luminance while preserving its chromatic direction as much as possible.
 */
export function colorAtLuminance(base: Rgb, targetLuminance: number): Rgb {
  const target = Math.max(0, Math.min(1, targetLuminance));
  const baseLuminance = relativeLuminance(base);
  if (Math.abs(baseLuminance - target) < 0.0005) {
    return base;
  }

  const destination = target >= baseLuminance ? WHITE : BLACK;
  let low = 0;
  let high = 1;

  for (let index = 0; index < 22; index += 1) {
    const midpoint = (low + high) / 2;
    const candidate = mixLinear(base, destination, midpoint);
    const candidateLuminance = relativeLuminance(candidate);
    if (target >= baseLuminance) {
      // Moving toward white raises luminance.
      if (candidateLuminance < target) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    } else {
      // Moving toward black lowers luminance.
      if (candidateLuminance > target) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    }
  }

  return mixLinear(base, destination, (low + high) / 2);
}

export type TextDirection = "light" | "dark";

export function preferredTextDirection(background: Rgb): TextDirection {
  const backgroundLuminance = relativeLuminance(background);
  const lightRatio = 1.05 / (backgroundLuminance + 0.05);
  const darkRatio = (backgroundLuminance + 0.05) / 0.05;
  return darkRatio > lightRatio ? "dark" : "light";
}

export function colorForContrast(
  base: Rgb,
  background: Rgb,
  targetRatio: number,
  direction: TextDirection,
): Rgb {
  const backgroundLuminance = relativeLuminance(background);
  const ratio = Math.max(1.05, targetRatio);
  const lightTarget = (backgroundLuminance + 0.05) * ratio - 0.05;
  const darkTarget = (backgroundLuminance + 0.05) / ratio - 0.05;
  const targetLuminance =
    direction === "light"
      ? Math.min(1, lightTarget)
      : Math.max(0, darkTarget);

  if (
    (direction === "light" && backgroundLuminance >= 0.92) ||
    (direction === "dark" && backgroundLuminance <= 0.02)
  ) {
    return direction === "light" ? WHITE : BLACK;
  }

  return colorAtLuminance(base, targetLuminance);
}

export function ensureContrast(
  base: Rgb,
  background: Rgb,
  minimumRatio: number,
  direction?: TextDirection,
): Rgb {
  const resolvedDirection = direction ?? preferredTextDirection(background);
  if (contrastRatio(base, background) >= minimumRatio) {
    return base;
  }
  return colorForContrast(base, background, minimumRatio, resolvedDirection);
}

export function interpolateHex(from: string, to: string, amount: number): Rgb {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  if (!start || !end) {
    return rgb(0, 0, 0);
  }
  return mixRgb(start, end, amount);
}
