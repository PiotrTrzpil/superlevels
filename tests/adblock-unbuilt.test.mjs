// ═══════════════════════════════════
//  Ad Block is optional: without the built lists the extension still loads,
//  Ad Block stays off, and the popup says how to set it up.
//  Runs on a copy of the extension with the generated files left out.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { chromium } from "playwright-core";
import { EXT_DIR } from "./extension.mjs";

const SKIP = new Set(["node_modules", ".git", "tests", ".playwright-mcp"]);
const GENERATED = /^adblock\/.*\.(json|css|tmp)$/;

let dir, context, worker;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sl-unbuilt-"));
  cpSync(EXT_DIR, dir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(EXT_DIR, src);
      return !SKIP.has(rel.split("/")[0]) && !GENERATED.test(rel);
    },
  });
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});

after(async () => {
  await context?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("extension loads and Ad Block stays off", async () => {
  const state = await worker.evaluate(async () => {
    await syncAdblock();
    return {
      rules: (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id < 100_000).length,
      css: (await chrome.scripting.getRegisteredContentScripts({ ids: ["sl-adblock-generic"] })).length,
    };
  });
  assert.deepEqual(state, { rules: 0, css: 0 });
});

test("popup Ads page explains the setup", async () => {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(300); // popup restores the last-open page on load
  await page.click('.nav button[data-page="adblock"]');
  await page.waitForFunction(() => document.getElementById("adblockBuild").textContent);
  assert.equal(await page.textContent("#adblockStatus"), "NOT BUILT");
  assert.equal(await page.isDisabled("#adblockToggle"), true);
  assert.match(await page.textContent("#adblockBuild"), /pnpm build:adblock/);
  assert.deepEqual(errors, []);
  await page.close();
});
