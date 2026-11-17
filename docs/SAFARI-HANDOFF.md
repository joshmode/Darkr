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
| `adoptedStyleSheets` from a content script | **Not used** (palette indexing, B2, not done); the engine keeps `<style>` elements. |
| `runtime.id` becoming undefined after an update | `src/content/index.ts` (`teardownIfOrphaned`) | Yes. If `runtime.id` stays defined, the check is a no-op. |
| `HTMLStyleElement.sheet.disabled` | `src/content/theme-engine.ts` (shadow sheets during clean reads) | Guarded by `if (style.sheet)`. |

Other things worth a Safari pass:

- The popup no longer follows the page theme; it uses one dark palette.
- Stored settings migrate to schema 2 on first read (Original becomes off/Never).
- `data-darkr` on `<html>` replaces the `darkr-active` classes. Anything in the
  private repo that referenced those class names needs updating.
- `include subdomains` rules use plain string matching, no Public Suffix list;
  a rule on a public suffix (for example `co.uk`) with the box ticked would
  match every site under it.
