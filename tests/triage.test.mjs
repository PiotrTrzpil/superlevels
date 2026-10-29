// ═══════════════════════════════════
//  📥 Inbox view (triage.js): the suggestion rule, and filing decisions as one batch.
//
//  Chromium can't seed the Mobile folder, so each test makes its own inbox folder under
//  Other bookmarks and points triage_inbox_id at it. Tests share one browser, so each
//  uses its own sites and folder names.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openBookmarks, seedBookmarks, treeShape, undoLatest, batches } from "./bookmarks-helpers.mjs";
import { waitFor } from "./extension.mjs";

let ext;
before(async () => { ext = await openBookmarks("triage"); });
after(async () => { await ext?.context.close(); });

// Seed bookmarks, make `inbox` (a title in the spec) the inbox, and reload the view.
async function setup(spec, inbox) {
  const { page } = ext;
  const ids = await seedBookmarks(page, spec);
  await page.evaluate((id) => chrome.storage.local.set({ triage_inbox_id: id, triage_pending: {} }), ids[inbox]);
  await reload();
  return ids;
}

async function reload() {
  const { page } = ext;
  await page.reload();
  await page.waitForFunction(() => typeof BM !== "undefined");
  await page.waitForSelector("#view-triage .triage-item, #view-triage .triage-zero");
}

const row = (id) => ext.page.locator(`.triage-item[data-id="${id}"]`);
const pendingIds = () => ext.page.evaluate(async () =>
  Object.keys((await chrome.storage.local.get(["triage_pending"])).triage_pending ?? {}).sort());

// The [title, children] of the folder titled `title` anywhere in a treeShape.
function findFolder(shape, title) {
  for (const node of Object.values(shape)) {
    const [t, rest] = node;
    if (t === title && Array.isArray(rest)) return node;
    if (Array.isArray(rest)) {
      const found = findFolder(rest, title);
      if (found) return found;
    }
  }
  return null;
}

test("suggestions: exact URL, a site mostly in one folder, nothing otherwise; the inbox doesn't vote", async () => {
  const ids = await setup({
    bar: [
      { title: "T1 Code", children: [
        { title: "dup elsewhere", url: "https://www.dup.t1/page/?utm_source=x" },
        { title: "site 1", url: "https://site.t1/1" },
        { title: "site 2", url: "https://site.t1/2" },
        { title: "spread 1", url: "https://spread.t1/1" },
      ] },
      { title: "T1 Misc", children: [
        { title: "site 3", url: "https://site.t1/3" },
        { title: "spread 2", url: "https://spread.t1/2" },
        { title: "heavy outside", url: "https://heavy.t1/1" },
      ] },
      { title: "T1 More", children: [
        { title: "spread 3", url: "https://spread.t1/3" },
        { title: "spread 4", url: "https://spread.t1/4" },
      ] },
      { title: "loose root", url: "https://loose.t1/1" },
      { title: "loose root 2", url: "https://loose.t1/2" },
    ],
    other: [{ title: "T1 Inbox", children: [
      { title: "dup", url: "http://dup.t1/page" },
      { title: "site new", url: "https://site.t1/new" },
      { title: "spread new", url: "https://spread.t1/new" },
      { title: "loose new", url: "https://loose.t1/new" },
      { title: "T1 Sub", children: [
        { title: "heavy 1", url: "https://heavy.t1/a" },
        { title: "heavy 2", url: "https://heavy.t1/b" },
        { title: "heavy 3", url: "https://heavy.t1/c" },
      ] },
    ] }],
  }, "T1 Inbox");

  const got = await ext.page.evaluate(async (inboxId) => {
    const model = await BM.load();
    const out = {};
    for (const [id, s] of Triage.suggestAll(model, model.byId.get(inboxId))) {
      out[model.byId.get(id).title] = { path: BM.path(s.folder), reason: s.reason, duplicate: s.duplicate };
    }
    return out;
  }, ids["T1 Inbox"]);

  const bar = await ext.page.evaluate(async () => (await BM.load()).roots.bar.title);
  assert.deepEqual(got, {
    dup: { path: `${bar}/T1 Code`, reason: "already bookmarked there", duplicate: true },
    "site new": { path: `${bar}/T1 Code`, reason: "2/3 site.t1 bookmarks are there", duplicate: false },
    // spread.t1 is 2/4 at best (< 60%); loose.t1 sits only directly in a root;
    // heavy.t1 has 3 in the inbox, which don't count, and 1 outside (< 2).
  });

  // Each row shows its suggestion; the rest say so.
  await assert.doesNotReject(row(ids["site new"]).getByText("2/3 site.t1 bookmarks are there").waitFor());
  assert.match(await row(ids.dup).textContent(), /accepting removes this copy/);
  assert.match(await row(ids["spread new"]).textContent(), /No suggestion/);
  assert.match(await row(ids["heavy 1"]).textContent(), /No suggestion/);
});

test("typed folder paths resolve to existing folders or new ones under the Bookmarks bar", async () => {
  await setup({ bar: [{ title: "T2 Work", children: [{ title: "T2 Code", children: [] }] }],
    other: [{ title: "T2 Inbox", children: [] }, { title: "T2 Elsewhere", children: [] }] }, "T2 Inbox");
  const r = await ext.page.evaluate(async () => {
    const model = await BM.load();
    const brief = (x) => x && { exists: !!x.folder, path: x.path, missing: x.missing };
    return {
      bar: model.roots.bar.title,
      other: model.roots.other.title,
      existing: brief(Triage.resolvePath(model, " t2 work / T2 CODE ")),
      otherRoot: brief(Triage.resolvePath(model, "T2 Elsewhere")),
      nested: brief(Triage.resolvePath(model, "T2 Work/A/B")),
      fresh: brief(Triage.resolvePath(model, "T2 Brand new")),
      empty: Triage.resolvePath(model, " / "),
    };
  });
  assert.deepEqual(r.existing, { exists: true, path: `${r.bar}/T2 Work/T2 Code`, missing: undefined });
  assert.deepEqual(r.otherRoot, { exists: true, path: `${r.other}/T2 Elsewhere`, missing: undefined });
  assert.deepEqual(r.nested, { exists: false, path: `${r.bar}/T2 Work/A/B`, missing: ["A", "B"] });
  assert.deepEqual(r.fresh, { exists: false, path: `${r.bar}/T2 Brand new`, missing: ["T2 Brand new"] });
  assert.equal(r.empty, null);
  // The inbox is empty.
  assert.match(await ext.page.locator("#view-triage .triage-zero").textContent(), /Inbox zero/);
});

test("decisions made in the UI apply as one batch, new folder and duplicate included, and undo", async () => {
  const { page } = ext;
  const ids = await setup({
    bar: [{ title: "T3 Work", children: [
      { title: "T3 dup there", url: "https://dup.t3/a" },
      { title: "T3 site 1", url: "https://site.t3/1" },
      { title: "T3 site 2", url: "https://site.t3/2" },
    ] }],
    other: [{ title: "T3 Inbox", children: [
      { title: "T3 dup", url: "https://dup.t3/a#" },
      { title: "T3 site new", url: "https://site.t3/new" },
      { title: "T3 none", url: "https://none.t3/" },
      { title: "T3 del", url: "https://del.t3/" },
    ] }],
  }, "T3 Inbox");
  const before = await treeShape(page);

  await page.click(".triage-accept-all");
  await row(ids["T3 dup"]).locator(".triage-pending.remove").waitFor();
  assert.match(await row(ids["T3 dup"]).textContent(), /Remove: already in .*T3 Work/);

  const input = row(ids["T3 none"]).locator(".triage-folder");
  await input.fill("T3 Work/T3 New");
  assert.match(await row(ids["T3 none"]).locator(".triage-hint").textContent(), /new folder .*T3 Work\/T3 New/);
  await input.press("Enter");
  await row(ids["T3 none"]).locator(".triage-new").waitFor();

  await row(ids["T3 del"]).locator(".triage-delete").click();
  await row(ids["T3 del"]).locator(".triage-pending.remove").waitFor();
  assert.equal(await page.locator(".triage-apply").textContent(), "Apply 4 changes");

  await page.click(".triage-apply");
  await page.locator("#view-triage .triage-zero").waitFor();
  const [batch] = await batches(page);
  assert.equal(batch.label, "Inbox: filed 2, removed 2");
  assert.deepEqual(batch.counts, { create: 1, move: 2, remove: 2 });
  assert.match(await page.locator("#view-triage .status-line").textContent(), /created 1 folder/);

  const after = await treeShape(page);
  assert.deepEqual(findFolder(after, "T3 Inbox"), ["T3 Inbox", []]);
  assert.deepEqual(findFolder(after, "T3 Work"), ["T3 Work", [
    ["T3 dup there", "https://dup.t3/a"],
    ["T3 site 1", "https://site.t3/1"],
    ["T3 site 2", "https://site.t3/2"],
    ["T3 New", [["T3 none", "https://none.t3/"]]],
    ["T3 site new", "https://site.t3/new"],
  ]]);
  assert.deepEqual(await pendingIds(), []);

  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
  await row(ids["T3 site new"]).waitFor(); // the view refreshed
});

test("two inbox copies of one URL filed together: the second is removed", async () => {
  const { page } = ext;
  const ids = await setup({
    bar: [{ title: "T4 Target", children: [] }],
    other: [{ title: "T4 Inbox", children: [
      { title: "T4 first", url: "https://same.t4/" },
      { title: "T4 Sub", children: [{ title: "T4 second", url: "https://www.same.t4/?utm_medium=x" }] },
    ] }],
  }, "T4 Inbox");
  const plan = await page.evaluate(async ({ inboxId, target }) => {
    const model = await BM.load();
    const decision = { action: "file", folderId: target, path: "" };
    const items = BM.bookmarksUnder(model.byId.get(inboxId));
    const p = Triage.planOps(model, items, Object.fromEntries(items.map((b) => [b.id, decision])));
    return { ops: p.ops.map((o) => o.op), label: Triage.batchLabel(p) };
  }, { inboxId: ids["T4 Inbox"], target: ids["T4 Target"] });
  assert.deepEqual(plan, { ops: ["move", "remove"], label: "Inbox: filed 1, removed 1" });
});

test("pending decisions survive a reload; ones whose bookmark is gone are dropped", async () => {
  const { page } = ext;
  const ids = await setup({
    bar: [{ title: "T5 Docs", children: [
      { title: "T5 s1", url: "https://site.t5/1" },
      { title: "T5 s2", url: "https://site.t5/2" },
    ] }],
    other: [{ title: "T5 Inbox", children: [
      { title: "T5 a", url: "https://site.t5/a" },
      { title: "T5 b", url: "https://b.t5/" },
      { title: "T5 c", url: "https://c.t5/" },
    ] }],
  }, "T5 Inbox");

  // Keyboard: Enter accepts and moves on, Delete marks for deletion.
  await row(ids["T5 a"]).focus();
  await page.keyboard.press("Enter");
  await row(ids["T5 a"]).locator(".triage-pending.file").waitFor();
  await waitFor(() => page.evaluate((id) => document.activeElement?.dataset.id === id, ids["T5 b"]));
  await page.keyboard.press("Delete");
  await row(ids["T5 b"]).locator(".triage-pending.remove").waitFor();
  await row(ids["T5 c"]).locator(".triage-delete").click();
  await row(ids["T5 c"]).locator(".triage-pending").waitFor();
  assert.deepEqual(await pendingIds(), [ids["T5 a"], ids["T5 b"], ids["T5 c"]].sort());

  await page.evaluate((id) => chrome.bookmarks.remove(id), ids["T5 c"]);
  await reload();
  assert.deepEqual(await pendingIds(), [ids["T5 a"], ids["T5 b"]].sort());
  assert.match(await row(ids["T5 a"]).textContent(), /→ .*T5 Docs/);
  await row(ids["T5 b"]).locator(".triage-pending.remove").waitFor();
  assert.equal(await page.locator(".triage-apply").textContent(), "Apply 2 changes");

  // Clearing one takes it out of the batch.
  await row(ids["T5 b"]).locator(".triage-clear").click();
  await page.getByText("Apply 1 change", { exact: true }).waitFor();
});

test("the inbox defaults to Other bookmarks without a Mobile folder; the picker changes it", async () => {
  const { page } = ext;
  await page.evaluate(() => chrome.storage.local.set({ triage_inbox_id: "999999", triage_pending: {} }));
  await reload();
  const ids = await page.evaluate(async () => {
    const model = await BM.load();
    return { other: model.roots.other.id, mobile: model.roots.mobile?.id ?? null };
  });
  assert.equal(ids.mobile, null);
  assert.equal(await page.locator(".triage-picker").inputValue(), ids.other);

  const seeded = await seedBookmarks(page, { bar: [{ title: "T6 Box", children: [{ title: "T6 x", url: "https://x.t6/" }] }] });
  await page.locator(".triage-picker").selectOption(seeded["T6 Box"]);
  await row(seeded["T6 x"]).waitFor();
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get(["triage_inbox_id"])).triage_inbox_id),
    seeded["T6 Box"]);
});
