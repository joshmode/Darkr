# Changelog

## Unreleased (since 2.0.0)

### Fixed
- Text inside cards, headers and panels was unreadable on first load (E-01).
- Transparent text (PDF.js text layers, gradient headings) was repainted opaque,
  and partially transparent text lost its alpha (E-02).
- Embedded frames ignored the top site's rule; `srcdoc`/`about:blank`/`blob:`
  frames were never themed (E-03).
- Darkr no longer writes attributes or inline styles into editable content (E-04).
- Elements animated through inline `transform` etc. no longer flicker (E-05).
- The 9,000-element cap is gone; long pages are fully themed (E-06).
- Links, buttons, dialogs, inputs and code keep the author's colours; unstyled
  links still get the theme's link colours (E-07).
- Borders are sampled per side; CSS triangles and reserved transparent borders
  keep their shape (E-08).
- Text over gradients and translucent bars stays readable (E-09); CSS-revealed
  menus are themed when they appear (E-10).
- Printing and forced-colors mode are left alone (E-11, E-21).
- The theme recovers when page code resets `<html>` or removes the stylesheet,
  and a site toggling its own dark theme is re-detected (E-12, E-13).
- Late-inspected elements no longer sample Darkr's own colours (E-14); SVG fills
  and strokes are mapped (E-15); light text-shadow halos are dropped on dark
  themes (E-19); hostnames with underscores can be controlled (E-24).

### Changed
- The popup has one "Darkr on this site" switch, a This site / All sites scope,
  no Original mode, and a stable dark palette with a preview strip. Stored
  settings migrate to schema 2 (Original becomes off / Never).
- Settings: default-appearance preview, search, include-subdomains rules,
  export/import, undo instead of confirm dialogs, master switch, project links.
- Active state is a `data-darkr` attribute on `<html>` instead of classes.
- Production builds are minified (content script 87.7 kB → 39.3 kB; 2.0.0
  shipped 69.0 kB unminified). Source maps are built but excluded from the zip.
- The pre-paint hold applies to the top document only.

### Added
- Darkr is injected into tabs that were open at install/update (new `scripting` permission).
- Welcome page on install; keyboard shortcuts (Alt+Shift+D, Alt+Shift+P);
  toolbar "off" badge; Reload button on the unreachable-page notice.
- Biome lint, GitHub Actions CI and a named, isolated Chromium test suite.
- English locale scaffold for the manifest.
