// The original e2e scenarios, one named case each.
import {
  assert, test, env, newPage, setPreferences, isThemed, waitThemed, settle, poll,
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
  await poll(() => page.evaluate(() => !!document.querySelector("#darkr-theme-styles")), (v) => v === false, {
    message: "no theme stylesheet on a blocked site",
  });
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
  await poll(() => popup.locator("body").innerText(), (t) => t.includes("Darkr") && t.includes("Reading mode"), {
    message: "popup content",
  });
  await popup.screenshot({ path: "test-results/popup.png", fullPage: true });
});

test("settings page: sections present and onboarding stays dismissed", async () => {
  const settings = await env.context.newPage();
  await settings.setViewportSize({ width: 1100, height: 900 });
  await settings.goto(`chrome-extension://${env.extensionId}/options.html`);
  const onboarding = settings.locator("#onboarding-card");
  await onboarding.waitFor({ state: "visible" });
  const text = (await settings.locator("body").innerText()).toLowerCase();
  for (const expected of ["appearance for new sites", "site rules", "privacy", "website access"]) {
    assert.ok(text.includes(expected), `Settings UI missing: ${expected}`);
  }
  await settings.locator("#onboarding-dismiss").click();
  await onboarding.waitFor({ state: "hidden" });
  await settings.reload();
  await settings.locator("#onboarding-dismiss").waitFor({ state: "hidden" }).catch(() => undefined);
  await poll(() => onboarding.isHidden(), Boolean, { message: "onboarding to stay hidden after reload" });
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
  await setPreferences({ overrideNativeDark: false }, { [HOST]: { policy: "auto", overrideNativeDark: true } });
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
    () => page.evaluate(() => ({
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
      { [HOST]: { policy: "auto", overrides: { mode, darkBackground: 12, darkContrast: 62, sepiaIntensity: 58, grayscaleIntensity: 100, warmth: 35 } } },
    );
    const expectSemantic = mode !== "grayscale" && mode !== "original";
    await poll(
      () => page.evaluate(() => ({
        semantic: document.documentElement.classList.contains("darkr-semantic"),
        gray: document.documentElement.classList.contains("darkr-grayscale"),
        active: document.documentElement.classList.contains("darkr-active"),
      })),
      (s) => (mode === "original" ? !s.active || (!s.semantic && !s.gray) : mode === "grayscale" ? s.gray : s.semantic === expectSemantic),
      { message: `${mode} mode state` },
    );
    await page.locator("#article").screenshot({ path: `test-results/article-${mode}.png` });
  });
}
