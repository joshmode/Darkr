# Darkr 2.0.0 — review findings

Reviewed at commit `15d2a9f` (17 Nov 2026). Scope: everything under `src/`, `tests/`, `scripts/`, `build.mjs`, the manifest and the docs.

**How to read this.** Each finding has an ID, a severity and an evidence tag.

- Severity: **P0** breaks the core promise on ordinary pages · **P1** visible breakage on common patterns, or data leaving the page altered · **P2** robustness, performance, UX friction · **P3** cleanup.
- Evidence: **[repro]** means I loaded the built extension in headless Chromium against a small fixture page and measured the result. **[code]** means it follows from reading the source and was not run.

**Status.** Fixed (commit on each entry): E-01…E-15, E-17, E-19, E-21, E-24; partly fixed: E-16, E-22, E-23. Open: E-18, E-20, the palette-indexing rewrite (B2) and WeakMap storage, the `scripting` injection. UI/UX: U-01…U-03, U-05…U-15 addressed in `b0fd756`, `5a96c8f`, `e5a8106`, `4816e65` (U-04 via include-subdomains rules); the manual real-site matrix (D4) was not run. Release gaps: CI, lint, e2e coverage, minification and the locale scaffold are done; UI strings are not yet localised.

Baseline: `npm run check` passes (typecheck, 87 unit tests, package, manifest checks). I did not run `npm run test:e2e` or `test:perf`. Nothing in the repo was changed apart from adding this file and `HANDBOOK.md`.

---

## 1. Summary

1. **Text inside any card, header or panel is unreadable on a fresh page load** (1.92:1 contrast, dark grey on dark). It corrects itself only after a setting changes. This is the most important bug in the codebase (E-01).
2. **The PDF "shadow" is two bugs stacked**: transparent text is repainted opaque, and embedded frames ignore the site toggle of the page you are on (E-02, E-03). Both reproduced.
3. **The engine writes into the page's DOM in ways that leak or break**: it stamps attributes and inline styles into editable content (which then gets saved or emailed), prints dark, flickers on animated elements, and gives up silently after 4,500–9,000 elements.
4. **A handful of blanket `!important` rules do more harm than the per-element mapping does good**: every link turns the same blue, every `role="dialog"` becomes an opaque panel, every input gets a box.
5. **The popup's model has four overlapping "off" switches and saves every tweak as a per-site rule** without saying so clearly. This is the main UX problem, ahead of any visual polish.
6. **Release plumbing is thin**: no CI, no linter, no shortcut, no toolbar state, no import/export, no localisation, unminified 69 KB script in every frame.

The colour maths, preference normalisation and the options page's DOM construction are careful and well tested; none of the above is a reason to start over. My recommendation is to keep the current engine design and harden it (section 6).

---

## 2. The PDF text shadow

**What you are seeing.** Web PDF viewers built on PDF.js (Canvas/LMS document previews, many journal and docs sites) draw the page on a `<canvas>` and lay an invisible layer of real text on top so you can select and search. That layer is `color: transparent`. Darkr repaints it in an opaque colour, so every line appears twice, slightly offset: the "shadow".

**Cause 1 — transparent text is made opaque (E-02) [repro].**
`parseCssColor` returns `{0,0,0,a:0}` for `rgba(0, 0, 0, 0)` rather than null ([color.ts:91-110](src/shared/color.ts:91)), and `mapTextColor` ignores alpha and returns an opaque hex ([color-map.ts:147](src/content/color-map.ts:147)). Measured: a PDF.js-style text span goes from `rgba(0, 0, 0, 0)` to `rgb(76, 76, 76)`.

The same defect flattens gradient headings (`background-clip: text; color: transparent` became solid grey) and removes the alpha from any semi-transparent text (`rgba(0,0,0,.4)` became opaque).

**Cause 2 — the site toggle does not reach embedded frames (E-03) [repro].**
Every frame resolves its preferences from its *own* `location.hostname` ([content/index.ts:33](src/content/index.ts:33), [:96](src/content/index.ts:96)). A document viewer normally lives in an iframe on a different host from the page that embeds it. Setting the page to **Never** stores a rule for the page's host only; the viewer's host has no rule, so it stays themed. The master switch is global, so it is the only thing that reaches the frame.

Measured with a page on `127.0.0.1` embedding a viewer on `localhost`: with the top site set to Never, the top page was unthemed and the iframe was still themed with opaque text-layer spans. With the master switch off, the iframe went back to `rgba(0, 0, 0, 0)`.

**Fix.** (a) Leave text alone when its alpha is near zero and carry alpha through otherwise. (b) Decide on/off, policy and overrides from the *top-level* site for every frame. Details in the handbook, tasks A2 and A3.

**Not the cause.** Chrome's built-in PDF viewer and Safari's native one render in a plugin Darkr cannot reach. If you see the shadow there, I have the wrong viewer and need the URL.

---

## 3. Engine findings

### P0

**E-01 · Text inside surfaces is mapped against the page's *light* colours on first load [repro].** **Fixed in `3434ecd`.**
`styleInspectedElement` finds the nearest ancestor carrying `data-darkr-surface` and reads its background with `getComputedStyle` ([theme-engine.ts:862-873](src/content/theme-engine.ts:862)). During the initial pass the stylesheet and root classes are not installed yet (`apply()` calls `inspectInitialPage()` before `installStyle()`, [:512-522](src/content/theme-engine.ts:512)), so that read returns the author's white. The engine concludes the text sits on a light surface and keeps it dark. The DOMContentLoaded `refresh()` repeats the same order, so it never self-corrects.

Measured on a plain page with a header and one card, fresh load, default settings:

| Element | Result | Contrast |
| --- | --- | --- |
| Text directly on body | `rgb(179,179,179)` on `rgb(21,22,25)` | 8.63:1 |
| Header text, card title, card paragraph, muted text | `rgb(76,76,76)` on `rgb(30,31,33)` | **1.92:1** |

After any preference change triggers a restyle, the same elements read 8.59:1. The e2e suite misses it because its contrast check uses `.lead`, which sits directly on the body.

It also erases hierarchy: muted `#666` and primary `#111` text come out identical.

### P1

**E-02 · Transparent and semi-transparent text becomes opaque [repro].** See section 2. **Fixed in `d9ccc97`.**

**E-03 · Frames ignore the top site's rule [repro].** See section 2. Related: `about:blank`, `srcdoc`, `blob:` and `data:` frames get no content script at all (no `match_about_blank` / `match_origin_as_fallback` in the manifest), so they stay white inside a dark page. Measured: a `srcdoc` iframe was not themed. **Fixed in `df4c6bf`.**

**E-04 · Darkr writes into editable content [repro].** **Fixed in `3cc6b4f`.**
Only four code editors are protected ([:148-152](src/content/theme-engine.ts:148)). Inside a plain `contenteditable`, children came back as:

```html
<p style="color: rgb(51, 51, 51); --darkr-element-text: #b3b3b3;" data-darkr-text="">Dear Sam,</p>
```

Webmail composers, CMS editors and note apps serialise that HTML. The attributes and inline properties end up in sent emails and saved documents. It also fights editors that watch their own DOM (ProseMirror, Slate, Lexical).

**E-05 · Elements with JS-driven inline styles flicker [repro].** **Fixed in `5156c4b`.**
Any change to an element's `style` attribute changes its "host style signature", which makes the engine strip its theming and re-queue it ([:1000-1012](src/content/theme-engine.ts:1000)). The signature includes every property, not just colours. An element animated with `style.transform` every frame was unthemed in **60 of 120 frames**. Carousels, sticky headers, virtual scrollers and progress bars all do this.

**E-06 · Past the element cap, pages become unreadable [repro].** **Fixed in `0dbcd3a` — (cap removed; viewport-first scheduling still open, task B3).**
Tracking stops at 9,000 inspected elements ([:41](src/content/theme-engine.ts:41), [:724-731](src/content/theme-engine.ts:724)); the initial queue is cut at the same number. On a 12,000-card page, cards past the cap kept `rgb(250,250,250)` backgrounds while their text inherited Darkr's light colour: light on light. Long threads, docs pages and diffs hit this.

**E-07 · Blanket `!important` rules override the page regardless of what was there [repro].** **Fixed in `7a7d1e2`.**
From `buildDocumentCss` ([:306-359](src/content/theme-engine.ts:306)):

- `a { color: link }` forces every link to one colour. A white-on-blue "Buy now" button became link-blue text on dark navy; nav bars, logos and footers lose their own colours.
- `[role="dialog"], [role="menu"], [role="tooltip"] { background: raised }`. A transparent full-screen `role="dialog"` wrapper (the usual modal structure) became an opaque panel covering the page.
- `input, textarea, select { background }`. A transparent input inside a rounded search pill got its own differently coloured rectangle.
- `code, pre, kbd, samp` get a background even where the author gave none.
- `button, [role="button"] { color: text }` discards button text colours.

**E-08 · Borders: only the top edge is sampled, and one colour is applied to all four [repro].** **Fixed in `d9ccc97`.**
`sampleStyle` reads `borderTopColor` / `borderTopStyle` only ([:163-173](src/content/theme-engine.ts:163)); the rule sets `border-color` for every side. Measured:

- An element with only `border-bottom: 1px solid #eee` kept `#eee` (bright lines on dark).
- `border: 1px solid transparent` (used to reserve space) became a visible border.
- A CSS triangle (three transparent sides, one coloured) had all four sides painted, turning it into a square.

**E-09 · Gradient and translucent backgrounds are ignored but their text is still lightened [repro].** **Fixed in `2413691` — (minimum bar only; full gradient remapping is Phase B).**
Only `background-color` with alpha ≥ 0.82 counts as a surface. A `linear-gradient(#fff, #eee)` header and an `rgba(255,255,255,.7)` bar both stayed light while their text was mapped to `rgb(179,179,179)`.

**E-10 · Content revealed by CSS alone is half-themed [repro].** **Fixed in `2413691`.**
Hidden elements are skipped ([:733-736](src/content/theme-engine.ts:733)) and only `class`, `hidden`, `open` and `style` mutations are watched. A `:hover` dropdown opened with a white background and light text. Menus driven by `aria-expanded` or `data-state` have the same gap when they do not mount new nodes.

**E-11 · Printing uses the dark theme [repro].** **Fixed in `bfd3b24`.**
No rule is scoped to `screen`. Under print media the body stayed `rgb(21,22,25)` with light text. Browsers drop backgrounds when printing by default, so the output is pale grey text on white paper.

**E-12 · The theme can be knocked out by ordinary page code and does not recover [repro].** **Fixed in `19c1f2f`.**
- `document.documentElement.className = "…"` removes `darkr-active`; the page went back to white. The observer deliberately ignores the root element ([:1026-1027](src/content/theme-engine.ts:1026)).
- Removing the `<style id="darkr-theme-styles">` node (head-managing libraries do this) had the same effect; nothing reinstalls it.

**E-13 · Native-dark detection runs once and never again [code].** **Fixed in `19c1f2f`.**
The result is cached at first apply ([:471-475](src/content/theme-engine.ts:471)) and refreshed only at DOMContentLoaded. A site that applies its dark theme from JS after that, or whose user toggles the site's own theme, is mis-classified until reload. Root `class` changes are ignored and `data-theme`-style attributes are not observed. Detection also looks only at `html`/`body` backgrounds, so apps that paint a full-page wrapper are missed.

### P2

**E-14 · Late-inspected elements sample Darkr's own colours [code, consistent with repro].** **Fixed in `3b87e23`.**
Everything after the first 700 elements is inspected with the theme already active, so `getComputedStyle` returns Darkr's forced body colour, input background and so on instead of the author's. On the long test page inherited text came out `rgb(224,222,217)` for late elements; early ones use a different contrast target. `readAuthorStyles` exists but is used only on the resample path.

**E-15 · `SKIP_SUBTREES` skips neither subtrees nor SVG [repro for tag case].** **Fixed in `1753546` — (SVG mapped; subtree skipping still open, task B4).**
The set is consulted only for the element itself, and the traversal still descends. `tagName` for inline SVG is lowercase `svg`, so `"SVG"` and `"MATH"` never match. Every `<path>` is inspected and counts against the cap. Separately, SVG `fill`/`stroke` colours are never mapped: a `#111` icon stayed `#111` on the dark page.

**E-16 · Shadow DOM [code].** **Partly fixed in `48ca10d`: `:host` background removed, single shadow walk, shadow rules gated for clean reads. Not fixed: shadow roots attached after the host was inspected.**
- `:host { background-color: var(--darkr-bg) }` gives every web component the page background, which shows as a patch when the component sits on a card.
- Shadow rules are not gated by the root class, so `readAuthorStyles` reads Darkr's colours inside shadow roots.
- `collectElements` pushes every shadow descendant and then walks each one's children again, visiting nodes once per depth level.
- Shadow roots attached after the host was inspected are never noticed.

**E-17 · Read/write interleaving [code].** **Fixed in `3b87e23` (batched reads then writes, no per-element layout reads; the queue is iterated, not copied).**
`styleInspectedElement` calls `getComputedStyle` twice per element between attribute and style writes, forcing a style recalculation per element. Slider drags re-run this for every tracked element every 28 ms. `processQueuedBatch` copies the whole queue each frame. A class toggle on `<body>` walks the entire DOM twice (`queueSubtree` then `markForResample`), contrary to the comment above it.

**E-18 · The engine observes its own writes [code].**
Each inline custom property it sets produces a `style` mutation record that is then processed and discarded.

**E-19 · `text-shadow` and `box-shadow` are untouched [repro].** **Fixed in `48ca10d` for `text-shadow` (light halos dropped on dark themes); `box-shadow` left alone as planned.**
`text-shadow: 0 1px 0 #fff` survives onto light text as a halo. Light box-shadows glow on dark surfaces.

**E-20 · Pseudo-elements are out of reach [code].**
`::before`/`::after` backgrounds and borders (custom checkboxes, dividers, overlays) keep their light colours. This is inherent to sampling elements.

**E-21 · Forced-colors mode [code].** **Fixed in `bfd3b24`.**
Only the grayscale filter stands down under `forced-colors: active`; the semantic theme still applies over the user's high-contrast palette.

**E-22 · Pre-paint hold applies to every frame of every page [code].** **Partly fixed in `a62ec22`: no hold in subframes. The top document is still held up to 400 ms.**
`html { visibility: hidden }` for up to 400 ms is installed before preferences are known ([content/index.ts:43-61](src/content/index.ts:43)), including on paused, Never and Original sites and in every ad iframe.

**E-23 · No handling of extension reload/update [code].** **Partly fixed in `a62ec22`: orphaned scripts tear down. Injection into already-open tabs needs the `scripting` permission and awaits the owner's approval.**
Old content scripts are orphaned (their storage calls throw) but keep observing. Already-open tabs get no script on install, so the popup says "reload this page" on the first thing a new user tries.

**E-24 · Hostnames the pattern rejects are themed but uncontrollable [code].** **Fixed in `26fdf9b`.**
A host with an underscore normalises to `""`; the content script falls through to Automatic while the popup shows "Unavailable on this page".

### P3

- Dead code: `hostStyleChanged` is always false after the early return ([:874-881](src/content/theme-engine.ts:874), [:920](src/content/theme-engine.ts:920), [:933](src/content/theme-engine.ts:933)); `cleanupElement`'s second parameter; `tokenColorFromVariable` only ever matches under jsdom; `ThemeTokens.isSemantic`; `ContentStatus.permissionWarning` (always false) and most of `ContentStatus`; the `darkr:refresh` message has no sender.
- Unused exports: `isNeutralColor`, `safeHex`, `contrastSummary`, `fallbackSurface`, `cloneThemeConfig`, `resolvedThemeConfig`, `setSiteOverride`, `mixRgbContinuous`. Unused CSS: `.app-mark`, duplicated `.brand` blocks in `popup.css`.
- Root variables are set both inline on `<html>` and in the stylesheet; the inline copy is redundant.
- `schemaVersion` is written but never read; there is no migration hook.
- `loadPreferences` falls back to defaults on a storage error, which themes pages for a user who had Darkr paused.

---

## 4. UI/UX findings

### Model

**U-01 · Four overlapping ways to turn Darkr off.** Master switch, site policy Never, mode Original (per site or as the global default), and "Automatic follows system". Original and Never mean nearly the same thing. "Always: themed even while paused" contradicts the header saying "Paused".

**U-02 · Every popup change becomes a per-site rule.** Moving a slider or picking a mode saves an override for the current host. The only hint is "Changes create a site rule" in 10 px tertiary text. Someone setting "their" darkness from the popup ends up with a scattering of site rules and unchanged defaults. There is no way to change the global default from the popup.

**U-03 · Controls look live when they do nothing.** With Darkr paused or the site on Never, the mode buttons and sliders stay enabled under a "Live" label. The page ignores the preview ([content/index.ts:154](src/content/index.ts:154)) but the change is still saved as a site rule.

**U-04 · Exact-host matching surprises people.** `docs.example.com` and `example.com` are unrelated. There is no "this site and its subdomains" option.

### Popup

**U-05 · Type and targets are too small.** 9 px labels (eyebrow, mode names, range hints, footnote), 10 px policy buttons and status. Policy buttons are 23 px tall and the switch is 22 px; WCAG 2.2 asks for 24 px targets.

**U-06 · The popup recolours itself to the current mode.** It turns parchment in Sepia and grey in Grayscale and shifts while a slider moves. It needs a contrast test for every slider position (`tests/popup-contrast.mjs` exists for this reason) and makes the UI feel unstable.

**U-07 · No recovery action when the page is unreachable.** The notice tells the user to reload; there is no Reload button.

**U-08 · No toolbar feedback and no shortcut.** The icon looks the same whether the tab is themed, excluded or paused. There is no `commands` entry.

**U-09 · Fixed 340×510 with inner scrolling.** The native-dark notice pushes the controls below the fold.

**U-10 · Screen-reader noise.** `#controls` is `aria-live="polite"`, so every slider step is announced twice (the `<output>` and the region). Radio groups handle Left/Right but not Up/Down.

**U-11 · Rare lost update while dragging [code].** The popup's own storage write comes back through `onChanged`, which clears `app.preview` ([popup/ui.ts:687-688](src/popup/ui.ts:687)). An input landing in that few-millisecond window is shown on the page but never saved.

### Settings page

**U-12 · Onboarding is a card at the bottom of the settings page.** A new install opens Settings with the first-run note below the site list. It does not say what Darkr does, how to pin it, or that open tabs need a reload.

**U-13 · "Appearance for new sites" is misnamed** (it governs every site without an override), all five sliders show regardless of the chosen mode, and there is no preview.

**U-14 · Site rules cannot be searched or edited** beyond policy; invalid hostnames fail with no visible message (`aria-invalid` only); `example.com:8080` is rejected silently.

**U-15 · Missing basics.** No import/export, no link to the privacy policy, source or issue tracker, no way to toggle the master switch (the status chip is display-only), static "Darkr 1.0" placeholder text in the markup, "Restore defaults" has no undo.

---

## 5. Release-readiness gaps

- **No CI.** No `.github/`; `npm run check` runs only when someone remembers.
- **No linter or formatter.**
- **e2e is not in `check`** and relies on fixed `waitForTimeout` sleeps. It has no iframe, transparent-text, print or editable-content coverage, which is how E-01 to E-04 shipped.
- **Engine unit tests run under jsdom**, whose `getComputedStyle` differs from browsers enough that production code carries jsdom-only branches.
- **Unminified build, no source maps.** 69 KB of content script is parsed in every frame at `document_start`.
- **No localisation scaffold** (`_locales`, `default_locale`); all strings are hard-coded English.
- **No CHANGELOG, no store assets** (screenshots, promo tiles), no README screenshots.
- **Safari** consumes these sources through the private repo's submodule. Anything using `location.ancestorOrigins`, `match_origin_as_fallback`, `chrome.scripting` or `commands` needs checking there.

---

## 6. Design paradigm

**Today.** Sample each element's computed colours, compute a replacement, and write one to three attributes plus one to three inline custom properties onto it. A static stylesheet turns those into `!important` declarations, alongside tag-based rules.

**What it buys.** No network access and no stylesheet parsing, so the "no network requests" promise holds without caveats, and cross-origin CSS is not an obstacle.

**What it costs.** Work and page mutation scale with element count (E-04, E-05, E-06, E-17). Anything that is not an element's own resolved colour is invisible: hover states, pseudo-elements, gradients, shadows (E-09, E-10, E-19, E-20).

**Alternatives considered.**

| Approach | Verdict |
| --- | --- |
| Rewrite the page's stylesheets (Dark Reader's dynamic mode) | Solves hover, pseudo-elements and scale. Needs to re-fetch cross-origin CSS from the background, which ends the no-network claim, and is a multi-month build. Not for this cycle. |
| Root `invert()` filter | Cheap and total, but wrecks images and brand colours. Worth offering only as a per-site "compatibility" fallback. |
| **Keep sampling, change what is written** | Recommended. |

**Recommended shape (handbook Phase B).**

1. **Separate sampling from writing.** Read author colours in one pass with Darkr's rules switched off; write in a second pass. Resolve the parent surface from the engine's own records, never from live computed style. This removes E-01, E-14 and most of E-17 by construction.
2. **Palette indexing instead of inline properties.** Map each distinct author colour (per role, per surface) to a small numbered palette entry; elements get a single `data-darkr` token; the stylesheet holds one rule per entry. Slider changes rewrite a few dozen rules instead of thousands of elements, and no inline styles are written, which shrinks E-04, E-05 and E-18.
3. **Replace blanket tag rules with sampled defaults** (E-07).
4. **Viewport-first scheduling with no hard cap** (E-06).
5. **Top-level-site scoping for frames** (E-03).

Decisions that are yours rather than the agent's are listed at the end of the handbook.
