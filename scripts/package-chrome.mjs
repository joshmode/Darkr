import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const source = path.join(root, "dist", "chrome-extension");
const releases = path.join(root, "dist", "releases");
const staging = path.join(releases, "darkr-chrome");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
const zipName = `darkr-chrome-v${manifest.version}.zip`;

await rm(staging, { recursive: true, force: true });
await mkdir(releases, { recursive: true });
await cp(source, staging, { recursive: true });
await writeFile(
  path.join(staging, "README.txt"),
  `Darkr ${manifest.version}
Standalone Chrome extension

Install:
1. Open chrome://extensions
2. Enable Developer mode
3. Choose "Load unpacked" and select this folder

Darkr stores preferences locally and makes no network requests.
`,
);

// The archive has manifest.json at its root so it can be uploaded to the
// Chrome Web Store as-is. The README lives only in the unpacked folder.
await rm(path.join(releases, zipName), { force: true });
await run("zip", ["-qr", "-X", path.join(releases, zipName), "."], {
  cwd: source,
});
console.log(`Packaged ${path.relative(root, path.join(releases, zipName))}`);
