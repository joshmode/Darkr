import { buildThemeTokens, themeVariables, type ThemeTokens } from "../shared/theme";
import { ElementRecords } from "./records";
import {
  PAGE_SURFACE,
  Palette,
  type PaletteEntry,
  type PaletteRole,
  type SurfaceRef,
  fixedSurface,
} from "./palette";
import type { ThemeConfig } from "../shared/types";
import { opaqueColor, parseColorOrNull } from "./color-map";
import {
  contrastRatio,
  isPainted,
  mixRgb,
  relativeLuminance,
  rgbToCss,
  type Rgb,
  type Rgba,
} from "../shared/color";
import { themeConfigsEqual } from "../shared/config";

const STYLE_ID = "darkr-theme-styles";
/**
 * Active state lives in one attribute on <html>: "semantic" or "grayscale".
 * Page scripts routinely reset `className`, which used to wipe the theme.
 */
const ROOT_ATTRIBUTE = "data-darkr";
const SEMANTIC_VALUE = "semantic";
const GRAYSCALE_VALUE = "grayscale";
const SEMANTIC_ROOT = `:root[${ROOT_ATTRIBUTE}="${SEMANTIC_VALUE}"]`;
const GRAYSCALE_ROOT = `:root[${ROOT_ATTRIBUTE}="${GRAYSCALE_VALUE}"]`;
const IGNORE_ATTRIBUTE = "data-darkr-ignore";
/**
 * Elements carry their themed colours as tokens in one `data-darkr` attribute
 * (`s3` surface, `t7` text, `ba2` all borders, `bt4 bb5` single sides, `f1` fill,
 * `k1` stroke) plus the flags `l` (unstyled link) and `h` (drop text-shadow).
 * The root element uses the same attribute for the active state.
 */
/** Attributes whose change can reveal, hide or recolour content. */
const OBSERVED_ATTRIBUTES = [
  "class",
  "hidden",
  "open",
  "style",
  "contenteditable",
  "role",
  "aria-expanded",
  "aria-hidden",
  "data-state",
];
const RESAMPLE_ATTRIBUTES = new Set(["class", "aria-expanded", "aria-hidden", "data-state"]);
const ROOT_WATCHED_ATTRIBUTES = [ROOT_ATTRIBUTE, "class", "data-theme", "data-color-mode", "style"];
const REDETECT_DELAY_MS = 150;
const SHADOW_SWEEP_DELAY_MS = 800;
/** jsdom cannot compute pseudo-element styles (it logs "not implemented"). */
const SAMPLE_PSEUDO = typeof navigator === "undefined" || !/jsdom/i.test(navigator.userAgent);
const ELEMENT_ATTRIBUTE = "data-darkr";
const LINK_TOKEN = "l";
const NO_SHADOW_TOKEN = "h";
const BORDER_SIDES = [
  { property: "Top", role: "bt" },
  { property: "Right", role: "br" },
  { property: "Bottom", role: "bb" },
  { property: "Left", role: "bl" },
] as const;
const INITIAL_ELEMENT_BUDGET = 700;
const BATCH_SIZE = 180;
const IDLE_SLICE_SIZE = 400;
const NATIVE_DARK_THRESHOLD = 0.18;
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
  /** SVG paint (computed fill / stroke); null outside SVG or when `none`. */
  fill: Rgba | null;
  stroke: Rgba | null;
  /** Painted colour per side (top, right, bottom, left); null when not painted. */
  borders: [Rgba | null, Rgba | null, Rgba | null, Rgba | null];
  hasDirectText: boolean;
  /** Own colours of ::before / ::after when they generate content. */
  pseudo: { before: PseudoSample | null; after: PseudoSample | null };
  /** The surface this element paints (own background or backdrop), if any. */
  surface: SurfaceInfo | null;
  /**
   * A gradient or translucent background Darkr does not remap. Text on it is
   * mapped against what is really painted, not against the page surface.
   */
  backdrop: Backdrop | null;
  /** Keep inline edits from the host page instead of overriding them forever. */
  hostStyleSignature: string;
  samples: {
    background: string;
    backgroundImage: string;
    text: string;
    paint: string;
    textShadow: string;
    pseudo: string;
    borders: string;
    display: string;
    visibility: string;
    opacity: string;
  };
}

interface PseudoSample {
  background: Rgba | null;
  text: Rgba | null;
  border: Rgba | null;
}

interface SurfaceInfo {
  ref: SurfaceRef;
  color: Rgb;
}

type Backdrop =
  | { kind: "gradient"; color: Rgb }
  | { kind: "translucent"; color: Rgb; alpha: number };

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

function sampleStyle(style: CSSStyleDeclaration): InspectedElement["samples"] {
  return {
    background: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    text: style.color,
    paint: `${style.fill}|${style.stroke}`,
    textShadow: style.textShadow,
    pseudo: "",
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
    left.backgroundImage === right.backgroundImage &&
    left.text === right.text &&
    left.paint === right.paint &&
    left.textShadow === right.textShadow &&
    left.pseudo === right.pseudo &&
    left.borders === right.borders &&
    left.display === right.display &&
    left.visibility === right.visibility &&
    left.opacity === right.opacity
  );
}

/** Number of ancestors, crossing shadow boundaries. */
function parentElementOf(element: Element): Element | null {
  return element.parentElement ?? (element.getRootNode() as ShadowRoot).host ?? null;
}

function nodeDepth(element: Element): number {
  let depth = 0;
  let node: Node | null = element.parentNode;
  while (node) {
    depth += 1;
    node = node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return depth;
}

/** Tag names compare case-insensitively: SVG and MathML report lowercase. */
function isSkippedElement(element: Element): boolean {
  return SKIP_SUBTREES.has(element.localName.toUpperCase());
}

function hasBorderStyle(value: string): boolean {
  return value !== "none" && value !== "hidden";
}

/** A colour worth mapping: parseable and actually painted (alpha >= 0.05). */
/** Mean of the colour stops in a computed gradient `background-image`. */
function gradientColor(value: string): Rgb | null {
  if (!value.includes("gradient(")) {
    return null;
  }
  const stops = (value.match(/rgba?\([^)]*\)/g) ?? [])
    .map((stop) => parseColorOrNull(stop))
    .filter((color): color is Rgba => color !== null && color.a > 0);
  if (stops.length === 0) {
    return null;
  }
  const mean = (channel: "r" | "g" | "b") =>
    stops.reduce((sum, color) => sum + color[channel], 0) / stops.length;
  return { r: mean("r"), g: mean("g"), b: mean("b") };
}

function readBackdrop(samples: InspectedElement["samples"]): Backdrop | null {
  const gradient = gradientColor(samples.backgroundImage);
  if (gradient) {
    return { kind: "gradient", color: gradient };
  }
  const background = parseColorOrNull(samples.background);
  if (background && isPainted(background) && background.a < 0.82) {
    return { kind: "translucent", color: background, alpha: background.a };
  }
  return null;
}

function inspectableColor(value: string): Rgba | null {
  const color = parseColorOrNull(value);
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
${SEMANTIC_ROOT} {
  ${variables}
  background-color: var(--darkr-bg) !important;
  color-scheme: var(--darkr-scheme) !important;
  accent-color: var(--darkr-link);
  scrollbar-color: var(--darkr-border) var(--darkr-bg);
}
${SEMANTIC_ROOT} body {
  background-color: var(--darkr-bg) !important;
  color: var(--darkr-text) !important;
}
${SEMANTIC_ROOT} :is(${EDITABLE_SELECTOR}) :where(*),
${SEMANTIC_ROOT}[${DESIGN_MODE_ATTRIBUTE}] body :where(*) {
  color: inherit !important;
  background-color: transparent !important;
}
/* Links the author left unstyled. Author-coloured links are sampled like any
   other text. */
${SEMANTIC_ROOT} [${ELEMENT_ATTRIBUTE}~="${LINK_TOKEN}"] {
  color: var(--darkr-link) !important;
}
${SEMANTIC_ROOT} [${ELEMENT_ATTRIBUTE}~="${LINK_TOKEN}"]:visited {
  color: var(--darkr-visited) !important;
}
/* Things sampling cannot reach. */
${SEMANTIC_ROOT} :where(input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"]) {
  accent-color: var(--darkr-link);
}
${SEMANTIC_ROOT} :where(input, textarea)::placeholder {
  color: var(--darkr-muted) !important;
  opacity: 1 !important;
}
${SEMANTIC_ROOT} :where(input, textarea):-webkit-autofill {
  -webkit-text-fill-color: var(--darkr-input-text) !important;
  box-shadow: 0 0 0 1000px var(--darkr-input-bg) inset !important;
}
${SEMANTIC_ROOT} dialog::backdrop {
  background: rgb(0 0 0 / 62%) !important;
}
${SEMANTIC_ROOT} ::selection {
  background: var(--darkr-selection) !important;
  color: var(--darkr-text) !important;
}
${SEMANTIC_ROOT} [${ELEMENT_ATTRIBUTE}~="${NO_SHADOW_TOKEN}"] {
  text-shadow: none !important;
}
${GRAYSCALE_ROOT} {
  filter: grayscale(var(--darkr-grayscale)) !important;
}
}
`;
}

function buildShadowCss(): string {
  return `@media screen {
:host {
  color: var(--darkr-text, #f4f1ea);
}
:host [${ELEMENT_ATTRIBUTE}~="${NO_SHADOW_TOKEN}"] { text-shadow: none !important; }
}
`;
}

export class ThemeEngine {
  private readonly doc: Document;
  private readonly win: IdleWindow;
  private readonly inspections = new ElementRecords<InspectedElement>();
  private bodyAuthor: { text: Rgba | null; fill: Rgba | null; stroke: Rgba | null } | null = null;
  private readonly shadowStyles = new Map<ShadowRoot, HTMLStyleElement>();
  private readonly shadowObservers = new Map<ShadowRoot, MutationObserver>();
  private readonly queuedElements = new Set<Element>();
  private observer: MutationObserver | null = null;
  private rootObserver: MutationObserver | null = null;
  private desiredRootValue: string | null = null;
  private redetectTimer: number | null = null;
  private shadowSweepTimer: number | null = null;
  private style: HTMLStyleElement | null = null;
  private readonly palette = new Palette();
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
    this.palette.onAdd = (entry) => this.appendPaletteRule(entry);
  }

  /** The CSS colour Darkr currently paints for one role of an element (tests/debugging). */
  paletteValue(element: Element, role: PaletteRole): string | null {
    for (const token of (element.getAttribute(ELEMENT_ATTRIBUTE) ?? "").split(" ")) {
      const entry = this.palette.byToken(token);
      if (entry && token === entry.token && entry.role === role) {
        return entry.value;
      }
    }
    return null;
  }

  get status(): {
    active: boolean;
    semanticActive: boolean;
    nativeDark: boolean;
    mode: ThemeConfig["mode"];
  } {
    return {
      active: this.doc.documentElement.hasAttribute(ROOT_ATTRIBUTE) && this.state.config !== null,
      semanticActive: this.doc.documentElement.getAttribute(ROOT_ATTRIBUTE) === SEMANTIC_VALUE,
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
      this.ensureRootObserver();
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

    this.palette.setTokens(tokens);

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
    this.desiredRootValue = isSemantic ? SEMANTIC_VALUE : GRAYSCALE_VALUE;
    root.setAttribute(ROOT_ATTRIBUTE, this.desiredRootValue);
    root.toggleAttribute(DESIGN_MODE_ATTRIBUTE, this.doc.designMode === "on");
    this.ensureRootObserver();

    if (isSemantic) {
      this.ensureObserver();
    } else {
      this.stopObserver();
      this.clearElements();
    }
  }

  clear(): void {
    this.bodyAuthor = null;
    this.stopRootObserver();
    this.teardownPageRendering();
    this.state = {
      config: null,
      overrideNativeDark: false,
      tokens: null,
      nativeDark: false,
      hasApplied: false,
    };
  }

  /**
   * Watches the root and body for page code that undoes or invalidates the
   * theme: attribute resets, removal of Darkr's stylesheet, and the page
   * switching its own light/dark theme after load.
   */
  private ensureRootObserver(): void {
    if (!this.rootObserver) {
      this.rootObserver = new MutationObserver((records) => {
        let heal = false;
        let redetect = false;
        for (const record of records) {
          if (record.type === "childList") {
            heal = true;
            if (record.target === this.doc.documentElement) {
              this.observeBody();
            }
          } else if (record.attributeName === ROOT_ATTRIBUTE) {
            heal = true;
          } else {
            redetect = true;
          }
        }
        if (heal) {
          this.healRoot();
        }
        if (redetect) {
          this.scheduleRedetect();
        }
      });
    }
    const options = { attributes: true, attributeFilter: ROOT_WATCHED_ATTRIBUTES };
    this.rootObserver.observe(this.doc.documentElement, { ...options, childList: true });
    if (this.doc.head) {
      this.rootObserver.observe(this.doc.head, { childList: true });
    }
    this.observeBody();
  }

  private observeBody(): void {
    if (this.rootObserver && this.doc.body) {
      this.rootObserver.observe(this.doc.body, {
        attributes: true,
        attributeFilter: ROOT_WATCHED_ATTRIBUTES,
      });
    }
  }

  private stopRootObserver(): void {
    this.rootObserver?.disconnect();
    this.rootObserver = null;
    if (this.shadowSweepTimer !== null) {
      this.win.clearTimeout(this.shadowSweepTimer);
      this.shadowSweepTimer = null;
    }
    if (this.redetectTimer !== null) {
      this.win.clearTimeout(this.redetectTimer);
      this.redetectTimer = null;
    }
  }

  /** Puts back the root attribute or stylesheet when page code removed them. */
  private healRoot(): void {
    const tokens = this.state.tokens;
    if (!tokens || this.desiredRootValue === null) {
      return;
    }
    const root = this.doc.documentElement;
    if (root.getAttribute(ROOT_ATTRIBUTE) !== this.desiredRootValue) {
      root.setAttribute(ROOT_ATTRIBUTE, this.desiredRootValue);
    }
    if (!this.style?.isConnected) {
      this.style = null;
      this.installStyle(tokens);
    }
  }

  private scheduleRedetect(): void {
    if (this.redetectTimer !== null) {
      return;
    }
    this.redetectTimer = this.win.setTimeout(() => {
      this.redetectTimer = null;
      this.redetectNativeDark();
    }, REDETECT_DELAY_MS);
  }

  /**
   * Native-dark detection normally runs once. A page that applies or toggles
   * its own dark theme later changes root/body attributes; re-run detection
   * with Darkr's rules off and switch between theming and standing down.
   */
  private redetectNativeDark(): void {
    const config = this.state.config;
    if (
      !config ||
      !this.state.tokens ||
      config.mode === "grayscale" ||
      this.state.overrideNativeDark
    ) {
      return;
    }
    const root = this.doc.documentElement;
    const value = root.getAttribute(ROOT_ATTRIBUTE);
    if (value !== null) {
      root.removeAttribute(ROOT_ATTRIBUTE);
    }
    let nativeDark: boolean;
    try {
      nativeDark = detectNativeDark(this.doc);
    } finally {
      if (value !== null) {
        root.setAttribute(ROOT_ATTRIBUTE, value);
      }
    }
    if (nativeDark !== this.state.nativeDark) {
      this.refresh();
    }
  }

  private teardownPageRendering(): void {
    this.stopObserver();
    this.cancelScheduledWork();
    this.clearElements();
    this.clearShadowStyles();
    this.style?.remove();
    this.style = null;
    this.palette.clear();

    const root = this.doc.documentElement;
    root.removeAttribute(ROOT_ATTRIBUTE);
    this.desiredRootValue = null;
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
    this.stopRootObserver();
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
    this.processElements(queued);
  }

  /**
   * Shadow roots can be attached after their host was inspected, and the DOM
   * offers no event for it. After the page changes, look again (debounced) at
   * inspected elements that now have an unstyled shadow root.
   */
  private scheduleShadowSweep(): void {
    if (this.shadowSweepTimer !== null) {
      return;
    }
    this.shadowSweepTimer = this.win.setTimeout(() => {
      this.shadowSweepTimer = null;
      if (!this.state.tokens || this.state.config?.mode === "grayscale") {
        return;
      }
      for (const element of this.inspections.keys()) {
        const root = element.shadowRoot;
        if (root && !this.shadowStyles.has(root)) {
          this.attachShadowStyle(root);
          for (const child of root.children) {
            this.queueSubtree(child);
          }
        }
      }
      if (this.queuedElements.size > 0) {
        this.scheduleBatchWork();
      }
    }, SHADOW_SWEEP_DELAY_MS);
  }

  private paletteCss(scope: string): string {
    return this.palette
      .rules(scope)
      .map((css) => `@media screen { ${css} }`)
      .join("\n");
  }

  private appendPaletteRule(entry: PaletteEntry): void {
    if (this.style) {
      this.insertRule(this.style, `@media screen { ${this.palette.rule(SEMANTIC_ROOT, entry)} }`);
    }
    for (const style of this.shadowStyles.values()) {
      this.insertRule(style, `@media screen { ${this.palette.rule(":host", entry)} }`);
    }
  }

  private insertRule(style: HTMLStyleElement, css: string): void {
    try {
      const sheet = style.sheet;
      if (sheet) {
        sheet.insertRule(css, sheet.cssRules.length);
        return;
      }
    } catch {
      // Fall through to the text fallback.
    }
    style.append(this.doc.createTextNode(`\n${css}`));
  }

  private installStyle(tokens: ThemeTokens): void {
    if (!this.style) {
      this.style = this.doc.createElement("style");
      this.style.id = STYLE_ID;
      this.style.setAttribute(IGNORE_ATTRIBUTE, "");
      (this.doc.head ?? this.doc.documentElement).append(this.style);
    }
    this.style.textContent = buildDocumentCss(tokens) + this.paletteCss(SEMANTIC_ROOT);
    for (const style of this.shadowStyles.values()) {
      style.textContent = buildShadowCss() + this.paletteCss(":host");
    }
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
        this.cleanupElement(element);
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
    const initial: Element[] = [];
    const stack: Element[] = [this.doc.documentElement];
    while (stack.length > 0) {
      const element = stack.pop();
      if (!element || element.hasAttribute(IGNORE_ATTRIBUTE) || isSkippedElement(element)) {
        continue;
      }
      if (initial.length < INITIAL_ELEMENT_BUDGET) {
        initial.push(element);
      } else {
        // Bounded: on documents with hundreds of thousands of nodes the queue
        // itself would otherwise pin every element in memory.
        this.queuedElements.add(element);
      }
      if (element.shadowRoot) {
        this.attachShadowStyle(element.shadowRoot);
        // Top-level shadow children only; nested content is reached by the
        // walk itself, so no node is visited twice.
        for (
          let child = element.shadowRoot.lastElementChild;
          child;
          child = child.previousElementSibling
        ) {
          stack.push(child);
        }
      }
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) {
        stack.push(child);
      }
    }
    // One batched read/write for everything above the fold, document order.
    this.processElements(initial);
    this.scheduleShadowSweep();
    if (this.queuedElements.size > 0) {
      this.prioritiseViewport();
      this.scheduleIdleWork();
    }
  }

  /**
   * Moves queued elements inside (or near) the viewport to the front, so a
   * long page restored at a scroll position is themed where the user is
   * looking before the rest. Only coarse containers (two levels under body)
   * are measured, so the cost does not grow with the element count.
   */
  private prioritiseViewport(): void {
    const body = this.doc.body;
    if (!body || this.queuedElements.size < INITIAL_ELEMENT_BUDGET) {
      return;
    }
    const height = this.win.innerHeight || 800;
    const near: Element[] = [];
    for (const child of body.children) {
      const blocks = child.children.length > 1 ? [...child.children] : [child];
      for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        if (rect.bottom > -height && rect.top < height * 2) {
          near.push(block);
        }
      }
    }
    if (near.length === 0) {
      return;
    }
    const priority = new Set<Element>();
    for (const block of near) {
      if (this.queuedElements.has(block)) {
        priority.add(block);
      }
      for (const element of block.querySelectorAll("*")) {
        if (this.queuedElements.has(element)) {
          priority.add(element);
        }
      }
    }
    if (priority.size === 0 || priority.size === this.queuedElements.size) {
      return;
    }
    const rest = [...this.queuedElements].filter((element) => !priority.has(element));
    this.queuedElements.clear();
    for (const element of priority) {
      this.queuedElements.add(element);
    }
    for (const element of rest) {
      this.queuedElements.add(element);
    }
  }

  private collectElements(root: Element): Element[] {
    const elements: Element[] = [];
    const stack: Element[] = [root];
    while (stack.length > 0) {
      const element = stack.pop();
      if (!element || element.hasAttribute(IGNORE_ATTRIBUTE) || isSkippedElement(element)) {
        continue;
      }
      elements.push(element);
      if (element.shadowRoot) {
        this.attachShadowStyle(element.shadowRoot);
        for (
          let child = element.shadowRoot.lastElementChild;
          child;
          child = child.previousElementSibling
        ) {
          stack.push(child);
        }
      }
      for (let child = element.lastElementChild; child; child = child.previousElementSibling) {
        stack.push(child);
      }
    }
    return elements;
  }

  /**
   * Inspects and styles a batch in three phases so layout is never forced
   * between writes: (1) with Darkr's rules switched off, read every computed
   * value the batch needs (this also keeps late elements from sampling
   * Darkr's own colours); (2) the rules go back on; (3) compute and write,
   * parents before children.
   */
  private processElements(elements: Iterable<Element>): void {
    if (!this.state.tokens) {
      return;
    }
    const batch: Element[] = [];
    for (const element of elements) {
      if (this.prepareElement(element)) {
        batch.push(element);
      }
    }
    if (batch.length === 0) {
      return;
    }

    // Flagged elements (class swaps) need the page's own colours, so those
    // batches read with Darkr's rules off. Every other batch reads with the
    // rules on and corrects inherited values from the records instead: a
    // document-wide switch costs two full style recalculations per batch.
    const needsCleanRead = batch.some((element) => this.resampleQueue.has(element));
    const read = () => {
      const fresh = new Map<Element, InspectedElement>();
      const resampled = new Map<Element, InspectedElement>();
      for (const element of batch) {
        const flagged = this.resampleQueue.delete(element);
        const known = this.inspections.has(element);
        if (!known || flagged) {
          const inspection = this.buildInspection(
            element,
            getComputedStyle(element),
            !needsCleanRead,
          );
          (known ? resampled : fresh).set(element, inspection);
        }
      }
      return { fresh, resampled };
    };
    const reads = needsCleanRead ? this.readAuthorStyles(read) : read();

    for (const [element, next] of reads.resampled) {
      const previous = this.inspections.get(element);
      if (
        previous &&
        (!samplesEqual(previous.samples, next.samples) ||
          previous.hasDirectText !== next.hasDirectText)
      ) {
        next.surface = previous.surface;
        this.inspections.set(element, next);
      }
    }
    for (const [element, inspection] of reads.fresh) {
      this.inspections.set(element, inspection);
    }

    // Parents first, so a child resolves its surface from an up-to-date record.
    const ordered = batch
      .map((element) => ({ element, depth: nodeDepth(element) }))
      .sort((left, right) => left.depth - right.depth);
    for (const { element } of ordered) {
      const inspection = this.inspections.get(element);
      if (inspection) {
        this.styleInspectedElement(element, inspection);
        if (element.shadowRoot) {
          this.attachShadowStyle(element.shadowRoot);
        }
      }
    }
  }

  /** Single-element convenience for mutation handlers. */
  private inspectAndStyle(element: Element): void {
    this.processElements([element]);
  }

  /** Filters elements the engine never touches; cleans up newly editable ones. */
  private prepareElement(element: Element): boolean {
    if (
      !element.isConnected ||
      element.hasAttribute(IGNORE_ATTRIBUTE) ||
      element.tagName === "HTML" ||
      element.tagName === "BODY"
    ) {
      return false;
    }
    if (isInsideEditable(element)) {
      if (this.inspections.has(element)) {
        this.cleanupElement(element);
        this.inspections.delete(element);
      }
      return false;
    }
    return this.inspections.has(element) || !isSkippedElement(element);
  }

  /**
   * ::before / ::after that generate content (custom checkboxes, dividers,
   * overlays) are styled separately from their element. Only pseudo-elements
   * that actually have content are sampled, and a text colour only when it
   * differs from the element's own (otherwise it inherits the themed colour).
   */
  private readPseudo(element: Element, style: CSSStyleDeclaration): InspectedElement["pseudo"] {
    if (!SAMPLE_PSEUDO) {
      return { before: null, after: null };
    }
    const read = (which: "::before" | "::after"): PseudoSample | null => {
      const pseudo = getComputedStyle(element, which);
      if (pseudo.content === "none" || pseudo.content === "normal" || pseudo.display === "none") {
        return null;
      }
      const background = opaqueColor(pseudo.backgroundColor);
      const text = pseudo.color !== style.color ? inspectableColor(pseudo.color) : null;
      const border =
        hasBorderStyle(pseudo.borderTopStyle) && pseudo.borderTopWidth !== "0px"
          ? inspectableColor(pseudo.borderTopColor)
          : null;
      return background || text || border ? { background, text, border } : null;
    };
    return { before: read("::before"), after: read("::after") };
  }

  /**
   * `contaminated` is true when Darkr's rules are active during the read.
   * Inherited properties (colour, SVG paint) of an element that merely
   * inherits then show Darkr's mapped value, so they are replaced by the
   * author's original taken from the parent's record. Properties an element
   * declares itself are unaffected.
   */
  private buildInspection(
    element: Element,
    style: CSSStyleDeclaration,
    contaminated = false,
  ): InspectedElement {
    const textControl = element.matches(NON_TEXT_CONTROL_SELECTOR);
    const isSvg = element instanceof SVGElement;
    const samples = sampleStyle(style);
    const pseudo = this.readPseudo(element, style);
    samples.pseudo = JSON.stringify(pseudo);
    const parent = contaminated ? parentElementOf(element) : null;
    const parentStyle = parent ? getComputedStyle(parent) : null;
    const original = (
      key: "text" | "fill" | "stroke",
      own: string,
      inherited: string | undefined,
    ) =>
      parent && parentStyle && inherited === own ? this.authorInherited(parent, key) : undefined;
    const text = textControl
      ? null
      : (original("text", samples.text, parentStyle?.color) ?? inspectableColor(samples.text));
    const fill = isSvg
      ? (original("fill", style.fill, parentStyle?.fill) ?? inspectableColor(style.fill))
      : null;
    const stroke = isSvg
      ? (original("stroke", style.stroke, parentStyle?.stroke) ?? inspectableColor(style.stroke))
      : null;
    return {
      background: opaqueColor(samples.background),
      text,
      fill,
      stroke,
      borders: BORDER_SIDES.map((side) =>
        hasBorderStyle(style[`border${side.property}Style`])
          ? inspectableColor(style[`border${side.property}Color`])
          : null,
      ) as InspectedElement["borders"],
      hasDirectText: !textControl && hasDirectText(element),
      pseudo,
      surface: null,
      backdrop: readBackdrop(samples),
      hostStyleSignature: inlineStyleSignature(element),
      samples,
    };
  }

  /**
   * Runs `read` with Darkr's semantic rules switched off so computed styles
   * are the page's own. The switch is synchronous, so nothing paints between.
   */
  /** The author's value of an inherited property for `node`'s subtree. */
  private authorInherited(node: Element, key: "text" | "fill" | "stroke"): Rgba | null | undefined {
    for (let element: Element | null = node; element; element = parentElementOf(element)) {
      const inspection = this.inspections.get(element);
      if (inspection) {
        return inspection[key];
      }
      if (element === this.doc.body || element === this.doc.documentElement) {
        return this.getBodyAuthor()[key];
      }
    }
    return undefined;
  }

  private getBodyAuthor(): { text: Rgba | null; fill: Rgba | null; stroke: Rgba | null } {
    if (!this.bodyAuthor) {
      this.bodyAuthor = this.readAuthorStyles(() => {
        const style = getComputedStyle(this.doc.body ?? this.doc.documentElement);
        return {
          text: inspectableColor(style.color),
          fill: inspectableColor(style.fill),
          stroke: inspectableColor(style.stroke),
        };
      });
    }
    return this.bodyAuthor;
  }

  private setShadowSheetsDisabled(disabled: boolean): void {
    for (const style of this.shadowStyles.values()) {
      if (style.sheet) {
        style.sheet.disabled = disabled;
      }
    }
  }

  private readAuthorStyles<T>(read: () => T): T {
    const root = this.doc.documentElement;
    const wasSemantic = root.getAttribute(ROOT_ATTRIBUTE) === SEMANTIC_VALUE;
    if (wasSemantic) {
      root.removeAttribute(ROOT_ATTRIBUTE);
      // Shadow rules cannot see the root attribute, so switch their sheets off.
      this.setShadowSheetsDisabled(true);
    }
    try {
      return read();
    } finally {
      if (wasSemantic) {
        this.setShadowSheetsDisabled(false);
        root.setAttribute(ROOT_ATTRIBUTE, SEMANTIC_VALUE);
      }
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
  private resolveParentSurface(element: Element): SurfaceInfo {
    let node: Node | null = element.parentNode;
    while (node) {
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host) {
        node = (node as ShadowRoot).host;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const surface = this.inspections.get(node as Element)?.surface;
        if (surface) {
          return surface;
        }
      } else {
        break;
      }
      node = node.parentNode;
    }
    return { ref: PAGE_SURFACE, color: this.palette.surfaceColor(PAGE_SURFACE) };
  }

  private styleInspectedElement(element: Element, inspection: InspectedElement): void {
    const tokens = this.state.tokens;
    if (!tokens || !element.isConnected) {
      return;
    }

    if (isInsideEditable(element)) {
      this.cleanupElement(element);
      this.inspections.delete(element);
      return;
    }
    if (inlineStyleSignature(element) !== inspection.hostStyleSignature) {
      this.cleanupElement(element);
      this.inspections.delete(element);
      this.inspectAndStyle(element);
      return;
    }
    const palette = this.palette;
    const parentSurface = this.resolveParentSurface(element);
    const marks: string[] = [];
    let surface = parentSurface;

    if (inspection.background) {
      const entry = palette.surface(inspection.background);
      marks.push(entry.token);
      surface = { ref: `e${entry.id}`, color: entry.color };
      inspection.surface = surface;
    } else if (inspection.backdrop) {
      // Unmapped gradient/translucent backgrounds stay as authored, so what
      // sits on them is judged against the colour actually painted.
      const backdrop = inspection.backdrop;
      const color =
        backdrop.kind === "gradient"
          ? backdrop.color
          : mixRgb(parentSurface.color, backdrop.color, backdrop.alpha);
      surface = { ref: fixedSurface(color), color };
      inspection.surface = surface;
    } else {
      inspection.surface = null;
    }

    let mappedText: Rgb | null = null;
    if (inspection.text && inspection.hasDirectText && !isProtectedEditor(element)) {
      if (!element.matches(SKIP_TEXT_INSIDE)) {
        const key = rgbKey(inspection.text);
        const isUaLink = UA_LINK_COLORS.has(key) || UA_VISITED_COLORS.has(key);
        if (isUaLink && element.matches("a:any-link, a[href]")) {
          // Unstyled link: the stylesheet applies the link/visited colours.
          marks.push(LINK_TOKEN);
        } else {
          const entry = isUaLink
            ? palette.linkColor(UA_VISITED_COLORS.has(key))
            : palette.paint("t", inspection.text, surface.ref);
          marks.push(entry.token);
          mappedText = entry.color;
        }
      }
    }

    if (this.dropsLightShadow(inspection, mappedText, tokens)) {
      marks.push(NO_SHADOW_TOKEN);
    }
    this.borderMarks(inspection, surface.ref, marks);
    this.pseudoMarks(inspection.pseudo.before, "q", surface.ref, marks);
    this.pseudoMarks(inspection.pseudo.after, "r", surface.ref, marks);
    if (inspection.fill) {
      marks.push(palette.paint("f", inspection.fill, surface.ref).token);
    }
    if (inspection.stroke) {
      marks.push(palette.paint("k", inspection.stroke, surface.ref).token);
    }

    const value = marks.join(" ");
    if (value) {
      if (element.getAttribute(ELEMENT_ATTRIBUTE) !== value) {
        element.setAttribute(ELEMENT_ATTRIBUTE, value);
      }
    } else if (element.hasAttribute(ELEMENT_ATTRIBUTE)) {
      element.removeAttribute(ELEMENT_ATTRIBUTE);
    }
  }

  /**
   * Light halos (`text-shadow: 0 1px 0 #fff`) designed for dark text turn into
   * a glow once the text is light, so they are dropped on dark schemes.
   */
  private dropsLightShadow(
    inspection: InspectedElement,
    mappedText: Rgb | null,
    tokens: ThemeTokens,
  ): boolean {
    const shadow = inspection.samples.textShadow;
    if (tokens.scheme !== "dark" || !mappedText || !shadow || shadow === "none") {
      return false;
    }
    const textLuminance = relativeLuminance(mappedText);
    return (shadow.match(/rgba?\([^)]*\)/g) ?? []).some((value) => {
      const color = parseColorOrNull(value);
      return color !== null && isPainted(color) && relativeLuminance(color) > textLuminance;
    });
  }

  private pseudoMarks(
    sample: PseudoSample | null,
    prefix: "q" | "r",
    surface: SurfaceRef,
    marks: string[],
  ): void {
    if (!sample) {
      return;
    }
    let own = surface;
    if (sample.background) {
      const entry = this.palette.surface(sample.background, `${prefix}s` as "qs" | "rs");
      marks.push(entry.token);
      own = `e${entry.id}`;
    }
    if (sample.text) {
      marks.push(this.palette.paint(`${prefix}t` as "qt" | "rt", sample.text, own).token);
    }
    if (sample.border) {
      marks.push(this.palette.paint(`${prefix}b` as "qb" | "rb", sample.border, own).token);
    }
  }

  /** Border tokens: one for all four sides when they share a colour, else one per painted side. */
  private borderMarks(inspection: InspectedElement, surface: SurfaceRef, marks: string[]): void {
    const painted = inspection.borders;
    const count = painted.filter((color) => color !== null).length;
    if (count === 0) {
      return;
    }
    const first = painted[0];
    if (
      count === 4 &&
      first &&
      painted.every((color) => color !== null && rgbToCss(color) === rgbToCss(first))
    ) {
      marks.push(this.palette.paint("ba", first, surface).token);
      return;
    }
    BORDER_SIDES.forEach((side, index) => {
      const color = painted[index];
      if (color) {
        marks.push(this.palette.paint(side.role, color, surface).token);
      }
    });
  }

  private attachShadowStyle(root: ShadowRoot): void {
    if (this.shadowStyles.has(root)) {
      return;
    }
    const style = this.doc.createElement("style");
    style.setAttribute(IGNORE_ATTRIBUTE, "");
    style.setAttribute("data-darkr-shadow-style", "");
    style.textContent = buildShadowCss() + this.paletteCss(":host");
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
      attributeFilter: OBSERVED_ATTRIBUTES,
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
      attributeFilter: OBSERVED_ATTRIBUTES,
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
            this.cleanupElement(target);
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
        if (target === this.doc.body) {
          this.bodyAuthor = null;
        }
        if (target.nodeType === Node.ELEMENT_NODE && target !== this.doc.documentElement) {
          // A class/hidden/open toggle on a large container (scroll locks,
          // theme classes) must not re-walk everything already inspected.
          this.queueSubtree(
            target as Element,
            record.attributeName !== "contenteditable" && record.attributeName !== "role",
          );
          if (record.attributeName && RESAMPLE_ATTRIBUTES.has(record.attributeName)) {
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
    if (records.some((record) => record.type === "childList" && record.addedNodes.length > 0)) {
      this.scheduleShadowSweep();
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
    const batch: Element[] = [];
    for (const element of this.queuedElements) {
      if (batch.length >= BATCH_SIZE) {
        break;
      }
      batch.push(element);
    }
    for (const element of batch) {
      this.queuedElements.delete(element);
    }
    this.processElements(batch);
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
        const slice: Element[] = [];
        for (const element of this.queuedElements) {
          if (slice.length >= IDLE_SLICE_SIZE) {
            break;
          }
          slice.push(element);
        }
        for (const element of slice) {
          this.queuedElements.delete(element);
        }
        this.processElements(slice);
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
        this.cleanupElement(element);
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

  private cleanupElement(element: Element): void {
    element.removeAttribute(ELEMENT_ATTRIBUTE);
  }

  private clearElements(): void {
    for (const element of this.inspections.keys()) {
      this.cleanupElement(element);
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
  ROOT_ATTRIBUTE,
};
