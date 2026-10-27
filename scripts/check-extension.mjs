import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const directory = path.join(process.cwd(), "dist", "chrome-extension");
const manifestPath = path.join(directory, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("✗ chrome: missing manifest — run `npm run build` first");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const files = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);

let failed = false;
for (const file of files) {
  if (!existsSync(path.join(directory, file))) {
    console.error(`✗ chrome: missing ${file}`);
    failed = true;
  }
}
if (manifest.manifest_version !== 3) {
  console.error("✗ chrome: manifest_version must be 3");
  failed = true;
}
if (manifest.background?.service_worker !== "background.js") {
  console.error("✗ chrome: MV3 service worker missing");
  failed = true;
}
if (!failed) {
  console.log(`✓ chrome: manifest and ${files.length} referenced files verified`);
}
if (failed) process.exitCode = 1;
