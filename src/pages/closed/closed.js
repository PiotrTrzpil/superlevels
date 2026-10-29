// OneTab-style list of tabs closed by the Tab Cleaner.
// Clicking a tab restores it (in the background) and removes it from the list.
const groupsEl = document.getElementById("groups");
const totalEl = document.getElementById("total");
const filterEl = document.getElementById("filter");

let closedTabs = [];

function removeTabs(ids) {
  return chrome.runtime.sendMessage({ type: "closedRemove", ids });
}

async function restoreTabs(tabs) {
  for (const t of tabs) {
    await chrome.tabs.create({ url: t.url, active: false });
  }
  await removeTabs(tabs.map((t) => t.id));
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
  const remove = el("button", { className: "remove", textContent: "×", title: "Delete" });
  remove.addEventListener("click", () => removeTabs([t.id]));
  return el("div", { className: "item" }, [
    el("img", { src: faviconUrl(t.url) }),
    link,
    el("span", { className: "host", textContent: hostOf(t.url) }),
    el("span", {
      className: "time",
      textContent: new Date(t.time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    }),
    remove,
  ]);
}

function renderGroup(label, tabs) {
  const restoreAll = el("button", { className: "link", textContent: "Restore all" });
  restoreAll.addEventListener("click", () => restoreTabs(tabs));
  const deleteAll = el("button", { className: "link", textContent: "Delete all" });
  deleteAll.addEventListener("click", () => removeTabs(tabs.map((t) => t.id)));
  return el("div", { className: "group" }, [
    el("div", { className: "group-header" }, [
      el("h2", { textContent: label }),
      el("span", { className: "count", textContent: `${tabs.length} tab${tabs.length === 1 ? "" : "s"}` }),
      restoreAll,
      deleteAll,
    ]),
    ...tabs.map(renderItem),
  ]);
}

function render() {
  const query = filterEl.value.trim().toLowerCase();
  const tabs = query
    ? closedTabs.filter((t) => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
    : closedTabs;

  totalEl.textContent = `${closedTabs.length} tab${closedTabs.length === 1 ? "" : "s"}`;

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
