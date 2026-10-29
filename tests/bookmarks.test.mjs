// ═══════════════════════════════════
//  Bookmark tools base: batches from extension pages are journaled and undoable,
//  and BM's URL helpers.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openBookmarks, seedBookmarks, treeShape, undoLatest, batches } from "./bookmarks-helpers.mjs";

let ext;
before(async () => { ext = await openBookmarks(); });
after(async () => { await ext?.context.close(); });

test("a page's batch is journaled and undone exactly", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [{ title: "Work", children: [{ title: "Doc", url: "https://doc.example/" }] }],
    other: [{ title: "Phone", url: "https://phone.example/?utm_source=x" }],
  });
  const before = await treeShape(page);

  await page.evaluate(async (ids) => {
    const model = await BM.load();
    await BM.applyBatch([
      { op: "create", ref: "new", parentId: model.roots.bar.id, index: 0, title: "Inbox done" },
      { op: "move", id: ids.Phone, parentId: "new" },
      { op: "update", id: ids.Doc, title: "Doc renamed" },
      { op: "remove", id: ids.Doc },
    ], "test batch");
  }, ids);
  assert.notDeepEqual(await treeShape(page), before);
  const [batch] = await batches(page);
  assert.equal(batch.label, "test batch");
  assert.deepEqual(batch.counts, { create: 1, move: 1, update: 1, remove: 1 });

  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("a rejected op throws and keeps the earlier ones journaled", async () => {
  const { page } = ext;
  const message = await page.evaluate(async () => {
    const model = await BM.load();
    try {
      await BM.applyBatch([
        { op: "create", ref: "a", parentId: model.roots.other.id, title: "kept", url: "https://kept/" },
        { op: "remove", id: "999999" },
      ], "partial");
    } catch (e) {
      return e.message;
    }
  });
  assert.match(message, /after 1 of 2 changes/);
  assert.equal((await batches(page))[0].counts.create, 1);
  await undoLatest(page);
});

test("URL helpers", async () => {
  const r = await ext.page.evaluate(() => ({
    strip: BM.stripTracking("https://a.com/p?id=1&utm_source=x&fbclid=y#top"),
    untouched: BM.stripTracking("https://a.com/p?id=1"),
    same: BM.normalizeUrl("http://www.A.com/p/?utm_medium=z#") === BM.normalizeUrl("https://a.com/p"),
    differentQuery: BM.normalizeUrl("https://a.com/p?id=1") === BM.normalizeUrl("https://a.com/p?id=2"),
    site: BM.site("https://www.News.example.com/x"),
  }));
  assert.equal(r.strip, "https://a.com/p?id=1#top");
  assert.equal(r.untouched, "https://a.com/p?id=1");
  assert.equal(r.same, true);
  assert.equal(r.differentQuery, false);
  assert.equal(r.site, "news.example.com");
});
