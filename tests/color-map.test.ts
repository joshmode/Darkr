import { describe, expect, it } from "vitest";
import { mapBorderColor, mapTextColor } from "../src/content/color-map";
import { cloneDefaultPreferences } from "../src/shared/config";
import { buildThemeTokens } from "../src/shared/theme";

const built = buildThemeTokens(cloneDefaultPreferences().defaults);
if (!built) {
  throw new Error("default tokens unavailable");
}
const tokens = built;
const surface = tokens.background;

describe("alpha handling", () => {
  it("leaves transparent text and borders unpainted", () => {
    expect(mapTextColor({ r: 0, g: 0, b: 0, a: 0 }, surface, tokens)).toBe("transparent");
    expect(mapTextColor({ r: 0, g: 0, b: 0, a: 0.04 }, surface, tokens)).toBe("transparent");
    expect(mapBorderColor({ r: 0, g: 0, b: 0, a: 0 }, surface, tokens)).toBe("transparent");
  });

  it("keeps partial alpha on mapped text and borders", () => {
    expect(mapTextColor({ r: 0, g: 0, b: 0, a: 0.4 }, surface, tokens)).toMatch(
      /^rgba\(.*, 0\.4\)$/,
    );
    expect(mapBorderColor({ r: 0, g: 0, b: 0, a: 0.5 }, surface, tokens)).toMatch(
      /^rgba\(.*, 0\.5\)$/,
    );
  });

  it("maps opaque text to an opaque colour", () => {
    expect(mapTextColor({ r: 17, g: 17, b: 17, a: 1 }, surface, tokens)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
