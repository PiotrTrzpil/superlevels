// ═══════════════════════════════════
//  Bookmark tools — 🪦 Dead links
//
//  Checks every web bookmark from this page while it is open (no background work)
//  and lists the ones that are really gone, so they can be removed in one undoable
//  batch. A bookmark only counts as dead after failing on two scans at least 20 h
//  apart; anything ambiguous (login walls, 403, 5xx, timeouts) is left to the user.
//
//  Storage: deadlinks_checks    {url: {firstDeadAt, lastDeadAt, lastStatus, lastCheckedAt}}
//           deadlinks_last_scan {at, total, checked, stopped, skipped, results: {url: {kind, status}}}
// ═══════════════════════════════════
const DeadLinks = (() => {
  const CHECKS_KEY = "deadlinks_checks";
  const LAST_SCAN_KEY = "deadlinks_last_scan";
  const CONFIRM_AFTER = 20 * 3600 * 1000;
  const CONCURRENCY = 8;
  const PER_HOST = 2;
  const HEAD_FALLBACK = new Set([403, 405, 501]);
  const LOGIN_PATH = /login|log-in|signin|sign-in|sso|auth|consent/i;

  // The clock and the per-request timeout; tests override them.
  const settings = { now: () => Date.now(), timeoutMs: 15000 };

  const SECTIONS = [
    { kind: "dead", title: "Dead", hint: "failed on two scans at least 20 hours apart" },
    { kind: "probable", title: "Probably dead", hint: "scan again tomorrow to confirm" },
    { kind: "check", title: "Check yourself", hint: "blocked, erroring or behind a login" },
  ];

  // ═══ Which URLs to check ═══

  /** Why a URL isn't checked: "web" (not http(s)), "local" (private host), or "". */
  function skipReason(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return "web";
    }
    if (!/^https?:$/.test(parsed.protocol)) return "web";
    return isPrivateHost(parsed.hostname) ? "local" : "";
  }

  /** Hosts only reachable on some networks: loopback, private ranges, local names. */
  function isPrivateHost(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[")) return /^\[(::1?\]|f[cd]|fe80)/.test(host); // loopback, ULA, link-local
    const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
    if (ip) {
      const [a, b] = [Number(ip[1]), Number(ip[2])];
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    return !host.includes(".") || /\.(local|internal|lan|localhost|home\.arpa)$/.test(host);
  }

  // ═══ Checking one URL ═══

  /** One request: {status, finalUrl} or {error: "network" | "timeout"}. Throws when stopped. */
  async function request(url, method, stop) {
    const signal = AbortSignal.any([stop, AbortSignal.timeout(settings.timeoutMs)]);
    try {
      const res = await fetch(url, { method, credentials: "omit", cache: "no-store", redirect: "follow", signal });
      res.body?.cancel().catch(() => {}); // the status is all we need
      return { status: res.status, finalUrl: res.url || url };
    } catch (e) {
      if (stop.aborted) throw e;
      return { error: e?.name === "TimeoutError" ? "timeout" : "network" };
    }
  }

  /** HEAD first; GET when HEAD is refused or fails, since many servers mishandle HEAD. */
  async function check(url, stop) {
    const head = await request(url, "HEAD", stop);
    if (head.error === "network" || HEAD_FALLBACK.has(head.status)) return classify(url, await request(url, "GET", stop));
    return classify(url, head);
  }

  /** {kind: "dead" | "check" | "ok", status: "404" | "unreachable" | "timeout" | "→ login" | ...} */
  function classify(url, r) {
    if (r.error === "network") return { kind: "dead", status: "unreachable" };
    if (r.error === "timeout") return { kind: "check", status: "timeout" };
    const status = String(r.status);
    if (r.status === 404 || r.status === 410) return { kind: "dead", status };
    if ([401, 403, 429].includes(r.status) || r.status >= 500) return { kind: "check", status };
    if (isLoginRedirect(url, r.finalUrl)) return { kind: "check", status: "→ login" };
    return { kind: "ok", status };
  }

  /** A redirect to another site whose address looks like a sign-in or consent page. */
  function isLoginRedirect(url, finalUrl) {
    if (!finalUrl || BM.site(finalUrl) === BM.site(url)) return false;
    const { hostname, pathname } = new URL(finalUrl);
    return LOGIN_PATH.test(hostname + pathname);
  }

  /** Run `fn` on every item, at most `limit` at once and `perKey` per key, until stopped. */
  async function pool(items, keyOf, fn, { limit, perKey, stop }) {
    const pending = [...items];
    const active = new Map();
    const running = new Set();
    for (;;) {
      while (!stop.aborted && running.size < limit) {
        const i = pending.findIndex((item) => (active.get(keyOf(item)) ?? 0) < perKey);
        if (i === -1) break;
        const [item] = pending.splice(i, 1);
        const key = keyOf(item);
        active.set(key, (active.get(key) ?? 0) + 1);
        const run = fn(item).finally(() => {
          active.set(key, active.get(key) - 1);
          running.delete(run);
        });
        running.add(run);
      }
      if (!running.size) return;
      await Promise.race(running);
    }
  }

  // ═══ Scan: check, update history, store results ═══

  /**
   * Check every web bookmark, once per URL; `onProgress(done, total)` as it goes.
   * Stopping (via the `stop` signal) keeps what was checked so far.
   * Returns the stored last scan.
   */
  async function scan(stop, onProgress = () => {}) {
    const model = await BM.load();
    const all = Object.values(model.roots).flatMap((root) => BM.bookmarksUnder(root));
    const skipped = { web: 0, local: 0 };
    const urls = new Set();
    for (const b of all) {
      const reason = skipReason(b.url);
      if (reason) skipped[reason]++;
      else urls.add(b.url);
    }
    const verdicts = new Map();
    onProgress(0, urls.size);
    await pool([...urls], (url) => new URL(url).host, async (url) => {
      try {
        verdicts.set(url, await check(url, stop));
        onProgress(verdicts.size, urls.size);
      } catch {
        // stopped mid-request
      }
    }, { limit: CONCURRENCY, perKey: PER_HOST, stop });

    const results = await recordChecks(verdicts, new Set(all.map((b) => b.url)));
    const last = { at: settings.now(), total: urls.size, checked: verdicts.size, stopped: stop.aborted, skipped, results };
    await chrome.storage.local.set({ [LAST_SCAN_KEY]: last });
    return last;
  }

  /**
   * Update the per-URL history with this scan's verdicts (a success clears it, a dead
   * candidate starts or extends it, anything else leaves it) and drop entries for URLs
   * no longer bookmarked. Returns {url: {kind, status}} for the URLs worth listing.
   */
  async function recordChecks(verdicts, bookmarked) {
    const checks = (await chrome.storage.local.get([CHECKS_KEY]))[CHECKS_KEY] ?? {};
    const now = settings.now();
    const results = {};
    for (const [url, { kind, status }] of verdicts) {
      if (kind === "ok") {
        delete checks[url];
      } else if (kind === "dead") {
        const firstDeadAt = checks[url]?.firstDeadAt ?? now;
        checks[url] = { firstDeadAt, lastDeadAt: now, lastStatus: status, lastCheckedAt: now };
        results[url] = { kind: now - firstDeadAt >= CONFIRM_AFTER ? "dead" : "probable", status };
      } else {
        if (checks[url]) checks[url].lastCheckedAt = now;
        results[url] = { kind, status };
      }
    }
    for (const url of Object.keys(checks)) if (!bookmarked.has(url)) delete checks[url];
    await chrome.storage.local.set({ [CHECKS_KEY]: checks });
    return results;
  }

  // ═══ View ═══

  function init(container) {
    const { el } = BM;
    let last = null; // the stored last scan
    let model = null;
    let stopper = null; // AbortController while scanning
    const selected = new Set(); // bookmark ids

    const scanBtn = el("button", { className: "btn primary", onclick: startScan }, "Scan");
    const stopBtn = el("button", { className: "btn", hidden: true, onclick: () => stopper?.abort() }, "Stop");
    const progress = el("span", { className: "dl-progress" });
    const removeBtn = el("button", { className: "btn", disabled: true, onclick: removeSelected }, "Remove selected");
    const summary = el("div", { className: "dl-summary" });
    const statusLine = el("div", { className: "status-line" });
    const list = el("div", { className: "dl-results" });
    container.append(
      el("div", { className: "toolbar" }, scanBtn, stopBtn, progress, el("span", { className: "grow" }), removeBtn),
      summary, statusLine, list,
    );

    async function startScan() {
      stopper = new AbortController();
      scanBtn.disabled = true;
      stopBtn.hidden = false;
      statusLine.textContent = "";
      try {
        last = await scan(stopper.signal, (done, total) => { progress.textContent = `Checking ${done} / ${total}…`; });
        model = await BM.load();
        selected.clear();
        for (const b of rows("dead")) selected.add(b.id);
      } catch (e) {
        statusLine.textContent = `Scan failed: ${e.message}`;
      } finally {
        stopper = null;
        scanBtn.disabled = false;
        stopBtn.hidden = true;
        progress.textContent = "";
        render();
      }
    }

    async function removeSelected() {
      const ids = [...selected];
      if (!ids.length) return;
      removeBtn.disabled = true;
      try {
        await BM.applyBatch(ids.map((id) => ({ op: "remove", id })), `Dead links: removed ${ids.length}`);
        statusLine.textContent = `Removed ${ids.length}. Undo from the popup's 🔖 Bookmarks page.`;
      } catch (e) {
        statusLine.textContent = `Couldn't remove everything: ${e.message}`;
      }
      await refresh();
    }

    /** Bookmarks now in the tree whose URL got verdict `kind` in the last scan. */
    function rows(kind) {
      if (!last || !model) return [];
      return Object.values(model.roots)
        .flatMap((root) => BM.bookmarksUnder(root))
        .filter((b) => last.results[b.url]?.kind === kind);
    }

    async function refresh() {
      model = await BM.load();
      for (const id of selected) if (!model.byId.has(id)) selected.delete(id);
      render();
    }

    function render() {
      summary.textContent = last
        ? describeScan(last)
        : "Not scanned yet. Keep this tab open while a scan runs; nothing is checked in the background.";
      const sections = last ? SECTIONS.map((s) => renderSection(s, rows(s.kind))).filter(Boolean) : [];
      if (last && !sections.length) sections.push(el("div", { className: "empty" }, "No dead links found."));
      list.replaceChildren(...sections);
      updateRemoveButton();
    }

    function updateRemoveButton() {
      removeBtn.disabled = !selected.size;
      removeBtn.classList.toggle("primary", selected.size > 0);
      removeBtn.textContent = selected.size ? `Remove selected (${selected.size})` : "Remove selected";
    }

    function renderSection({ kind, title, hint }, bookmarks) {
      if (!bookmarks.length) return null;
      const setAll = (on) => {
        for (const b of bookmarks) on ? selected.add(b.id) : selected.delete(b.id);
        render();
      };
      return el("div", { className: `group dl-section dl-${kind}`, dataset: { kind } },
        el("div", { className: "group-header" },
          el("h2", {}, title),
          el("span", { className: "count" }, `${bookmarks.length} · ${hint}`),
          el("button", { className: "link", onclick: () => setAll(true) }, "Select all"),
          el("button", { className: "link", onclick: () => setAll(false) }, "None"),
        ),
        [...Map.groupBy(bookmarks, (b) => BM.path(b))].map(([folder, items]) => el("div", { className: "dl-folder" },
          el("div", { className: "dl-folder-path" }, folder),
          items.map(renderRow),
        )),
      );
    }

    function renderRow(b) {
      const box = el("input", {
        type: "checkbox",
        checked: selected.has(b.id),
        onchange: () => {
          if (box.checked) selected.add(b.id);
          else selected.delete(b.id);
          updateRemoveButton();
        },
      });
      const label = b.title || b.url;
      return el("label", { className: "row", dataset: { id: b.id } },
        box,
        el("img", { className: "fav", src: BM.favicon(b.url), alt: "" }),
        el("div", { className: "title" },
          el("a", { href: b.url, target: "_blank", rel: "noreferrer", title: label }, label),
          el("div", { className: "sub" }, b.url),
        ),
        el("span", { className: "dl-status" }, last.results[b.url].status),
        el("a", { className: "dl-open", href: b.url, target: "_blank", rel: "noreferrer" }, "Open ↗"),
      );
    }

    BM.onChanged(() => { if (!stopper) refresh(); });
    (async () => {
      last = (await chrome.storage.local.get([LAST_SCAN_KEY]))[LAST_SCAN_KEY] ?? null;
      model = await BM.load();
      if (last) for (const b of rows("dead")) selected.add(b.id);
      render();
    })();
  }

  function describeScan(scan) {
    const parts = [`Scanned ${ago(settings.now() - scan.at)}`];
    parts.push(scan.stopped ? `stopped after ${scan.checked} of ${scan.total}` : `${scan.checked} checked`);
    const { web, local } = scan.skipped;
    if (web + local) {
      const why = [web && `${web} not web pages`, local && `${local} on local networks`].filter(Boolean);
      parts.push(`${web + local} skipped (${why.join(", ")})`);
    }
    return parts.join(" · ");
  }

  function ago(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }

  return { settings, skipReason, classify, scan, init };
})();

BM_VIEWS.push({ id: "deadlinks", title: "🪦 Dead links", init: DeadLinks.init });
