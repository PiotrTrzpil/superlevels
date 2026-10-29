// ═══════════════════════════════════
//  Closed tabs page: moving tabs to the bookmarks inbox.
//
//  Chromium can't seed the Mobile folder, so each test makes its own inbox folder under
//  Other bookmarks and points triage_inbox_id at it. Tests share one browser, so each
//  uses its own sites and folder names.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seedBookmarks, undoLatest, batches } from "./bookmarks-helpers.mjs";
import { launchExtension, waitFor } from "./extension.mjs";

let ext;
before(async () => {
  ext = await launchExtension();
  ext.page = await ext.context.newPage();
  await ext.page.goto(`chrome-extension://${ext.extensionId}/src/pages/closed/closed.html`);
  await ext.page.waitForFunction(() => typeof BM !== "undefined");
});
after(async () => { await ext?.context.close(); });

// Seed bookmarks, make `inbox` the inbox, and fill the closed list with `tabs` (newest first).
async function setup(spec, inbox, tabs) {
  const { page } = ext;
  const ids = await seedBookmarks(page, spec);
  const now = Date.now();
  const closed_tabs = tabs.map(([title, url], i) => ({ id: `${title}-${i}`, title, url, time: now - i * 1000 }));
  await page.evaluate((data) => chrome.storage.local.set(data), { triage_inbox_id: ids[inbox], closed_tabs });
  await page.reload();
  await page.waitForFunction(() => typeof BM !== "undefined");
  return ids;
}

const listed = () => ext.page.evaluate(async () =>
  ((await chrome.storage.local.get(["closed_tabs"])).closed_tabs ?? []).map((t) => t.title));

const inboxShape = (id) => ext.page.evaluate(async (id) =>
  (await chrome.bookmarks.getChildren(id)).map((b) => [b.title, b.url]), id);

const item = (title) => ext.page.locator(".item", { hasText: title });

test("one tab, then a day: bookmarked oldest first, one per URL, inbox duplicates skipped, all leave the list", async () => {
  const ids = await setup({ other: [{ title: "C1 Inbox", children: [{ title: "have", url: "https://have.c1/" }] }] },
    "C1 Inbox", [
      ["a new", "https://a.c1/"],
      ["b", "https://b.c1/"],
      ["a old", "https://www.a.c1/?utm_source=x"],
      ["have again", "http://have.c1"],
    ]);
  const { page } = ext;

  await item("b").hover();
  await item("b").getByTitle("Move to the bookmarks inbox").click();
  await waitFor(async () => !(await listed()).includes("b"));
  assert.deepEqual(await inboxShape(ids["C1 Inbox"]), [["have", "https://have.c1/"], ["b", "https://b.c1/"]]);

  await page.locator(".group-header").getByText("Bookmark all").click();
  await waitFor(async () => (await listed()).length === 0);
  assert.deepEqual(await inboxShape(ids["C1 Inbox"]), [
    ["have", "https://have.c1/"],
    ["b", "https://b.c1/"],
    ["a old", "https://www.a.c1/?utm_source=x"],
  ]);
  await page.getByText(/Moved 3 tabs to .*C1 Inbox \(1 already there\)/).waitFor();
  assert.equal((await batches(page))[0].label, `Closed tabs: 1 to ${await page.evaluate(async (id) =>
    BM.path((await BM.load()).byId.get(id)), ids["C1 Inbox"])}`);

  // Undo takes the bookmarks back out; the list stays as it is.
  await undoLatest(page);
  assert.deepEqual(await inboxShape(ids["C1 Inbox"]), [["have", "https://have.c1/"], ["b", "https://b.c1/"]]);
  assert.deepEqual(await listed(), []);
});

test("the header's Bookmark all moves only the tabs the filter shows, after confirming", async () => {
  const ids = await setup({ other: [{ title: "C2 Inbox", children: [] }] }, "C2 Inbox", [
    ["keep me", "https://keep.c2/"],
    ["match 1", "https://match.c2/1"],
    ["match 2", "https://match.c2/2"],
  ]);
  const { page } = ext;
  await page.locator("#filter").fill("match.c2");
  page.once("dialog", (d) => {
    assert.match(d.message(), /Move all 2 matching tabs/);
    d.accept();
  });
  await page.locator("#bookmarkAll").click();
  await waitFor(async () => (await listed()).length === 1);
  assert.deepEqual(await listed(), ["keep me"]);
  assert.deepEqual(await inboxShape(ids["C2 Inbox"]), [
    ["match 2", "https://match.c2/2"],
    ["match 1", "https://match.c2/1"],
  ]);
});

test("when Chrome rejects a bookmark, only the tabs bookmarked before it leave the list", async () => {
  const ids = await setup({ other: [{ title: "C3 Inbox", children: [] }] }, "C3 Inbox", [
    ["newest", "https://ok.c3/new"],
    ["broken", "not a url"],
    ["oldest", "https://ok.c3/old"],
  ]);
  const { page } = ext;
  await page.locator(".group-header").getByText("Bookmark all").click();
  await page.getByText(/Couldn't bookmark all: .*after 1 of 3 changes/).waitFor();
  assert.deepEqual(await listed(), ["newest", "broken"]);
  assert.deepEqual(await inboxShape(ids["C3 Inbox"]), [["oldest", "https://ok.c3/old"]]);
});
