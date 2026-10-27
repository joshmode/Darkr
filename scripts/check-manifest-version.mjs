import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = async (...segments) =>
  JSON.parse(await readFile(path.join(root, ...segments), "utf8"));
const packageJson = await read("package.json");
const chrome = await read("src", "manifest.chrome.json");

if (packageJson.version !== chrome.version) {
  console.error(
    `Version mismatch: package ${packageJson.version}, Chrome ${chrome.version}`,
  );
  process.exitCode = 1;
} else {
  console.log(`✓ versions aligned at ${chrome.version}`);
}
