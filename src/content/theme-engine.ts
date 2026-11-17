import { buildThemeTokens, themeVariables, type ThemeTokens } from "../shared/theme";
import type { ThemeConfig } from "../shared/types";
import {
  mapBorderColor,
  mapSurfaceColor,
  mapTextColor,
  opaqueColor,
  parseColorOrNull,
} from "./color-map";
import {
  contrastRatio,
  isPainted,
  relativeLuminance,
  rgbToCss,
  type Rgb,
  type Rgba,
} from "../shared/color";
import { themeConfigsEqual } from "../shared/config";

const STYLE_ID = "darkr-theme-styles";
const ROOT_CLASS = "darkr-active";
const SEMANTIC_CLASS = "darkr-semantic";
const GRAYSCALE_CLASS = "darkr-grayscale";
const SURFACE_ATTRIBUTE = "data-darkr-surface";
const TEXT_ATTRIBUTE = "data-darkr-text";
const BORDER_ATTRIBUTE = "data-darkr-border";
const IGNORE_ATTRIBUTE = "data-darkr-ignore";
const ELEMENT_SURFACE_VARIABLE = "--darkr-element-surface";
const ELEMENT_TEXT_VARIABLE = "--darkr-element-text";
const ELEMENT_BORDER_VARIABLE = "--darkr-element-border";
/**
 * `data-darkr-border` holds "a" when all four sides share one colour, or any of
 * "t r b l" for the sides that are painted. Unlisted sides keep the author's
 * colour (transparent sides must stay transparent: CSS triangles, ghost buttons).
 */
const BORDER_SIDES = [
  { key: "t", property: "Top", variable: "--darkr-element-border-top", css: "border-top-color" },
  {
    key: "r",
    property: "Right",
    variable: "--darkr-element-border-right",
    css: "border-right-color",
  },
  {
    key: "b",
    property: "Bottom",
    variable: "--darkr-element-border-bottom",
    css: "border-bottom-color",
  },
  { key: "l", property: "Left", variable: "--darkr-element-border-left", css: "border-left-color" },
] as const;
const INITIAL_ELEMENT_BUDGET = 700;
const BATCH_SIZE = 180;
const NATIVE_DARK_THRESHOLD = 0.18;
const MAX_TRACKED_ELEMENTS = 9000;
/**
 * A class toggle on a container with more inspected descendants than this is
 * only re-walked when the container's own colors changed (theme classes such
 * as `.dark`), not for incidental toggles like scroll locks.
 */
const LARGE_SUBTREE = 300;
/** Removed-node count after which detached bookkeeping is swept. */
const PRUNE_AFTER_REMOVALS = 1500;
const ROOT_VARIABLES = [
  "--darkr-bg",
  "--darkr-raised",
  "--darkr-sunken",
  "--darkr-text",
  "--darkr-muted",
  "--darkr-border",
  "--darkr-link",
  "--darkr-visited",
  "--darkr-input-bg",
  "--darkr-input-text",
  "--darkr-code-bg",
  "--darkr-code-text",
  "--darkr-selection",
  "--darkr-scheme",
  "--darkr-grayscale",
] as const;

const SKIP_SUBTREES = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "HEAD",
  "NOSCRIPT",
  "TEMPLATE",
  "IMG",
  "PICTURE",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
]);

/** Controls whose text colour is not a text colour at all. */
const NON_TEXT_CONTROL_SELECTOR = "progress, meter";
/** Form controls have no text node of their own but still show text. */
const FORM_TEXT_CONTROL_SELECTOR = "input, textarea, select, option, optgroup";
const SKIP_TEXT_INSIDE =
  "[contenteditable='true'], [role='textbox'], " +
  ".monaco-editor, .CodeMirror, .cm-editor, .ace_editor";

interface InspectedElement {
  background: Rgba | null;
  text: Rgba | null;
  /** Painted colour per side (top, right, bottom, left); null when not painted. */
  borders: [Rgba | null, Rgba | null, Rgba | null, Rgba | null];
  hasDirectText: boolean;
  mappedSurface: Rgb | null;
  /** Keep inline edits from the host page instead of overriding them forever. */
  hostStyleSignature: string;
  pass: "light" | "text" | "surface";
  samples: {
    background: string;
    text: string;
    borders: string;
    display: string;
    visibility: string;
    opacity: string;
  };
}

export interface ApplyOptions {
  /** Theme the page even when it already has its own dark appearance. */
  overrideNativeDark?: boolean;
}

interface EngineState {
  config: ThemeConfig | null;
  overrideNativeDark: boolean;
  tokens: ThemeTokens | null;
  nativeDark: boolean;
  hasApplied: boolean;
}

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (
      callback: (deadline: { timeRemaining(): number }) => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

function hasDirectText(element: Element): boolean {
  if (element.matches(FORM_TEXT_CONTROL_SELECTOR)) {
    return true;
  }
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Computed colours of unstyled links (light and dark colour schemes). Only these
 * get the theme's link colours; an author-chosen link colour is mapped like any
 * other text colour.
 */
const UA_LINK_COLORS = new Set(["0,0,238", "158,158,255"]);
const UA_VISITED_COLORS = new Set(["85,26,139", "208,173,240"]);
const LINK_ATTRIBUTE = "data-darkr-link";
const rgbKey = (color: Rgba): string => `${color.r},${color.g},${color.b}`;

const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const DESIGN_MODE_ATTRIBUTE = "data-darkr-designmode";

/**
 * True for anything inside an editable region, except the region's own root.
 * Darkr must not write attributes or inline styles there: webmail composers,
 * CMS editors and note apps serialise that markup, and editors such as
 * ProseMirror and Slate watch their own DOM. The stylesheet makes these
 * subtrees inherit the themed colours instead.
 */
function isInsideEditable(element: Element): boolean {
  if (element.ownerDocument.designMode === "on") {
    return true;
  }
  const root = element.closest(EDITABLE_SELECTOR);
  return root !== null && root !== element;
}

function isProtectedEditor(element: Element): boolean {
  return Boolean(element.closest(".monaco-editor, .CodeMirror, .cm-editor, .ace_editor"));
}

function isVisible(style: CSSStyleDeclaration): boolean {
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    style.opacity !== "0"
  );
}

function sampleStyle(style: CSSStyleDeclaration): InspectedElement["samples"] {
  return {
    background: style.backgroundColor,
    text: style.color,
    borders: BORDER_SIDES.map(
      (side) => `${style[`border${side.property}Color`]}/${style[`border${side.property}Style`]}`,
    ).join("|"),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
  };
}

/**
 * Inline properties that change how an element is coloured or whether it is
 * shown. Anything else (transform, top, width, will-change …) is what scripts
 * animate every frame and must not make the engine re-inspect the element.
 */
const COLOR_BEARING_PROPERTY =
  /^(color|background(-.+)?|border(-(top|right|bottom|left))?-(color|style)|fill|stroke|opacity|display|visibility)$/;

function inlineStyleSignature(element: Element): string {
  const style = (element as HTMLElement).style;
  return Array.from(style)
    .filter((property) => COLOR_BEARING_PROPERTY.test(property))
    .map((property) => `${property}:${style.getPropertyValue(property)}`)
    .join(";");
}

function samplesEqual(
  left: InspectedElement["samples"],
  right: InspectedElement["samples"],
): boolean {
  return (
    left.background === right.background &&
    left.text === right.text &&
    left.borders === right.borders &&
    left.display === right.display &&
    left.visibility === right.visibility &&
    left.opacity === right.opacity
  );
}

function stylePass(element: Element, style: CSSStyleDeclaration): InspectedElement["pass"] {
  if (
    style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
    BORDER_SIDES.some((side) => hasBorderStyle(style[`border${side.property}Style`]))
  ) {
    return "surface";
  }
  if (
    element.matches(
      "p, span, a, strong, em, b, i, small, time, cite, label, legend, dt, dd, li, td, th, blockquote, figcaption, h1, h2, h3, h4, h5, h6",
    )
  ) {
    return "text";
  }
  return "light";
}

function tokenColorFromVariable(value: string, tokens: ThemeTokens): Rgba | null {
  const variable = value.trim().match(/^var\(\s*(--darkr-[\w-]+)/)?.[1];
  if (!variable) {
    return null;
  }
  const mapping: Record<string, Rgb> = {
    "--darkr-bg": tokens.background,
    "--darkr-raised": tokens.raised,
    "--darkr-sunken": tokens.sunken,
    "--darkr-text": tokens.text,
    "--darkr-muted": tokens.muted,
    "--darkr-border": tokens.border,
    "--darkr-link": tokens.link,
    "--darkr-visited": tokens.visited,
    "--darkr-input-bg": tokens.inputBackground,
    "--darkr-input-text": tokens.inputText,
    "--darkr-code-bg": tokens.codeBackground,
    "--darkr-code-text": tokens.codeText,
    "--darkr-selection": tokens.selection,
  };
  const resolved = mapping[variable];
  return resolved ? { ...resolved, a: 1 } : null;
}

function hasBorderStyle(value: string): boolean {
  return value !== "none" && value !== "hidden";
}

/** A colour worth mapping: parseable and actually painted (alpha >= 0.05). */
function inspectableColor(value: string, tokens: ThemeTokens | null): Rgba | null {
  const color = parseColorOrNull(value) ?? (tokens ? tokenColorFromVariable(value, tokens) : null);
  return color && isPainted(color) ? color : null;
}

function getOriginalSurface(doc: Document): Rgba {
  const rootStyle = getComputedStyle(doc.documentElement);
  const bodyStyle = doc.body ? getComputedStyle(doc.body) : null;
  return (
    (bodyStyle ? opaqueColor(bodyStyle.backgroundColor) : null) ??
    opaqueColor(rootStyle.backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  );
}

function detectNativeDark(doc: Document): boolean {
  const rootStyle = getComputedStyle(doc.documentElement);
  const bodyStyle = doc.body ? getComputedStyle(doc.body) : null;
  const surface = getOriginalSurface(doc);
  const style = bodyStyle ?? rootStyle;
  const foreground = parseColorOrNull(style.color) ??
    parseColorOrNull(rootStyle.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const darkSurface = relativeLuminance(surface) < NATIVE_DARK_THRESHOLD;
  const readableLightText =
    contrastRatio(foreground, surface) >= 4.5 &&
    relativeLuminance(foreground) > relativeLuminance(surface);
  const declaresDarkScheme =
    rootStyle.colorScheme?.toLowerCase().includes("dark") ||
    style.colorScheme?.toLowerCase().includes("dark") ||
    Boolean(
      doc.querySelector(
        'meta[name="color-scheme"][content*="dark"], meta[name="theme-color"][content]',
      ) && darkSurface,
    );
  return darkSurface && (readableLightText || declaresDarkScheme);
}

function buildDocumentCss(tokens: ThemeTokens): string {
  const variables = Object.entries(themeVariables(tokens))
    .map(([name, value]) => `${name}: ${value};`)
    .join("\n");

  return `@media screen {
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} {
  ${variables}
  background-color: var(--darkr-bg) !important;
  color-scheme: var(--darkr-scheme) !important;
  accent-color: var(--darkr-link);
  scrollbar-color: var(--darkr-border) var(--darkr-bg);
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} body {
  background-color: var(--darkr-bg) !important;
  color: var(--darkr-text) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} :is(${EDITABLE_SELECTOR}) :where(*),
:root.${ROOT_CLASS}.${SEMANTIC_CLASS}[${DESIGN_MODE_ATTRIBUTE}] body :where(*) {
  color: inherit !important;
  background-color: transparent !important;
}
/* Links the author left unstyled. Author-coloured links are sampled like any
   other text. */
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${LINK_ATTRIBUTE}] {
  color: var(--darkr-link) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${LINK_ATTRIBUTE}]:visited {
  color: var(--darkr-visited) !important;
}
/* Things sampling cannot reach. */
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} :where(input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"]) {
  accent-color: var(--darkr-link);
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} :where(input, textarea)::placeholder {
  color: var(--darkr-muted) !important;
  opacity: 1 !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} :where(input, textarea):-webkit-autofill {
  -webkit-text-fill-color: var(--darkr-input-text) !important;
  box-shadow: 0 0 0 1000px var(--darkr-input-bg) inset !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} dialog::backdrop {
  background: rgb(0 0 0 / 62%) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} ::selection {
  background: var(--darkr-selection) !important;
  color: var(--darkr-text) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${SURFACE_ATTRIBUTE}] {
  background-color: var(${ELEMENT_SURFACE_VARIABLE}) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${TEXT_ATTRIBUTE}] {
  color: var(${ELEMENT_TEXT_VARIABLE}) !important;
}
:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${BORDER_ATTRIBUTE}~="a"] {
  border-color: var(${ELEMENT_BORDER_VARIABLE}) !important;
}
${BORDER_SIDES.map((side) => `:root.${ROOT_CLASS}.${SEMANTIC_CLASS} [${BORDER_ATTRIBUTE}~="${side.key}"] {\n  ${side.css}: var(${side.variable}) !important;\n}`).join("\n")}
:root.${ROOT_CLASS}.${GRAYSCALE_CLASS} {
  filter: grayscale(var(--darkr-grayscale)) !important;
}
}
`;
}

function buildShadowCss(): string {
  return `@media screen {
:host {
  background-color: var(--darkr-bg, #17181b);
  color: var(--darkr-text, #f4f1ea);
}
:host :where(h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, figcaption, td, th, label, legend, caption, summary) {
  color: var(--darkr-text, #f4f1ea) !important;
}
:host a { color: var(--darkr-link, #84aef6) !important; }
:host a:visited { color: var(--darkr-visited, #bf9aeb) !important; }
:host :where(code, pre, kbd, samp) {
  background-color: var(--darkr-code-bg, #2c2d31) !important;
  color: var(--darkr-code-text, #e7e1d2) !important;
}
:host [${SURFACE_ATTRIBUTE}] {
  background-color: var(${ELEMENT_SURFACE_VARIABLE}) !important;
}
:host [${TEXT_ATTRIBUTE}] { color: var(${ELEMENT_TEXT_VARIABLE}) !important; }
:host [${BORDER_ATTRIBUTE}~="a"] { border-color: var(${ELEMENT_BORDER_VARIABLE}) !important; }
${BORDER_SIDES.map((side) => `:host [${BORDER_ATTRIBUTE}~="${side.key}"] { ${side.css}: var(${side.variable}) !important; }`).join("\n")}
}
`;
}

export class ThemeEngine {
  private readonly doc: Document;
  private readonly win: IdleWindow;
  private readonly inspections = new Map<Element, InspectedElement>();
  private readonly shadowStyles = new Map<ShadowRoot, HTMLStyleElement>();
  private readonly shadowObservers = new Map<ShadowRoot, MutationObserver>();
  private readonly queuedElements = new Set<Element>();
  private observer: MutationObserver | null = null;
  private style: HTMLStyleElement | null = null;
  private batchHandle: number | null = null;
  private idleHandle: number | null = null;
  private removalsSincePrune = 0;
  /** Inspected elements whose author colors must be re-read before styling. */
  private readonly resampleQueue = new Set<Element>();
  private readonly containerSignatures = new WeakMap<Element, string>();
  private state: EngineState = {
    config: null,
    overrideNativeDark: false,
    tokens: null,
    nativeDark: false,
    hasApplied: false,
  };

  constructor(doc: Document = document, win: Window = window) {
    this.doc = doc;
    this.win = win as IdleWindow;
  }

  get status(): {
    active: boolean;
    semanticActive: boolean;
    nativeDark: boolean;
    mode: ThemeConfig["mode"];
  } {
    return {
      active: this.doc.documentElement.classList.contains(ROOT_CLASS) && this.state.config !== null,
      semanticActive: this.doc.documentElement.classList.contains(SEMANTIC_CLASS),
      nativeDark: this.state.nativeDark,
      mode: this.state.config?.mode ?? "original",
    };
  }

  apply(config: ThemeConfig, options: ApplyOptions = {}): void {
    const overrideNativeDark = options.overrideNativeDark === true;
    if (
      this.state.hasApplied &&
      this.state.config !== null &&
      this.state.overrideNativeDark === overrideNativeDark &&
      themeConfigsEqual(this.state.config, config)
    ) {
      return;
    }

    const tokens = buildThemeTokens(config);
    const root = this.doc.documentElement;

    if (!tokens) {
      this.clear();
      this.state.config = { ...config };
      return;
    }

    // Detection must see the page's own styling, so it is cached from the
    // first apply and only recomputed after a clear().
    const nativeDark = this.state.hasApplied ? this.state.nativeDark : detectNativeDark(this.doc);

    const preserveDarkPage = nativeDark && config.mode !== "grayscale" && !overrideNativeDark;
    if (preserveDarkPage) {
      this.teardownPageRendering();
      this.state = {
        config: { ...config },
        overrideNativeDark,
        tokens,
        nativeDark,
        hasApplied: true,
      };
      return;
    }

    const previousMode = this.state.config?.mode;
    const wasSemantic = Boolean(
      previousMode && previousMode !== "grayscale" && previousMode !== "original",
    );
    const isSemantic = config.mode !== "grayscale";

    this.state = {
      config: { ...config },
      overrideNativeDark,
      tokens,
      nativeDark,
      hasApplied: true,
    };

    if (wasSemantic && !isSemantic) {
      this.clearElements();
      this.clearShadowStyles();
    }

    if (isSemantic) {
      this.restyleExistingElements();
      if (this.inspections.size === 0) {
        this.inspectInitialPage();
      }
    }

    this.installStyle(tokens);
    root.classList.add(ROOT_CLASS);
    root.toggleAttribute(DESIGN_MODE_ATTRIBUTE, this.doc.designMode === "on");
    root.classList.toggle(SEMANTIC_CLASS, isSemantic);
    root.classList.toggle(GRAYSCALE_CLASS, config.mode === "grayscale");

    if (isSemantic) {
      this.ensureObserver();
    } else {
      this.stopObserver();
      this.clearElements();
    }
  }

  clear(): void {
    this.teardownPageRendering();
    this.state = {
      config: null,
      overrideNativeDark: false,
      tokens: null,
      nativeDark: false,
      hasApplied: false,
    };
  }

  private teardownPageRendering(): void {
    this.stopObserver();
    this.cancelScheduledWork();
    this.clearElements();
    this.clearShadowStyles();
    this.style?.remove();
    this.style = null;

    const root = this.doc.documentElement;
    root.classList.remove(ROOT_CLASS, SEMANTIC_CLASS, GRAYSCALE_CLASS);
    root.removeAttribute(DESIGN_MODE_ATTRIBUTE);
    for (const name of ROOT_VARIABLES) {
      root.style.removeProperty(name);
    }
  }

  destroy(): void {
    this.clear();
  }

  /** Stop observers during navigation teardown; data is restored on next load. */
  suspend(): void {
    this.stopObserver();
    for (const observer of this.shadowObservers.values()) {
      observer.disconnect();
    }
    this.shadowObservers.clear();
    this.cancelScheduledWork();
  }

  /**
   * Re-evaluates the page after its author CSS and body have settled. The
   * initial document_start pass is intentionally optimistic; this second pass
   * fixes late-loaded stylesheets and native dark pages.
   */
  refresh(): void {
    const config = this.state.config;
    if (!config) {
      return;
    }
    const overrideNativeDark = this.state.overrideNativeDark;
    this.clear();
    this.apply(config, { overrideNativeDark });
  }

  /** Reattach work after Safari restores a page from the back/forward cache. */
  resume(): void {
    if (
      !this.state.config ||
      this.state.config.mode === "original" ||
      (this.state.nativeDark && !this.state.overrideNativeDark)
    ) {
      return;
    }
    this.refresh();
  }

  /**
   * Test and preview hook: finish queued initial work immediately.
   */
  flush(): void {
    this.cancelScheduledWork();
    const queued = [...this.queuedElements];
    this.queuedElements.clear();
    this.resampleFlagged(queued);
    this.processElements(queued);
  }

  private installStyle(tokens: ThemeTokens): void {
    if (!this.style) {
      this.style = this.doc.createElement("style");
      this.style.id = STYLE_ID;
      this.style.setAttribute(IGNORE_ATTRIBUTE, "");
      (this.doc.head ?? this.doc.documentElement).append(this.style);
    }
    this.style.textContent = buildDocumentCss(tokens);
    for (const [name, value] of Object.entries(themeVariables(tokens))) {
      this.doc.documentElement.style.setProperty(name, value);
    }
  }

  private restyleExistingElements(): void {
    if (!this.state.tokens) {
      return;
    }
    for (const [element, inspection] of this.inspections) {
      if (!element.isConnected) {
        this.cleanupElement(element, inspection);
        this.inspections.delete(element);
        continue;
      }
      this.styleInspectedElement(element, inspection);
    }
  }

  private inspectInitialPage(): void {
    if (!this.state.tokens) {
      return;
    }
    let processed = 0;
    const stack: Element[] = [this.doc.documentElement];
    while (stack.length > 0) {
      const element = stack.pop();
      if (!element || element.hasAttribute(IGNORE_ATTRIBUTE)) {
        continue;
      }
      if (processed < INITIAL_ELEMENT_BUDGET) {
        const pass = stylePass(element, getComputedStyle(element));
        if (pass === "light") {
          this.queuedElements.add(element);
        } else {
          this.inspectAndStyle(element);
        }
        processed += 1;
      } else if (this.queuedElements.size < MAX_TRACKED_ELEMENTS) {
        // Bounded: on documents with hundreds of thousands of nodes the queue
        // itself would otherwise pin every element in memory.
        this.queuedElements.add(element);
      }
      if (element.shadowRoot) {
        this.attachShadowStyle(element.shadowRoot);
        for (const shadowChild of element.shadowRoot.querySelectorAll("*")) {
          this.queuedElements.add(shadowChild);
        }
      }
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) {
        stack.push(child);
      }
    }
    if (this.queuedElements.size > 0) {
      this.scheduleIdleWork();
    }
  }

  private collectElements(root: Element): Element[] {
    const elements: Element[] = [];
    const stack: Element[] = [root];
    while (stack.length > 0) {
      const element = stack.pop();
      if (!element || element.hasAttribute(IGNORE_ATTRIBUTE)) {
        continue;
      }
      elements.push(element);
      if (element.shadowRoot) {
        this.attachShadowStyle(element.shadowRoot);
        const shadowRoot = element.shadowRoot;
        for (const child of shadowRoot.querySelectorAll("*")) {
          stack.push(child);
        }
      }
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) {
        stack.push(child);
      }
    }
    return elements;
  }

  private processElements(elements: Iterable<Element>): void {
    for (const element of elements) {
      this.inspectAndStyle(element);
    }
  }

  private inspectAndStyle(element: Element): void {
    if (
      !element.isConnected ||
      element.hasAttribute(IGNORE_ATTRIBUTE) ||
      element.tagName === "HTML" ||
      element.tagName === "BODY"
    ) {
      return;
    }

    let inspection = this.inspections.get(element);
    if (isInsideEditable(element)) {
      if (inspection) {
        this.cleanupElement(element, inspection);
        this.inspections.delete(element);
      }
      return;
    }
    if (!inspection) {
      if (SKIP_SUBTREES.has(element.tagName)) {
        return;
      }
      if (this.inspections.size >= MAX_TRACKED_ELEMENTS) {
        // Long-lived single-page apps churn through nodes; reclaim detached
        // ones before giving up on new elements. Checked before reading
        // styles so a huge page does not pay for work it will discard.
        this.pruneDetached();
        if (this.inspections.size >= MAX_TRACKED_ELEMENTS) {
          return;
        }
      }
      const style = getComputedStyle(element);
      if (!isVisible(style)) {
        return;
      }
      inspection = this.buildInspection(element, style);
      this.inspections.set(element, inspection);
    }

    this.styleInspectedElement(element, inspection);
    if (element.shadowRoot) {
      this.attachShadowStyle(element.shadowRoot);
    }
  }

  private buildInspection(element: Element, style: CSSStyleDeclaration): InspectedElement {
    const textControl = element.matches(NON_TEXT_CONTROL_SELECTOR);
    const tokens = this.state.tokens;
    const samples = sampleStyle(style);
    return {
      background:
        opaqueColor(samples.background) ??
        (tokens ? tokenColorFromVariable(samples.background, tokens) : null),
      text: textControl ? null : inspectableColor(samples.text, tokens),
      borders: BORDER_SIDES.map((side) =>
        hasBorderStyle(style[`border${side.property}Style`])
          ? inspectableColor(style[`border${side.property}Color`], tokens)
          : null,
      ) as InspectedElement["borders"],
      hasDirectText: !textControl && hasDirectText(element),
      mappedSurface: null,
      hostStyleSignature: inlineStyleSignature(element),
      pass: stylePass(element, style),
      samples,
    };
  }

  /**
   * Runs `read` with Darkr's semantic rules switched off so computed styles
   * are the page's own. The switch is synchronous, so nothing paints between.
   */
  private readAuthorStyles<T>(read: () => T): T {
    const root = this.doc.documentElement;
    const wasSemantic = root.classList.contains(SEMANTIC_CLASS);
    if (wasSemantic) {
      root.classList.remove(SEMANTIC_CLASS);
    }
    try {
      return read();
    } finally {
      if (wasSemantic) {
        root.classList.add(SEMANTIC_CLASS);
      }
    }
  }

  /** Re-reads flagged elements after the page swapped classes under them. */
  private resampleFlagged(elements: readonly Element[]): void {
    const flagged = elements.filter((element) => this.resampleQueue.delete(element));
    if (flagged.length === 0 || !this.state.tokens) {
      return;
    }
    const fresh = this.readAuthorStyles(() =>
      flagged.map((element) => {
        if (!element.isConnected || !this.inspections.has(element)) {
          return null;
        }
        const style = getComputedStyle(element);
        return [element, isVisible(style) ? this.buildInspection(element, style) : null] as const;
      }),
    );
    for (const entry of fresh) {
      if (!entry) {
        continue;
      }
      const [element, next] = entry;
      const previous = this.inspections.get(element);
      if (!previous) {
        continue;
      }
      if (!next) {
        this.cleanupElement(element, previous);
        this.inspections.delete(element);
        continue;
      }
      if (
        samplesEqual(previous.samples, next.samples) &&
        previous.hasDirectText === next.hasDirectText
      ) {
        continue;
      }
      next.mappedSurface = previous.mappedSurface;
      this.inspections.set(element, next);
    }
  }

  /**
   * Flags a container and its inspected descendants for re-sampling after a
   * class change. Large subtrees are only re-walked when the container's own
   * colors changed.
   */
  private markForResample(container: Element): void {
    const inspected = [container, ...container.querySelectorAll("*")].filter((element) =>
      this.inspections.has(element),
    );
    if (inspected.length > LARGE_SUBTREE) {
      const signature = this.readAuthorStyles(() => {
        const style = getComputedStyle(container);
        return `${style.backgroundColor}|${style.color}`;
      });
      const previous = this.containerSignatures.get(container);
      this.containerSignatures.set(container, signature);
      if (previous === signature) {
        return;
      }
    }
    for (const element of inspected) {
      this.resampleQueue.add(element);
      this.queuedElements.add(element);
    }
  }

  /**
   * The mapped surface behind an element, taken from the engine's own records
   * (nearest ancestor with a `mappedSurface`, crossing shadow boundaries).
   * Never from live computed style: while the first pass runs the stylesheet
   * is not installed yet, so computed ancestors still show the author's light
   * colours.
   */
  private resolveParentSurface(element: Element, tokens: ThemeTokens): Rgb {
    let node: Node | null = element.parentNode;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const surface = this.inspections.get(node as Element)?.mappedSurface;
        if (surface) {
          return surface;
        }
        node = node.parentNode;
      } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host) {
        node = (node as ShadowRoot).host;
        const surface = this.inspections.get(node as Element)?.mappedSurface;
        if (surface) {
          return surface;
        }
        node = node.parentNode;
      } else {
        break;
      }
    }
    return tokens.background;
  }

  private styleInspectedElement(element: Element, inspection: InspectedElement): void {
    const tokens = this.state.tokens;
    if (!tokens || !element.isConnected) {
      return;
    }

    if (isInsideEditable(element)) {
      this.cleanupElement(element, inspection);
      this.inspections.delete(element);
      return;
    }
    let surface = this.resolveParentSurface(element, tokens);
    const hostStyleChanged = inlineStyleSignature(element) !== inspection.hostStyleSignature;
    if (hostStyleChanged) {
      this.cleanupElement(element, inspection);
      this.inspections.delete(element);
      this.inspectAndStyle(element);
      return;
    }
    if (inspection.background) {
      const mapped = mapSurfaceColor(inspection.background, tokens);
      element.setAttribute(SURFACE_ATTRIBUTE, "");
      (element as HTMLElement).style.setProperty(ELEMENT_SURFACE_VARIABLE, mapped);
      surface = parseColorOrNull(mapped) ?? tokens.background;
      inspection.mappedSurface = surface;
    } else if (inspection.mappedSurface) {
      element.removeAttribute(SURFACE_ATTRIBUTE);
      (element as HTMLElement).style.removeProperty(ELEMENT_SURFACE_VARIABLE);
      inspection.mappedSurface = null;
    }

    if (inspection.text && inspection.hasDirectText && !isProtectedEditor(element)) {
      if (!element.matches(SKIP_TEXT_INSIDE)) {
        const key = rgbKey(inspection.text);
        const isUaLink = UA_LINK_COLORS.has(key) || UA_VISITED_COLORS.has(key);
        if (isUaLink && element.matches("a:any-link, a[href]")) {
          // Unstyled link: let the stylesheet apply link/visited colours.
          element.setAttribute(LINK_ATTRIBUTE, "");
          element.removeAttribute(TEXT_ATTRIBUTE);
          (element as HTMLElement).style.removeProperty(ELEMENT_TEXT_VARIABLE);
        } else {
          element.removeAttribute(LINK_ATTRIBUTE);
          element.setAttribute(TEXT_ATTRIBUTE, "");
          (element as HTMLElement).style.setProperty(
            ELEMENT_TEXT_VARIABLE,
            isUaLink
              ? rgbToCss(UA_VISITED_COLORS.has(key) ? tokens.visited : tokens.link)
              : mapTextColor(inspection.text, surface, tokens),
          );
        }
      } else {
        element.removeAttribute(TEXT_ATTRIBUTE);
        (element as HTMLElement).style.removeProperty(ELEMENT_TEXT_VARIABLE);
      }
    } else if (element.hasAttribute(TEXT_ATTRIBUTE) || element.hasAttribute(LINK_ATTRIBUTE)) {
      element.removeAttribute(LINK_ATTRIBUTE);
      element.removeAttribute(TEXT_ATTRIBUTE);
      (element as HTMLElement).style.removeProperty(ELEMENT_TEXT_VARIABLE);
    }

    this.styleBorders(element, inspection, surface, tokens);
    if (hostStyleChanged) {
      inspection.hostStyleSignature = inlineStyleSignature(element);
    }
  }

  private styleBorders(
    element: Element,
    inspection: InspectedElement,
    surface: Rgb,
    tokens: ThemeTokens,
  ): void {
    const style = (element as HTMLElement).style;
    const mapped = inspection.borders.map((color) =>
      color ? mapBorderColor(color, surface, tokens) : null,
    );
    const painted = BORDER_SIDES.filter((_, index) => mapped[index] !== null);
    for (const side of BORDER_SIDES) {
      style.removeProperty(side.variable);
    }
    if (painted.length === 0) {
      element.removeAttribute(BORDER_ATTRIBUTE);
      style.removeProperty(ELEMENT_BORDER_VARIABLE);
      return;
    }
    if (painted.length === 4 && mapped.every((value) => value === mapped[0])) {
      element.setAttribute(BORDER_ATTRIBUTE, "a");
      style.setProperty(ELEMENT_BORDER_VARIABLE, mapped[0] as string);
      return;
    }
    style.removeProperty(ELEMENT_BORDER_VARIABLE);
    BORDER_SIDES.forEach((side, index) => {
      const value = mapped[index];
      if (value) {
        style.setProperty(side.variable, value);
      }
    });
    element.setAttribute(BORDER_ATTRIBUTE, painted.map((side) => side.key).join(" "));
  }

  private attachShadowStyle(root: ShadowRoot): void {
    if (this.shadowStyles.has(root)) {
      return;
    }
    const style = this.doc.createElement("style");
    style.setAttribute(IGNORE_ATTRIBUTE, "");
    style.setAttribute("data-darkr-shadow-style", "");
    style.textContent = buildShadowCss();
    root.append(style);
    root.host.setAttribute("data-darkr-shadow", "");
    this.shadowStyles.set(root, style);
    this.observeShadowRoot(root);
  }

  private observeShadowRoot(root: ShadowRoot): void {
    if (this.shadowObservers.has(root)) {
      return;
    }
    const observer = new MutationObserver((records) => {
      this.handleMutations(records);
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "open", "style", "contenteditable", "role"],
    });
    this.shadowObservers.set(root, observer);
  }

  private clearShadowStyles(): void {
    for (const observer of this.shadowObservers.values()) {
      observer.disconnect();
    }
    this.shadowObservers.clear();
    for (const [root, style] of this.shadowStyles) {
      style.remove();
      root.host.removeAttribute("data-darkr-shadow");
    }
    this.shadowStyles.clear();
  }

  private ensureObserver(): void {
    if (this.observer) {
      return;
    }
    this.observer = new MutationObserver((records) => {
      this.handleMutations(records);
    });
    this.observer.observe(this.doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "open", "style", "contenteditable", "role"],
    });
  }

  private handleMutations(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.target === this.style) {
        continue;
      }
      if (record.type === "attributes" && record.attributeName === "style") {
        const target = record.target as Element;
        const inspection = this.inspections.get(target);
        if (inspection) {
          const signature = inlineStyleSignature(target);
          if (signature !== inspection.hostStyleSignature) {
            // Re-sample in place, synchronously: the observer callback runs
            // before the next paint, so the element never shows the author's
            // colours in between.
            this.cleanupElement(target, inspection);
            this.inspections.delete(target);
            this.inspectAndStyle(target);
          }
        } else if (target.isConnected && !target.hasAttribute(IGNORE_ATTRIBUTE)) {
          // Never inspected, typically because it was hidden during the scan
          // and a script just revealed it through an inline style.
          this.queuedElements.add(target);
        }
        continue;
      }
      if (record.type === "attributes") {
        const target = record.target;
        if (target.nodeType === Node.ELEMENT_NODE && target !== this.doc.documentElement) {
          // A class/hidden/open toggle on a large container (scroll locks,
          // theme classes) must not re-walk everything already inspected.
          this.queueSubtree(
            target as Element,
            record.attributeName !== "contenteditable" && record.attributeName !== "role",
          );
          if (record.attributeName === "class") {
            this.markForResample(target as Element);
          }
        }
        continue;
      }

      for (const node of record.removedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          this.cleanupSubtree(node as Element);
          this.removalsSincePrune += 1;
        }
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (!element.hasAttribute(IGNORE_ATTRIBUTE)) {
            this.queueSubtree(element);
          }
        } else if (
          node.nodeType === Node.TEXT_NODE &&
          record.target.nodeType === Node.ELEMENT_NODE
        ) {
          const parent = record.target as Element;
          const inspection = this.inspections.get(parent);
          if (inspection) {
            inspection.hasDirectText = hasDirectText(parent);
          }
          if (!parent.hasAttribute(IGNORE_ATTRIBUTE)) {
            this.queuedElements.add(parent);
          }
        }
      }
    }
    if (this.removalsSincePrune >= PRUNE_AFTER_REMOVALS) {
      this.pruneDetached();
    }
    if (this.queuedElements.size > 0) {
      this.scheduleBatchWork();
    }
  }

  /**
   * Drops bookkeeping for elements that left the document without being
   * reported, such as descendants inside shadow trees of removed hosts. The
   * maps hold strong references, so without this they would pin detached DOM.
   */
  private pruneDetached(): void {
    this.removalsSincePrune = 0;
    for (const element of this.inspections.keys()) {
      if (!element.isConnected) {
        this.inspections.delete(element);
      }
    }
    for (const element of this.queuedElements) {
      if (!element.isConnected) {
        this.queuedElements.delete(element);
      }
    }
    for (const root of [...this.shadowStyles.keys()]) {
      if (!root.host.isConnected) {
        this.removeShadowStyle(root);
      }
    }
  }

  private stopObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private queueSubtree(root: Element, onlyUninspected = false): void {
    if (
      root.hasAttribute(IGNORE_ATTRIBUTE) ||
      root.tagName === "SCRIPT" ||
      root.tagName === "STYLE"
    ) {
      return;
    }
    this.queuedElements.add(root);
    for (const child of this.collectElements(root).slice(1)) {
      if (onlyUninspected && this.inspections.has(child)) {
        continue;
      }
      if (child.isConnected && !child.hasAttribute(IGNORE_ATTRIBUTE)) {
        this.queuedElements.add(child);
      }
    }
  }

  private scheduleBatchWork(): void {
    if (this.batchHandle !== null) {
      return;
    }
    this.batchHandle = this.win.requestAnimationFrame(() => {
      this.batchHandle = null;
      this.processQueuedBatch();
    });
  }

  private processQueuedBatch(): void {
    const batch = [...this.queuedElements].slice(0, BATCH_SIZE);
    for (const element of batch) {
      this.queuedElements.delete(element);
    }
    this.resampleFlagged(batch);
    for (const element of batch) {
      this.inspectAndStyle(element);
    }
    if (this.queuedElements.size > 0) {
      this.scheduleBatchWork();
    }
  }

  private scheduleIdleWork(): void {
    if (this.idleHandle !== null) {
      return;
    }
    const process = (deadline?: { timeRemaining(): number }) => {
      this.idleHandle = null;
      const start = Date.now();
      const max = deadline ? 10 : 8;
      while (
        this.queuedElements.size > 0 &&
        Date.now() - start < max &&
        (!deadline || deadline.timeRemaining() > 1)
      ) {
        const next = this.queuedElements.values().next().value as Element | undefined;
        if (!next) {
          break;
        }
        this.queuedElements.delete(next);
        this.resampleFlagged([next]);
        this.inspectAndStyle(next);
      }
      if (this.queuedElements.size > 0) {
        this.scheduleIdleWork();
      }
    };

    if (this.win.requestIdleCallback) {
      this.idleHandle = this.win.requestIdleCallback(process, { timeout: 350 });
    } else {
      this.idleHandle = this.win.setTimeout(() => process(), 32) as unknown as number;
    }
  }

  private cleanupSubtree(root: Element): void {
    const forget = (element: Element): void => {
      this.queuedElements.delete(element);
      this.resampleQueue.delete(element);
      const inspection = this.inspections.get(element);
      if (inspection) {
        // The node may be re-inserted elsewhere (a move reports a removal and
        // an addition). Strip our overrides so it is re-inspected from its
        // original author colors instead of from Darkr's mapped ones.
        this.cleanupElement(element, inspection);
        this.inspections.delete(element);
      }
      if (element.shadowRoot) {
        this.removeShadowStyle(element.shadowRoot);
      }
    };
    forget(root);
    for (const child of root.querySelectorAll("*")) {
      forget(child);
    }
  }

  private removeShadowStyle(root: ShadowRoot): void {
    this.shadowObservers.get(root)?.disconnect();
    this.shadowObservers.delete(root);
    this.shadowStyles.get(root)?.remove();
    this.shadowStyles.delete(root);
    root.host.removeAttribute("data-darkr-shadow");
  }

  private cleanupElement(element: Element, _inspection: InspectedElement): void {
    element.removeAttribute(SURFACE_ATTRIBUTE);
    element.removeAttribute(TEXT_ATTRIBUTE);
    element.removeAttribute(LINK_ATTRIBUTE);
    element.removeAttribute(BORDER_ATTRIBUTE);
    const htmlElement = element as HTMLElement;
    htmlElement.style.removeProperty(ELEMENT_SURFACE_VARIABLE);
    htmlElement.style.removeProperty(ELEMENT_TEXT_VARIABLE);
    htmlElement.style.removeProperty(ELEMENT_BORDER_VARIABLE);
    for (const side of BORDER_SIDES) {
      htmlElement.style.removeProperty(side.variable);
    }
  }

  private clearElements(): void {
    for (const [element, inspection] of this.inspections) {
      this.cleanupElement(element, inspection);
    }
    this.inspections.clear();
    this.queuedElements.clear();
    this.resampleQueue.clear();
    this.removalsSincePrune = 0;
  }

  private cancelScheduledWork(): void {
    if (this.batchHandle !== null) {
      this.win.cancelAnimationFrame(this.batchHandle);
      this.batchHandle = null;
    }
    if (this.idleHandle !== null) {
      if (this.win.cancelIdleCallback) {
        this.win.cancelIdleCallback(this.idleHandle);
      } else {
        this.win.clearTimeout(this.idleHandle);
      }
      this.idleHandle = null;
    }
  }
}

export const themeEngineTestUtilities = {
  detectNativeDark,
  buildDocumentCss,
  buildShadowCss,
  STYLE_ID,
  ROOT_CLASS,
  SEMANTIC_CLASS,
  GRAYSCALE_CLASS,
};
