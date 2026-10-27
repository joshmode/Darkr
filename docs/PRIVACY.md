# Privacy model

Darkr is designed to work entirely on the local device.

- No analytics, telemetry, advertising, or remote logging
- No account or sign-in
- No collection of page text, form input, browsing history, or personal data
- No external runtime dependencies or network requests
- Preferences are stored through the browser's local extension storage
- Per-domain settings are stored locally and are not synchronized by Darkr
- A single local flag records whether first-run privacy/access guidance was dismissed

The extension needs website access to inspect computed styles and apply a
visual theme. It uses only CSS, DOM attributes scoped to Darkr, and local
storage. Theme values are never sent to a server.
