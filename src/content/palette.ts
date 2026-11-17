import { type Rgb, type Rgba, rgbToCss } from "../shared/color";
import type { ThemeTokens } from "../shared/theme";
import { mapBorderColor, mapSurfaceColor, mapTextColor, parseColorOrNull } from "./color-map";

/**
 * Themed colours are shared. Instead of writing a custom property onto every
 * element, each distinct (role, author colour, surface) combination becomes one
 * numbered entry, elements carry short tokens in one attribute
 * (`data-darkr="s3 t7"`), and the stylesheet holds one rule per entry. A
 * configuration change recomputes the entries and rewrites the sheet; elements
 * are not touched.
 */
export type PaletteRole = "s" | "t" | "ba" | "bt" | "br" | "bb" | "bl" | "f" | "k";

/** Where a surface colour comes from: the page token, a fixed colour, or an entry. */
export type SurfaceRef = string;
export const PAGE_SURFACE: SurfaceRef = "bg";

type EntryKind = "surface" | "text" | "border" | "link" | "visited";

export interface PaletteEntry {
  readonly id: number;
  readonly role: PaletteRole;
  readonly kind: EntryKind;
  readonly original: Rgba | null;
  readonly surface: SurfaceRef;
  /** CSS colour currently produced for this entry. */
  value: string;
  /** The same colour without alpha, used when it becomes a surface. */
  color: Rgb;
  /** Token written to elements. */
  readonly token: string;
}

const PROPERTY: Record<PaletteRole, string> = {
  s: "background-color",
  t: "color",
  ba: "border-color",
  bt: "border-top-color",
  br: "border-right-color",
  bb: "border-bottom-color",
  bl: "border-left-color",
  f: "fill",
  k: "stroke",
};

const hex = (value: number): string => Math.round(value).toString(16).padStart(2, "0");

/** A surface colour that is not an entry (gradient or translucent backdrop). */
export function fixedSurface(color: Rgb): SurfaceRef {
  return `c${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

export class Palette {
  private readonly byKey = new Map<string, PaletteEntry>();
  private readonly entries: PaletteEntry[] = [];
  private tokens: ThemeTokens | null = null;
  /** Called when an entry is added, with the CSS rule body for each scope. */
  onAdd: ((entry: PaletteEntry) => void) | null = null;

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.byKey.clear();
    this.entries.length = 0;
    this.tokens = null;
  }

  /** Switches theme and recomputes every entry in creation order. */
  setTokens(tokens: ThemeTokens): void {
    this.tokens = tokens;
    for (const entry of this.entries) {
      this.compute(entry);
    }
  }

  /** Looks an entry up by the token an element carries (for tests and debugging). */
  byToken(token: string): PaletteEntry | undefined {
    return this.entries[Number(token.replace(/^\D+/, ""))];
  }

  surfaceColor(ref: SurfaceRef): Rgb {
    if (ref === PAGE_SURFACE || !this.tokens) {
      return this.tokens?.background ?? { r: 23, g: 24, b: 27 };
    }
    if (ref.startsWith("c")) {
      return {
        r: Number.parseInt(ref.slice(1, 3), 16),
        g: Number.parseInt(ref.slice(3, 5), 16),
        b: Number.parseInt(ref.slice(5, 7), 16),
      };
    }
    return this.entries[Number(ref.slice(1))]?.color ?? this.tokens.background;
  }

  surface(original: Rgba): PaletteEntry {
    return this.get("s", "surface", original, PAGE_SURFACE);
  }

  paint(
    role: Exclude<PaletteRole, "s">,
    original: Rgba,
    surface: SurfaceRef,
    kind: "text" | "border" = role === "t" || role === "f" || role === "k" ? "text" : "border",
  ): PaletteEntry {
    return this.get(role, kind, original, surface);
  }

  /** The theme's own link / visited colour as a text entry. */
  linkColor(visited: boolean): PaletteEntry {
    return this.get("t", visited ? "visited" : "link", null, PAGE_SURFACE);
  }

  /** CSS rules for every entry, each prefixed with `scope` (a selector ending before the attribute). */
  rules(scope: string): string[] {
    return this.entries.map((entry) => rule(scope, entry));
  }

  rule(scope: string, entry: PaletteEntry): string {
    return rule(scope, entry);
  }

  private get(
    role: PaletteRole,
    kind: EntryKind,
    original: Rgba | null,
    surface: SurfaceRef,
  ): PaletteEntry {
    const key = `${role}|${kind}|${original ? rgbToCss(original) : ""}|${surface}`;
    const known = this.byKey.get(key);
    if (known) {
      return known;
    }
    const id = this.entries.length;
    const entry: PaletteEntry = {
      id,
      role,
      kind,
      original,
      surface,
      value: "transparent",
      color: { r: 0, g: 0, b: 0 },
      token: `${role}${id}`,
    };
    this.byKey.set(key, entry);
    this.entries.push(entry);
    this.compute(entry);
    this.onAdd?.(entry);
    return entry;
  }

  private compute(entry: PaletteEntry): void {
    const tokens = this.tokens;
    if (!tokens) {
      return;
    }
    let value: string;
    if (entry.kind === "link") {
      value = rgbToCss(tokens.link);
    } else if (entry.kind === "visited") {
      value = rgbToCss(tokens.visited);
    } else if (!entry.original) {
      value = "transparent";
    } else if (entry.kind === "surface") {
      value = mapSurfaceColor(entry.original, tokens);
    } else if (entry.kind === "border") {
      value = mapBorderColor(entry.original, this.surfaceColor(entry.surface), tokens);
    } else {
      value = mapTextColor(entry.original, this.surfaceColor(entry.surface), tokens);
    }
    entry.value = value;
    const parsed = parseColorOrNull(value);
    entry.color = parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : entry.color;
  }
}

function rule(scope: string, entry: PaletteEntry): string {
  return `${scope} [data-darkr~="${entry.token}"] { ${PROPERTY[entry.role]}: ${entry.value} !important; }`;
}
