importScripts("bookmarkbridge.js");

const DEFAULT_TIMEOUT_MIN = 3 * 24 * 60; // 3 days
const CHECK_INTERVAL_MIN = 1;
const CLOSED_PAGE_URL = chrome.runtime.getURL("closed.html");
const MAX_CLOSED_TABS = 2000;

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
let awayChain = Promise.resolve();
function withAwayState(fn) {
  awayChain = awayChain.then(async () => {
    await tabActivityReady;
    const [{ awaySince = null }, { lastCleanupCheck = null }] = await Promise.all([
      chrome.storage.session.get(["awaySince"]),
      chrome.storage.local.get(["lastCleanupCheck"]),
    ]);
    await fn({ awaySince, lastCleanupCheck });
  }).catch(() => {});
  return awayChain;
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

// ── Closed tabs list (OneTab-style page) ──
// Serialize all read-modify-write cycles on closed_tabs, so the cleanup
// alarm and edits from the closed-tabs page can't overwrite each other
let closedTabsChain = Promise.resolve();
function updateClosedTabs(fn) {
  closedTabsChain = closedTabsChain
    .then(async () => {
      const { closed_tabs = [] } = await chrome.storage.local.get(["closed_tabs"]);
      const next = fn(closed_tabs).slice(0, MAX_CLOSED_TABS);
      await chrome.storage.local.set({ closed_tabs: next });
    })
    .catch(() => {});
  return closedTabsChain;
}

async function findClosedPage() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url?.startsWith(CLOSED_PAGE_URL));
}

// Open the closed-tabs page in the background unless it's already open
async function ensureClosedPage(windowId) {
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

// ═══════════════════════════════════
//  Redirect Tracer
// ═══════════════════════════════════
// { tabId: { chain: [{url, statusCode, statusLine}], finalUrl, finalStatus } }
// Mirrored to storage.session per tab, so the popup still gets the chain after
// the service worker was killed while idle.
const redirectData = {};
const redirectKey = (tabId) => "redirects_" + tabId;

function saveRedirects(tabId) {
  chrome.storage.session.set({ [redirectKey(tabId)]: redirectData[tabId] });
}

async function getRedirects(tabId) {
  if (redirectData[tabId]) return redirectData[tabId];
  const key = redirectKey(tabId);
  const { [key]: saved } = await chrome.storage.session.get([key]);
  return saved || { chain: [], finalUrl: null, finalStatus: null };
}

// When a new main-frame navigation starts, reset the chain
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
  saveRedirects(details.tabId);
});

// Capture each redirect hop
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    if (!redirectData[details.tabId]) {
      redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
    }
    redirectData[details.tabId].chain.push({
      url: details.url,
      statusCode: details.statusCode,
      statusLine: details.statusLine || "",
      redirectUrl: details.redirectUrl,
    });
    saveRedirects(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// Capture final completed request
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    if (!redirectData[details.tabId]) {
      redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
    }
    redirectData[details.tabId].finalUrl = details.url;
    redirectData[details.tabId].finalStatus = details.statusCode;
    saveRedirects(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete redirectData[tabId];
  chrome.storage.session.remove(redirectKey(tabId));
});

// Respond to popup requests
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "closedRemove") {
    const ids = new Set(msg.ids);
    updateClosedTabs((list) => list.filter((t) => !ids.has(t.id))).then(() => sendResponse({}));
    return true;
  }
  if (msg.type === "closedOpenPage") {
    focusClosedPage().then(() => sendResponse({}));
    return true;
  }
  if (msg.type === "getRedirects") {
    getRedirects(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg.type === "adblockSync") {
    syncAdblock().then(() => sendResponse({}));
    return true;
  }
  if (msg.type === "pip") {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      func: () => {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture();
          return { action: "exited" };
        }
        const videos = Array.from(document.querySelectorAll("video"));
        if (!videos.length) return { error: "No video found on this page" };
        const playing = videos.filter(v => !v.paused && !v.ended);
        let video;
        if (playing.length) {
          video = playing.reduce((a, b) =>
            (b.videoWidth * b.videoHeight) > (a.videoWidth * a.videoHeight) ? b : a
          );
        } else {
          video = videos.reduce((a, b) =>
            (b.videoWidth * b.videoHeight) > (a.videoWidth * a.videoHeight) ? b : a
          );
        }
        const enterPip = () => video.requestPictureInPicture()
          .then(() => ({ action: "entered" }))
          .catch(e => ({ error: e.message }));
        // requestPictureInPicture() throws if metadata isn't loaded yet
        // (readyState 0 = HAVE_NOTHING). Wait for it, then retry.
        if (video.readyState === 0) {
          return new Promise((resolve) => {
            const onReady = () => {
              cleanup();
              resolve(enterPip());
            };
            const onError = () => {
              cleanup();
              resolve({ error: "Video failed to load" });
            };
            const timer = setTimeout(() => {
              cleanup();
              resolve({ error: "Video metadata did not load in time" });
            }, 5000);
            const cleanup = () => {
              clearTimeout(timer);
              video.removeEventListener("loadedmetadata", onReady);
              video.removeEventListener("error", onError);
            };
            video.addEventListener("loadedmetadata", onReady, { once: true });
            video.addEventListener("error", onError, { once: true });
            // Nudge the browser to start loading metadata if it hasn't.
            if (video.preload === "none") video.preload = "metadata";
            video.load();
          });
        }
        return enterPip();
      },
    }).then(results => {
      sendResponse(results[0]?.result || { error: "No result" });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async sendResponse
  }
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
  // Older versions stored closed tabs without ids (and with favicon URLs)
  updateClosedTabs((list) =>
    list.map(({ favIconUrl, ...t }) => (t.id ? t : { ...t, id: crypto.randomUUID() }))
  );
});

// ═══════════════════════════════════
//  Photopea No Ads — MAIN-world script registration
//  (must run in the page world before Photopea's own scripts)
// ═══════════════════════════════════
const PHOTOPEA_SCRIPT_ID = "sl-photopea-main";

let photopeaSyncChain = Promise.resolve();
function syncPhotopeaScript() {
  // Serialize so a toggle during startup can't race the initial registration
  photopeaSyncChain = photopeaSyncChain.then(doSyncPhotopeaScript).catch(() => {});
  return photopeaSyncChain;
}

async function doSyncPhotopeaScript() {
  const { photopea_enabled } = await chrome.storage.local.get(["photopea_enabled"]);
  const enabled = photopea_enabled !== false;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PHOTOPEA_SCRIPT_ID] });
  if (enabled && existing.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: PHOTOPEA_SCRIPT_ID,
      matches: ["*://www.photopea.com/*", "*://photopea.com/*"],
      js: ["photopea-main.js"],
      runAt: "document_start",
      world: "MAIN",
    }]).catch(() => {});
  } else if (!enabled && existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [PHOTOPEA_SCRIPT_ID] }).catch(() => {});
  }
}

syncPhotopeaScript();
chrome.runtime.onInstalled.addListener(syncPhotopeaScript);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.photopea_enabled) syncPhotopeaScript();
});

// ═══════════════════════════════════
//  No Paywall — send paywalled articles straight to archive.is
// ═══════════════════════════════════
const ARCHIVE_DEFAULT_SITES = [
  "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "washingtonpost.com",
  "economist.com", "newyorker.com", "theatlantic.com", "wired.com",
  "businessinsider.com", "telegraph.co.uk", "thetimes.co.uk", "latimes.com",
  "theverge.com", "reuters.com", "fortune.com", "newscientist.com",
  "scientificamerican.com", "404media.co", "forbes.com", "technologyreview.com",
  "foreignpolicy.com", "afr.com", "smh.com.au", "theglobeandmail.com", "scmp.com",
  "chronicle.com", "ajc.com", "texasmonthly.com", "outsideonline.com", "americanbanker.com",
  "spectator.co.uk", "newstatesman.com", "irishtimes.com",
  // Netherlands / Belgium
  "nrc.nl", "volkskrant.nl", "telegraaf.nl", "parool.nl", "trouw.nl", "ad.nl", "fd.nl",
  "ftm.nl", "nd.nl", "rd.nl", "groene.nl",
  "gelderlander.nl", "bndestem.nl", "bd.nl", "ed.nl", "pzc.nl", "tubantia.nl", "destentor.nl",
  "noordhollandsdagblad.nl", "haarlemsdagblad.nl", "leidschdagblad.nl", "gooieneemlander.nl",
  "ijmuidercourant.nl", "limburger.nl", "dvhn.nl", "lc.nl",
  "standaard.be", "demorgen.be", "hln.be", "nieuwsblad.be", "gva.be", "hbvl.be", "tijd.be",
  // Germany / Austria / Switzerland
  "spiegel.de", "zeit.de", "faz.net", "sueddeutsche.de", "welt.de", "handelsblatt.com",
  "tagesspiegel.de", "derstandard.at", "diepresse.com", "nzz.ch", "tagesanzeiger.ch",
  // France / Italy / Spain
  "lemonde.fr", "lefigaro.fr", "liberation.fr", "lesechos.fr", "mediapart.fr", "lepoint.fr",
  "corriere.it", "repubblica.it", "ilsole24ore.com", "elpais.com", "elmundo.es", "lavanguardia.com",
  // Nordics
  "dn.se", "svd.se", "aftenposten.no", "hs.fi", "politiken.dk", "berlingske.dk",
];
const ARCHIVE_HOSTS = /(^|\.)archive\.(is|ph|today|li|vn|md)$/;

let archiveSettings = { enabled: true, sites: ARCHIVE_DEFAULT_SITES };
function loadArchiveSettings() {
  chrome.storage.local.get(["archive_enabled", "archive_sites"], (d) => {
    archiveSettings = {
      enabled: d.archive_enabled !== false,
      sites: Array.isArray(d.archive_sites) ? d.archive_sites : ARCHIVE_DEFAULT_SITES,
    };
  });
}
loadArchiveSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.archive_enabled || changes.archive_sites)) loadArchiveSettings();
});

// Only articles, not homepages/section fronts: the last path segment
// needs a slug (hyphen) or an .html/.shtml extension. A trailing numeric ID
// (theatlantic.com/.../slug/684123/) is skipped. Single-segment paths need
// a longer slug so fronts like /science-and-technology stay put.
function isArticlePath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
  const last = parts[parts.length - 1] || "";
  if (/\.s?html?$/.test(last)) return true;
  if (/^dmf\d/.test(last)) return true; // Mediahuis regionals: /cnt/dmf20260926_12345678
  const hyphens = (last.match(/-/g) || []).length;
  return parts.length > 1 ? hyphens > 0 : hyphens >= 3;
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0 || details.documentLifecycle === "prerender") return;
  if (!archiveSettings.enabled) return;
  let url;
  try { url = new URL(details.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  const host = url.hostname.replace(/^www\./, "");
  const match = archiveSettings.sites.some((s) => host === s || host.endsWith("." + s));
  if (!match || !isArticlePath(url.pathname)) return;

  // Coming from an archive page (e.g. clicking its "original" link)? Let it through.
  const tab = await chrome.tabs.get(details.tabId).catch(() => null);
  if (!tab) return;
  try { if (ARCHIVE_HOSTS.test(new URL(tab.url).hostname)) return; } catch {}

  // Drop tracking params/hash so the URL matches existing snapshots
  const clean = url.origin + url.pathname;
  chrome.tabs.update(details.tabId, { url: "https://archive.is/" + clean }).catch(() => {});
});

// ═══════════════════════════════════
//  Ad Block — EasyList + EasyPrivacy compiled to declarativeNetRequest
//  (adblock/build.mjs). Chrome does the network blocking itself; here we
//  only load the rules, keep the per-site pause rule, and inject the
//  element-hiding CSS for ad slots the blocked requests leave behind.
//  Optional: the lists aren't committed, and until they're built Ad Block
//  stays off. That's why they're dynamic rules rather than a static
//  ruleset — a manifest ruleset whose file is missing stops the whole
//  extension from loading.
// ═══════════════════════════════════
const ADBLOCK_CSS_ID = "sl-adblock-generic";
const ADBLOCK_PAUSE_RULE_ID = 1;
// Dynamic rule ids 1..99_999 belong to Ad Block; others are left alone
// (100_000..109_999: tracker panel)
const ADBLOCK_FIRST_LIST_RULE_ID = 2;
const ADBLOCK_LAST_LIST_RULE_ID = 99_999;

// adblock/meta.json is written last by the build; null when not built
let adblockMeta;
function getAdblockMeta() {
  adblockMeta ??= fetch(chrome.runtime.getURL("adblock/meta.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return adblockMeta;
}

let adblockCosmetic = null;
function getAdblockCosmetic() {
  adblockCosmetic ??= fetch(chrome.runtime.getURL("adblock/cosmetic.json"))
    .then((r) => r.json())
    .then((c) => ({ ...c, generichide: new Set(c.generichide), elemhide: new Set(c.elemhide) }));
  return adblockCosmetic;
}

async function getAdblockSettings() {
  const [d, meta] = await Promise.all([
    chrome.storage.local.get(["adblock_enabled", "adblock_paused"]),
    getAdblockMeta(),
  ]);
  return { enabled: d.adblock_enabled !== false && !!meta, paused: d.adblock_paused || [], meta };
}

// Dynamic rules persist across worker restarts and extension reloads, so
// they're only replaced when a different build is wanted (null: none)
async function loadAdblockRules(version) {
  const dnr = chrome.declarativeNetRequest;
  const { adblock_rules_version = null } = await chrome.storage.local.get(["adblock_rules_version"]);
  if (adblock_rules_version === version) return;
  const rules = version
    ? await fetch(chrome.runtime.getURL("adblock/rules.json")).then((r) => r.json())
    : [];
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id)
      .filter((id) => id >= ADBLOCK_FIRST_LIST_RULE_ID && id <= ADBLOCK_LAST_LIST_RULE_ID),
    addRules: rules.map((r, i) => ({ ...r, id: ADBLOCK_FIRST_LIST_RULE_ID + i })),
  });
  await chrome.storage.local.set({ adblock_rules_version: version });
}

// "a.b.example.com" → ["a.b.example.com", "b.example.com", "example.com"]
function hostChain(host) {
  const parts = host.split(".");
  return parts.slice(0, Math.max(1, parts.length - 1)).map((_, i) => parts.slice(i).join("."));
}

let adblockSyncChain = Promise.resolve();
function syncAdblock() {
  // Serialize so a toggle during startup can't race the initial sync
  adblockSyncChain = adblockSyncChain.then(doSyncAdblock).catch((e) => console.warn("adblock sync:", e));
  return adblockSyncChain;
}

async function doSyncAdblock() {
  const { enabled, paused, meta } = await getAdblockSettings();
  const dnr = chrome.declarativeNetRequest;

  await loadAdblockRules(enabled ? meta.version : null);
  // Paused sites: allow everything in pages whose top frame is on that site
  await dnr.updateDynamicRules({
    removeRuleIds: [ADBLOCK_PAUSE_RULE_ID],
    addRules: enabled && paused.length ? [{
      id: ADBLOCK_PAUSE_RULE_ID,
      priority: 100,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: paused, resourceTypes: ["main_frame"] },
    }] : [],
  });
  await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: enabled });

  // Generic hiding CSS goes on every site except paused ones and those the
  // lists exempt ($generichide) — re-register to update the exclusions
  await chrome.scripting.unregisterContentScripts({ ids: [ADBLOCK_CSS_ID] }).catch(() => {});
  if (!enabled) return;
  const cosmetic = await getAdblockCosmetic();
  const exempt = [...paused, ...cosmetic.generichide, ...cosmetic.elemhide];
  await chrome.scripting.registerContentScripts([{
    id: ADBLOCK_CSS_ID,
    matches: ["<all_urls>"],
    excludeMatches: exempt.map((h) => `*://*.${h}/*`),
    css: ["adblock/generic.css"],
    runAt: "document_start",
    allFrames: true,
  }]);
}

syncAdblock();
chrome.runtime.onInstalled.addListener(syncAdblock);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.adblock_enabled || changes.adblock_paused)) syncAdblock();
});

// Site-specific hiding rules, plus generic selectors some sites un-hide
// (so they can't live in the global stylesheet)
async function adblockCssFor(host) {
  const { enabled, paused } = await getAdblockSettings();
  if (!enabled) return "";
  const chain = hostChain(host);
  if (chain.some((h) => paused.includes(h))) return "";
  const c = await getAdblockCosmetic();
  if (chain.some((h) => c.elemhide.has(h))) return "";

  const selectors = chain.flatMap((h) => c.specific[h] || []);
  if (!chain.some((h) => c.generichide.has(h))) selectors.push(...c.excepted);
  const exceptions = new Set(chain.flatMap((h) => c.exceptions[h] || []));
  return selectors
    .filter((s) => !exceptions.has(s))
    .map((s) => `${s}{display:none!important}`)
    .join("\n");
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  if (!/^https?:/.test(url)) return;
  const css = await adblockCssFor(host);
  if (!css) return;
  chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: "USER" }).catch(() => {});
});
