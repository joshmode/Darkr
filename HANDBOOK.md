# Darkr — agent handbook

You are picking up Darkr 2.0.0, a Manifest V3 browser extension that restyles web pages (Dark, Sepia, Grayscale, Warm Light). Your job is to take it from "works on the test fixtures" to release quality. Read `findings.md` first; this handbook refers to its IDs (E-01, U-02, …) and tells you what to do about them and in what order.

## 1. Ground rules

1. **No network requests, ever.** The extension's public promise is that it makes none. Do not add `fetch`, remote fonts, analytics, or any feature that needs them. If a task seems to require one, stop and ask the owner.
2. **Permissions stay at `storage` plus http/https host access** unless a task below names an addition (`scripting`, `commands`). Any other new permission needs the owner's approval because it triggers store re-review.
3. **Test first.** Every bug fix starts with a failing test that reproduces it in a real browser (section 4). The existing suite passed while E-01 shipped; a fix without a browser test is not done.
4. **Do not write to pages more than necessary.** Each attribute or inline style Darkr adds is visible to the page, can be serialised by it, and can be fought by it. Prefer stylesheet rules over per-element writes.
5. **Stored preferences are user data.** Never change the meaning of an existing field. Schema changes go through a versioned migration with a unit test that loads a v1 payload.
6. **This repository is public.** Do not commit anything from the private Apple repository, signing material, or personal details. Commit only when the owner asks; work on a branch, not `main`.
7. **Safari consumes these sources** through a private repository's `extension/` submodule. You cannot test Safari from here. When you use an API with uneven support (listed in section 8), feature-detect it, keep a fallback, and record it in the hand-off notes.
8. **Report honestly.** If a check was not run, say so. If a fix is partial, say what remains.

## 2. Orientation

| Path | What it is |
| --- | --- |
| `src/content/index.ts` | Content-script entry: loads preferences, pre-paint hold, messaging, lifecycle |
| `src/content/theme-engine.ts` | The engine: inspection, mapping, observers, stylesheet (1,261 lines; most work lands here) |
| `src/content/color-map.ts` | Author colour → themed colour |
| `src/shared/color.ts`, `theme.ts` | Colour parsing and maths; theme tokens from a config |
| `src/shared/config.ts`, `preferences.ts`, `types.ts` | Preference model, normalisation, storage |
| `src/popup/`, `src/options/` | Toolbar popup and settings page (plain TS + HTML + CSS, no framework) |
| `src/background/index.ts` | Service worker; currently only opens Settings on install |
| `src/styles/base.css` | Shared UI tokens and components for popup and settings |
| `tests/*.test.ts` | Vitest + jsdom unit tests |
| `tests/e2e.mjs` | Playwright script that loads the built extension in Chromium |
| `build.mjs` | esbuild bundling; env vars let the Safari host reuse it |

Preferences live under one `storage.local` key, `darkr.preferences.v1`: a master `enabled` flag, `autoMode`, a global `overrideNativeDark`, `defaults` (a `ThemeConfig`), and `sites` keyed by exact hostname, each with a `policy` (`auto` / `allow` / `block`), optional `overrides`, optional `overrideNativeDark`.

## 3. Commands

```bash
npm ci
```

```bash
npm run check
```

```bash
npm run test:e2e
```

```bash
npm run test:perf
```

- `check` = typecheck, unit tests, package, manifest checks. It must pass before and after every task.
- `test:e2e` and `test:perf` start a local HTTP server and Chromium. In a sandbox that blocks local port binding they fail with `listen EPERM`; that is the environment, not the code. Run them with binding allowed.
- On a fresh profile the extension opens its Settings tab on install, which can interrupt a navigation started in the first second. Wait for it before `page.goto`.
- Build output goes to `dist/chrome-extension` (git-ignored). Load it unpacked from `chrome://extensions` for manual checks.

## 4. Phase 0 — safety net (do this before any fix)

**0.1 Restructure e2e into cases.** `tests/e2e.mjs` is one long script that throws on the first failure. Convert it to Playwright Test (or a small case runner) so each scenario is named, isolated and reported. Replace fixed `waitForTimeout` sleeps with `expect.poll` / `waitForFunction` on the condition being tested. Add a helper that writes preferences through the service worker and a helper that returns the contrast ratio between an element's computed colour and a given ancestor's computed background.

**0.2 Add fixtures and failing tests for the confirmed bugs.** Put fixtures in `tests/fixtures/`. Each row is one test; all should fail on `15d2a9f`.

| ID | Fixture essentials | Assert |
| --- | --- | --- |
| E-01 | `body{background:#f4f4f4;color:#111}`; `<header>` and `.card` with `background:#fff`; text in `span`, `h2`, `p`, and a `.muted{color:#666}` paragraph | On fresh load, every text element ≥ 4.5:1 against its card; muted text is dimmer than primary |
| E-02 | `.textLayer span{position:absolute;color:transparent}` over a `<canvas>`; a heading with `background-clip:text;color:transparent`; a paragraph with `color:rgba(0,0,0,.4)` | Computed alpha of the first two stays 0; the third keeps alpha < 1 |
| E-03 | Top page served on `127.0.0.1` embedding the E-02 page from `localhost` (same server, two hostnames); also a `srcdoc` iframe | Top host set to `block` → iframe root has no `darkr-active`. Top host themed → `srcdoc` iframe is themed |
| E-04 | `<div contenteditable="true">` containing a coloured `<p>` and a `<div style="background:#fff">` | `innerHTML` contains neither `data-darkr` nor `--darkr` |
| E-05 | `.anim{background:#fff}` with a `requestAnimationFrame` loop setting `style.transform` | Over 120 frames the element's computed background is never the author white |
| E-06 | 12,000 `.card{background:#fafafa;border:1px solid #ddd}` each with a `<p>` | After settling, cards 5, 6,000 and 11,000 are all dark with ≥ 4.5:1 text |
| E-07 | Transparent fixed `role="dialog"` overlay; `<a class="btn">` white on `#1a73e8`; transparent `<input>` inside a `.pill{background:#f1f3f4}` | Overlay stays transparent; button keeps a blue-family background with ≥ 4.5:1 text that is not the link token; input background equals the pill's |
| E-08 | CSS triangle; `border:1px solid transparent` button; `border-bottom:1px solid #eee` row | Triangle's top border alpha stays 0; ghost border alpha stays 0; bottom border is no longer `#eee` |
| E-09 | `background-image:linear-gradient(#fff,#eee)` block; `background:rgba(255,255,255,.7)` bar; dark text in each | Text ≥ 4.5:1 against what is actually painted behind it |
| E-10 | `.menu{display:none;background:#fff}` shown by `.nav:hover .menu` | After hover, menu background is dark and text ≥ 4.5:1 |
| E-11 | Any themed page under `page.emulateMedia({media:"print"})` | Body background and text colours equal the author's |
| E-12 | Themed page; run `document.documentElement.className="x"`; separately remove `#darkr-theme-styles` | Theme is back within 500 ms in both cases |
| E-15 | Inline `<svg>` with `<path fill="#111">` | Path is visibly lighter than the page background |

**0.3 CI.** Add a GitHub Actions workflow running `npm ci`, `npm run check`, and the e2e suite with Playwright's Chromium on pull requests and `main`.

**0.4 Lint and format.** Add one tool (Biome, or ESLint + Prettier) with a `lint` script wired into `check`. Apply formatting in a single isolated commit so later diffs stay readable.

## 5. Phase A — correctness

Work in this order. Each task is one pull request with its Phase 0 test turning green.

**A1 · Resolve surfaces from engine records (E-01).** In `styleInspectedElement`, stop calling `getComputedStyle` on the ancestor. Walk up from the element (crossing shadow boundaries via `getRootNode().host`) to the nearest element whose inspection has a `mappedSurface`, and use that; fall back to `tokens.background`. Parents are processed before children in every traversal, so the record exists. Also assert in the test that changing a preference afterwards does not change the result (fresh and restyled colours must match).

**A2 · Respect alpha in text and borders (E-02, E-08).** Treat a colour with alpha < 0.05 as "not painted": do not set the text or border attribute for it. For partial alpha, compute contrast against the surface using the composited colour and emit the result with the original alpha. Sample all four border sides; write per-side colours, and only for sides whose style is not `none`/`hidden` and whose alpha is not ~0.

**A3 · Scope frames to the top-level site (E-03).** Introduce one function that returns the hostname preferences are resolved against. In the top frame it is `location.hostname`. In a subframe, use the last entry of `location.ancestorOrigins` when available; otherwise ask the background (`runtime.sendMessage`), which answers from `sender.tab.url`. Use that host for `resolveAppearance`. Add `match_origin_as_fallback: true` to the content-script entry (keep `match_about_blank: true` alongside it for Chrome < 119) so `srcdoc`/`about:blank`/`blob:` frames are covered. Update the README's "Domain matching" section.

**A4 · Keep out of editable content (E-04).** Skip any element that is, or is inside, `[contenteditable]:not([contenteditable="false"])`, `[role="textbox"]`, or a document in `designMode`. Let those subtrees inherit: set text colour and surface on the editable root's nearest non-editable ancestor only. Replace `isProtectedEditor`'s class list with this general rule plus the existing editor selectors.

**A5 · Stop the animation flicker (E-05).** Limit the host-style signature to colour-bearing properties (`color`, `background*`, `border*color`, `border*style`, `fill`, `stroke`, `opacity`, `display`, `visibility`). When it does change, re-sample in place and swap the result; never remove theming and wait for a later batch.

**A6 · Remove the blanket rules (E-07).** Delete the tag-based `!important` declarations for `a`, `button`, `[role=…]`, `input/textarea/select`, `code/pre/kbd/samp` backgrounds. Route those elements through normal sampling. Keep static rules only for things sampling cannot reach: `::selection`, `::placeholder`, autofill, `color-scheme`, `scrollbar-color`, `accent-color`, `dialog::backdrop`. For links: map an author link colour through `mapTextColor` like other text; use the link token only when the author colour is the UA default blue/purple.

**A7 · Screen only, and stand down for forced colours (E-11, E-21).** Wrap the whole generated sheet in `@media screen`. Under `forced-colors: active`, apply nothing.

**A8 · Self-healing root state (E-12, E-13).** Mark the active state with a `data-darkr` attribute on `<html>` rather than classes, and watch the root for attribute changes. If Darkr's attribute or stylesheet goes missing while a theme should be active, restore it. On root or body `class` / `data-theme` / `data-color-mode` / `style` changes, re-run native-dark detection (debounced, with Darkr's rules off) and switch between theming and standing down accordingly.

**A9 · Gradients, translucency, revealed content (E-09, E-10).** Minimum bar for this phase: if an element has a gradient `background-image` or a translucent background that Darkr is not remapping, do not lighten text inside it (treat its own colours as the surface). Inspect hidden elements as well as visible ones so CSS-revealed menus are already mapped; add `aria-expanded`, `aria-hidden` and `data-state` to the observed attributes. Full gradient remapping belongs to Phase B.

**A10 · Hostname edge cases (E-24).** When a hostname fails normalisation, the content script must not theme a page the popup cannot control. Either accept underscores in labels or treat an unkeyable host as unavailable in both places.

## 6. Phase B — engine structure and performance

Do this after Phase A is green; the Phase 0 tests are the regression net.

**B1 · Two-phase batches (E-14, E-17).** Each batch: (1) switch Darkr's rules off once, read every computed value needed for the batch, switch them back on; (2) compute; (3) write. No `getComputedStyle` between writes. Delete `tokenColorFromVariable`; if jsdom needs help, put the shim in `tests/setup.ts`, not in `src/`.

**B2 · Palette indexing.** Replace per-element inline custom properties with a palette: a `Map` from `(role, author colour, surface index)` to an entry number. Elements get one attribute, for example `data-darkr="s12 t40 b7"`; the stylesheet holds one rule per entry using `[data-darkr~="s12"]`. A config change recomputes entries and rewrites the sheet without touching elements. Memoise the mapping functions by input string. Prefer `adoptedStyleSheets` for the document and shadow roots when a constructed sheet can be adopted from the content-script world (verify in Chrome 109 and note Safari as unverified); otherwise keep the `<style>` element.

**B3 · Scheduling without a cap (E-06).** Remove `MAX_TRACKED_ELEMENTS` as a hard stop. Process what is in or near the viewport first (an `IntersectionObserver` on coarse container blocks is enough), then the rest in idle time. Hold element records in a `WeakMap` so detached nodes need no pruning. Replace the array copy in `processQueuedBatch` with an iterator. Target: the 12,000-card fixture fully themed, no long task over 50 ms after first paint, in `tests/performance.mjs`.

**B4 · Traversal fixes (E-15, E-16).** Compare tag names case-insensitively and actually skip the subtrees of skipped tags. Map SVG `fill`/`stroke` that resolve to a concrete colour (not `currentColor`, not `none`) with the text mapper. Fix the shadow-root double walk. Remove the `:host` background. Gate shadow rules so the "rules off" read works inside shadow roots.

**B5 · Shadows (E-19).** Drop `text-shadow` whose colour is lighter than the mapped text in dark schemes. Leave `box-shadow` alone unless it is a light-coloured glow on a dark surface.

**B6 · Lifecycle (E-22, E-23).** In the content script, detect an invalidated extension context and tear the engine down. In the background, on install and update, inject the content script into existing http/https tabs (`scripting` permission; ask the owner before adding it). Narrow the pre-paint hold: skip it in subframes, and consider replacing "hide everything" with an early background-colour rule registered by the background only while theming is enabled.

**B7 · Dead code.** Remove everything listed under P3 in `findings.md`. Add a `schemaVersion` check and an empty migration table to `normalizePreferences`.

## 7. Phase C — UI/UX overhaul

The owner has asked for a real overhaul, not a reskin. The decisions marked ★ in section 9 change this phase; get answers before building.

**C1 · One clear model (U-01, U-02, U-03).**
- Popup top row: a single large switch, "Darkr on this site". Off = today's `block`. On = themed.
- Below it, a scope control: **This site / All sites**. It decides whether the mode and sliders edit the site override or the global defaults. Default to All sites until the user picks This site for a host; show "Customised for this site · Reset" when an override exists.
- Global pause moves to the footer ("Pause everywhere") and the toolbar context menu.
- Remove Original from the mode list; off is the switch. Migrate stored `mode: "original"` site overrides to `policy: "block"` and a global default of Original to `enabled: false`.
- "Always (even when paused)" and "follow system appearance" move to Settings.
- When the site is off or Darkr is paused, collapse the appearance controls instead of leaving them enabled.

**C2 · Popup visual pass (U-05, U-06, U-09).** Minimum text 11 px, body 13 px; minimum target 28 px high (24 px absolute floor). Keep the popup chrome on one stable dark palette and show the page result in a small preview strip (surface, text, link, muted) driven by the theme tokens. Let height follow content up to the browser's limit; no inner scroll in the common case. Use the `frontend-design` and `design:accessibility-review` skills if available, and keep `tests/popup-contrast.mjs` passing or replace it with an axe run.

**C3 · Feedback and recovery (U-07, U-08).** Add a Reload button to the unreachable-page notice (`tabs.reload` on the active tab). Reflect per-tab state on the toolbar icon (themed / off for this site / paused / unavailable) from the background. Add `commands`: toggle this site and toggle everywhere, with suggested keys the user can rebind.

**C4 · Accessibility (U-10).** Remove `aria-live` from `#controls`; rely on each slider's `aria-valuetext`. Handle Up/Down in radio groups. Run an automated axe pass on popup and settings in e2e.

**C5 · Popup state race (U-11).** Ignore `storage.onChanged` events that match the popup's own last write, as the settings page already does with `lastSerializedPreferences`.

**C6 · Settings page (U-13, U-14, U-15).** Rename the defaults section "Default appearance". Show only the active mode's sliders, with a live preview panel. Site rules: search box, inline error text for invalid input, "include subdomains" option if the owner approves ★. Add a master switch, export/import (JSON file, validated through `normalizePreferences`), and links to the privacy policy, source and issue tracker. Replace `window.confirm` and the un-undoable "Restore defaults" with an inline undo.

**C7 · Welcome page (U-12).** A dedicated `welcome.html` opened on install: what Darkr does in one sentence, a live sample that responds to the mode buttons, how to pin the icon, the shortcut, the privacy promise, and a "reload open tabs" note if B6's injection is not adopted.

## 8. Phase D — release

- **D1** Minify production builds; emit external source maps excluded from the store zip. Record content-script size before and after.
- **D2** Add `_locales/en/messages.json` and `default_locale`; move manifest strings and UI copy to `i18n.getMessage`. English only for now.
- **D3** `CHANGELOG.md`; README screenshots; store listing copy and images; update `docs/TESTING.md` and the README sections on domain matching, limitations and the pre-paint hold to match the new behaviour.
- **D4** Manual matrix on real sites before tagging: a news article, a web mail composer, a docs site with code blocks, a long forum thread, a web app with modals and menus, a PDF.js viewer embedded in an iframe, a site with its own dark mode toggled on and off, print preview.
- **D5** Safari hand-off note listing every use of: `location.ancestorOrigins`, `match_origin_as_fallback`, `chrome.scripting`, `commands`, `adoptedStyleSheets` from a content script, `action.setIcon`. State for each whether a fallback exists.

## 9. Decisions for the owner

Ask these up front; do not guess.

1. ★ **Popup scope.** Adopt "This site / All sites" with All sites as the default (recommended), or keep today's "every change is a site rule"?
2. ★ **Remove Original as a mode** and migrate it to off (recommended), or keep it?
3. ★ **Subdomain rules.** Add "include subdomains" per rule (recommended, opt-in), or stay exact-host only?
4. **Frames.** Top-level site governs all its frames (recommended). The alternative, a frame's own host rule taking precedence when one exists, is more flexible and harder to explain.
5. **`scripting` permission** for injecting into already-open tabs on install/update. Better first-run experience; one more permission line in the store listing.
6. **Popup recolouring.** Stable chrome plus a preview strip (recommended), or keep the popup taking on the page theme?
7. **Dark slider range.** The top of the Background slider is a light grey with dark text, inside a mode called Dark. Cap it around the current 70 mark, or keep the full range?
8. **Longer term.** Whether to spike a stylesheet-rewriting engine after this cycle. It would fix hover states and pseudo-elements properly, at the cost of re-fetching cross-origin CSS and therefore the "no network requests" claim.

## 10. Definition of done

- Every Phase 0 test passes, along with `npm run check`, in CI.
- No fixture element themed by Darkr falls below 4.5:1 for body text.
- No `data-darkr` or `--darkr` text appears inside editable content or in copied HTML from the fixtures.
- `tests/performance.mjs` shows no regression in startup time and meets the B3 target.
- The D4 manual matrix is recorded in the pull request with what was checked and what was not.
- `findings.md` is updated: each ID marked fixed (with the commit), deferred (with the reason), or rejected.
