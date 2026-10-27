import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = process.cwd();
const fixtureDir = join(root, "tests/fixtures");
const extensionPath = join(root, "dist/chrome-extension");
const icons = join(root, "src/images");

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const names = {
    "/": "article.html",
    "/article": "article.html",
    "/native-dark": "native-dark.html",
    "/forms": "light-form.html",
    "/editor": "editor.html",
    "/policy": "policy-check.html",
    "/virtual": "virtual.html",
    "/favicon.ico": "favicon.ico",
  };
  const name = names[pathname];
  if (!name) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const body = await readFile(join(fixtureDir, name));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const profile = await mkdtemp(join(tmpdir(), "darkr-e2e-"));

const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  viewport: { width: 1280, height: 900 },
});
const errors = [];
context.on("page", (page) => {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
});

async function waitForWorker() {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 5000 });
  return worker;
}
const worker = await waitForWorker();
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();
await page.goto(`${origin}/article`, { waitUntil: "load" });
await page.waitForTimeout(450);
const initial = await page.evaluate(() => ({
  hasClass: document.documentElement.classList.contains("darkr-active"),
  style: !!document.querySelector("#darkr-theme-styles"),
  prepaintHeld: !!document.querySelector("#darkr-prepaint"),
  attrs: document.querySelectorAll("[data-darkr-surface]").length,
  textAttrs: document.querySelectorAll("[data-darkr-text]").length,
  bg: getComputedStyle(document.body).backgroundColor,
  imageFilter: getComputedStyle(document.querySelector("img")).filter,
}));
if (initial.prepaintHeld) throw new Error("Pre-paint guard was never released");
if (!initial.hasClass || !initial.style || !initial.attrs) throw new Error(`Dark theme did not apply: ${JSON.stringify(initial)}`);

await worker.evaluate(() => {
  const key = "darkr.preferences.v1";
  return chrome.storage.local.get(key).then((stored) => {
    const preferences = stored[key] ?? {
      schemaVersion: 1,
      enabled: true,
      defaults: {
        mode: "dark",
        darkBackground: 12,
        darkContrast: 62,
        sepiaIntensity: 58,
        grayscaleIntensity: 100,
        warmth: 35,
      },
      sites: {},
    };
    preferences.sites = preferences.sites ?? {};
    preferences.sites["127.0.0.1"] = { policy: "block" };
    return chrome.storage.local.set({ [key]: preferences });
  });
});
const policyPage = await context.newPage();
await policyPage.goto(`${origin}/policy`, { waitUntil: "load" });
await policyPage.waitForTimeout(350);
const policyInitial = await policyPage.evaluate(() => ({
  active: document.documentElement.classList.contains("darkr-active"),
}));
if (policyInitial.active) throw new Error("Blocked policy check page was themed");
await policyPage.waitForTimeout(350);
const policyBlocked = await policyPage.evaluate(() => ({
  active: document.documentElement.classList.contains("darkr-active"),
  style: !!document.querySelector("#darkr-theme-styles"),
}));
if (policyBlocked.active || policyBlocked.style) throw new Error(`Site block did not remove theme: ${JSON.stringify(policyBlocked)}`);
await worker.evaluate(() => {
  const key = "darkr.preferences.v1";
  return chrome.storage.local.get(key).then((stored) => {
    const preferences = stored[key];
    preferences.sites["127.0.0.1"] = { policy: "auto" };
    return chrome.storage.local.set({ [key]: preferences });
  });
});
await policyPage.waitForTimeout(350);
const policyRestored = await policyPage.evaluate(() => ({
  active: document.documentElement.classList.contains("darkr-active"),
}));
if (!policyRestored.active) throw new Error("Site policy did not restore theming");

async function setPreferences(patch, sitePolicy) {
  await worker.evaluate(({ patch, sitePolicy }) => {
    const key = "darkr.preferences.v1";
    return chrome.storage.local.get(key).then((stored) => {
      const preferences = { ...stored[key], ...patch };
      preferences.sites = { ...(preferences.sites ?? {}), "127.0.0.1": { policy: sitePolicy } };
      return chrome.storage.local.set({ [key]: preferences });
    });
  }, { patch, sitePolicy });
  await policyPage.waitForTimeout(350);
}
const isThemed = () => policyPage.evaluate(() => document.documentElement.classList.contains("darkr-active"));

await setPreferences({ enabled: false }, "allow");
if (!(await isThemed())) throw new Error("Always did not theme a site while Darkr is paused");
await setPreferences({ enabled: false }, "auto");
if (await isThemed()) throw new Error("Automatic themed a site while Darkr is paused");
await policyPage.emulateMedia({ colorScheme: "light" });
await setPreferences({ enabled: true, autoMode: "system" }, "auto");
if (await isThemed()) throw new Error("Automatic (system) themed a site while the system is light");
await policyPage.emulateMedia({ colorScheme: "dark" });
await policyPage.waitForTimeout(350);
if (!(await isThemed())) throw new Error("Automatic (system) did not theme after the system turned dark");
await setPreferences({ enabled: true, autoMode: "globals" }, "auto");
if (!(await isThemed())) throw new Error("Automatic (globals) did not restore theming");

const computedContrast = await page.evaluate(() => {
  const parse = (value) => {
    const match = value.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return match.slice(0, 3);
  };
  const luminance = ([r, g, b]) => {
    const channel = (v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = parse(getComputedStyle(document.body).backgroundColor);
  const text = parse(getComputedStyle(document.querySelector("#article .lead")).color);
  const foreground = parse(getComputedStyle(document.querySelector("#article a")).color);
  const ratio = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  return { text: ratio(text, background), link: ratio(foreground, background) };
});
if (computedContrast.text < 4.5 || computedContrast.link < 4.5) {
  throw new Error(`Browser contrast floor failed: ${JSON.stringify(computedContrast)}`);
}

const popup = await context.newPage();
await popup.setViewportSize({ width: 390, height: 760 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.waitForTimeout(250);
const popupText = await popup.locator("body").innerText();
if (!popupText.includes("Darkr") || !popupText.includes("Reading mode")) throw new Error("Popup UI missing expected content");
await popup.screenshot({ path: "test-results/popup.png", fullPage: true });

await page.bringToFront();
await page.waitForTimeout(100);
const settings = await context.newPage();
await settings.setViewportSize({ width: 1100, height: 900 });
await settings.goto(`chrome-extension://${extensionId}/options.html`);
await settings.waitForTimeout(200);
const settingsText = (await settings.locator("body").innerText()).toLowerCase();
for (const expected of ["appearance for new sites", "site rules", "privacy", "website access"]) {
  if (!settingsText.includes(expected)) throw new Error(`Settings UI missing: ${expected}`);
}
const onboarding = settings.locator("#onboarding-card");
if (await onboarding.isHidden()) throw new Error("First-run onboarding should be visible before dismissal");
await settings.locator("#onboarding-dismiss").click();
await settings.waitForTimeout(100);
if (!(await onboarding.isHidden())) throw new Error("First-run onboarding did not dismiss");
await settings.reload();
await settings.waitForTimeout(150);
if (!(await onboarding.isHidden())) throw new Error("First-run onboarding returned after dismissal");
await settings.screenshot({ path: "test-results/settings.png", fullPage: true });

const nativeDark = await context.newPage();
await nativeDark.goto(`${origin}/native-dark`, { waitUntil: "load" });
await nativeDark.waitForTimeout(350);
const nativeResult = await nativeDark.evaluate(() => ({
  class: document.documentElement.classList.contains("darkr-active"),
  style: !!document.querySelector("#darkr-theme-styles"),
  bg: getComputedStyle(document.body).backgroundColor,
}));
if (nativeResult.class || nativeResult.style) throw new Error(`Native dark page was modified: ${JSON.stringify(nativeResult)}`);

async function patchPreferences({ global, site }) {
  await worker.evaluate(({ global, site }) => {
    const key = "darkr.preferences.v1";
    return chrome.storage.local.get(key).then((stored) => {
      const preferences = stored[key];
      if (global !== undefined) preferences.overrideNativeDark = global;
      if (site === null) delete preferences.sites["127.0.0.1"];
      else if (site) preferences.sites["127.0.0.1"] = site;
      return chrome.storage.local.set({ [key]: preferences });
    });
  }, { global, site });
  await nativeDark.waitForTimeout(350);
}
const nativeThemed = () => nativeDark.evaluate(() => document.documentElement.classList.contains("darkr-active"));
await patchPreferences({ global: true });
if (!(await nativeThemed())) throw new Error("Global native-dark override did not theme a natively dark page");
await patchPreferences({ site: { policy: "auto", overrideNativeDark: false } });
if (await nativeThemed()) throw new Error("Per-site native-dark choice did not beat the global override");
await patchPreferences({ global: false, site: { policy: "auto", overrideNativeDark: true } });
if (!(await nativeThemed())) throw new Error("Per-site native-dark override did not theme the page");
await patchPreferences({ global: false, site: null });
if (await nativeThemed()) throw new Error("Native dark page was not restored to untouched");

const forms = await context.newPage();
await forms.goto(`${origin}/forms`, { waitUntil: "load" });
await forms.waitForTimeout(300);
const form = forms.locator("#notes");
await form.fill("Selection and typing survive theming");
await form.selectText();
const formResult = await forms.evaluate(() => {
  const textarea = document.querySelector("#notes");
  return {
    value: textarea.value,
    selection: textarea.selectionEnd,
    color: getComputedStyle(textarea).color,
    background: getComputedStyle(textarea).backgroundColor,
  };
});
if (formResult.value !== "Selection and typing survive theming" || formResult.selection === 0) throw new Error(`Form control broken: ${JSON.stringify(formResult)}`);
await forms.screenshot({ path: "test-results/forms.png", fullPage: true });

const editor = await context.newPage();
await editor.goto(`${origin}/editor`, { waitUntil: "load" });
await editor.waitForTimeout(300);
const editorResult = await editor.evaluate(() => ({
  tokenTextAttrs: document.querySelector("#token").hasAttribute("data-darkr-text"),
  inputThemed: document.querySelector("#outside").getAttribute("style")?.includes("--darkr-element"),
  rootActive: document.documentElement.classList.contains("darkr-active"),
}));
if (editorResult.tokenTextAttrs || !editorResult.rootActive) throw new Error(`Editor protection failed: ${JSON.stringify(editorResult)}`);

const dynamic = await context.newPage();
await dynamic.goto(`${origin}/article`, { waitUntil: "load" });
await dynamic.waitForTimeout(300);
await dynamic.evaluate(() => window.addDynamicContent());
await dynamic.waitForTimeout(250);
const dynamicResult = await dynamic.evaluate(() => ({
  surface: !!document.querySelector("#dynamic .card[data-darkr-surface]"),
  text: !!document.querySelector("#dynamic p[data-darkr-text]"),
}));
if (!dynamicResult.surface || !dynamicResult.text) throw new Error(`Dynamic content not themed: ${JSON.stringify(dynamicResult)}`);

await page.screenshot({ path: "test-results/article-dark.png", fullPage: false });

const modeResults = {};
for (const [mode, file, selector] of [
  ["sepia", "article-sepia.png", "#article"],
  ["grayscale", "article-grayscale.png", "#article"],
  ["warm", "article-warm.png", "#article"],
  ["original", "article-original.png", "#article"],
]) {
  await worker.evaluate((nextMode) => {
    const key = "darkr.preferences.v1";
    return chrome.storage.local.get(key).then((stored) => {
      const preferences = stored[key] ?? {
        schemaVersion: 1,
        enabled: true,
        defaults: {
          mode: "dark",
          darkBackground: 12,
          darkContrast: 62,
          sepiaIntensity: 58,
          grayscaleIntensity: 100,
          warmth: 35,
        },
        sites: {},
      };
      preferences.sites = preferences.sites ?? {};
      preferences.sites["127.0.0.1"] = {
        policy: "auto",
        overrides: { ...preferences.defaults, mode: nextMode },
      };
      return chrome.storage.local.set({ [key]: preferences });
    });
  }, mode);
  await page.waitForTimeout(240);
  modeResults[mode] = await page.evaluate(() => ({
    rootClass: document.documentElement.className,
    bg: getComputedStyle(document.body).backgroundColor,
    hasSemantic: document.documentElement.classList.contains("darkr-semantic"),
    imageFilter: getComputedStyle(document.querySelector("img")).filter,
  }));
  await page.locator(selector).screenshot({ path: `test-results/${file}` });
}

console.log(JSON.stringify({ extensionId, initial, policyInitial, policyBlocked, policyRestored, computedContrast, nativeResult, formResult, editorResult, dynamicResult, modeResults, errors }, null, 2));
if (errors.some((error) => !error.includes("favicon"))) throw new Error(`Console errors: ${errors.join(" | ")}`);
await context.close();
server.close();
