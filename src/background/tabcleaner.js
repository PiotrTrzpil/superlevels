// ═══════════════════════════════════
//  Tab Cleaner — closes tabs left inactive longer than the timeout
// ═══════════════════════════════════
import { DEFAULT_TIMEOUT_MIN } from "../shared/defaults.js";
import { CLOSED_PAGE_URL, ensureClosedPage, updateClosedTabs } from "./closed-tabs.js";
import { createQueue } from "./lib.js";

const CHECK_INTERVAL_MIN = 1;

// { tabId: lastActiveTimestamp }
// Mirrored to storage.session: the MV3 service worker is killed when idle,
// and without this every restart would reset all inactivity timers.
const tabActivity = {};

function saveTabActivity() {
  chrome.storage.session.set({ tabActivity });
}

// Record activity for a tab
function markActive(tabId) {
  tabActivity[tabId] = Date.now();
  saveTabActivity();
}

// On tab activated (user switches to it)
chrome.tabs.onActivated.addListener(({ tabId }) => {
  markActive(tabId);
});

// On tab updated (page load, navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    markActive(tabId);
  }
});

// On tab created
chrome.tabs.onCreated.addListener((tab) => {
  markActive(tab.id);
});

// On tab removed, clean up
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabActivity[tabId];
  saveTabActivity();
});

// Initialize: restore timestamps from before the worker restarted. Tabs we have
// never seen (browser restart, extension install/update) fall back to Chrome's
// own lastAccessed, which survives restarts — the time Chrome was closed is then
// discounted by the gap check in settleAwayTime. Inactivity never counts from
// before the first run (install), so old tabs aren't mass-closed right away.
const tabActivityReady = (async () => {
  const [{ tabActivity: saved = {} }, { countingSince: storedSince }, tabs] = await Promise.all([
    chrome.storage.session.get(["tabActivity"]),
    chrome.storage.local.get(["countingSince"]),
    chrome.tabs.query({}),
  ]);
  const now = Date.now();
  const countingSince = storedSince ?? now;
  if (storedSince === undefined) chrome.storage.local.set({ countingSince });
  for (const tab of tabs) {
    // Events that arrived during startup are newer than the saved values
    tabActivity[tab.id] ??= saved[tab.id] ?? Math.max(tab.lastAccessed ?? 0, countingSince);
  }
  saveTabActivity();
})();

// Periodic cleanup check. Re-creating an existing alarm restarts its period,
// so only create it once — otherwise frequent worker restarts postpone it forever.
chrome.alarms.get("tabCleanup").then((alarm) => {
  if (!alarm) chrome.alarms.create("tabCleanup", { periodInMinutes: CHECK_INTERVAL_MIN });
});

// ── Time away doesn't count as tab inactivity ──
// While the user is idle or the screen is locked, timers are paused: on return
// every tab's timestamp is shifted forward by the time away. awaySince lives in
// storage.session because the worker is usually killed while the user is away;
// lastCleanupCheck lives in storage.local so time with Chrome closed is skipped too.
const IDLE_DETECTION_SEC = 60;
chrome.idle.setDetectionInterval(IDLE_DETECTION_SEC);

// Only tabs last active before the away period started are shifted; activity
// recorded during it (e.g. a tab opened right after a browser restart) is real
function shiftTabActivity(ms, awayStart) {
  for (const id of Object.keys(tabActivity)) {
    if (tabActivity[id] < awayStart) tabActivity[id] += ms;
  }
  saveTabActivity();
}

// Serialized so the idle event and the alarm can't both apply the same away period
const awayQueue = createQueue();
function withAwayState(fn) {
  return awayQueue(async () => {
    await tabActivityReady;
    const [{ awaySince = null }, { lastCleanupCheck = null }] = await Promise.all([
      chrome.storage.session.get(["awaySince"]),
      chrome.storage.local.get(["lastCleanupCheck"]),
    ]);
    await fn({ awaySince, lastCleanupCheck });
  }).catch(() => {});
}

function markAway(state) {
  return withAwayState(async ({ awaySince }) => {
    if (awaySince) return;
    // "idle" fires only after IDLE_DETECTION_SEC without input, so the user left that long ago
    const since = Date.now() - (state === "idle" ? IDLE_DETECTION_SEC * 1000 : 0);
    await chrome.storage.session.set({ awaySince: since });
  });
}

function markBack() {
  return withAwayState(async ({ awaySince }) => {
    if (!awaySince) return;
    const now = Date.now();
    shiftTabActivity(now - awaySince, awaySince);
    // The away period is now accounted for; don't let the gap check count it again
    await chrome.storage.local.set({ lastCleanupCheck: now });
    await chrome.storage.session.remove("awaySince");
  });
}

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "active") markBack();
  else markAway(state);
});

// Returns false while the user is away, i.e. when nothing should be closed
async function settleAwayTime() {
  const state = await chrome.idle.queryState(IDLE_DETECTION_SEC);
  if (state !== "active") {
    await markAway(state);
    return false;
  }
  // Back, but the "active" event may not have been delivered yet
  await markBack();
  // The machine slept without ever reporting idle (e.g. lid closed mid-use), or
  // Chrome was closed: no checks ran, so a long gap since the last one is time away
  await withAwayState(async ({ lastCleanupCheck }) => {
    const now = Date.now();
    const intervalMs = CHECK_INTERVAL_MIN * 60 * 1000;
    if (lastCleanupCheck && now - lastCleanupCheck > 2 * intervalMs) {
      shiftTabActivity(now - lastCleanupCheck - intervalMs, lastCleanupCheck);
    }
    await chrome.storage.local.set({ lastCleanupCheck: now });
  });
  return true;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "tabCleanup") return;

  if (!(await settleAwayTime())) return;

  const { exclusions = [], enabled = true, timeoutMin = DEFAULT_TIMEOUT_MIN } =
    await chrome.storage.local.get(["exclusions", "enabled", "timeoutMin"]);

  if (!enabled) return;

  const now = Date.now();
  const timeoutMs = timeoutMin * 60 * 1000;
  const tabs = await chrome.tabs.query({});

  // Never close the last tab in a window
  const windowTabCounts = {};
  for (const tab of tabs) {
    windowTabCounts[tab.windowId] = (windowTabCounts[tab.windowId] || 0) + 1;
  }

  // Find the currently active tab so we never close it
  const activeTabs = new Set();
  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    const [active] = await chrome.tabs.query({
      active: true,
      windowId: win.id,
    });
    if (active) activeTabs.add(active.id);
  }

  const closed = [];
  for (const tab of tabs) {
    // Skip active tabs
    if (activeTabs.has(tab.id)) {
      markActive(tab.id);
      continue;
    }

    // Skip pinned tabs and our own closed-tabs list
    if (tab.pinned || tab.url?.startsWith(CLOSED_PAGE_URL)) continue;

    // Skip tabs playing audio (background music, calls); the inactivity
    // timer starts once the audio stops
    if (tab.audible) {
      markActive(tab.id);
      continue;
    }

    // Skip incognito tabs: saving them would leak private URLs into the
    // persistent closed-tabs list, and closing without saving would lose them
    if (tab.incognito) continue;

    // Skip if it's the last tab in its window
    if (windowTabCounts[tab.windowId] <= 1) continue;

    // Skip excluded hosts
    if (tab.url) {
      try {
        const host = new URL(tab.url).hostname;
        if (
          exclusions.some(
            (ex) => host === ex || host.endsWith("." + ex)
          )
        ) {
          continue;
        }
      } catch {}
    }

    // Check inactivity
    const lastActive = tabActivity[tab.id] || 0;
    if (now - lastActive >= timeoutMs) {
      windowTabCounts[tab.windowId]--;
      closed.push(tab);
      chrome.tabs.remove(tab.id);
      delete tabActivity[tab.id];
    }
  }
  saveTabActivity();

  const saved = closed.filter((tab) => tab.url && !tab.url.startsWith("chrome://"));
  if (!saved.length) return;
  await updateClosedTabs((list) => [
    ...saved.map((tab) => ({
      id: crypto.randomUUID(),
      url: tab.url,
      title: tab.title || tab.url,
      time: now,
    })),
    ...list,
  ]);
  await ensureClosedPage(saved[0].windowId);
});

// Set defaults on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["enabled", "timeoutMin", "exclusions"], (data) => {
    const defaults = {};
    if (data.enabled === undefined) defaults.enabled = true;
    if (data.timeoutMin === undefined) defaults.timeoutMin = DEFAULT_TIMEOUT_MIN;
    if (data.exclusions === undefined) defaults.exclusions = [];
    if (Object.keys(defaults).length) {
      chrome.storage.local.set(defaults);
    }
  });
});
