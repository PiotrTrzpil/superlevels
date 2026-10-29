// ═══════════════════════════════════
//  🧹 Tidy view: duplicates, tracking parameters and empty folders —
//  the pure analysis (TIDY) and the page applying it as undoable batches.
// ═══════════════════════════════════
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openBookmarks, seedBookmarks, treeShape, undoLatest, batches } from "./bookmarks-helpers.mjs";
import { waitFor } from "./extension.mjs";

let ext;
before(async () => {
  ext = await openBookmarks("tidy");
  // A model like BM.load()'s from a spec: {bar: [...], other: [...]}, nodes
  // {id, title, url?, dateAdded?, children?}.
  await ext.page.evaluate(() => {
    window.fakeModel = (spec) => {
      const byId = new Map();
      const link = (node, parent) => {
        node.parent = parent;
        node.dateAdded ??= 0;
        byId.set(node.id, node);
        for (const c of node.children ?? []) link(c, node);
      };
      const roots = {
        bar: { id: "1", title: "Bookmarks bar", children: spec.bar ?? [] },
        other: { id: "2", title: "Other bookmarks", children: spec.other ?? [] },
      };
      for (const r of Object.values(roots)) link(r, null);
      return { roots, byId, ignored: [] };
    };
  });
});
after(async () => { await ext?.context.close(); });

// Each test starts from empty roots (straight through chrome.bookmarks, not journaled).
beforeEach(async () => {
  await ext.page.evaluate(async () => {
    const model = await BM.load();
    for (const root of Object.values(model.roots)) {
      for (const child of root.children ?? []) await chrome.bookmarks.removeTree(child.id);
    }
  });
});

const summary = (page) => page.locator("#view-tidy .tidy-summary").textContent();
const waitForSummary = (page, text) => waitFor(async () => (await summary(page)) === text);

// ═══ Pure analysis ═══

test("duplicates: same page despite scheme, www, slash, fragment and tracking; different query stays apart", async () => {
  const groups = await ext.page.evaluate(() => {
    const model = fakeModel({
      bar: [
        { id: "a", title: "A", url: "http://www.example.com/page/" },
        { id: "b", title: "B", url: "https://example.com/page?utm_source=x#" },
        { id: "c", title: "C", url: "https://example.com/page" },
        { id: "d", title: "D", url: "https://example.com/page?id=1" },
        { id: "e", title: "E", url: "https://example.com/page?id=2" },
        { id: "f", title: "F", url: "https://other.example/" },
      ],
    });
    return TIDY.findDuplicates(model).map((g) => g.copies.map((n) => n.id));
  });
  assert.deepEqual(groups, [["a", "b", "c"]]);
});

test("duplicates: keep the deepest, then the oldest, then the first", async () => {
  const kept = await ext.page.evaluate(() => {
    const keep = (spec) => TIDY.findDuplicates(fakeModel(spec))[0].keep.id;
    const url = "https://x.example/";
    return {
      deepest: keep({
        bar: [{ id: "top", title: "t", url, dateAdded: 1 }],
        other: [{ id: "F", title: "F", children: [{ id: "G", title: "G", children: [
          { id: "deep", title: "t", url, dateAdded: 9 }] }] }],
      }),
      oldest: keep({
        bar: [{ id: "new", title: "t", url, dateAdded: 5 }, { id: "old", title: "t", url, dateAdded: 2 }],
      }),
      first: keep({
        bar: [{ id: "one", title: "t", url, dateAdded: 3 }],
        other: [{ id: "two", title: "t", url, dateAdded: 3 }],
      }),
    };
  });
  assert.deepEqual(kept, { deepest: "deep", oldest: "old", first: "one" });
});

test("duplicates: another copy can be kept, and a bare title gets the other copy's title", async () => {
  const r = await ext.page.evaluate(() => {
    const model = fakeModel({
      bar: [
        { id: "bare", title: "https://x.example/a", url: "https://x.example/a" },
        { id: "named", title: "The A page", url: "https://www.x.example/a/" },
        { id: "empty", title: "", url: "http://x.example/a" },
      ],
    });
    const byDefault = TIDY.findDuplicates(model)[0];
    const chosen = TIDY.findDuplicates(model, new Map([[byDefault.key, "named"]]))[0];
    return {
      keep: byDefault.keep.id,
      ops: TIDY.duplicateOps([byDefault]),
      someOps: TIDY.duplicateOps([byDefault], (id) => id !== "empty"),
      noneOps: TIDY.duplicateOps([byDefault], () => false),
      chosenKeep: chosen.keep.id,
      chosenTitle: chosen.newTitle ?? null,
      chosenOps: TIDY.duplicateOps([chosen]),
    };
  });
  assert.equal(r.keep, "bare");
  assert.deepEqual(r.ops, [
    { op: "update", id: "bare", title: "The A page" },
    { op: "remove", id: "named" },
    { op: "remove", id: "empty" },
  ]);
  assert.deepEqual(r.someOps, [{ op: "update", id: "bare", title: "The A page" }, { op: "remove", id: "named" }]);
  assert.deepEqual(r.noneOps, []);
  assert.equal(r.chosenKeep, "named");
  assert.equal(r.chosenTitle, null);
  assert.deepEqual(r.chosenOps, [{ op: "remove", id: "bare" }, { op: "remove", id: "empty" }]);
});

test("tracking: URLs with tracking parameters get the clean URL, with the removed pairs marked", async () => {
  const r = await ext.page.evaluate(() => {
    const model = fakeModel({
      bar: [
        { id: "t", title: "T", url: "https://a.example/p?id=1&utm_source=nl&fbclid=zz#top" },
        { id: "clean", title: "C", url: "https://a.example/p?id=1" },
      ],
    });
    const items = TIDY.findTracking(model);
    return {
      items: items.map((i) => ({ id: i.node.id, clean: i.clean, removed: i.removed })),
      ops: TIDY.trackingOps(items),
      unselected: TIDY.trackingOps(items, () => false),
      parts: TIDY.urlParts(items[0].node.url, items[0].removed),
    };
  });
  assert.deepEqual(r.items, [{ id: "t", clean: "https://a.example/p?id=1#top", removed: ["utm_source", "fbclid"] }]);
  assert.deepEqual(r.ops, [{ op: "update", id: "t", url: "https://a.example/p?id=1#top" }]);
  assert.deepEqual(r.unselected, []);
  assert.deepEqual(r.parts, [
    { text: "https://a.example/p?", removed: false },
    { text: "id=1", removed: false },
    { text: "&utm_source=nl", removed: true },
    { text: "&fbclid=zz", removed: true },
    { text: "#top", removed: false },
  ]);
});

test("empty folders: nested empty ones count, removed deepest first, a kept one keeps its parents", async () => {
  const r = await ext.page.evaluate(() => {
    const model = fakeModel({
      bar: [
        { id: "A", title: "A", children: [{ id: "B", title: "B", children: [{ id: "C", title: "C", children: [] }] },
          { id: "B2", title: "B2", children: [] }] },
        { id: "Full", title: "Full", children: [{ id: "E", title: "E", children: [] },
          { id: "bm", title: "bm", url: "https://x/" }] },
      ],
    });
    const items = TIDY.findEmptyFolders(model);
    return {
      found: items.map((i) => i.node.id),
      ops: TIDY.emptyFolderOps(items).map((o) => o.id),
      withoutC: TIDY.emptyFolderOps(items, (id) => id !== "C").map((o) => o.id),
    };
  });
  assert.deepEqual(r.found, ["A", "B", "C", "B2", "E"]);
  assert.deepEqual(r.ops.slice(0, 1), ["C"]);
  assert.ok(r.ops.indexOf("B") < r.ops.indexOf("A"));
  assert.ok(r.ops.indexOf("B2") < r.ops.indexOf("A"));
  assert.deepEqual(new Set(r.ops), new Set(["A", "B", "C", "B2", "E"]));
  assert.deepEqual(r.withoutC, ["B2", "E"]);
});

// ═══ The page ═══

test("page: applying duplicates removes the checked copies as one undoable batch", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [
      { title: "Dev", children: [{ title: "Tools", children: [
        { title: "https://tool.example/", url: "https://tool.example/" }] }] },
      { title: "Tool (bar)", url: "http://www.tool.example?utm_campaign=x" },
      { title: "Tool (bar 2)", url: "https://tool.example/#" },
    ],
    other: [
      { title: "Doc", url: "https://doc.example/a" },
      { title: "Doc again", url: "https://doc.example/a/" },
    ],
  });
  await waitForSummary(page, "3 duplicates · 1 tracked URL · 0 empty folders");
  const before = await treeShape(page);

  // Kept: the deepest copy, which takes a real title from a removed one.
  const toolGroup = page.locator(`#view-tidy .tidy-dup:has([data-id="${ids["Tool (bar)"]}"])`);
  assert.equal(await toolGroup.locator(".tidy-keep").getAttribute("data-id"), ids["https://tool.example/"]);
  assert.match(await toolGroup.locator(".tidy-rename").textContent(), /Tool \(bar\)/);

  // Keep the second Doc instead, and spare "Tool (bar 2)".
  await page.click(`#view-tidy [data-keep="${ids["Doc again"]}"]`);
  await page.uncheck(`#view-tidy input[data-id="${ids["Tool (bar 2)"]}"]`);
  await page.click('#view-tidy [data-apply="duplicates"]');

  await waitForSummary(page, "1 duplicate · 0 tracked URLs · 0 empty folders");
  const [batch] = await batches(page);
  assert.equal(batch.label, "Tidy: removed 2 duplicates");
  assert.deepEqual(batch.counts, { update: 1, remove: 2 });
  assert.deepEqual(await treeShape(page), {
    bar: ["Bookmarks Bar", [
      ["Dev", [["Tools", [["Tool (bar)", "https://tool.example/"]]]]],
      ["Tool (bar 2)", "https://tool.example/#"],
    ]],
    other: ["Other Bookmarks", [["Doc again", "https://doc.example/a/"]]],
  });

  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("page: cleaning tracking parameters skips unchecked URLs", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [
      { title: "News", url: "https://news.example/story?id=7&utm_source=rss" },
      { title: "Shop", url: "https://shop.example/?gclid=abc" },
      { title: "Plain", url: "https://plain.example/" },
    ],
  });
  await waitForSummary(page, "0 duplicates · 2 tracked URLs · 0 empty folders");
  const before = await treeShape(page);
  assert.equal(await page.locator("#view-tidy .tidy-track mark").first().textContent(), "&utm_source=rss");

  await page.uncheck(`#view-tidy input[data-id="${ids.Shop}"]`);
  await page.click('#view-tidy [data-apply="tracking"]');
  await waitForSummary(page, "0 duplicates · 1 tracked URL · 0 empty folders");

  const [batch] = await batches(page);
  assert.equal(batch.label, "Tidy: cleaned 1 URL");
  assert.deepEqual((await treeShape(page)).bar[1], [
    ["News", "https://news.example/story?id=7"],
    ["Shop", "https://shop.example/?gclid=abc"],
    ["Plain", "https://plain.example/"],
  ]);
  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("page: removing empty folders, nested ones included, and undoing it", async () => {
  const { page } = ext;
  await seedBookmarks(page, {
    bar: [
      { title: "Old", children: [{ title: "Older", children: [{ title: "Oldest", children: [] }] }] },
      { title: "Keep", children: [{ title: "Gone", children: [] }, { title: "Doc", url: "https://doc.example/" }] },
    ],
    other: [{ title: "Lonely", children: [] }],
  });
  await waitForSummary(page, "0 duplicates · 0 tracked URLs · 5 empty folders");
  const before = await treeShape(page);
  const paths = await page.locator("#view-tidy .tidy-folder .title").allTextContents();
  assert.deepEqual(paths, [
    "Bookmarks Bar/Old", "Bookmarks Bar/Old/Older", "Bookmarks Bar/Old/Older/Oldest",
    "Bookmarks Bar/Keep/Gone", "Other Bookmarks/Lonely",
  ]);

  await page.click('#view-tidy [data-apply="empty"]');
  await waitFor(async () => (await page.locator("#view-tidy [data-section=empty] .empty").count()) === 1);
  assert.equal(await page.locator("#view-tidy [data-section=empty] .empty").textContent(), "No empty folders");

  const [batch] = await batches(page);
  assert.equal(batch.label, "Tidy: removed 5 empty folders");
  assert.deepEqual(await treeShape(page), {
    bar: ["Bookmarks Bar", [["Keep", [["Doc", "https://doc.example/"]]]]],
    other: ["Other Bookmarks", []],
  });
  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("page: unticking a nested empty folder unticks the folders around it", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [{ title: "Outer", children: [{ title: "Inner", children: [] }] }, { title: "Solo", children: [] }],
  });
  await waitForSummary(page, "0 duplicates · 0 tracked URLs · 3 empty folders");
  await page.uncheck(`#view-tidy input[data-id="${ids.Inner}"]`);
  assert.equal(await page.isChecked(`#view-tidy input[data-id="${ids.Outer}"]`), false);
  assert.equal(await page.isChecked(`#view-tidy input[data-id="${ids.Solo}"]`), true);

  await page.click('#view-tidy [data-apply="empty"]');
  await waitForSummary(page, "0 duplicates · 0 tracked URLs · 2 empty folders");
  assert.equal((await batches(page))[0].label, "Tidy: removed 1 empty folder");
  assert.deepEqual((await treeShape(page)).bar[1], [["Outer", [["Inner", []]]]]);
  await undoLatest(page);
});
