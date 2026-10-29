// ═══════════════════════════════════
//  📥 Inbox — file the bookmarks that pile up in one folder (Mobile by default).
//
//  Each inbox bookmark gets a suggested folder when the rest of the bookmarks make
//  it obvious; nothing is guessed. Decisions stay pending (and survive closing the
//  tab) until "Apply" sends them all as one undoable batch.
// ═══════════════════════════════════

// ═══ Rules (pure: model + inbox in, plain data out) ═══
const Triage = (() => {
  // A site's bookmarks must mostly share one folder; spread-out sites (youtube, github) get none.
  const MIN_SITE_BOOKMARKS = 2;
  const MIN_SITE_SHARE = 0.6;

  const isFolder = (node) => node.url === undefined;
  const sameTitle = (a, b) => a.toLowerCase() === b.toLowerCase();

  function isUnder(node, ancestor) {
    for (let n = node; n; n = n.parent) if (n === ancestor) return true;
    return false;
  }

  /**
   * Where bookmarks outside the inbox are filed: the first folder holding each
   * normalized URL, and per site how many bookmarks sit in each folder. Bookmarks
   * directly in a root are unfiled and don't count.
   */
  function buildStats(model, inbox) {
    const byUrl = new Map();
    const bySite = new Map();
    for (const root of Object.values(model.roots)) {
      if (isUnder(root, inbox)) continue;
      for (const b of BM.bookmarksUnder(root)) {
        if (b.parent === root || isUnder(b, inbox)) continue;
        const key = BM.normalizeUrl(b.url);
        if (!byUrl.has(key)) byUrl.set(key, b.parent);
        const site = BM.site(b.url);
        if (!bySite.has(site)) bySite.set(site, new Map());
        const counts = bySite.get(site);
        counts.set(b.parent, (counts.get(b.parent) ?? 0) + 1);
      }
    }
    return { byUrl, bySite };
  }

  /** {folder, reason, duplicate} for one inbox bookmark, or null. */
  function suggest(stats, bookmark) {
    const same = stats.byUrl.get(BM.normalizeUrl(bookmark.url));
    if (same) return { folder: same, reason: "already bookmarked there", duplicate: true };
    const site = BM.site(bookmark.url);
    const counts = stats.bySite.get(site);
    if (!counts) return null;
    let best = null;
    let total = 0;
    for (const [folder, count] of counts) {
      total += count;
      if (!best || count > best.count) best = { folder, count };
    }
    if (best.count >= MIN_SITE_BOOKMARKS && best.count / total >= MIN_SITE_SHARE) {
      return { folder: best.folder, reason: `${best.count}/${total} ${site} bookmarks are there`, duplicate: false };
    }
    return null;
  }

  /** Map of bookmark id → suggestion, for every inbox bookmark that gets one. */
  function suggestAll(model, inbox) {
    const stats = buildStats(model, inbox);
    const out = new Map();
    for (const b of BM.bookmarksUnder(inbox)) {
      const s = suggest(stats, b);
      if (s) out.set(b.id, s);
    }
    return out;
  }

  /**
   * A typed folder path → {folder, path} when it exists, else {folder: null, parent,
   * missing: [titles], path} for the folders to create. "Work/New" is looked up under
   * each root (Bookmarks bar first) and created under the Bookmarks bar. Null if empty.
   */
  function resolvePath(model, text) {
    const parts = text.split("/").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const descend = (root, names) => {
      let node = root;
      let i = 0;
      for (; i < names.length; i++) {
        const child = (node.children ?? []).find((c) => isFolder(c) && sameTitle(c.title, names[i]));
        if (!child) break;
        node = child;
      }
      const missing = names.slice(i);
      const path = [BM.path(node), ...missing].join("/");
      return missing.length ? { folder: null, parent: node, missing, path } : { folder: node, path };
    };
    const roots = [model.roots.bar, model.roots.other, model.roots.mobile].filter(Boolean);
    const named = roots.find((r) => sameTitle(r.title, parts[0]));
    if (named) return descend(named, parts.slice(1));
    for (const root of roots) {
      const found = descend(root, parts);
      if (found.folder) return found;
    }
    return descend(model.roots.bar, parts);
  }

  /** Where a "file" decision goes, as resolvePath answers. */
  function targetOf(model, decision) {
    const folder = decision.folderId && model.byId.get(decision.folderId);
    if (folder && isFolder(folder)) return { folder, path: BM.path(folder) };
    return resolvePath(model, decision.path);
  }

  /** True if `folder` already holds this bookmark's URL (other than the bookmark itself). */
  function holdsUrl(folder, bookmark) {
    const key = BM.normalizeUrl(bookmark.url);
    return (folder.children ?? []).some((c) => c !== bookmark && !isFolder(c) && BM.normalizeUrl(c.url) === key);
  }

  /**
   * Ops for the decisions on `items` (inbox bookmarks). Decisions: {action: "delete"} or
   * {action: "file", folderId?, path}. Filing into a folder that already has the URL
   * removes the inbox copy instead. Missing folders are created first; filed bookmarks
   * go to the end of their folder. Returns {ops, filed, removed, folders}.
   */
  function planOps(model, items, pending) {
    const creates = [];
    const changes = [];
    const refs = new Map(); // path of a new folder → its create ref
    const urls = new Map(); // folder id or ref → normalized URLs it will hold
    const itemIds = new Set(items.map((b) => b.id));
    let filed = 0;
    let removed = 0;

    const createFolders = (parent, missing) => {
      let parentId = parent.id;
      let path = BM.path(parent);
      for (const title of missing) {
        path = `${path}/${title}`;
        if (!refs.has(path)) {
          refs.set(path, `folder:${path}`);
          creates.push({ op: "create", ref: refs.get(path), parentId, title });
        }
        parentId = refs.get(path);
      }
      return parentId;
    };
    // Inbox bookmarks don't count as already there: each is either filed or not.
    const urlsIn = (key, folder) => {
      if (!urls.has(key)) {
        const held = (folder?.children ?? []).filter((c) => !isFolder(c) && !itemIds.has(c.id));
        urls.set(key, new Set(held.map((c) => BM.normalizeUrl(c.url))));
      }
      return urls.get(key);
    };

    for (const item of items) {
      const decision = pending[item.id];
      if (!decision) continue;
      if (decision.action === "delete") {
        changes.push({ op: "remove", id: item.id });
        removed++;
        continue;
      }
      const target = targetOf(model, decision);
      const parentId = target.folder ? target.folder.id : createFolders(target.parent, target.missing);
      const held = urlsIn(parentId, target.folder);
      const key = BM.normalizeUrl(item.url);
      if (held.has(key)) {
        changes.push({ op: "remove", id: item.id });
        removed++;
      } else {
        held.add(key);
        changes.push({ op: "move", id: item.id, parentId });
        filed++;
      }
    }
    return { ops: [...creates, ...changes], filed, removed, folders: creates.length };
  }

  function batchLabel({ filed, removed }) {
    const parts = [filed && `filed ${filed}`, removed && `removed ${removed}`].filter(Boolean);
    return `Inbox: ${parts.join(", ")}`;
  }

  return { isUnder, buildStats, suggest, suggestAll, resolvePath, targetOf, holdsUrl, planOps, batchLabel };
})();

// ═══ View ═══
BM_VIEWS.push({
  id: "triage",
  title: "📥 Inbox",
  init(container) {
    const { el } = BM;
    const PENDING_KEY = "triage_pending";
    const plural = (n) => (n === 1 ? "" : "s");

    let model = null;
    let inbox = null;
    let items = [];
    let suggestions = new Map();
    let pending = {}; // bookmark id → decision
    let focusId = null; // row to keep focused across renders
    let busy = false;

    const picker = el("select", { className: "triage-picker", title: "Folder to file bookmarks from", onchange: pickInbox });
    const summary = el("span", { className: "grow muted" });
    const acceptAllBtn = el("button", { className: "btn triage-accept-all", onclick: acceptAll });
    const applyBtn = el("button", { className: "btn primary triage-apply", onclick: apply });
    const status = el("div", { className: "status-line" });
    const list = el("div", { className: "triage-list" });
    const folderOptions = el("datalist", { id: "triage-folders" });
    container.append(
      el("div", { className: "toolbar" }, el("label", { className: "muted" }, "Inbox"), picker, summary, acceptAllBtn, applyBtn),
      el("div", { className: "triage-keys muted" }, "↑↓ move · Enter accept · F choose folder · Delete delete · Esc clear"),
      status,
      list,
      folderOptions,
    );

    // ═══ Data ═══

    async function refresh() {
      model = await BM.load();
      inbox = await BM.inbox(model);
      const stored = await chrome.storage.local.get([PENDING_KEY]);
      items = BM.bookmarksUnder(inbox);
      suggestions = Triage.suggestAll(model, inbox);
      pending = stored[PENDING_KEY] ?? {};
      const gone = Object.keys(pending).filter((id) => !model.byId.has(id));
      if (gone.length) {
        for (const id of gone) delete pending[id];
        await savePending();
      }
      render();
    }

    function savePending() {
      return chrome.storage.local.set({ [PENDING_KEY]: pending });
    }

    const fileDecision = (folder) => ({ action: "file", folderId: folder.id, path: BM.path(folder) });

    // ═══ Actions ═══

    async function pickInbox() {
      await BM.setInbox(picker.value);
      status.textContent = "";
      await refresh();
    }

    async function acceptAll() {
      for (const b of items) {
        const s = suggestions.get(b.id);
        if (s && !pending[b.id]) pending[b.id] = fileDecision(s.folder);
      }
      await savePending();
      render();
    }

    async function apply() {
      const plan = Triage.planOps(model, items, pending);
      if (!plan.ops.length) return;
      const label = Triage.batchLabel(plan);
      busy = true;
      render();
      try {
        await BM.applyBatch(plan.ops, label);
        for (const b of items) delete pending[b.id];
        await savePending();
        const folders = plan.folders ? `, created ${plan.folders} folder${plural(plan.folders)}` : "";
        status.textContent = `Done: ${label.replace(/^Inbox: /, "")}${folders}. Undo it from the extension popup (🔖 Bookmarks).`;
      } catch (e) {
        status.textContent = `Couldn't apply: ${e.message}. The part that was done is in the popup's list and can be undone there.`;
      } finally {
        busy = false;
        await refresh();
      }
    }

    // A decision for one row, then focus moves on to the next row.
    async function decide(b, decision, advance = true) {
      if (advance) focusId = nextRow(b)?.dataset.id ?? b.id;
      if (decision) pending[b.id] = decision;
      else delete pending[b.id];
      await savePending();
      render();
    }

    function accept(b) {
      const s = suggestions.get(b.id);
      if (s) return decide(b, fileDecision(s.folder));
    }

    const remove = (b) => decide(b, { action: "delete" });
    const clear = (b) => decide(b, null, false);

    function chooseFolder(b, text) {
      const r = Triage.resolvePath(model, text);
      if (r) return decide(b, r.folder ? fileDecision(r.folder) : { action: "file", path: r.path });
    }

    // ═══ Rendering ═══

    function render() {
      const decided = items.filter((b) => pending[b.id]).length;
      const toAccept = items.filter((b) => suggestions.has(b.id) && !pending[b.id]).length;

      picker.replaceChildren(...BM.folders(model).map((f) =>
        el("option", { value: f.id, selected: f === inbox }, BM.path(f))));
      summary.textContent = items.length
        ? `${items.length} bookmark${plural(items.length)} · ${suggestions.size} with a suggestion`
        : "";
      acceptAllBtn.textContent = `Accept all suggestions${toAccept ? ` (${toAccept})` : ""}`;
      acceptAllBtn.disabled = busy || !toAccept;
      applyBtn.textContent = `Apply ${decided} change${plural(decided)}`;
      applyBtn.disabled = busy || !decided;

      folderOptions.replaceChildren(...BM.folders(model)
        .filter((f) => !Triage.isUnder(f, inbox))
        .map((f) => el("option", { value: BM.path(f) })));

      if (!items.length) {
        list.replaceChildren(el("div", { className: "empty triage-zero" },
          el("div", { className: "triage-zero-icon" }, "🎉"),
          el("div", { className: "triage-zero-title" }, "Inbox zero"),
          el("div", {}, `Nothing left to file in ${BM.path(inbox)}.`)));
        return;
      }

      const hadFocus = list.contains(document.activeElement);
      // A folder path being typed survives a refresh (bookmarks changed elsewhere).
      const typing = document.activeElement?.classList.contains("triage-folder")
        ? { id: document.activeElement.closest(".triage-item").dataset.id, value: document.activeElement.value }
        : null;
      // One group per folder (the inbox itself, then its subfolders), in display order.
      const groups = new Map();
      for (const b of items) {
        if (!groups.has(b.parent)) groups.set(b.parent, []);
        groups.get(b.parent).push(b);
      }
      list.replaceChildren(...[...groups].map(([folder, bookmarks]) => el("div", { className: "group" },
        el("div", { className: "group-header" },
          el("h2", {}, BM.path(folder)),
          el("span", { className: "count" }, `${bookmarks.length} bookmark${plural(bookmarks.length)}`)),
        bookmarks.map(renderRow))));
      const typedInto = typing && rowOf(typing.id)?.querySelector(".triage-folder");
      if (typedInto && !pending[typing.id]) {
        typedInto.value = typing.value;
        typedInto.focus();
        typedInto.dispatchEvent(new Event("input")); // the new-folder hint
      } else if (hadFocus && focusId) {
        rowOf(focusId)?.focus();
      }
    }

    // What a decision will do, for the row's badge.
    function describe(bookmark, decision) {
      if (decision.action === "delete") return { kind: "remove", text: "🗑 Delete" };
      const target = Triage.targetOf(model, decision);
      if (!target.folder) return { kind: "file", text: `→ ${target.path}`, isNew: true };
      if (Triage.holdsUrl(target.folder, bookmark)) {
        return { kind: "remove", text: `✕ Remove: already in ${target.path}` };
      }
      return { kind: "file", text: `→ ${target.path}` };
    }

    function renderTarget(b) {
      const decision = pending[b.id];
      if (decision) {
        const d = describe(b, decision);
        return el("div", { className: `triage-pending ${d.kind}`, title: d.text },
          el("span", { className: "triage-pending-text" }, d.text),
          d.isNew && el("span", { className: "triage-new", title: "This folder will be created" }, "new folder"));
      }
      const s = suggestions.get(b.id);
      if (!s) return el("div", { className: "triage-suggestion muted" }, "No suggestion");
      const reason = s.duplicate ? `${s.reason}: accepting removes this copy` : s.reason;
      return el("div", { className: "triage-suggestion", title: reason },
        el("div", { className: "triage-path" }, `${s.duplicate ? "✕" : "→"} ${BM.path(s.folder)}`),
        el("div", { className: "sub" }, reason));
    }

    function renderFolderInput(b) {
      const input = el("input", {
        type: "text", className: "triage-folder", placeholder: "Folder…",
        title: "Type a folder path; one that doesn't exist (e.g. Work/New) is created under the Bookmarks bar",
      });
      input.setAttribute("list", folderOptions.id);
      const hint = el("div", { className: "triage-hint" });
      input.addEventListener("input", () => {
        const r = Triage.resolvePath(model, input.value);
        hint.textContent = r && !r.folder ? `＋ new folder ${r.path}` : "";
        // Picking from the list fills in an existing path exactly: take it right away.
        if (r?.folder && [...folderOptions.options].some((o) => o.value === input.value)) chooseFolder(b, input.value);
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // typing isn't a row shortcut
        if (e.key === "Enter" && input.value.trim()) {
          e.preventDefault();
          chooseFolder(b, input.value);
        } else if (e.key === "Escape") {
          rowOf(b.id).focus();
        }
      });
      return el("div", { className: "triage-folder-box" }, input, hint);
    }

    function renderRow(b) {
      const decision = pending[b.id];
      const suggestion = suggestions.get(b.id);
      const site = BM.site(b.url);
      return el("div", {
        className: `row triage-item${decision ? " decided" : ""}`, tabIndex: 0, dataset: { id: b.id },
        onfocus: () => { focusId = b.id; },
        onkeydown: (e) => onRowKey(e, b),
      },
        el("img", { className: "fav", src: BM.favicon(b.url), alt: "" }),
        el("div", { className: "title" },
          el("a", { href: b.url, target: "_blank", title: b.url }, b.title || b.url),
          el("div", { className: "sub" }, site ? `${site} · ${b.url}` : b.url)),
        el("div", { className: "triage-target" }, renderTarget(b)),
        el("div", { className: "triage-actions" },
          suggestion && !decision && el("button", {
            className: "link triage-accept", title: "Accept the suggestion (Enter)", onclick: () => accept(b),
          }, suggestion.duplicate ? "✓ Remove copy" : "✓ Accept"),
          renderFolderInput(b),
          decision
            ? el("button", { className: "link triage-clear", title: "Keep it in the inbox (Esc)", onclick: () => clear(b) }, "Clear")
            : el("button", { className: "link triage-delete", title: "Delete this bookmark (Delete)", onclick: () => remove(b) }, "Delete")));
    }

    // ═══ Keyboard ═══

    const rowOf = (id) => list.querySelector(`.triage-item[data-id="${CSS.escape(id)}"]`);

    function nextRow(b, step = 1) {
      const rows = [...list.querySelectorAll(".triage-item")];
      return rows[rows.findIndex((r) => r.dataset.id === b.id) + step] ?? null;
    }

    function onRowKey(e, b) {
      if (e.target !== e.currentTarget) return; // a button or link inside the row
      const handled = {
        ArrowDown: () => nextRow(b, 1)?.focus(),
        j: () => nextRow(b, 1)?.focus(),
        ArrowUp: () => nextRow(b, -1)?.focus(),
        k: () => nextRow(b, -1)?.focus(),
        Enter: () => accept(b),
        Delete: () => remove(b),
        Backspace: () => remove(b),
        Escape: () => clear(b),
        f: () => e.currentTarget.querySelector(".triage-folder").focus(),
      }[e.key];
      if (!handled) return;
      e.preventDefault();
      handled();
    }

    BM.onChanged(() => { if (!busy) refresh(); });
    refresh();
  },
});
