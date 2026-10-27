import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Builds the Darkr web extension.
 *
 * By default this produces the unpacked Chrome (Manifest V3) extension at
 * dist/chrome-extension. Other hosts can reuse the same sources by supplying
 * their own manifest and output directory:
 *
 *   DARKR_MANIFEST  path to the manifest to ship (default: src/manifest.chrome.json)
 *   DARKR_OUT       output directory            (default: dist/chrome-extension)
 *   DARKR_BROWSERS  comma separated esbuild targets (default: chrome109)
 *   DARKR_VERSION   overrides the manifest version
 */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(projectRoot, "src");
const resolveFromCwd = (value) => path.resolve(process.cwd(), value);
const manifestSource = process.env.DARKR_MANIFEST
  ? resolveFromCwd(process.env.DARKR_MANIFEST)
  : path.join(source, "manifest.chrome.json");
const output = process.env.DARKR_OUT
  ? resolveFromCwd(process.env.DARKR_OUT)
  : path.join(projectRoot, "dist", "chrome-extension");
const targets = (process.env.DARKR_BROWSERS ?? "chrome109")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: targets,
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
};

const entries = [
  ["content/index.ts", "content.js"],
  ["background/index.ts", "background.js"],
  ["popup/ui.ts", "popup.js"],
  ["options/ui.ts", "options.js"],
].map(([entry, outfile]) => ({
  entryPoints: [path.join(source, entry)],
  outfile: path.join(output, outfile),
}));

const staticFiles = [
  ["popup/popup.html", "popup.html"],
  ["popup/popup.css", "popup.css"],
  ["options/options.html", "options.html"],
  ["options/options.css", "options.css"],
  ["styles/base.css", "base.css"],
];

async function copyStatic() {
  await Promise.all(
    staticFiles.map(([from, to]) =>
      cp(path.join(source, from), path.join(output, to)),
    ),
  );
  await cp(path.join(source, "images"), path.join(output, "images"), {
    recursive: true,
  });

  const manifest = JSON.parse(await readFile(manifestSource, "utf8"));
  manifest.version = process.env.DARKR_VERSION ?? manifest.version;
  await writeFile(
    path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function verifyOutput() {
  const manifest = JSON.parse(
    await readFile(path.join(output, "manifest.json"), "utf8"),
  );
  const required = [
    ...(manifest.background?.scripts ?? []),
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
  const missing = required.filter(
    (file) => !existsSync(path.join(output, file)),
  );
  if (missing.length) {
    throw new Error(`Missing web extension resources: ${missing.join(", ")}`);
  }
  console.log(
    `Built Darkr ${manifest.version} → ${path.relative(process.cwd(), output) || "."} (${required.length} resources verified)`,
  );
}

if (!watch) {
  await rm(output, { recursive: true, force: true });
}
await mkdir(output, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(
    entries.map((options) => context({ ...shared, ...options })),
  );
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  console.log(`Watching TypeScript → ${path.relative(process.cwd(), output)}`);
} else {
  await Promise.all(
    entries.map((options) => build({ ...shared, ...options })),
  );
  await verifyOutput();
}
