import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = process.cwd();
const extensionPath = join(root, "dist/chrome-extension");
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/large") {
    const rows = Array.from({ length: 5000 }, (_, index) =>
      `<div class="row"><p>Article paragraph ${index + 1} with <a href="#${index}">a link</a>.</p></div>`,
    ).join("");
    response.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><html><head><style>body{background:#fff;color:#222}.row{background:#fff;border-bottom:1px solid #eee;padding:2px 8px}</style></head><body><main>${rows}</main></body></html>`,
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/html" }).end(
    await readFile(join(root, "tests/fixtures/article.html")),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "darkr-perf-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
const page = await context.newPage();
await page.goto(`${origin}/`, { waitUntil: "load" });
await page.waitForTimeout(500);
const startup = await page.evaluate(() => {
  const timings = performance.getEntriesByType("navigation")[0];
  return {
    domContentLoaded: timings?.domContentLoadedEventEnd ?? 0,
    load: timings?.loadEventEnd ?? 0,
    themedElements:
      document.querySelectorAll("[data-darkr-surface], [data-darkr-text]").length,
  };
});
await page.goto(`${origin}/large`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const large = await page.evaluate(() => ({
  elements: document.querySelectorAll("*").length,
  themed: document.querySelectorAll("[data-darkr-surface], [data-darkr-text]").length,
  styles: document.querySelectorAll("style#darkr-theme-styles").length,
}));
console.log(JSON.stringify({ startup, large }, null, 2));
await context.close();
server.close();
