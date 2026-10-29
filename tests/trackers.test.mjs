// ═══════════════════════════════════
//  Trackers panel: end-to-end test in a real Chromium
//  Requests are answered by a Playwright route (no real network). Ad Block
//  is switched off so only the panel's own block rules apply. Name and
//  category checks need data/trackers/db.json (pnpm build:trackers).
// ═══════════════════════════════════
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launchExtension, sendMessage, waitFor, EXT_DIR } from "./extension.mjs";

const hasDb = existsSync(join(EXT_DIR, "data/trackers/db.json"));
const needsDb = { skip: !hasDb && "tracker db not built: run pnpm build:trackers" };

const PAGE_URL = "https://news.example.org/article";
const PAGE = `<!doctype html><html><body>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://cdn.jsdelivr.net/npm/foo/x.js"></script>
<img src="https://static.criteo.net/pixel.gif">
<img src="https://px.unknown-thirdparty.example/p.gif">
<img src="https://img.news.example.org/first-party.png">
</body></html>`;

let ext;

before(async () => {
  ext = await launchExtension();
  await ext.context.route(/^https?:/, (route) => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: PAGE })
    : route.fulfill({ status: 200, body: "" }));
  await setSettings({ adblock_enabled: false });
});

after(() => ext?.context.close());

async function setSettings(settings) {
  await ext.worker.evaluate((s) => chrome.storage.local.set(s), settings);
  await sendMessage(ext, { type: "adblockSync" });
  await sendMessage(ext, { type: "trackersSync" });
}

// Load the page and return the panel's data for its tab
async function visit() {
  const page = await ext.context.newPage();
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const tabId = await ext.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, PAGE_URL);
  const data = await sendMessage(ext, { type: "trackersForTab", tabId });
  return { page, data };
}

const blockedHosts = (data) => [...data.trackers.flatMap((t) => t.blocked ? t.hosts : []), ...data.others.filter((o) => o.blocked).map((o) => o.host)].sort();

describe("Trackers panel", () => {
  test("logs third-party requests only", async () => {
    const { page, data } = await visit();
    await page.close();
    assert.equal(data.page, "news.example.org");
    const hosts = [...data.trackers.flatMap((t) => t.hosts), ...data.others.map((o) => o.host)].sort();
    assert.deepEqual(hosts, ["cdn.jsdelivr.net", "px.unknown-thirdparty.example", "static.criteo.net", "www.google-analytics.com"]);
    assert.deepEqual(blockedHosts(data), []);
  });

  test("groups known hosts into trackers with company and category", needsDb, async () => {
    const { page, data } = await visit();
    await page.close();
    const ga = data.trackers.find((t) => t.id === "google_analytics");
    assert.deepEqual({ name: ga.name, company: ga.company, category: ga.category, requests: ga.requests },
      { name: "Google Analytics", company: "Google", category: "site_analytics", requests: 1 });
    assert.deepEqual(data.others.map((o) => o.host), ["px.unknown-thirdparty.example"]);
  });

  test("blocks a single tracker everywhere", needsDb, async () => {
    await setSettings({ trackers_blocked: ["jsdelivr"] });
    try {
      const { page, data } = await visit();
      await page.close();
      assert.deepEqual(blockedHosts(data), ["cdn.jsdelivr.net"]);
    } finally {
      await setSettings({ trackers_blocked: [] });
    }
  });

  test("blocks an unknown third-party host", async () => {
    await setSettings({ trackers_blocked_hosts: ["px.unknown-thirdparty.example"] });
    try {
      const { page, data } = await visit();
      await page.close();
      assert.deepEqual(blockedHosts(data), ["px.unknown-thirdparty.example"]);
    } finally {
      await setSettings({ trackers_blocked_hosts: [] });
    }
  });

  test("Ad Block syncs leave the panel's rules alone", async () => {
    await setSettings({ trackers_blocked_hosts: ["px.unknown-thirdparty.example"] });
    try {
      await setSettings({ adblock_enabled: true });
      await setSettings({ adblock_enabled: false });
      const ids = await ext.worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id));
      assert.ok(ids.includes(100000), `tracker rule missing: ${ids.filter((id) => id >= 100000)}`);
    } finally {
      await setSettings({ trackers_blocked_hosts: [] });
    }
  });

  test("popup renders the page's trackers and toggles a block", async () => {
    const { page } = await visit();
    const tabId = await ext.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, PAGE_URL);
    const popup = await ext.context.newPage();
    const errors = [];
    popup.on("pageerror", (e) => errors.push(e.message));
    // Opened as a tab, the popup is itself the active tab; make it see the test page instead
    await popup.addInitScript((id) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (q.active ? [await chrome.tabs.get(id)] : query(q));
    }, tabId);
    await popup.goto(`chrome-extension://${ext.extensionId}/src/popup/popup.html`);
    await popup.click('.nav button[data-group="privacy"]');
    await popup.click('.subnav button[data-page="trackers"]');
    await waitFor(async () => /third parties/.test(await popup.textContent("#trkSummary")));
    assert.match(await popup.textContent("#trkSummary"), /^4 third parties · 0 blocked$/);
    const names = await popup.$$eval("#trkList .trk-name", (els) => els.map((e) => e.firstChild.textContent));
    assert.ok(names.includes(hasDb ? "Criteo" : "static.criteo.net"), names.join());

    // Block the unknown host from its row
    const row = popup.locator(".trk-row", { hasText: "px.unknown-thirdparty.example" });
    await row.locator(".slider").click();
    await waitFor(() => ext.worker.evaluate(async () =>
      (await chrome.storage.local.get("trackers_blocked_hosts")).trackers_blocked_hosts?.length));
    await waitFor(() => ext.worker.evaluate(async () =>
      (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.id === 100000)));
    await setSettings({ trackers_blocked_hosts: [] });
    assert.deepEqual(errors, []);
    await popup.close();
    await page.close();
  });
});
