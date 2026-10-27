import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import process from "node:process";

/**
 * Renders the real popup against a stubbed extension API in every theme,
 * background level, rule state and page state, and fails if any visible text
 * (opacity included) drops below WCAG AA contrast against its background.
 */
const root = join(process.cwd(), "dist", "chrome-extension");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://x").pathname.slice(1) || "popup.html";
    const body = await readFile(join(root, path));
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const defaults = { mode: "dark", darkBackground: 12, darkContrast: 62, sepiaIntensity: 58, grayscaleIntensity: 100, warmth: 35 };
const statuses = {
  normal: { hostname: "example.com", mode: "dark", active: true, semanticActive: true, nativeDark: false, permissionWarning: false },
  nativeDark: { hostname: "example.com", mode: "dark", active: true, semanticActive: false, nativeDark: true, permissionWarning: false },
};

function audit() {
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const channel = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backgroundOf = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed.length >= 3 && (parsed[3] === undefined || parsed[3] > 0.5)) return parsed.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const failures = [];
  for (const element of document.querySelectorAll("body *")) {
    const text = [...element.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!text || element.closest("[hidden]")) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const background = backgroundOf(element);
    let alpha = 1;
    for (let node = element; node; node = node.parentElement) alpha *= parseFloat(getComputedStyle(node).opacity);
    const foreground = parse(style.color).slice(0, 3).map((v, i) => v * alpha + background[i] * (1 - alpha));
    const value = ratio(foreground, background);
    if (value < 4.5) failures.push(`"${text.slice(0, 28)}" ${value.toFixed(2)}`);
  }
  return failures;
}

const browser = await chromium.launch({ channel: "chromium" });
const failures = [];
let combinations = 0;
for (const [statusName, status] of Object.entries(statuses)) {
  for (const mode of ["original", "dark", "sepia", "warm", "grayscale"]) {
    for (const darkBackground of [0, 40, 100]) {
      for (const withRule of [false, true]) {
        const preferences = {
          schemaVersion: 1, enabled: true, autoMode: "globals", overrideNativeDark: false,
          defaults: { ...defaults, mode, darkBackground },
          sites: withRule ? { "example.com": { policy: "allow", overrideNativeDark: true, overrides: { darkBackground } } } : {},
        };
        const page = await browser.newPage({ viewport: { width: 340, height: 600 } });
        await page.addInitScript(({ preferences, status }) => {
          const store = { "darkr.preferences.v1": preferences, "darkr.onboarding.v1": true };
          window.chrome = {
            storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (items) => Object.assign(store, items) }, onChanged: { addListener() {} } },
            tabs: { query: async () => [{ id: 1, url: "https://example.com/page" }], sendMessage: async (_i, m) => (m.type === "darkr:get-status" ? status : { ok: true }) },
            runtime: { openOptionsPage: async () => {}, getManifest: () => ({ version: "1.0.0" }), getURL: (p) => p },
          };
        }, { preferences, status });
        await page.goto(`${base}/popup.html`);
        await page.waitForSelector("#hostname:not(:text('Loading…'))");
        await page.waitForTimeout(450); // let colour transitions finish
        for (const item of await page.evaluate(audit)) {
          failures.push(`${statusName}/${mode}/bg${darkBackground}/${withRule ? "rule" : "norule"}: ${item}`);
        }
        await page.close();
        combinations += 1;
      }
    }
  }
}
await browser.close();
server.close();
if (failures.length) {
  console.error(`✗ popup contrast: ${failures.length} failure(s)\n  ${[...new Set(failures)].slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ popup contrast: ${combinations} combinations meet 4.5:1`);
