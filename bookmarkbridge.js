// ═══════════════════════════════════
//  Bookmark Bridge — lets local programs edit bookmarks through chrome.bookmarks,
//  so Chrome Sync uploads the changes like edits made by hand. (Editing Chrome's
//  Bookmarks file instead doesn't sync reliably.)
//
//  Off by default. When on, the extension connects to the native messaging host
//  "com.superlevels.bookmarks"; the open port keeps this service worker alive.
//  The host forwards requests from local programs; protocol in README.
//
//  Every batch of changes is journaled with its inverse, so the popup can undo it.
// ═══════════════════════════════════
const BRIDGE_HOST = "com.superlevels.bookmarks";
const BRIDGE_ALARM = "bookmarkBridge";
const BRIDGE_MAX_BATCHES = 10;
const BRIDGE_MAX_JOURNAL_CHARS = 4 * 1024 * 1024; // chrome.storage.local holds 10 MB in all

let bridgePort = null;
let bridgeError = "";
// One batch (or undo) at a time, so journals and ids stay consistent.
let bridgeQueue = Promise.resolve();

function serialized(fn) {
  const run = bridgeQueue.then(fn);
  bridgeQueue = run.catch(() => {});
  return run;
}

async function syncBridge() {
  const { bookmarks_bridge_enabled } = await chrome.storage.local.get(["bookmarks_bridge_enabled"]);
  if (bookmarks_bridge_enabled) connectBridge();
  else if (bridgePort) {
    bridgePort.disconnect(); // the host exits when its stdin closes
    bridgePort = null;
  }
}

function connectBridge() {
  if (bridgePort) return;
  const port = chrome.runtime.connectNative(BRIDGE_HOST);
  bridgePort = port;
  bridgeError = "";
  port.onMessage.addListener((msg) => handleBridgeRequest(port, msg));
  port.onDisconnect.addListener(() => {
    bridgeError = chrome.runtime.lastError?.message || "Host exited";
    if (bridgePort === port) bridgePort = null;
  });
}

async function handleBridgeRequest(port, { id, method, params = {} }) {
  try {
    const handler = BRIDGE_METHODS[method];
    if (!handler) throw new Error(`Unknown method: ${method}`);
    port.postMessage({ id, result: await handler(params) });
  } catch (e) {
    port.postMessage({ id, error: e.message ?? String(e) });
  }
}

const BRIDGE_METHODS = {
  ping: async () => ({ version: chrome.runtime.getManifest().version }),
  getTree: () => chrome.bookmarks.getTree(),
  // Requests sharing a `batch` id form one journal entry, so a large change sent in
  // several requests is undone as one.
  apply: ({ ops, batch, label }) => serialized(() => applyAndJournal(ops, batch, label)),
};

async function applyAndJournal(ops, batchId, label) {
  const result = await applyBookmarkOps(ops);
  if (result.inverse.length) await journal(batchId ?? crypto.randomUUID(), label, ops, result);
  delete result.inverse;
  return result;
}

// Runs ops in order and stops at the first failure. A create's `ref` names the new node, so
// later ops can use it as `id` or `parentId`. Collects the ops that undo what was done.
// Returns { done, created: {ref: id}, inverse, error?, failedOp? }.
async function applyBookmarkOps(ops) {
  const created = {};
  const inverse = [];
  const resolve = (id) => created[id] ?? id;
  for (const [i, op] of ops.entries()) {
    try {
      switch (op.op) {
        case "create": {
          const node = await chrome.bookmarks.create({
            parentId: resolve(op.parentId),
            index: op.index,
            title: op.title,
            url: op.url,
          });
          created[op.ref] = node.id;
          inverse.push({ op: "remove", id: node.id });
          break;
        }
        case "move": {
          const id = resolve(op.id);
          const [old] = await chrome.bookmarks.get(id);
          const moved = await chrome.bookmarks.move(id, { parentId: resolve(op.parentId), index: op.index });
          // Chrome counts a same-folder index with the node still in its old slot.
          const back = moved.parentId === old.parentId && old.index > moved.index ? old.index + 1 : old.index;
          inverse.push({ op: "move", id, parentId: old.parentId, index: back });
          break;
        }
        case "update": {
          const id = resolve(op.id);
          const [old] = await chrome.bookmarks.get(id);
          await chrome.bookmarks.update(id, {
            ...(op.title !== undefined && { title: op.title }),
            ...(op.url !== undefined && { url: op.url }),
          });
          inverse.push({ op: "update", id, title: old.title, ...(old.url !== undefined && { url: old.url }) });
          break;
        }
        case "remove": {
          // Refuses non-empty folders, so nothing is deleted that the caller didn't name.
          const id = resolve(op.id);
          const [old] = await chrome.bookmarks.get(id);
          await chrome.bookmarks.remove(id);
          // Recreated under a new id; the ref maps the old id to it for earlier undo ops.
          inverse.push({
            op: "create", ref: id, parentId: old.parentId, index: old.index,
            title: old.title, ...(old.url !== undefined && { url: old.url }),
          });
          break;
        }
        default:
          throw new Error(`Unknown op: ${op.op}`);
      }
    } catch (e) {
      return { done: i, created, inverse, error: e.message ?? String(e), failedOp: op };
    }
  }
  return { done: ops.length, created, inverse };
}

function countOps(ops, counts = {}) {
  for (const op of ops) counts[op.op] = (counts[op.op] || 0) + 1;
  return counts;
}

async function journal(batchId, label, ops, result) {
  const { bookmarks_batches: batches = [] } = await chrome.storage.local.get(["bookmarks_batches"]);
  let batch = batches[0]?.id === batchId && !batches[0].undone ? batches[0] : null;
  if (!batch) {
    batch = { id: batchId, label: label || "Bookmark changes", time: Date.now(), counts: {}, undo: [] };
    batches.unshift(batch);
  }
  countOps(ops.slice(0, result.done), batch.counts);
  // Undo runs newest first.
  batch.undo = [...result.inverse.reverse(), ...batch.undo];
  if (result.error) batch.error = result.error;
  batches.length = Math.min(batches.length, BRIDGE_MAX_BATCHES);
  while (batches.length > 1 && JSON.stringify(batches).length > BRIDGE_MAX_JOURNAL_CHARS) batches.pop();
  await chrome.storage.local.set({ bookmarks_batches: batches });
}

// Undo the newest batch not yet undone. Older ones only after it, since later changes
// may depend on earlier ones.
function undoLatestBatch() {
  return serialized(async () => {
    const { bookmarks_batches: batches = [] } = await chrome.storage.local.get(["bookmarks_batches"]);
    const batch = batches.find((b) => !b.undone);
    if (!batch) return { error: "Nothing to undo" };
    const result = await applyBookmarkOps(batch.undo);
    // Recreated bookmarks have new ids; older batches' undo must use them.
    const resolve = (id) => result.created[id] ?? id;
    const remap = (ops) => ops.map((op) => ({
      ...op,
      ...(op.id !== undefined && { id: resolve(op.id) }),
      ...(op.parentId !== undefined && { parentId: resolve(op.parentId) }),
    }));
    for (const older of batches) if (older !== batch && !older.undone) older.undo = remap(older.undo);
    if (result.error) {
      // Keep the part not yet undone, so a retry continues where this stopped.
      batch.undo = remap(batch.undo.slice(result.done));
      batch.error = `Undo stopped: ${result.error}`;
    } else {
      batch.undone = Date.now();
      batch.undo = [];
      delete batch.error;
    }
    await chrome.storage.local.set({ bookmarks_batches: batches });
    return result.error ? { error: result.error } : { ok: true };
  });
}

// Extension pages (popup, bookmarks.html) apply their own batches here too, so the
// journal and undo cover every change, not only the bridge's. Content scripts run
// inside web pages and must never reach these, so only extension pages are answered.
function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg.type?.startsWith("bookmark") || !fromExtensionPage(sender)) return;
  if (msg.type === "bookmarkBridgeStatus") {
    sendResponse({ connected: !!bridgePort, error: bridgeError });
  } else if (msg.type === "bookmarkBridgeUndo") {
    undoLatestBatch().then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true; // async sendResponse
  } else if (msg.type === "bookmarkApplyBatch") {
    serialized(() => applyAndJournal(msg.ops, undefined, msg.label))
      .then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;
  }
});

syncBridge();
chrome.alarms.create(BRIDGE_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BRIDGE_ALARM) syncBridge();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.bookmarks_bridge_enabled) syncBridge();
});
