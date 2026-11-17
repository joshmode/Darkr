// Shared Playwright harness for the e2e cases: one Chromium with the built
// extension, one static fixture server (reachable as 127.0.0.1 and localhost),
// and helpers for preferences, polling and contrast.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = process.cwd();
const fixtureDir = join(root, "tests/fixtures");
const extensionPath = join(root, "dist/chrome-extension");
export const PREFERENCES_KEY = "darkr.preferences.v1";

/** Routes whose name differs from the fixture file. */
const ALIASES = {
  "/": "article.html",
  "/article": "article.html",
  "/native-dark": "native-dark.html",
  "/forms": "light-form.html",
  "/editor": "editor.html",
  "/policy": "policy-check.html",
  "/virtual": "virtual.html",
};

/** Generated fixtures too large to keep in the repository. */
const GENERATED = {
  "/e06-many-cards": () => {
    const cards = Array.from(
      { length: 12000 },
      (_, i) => `<div class="card" id="c${i}"><p>Card ${i}</p></div>`,
    ).join("");
    return `<!doctype html><meta charset="utf-8"><title>E-06</title><style>
body{background:#fff;color:#111;font-family:system-ui;margin:0}
.card{background:#fafafa;border:1px solid #ddd;padding:2px 8px;margin:2px}
</style><body>${cards}</body>`;
  },
};

export const env = {
  context: null,
  worker: null,
  extensionId: "",
  port: 0,
  /** Fixture origin addressed as 127.0.0.1. */
  origin: "",
  /** The same server addressed as localhost (a different hostname). */
  altOrigin: "",
  errors: [],
};

let server = null;
let profile = "";

export async function startEnvironment() {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://x").pathname;
    if (pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const generated = GENERATED[pathname];
    if (generated) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(generated());
      return;
    }
    const name = ALIASES[pathname] ?? `${pathname.replace(/^\/+/, "")}.html`;
    if (!/^[\w.-]+$/.test(name)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(join(fixtureDir, name));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  env.port = server.address().port;
  env.origin = `http://127.0.0.1:${env.port}`;
  env.altOrigin = `http://localhost:${env.port}`;
  profile = await mkdtemp(join(tmpdir(), "darkr-e2e-"));
  env.context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1280, height: 900 },
  });
  env.context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") env.errors.push(message.text());
    });
    page.on("pageerror", (error) => env.errors.push(error.message));
  });
  let [worker] = env.context.serviceWorkers();
  if (!worker) worker = await env.context.waitForEvent("serviceworker", { timeout: 10000 });
  env.worker = worker;
  env.extensionId = new URL(worker.url()).host;
  // A fresh profile opens the Settings tab on install; wait for it so it
  // cannot interrupt a navigation, then close it.
  await poll(
    () => env.context.pages().some((p) => p.url().startsWith("chrome-extension://")),
    Boolean,
    { timeout: 10000, message: "install Settings tab never opened" },
  ).catch(() => undefined);
  for (const page of env.context.pages()) {
    if (page.url().startsWith("chrome-extension://")) await page.close();
  }
}

export async function stopEnvironment() {
  await env.context?.close();
  await new Promise((done) => (server ? server.close(done) : done()));
  if (profile) await rm(profile, { recursive: true, force: true });
}

/** Retry `read` until `accept(value)` is true; fail with the last value. */
export async function poll(
  read,
  accept = Boolean,
  { timeout = 5000, interval = 50, message = "condition" } = {},
) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) {
      assert.fail(`Timed out waiting for ${message}; last value: ${JSON.stringify(last)}`);
    }
    await new Promise((done) => setTimeout(done, interval));
  }
}

/** Assert `read` keeps satisfying `accept` for `duration` ms (negative checks). */
export async function holds(
  read,
  accept,
  { duration = 600, interval = 50, message = "condition" } = {},
) {
  const end = Date.now() + duration;
  do {
    const value = await read();
    assert.ok(accept(value), `${message} did not hold; value: ${JSON.stringify(value)}`);
    await new Promise((done) => setTimeout(done, interval));
  } while (Date.now() < end);
}

/** Write preferences through the service worker. `null` clears the key. */
export async function setPreferences(patch, sites) {
  await env.worker.evaluate(
    async ({ key, patch, sites }) => {
      const stored = (await chrome.storage.local.get(key))[key];
      const base = stored ?? {
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
      const next = { ...base, ...patch };
      next.sites = { ...(base.sites ?? {}) };
      for (const [host, rule] of Object.entries(sites ?? {})) {
        if (rule === null) delete next.sites[host];
        else next.sites[host] = rule;
      }
      await chrome.storage.local.set({ [key]: next });
    },
    { key: PREFERENCES_KEY, patch: patch ?? {}, sites: sites ?? {} },
  );
}

export async function resetStorage() {
  await env.worker.evaluate(() => chrome.storage.local.clear());
}

export async function newPage(path, { origin = env.origin, waitUntil = "load" } = {}) {
  const page = await env.context.newPage();
  if (path) await page.goto(`${origin}${path}`, { waitUntil });
  return page;
}

export const isThemed = (frameOrPage) =>
  frameOrPage.evaluate(() => document.documentElement.classList.contains("darkr-active"));

export const waitThemed = (frameOrPage, themed = true, timeout = 5000) =>
  poll(
    () => isThemed(frameOrPage),
    (v) => v === themed,
    {
      timeout,
      message: themed ? "page to be themed" : "page to be unthemed",
    },
  );

/** Wait until the engine has finished its initial work on a themed page. */
export async function settle(frameOrPage) {
  await waitThemed(frameOrPage);
  await poll(
    () => frameOrPage.evaluate(() => !document.querySelector("#darkr-prepaint")),
    Boolean,
    {
      message: "pre-paint hold to be released",
    },
  );
  // Two frames plus an idle slot cover the engine's rAF / idle batches.
  await frameOrPage.evaluate(
    () =>
      new Promise((done) => {
        const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 50));
        requestAnimationFrame(() =>
          requestAnimationFrame(() => idle(() => done(), { timeout: 300 })),
        );
      }),
  );
}

/**
 * Contrast ratio of an element's computed text colour against the computed
 * background of `ancestor` (a selector resolved with `closest` from the
 * element, or an explicit selector in the document).
 */
export function contrastAgainstAncestor(frameOrPage, selector, ancestor) {
  return frameOrPage.evaluate(
    ({ selector, ancestor }) => {
      const parse = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]) => {
        const c = (v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
      };
      const element = document.querySelector(selector);
      const surface = element.closest(ancestor) ?? document.querySelector(ancestor);
      const fg = parse(getComputedStyle(element).color);
      const bg = parse(getComputedStyle(surface).backgroundColor);
      const a = lum(fg);
      const b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    { selector, ancestor },
  );
}

export const colorOf = (frameOrPage, selector, property = "color") =>
  frameOrPage.evaluate(
    ({ selector, property }) => getComputedStyle(document.querySelector(selector))[property],
    { selector, property },
  );

/** Alpha channel of a computed colour string. */
export const alphaOf = (value) => {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return parts.length > 3 ? parts[3] : 1;
};

/** Relative luminance of a computed `rgb()` string. */
export const luminanceOf = (value) => {
  const [r, g, b] = (value.match(/[\d.]+/g) ?? []).map(Number);
  const c = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};

/**
 * Register a case for a defect that is not fixed yet. The body must fail; the
 * case passes while it does and fails once the bug is fixed, so the marker
 * cannot be forgotten.
 */
export function knownBug(id, reason, name, body) {
  test(`[known bug ${id}] ${name}`, async (t) => {
    let failed = false;
    try {
      await body(t);
    } catch {
      failed = true;
    }
    t.diagnostic(`expected failure (${id}): ${reason}`);
    assert.ok(failed, `${id} now passes: remove knownBug() and keep it as a normal test`);
  });
}

export { test, assert };
