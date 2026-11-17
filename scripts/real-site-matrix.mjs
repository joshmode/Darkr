// Manual release check (handbook D4): load real public sites in Chromium with the
// built extension and report how readable the themed result is. This script
// browses the web with a test browser; the extension itself makes no requests.
//
//   npm run build && node scripts/real-site-matrix.mjs
//
// Screenshots go to test-results/matrix/. Not part of CI (needs the network).
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const extensionPath = join(process.cwd(), "dist/chrome-extension");
const out = join(process.cwd(), "test-results/matrix");
await mkdir(out, { recursive: true });

// A tiny local page that embeds a real PDF.js viewer from another host.
const server = createServer(async (_req, res) => {
  const body = await readFile(join(process.cwd(), "tests/fixtures/e03-top.html"));
  res.writeHead(200, { "content-type": "text/html" }).end(body);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const embed = `http://127.0.0.1:${server.address().port}/?src=${encodeURIComponent("https://mozilla.github.io/pdf.js/web/viewer.html")}`;

const sites = [
  ["news-article", "https://en.wikinews.org/wiki/Wikinews:Main_Page"],
  ["docs-code", "https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver"],
  ["long-article", "https://en.wikipedia.org/wiki/Dark_mode"],
  ["forum-thread", "https://news.ycombinator.com/item?id=8863"],
  ["web-app", "https://github.com/microsoft/vscode"],
  ["pdfjs-viewer-iframe", embed],
];

const profile = await mkdtemp(join(tmpdir(), "darkr-matrix-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  viewport: { width: 1280, height: 900 },
});
await new Promise((done) => setTimeout(done, 1500));
for (const page of context.pages()) await page.close();

function audit() {
  const parse = (v) => (v.match(/[\d.]+/g) ?? []).map(Number);
  const channel = (v) =>
    ((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))(v / 255);
  const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const backdrop = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null; // cannot judge images/gradients
      const c = parse(style.backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return c.slice(0, 3);
    }
    return [255, 255, 255];
  };
  const bad = [];
  let judged = 0;
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_TEXT,
  );
  for (let n = walker.nextNode(); n && judged < 1500; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !el.getClientRects().length) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const fg = parse(style.color);
    if (fg.length >= 4 && fg[3] < 0.5) continue; // transparent text layers
    const bg = backdrop(el);
    if (!bg) continue;
    judged += 1;
    const value = ratio(fg.slice(0, 3), bg);
    if (value < 3)
      bad.push({
        text: n.textContent.trim().slice(0, 40),
        ratio: Number(value.toFixed(2)),
        tag: el.tagName,
      });
  }
  return {
    themed: document.documentElement.hasAttribute("data-darkr"),
    bodyBackground: getComputedStyle(document.body ?? document.documentElement).backgroundColor,
    judged,
    belowThree: bad.length,
    worst: bad.sort((a, b) => a.ratio - b.ratio).slice(0, 4),
  };
}

const results = {};
for (const [name, url] of sites) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3500);
    const frames = page.frames().filter((frame) => frame !== page.mainFrame());
    results[name] = { main: await page.evaluate(audit) };
    if (name === "pdfjs-viewer-iframe") {
      const viewer = frames.find((frame) => frame.url().includes("mozilla.github.io"));
      results[name].viewer = viewer ? await viewer.evaluate(audit) : "frame not found";
    }
    if (name === "long-article") {
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(300);
      results[name].printBackground = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      await page.emulateMedia({ media: "screen" });
    }
    await page.screenshot({ path: join(out, `${name}.png`) });
  } catch (error) {
    results[name] = { error: String(error).slice(0, 200) };
  }
  await page.close();
}
console.log(JSON.stringify(results, null, 2));
await context.close();
server.close();
