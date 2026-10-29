// ═══════════════════════════════════
//  🪦 Dead links view: classification, HEAD→GET fallback, confirmation across
//  scans, skipping local hosts, and removing in one undoable batch.
//
//  Sites live under https://*.test/, answered by Playwright's routing (which sees the
//  extension page's fetches); *.invalid is left to real DNS, so it never resolves.
//  Chromium follows a routed redirect over the real network, so redirects point at a
//  local server (fine: only bookmarked hosts are checked against the local-host rule).
// ═══════════════════════════════════
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openBookmarks, seedBookmarks, treeShape, undoLatest, batches } from "./bookmarks-helpers.mjs";
import { waitFor } from "./extension.mjs";

const HOUR = 3600 * 1000;

// path → what the fake site answers; "head"/"get" give per-method statuses.
const SITES = {
  "https://ok.test/": { status: 200 },
  "https://gone.test/404": { status: 404 },
  "https://gone.test/410": { status: 410 },
  "https://walled.test/403": { status: 403 },
  "https://broken.test/500": { status: 500 },
  "https://busy.test/429": { status: 429 },
  "https://nohead.test/ok": { head: 405, get: 200 },
  "https://nohead.test/gone": { head: 501, get: 404 },
  "https://headforbidden.test/ok": { head: 403, get: 200 },
  "https://app.test/private": { redirect: "/sso/signin?next=app" }, // to the local server
  "https://moved.test/old": { redirect: "/welcome" },
  "https://refused.test/": { abort: "connectionrefused" },
  "https://slow.test/": { hang: true },
};

let ext;
let server;
let local = ""; // http://127.0.0.1:<port>, answers 200 to everything
let requests = []; // [method, url] seen by the fake sites
let flaky = 404; // what https://flaky.test/ answers right now

before(async () => {
  server = createServer((req, res) => res.end("page")).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  local = `http://127.0.0.1:${server.address().port}`;
  ext = await openBookmarks("deadlinks");
  await ext.context.route("**/*", (route) => {
    const req = route.request();
    const url = req.url();
    if (!/^https?:/.test(url)) return route.fallback();
    requests.push([req.method(), url]);
    const site = url === "https://flaky.test/" ? { status: flaky } : SITES[url];
    if (!site) return route.continue(); // e.g. *.invalid: a real DNS failure
    if (site.hang) return; // never answers
    if (site.abort) return route.abort(site.abort);
    if (site.redirect) return route.fulfill({ status: 302, headers: { location: local + site.redirect } });
    const status = site.status ?? (req.method() === "HEAD" ? site.head : site.get);
    return route.fulfill({ status, body: "page" });
  });
});
after(async () => {
  await ext?.context.close();
  server?.close();
});

// Empty bookmarks and storage, fresh page with a short timeout.
beforeEach(async () => {
  const { page } = ext;
  await page.evaluate(async () => {
    const model = await BM.load();
    for (const root of Object.values(model.roots)) {
      for (const child of root.children ?? []) await chrome.bookmarks.removeTree(child.id);
    }
    await chrome.storage.local.remove(["deadlinks_checks", "deadlinks_last_scan", "bookmarks_batches"]);
  });
  await page.reload();
  await page.waitForFunction(() => typeof DeadLinks !== "undefined");
  await setClock(0);
  requests = [];
  flaky = 404;
});

// Make the page's clock run `offset` ms ahead of real time (and keep requests short).
async function setClock(offset) {
  await ext.page.evaluate((offset) => {
    DeadLinks.settings.now = () => Date.now() + offset;
    DeadLinks.settings.timeoutMs = 1000;
  }, offset);
}

// Run a scan through the API; returns the stored last scan.
function scan() {
  return ext.page.evaluate(() => DeadLinks.scan(new AbortController().signal));
}

function checks() {
  return ext.page.evaluate(async () => (await chrome.storage.local.get(["deadlinks_checks"])).deadlinks_checks ?? {});
}

function spec(urls) {
  return { bar: [{ title: "Links", children: urls.map((url, i) => ({ title: `b${i} ${url}`, url })) }] };
}

test("classifies statuses, network errors, timeouts and login redirects", async () => {
  const urls = [...Object.keys(SITES), "https://nowhere.invalid/page"];
  await seedBookmarks(ext.page, spec(urls));
  const last = await scan();
  const got = Object.fromEntries(urls.map((u) => [u, last.results[u] ?? "ok"]));
  assert.deepEqual(got, {
    "https://ok.test/": "ok",
    "https://gone.test/404": { kind: "probable", status: "404" },
    "https://gone.test/410": { kind: "probable", status: "410" },
    "https://walled.test/403": { kind: "check", status: "403" },
    "https://broken.test/500": { kind: "check", status: "500" },
    "https://busy.test/429": { kind: "check", status: "429" },
    "https://nohead.test/ok": "ok",
    "https://nohead.test/gone": { kind: "probable", status: "404" },
    "https://headforbidden.test/ok": "ok",
    "https://app.test/private": { kind: "check", status: "→ login" },
    "https://moved.test/old": "ok",
    "https://refused.test/": { kind: "probable", status: "unreachable" },
    "https://slow.test/": { kind: "check", status: "timeout" },
    "https://nowhere.invalid/page": { kind: "probable", status: "unreachable" },
  });
  assert.equal(last.checked, urls.length);
  assert.equal(last.stopped, false);
});

test("a redirect within the same site is never a login wall", async () => {
  const verdict = (url, finalUrl) => ext.page.evaluate(([url, finalUrl]) =>
    DeadLinks.classify(url, { status: 200, finalUrl }).kind, [url, finalUrl]);
  assert.equal(await verdict("https://www.shop.example/cart", "https://shop.example/login"), "ok");
  assert.equal(await verdict("https://shop.example/cart", "https://accounts.example.net/consent"), "check");
  assert.equal(await verdict("https://shop.example/a", "https://other.example.net/page"), "ok");
});

test("HEAD first, GET only when HEAD is refused or fails", async () => {
  const urls = ["https://ok.test/", "https://gone.test/404", "https://nohead.test/ok", "https://headforbidden.test/ok", "https://refused.test/"];
  await seedBookmarks(ext.page, spec(urls));
  await scan();
  const methods = (url) => requests.filter(([, u]) => u === url).map(([m]) => m);
  assert.deepEqual(methods("https://ok.test/"), ["HEAD"]);
  assert.deepEqual(methods("https://gone.test/404"), ["HEAD"]);
  assert.deepEqual(methods("https://nohead.test/ok"), ["HEAD", "GET"]);
  assert.deepEqual(methods("https://headforbidden.test/ok"), ["HEAD", "GET"]);
  assert.deepEqual(methods("https://refused.test/"), ["HEAD", "GET"]);
});

test("dead only after two failing scans at least 20 hours apart; a success clears it", async () => {
  await seedBookmarks(ext.page, spec(["https://gone.test/404", "https://flaky.test/"]));

  let last = await scan();
  assert.equal(last.results["https://gone.test/404"].kind, "probable");
  assert.equal(last.results["https://flaky.test/"].kind, "probable");
  const first = (await checks())["https://gone.test/404"];
  assert.equal(first.lastStatus, "404");

  await setClock(10 * HOUR);
  last = await scan();
  assert.equal(last.results["https://gone.test/404"].kind, "probable");
  assert.equal((await checks())["https://gone.test/404"].firstDeadAt, first.firstDeadAt);

  flaky = 200;
  await setClock(21 * HOUR);
  last = await scan();
  assert.equal(last.results["https://gone.test/404"].kind, "dead");
  assert.equal(last.results["https://flaky.test/"], undefined);
  assert.deepEqual(Object.keys(await checks()), ["https://gone.test/404"]);

  // A success clears the history: failing again starts over.
  flaky = 404;
  await setClock(22 * HOUR);
  assert.equal((await scan()).results["https://flaky.test/"].kind, "probable");
});

test("history of URLs no longer bookmarked is pruned", async () => {
  const ids = await seedBookmarks(ext.page, spec(["https://gone.test/404", "https://gone.test/410"]));
  await scan();
  assert.equal(Object.keys(await checks()).length, 2);
  await ext.page.evaluate((id) => chrome.bookmarks.remove(id), ids["b1 https://gone.test/410"]);
  await scan();
  assert.deepEqual(Object.keys(await checks()), ["https://gone.test/404"]);
});

test("local-network and non-web bookmarks are skipped, not checked", async () => {
  const local = ["http://localhost:8080/", "http://127.0.0.1/x", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://172.20.0.1/", "http://nas.local/", "https://wiki.corp.internal/", "http://printer.lan/", "http://router/"];
  const notWeb = ["javascript:void(0)", "chrome://settings/"];
  await seedBookmarks(ext.page, spec([...local, ...notWeb, "https://ok.test/"]));
  const last = await scan();
  assert.deepEqual(last.skipped, { web: notWeb.length, local: local.length });
  assert.equal(last.total, 1);
  for (const url of local) assert.ok(!requests.some(([, u]) => u.startsWith(url)), `requested ${url}`);

  const public_ = await ext.page.evaluate(() => ["http://172.32.0.1/", "http://11.0.0.1/", "https://local.example.com/", "http://[2001:db8::1]/"]
    .map((url) => DeadLinks.skipReason(url)));
  assert.deepEqual(public_, ["", "", "", ""]);
  const private_ = await ext.page.evaluate(() => ["http://[::1]/", "http://[fd00::1]/", "http://169.254.1.1/"]
    .map((url) => DeadLinks.skipReason(url)));
  assert.deepEqual(private_, ["local", "local", "local"]);
});

test("the UI scans, pre-checks confirmed dead links, removes the selection in one batch, and undo restores it", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [{ title: "Work", children: [
      { title: "Old docs", url: "https://gone.test/404" },
      { title: "Fine", url: "https://ok.test/" },
    ] }],
    other: [
      { title: "Retired", url: "https://gone.test/410" },
      { title: "Walled", url: "https://walled.test/403" },
    ],
  });
  const before = await treeShape(page);
  // gone.test/404 already failed a day ago, so this scan confirms it.
  await page.evaluate(async () => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    await chrome.storage.local.set({ deadlinks_checks: {
      "https://gone.test/404": { firstDeadAt: dayAgo, lastDeadAt: dayAgo, lastStatus: "404", lastCheckedAt: dayAgo },
    } });
  });

  await page.click("#view-deadlinks button:text-is('Scan')");
  await page.waitForSelector("#view-deadlinks .dl-section");
  const sections = await page.$$eval("#view-deadlinks .dl-section", (els) => els.map((s) => ({
    kind: s.dataset.kind,
    folders: [...s.querySelectorAll(".dl-folder-path")].map((f) => f.textContent),
    rows: [...s.querySelectorAll(".row")].map((r) => [r.querySelector(".title a").textContent,
      r.querySelector(".dl-status").textContent, r.querySelector("input").checked]),
  })));
  assert.deepEqual(sections, [
    { kind: "dead", folders: ["Bookmarks Bar/Work"], rows: [["Old docs", "404", true]] },
    { kind: "probable", folders: ["Other Bookmarks"], rows: [["Retired", "410", false]] },
    { kind: "check", folders: ["Other Bookmarks"], rows: [["Walled", "403", false]] },
  ]);
  assert.match(await page.textContent("#view-deadlinks .dl-summary"), /Scanned just now · 4 checked/);

  await page.check(`#view-deadlinks .row[data-id="${ids.Retired}"] input`);
  await page.click("#view-deadlinks button:has-text('Remove selected (2)')");
  await waitFor(async () => (await batches(page)).length === 1);
  const [batch] = await batches(page);
  assert.equal(batch.label, "Dead links: removed 2");
  assert.deepEqual(batch.counts, { remove: 2 });
  await page.waitForSelector(`#view-deadlinks .row[data-id="${ids["Old docs"]}"]`, { state: "detached" });
  assert.equal(await page.locator("#view-deadlinks .row").count(), 1);

  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("the last scan is shown again when the tab is reopened", async () => {
  const { page } = ext;
  await seedBookmarks(page, spec(["https://gone.test/404", "javascript:void(0)"]));
  await scan();
  await page.evaluate(async () => {
    const { deadlinks_last_scan: last } = await chrome.storage.local.get(["deadlinks_last_scan"]);
    await chrome.storage.local.set({ deadlinks_last_scan: { ...last, at: last.at - 2 * 3600 * 1000 } });
  });
  await page.reload();
  await page.waitForSelector("#view-deadlinks .dl-probable .row");
  assert.equal(await page.textContent("#view-deadlinks .dl-summary"),
    "Scanned 2 h ago · 1 checked · 1 skipped (1 not web pages)");
});

test("Stop ends a scan early and keeps what was checked", async () => {
  const { page } = ext;
  await seedBookmarks(page, spec(["https://gone.test/404", "https://slow.test/"]));
  await page.evaluate(() => { DeadLinks.settings.timeoutMs = 60000; });
  await page.click("#view-deadlinks button:text-is('Scan')");
  await page.waitForSelector("#view-deadlinks .dl-progress:has-text('Checking 1 / 2')");
  await page.click("#view-deadlinks button:text-is('Stop')");
  await page.waitForSelector("#view-deadlinks .dl-summary:has-text('stopped after 1 of 2')");
  assert.equal(await page.locator("#view-deadlinks .dl-probable .row").count(), 1);
  assert.equal(await page.locator("#view-deadlinks button:text-is('Scan')").isEnabled(), true);
});
