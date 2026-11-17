// The original e2e scenarios, one named case each.
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assert,
  test,
  env,
  newPage,
  setPreferences,
  isThemed,
  waitThemed,
  settle,
  poll,
  holds,
  contrastAgainstAncestor,
} from "./harness.mjs";

const HOST = "127.0.0.1";

test("article is themed on first load and the pre-paint hold is released", async () => {
  const page = await newPage("/article");
  await settle(page);
  const result = await page.evaluate(() => ({
    style: !!document.querySelector("#darkr-theme-styles"),
    attrs: document.querySelectorAll("[data-darkr-surface]").length,
    imageFilter: getComputedStyle(document.querySelector("img")).filter,
  }));
  assert.ok(result.style && result.attrs > 0, JSON.stringify(result));
  await page.screenshot({ path: "test-results/article-dark.png" });
});

test("site policy block removes the theme and auto restores it", async () => {
  await setPreferences({}, { [HOST]: { policy: "block" } });
  const page = await newPage("/policy");
  assert.equal(await isThemed(page), false);
  await poll(
    () => page.evaluate(() => !!document.querySelector("#darkr-theme-styles")),
    (v) => v === false,
    {
      message: "no theme stylesheet on a blocked site",
    },
  );
  await setPreferences({}, { [HOST]: { policy: "auto" } });
  await waitThemed(page);
});

test("policy and master switch: Always, Automatic, system appearance", async () => {
  const page = await newPage("/policy");
  await settle(page);
  await setPreferences({ enabled: false }, { [HOST]: { policy: "allow" } });
  await waitThemed(page, true);
  await setPreferences({ enabled: false }, { [HOST]: { policy: "auto" } });
  await waitThemed(page, false);
  await page.emulateMedia({ colorScheme: "light" });
  await setPreferences({ enabled: true, autoMode: "system" }, { [HOST]: { policy: "auto" } });
  await waitThemed(page, false);
  await page.emulateMedia({ colorScheme: "dark" });
  await waitThemed(page, true);
  await setPreferences({ enabled: true, autoMode: "globals" }, { [HOST]: { policy: "auto" } });
  await waitThemed(page, true);
});

test("text and links on the article meet 4.5:1 against the body", async () => {
  const page = await newPage("/article");
  await settle(page);
  assert.ok((await contrastAgainstAncestor(page, "#article .lead", "body")) >= 4.5);
  assert.ok((await contrastAgainstAncestor(page, "#article a", "body")) >= 4.5);
});

test("popup renders its controls", async () => {
  const popup = await env.context.newPage();
  await popup.setViewportSize({ width: 390, height: 760 });
  await popup.goto(`chrome-extension://${env.extensionId}/popup.html`);
  await poll(
    () => popup.locator("body").innerText(),
    (t) => t.includes("Darkr on this site") && t.includes("Pause everywhere"),
    {
      message: "popup content",
    },
  );
  await popup.screenshot({ path: "test-results/popup.png", fullPage: true });
});

test("settings page: sections present and onboarding stays dismissed", async () => {
  const settings = await env.context.newPage();
  await settings.setViewportSize({ width: 1100, height: 900 });
  await settings.goto(`chrome-extension://${env.extensionId}/options.html`);
  const onboarding = settings.locator("#onboarding-card");
  await onboarding.waitFor({ state: "visible" });
  const text = (await settings.locator("body").innerText()).toLowerCase();
  for (const expected of ["default appearance", "site rules", "privacy", "website access"]) {
    assert.ok(text.includes(expected), `Settings UI missing: ${expected}`);
  }
  await settings.locator("#onboarding-dismiss").click();
  await onboarding.waitFor({ state: "hidden" });
  await settings.reload();
  await settings
    .locator("#onboarding-dismiss")
    .waitFor({ state: "hidden" })
    .catch(() => undefined);
  await poll(() => onboarding.isHidden(), Boolean, {
    message: "onboarding to stay hidden after reload",
  });
  await settings.screenshot({ path: "test-results/settings.png", fullPage: true });
});

test("natively dark page is left alone; global and per-site overrides apply", async () => {
  const page = await newPage("/native-dark");
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(await isThemed(page), false, "native dark page was modified");
  assert.equal(await page.evaluate(() => !!document.querySelector("#darkr-theme-styles")), false);
  await setPreferences({ overrideNativeDark: true });
  await waitThemed(page, true);
  await setPreferences({}, { [HOST]: { policy: "auto", overrideNativeDark: false } });
  await waitThemed(page, false);
  await setPreferences(
    { overrideNativeDark: false },
    { [HOST]: { policy: "auto", overrideNativeDark: true } },
  );
  await waitThemed(page, true);
  await setPreferences({ overrideNativeDark: false }, { [HOST]: null });
  await waitThemed(page, false);
});

test("form controls keep value and selection under theming", async () => {
  const page = await newPage("/forms");
  await settle(page);
  const form = page.locator("#notes");
  await form.fill("Selection and typing survive theming");
  await form.selectText();
  const result = await page.evaluate(() => {
    const textarea = document.querySelector("#notes");
    return { value: textarea.value, selection: textarea.selectionEnd };
  });
  assert.equal(result.value, "Selection and typing survive theming");
  assert.ok(result.selection > 0);
  await page.screenshot({ path: "test-results/forms.png", fullPage: true });
});

test("code editor widgets are protected", async () => {
  const page = await newPage("/editor");
  await settle(page);
  const result = await page.evaluate(() => ({
    tokenTextAttrs: document.querySelector("#token").hasAttribute("data-darkr-text"),
  }));
  assert.equal(result.tokenTextAttrs, false);
});

test("dynamically added content is themed", async () => {
  const page = await newPage("/article");
  await settle(page);
  await page.evaluate(() => window.addDynamicContent());
  await poll(
    () =>
      page.evaluate(() => ({
        surface: !!document.querySelector("#dynamic .card[data-darkr-surface]"),
        text: !!document.querySelector("#dynamic p[data-darkr-text]"),
      })),
    (r) => r.surface && r.text,
    { message: "dynamic card to be themed" },
  );
});

for (const mode of ["sepia", "grayscale", "warm", "original"]) {
  test(`mode ${mode} applies and screenshots`, async () => {
    const page = await newPage("/article");
    await settle(page);
    await setPreferences(
      {},
      {
        [HOST]: {
          policy: "auto",
          overrides: {
            mode,
            darkBackground: 12,
            darkContrast: 62,
            sepiaIntensity: 58,
            grayscaleIntensity: 100,
            warmth: 35,
          },
        },
      },
    );
    const expectSemantic = mode !== "grayscale" && mode !== "original";
    await poll(
      () =>
        page.evaluate(() => ({
          semantic: document.documentElement.getAttribute("data-darkr") === "semantic",
          gray: document.documentElement.getAttribute("data-darkr") === "grayscale",
          active: document.documentElement.hasAttribute("data-darkr"),
        })),
      (s) =>
        mode === "original"
          ? !s.active || (!s.semantic && !s.gray)
          : mode === "grayscale"
            ? s.gray
            : s.semantic === expectSemantic,
      { message: `${mode} mode state` },
    );
    await page.locator("#article").screenshot({ path: `test-results/article-${mode}.png` });
  });
}

test("toolbar badge reflects the page state", async () => {
  const page = await newPage("/policy");
  await settle(page);
  const badge = () =>
    env.worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return chrome.action.getBadgeText({ tabId: tab.id });
    }, `${env.origin}/policy`);
  await poll(badge, (text) => text === "", { message: "no badge while themed" });
  await setPreferences({}, { [HOST]: { policy: "block" } });
  await poll(badge, (text) => text === "off", { message: "off badge for a blocked site" });
  await setPreferences({}, { [HOST]: { policy: "auto" } });
  await poll(badge, (text) => text === "", { message: "badge cleared when themed again" });
});

async function openSettings() {
  const settings = await env.context.newPage();
  await settings.setViewportSize({ width: 1100, height: 900 });
  await settings.goto(`chrome-extension://${env.extensionId}/options.html`);
  await settings.locator("#sites-list").waitFor({ state: "attached" });
  return settings;
}
const storedPreferences = () =>
  env.worker.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key],
    "darkr.preferences.v1",
  );

test("settings: master switch, invalid hostname message, search and undo", async () => {
  const settings = await openSettings();
  await settings.locator("#extension-status").click();
  await poll(storedPreferences, (p) => p?.enabled === false, { message: "paused in storage" });
  await settings.locator("#extension-status").click();
  await poll(storedPreferences, (p) => p?.enabled === true, { message: "resumed in storage" });

  await settings.fill("#site-hostname", "bad host!");
  await settings.click("#site-form button[type=submit]");
  await settings.locator("#site-error").waitFor({ state: "visible" });

  for (const host of ["alpha.example", "beta.example"]) {
    await settings.fill("#site-hostname", host);
    await settings.click("#site-form button[type=submit]");
  }
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 2,
    { message: "two rules" },
  );
  await settings.fill("#site-search", "alpha");
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 1,
    { message: "filtered" },
  );
  await settings.fill("#site-search", "");

  await settings.click("#clear-sites");
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 0,
    { message: "cleared" },
  );
  await settings.click("#undo-button");
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 2,
    { message: "undone" },
  );
});

test("settings: only the active mode's sliders show; export then import round-trips", async () => {
  const settings = await openSettings();
  await settings.selectOption("#default-mode", "sepia");
  await poll(
    () =>
      settings
        .locator("[data-mode-group]:visible")
        .evaluateAll((rows) => rows.map((r) => r.dataset.modeGroup)),
    (groups) => groups.length === 1 && groups[0] === "sepia",
    { message: "only sepia sliders" },
  );
  await settings.fill("#site-hostname", "round.example");
  await settings.click("#site-form button[type=submit]");
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 1,
  );
  const [download] = await Promise.all([
    settings.waitForEvent("download"),
    settings.click("#export-settings"),
  ]);
  const path = await download.path();
  await settings.click("#clear-sites");
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 0,
  );
  await settings.setInputFiles("#import-file", path);
  await poll(
    () => settings.locator(".site-row").count(),
    (n) => n === 1,
    { message: "imported" },
  );
  assert.equal((await storedPreferences()).defaults.mode, "sepia");
  const bad = join(tmpdir(), "darkr-bad.json");
  await writeFile(bad, "{ nope");
  await settings.setInputFiles("#import-file", bad);
  await poll(
    () => settings.locator("#data-message").innerText(),
    (t) => t.includes("not a Darkr"),
  );
});

test("settings: include subdomains extends a Never rule to subdomains", async () => {
  const settings = await openSettings();
  await settings.fill("#site-hostname", "app.localhost");
  await settings.selectOption("#site-policy", "block");
  await settings.click("#site-form button[type=submit]");
  await settings.locator(".site-row input[type=checkbox]").check();
  const page = await newPage("/policy", { origin: `http://docs.app.localhost:${env.port}` });
  await holds(
    () => isThemed(page),
    (v) => v === false,
    { message: "subdomain stays unthemed" },
  );
});
