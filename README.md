# Darkr for Chrome

Darkr is a local-first reading utility that adjusts webpage appearance without
replacing the page. It offers Dark, Sepia, Grayscale, Warm Light, and Original
modes with live controls, global defaults, and exact-domain overrides.

No account, no analytics, no network requests. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Requirements

- Node.js 20 or newer
- Chrome 109 or newer

## Develop

```sh
npm ci
npm run build          # → dist/chrome-extension
npm run build:watch
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `dist/chrome-extension`.

## Test

```sh
npm run check          # typecheck, unit/DOM tests, package, manifest checks
npm run check:all      # also runs the Chromium end-to-end suite
npm run test:perf      # startup and long-page timings
```

See [docs/TESTING.md](docs/TESTING.md) for the manual matrix.

## Package

```sh
npm run package
```

Outputs `dist/releases/darkr-chrome-v<version>.zip` with `manifest.json` at the
archive root, ready for the Chrome Web Store, and an unpacked folder with
install notes.

## Layout

| Path | Purpose |
| --- | --- |
| `src/content/` | Page theming engine (content script) |
| `src/popup/`, `src/options/` | Toolbar popup and settings page |
| `src/background/` | Service worker (first-run onboarding) |
| `src/shared/` | Colour math, theme tokens, preference model |
| `build.mjs` | esbuild bundler; `DARKR_MANIFEST`, `DARKR_OUT`, `DARKR_BROWSERS` let other hosts reuse the sources |

## Permissions

- `storage` persists global and per-domain settings locally.
- Host access to `http://` and `https://` pages lets Darkr read computed colors
  and apply a visual theme. Page text, history, and form contents are never read
  or transmitted.

## Domain matching

Preferences are keyed by exact hostname. A setting for `example.com` does not
apply to `docs.example.com`. The `www.` alias is normalized only when doing so
leaves a valid hostname, so `www.example.com` shares `example.com` while
`www.com` remains distinct. IPv6 hosts are preserved.

Site entries store only fields that differ from global defaults. Each saved site
can also carry one of three policies:

- **Automatic** (the default for every site) follows the global on/off switch,
  or — if you choose *System appearance* in Settings — themes only while your
  operating system is in dark mode.
- **Always** themes the site even while Darkr is paused or the system is light.
- **Never** leaves the site untouched.

To avoid a flash of the unthemed page, Darkr briefly holds painting at
`document_start` until your preferences have loaded (with a 400 ms safety
timeout so a stalled storage call can never leave a page blank).

## Appearance modes

- **Dark** uses semantic surface and text mapping with a continuous background
  tone and contrast control. The left endpoint is true `#000000` for OLED
  displays; raised surfaces remain subtly separated.
- **Sepia** uses a warm parchment surface palette and adjustable intensity.
- **Grayscale** uses a root-level CSS filter. It intentionally affects images,
  video, and canvas content.
- **Warm Light** shifts light surfaces and foregrounds toward a warm tone
  without turning the page dark.
- **Original** removes injected styles, attributes, observers, and filters.

Pages that already have a dark appearance are left untouched except for an
explicitly selected grayscale effect.

## Known limitations

- Canvas-rendered applications and cross-origin frames cannot be fully
  recolored from the top-level document.
- Closed shadow roots cannot be styled. Open shadow roots receive a style sheet.
- Some sites use inline styles or third-party widgets that do not expose stable
  semantic colors; Darkr preserves author inline edits rather than repeatedly
  overriding them.
- Restricted pages (`chrome://`, the Web Store) are not supported.
