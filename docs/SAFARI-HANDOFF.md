# Safari hand-off

Safari consumes these sources through the private repository's `extension/`
submodule. None of the following could be tested from this repository, so each
needs checking there. "Fallback" says what the code does when the API is absent.

| Use | Where | Fallback if unsupported |
| --- | --- | --- |
| `location.ancestorOrigins` | `src/content/index.ts` (top-site lookup for frames) | Yes. If missing or the last origin is opaque (`"null"`), the frame asks the background (`darkr:get-top-host`), which answers from `sender.tab.url`. If that also fails the frame uses its own hostname. |
| `match_origin_as_fallback`, `match_about_blank` | `src/manifest.chrome.json` content-script entry | Chrome-only manifest keys. The Safari manifest lives in the private repo; without them `srcdoc`/`about:blank`/`blob:` frames stay unthemed (the previous behaviour). |
| `chrome.commands` (keyboard shortcuts) | `src/background/index.ts`, `commands` in the Chrome manifest | Yes. The listener is only added when `api.commands` exists; the popup switch and Settings remain. Safari has no equivalent manifest key. |
| `action.setBadgeText` / `setBadgeBackgroundColor` / `setTitle` | `src/background/index.ts` (`showState`) | Yes. Each call is optional-chained and wrapped in `try/catch`; without it the icon simply shows no per-tab state. |
| `tabs.create` for the welcome page | `src/background/index.ts` (`onInstalled`) | Yes. Falls back to `runtime.openOptionsPage()`, whose failure is swallowed. `welcome.html` must be in the Safari bundle (`build.mjs` copies it). |
| `tabs.reload` | `src/popup/ui.ts` ("Reload page") | The call is wrapped in `try/catch`; on failure the popup shows "Couldn't reload the page". |
| `matchMedia("(forced-colors: active)")` | `src/content/index.ts` | Yes. Browsers without the feature report no match, so theming proceeds. |
| `@media screen` around the generated sheet | `src/content/theme-engine.ts` | Universal. |
| `chrome.scripting.executeScript` | `src/background/index.ts` (`injectIntoOpenTabs`, on install and update) | Yes. Skipped when `api.scripting` is absent, and each tab's failure is swallowed. Requires the `scripting` permission in the manifest (added to the Chrome manifest; the Safari manifest must add it or lose the feature). |
| `adoptedStyleSheets` | **Not used.** Palette rules are appended to a `<style>` element with `CSSStyleSheet.insertRule`, with a text-node fallback if `insertRule` throws. Constructed sheets from a content script were not adopted because cross-world adoption is unverified in Chrome 109 and Safari. |
| `document.styleSheets[n].cssRules` | `src/content/state-rules.ts` (hover/focus colours) | Yes. Unreadable (cross-origin) sheets throw and are skipped; the feature then simply does nothing for them. |
| `WeakRef` | `src/content/records.ts` (element records). Chrome 84+, Safari 14.1+. No fallback: if absent the content script would fail to run. |
| `i18n.getMessage` | `src/shared/i18n.ts`. Falls back to the English text in the markup/code if the API is missing or returns nothing. `_locales/` must be in the Safari bundle (build copies it). |
| `getComputedStyle(el, "::before")` | `src/content/theme-engine.ts` (`readPseudo`) | Standard; skipped only under jsdom. |
| `runtime.id` becoming undefined after an update | `src/content/index.ts` (`teardownIfOrphaned`) | Yes. If `runtime.id` stays defined, the check is a no-op. |
| `HTMLStyleElement.sheet.disabled` | `src/content/theme-engine.ts` (shadow sheets during clean reads) | Guarded by `if (style.sheet)`. |

Other things worth a Safari pass:

- The popup no longer follows the page theme; it uses one dark palette.
- Stored settings migrate to schema 2 on first read (Original becomes off/Never).
- `data-darkr` on `<html>` replaces the `darkr-active` classes. Anything in the
  private repo that referenced those class names needs updating.
- `include subdomains` rules use plain string matching with a small built-in
  guard (single labels, two-level country suffixes such as `co.uk`, and common
  shared hosting suffixes are refused), not the full Public Suffix List.
- Per-element state is now one `data-darkr` token attribute (`s3 t7 …`), and
  all colours live in rules appended to the `#darkr-theme-styles` sheet.
