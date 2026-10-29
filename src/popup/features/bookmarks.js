// ═══════════════════════════════════
//  Bookmark Bridge
// ═══════════════════════════════════
import { featureToggle } from "../lib/toggle.js";

const bookmarksConn = document.getElementById("bookmarksConn");
const bookmarksBatches = document.getElementById("bookmarksBatches");
const bookmarksNote = document.getElementById("bookmarksNote");
const BOOKMARK_OP_LABELS = { create: "added", move: "moved", update: "renamed", remove: "removed" };

const loadBridgeToggle = featureToggle({
  key: "bookmarks_bridge_enabled",
  defaultOn: false,
  toggle: document.getElementById("bookmarksToggle"),
  status: document.getElementById("bookmarksStatus"),
  // Give the background a moment to connect before showing the status
  onChange: () => setTimeout(loadBookmarkBridge, 500),
});

export async function loadBookmarkBridge() {
  const enabled = await loadBridgeToggle();
  const { bookmarks_batches = [] } = await chrome.storage.local.get(["bookmarks_batches"]);
  renderBookmarkBatches(bookmarks_batches);
  if (!enabled) {
    bookmarksConn.textContent = "Off: no host runs, and no program on this computer can change your bookmarks.";
    return;
  }
  const status = await chrome.runtime.sendMessage({ type: "bookmarkBridgeStatus" }).catch(() => null);
  bookmarksConn.textContent = status?.connected
    ? "Connected to the host com.superlevels.bookmarks."
    : `Not connected${status?.error ? `: ${status.error}` : ""}. Retries every minute.`;
}

function renderBookmarkBatches(batches) {
  bookmarksBatches.replaceChildren();
  if (!batches.length) {
    bookmarksBatches.innerHTML = '<div class="empty">No changes yet</div>';
    return;
  }
  const undoable = batches.find((b) => !b.undone);
  for (const batch of batches) {
    const item = document.createElement("div");
    item.className = "item";
    const text = document.createElement("span");
    const counts = Object.entries(batch.counts)
      .map(([op, n]) => `${n} ${BOOKMARK_OP_LABELS[op] || op}`)
      .join(", ");
    const when = new Date(batch.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    text.textContent = `${batch.label} · ${when} · ${counts}` +
      (batch.undone ? " · undone" : "") + (batch.error ? ` · ${batch.error}` : "");
    item.append(text);
    if (batch === undoable) {
      const btn = document.createElement("button");
      btn.textContent = "↶";
      btn.title = "Undo this batch";
      btn.addEventListener("click", undoBookmarkBatch);
      item.append(btn);
    }
    bookmarksBatches.append(item);
  }
}

async function undoBookmarkBatch() {
  bookmarksNote.textContent = "Undoing…";
  const result = await chrome.runtime.sendMessage({ type: "bookmarkBridgeUndo" })
    .catch((e) => ({ error: e.message }));
  bookmarksNote.textContent = result?.error ? `Undo failed: ${result.error}` : "Undone.";
  loadBookmarkBridge();
}

document.querySelectorAll("[data-bookmark-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/bookmarks/bookmarks.html#${btn.dataset.bookmarkView}`) });
  });
});
