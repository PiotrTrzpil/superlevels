// ═══════════════════════════════════
//  Test helper: launch Chromium with the unpacked extension loaded
//  (Playwright's Chromium — branded Chrome ignores --load-extension)
// ═══════════════════════════════════
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// Chrome's id for an unpacked extension: SHA-256 of its real path, hex digits written as a-p
export function unpackedExtensionId(dir = EXT_DIR) {
  const hex = createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

// nativeHosts: { "com.example.host": "/path/to/executable" } are registered for the
// extension. Chromium looks for hosts in its profile folder, so then the profile is a
// temp folder made here (removed when the context closes) instead of Playwright's own.
export async function launchExtension({ nativeHosts = {} } = {}) {
  let profile = "";
  if (Object.keys(nativeHosts).length) {
    profile = mkdtempSync(join(tmpdir(), "sl-profile-"));
    const hostDir = join(profile, "NativeMessagingHosts");
    mkdirSync(hostDir);
    for (const [name, path] of Object.entries(nativeHosts)) {
      writeFileSync(join(hostDir, `${name}.json`), JSON.stringify({
        name, path, type: "stdio", description: "test host",
        allowed_origins: [`chrome-extension://${unpackedExtensionId()}/`],
      }));
    }
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", // new headless mode, which supports extensions
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  if (profile) {
    // Chromium may still be writing to the profile as it exits
    context.on("close", () => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  }
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
