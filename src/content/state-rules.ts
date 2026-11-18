import type { Rgba } from "../shared/color";
import { opaqueColor, parseColorOrNull } from "./color-map";

/**
 * Colours that only exist in a state (:hover, :focus, :active …) cannot be
 * sampled from an element, so they are read from the page's own style sheets
 * where the browser lets a script see them (same-origin or CORS-enabled sheets;
 * cross-origin sheets throw and are skipped, because fetching them would be a
 * network request). Each state rule that sets a background, text or border
 * colour is remembered with the colour it set; the engine re-emits it with the
 * mapped colour.
 */
export interface StateRule {
  /** At-rule wrappers to preserve, outermost first (for example `@media (hover: hover)`). */
  readonly wrappers: readonly string[];
  /** Selectors (already filtered to the state ones). */
  readonly selectors: readonly string[];
  readonly background: Rgba | null;
  readonly text: Rgba | null;
  readonly border: Rgba | null;
}

const STATE = /:(hover|focus|focus-visible|focus-within|active)\b/;

/** Splits a selector list on top-level commas. */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function walk(rules: CSSRuleList, wrappers: string[], out: StateRule[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = splitSelectors(rule.selectorText).filter(
        (selector) => STATE.test(selector) && !selector.includes("::") && !selector.includes("&"),
      );
      if (selectors.length === 0) continue;
      const background = opaqueColor(rule.style.backgroundColor ?? "");
      const text = parseColorOrNull(rule.style.color ?? "");
      const borderValue = rule.style.borderTopColor || rule.style.borderColor || "";
      const border = parseColorOrNull(borderValue);
      if (background || text || border) {
        out.push({ wrappers: [...wrappers], selectors, background, text, border });
      }
    } else if (rule instanceof CSSMediaRule) {
      walk(
        rule.cssRules,
        [...wrappers, `@media ${rule.conditionText ?? rule.media?.mediaText ?? "all"}`],
        out,
      );
    } else if (rule instanceof CSSSupportsRule) {
      walk(rule.cssRules, [...wrappers, `@supports ${rule.conditionText}`], out);
    } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
      // @layer and similar grouping rules: their contents still apply.
      walk((rule as CSSGroupingRule).cssRules, wrappers, out);
    }
  }
}

/** Collects state rules from every readable style sheet of the document. */
export function collectStateRules(doc: Document, limit = 4000): StateRule[] {
  const out: StateRule[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    if (sheet.ownerNode && (sheet.ownerNode as Element).id === "darkr-theme-styles") continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    walk(rules, [], out);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
