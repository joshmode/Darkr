// Entry point for the browser suite: `npm run test:e2e`.
// Cases live in tests/e2e/*.cases.mjs and register themselves with node:test.
import { after, before, beforeEach, afterEach } from "node:test";
import { mkdir } from "node:fs/promises";
import { env, resetStorage, startEnvironment, stopEnvironment, assert } from "./e2e/harness.mjs";

await mkdir("test-results", { recursive: true });
before(startEnvironment);
after(stopEnvironment);
// Each case starts from default preferences, an empty storage area and no
// leftover pages, so cases cannot influence each other.
beforeEach(async () => {
  await resetStorage();
  env.errors.length = 0;
});
afterEach(async () => {
  for (const page of env.context.pages()) await page.close().catch(() => undefined);
  const real = env.errors.filter((message) => !message.includes("favicon"));
  assert.deepEqual(real, [], "console errors during the case");
});

await import("./e2e/core.cases.mjs");
await import("./e2e/defects.cases.mjs");
