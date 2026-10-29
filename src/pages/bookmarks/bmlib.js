// ═══════════════════════════════════
//  Bookmark tools — shared helpers for bookmarks.html (Inbox, Dead links, Tidy)
//  and the closed-tabs page (which moves tabs to the inbox)
//
//  Reads go straight to chrome.bookmarks. Every write goes through BM.applyBatch,
//  which the background journals, so each batch shows up in the popup's
//  🔖 Bookmarks page and can be undone there.
// ═══════════════════════════════════
const BM = (() => {
  const ROOT_TYPES = { "bookmarks-bar": "bar", other: "other", mobile: "mobile" };
  const LEGACY_ROOT_IDS = { 1: "bar", 2: "other", 3: "mobile" }; // Chrome < 134 has no folderType
  const INBOX_KEY = "triage_inbox_id";

  // Query parameters that only track where a click came from. Removing them never
  // changes which page a URL opens.
  const TRACKING_PARAMS = new Set([
    "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "twclid", "ttclid",
    "li_fat_id", "igshid", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "yclid",
    "ref_src", "ref_url", "s_cid", "oly_anon_id", "oly_enc_id", "vero_id", "rb_clickid",
    "spm", "share_source", "utm_id",
  ]);
  const isTracking = (key) => key.startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase());

  /**
   * Load the bookmark tree. When Chrome keeps local and account bookmarks apart, each
   * root exists twice; the syncing one is used and the other listed in `ignored`.
   * Nodes: {id, parentId, index, title, url?, children?, dateAdded, parent}.
   * Returns {roots: {bar, other, mobile?}, byId: Map, ignored: [title]}.
   * Chrome hides an empty Mobile bookmarks folder entirely (absent from the tree, and
   * nothing can be created in it), so `roots.mobile` is missing until a phone syncs one.
   */
  async function load() {
    const [tree] = await chrome.bookmarks.getTree();
    const byId = new Map();
    const link = (node, parent) => {
      node.parent = parent;
      byId.set(node.id, node);
      for (const child of node.children ?? []) link(child, node);
    };
    const roots = {};
    const candidates = [];
    for (const node of tree.children ?? []) {
      const key = node.folderType ? ROOT_TYPES[node.folderType] : LEGACY_ROOT_IDS[node.id];
      if (!key) continue; // managed bookmarks
      candidates.push(node);
      if (!roots[key] || (node.syncing && !roots[key].syncing)) roots[key] = node;
    }
    const picked = new Set(Object.values(roots));
    const ignored = candidates.filter((n) => !picked.has(n) && n.children?.length).map((n) => n.title);
    for (const root of picked) link(root, null);
    return { roots, byId, ignored };
  }

  /**
   * The inbox folder: the one picked in the Inbox view, else Mobile bookmarks, else
   * Other bookmarks (when Chrome hides an empty Mobile folder).
   */
  async function inbox(model) {
    const { [INBOX_KEY]: id } = await chrome.storage.local.get([INBOX_KEY]);
    const chosen = model.byId.get(id);
    return chosen && chosen.url === undefined ? chosen : model.roots.mobile ?? model.roots.other;
  }

  function setInbox(folderId) {
    return chrome.storage.local.set({ [INBOX_KEY]: folderId });
  }

  /** "Bookmarks bar/Work/Code" for a folder; for a bookmark, the folder it is in. */
  function path(node) {
    const parts = [];
    for (let n = node.url === undefined ? node : node.parent; n; n = n.parent) parts.unshift(n.title);
    return parts.join("/");
  }

  /** Every bookmark (not folder) under `node`, in display order. */
  function bookmarksUnder(node, out = []) {
    for (const child of node.children ?? []) {
      if (child.url !== undefined) out.push(child);
      else bookmarksUnder(child, out);
    }
    return out;
  }

  /** Every folder in the model, roots included, in display order. */
  function folders(model) {
    const out = [];
    const walk = (node) => {
      out.push(node);
      for (const child of node.children ?? []) if (child.url === undefined) walk(child);
    };
    for (const root of Object.values(model.roots)) walk(root);
    return out;
  }

  /** Host without "www.", lowercased; "" for URLs without one (javascript:, file:). */
  function site(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  /** The URL without tracking parameters; unchanged if there are none or it doesn't parse. */
  function stripTracking(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const keys = [...parsed.searchParams.keys()];
    if (!keys.some(isTracking)) return url;
    for (const key of keys) if (isTracking(key)) parsed.searchParams.delete(key);
    return parsed.toString();
  }

  /**
   * A key under which URLs that open the same page compare equal: http/https, "www.",
   * a trailing slash, an empty fragment and tracking parameters don't matter.
   */
  function normalizeUrl(url) {
    let parsed;
    try {
      parsed = new URL(stripTracking(url));
    } catch {
      return url;
    }
    if (!/^https?:$/.test(parsed.protocol)) return url;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${host}${port}${pathname}${parsed.search}${parsed.hash === "#" ? "" : parsed.hash}`;
  }

  /**
   * Apply ops as one undoable batch named `label`. Ops as in the README's bridge
   * protocol: create {ref, parentId, index?, title, url?}, move {id, parentId, index?},
   * update {id, title?, url?}, remove {id} (folders only when empty).
   * Resolves to {done, created}; throws if Chrome rejected an op (the ones before it
   * stay applied and are in the journal; the error's `done` counts them).
   */
  async function applyBatch(ops, label) {
    if (!ops.length) return { done: 0, created: {} };
    const result = await chrome.runtime.sendMessage({ type: "bookmarkApplyBatch", ops, label });
    if (!result) throw new Error("No answer from the background");
    if (result.error) {
      const done = result.done ?? 0;
      throw Object.assign(new Error(`${result.error} (after ${done} of ${ops.length} changes)`), { done });
    }
    return result;
  }

  /** Favicon for a page, from Chrome's cache. */
  function favicon(url, size = 16) {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", String(size));
    return u.toString();
  }

  /** Call `fn` (debounced) whenever bookmarks change, from here or anywhere else. */
  function onChanged(fn, delay = 300) {
    let timer;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
    for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
      chrome.bookmarks[event].addListener(fire);
    }
  }

  /** el("div", {className: "x", onclick}, "text", child) */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "dataset") Object.assign(node.dataset, value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  return { load, inbox, setInbox, path, bookmarksUnder, folders, site, stripTracking, normalizeUrl, applyBatch, favicon, onChanged, el };
})();

// Views of bookmarks.html register here (see bookmarks.js).
const BM_VIEWS = [];
