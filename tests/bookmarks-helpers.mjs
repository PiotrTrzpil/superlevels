// ═══════════════════════════════════
//  Test helpers for the bookmark tools (bookmarks.html and its views)
// ═══════════════════════════════════
import { launchExtension } from "./extension.mjs";

// Launch Chromium with the extension and open bookmarks.html#<view>.
export async function openBookmarks(view = "") {
  const ext = await launchExtension();
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/bookmarks.html#${view}`);
  await page.waitForFunction(() => typeof BM !== "undefined");
  return { ...ext, page };
}

// Build bookmarks from a spec, appended to the given roots ("bar", "other"):
//   { bar: [{ title: "Work", children: [{ title: "Doc", url: "https://x/" }] }], other: [...] }
// Chromium hides an empty Mobile folder and can't create in it, so tests can't seed "mobile".
// Goes straight to chrome.bookmarks, so the seed isn't a journaled batch.
// Returns { [title]: id } for every node created (titles in a spec should be unique).
export async function seedBookmarks(page, spec) {
  return page.evaluate(async (spec) => {
    const model = await BM.load();
    const ids = {};
    const add = async (parentId, nodes) => {
      for (const n of nodes) {
        const created = await chrome.bookmarks.create({ parentId, title: n.title, url: n.url });
        ids[n.title] = created.id;
        if (n.children) await add(created.id, n.children);
      }
    };
    for (const [root, nodes] of Object.entries(spec)) await add(model.roots[root].id, nodes);
    return ids;
  }, spec);
}

// The tree under the three roots as nested [title, url | children], for comparisons.
export async function treeShape(page) {
  return page.evaluate(async () => {
    const model = await BM.load();
    const shape = (n) => (n.url !== undefined ? [n.title, n.url] : [n.title, (n.children ?? []).map(shape)]);
    return Object.fromEntries(Object.entries(model.roots).map(([k, n]) => [k, shape(n)]));
  });
}

// Undo the newest batch, as the popup's ↶ button does.
export async function undoLatest(page) {
  return page.evaluate(() => chrome.runtime.sendMessage({ type: "bookmarkBridgeUndo" }));
}

// The journal of batches, newest first.
export async function batches(page) {
  return page.evaluate(async () => (await chrome.storage.local.get(["bookmarks_batches"])).bookmarks_batches ?? []);
}
