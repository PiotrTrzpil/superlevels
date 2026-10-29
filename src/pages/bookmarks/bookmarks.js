// ═══════════════════════════════════
//  Bookmark tools page: tabs for the views in BM_VIEWS.
//
//  Each view script registers itself before this one runs:
//    BM_VIEWS.push({ id: "triage", title: "📥 Inbox", init(container) {...} })
//  init runs the first time its tab opens. Open a tab directly with bookmarks.html#<id>.
// ═══════════════════════════════════
(async () => {
  const tabs = document.getElementById("tabs");
  const views = document.getElementById("views");
  const started = new Set();

  for (const view of BM_VIEWS) {
    tabs.append(BM.el("button", { dataset: { view: view.id }, onclick: () => show(view.id) }, view.title));
    views.append(BM.el("section", { className: "view", id: `view-${view.id}` }));
  }

  function show(id) {
    const view = BM_VIEWS.find((v) => v.id === id) ?? BM_VIEWS[0];
    for (const b of tabs.children) b.classList.toggle("active", b.dataset.view === view.id);
    for (const s of views.children) s.classList.toggle("active", s.id === `view-${view.id}`);
    history.replaceState(null, "", `#${view.id}`);
    if (!started.has(view.id)) {
      started.add(view.id);
      view.init(document.getElementById(`view-${view.id}`));
    }
  }

  const { ignored } = await BM.load();
  if (ignored.length) {
    document.getElementById("notice").textContent =
      `Only synced bookmarks are shown. Not shown: ${ignored.join(", ")} (on this device only).`;
  }
  show(location.hash.slice(1));
})();
