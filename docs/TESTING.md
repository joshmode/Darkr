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

## Manual Chrome matrix

Load `dist/chrome-extension` unpacked and check:

| Page type | Check |
| --- | --- |
| News article | Dark, Sepia, Warm, Original, sliders |
| Blog | Dynamic content, images, links, code |
| Documentation | Sticky header, code blocks, tables, search |
| E-commerce | Product cards, dropdowns, dialogs, images |
| Social media | Infinite scrolling, tooltips, menus |
| Web application | Text inputs, modals, custom controls |
| Image-heavy site | Images retain color in semantic modes |
| Native dark site | Page is left untouched |
| Restricted page | Popup explains access limitation |

Also verify:

- Site access can be limited through Chrome's site access controls.
- The popup reflects the active page after navigation.
- Settings persist across browser restarts.
- Per-domain overrides do not leak to subdomains.
- Original mode removes Darkr classes, attributes, styles, and observers.
- A blocked site or paused extension is never themed, even while moving
  popup sliders.
- Reduced Motion does not introduce animation problems.
- Keyboard focus and screen-reader labels work in the popup and settings.

## Known test limitations

Automated tests run in Chromium. Incognito behaviour and Chrome Web Store
review are manual steps.
