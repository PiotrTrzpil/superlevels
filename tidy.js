// ═══════════════════════════════════
//  🧹 Tidy — finds clutter in the bookmarks and removes it on request:
//  duplicate bookmarks, tracking parameters in URLs, and empty folders.
//
//  The analysis is pure (model in, plan items out; see TIDY). Each section's
//  Apply sends its checked items as one BM.applyBatch, undoable in the popup.
// ═══════════════════════════════════
const TIDY = (() => {
  /** Folders above `node` (for a bookmark, its folder and the ones above it). */
  function depth(node) {
    let d = 0;
    for (let n = node.parent; n; n = n.parent) d++;
    return d;
  }

  /** Every bookmark in the model, in display order. */
  function allBookmarks(model) {
    return Object.values(model.roots).flatMap((root) => BM.bookmarksUnder(root));
  }

  /** True when a title says nothing beyond the URL itself. */
  function isBareTitle(title, url) {
    const t = (title ?? "").trim();
    return !t || t === url || BM.normalizeUrl(t) === BM.normalizeUrl(url);
  }

  // ═══ Duplicates ═══

  /**
   * Bookmarks that open the same page (equal BM.normalizeUrl), in groups of 2+.
   * The kept copy is `keepChoice.get(key)` when that id is still in the group,
   * else the deepest one (most specific folder), then the oldest, then the first.
   * `newTitle` is set when the kept copy has no real title but another copy does.
   * Returns [{key, copies, keep, remove, newTitle?}], copies in display order.
   */
  function findDuplicates(model, keepChoice = new Map()) {
    const byKey = new Map();
    for (const node of allBookmarks(model)) {
      const key = BM.normalizeUrl(node.url);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(node);
    }
    const groups = [];
    for (const [key, copies] of byKey) {
      if (copies.length < 2) continue;
      const keep = copies.find((n) => n.id === keepChoice.get(key)) ?? defaultKeep(copies);
      const remove = copies.filter((n) => n !== keep);
      const group = { key, copies, keep, remove };
      if (isBareTitle(keep.title, keep.url)) {
        const titled = remove.find((n) => !isBareTitle(n.title, n.url));
        if (titled) group.newTitle = titled.title;
      }
      groups.push(group);
    }
    return groups;
  }

  /** Deepest, then oldest, then first in display order. */
  function defaultKeep(copies) {
    return copies.reduce((best, n) => {
      const d = depth(n) - depth(best);
      if (d !== 0) return d > 0 ? n : best;
      return (n.dateAdded ?? 0) < (best.dateAdded ?? 0) ? n : best;
    });
  }

  /** Ops for the selected copies to remove (`selected(id)`), plus the kept copy's rename. */
  function duplicateOps(groups, selected = () => true) {
    const ops = [];
    for (const group of groups) {
      const chosen = group.remove.filter((n) => selected(n.id));
      if (!chosen.length) continue;
      if (group.newTitle !== undefined) ops.push({ op: "update", id: group.keep.id, title: group.newTitle });
      for (const n of chosen) ops.push({ op: "remove", id: n.id });
    }
    return ops;
  }

  // ═══ Tracking parameters ═══

  /** Bookmarks whose URL has tracking parameters: [{node, clean, removed: [param]}]. */
  function findTracking(model) {
    const items = [];
    for (const node of allBookmarks(model)) {
      const clean = BM.stripTracking(node.url);
      if (clean === node.url) continue;
      const kept = new Set(new URL(clean).searchParams.keys());
      const removed = [...new Set(new URL(node.url).searchParams.keys())].filter((k) => !kept.has(k));
      items.push({ node, clean, removed });
    }
    return items;
  }

  function trackingOps(items, selected = () => true) {
    return items.filter((i) => selected(i.node.id)).map((i) => ({ op: "update", id: i.node.id, url: i.clean }));
  }

  /** `url` cut into [{text, removed}] so the removed `key=value` pairs can be highlighted. */
  function urlParts(url, removedKeys) {
    const hashAt = url.indexOf("#");
    const base = hashAt < 0 ? url : url.slice(0, hashAt);
    const hash = hashAt < 0 ? "" : url.slice(hashAt);
    const queryAt = base.indexOf("?");
    if (queryAt < 0) return [{ text: url, removed: false }];
    const removed = new Set(removedKeys);
    const parts = [{ text: base.slice(0, queryAt + 1), removed: false }];
    base.slice(queryAt + 1).split("&").forEach((pair, i) => {
      const key = new URLSearchParams(pair).keys().next().value;
      parts.push({ text: (i ? "&" : "") + pair, removed: removed.has(key) });
    });
    if (hash) parts.push({ text: hash, removed: false });
    return parts;
  }

  // ═══ Empty folders ═══

  /** Folders (not roots) with no bookmark at any depth, in display order: [{node, depth}]. */
  function findEmptyFolders(model) {
    return BM.folders(model)
      .filter((f) => f.parent && !BM.bookmarksUnder(f).length)
      .map((node) => ({ node, depth: depth(node) }));
  }

  /**
   * Removes for the selected folders, deepest first (Chrome refuses non-empty folders).
   * A folder holding an unselected one is skipped, since it would stay non-empty.
   */
  function emptyFolderOps(items, selected = () => true) {
    const keptIds = new Set(items.filter((i) => !selected(i.node.id)).map((i) => i.node.id));
    const holdsKept = (node) => (node.children ?? []).some((c) => keptIds.has(c.id) || holdsKept(c));
    return items
      .filter((i) => selected(i.node.id) && !holdsKept(i.node))
      .sort((a, b) => b.depth - a.depth)
      .map((i) => ({ op: "remove", id: i.node.id }));
  }

  return {
    depth, isBareTitle, findDuplicates, duplicateOps, findTracking, trackingOps, urlParts,
    findEmptyFolders, emptyFolderOps,
  };
})();

// ═══════════════════════════════════
//  View
// ═══════════════════════════════════
(() => {
  const { el } = BM;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  BM_VIEWS.push({ id: "tidy", title: "🧹 Tidy", init });

  function init(container) {
    const state = {
      model: null,
      keepChoice: new Map(), // duplicate key → id of the copy to keep
      unchecked: new Set(), // "<section>:<id>" of items the user unticked
      busy: false,
      status: "",
    };
    let loads = 0;

    async function refresh() {
      const mine = ++loads;
      const model = await BM.load();
      if (mine !== loads) return; // a newer load is under way
      state.model = model;
      render();
    }

    const isChecked = (sectionId, id) => !state.unchecked.has(`${sectionId}:${id}`);
    const setChecked = (sectionId, id, on) => {
      const key = `${sectionId}:${id}`;
      if (on) state.unchecked.delete(key);
      else state.unchecked.add(key);
    };

    async function apply(ops, label, done) {
      if (!ops.length || state.busy) return;
      state.busy = true;
      state.status = "Applying…";
      render();
      try {
        await BM.applyBatch(ops, label);
        state.status = `${done}. Undo it from the popup's 🔖 Bookmarks page.`;
      } catch (e) {
        state.status = `Failed: ${e.message}`;
      }
      state.busy = false;
      await refresh();
    }

    // ═══ Rendering ═══

    // Every section is computed from the current tree, so applying one updates the others.
    function render() {
      const { model } = state;
      const duplicates = TIDY.findDuplicates(model, state.keepChoice);
      const tracking = TIDY.findTracking(model);
      const empty = TIDY.findEmptyFolders(model);
      const removing = duplicates.reduce((n, g) => n + g.remove.length, 0);
      container.replaceChildren(
        el("div", { className: "toolbar" },
          el("span", { className: "tidy-summary grow" },
            `${plural(removing, "duplicate")} · ${plural(tracking.length, "tracked URL")} · ` +
            plural(empty.length, "empty folder")),
        ),
        el("div", { className: "status-line tidy-status" }, state.status),
        duplicatesSection(duplicates, removing),
        trackingSection(tracking),
        emptySection(empty),
      );
    }

    function section({ id, title, count, rows, emptyText, selectedCount, onApply }) {
      return el("div", { className: "group tidy-section", dataset: { section: id } },
        el("div", { className: "group-header" },
          el("h2", {}, title),
          el("span", { className: "count" }, rows.length ? count : ""),
          rows.length
            ? el("button", {
              className: "btn primary", dataset: { apply: id },
              disabled: state.busy || !selectedCount, onclick: onApply,
            }, "Apply")
            : null,
        ),
        rows.length ? rows : el("div", { className: "empty" }, emptyText),
      );
    }

    function checkbox(sectionId, id, onToggle) {
      return el("input", {
        type: "checkbox", checked: isChecked(sectionId, id), dataset: { id },
        onchange: (e) => {
          setChecked(sectionId, id, e.target.checked);
          onToggle?.(e.target.checked);
          render();
        },
      });
    }

    function bookmarkInfo(node, sub) {
      return [
        el("img", { className: "fav", src: BM.favicon(node.url), alt: "" }),
        el("div", { className: "title" },
          el("a", { href: node.url, target: "_blank", title: node.url }, node.title || node.url),
          el("div", { className: "sub" }, sub),
        ),
      ];
    }

    // ═══ Duplicates ═══

    function duplicatesSection(groups, removing) {
      const ops = TIDY.duplicateOps(groups, (id) => isChecked("dup", id));
      const what = plural(ops.filter((o) => o.op === "remove").length, "duplicate");
      return section({
        id: "duplicates", title: "Duplicates",
        count: `${plural(groups.length, "page")} saved more than once · ${removing} to remove`,
        rows: groups.map(duplicateGroup), emptyText: "No duplicates",
        selectedCount: ops.length,
        onApply: () => apply(ops, `Tidy: removed ${what}`, `Removed ${what}`),
      });
    }

    function duplicateGroup(group) {
      const rename = group.newTitle !== undefined
        ? el("span", { className: "tidy-rename" }, ` · gets the title “${group.newTitle}”`)
        : null;
      const keepRow = el("div", { className: "row tidy-keep", dataset: { id: group.keep.id } },
        el("span", { className: "tidy-badge", title: "Kept" }, "✓"),
        ...bookmarkInfo(group.keep, [BM.path(group.keep), rename]),
      );
      const removeRows = group.remove.map((node) =>
        el("label", { className: "row tidy-remove", dataset: { id: node.id } },
          checkbox("dup", node.id),
          ...bookmarkInfo(node, BM.path(node)),
          el("button", {
            className: "link", dataset: { keep: node.id },
            onclick: (e) => {
              e.preventDefault();
              state.keepChoice.set(group.key, node.id);
              render();
            },
          }, "Keep this one"),
        ));
      return el("div", { className: "tidy-dup", dataset: { key: group.key } }, keepRow, ...removeRows);
    }

    // ═══ Tracking parameters ═══

    function trackingSection(items) {
      const ops = TIDY.trackingOps(items, (id) => isChecked("track", id));
      const what = plural(ops.length, "URL");
      return section({
        id: "tracking", title: "Tracking parameters",
        count: `${plural(items.length, "URL")} with tracking parameters`,
        rows: items.map(trackingRow), emptyText: "No tracking parameters",
        selectedCount: ops.length,
        onApply: () => apply(ops, `Tidy: cleaned ${what}`, `Cleaned ${what}`),
      });
    }

    function trackingRow({ node, clean, removed }) {
      const before = TIDY.urlParts(node.url, removed).map((part) =>
        part.removed ? el("mark", {}, part.text) : part.text);
      return el("label", { className: "row tidy-track", dataset: { id: node.id } },
        checkbox("track", node.id),
        el("img", { className: "fav", src: BM.favicon(node.url), alt: "" }),
        el("div", { className: "title" },
          el("div", { className: "tidy-name" }, node.title || node.url,
            el("span", { className: "muted" }, ` · ${BM.path(node)}`)),
          el("div", { className: "tidy-url" }, before),
          el("div", { className: "tidy-url after" }, "→ ", clean),
        ),
      );
    }

    // ═══ Empty folders ═══

    function emptySection(items) {
      const ops = TIDY.emptyFolderOps(items, (id) => isChecked("empty", id));
      const what = plural(ops.length, "empty folder");
      const listed = new Set(items.map((i) => i.node.id));
      // Ticking a folder ticks the empty folders in it; unticking one unticks the
      // folders around it, which can't be removed while it stays.
      const cascade = (node, on) => {
        if (on) for (const i of items) if (isInside(i.node, node)) setChecked("empty", i.node.id, true);
        if (!on) for (let n = node.parent; n && listed.has(n.id); n = n.parent) setChecked("empty", n.id, false);
      };
      return section({
        id: "empty", title: "Empty folders",
        count: `${plural(items.length, "folder")} without bookmarks`,
        rows: items.map(({ node }) =>
          el("label", { className: "row tidy-folder", dataset: { id: node.id } },
            checkbox("empty", node.id, (on) => cascade(node, on)),
            el("span", { className: "tidy-folder-icon" }, "📁"),
            el("div", { className: "title" }, BM.path(node)),
          )),
        emptyText: "No empty folders",
        selectedCount: ops.length,
        onApply: () => apply(ops, `Tidy: removed ${what}`, `Removed ${what}`),
      });
    }

    function isInside(node, folder) {
      for (let n = node.parent; n; n = n.parent) if (n === folder) return true;
      return false;
    }

    BM.onChanged(refresh);
    refresh();
  }
})();
