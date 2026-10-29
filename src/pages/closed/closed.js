// OneTab-style list of tabs closed by the Tab Cleaner.
// Clicking a tab restores it (in the background) and removes it from the list.
// 🔖 moves tabs to the bookmarks inbox (the Inbox view's folder, Mobile by default).
const groupsEl = document.getElementById("groups");
const totalEl = document.getElementById("total");
const filterEl = document.getElementById("filter");
const statusEl = document.getElementById("status");

let closedTabs = [];
let bookmarking = false;

const plural = (n) => (n === 1 ? "" : "s");

function removeTabs(ids) {
  return chrome.runtime.sendMessage({ type: "closedRemove", ids });
}

async function restoreTabs(tabs) {
  for (const t of tabs) {
    await chrome.tabs.create({ url: t.url, active: false });
  }
  await removeTabs(tabs.map((t) => t.id));
}

/**
 * How to move `tabs` (newest first) into `inbox`: one create per URL, oldest first,
 * appended at the end. URLs the inbox already holds get no bookmark.
 * Returns {ops, covered: [tab ids per op], skipped: [tab ids]}.
 */
function planBookmarks(tabs, inbox) {
  const existing = new Set(BM.bookmarksUnder(inbox).map((b) => BM.normalizeUrl(b.url)));
  const byUrl = new Map(); // normalized URL → index into ops
  const ops = [];
  const covered = [];
  const skipped = [];
  for (const t of [...tabs].reverse()) {
    const key = BM.normalizeUrl(t.url);
    if (existing.has(key)) {
      skipped.push(t.id);
    } else if (byUrl.has(key)) {
      covered[byUrl.get(key)].push(t.id);
    } else {
      byUrl.set(key, ops.length);
      ops.push({ op: "create", ref: `tab${ops.length}`, parentId: inbox.id, title: t.title, url: t.url });
      covered.push([t.id]);
    }
  }
  return { ops, covered, skipped };
}

// Bookmark the tabs into the inbox as one undoable batch, then drop the ones that made it
// from the list.
async function bookmarkTabs(tabs) {
  if (bookmarking || !tabs.length) return;
  bookmarking = true;
  statusEl.textContent = "Bookmarking…";
  try {
    const inbox = await BM.inbox(await BM.load());
    const where = BM.path(inbox);
    const plan = planBookmarks(tabs, inbox);
    const n = plan.ops.length;
    let done = n;
    let error = null;
    try {
      await BM.applyBatch(plan.ops, `Closed tabs: ${n} to ${where}`);
    } catch (e) {
      done = e.done ?? 0;
      error = e;
    }
    await removeTabs([...plan.skipped, ...plan.covered.slice(0, done).flat()]);
    const already = plan.skipped.length ? ` (${plan.skipped.length} already there)` : "";
    statusEl.replaceChildren(
      error
        ? `Couldn't bookmark all: ${error.message}. `
        : `Moved ${tabs.length} tab${plural(tabs.length)} to ${where}${already}. `,
      done ? "Undo the bookmarks from the popup (🔖 Bookmarks) · " : "",
      el("a", { href: chrome.runtime.getURL("src/pages/bookmarks/bookmarks.html#triage"), target: "_blank", textContent: "Open Inbox" }),
    );
  } catch (e) {
    statusEl.textContent = `Couldn't bookmark: ${e.message}`;
  } finally {
    bookmarking = false;
  }
}

function dayLabel(ts) {
  const day = new Date(ts).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return "Today";
  if (day === today - 86400000) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "16");
  return url.toString();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderItem(t) {
  const link = el("a", { href: t.url, textContent: t.title, title: t.url });
  link.addEventListener("click", (e) => {
    e.preventDefault();
    restoreTabs([t]);
  });
  const bookmark = el("button", { className: "action", textContent: "🔖", title: "Move to the bookmarks inbox" });
  bookmark.addEventListener("click", () => bookmarkTabs([t]));
  const remove = el("button", { className: "action remove", textContent: "×", title: "Delete" });
  remove.addEventListener("click", () => removeTabs([t.id]));
  return el("div", { className: "item" }, [
    el("img", { src: faviconUrl(t.url) }),
    link,
    el("span", { className: "host", textContent: hostOf(t.url) }),
    el("span", {
      className: "time",
      textContent: new Date(t.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    }),
    bookmark,
    remove,
  ]);
}

function renderGroup(label, tabs) {
  const restoreAll = el("button", { className: "link", textContent: "Restore all" });
  restoreAll.addEventListener("click", () => restoreTabs(tabs));
  const bookmarkAll = el("button", { className: "link", textContent: "Bookmark all" });
  bookmarkAll.addEventListener("click", () => bookmarkTabs(tabs));
  const deleteAll = el("button", { className: "link", textContent: "Delete all" });
  deleteAll.addEventListener("click", () => removeTabs(tabs.map((t) => t.id)));
  return el("div", { className: "group" }, [
    el("div", { className: "group-header" }, [
      el("h2", { textContent: label }),
      el("span", { className: "count", textContent: `${tabs.length} tab${tabs.length === 1 ? "" : "s"}` }),
      restoreAll,
      bookmarkAll,
      deleteAll,
    ]),
    ...tabs.map(renderItem),
  ]);
}

// The tabs the filter shows
function shownTabs() {
  const query = filterEl.value.trim().toLowerCase();
  return query
    ? closedTabs.filter((t) => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
    : closedTabs;
}

function render() {
  const query = filterEl.value.trim();
  const tabs = shownTabs();

  totalEl.textContent = `${closedTabs.length} tab${plural(closedTabs.length)}`;

  if (!tabs.length) {
    groupsEl.replaceChildren(el("div", {
      className: "empty",
      textContent: query ? "No matching tabs" : "No closed tabs yet — inactive tabs will show up here",
    }));
    return;
  }

  // closed_tabs is newest-first, so days come out in order
  const byDay = new Map();
  for (const t of tabs) {
    const label = dayLabel(t.time);
    if (!byDay.has(label)) byDay.set(label, []);
    byDay.get(label).push(t);
  }
  groupsEl.replaceChildren(...[...byDay].map(([label, group]) => renderGroup(label, group)));
}

document.getElementById("bookmarkAll").addEventListener("click", () => {
  const tabs = shownTabs();
  if (!tabs.length) return;
  const which = filterEl.value.trim() ? "matching" : "closed";
  if (confirm(`Move all ${tabs.length} ${which} tab${plural(tabs.length)} to the bookmarks inbox?`)) bookmarkTabs(tabs);
});

document.getElementById("clearAll").addEventListener("click", () => {
  if (!closedTabs.length) return;
  if (confirm(`Delete all ${closedTabs.length} closed tabs from the list?`)) {
    removeTabs(closedTabs.map((t) => t.id));
  }
});

filterEl.addEventListener("input", render);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.closed_tabs) {
    closedTabs = changes.closed_tabs.newValue || [];
    render();
  }
});

chrome.storage.local.get(["closed_tabs"], (data) => {
  closedTabs = data.closed_tabs || [];
  render();
});
