// ═══════════════════════════════════
//  Closed tabs list (OneTab-style page) — where the Tab Cleaner saves the
//  tabs it closes
// ═══════════════════════════════════
import { createQueue } from "./lib.js";
import { handle } from "./messages.js";

export const CLOSED_PAGE_URL = chrome.runtime.getURL("src/pages/closed/closed.html");
const MAX_CLOSED_TABS = 2000;

// Serialize all read-modify-write cycles on closed_tabs, so the cleanup
// alarm and edits from the closed-tabs page can't overwrite each other
const closedTabsQueue = createQueue();
export function updateClosedTabs(fn) {
  return closedTabsQueue(async () => {
    const { closed_tabs = [] } = await chrome.storage.local.get(["closed_tabs"]);
    const next = fn(closed_tabs).slice(0, MAX_CLOSED_TABS);
    await chrome.storage.local.set({ closed_tabs: next });
  }).catch(() => {});
}

async function findClosedPage() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url?.startsWith(CLOSED_PAGE_URL));
}

// Open the closed-tabs page in the background unless it's already open
export async function ensureClosedPage(windowId) {
  if (await findClosedPage()) return;
  await chrome.tabs.create({ url: CLOSED_PAGE_URL, windowId, index: 0, active: false }).catch(() => {});
}

// Bring the closed-tabs page to front, opening it if needed
async function focusClosedPage() {
  const existing = await findClosedPage();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: CLOSED_PAGE_URL });
  }
}

handle("closedRemove", ({ ids }) => {
  const remove = new Set(ids);
  return updateClosedTabs((list) => list.filter((t) => !remove.has(t.id)));
});
handle("closedOpenPage", focusClosedPage);

// Older versions stored closed tabs without ids (and with favicon URLs)
chrome.runtime.onInstalled.addListener(() => {
  updateClosedTabs((list) =>
    list.map(({ favIconUrl, ...t }) => (t.id ? t : { ...t, id: crypto.randomUUID() }))
  );
});
