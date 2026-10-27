# Darkr Privacy Policy

**Effective date:** October 28, 2026

**Applies to:** Darkr for Chrome, and the Darkr Safari extension in the Darkr
apps for macOS, iPhone, and iPad. The Apple apps also have their own
[App Store privacy policy](PRIVACY-APPLE.md).

**Developer:** joshmode

**Contact:** [joshua.lfc@proton.me](mailto:joshua.lfc@proton.me)

## The short version

Darkr is a local-first browser extension. It changes the appearance of webpages
on your device. The developer does not operate a server for Darkr and does not
collect, receive, sell, or share your data.

- No account or sign-in
- No analytics, telemetry, advertising, or tracking
- No sale or sharing of personal information
- No page text, form contents, passwords, files, or browsing history collected
- The extension makes no network requests
- Settings stay in your browser's local extension storage
- No remote code is loaded, and Darkr contains no third-party code at runtime

## Information stored on your device

Darkr stores the following information locally through the browser extension
storage API:

- **Appearance preferences**, such as whether Darkr is enabled, the selected
  appearance mode, system-appearance behavior, and slider settings
- **Site rules**, including the exact hostname of a site for which you created
  an override, its appearance settings, and whether the site is set to always
  theme or never theme
- **An onboarding flag** recording whether you dismissed the first-run privacy
  and website-access guidance

Darkr creates a site rule only when you configure one. It does not maintain a
history of the pages you visit.

This information is stored in the browser's local extension storage
(`chrome.storage.local` in Chrome, Safari's local extension storage in Safari).
Darkr does not use Chrome Sync or any other sync service for these settings and
does not send them to the developer or anyone else.
Your browser profile's security settings and any backup software you use may
affect the storage on your device.

## Information processed while you browse

To decide how a page should look and to apply the selected theme, Darkr's
content script processes the current page's hostname, page structure, and
computed styles in your browser. When you open the Darkr popup, Darkr reads the
active tab's URL to show controls for that site.

This processing happens locally and temporarily. Darkr does not copy, retain,
or transmit page text, form values, passwords, files, images, browsing history,
or other page content. A hostname remains in local extension storage only if
you save a site rule for it.

Darkr adds only a style sheet and small Darkr-specific attributes to the pages
you allow. Choosing the Original mode, pausing Darkr, setting a site to Never,
or removing the extension takes those additions off the page.

Websites that you visit may still collect information independently under their
own privacy policies. Darkr does not control those practices.

## Browser permissions

Darkr requests only the permissions needed to provide its single purpose:

- **Storage** lets Darkr save your appearance preferences, site rules, and
  onboarding flag in local extension storage.
- **Access to HTTP and HTTPS pages** lets Darkr inspect rendered colors and
  apply a visual theme automatically. This access also allows Darkr to run in
  frames that make up part of a webpage.

You can restrict Darkr's site access through your browser's extension
settings. Restricting access may prevent Darkr from theming some or all pages.
Darkr does not request access to cookies, downloads, bookmarks, passwords,
browsing history, or the clipboard.

## Safari, macOS, iPhone, and iPad

The Darkr Safari extension runs the same code and follows the same rules as the
Chrome extension: no data is collected, no network requests are made, and
settings stay in Safari's local extension storage on your device. Safari asks
which websites Darkr may run on, and you can change that at any time in Safari's
settings.

The Darkr app that carries the Safari extension is a small companion. It only
checks, through Apple's Safari APIs, whether the extension is enabled and
offers a shortcut to Safari's settings. It collects no data and contains no
analytics. Its App Store privacy label is "Data Not Collected". See the
[Apple apps privacy policy](PRIVACY-APPLE.md) for details.

## Information handled by browser vendors and stores

Chrome, Safari, the Chrome Web Store, and the App Store are operated by Google
and Apple, who process some information under their own privacy policies, for
example when you download or update Darkr. Darkr does not receive that
information. If you share analytics with app developers in your Apple device
settings, Apple may give the developer aggregated, anonymous crash and usage
statistics; Darkr adds nothing to them and cannot identify you from them.

## Sale, sharing, and advertising

The developer does not sell, rent, trade, or share information handled by
Darkr. Darkr does not use information for personalized advertising, profiling,
creditworthiness, lending, or any purpose unrelated to applying your selected
appearance settings.

Darkr's use of information received through Chrome extension APIs complies
with the Chrome Web Store User Data Policy, including its Limited Use
requirements. The developer does not allow humans to read your data because
the developer does not receive it.

## Retention and your choices

Settings remain in local extension storage until you change or reset them,
delete site rules, clear the extension's data, or remove the extension. You can
review and delete saved site rules from Darkr's settings page. Disabling Darkr
stops it from theming pages, and removing the extension stops all processing by
Darkr.

Because the developer does not receive your settings or browsing information,
the developer cannot access, export, or delete them for you. You can manage
them directly in Darkr and your browser.

If you are in a jurisdiction that grants rights to access, correct, delete, or
port personal information, you can exercise those rights directly in the
extension and your browser. The developer has no copy of that information to
act on. You may still contact the developer with questions about this policy.

## Security

Darkr is designed without a backend, user accounts, or remote data transfer,
which reduces the amount of information exposed outside your device. No method
of storage is completely secure. You are responsible for maintaining the
security of your browser profile and device.

## Children

Darkr is not directed to children, and the developer does not knowingly
collect personal information from children. The extension does not provide
accounts or transmit user data.

## Changes to this policy

This policy may be updated to reflect changes to Darkr or applicable
requirements. The effective date at the top will be revised when it changes.
If a change materially affects how Darkr handles information, the developer
will provide notice in the extension or its release notes where appropriate.

## Open source

Darkr's browser extension source code is public, so you can verify these
statements yourself: <https://github.com/joshmode/Darkr>

## Contact

Questions about this policy can be sent to
[joshua.lfc@proton.me](mailto:joshua.lfc@proton.me). You can also use the
project's [GitHub issue tracker](https://github.com/joshmode/Darkr/issues);
please do not include sensitive personal information in a public issue.
