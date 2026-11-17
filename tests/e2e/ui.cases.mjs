// The real popup, settings and welcome pages driven in the built extension.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { assert, env, newPage, poll, settle, test, waitThemed } from "./harness.mjs";

const HOST = "127.0.0.1";
const storedPreferences = () =>
  env.worker.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key],
    "darkr.preferences.v1",
  );

/**
 * Opens popup.html as an extension page whose "active tab" is `page`: only
 * tabs.query is redirected, everything else (storage, messaging with the real
 * content script) is the real browser.
 */
async function openPopupFor(page) {
  const url = page.url();
  const tabId = await env.worker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return tab.id;
  }, url);
  const popup = await env.context.newPage();
  await popup.addInitScript(
    ({ tabId, url }) => {
      chrome.tabs.query = async () => [{ id: tabId, url }];
    },
    { tabId, url },
  );
  await popup.goto(`chrome-extension://${env.extensionId}/popup.html`);
  await popup.locator("#hostname").filter({ hasText: HOST }).waitFor();
  await popup.locator("#site-toggle:not([disabled])").waitFor();
  return popup;
}

test("popup: the site switch turns Darkr off and on for the site", async () => {
  const page = await newPage("/policy");
  await settle(page);
  const popup = await openPopupFor(page);
  await popup.click("#site-toggle");
  await waitThemed(page, false);
  assert.equal((await storedPreferences()).sites[HOST].policy, "block");
  assert.equal(await popup.locator("#appearance").isHidden(), true, "controls collapse when off");
  await popup.click("#site-toggle");
  await waitThemed(page, true);
  assert.equal((await storedPreferences()).sites?.[HOST], undefined);
});

test("popup: All sites edits the defaults, This site edits only this site", async () => {
  const page = await newPage("/policy");
  await settle(page);
  const popup = await openPopupFor(page);

  await popup.click('[data-mode="sepia"]');
  await poll(storedPreferences, (p) => p?.defaults?.mode === "sepia", { message: "default sepia" });
  assert.equal((await storedPreferences()).sites?.[HOST], undefined, "no site rule from All sites");

  await popup.click('[data-scope="site"]');
  await popup.click('[data-mode="warm"]');
  await poll(storedPreferences, (p) => p?.sites?.[HOST]?.overrides?.mode === "warm", {
    message: "site override",
  });
  assert.equal((await storedPreferences()).defaults.mode, "sepia", "defaults untouched");
  assert.equal(await popup.locator('[data-scope="all"]').isDisabled(), true);
  await popup.click("#reset");
  await poll(storedPreferences, (p) => !p?.sites?.[HOST]?.overrides, { message: "reset" });
});

test("popup: Pause everywhere pauses and Resume brings it back", async () => {
  const page = await newPage("/policy");
  await settle(page);
  const popup = await openPopupFor(page);
  await popup.click("#pause");
  await waitThemed(page, false);
  assert.equal(await popup.locator("#pause").innerText(), "Resume everywhere");
  await popup.click("#pause");
  await waitThemed(page, true);
});

test("popup: arrow keys move through the mode group", async () => {
  const page = await newPage("/policy");
  await settle(page);
  const popup = await openPopupFor(page);
  await popup.focus('[data-mode="dark"]');
  await popup.keyboard.press("ArrowDown");
  await poll(storedPreferences, (p) => p?.defaults?.mode === "sepia", { message: "ArrowDown" });
  await popup.keyboard.press("ArrowUp");
  await poll(storedPreferences, (p) => p?.defaults?.mode === "dark", { message: "ArrowUp" });
});

test("popup: unreachable pages explain themselves and offer Reload", async () => {
  const popup = await env.context.newPage();
  await popup.addInitScript(() => {
    chrome.tabs.query = async () => [{ id: 987654, url: "https://example.com/x" }];
  });
  await popup.goto(`chrome-extension://${env.extensionId}/popup.html`);
  await popup.locator("#permission-notice").waitFor({ state: "visible" });
  assert.equal(await popup.locator("#reload").isVisible(), true);
});

// -------------------------------------------------------- accessibility (axe)
const axeSource = await readFile(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

/** Loads a built extension page over http with a stubbed extension API (no CSP). */
async function openStubbed(file, { sites = {}, status = {} } = {}) {
  const page = await env.context.newPage();
  await page.setViewportSize({ width: file === "options.html" ? 1100 : 340, height: 900 });
  await page.addInitScript(
    ({ sites, status }) => {
      const store = {
        "darkr.preferences.v1": {
          schemaVersion: 2,
          enabled: true,
          defaults: {
            mode: "dark",
            darkBackground: 12,
            darkContrast: 62,
            sepiaIntensity: 58,
            grayscaleIntensity: 100,
            warmth: 35,
          },
          sites,
        },
        "darkr.onboarding.v1": false,
      };
      window.chrome = {
        storage: {
          local: {
            get: async (k) => ({ [k]: store[k] }),
            set: async (items) => Object.assign(store, items),
          },
          onChanged: { addListener() {} },
        },
        tabs: {
          query: async () => [{ id: 1, url: "https://example.com/page" }],
          sendMessage: async (_i, m) =>
            m.type === "darkr:get-status"
              ? {
                  hostname: "example.com",
                  mode: "dark",
                  active: true,
                  semanticActive: true,
                  nativeDark: false,
                  ...status,
                }
              : { ok: true },
          reload: async () => {},
        },
        runtime: {
          openOptionsPage: async () => {},
          getManifest: () => ({ version: "2.0.0" }),
          getURL: (p) => p,
        },
      };
    },
    { sites, status },
  );
  await page.goto(`${env.origin}/__ext/${file}`);
  return page;
}

async function axeViolations(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(() =>
    window.axe.run(document, { resultTypes: ["violations"] }).then((r) =>
      r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
      })),
    ),
  );
}

test("accessibility: popup has no axe violations (dark, sepia, native-dark notice)", async () => {
  for (const status of [{}, { nativeDark: true }]) {
    const popup = await openStubbed("popup.html", { status });
    await popup.locator("#hostname").filter({ hasText: "example.com" }).waitFor();
    await popup.locator("#appearance").waitFor({ state: "visible" });
    assert.deepEqual(await axeViolations(popup), [], JSON.stringify(status));
    await popup.click('[data-mode="sepia"]');
    assert.deepEqual(await axeViolations(popup), [], "sepia");
  }
});

test("accessibility: settings page has no axe violations", async () => {
  const settings = await openStubbed("options.html", {
    sites: {
      "a.example": { policy: "block" },
      "b.example": { policy: "allow", includeSubdomains: true },
    },
  });
  await settings.locator(".site-row").first().waitFor();
  assert.deepEqual(await axeViolations(settings), []);
});

test("accessibility: welcome page has no axe violations", async () => {
  const welcome = await openStubbed("welcome.html");
  assert.deepEqual(await axeViolations(welcome), []);
});
