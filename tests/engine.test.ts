import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildThemeTokens } from "../src/shared/theme";
import { ThemeEngine, themeEngineTestUtilities } from "../src/content/theme-engine";
import { parseCssColor } from "../src/shared/color";
import { DEFAULT_THEME_CONFIG, type ThemeConfig } from "../src/shared/types";

const { ROOT_CLASS, SEMANTIC_CLASS, GRAYSCALE_CLASS } = themeEngineTestUtilities;

function config(overrides: Partial<ThemeConfig> = {}): ThemeConfig {
  return { ...DEFAULT_THEME_CONFIG, ...overrides };
}

function loadFixture(name: string): void {
  const fixture = fixtures[name] ?? "";
  const parsed = new DOMParser().parseFromString(fixture, "text/html");
  const style = parsed.documentElement.getAttribute("style");
  if (style) {
    document.documentElement.setAttribute("style", style);
  }
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

const fixtures: Record<string, string> = {
  article: `
    <html style="background:#ffffff;color:#202124">
    <head><style>body{background:#fff;color:#222}.card{background:#f4f6f8;border:1px solid #ddd}.accent{background:#e7f1ff;color:#123;border:1px solid #b7d5ff}a{color:#0756c9}</style></head>
    <body><header style="background:#f7f7f8;border-bottom:1px solid #ddd"><h1>Fixture</h1></header>
    <main><p id="text">Readable text</p><a id="link" href="#x">Link</a>
    <div class="card" id="card"><p>Panel text</p><button id="button">Button</button></div>
    <div class="accent" id="accent">Accent</div>
    <input id="input" value="Hello"><pre id="pre"><code>const a = 1;</code></pre>
    <div id="dynamic"></div><div id="shadow-host"></div></main></body></html>`,
  dark: `
    <html style="color-scheme:dark;background:#121416;color:#f1efe8">
    <head><style>body{background:#121416;color:#f1efe8}</style></head>
    <body><main><h1 id="heading">Dark page</h1><a id="link">Link</a></main></body></html>`,
};

describe("ThemeEngine", () => {
  let engine: ThemeEngine;

  beforeEach(() => {
    document.documentElement.innerHTML = "";
    engine = new ThemeEngine(document, window);
  });

  afterEach(() => {
    engine.destroy();
    vi.restoreAllMocks();
  });

  it("applies semantic styling and exposes readable computed text", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark", darkBackground: 20 }));
    engine.flush();
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains(SEMANTIC_CLASS)).toBe(true);
    const text = getComputedStyle(document.getElementById("text")!);
    expect(text.color).not.toBe("rgb(34, 34, 34)");
    expect(document.getElementById("text")!.hasAttribute("data-darkr-text")).toBe(true);
    expect(document.getElementById("card")!.hasAttribute("data-darkr-surface")).toBe(true);
  });

  it("is idempotent and removes every injected attribute and style", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    expect(document.querySelectorAll("style#darkr-theme-styles")).toHaveLength(1);
    expect(document.querySelectorAll("[data-darkr-surface]").length).toBeGreaterThan(0);
    engine.clear();
    engine.clear();
    expect(document.querySelector("#darkr-theme-styles")).toBeNull();
    expect(document.querySelectorAll("[data-darkr-surface]").length).toBe(0);
    expect(document.querySelectorAll("[data-darkr-text]").length).toBe(0);
    expect(document.querySelectorAll("[data-darkr-border]").length).toBe(0);
    expect(document.querySelectorAll("[data-darkr-element-surface]").length).toBe(0);
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
  });

  it("supports live theme changes without layering styles", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark", darkBackground: 10 }));
    engine.apply(config({ mode: "sepia", sepiaIntensity: 80 }));
    engine.flush();
    expect(document.querySelectorAll("style#darkr-theme-styles")).toHaveLength(1);
    expect(document.documentElement.style.getPropertyValue("--darkr-bg")).not.toBe("");
    expect(document.getElementById("card")!.hasAttribute("data-darkr-surface")).toBe(true);
  });

  it("remaps host inline edits without losing the author background", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const card = document.getElementById("card") as HTMLElement;
    card.style.backgroundColor = "#112233";
    engine.apply(config({ mode: "sepia" }));
    engine.flush();
    expect(card.style.backgroundColor).toBe("rgb(17, 34, 51)");
    expect(card.hasAttribute("data-darkr-surface")).toBe(true);
    expect(card.style.getPropertyValue("--darkr-element-surface")).not.toBe("");
  });

  it("detects host inline edits made after observation", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const card = document.getElementById("card") as HTMLElement;
    card.style.backgroundColor = "#112233";
    await new Promise((resolve) => setTimeout(resolve, 70));
    engine.flush();
    expect(card.hasAttribute("data-darkr-surface")).toBe(true);
    expect(card.style.getPropertyValue("--darkr-element-surface")).not.toBe("");
    expect(card.getAttribute("data-darkr-ignore")).toBeNull();
  });

  it("cleans semantic attributes in grayscale mode and only uses the filter", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    engine.apply(config({ mode: "grayscale", grayscaleIntensity: 100 }));
    engine.flush();
    expect(document.documentElement.classList.contains(GRAYSCALE_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains(SEMANTIC_CLASS)).toBe(false);
    expect(document.querySelectorAll("[data-darkr-surface]")).toHaveLength(0);
    expect(document.querySelector("#darkr-theme-styles")?.textContent).toContain("grayscale");
  });

  it("leaves an existing dark page alone but allows grayscale", () => {
    loadFixture("dark");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
    expect(engine.status.nativeDark).toBe(true);
    engine.apply(config({ mode: "grayscale", grayscaleIntensity: 100 }));
    expect(document.documentElement.classList.contains(GRAYSCALE_CLASS)).toBe(true);
  });

  it("themes elements inserted after initial load in a batched pass", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const dynamic = document.getElementById("dynamic")!;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<p id='new-text'>New text</p><a id='new-link'>New link</a>";
    dynamic.append(card);
    await new Promise((resolve) => setTimeout(resolve, 70));
    engine.flush();
    expect(document.getElementById("new-text")!.hasAttribute("data-darkr-text")).toBe(true);
    expect(card.hasAttribute("data-darkr-surface")).toBe(true);
  });

  it("restyles direct-text replacements inside themed elements", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const text = document.getElementById("text")!;
    text.textContent = "Changed text";
    await new Promise((resolve) => setTimeout(resolve, 70));
    engine.flush();
    expect(text.hasAttribute("data-darkr-text")).toBe(true);
  });

  it("adds a shadow style and removes it on clear", () => {
    loadFixture("article");
    const host = document.getElementById("shadow-host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<div id='shadow-panel' style='background:#fff;color:#222'>Shadow</div>";
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    expect(shadow.querySelector("[data-darkr-shadow-style]")).not.toBeNull();
    expect(host.hasAttribute("data-darkr-shadow")).toBe(true);
    engine.clear();
    expect(shadow.querySelector("[data-darkr-shadow-style]")).toBeNull();
    expect(host.hasAttribute("data-darkr-shadow")).toBe(false);
  });

  it("uses the active palette for CSS variables", () => {
    loadFixture("article");
    engine.apply(config({ mode: "warm", warmth: 60 }));
    engine.flush();
    const tokens = buildThemeTokens(config({ mode: "warm", warmth: 60 }));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--darkr-bg")).not.toBe("");
    expect(root.style.getPropertyValue("--darkr-scheme")).toBe("light");
    expect(parseCssColor(root.style.getPropertyValue("--darkr-bg"))).not.toBeNull();
  });

  it("does nothing in Original mode", () => {
    loadFixture("article");
    engine.apply(config({ mode: "original" }));
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(false);
    expect(document.getElementById("darkr-theme-styles")).toBeNull();
  });

  it("does not rewrite images or SVG", () => {
    loadFixture("article");
    const image = document.createElement("img");
    image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    document.getElementById("dynamic")!.append(image);
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    expect(image.hasAttribute("data-darkr-surface")).toBe(false);
    expect(image.hasAttribute("data-darkr-text")).toBe(false);
  });

  it("does not apply inline text colors inside code editors", () => {
    loadFixture("article");
    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    editor.innerHTML = "<span id='token'>const value = 1;</span>";
    document.getElementById("dynamic")!.append(editor);
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    expect(document.getElementById("token")!.hasAttribute("data-darkr-text")).toBe(
      false,
    );
  });

  it("resumes after BFCache suspension", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    engine.suspend();
    expect(document.querySelector("#darkr-theme-styles")).not.toBeNull();
    engine.resume();
    engine.flush();
    expect(document.documentElement.classList.contains(SEMANTIC_CLASS)).toBe(true);
    expect(document.querySelector("#darkr-theme-styles")).not.toBeNull();
  });

  it("uses true black for the OLED endpoint without losing controls", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark", darkBackground: 0 }));
    engine.flush();
    expect(document.documentElement.style.getPropertyValue("--darkr-bg")).toBe(
      "#000000",
    );
    expect(document.querySelector("#darkr-theme-styles")?.textContent).toContain(
      "background-color: var(--darkr-bg) !important",
    );
    expect(
      document.querySelector("#darkr-theme-styles")?.textContent,
    ).toContain("--darkr-raised");
  });

  it("preserves accent hue on coloured surfaces", () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const accent = document.getElementById("accent") as HTMLElement;
    const mapped = accent.style.getPropertyValue("--darkr-element-surface");
    const parsed = parseCssColor(mapped);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.b).toBeGreaterThan(parsed.r);
  });

  it("survives a page toggling out of and back into visibility", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "warm", warmth: 70 }));
    engine.flush();
    engine.suspend();
    engine.resume();
    engine.flush();
    const heading = document.querySelector("h1")!;
    expect(heading.hasAttribute("data-darkr-text")).toBe(true);
  });

  it("releases removed-subtree bookkeeping", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const card = document.getElementById("card")!;
    card.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((engine as unknown as { inspections: Map<Element, unknown> }).inspections.has(card)).toBe(false);
    expect((engine as unknown as { queuedElements: Set<Element> }).queuedElements.has(card)).toBe(false);
  });
  it("prunes bookkeeping for shadow descendants of removed hosts", async () => {
    loadFixture("article");
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const host = document.getElementById("shadow-host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div id="inner" style="background:#fff;color:#111">Shadow</div>';
    engine.refresh();
    engine.flush();
    const internals = engine as unknown as {
      inspections: Map<Element, unknown>;
      shadowStyles: Map<ShadowRoot, unknown>;
      pruneDetached(): void;
    };
    const inner = root.getElementById("inner")!;
    expect(internals.inspections.has(inner)).toBe(true);
    host.remove();
    internals.pruneDetached();
    expect(internals.inspections.has(inner)).toBe(false);
    expect(internals.shadowStyles.has(root)).toBe(false);
  });
  it("themes an element revealed later through an inline style", async () => {
    loadFixture("article");
    const host = document.getElementById("dynamic")!;
    host.innerHTML = '<div id="late" style="display:none;background:#fff;color:#111">Late</div>';
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const late = document.getElementById("late")!;
    expect(late.hasAttribute("data-darkr-surface")).toBe(false);
    late.style.display = "block";
    await new Promise((resolve) => setTimeout(resolve, 80));
    engine.flush();
    expect(late.hasAttribute("data-darkr-surface")).toBe(true);
  });

  /**
   * jsdom does not apply Darkr's `!important` attribute rules, so emulate what a
   * browser does: an element carrying our surface attribute reports the mapped
   * (dark) background. Reads that forget to strip Darkr first get this value.
   */
  function emulateContamination(): void {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null,
    ) => {
      const style = real(element, pseudo);
      const semantic = document.documentElement.classList.contains(SEMANTIC_CLASS);
      if (!semantic || !element.hasAttribute?.("data-darkr-surface")) {
        return style;
      }
      return new Proxy(style, {
        get(target, key) {
          if (key === "backgroundColor") return "rgb(20, 20, 20)";
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof getComputedStyle);
  }

  const internals = () =>
    engine as unknown as {
      inspections: Map<Element, { background: { r: number } | null }>;
      queuedElements: Set<Element>;
    };

  it("re-inspects a moved element from its author colors, not Darkr's override", async () => {
    loadFixture("article");
    emulateContamination();
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const card = document.getElementById("card")!;
    expect(internals().inspections.get(card)?.background?.r).toBe(244);
    document.querySelector("main")!.append(card);
    await new Promise((resolve) => setTimeout(resolve, 80));
    engine.flush();
    expect(internals().inspections.get(card)?.background?.r).toBe(244);
  });

  it("re-reads author colors after the page swaps a class", async () => {
    loadFixture("article");
    const rule = document.createElement("style");
    rule.textContent = ".card.night{background:#101820}";
    document.head.append(rule);
    emulateContamination();
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    const card = document.getElementById("card")!;
    expect(internals().inspections.get(card)?.background?.r).toBe(244);
    const before = card.style.getPropertyValue("--darkr-element-surface");
    card.classList.add("night");
    await new Promise((resolve) => setTimeout(resolve, 120));
    engine.flush();
    // 16 = #101820 read cleanly; 20 would mean Darkr's own override was read.
    expect(internals().inspections.get(card)?.background?.r).toBe(16);
    expect(card.style.getPropertyValue("--darkr-element-surface")).not.toBe(before);
  });

  it("skips re-walking a large container whose own colors did not change", async () => {
    loadFixture("article");
    const big = document.createElement("div");
    big.id = "big";
    big.innerHTML = Array.from({ length: 320 }, () => '<p style="color:#222">row</p>').join("");
    document.querySelector("main")!.append(big);
    engine.apply(config({ mode: "dark" }));
    engine.flush();
    big.classList.add("first");
    await new Promise((resolve) => setTimeout(resolve, 150));
    engine.flush();
    big.classList.add("second");
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(internals().queuedElements.size).toBeLessThan(5);
  });
  describe("native dark override", () => {
    const themed = () => document.documentElement.classList.contains(ROOT_CLASS);

    it("leaves a natively dark page untouched by default", () => {
      loadFixture("dark");
      engine.apply(config({ mode: "dark" }));
      expect(themed()).toBe(false);
      expect(engine.status.nativeDark).toBe(true);
    });

    it("themes a natively dark page when overridden, and still reports it as native dark", () => {
      loadFixture("dark");
      engine.apply(config({ mode: "dark" }), { overrideNativeDark: true });
      engine.flush();
      expect(themed()).toBe(true);
      expect(document.documentElement.classList.contains(SEMANTIC_CLASS)).toBe(true);
      expect(engine.status.nativeDark).toBe(true);
    });

    it("flips in both directions without a reload", () => {
      loadFixture("dark");
      const dark = config({ mode: "dark" });
      engine.apply(dark);
      expect(themed()).toBe(false);
      engine.apply(dark, { overrideNativeDark: true });
      engine.flush();
      expect(themed()).toBe(true);
      expect(document.getElementById("heading")?.hasAttribute("data-darkr-text")).toBe(true);
      engine.apply(dark, { overrideNativeDark: false });
      expect(themed()).toBe(false);
      expect(document.querySelector("[data-darkr-text], [data-darkr-surface]")).toBeNull();
    });

    it("keeps the override across refresh and bfcache resume", () => {
      loadFixture("dark");
      engine.apply(config({ mode: "dark" }), { overrideNativeDark: true });
      engine.refresh();
      expect(themed()).toBe(true);
      engine.suspend();
      engine.resume();
      expect(themed()).toBe(true);
    });

    it("does not change pages that are not natively dark", () => {
      loadFixture("article");
      engine.apply(config({ mode: "dark" }), { overrideNativeDark: false });
      expect(themed()).toBe(true);
      expect(engine.status.nativeDark).toBe(false);
    });
  });
  it("bounds the initial queue on very large documents", () => {
    loadFixture("article");
    const big = document.createElement("div");
    big.innerHTML = "<p>row</p>".repeat(12000);
    document.body.append(big);
    engine.apply(config({ mode: "dark" }));
    const queued = (engine as unknown as { queuedElements: Set<Element> }).queuedElements;
    expect(queued.size).toBeLessThanOrEqual(9000);
  });
});
