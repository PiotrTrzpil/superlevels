// ═══════════════════════════════════
//  Test helper: launch Chromium with the unpacked extension loaded
//  (Playwright's Chromium — branded Chrome ignores --load-extension)
// ═══════════════════════════════════
import { chromium } from "playwright-core";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export async function launchExtension() {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium", // new headless mode, which supports extensions
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

// Poll fn() (run in the test) until it returns truthy
export async function waitFor(fn, { timeout = 5000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}
