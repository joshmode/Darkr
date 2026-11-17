# Validation

## Automated checks

```sh
npm run check:all
```

This runs:

- TypeScript type checking
- Unit tests for color math, contrast, theme configuration, domain matching,
  site policies, persistence migration, and palette generation
- DOM integration tests for applying, updating, cleaning, dynamic content,
  shadow DOM, native-dark handling, grayscale, and bookkeeping release
- Chrome package generation and manifest validation
- Chromium end-to-end tests for popup/settings loading, live modes, forms,
  editor protection, native-dark preservation, dynamic DOM content, site
  policies, and cleanup

`npm run test:perf` measures startup application time and long-page scan cost.

The Chromium suite lives in `tests/e2e/` (`core.cases.mjs` for product
behaviour, `defects.cases.mjs` for regression cases named after the findings).
Run it with `npm run test:e2e`; it starts a local server and a Chromium with the
built extension. In a sandbox that blocks local port binding it fails with
`listen EPERM`. Cases are isolated: storage is cleared before each one.

## Manual Chrome matrix

Load `dist/chrome-extension` unpacked and check:

| Page type | Check |
| --- | --- |
| News article | Dark, Sepia, Gray, Warm, sliders, This site / All sites scope |
| Blog | Dynamic content, images, links, code |
| Documentation | Sticky header, code blocks, tables, search |
| E-commerce | Product cards, dropdowns, dialogs, images |
| Social media | Infinite scrolling, tooltips, menus |
| Web application | Text inputs, modals, custom controls |
| Image-heavy site | Images retain color in semantic modes |
| Native dark site | Page is left untouched |
| Restricted page | Popup explains access limitation and offers Reload |
| PDF.js viewer in an iframe | No doubled text; the site's Never rule reaches the frame |
| Webmail composer / CMS editor | Sent or saved HTML contains no `data-darkr` or `--darkr` |
| Print preview | Page prints with the author's colours |
| Site with a dark-mode toggle | Darkr stands down / returns within a second of the toggle |

Also verify:

- Site access can be limited through Chrome's site access controls.
- The popup reflects the active page after navigation.
- Settings persist across browser restarts.
- Per-domain overrides do not leak to subdomains unless Include subdomains is ticked.
- Turning Darkr off for a site removes Darkr attributes, styles, and observers.
- A blocked site or paused extension is never themed, even while moving
  popup sliders.
- Reduced Motion does not introduce animation problems.
- Keyboard focus and screen-reader labels work in the popup and settings.

## Real-site matrix (run 18 Nov 2026)

`npm run build && npm run test:matrix` loads real public pages in headless
Chromium with the built extension, then judges up to 1,500 visible text nodes per
page against their effective opaque background (gradients and images are
skipped) and saves screenshots to `test-results/matrix/`. It needs the network
(the browser fetches the sites; the extension itself makes no requests).

| Page | Themed | Text judged | Below 3:1 |
| --- | --- | --- | --- |
| Wikinews main page (news) | yes | 54 | 0 |
| MDN `MutationObserver` (docs, code blocks, sticky header) | yes | 118 | 0 |
| Wikipedia "Dark mode" (long article; print emulated → author background) | yes | 680 | 0 |
| Hacker News thread 8863 (long forum thread) | yes | 740 | 0 |
| GitHub `microsoft/vscode` (web app with menus) | yes | 471 | 0 |
| mozilla.github.io PDF.js viewer embedded in an iframe on another host | yes (frame too) | 10 | 0 |

Checked by eye on the screenshots: no doubled PDF text; page canvas stays white
(by design). **Not run:** a web-mail composer and any signed-in app (need an
account), a site that toggles its own dark mode on a real server (covered by the
local `e13` fixture), the browser's real print preview (emulated print media
only), and Incognito.

## Known test limitations

Automated tests run in Chromium. Incognito behaviour and Chrome Web Store
review are manual steps.
