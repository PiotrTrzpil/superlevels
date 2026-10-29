// ═══════════════════════════════════
//  Ad Block: end-to-end test in a real Chromium
//  No real network: every request is answered by a Playwright route, and
//  declarativeNetRequest blocks happen before routing, so a blocked request
//  shows up as net::ERR_BLOCKED_BY_CLIENT.
//  Needs the lists built (pnpm build:adblock); skipped otherwise.
// ═══════════════════════════════════
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchExtension, waitFor, EXT_DIR } from "./extension.mjs";

const AD_HOSTS = [
  "pagead2.googlesyndication.com",
  "securepubads.g.doubleclick.net",
  "static.criteo.net",
  "www.google-analytics.com",
  "www.googletagmanager.com",
];
const SAFE_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "code.jquery.com"];

// Element ids, each covered by a different kind of hiding rule in cosmetic.json/generic.css
const ELEMENTS = {
  generic: "AD_300",           // ###AD_300 — in generic.css
  excepted: "ad-carousel",     // generic, but un-hidden on dez.ro (dez.ro#@##ad-carousel)
  specific: "banner_ad",       // 10minutemail.com###banner_ad
  content: "content",          // never hidden
};

const PAGE = `<!doctype html><html><body>
${Object.values(ELEMENTS).map((id) => `<div id="${id}">${id}</div>`).join("\n")}
<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>
<script src="https://static.criteo.net/js/ld/publishertag.js"></script>
<img src="https://securepubads.g.doubleclick.net/pixel.gif">
<script src="https://cdn.jsdelivr.net/npm/foo/x.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter">
<script src="https://code.jquery.com/jquery.js"></script>
</body></html>`;

const built = existsSync(join(EXT_DIR, "data/adblock/meta.json"));

describe("Ad Block", { skip: !built && "lists not built: run pnpm build:adblock" }, () => {
  let ext;

  before(async () => {
    ext = await launchExtension();
    // http(s) only — "**/*" would also swallow the chrome-extension:// popup
    await ext.context.route(/^https?:/, (route) => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: PAGE })
      : route.fulfill({ status: 200, body: "" }));
    // Initial sync done once the generic CSS is registered
    await waitFor(() => ext.worker.evaluate(async () =>
      (await chrome.scripting.getRegisteredContentScripts({ ids: ["sl-adblock-generic"] })).length));
  });

  after(() => ext?.context.close());

  // Run in the service worker: update settings and wait for the rules to swap
  const setSettings = (settings) => ext.worker.evaluate(async (s) => {
    await chrome.storage.local.set(s);
    await syncAdblock();
  }, settings);

  async function visit(url) {
    const page = await ext.context.newPage();
    const blocked = new Set();
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText.includes("BLOCKED_BY_CLIENT")) blocked.add(new URL(r.url()).hostname);
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(300); // insertCSS from webNavigation.onCommitted is async
    const hidden = await page.evaluate((ids) => Object.fromEntries(Object.entries(ids).map(
      ([kind, id]) => [kind, getComputedStyle(document.getElementById(id)).display === "none"])), ELEMENTS);
    await page.close();
    return { blocked: [...blocked].sort(), hidden };
  }

  test("Chrome accepted the list rules", async () => {
    const rules = JSON.parse(await readFile(join(EXT_DIR, "data/adblock/rules.json"), "utf8"));
    const loaded = await ext.worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id < 100_000).length);
    assert.equal(loaded, rules.length);

    // Check a sample of plain path rules actually match (testMatchOutcome: unpacked only)
    const urls = rules
      .filter((r) => r.action.type === "block" && Object.keys(r.condition).join() === "urlFilter")
      .map((r) => r.condition.urlFilter)
      .filter((f) => /^\|\|[a-z0-9-]+\.[a-z0-9.-]*[a-z]\/[\w./-]*$/.test(f)) // ||host.tld/path
      .slice(0, 300)
      .map((f) => "https://" + f.slice(2));
    assert.ok(urls.length > 100, `only ${urls.length} sample rules`);
    const missed = await ext.worker.evaluate(async (urls) => {
      const missed = [];
      for (const url of urls) {
        const { matchedRules } = await chrome.declarativeNetRequest.testMatchOutcome({ url, type: "script", initiator: "https://example.org" });
        if (!matchedRules.length) missed.push(url);
      }
      return missed;
    }, urls);
    assert.deepEqual(missed, []);
  });

  test("blocks ad/tracker requests and hides ad slots", async () => {
    const { blocked, hidden } = await visit("https://news.example.org/article");
    assert.deepEqual(blocked, AD_HOSTS);
    for (const host of SAFE_HOSTS) assert.ok(!blocked.includes(host), `${host} should load`);
    assert.deepEqual(hidden, { generic: true, excepted: true, specific: false, content: false });
  });

  test("applies site-specific hiding rules", async () => {
    const { hidden } = await visit("https://10minutemail.com/");
    assert.equal(hidden.specific, true);
    assert.equal(hidden.content, false);
  });

  test("honours #@# exceptions", async () => {
    const { hidden } = await visit("https://dez.ro/");
    assert.equal(hidden.excepted, false);
    assert.equal(hidden.generic, true);
  });

  test("pausing a site turns everything off there, and only there", async () => {
    await setSettings({ adblock_paused: ["example.org"] });
    try {
      const paused = await visit("https://news.example.org/article");
      assert.deepEqual(paused.blocked, []);
      assert.deepEqual(paused.hidden, { generic: false, excepted: false, specific: false, content: false });

      const other = await visit("https://10minutemail.com/");
      assert.deepEqual(other.blocked, AD_HOSTS);
      assert.equal(other.hidden.generic, true);
    } finally {
      await setSettings({ adblock_paused: [] });
    }
  });

  test("main toggle disables blocking and hiding", async () => {
    await setSettings({ adblock_enabled: false });
    try {
      const { blocked, hidden } = await visit("https://10minutemail.com/");
      assert.deepEqual(blocked, []);
      assert.equal(hidden.generic, false);
      assert.equal(hidden.specific, false);
    } finally {
      await setSettings({ adblock_enabled: true });
    }
  });

  test("extra lists switch on and off", async (t) => {
    const meta = JSON.parse(await readFile(join(EXT_DIR, "data/adblock/meta.json"), "utf8"));
    if (!meta.extras?.length) return t.skip("built without extra lists");
    const ids = meta.extras.map((e) => e.id);
    const ruleCount = () => ext.worker.evaluate(async () =>
      (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id > 1 && r.id < 100_000).length);

    // A merged-domain rule and a plain id/class selector from each list
    const samples = await Promise.all(ids.map(async (id) => {
      const rules = JSON.parse(await readFile(join(EXT_DIR, `data/adblock/extra-${id}.rules.json`), "utf8"));
      const css = await readFile(join(EXT_DIR, `data/adblock/extra-${id}.css`), "utf8");
      const candidates = rules.find((r) => r.condition.requestDomains)?.condition.requestDomains.slice(0, 20) ?? [];
      const selector = css.match(/^([#.][A-Za-z][\w-]*)\{/m)?.[1];
      return { id, candidates, selector };
    }));
    const matches = (domains) => ext.worker.evaluate(async (domains) => Promise.all(domains.map(async (d) =>
      (await chrome.declarativeNetRequest.testMatchOutcome({ url: `https://${d}/x.js`, type: "script", initiator: "https://example.org" })).matchedRules.length > 0)), domains);
    const hides = async (selectors) => {
      const page = await ext.context.newPage();
      await page.goto("https://news.example.org/article", { waitUntil: "load" });
      const hidden = await page.evaluate((sels) => sels.map((s) => {
        const el = document.createElement("div");
        if (s.startsWith("#")) el.id = s.slice(1); else el.className = s.slice(1);
        document.body.append(el);
        return getComputedStyle(el).display === "none";
      }), selectors);
      await page.close();
      return hidden;
    };
    // Lists overlap (some extra-list domains are in EasyList too), so per
    // list take a domain only that list blocks: unmatched while extras are off
    const domains = [];
    for (const { candidates } of samples) {
      const matched = await matches(candidates);
      const own = candidates.find((d, i) => !matched[i]);
      if (own) domains.push(own);
    }
    assert.ok(domains.length >= 3, `only ${domains.length} list-specific sample domains`);
    const selectors = samples.filter((s) => s.selector).map((s) => s.selector);

    const coreCount = await ruleCount();
    await setSettings({ adblock_extras: ids });
    try {
      assert.equal(await ruleCount(), coreCount + meta.extras.reduce((n, e) => n + e.rules, 0));
      assert.deepEqual(await matches(domains), domains.map(() => true));
      assert.deepEqual(await hides(selectors), selectors.map(() => true));
    } finally {
      await setSettings({ adblock_extras: [] });
    }
    assert.equal(await ruleCount(), coreCount);
    assert.deepEqual(await hides(selectors), selectors.map(() => false));
  });

  test("popup Ads page renders", async () => {
    const page = await ext.context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${ext.extensionId}/src/popup/popup.html`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(300); // popup restores the last-open page on load
    await page.click('.nav button[data-group="privacy"]');
    await page.click('.subnav button[data-page="blocking"]');
    await waitFor(() => page.evaluate(() => document.getElementById("page-blocking").classList.contains("active")));
    assert.equal(await page.textContent("#adblockStatus"), "ON");
    assert.equal(await page.isChecked("#adblockToggle"), true);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
