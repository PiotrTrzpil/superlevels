// ═══════════════════════════════════
//  Trackers panel — which third parties each tab talks to, grouped by
//  tracker and company, with per-tracker / per-host blocking. Blocking whole
//  categories is left to Ad Block's lists.
//  Names and categories come from data/trackers/db.json (pnpm build:trackers),
//  which is optional: without it the panel lists bare third-party hosts.
//  Requests are only observed (webRequest can't block in MV3) and the log
//  never leaves the browser. Blocking uses dynamic rules 100000–109999;
//  Ad Block owns the ids below 100000.
// ═══════════════════════════════════
import { createQueue, onLocalChange } from "./lib.js";
import { handle } from "./messages.js";
import { TRACKER_RULES } from "./rule-ids.js";

const TRACKER_DOMAINS_PER_RULE = 1000;

let trackerDb;
function getTrackerDb() {
  trackerDb ??= fetch(chrome.runtime.getURL("data/trackers/db.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return trackerDb;
}

// Rough registrable domain without a public-suffix list: "a.b.co.uk" → "b.co.uk"
function siteOf(host) {
  const p = host.split(".");
  const n = p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join(".");
}

function trackerIdFor(db, host) {
  for (let h = host; h.includes("."); h = h.slice(h.indexOf(".") + 1)) {
    if (db.domains[h]) return db.domains[h];
  }
  return null;
}

// ── Per-tab traffic log ──
// { [tabId]: { page: host, hosts: { [host]: [requests, blocked] } } }
// Mirrored to storage.session so a service worker restart doesn't wipe it.
const tabTraffic = {};
const tabTrafficReady = chrome.storage.session.get(["tabTraffic"]).then(({ tabTraffic: saved = {} }) => {
  for (const [id, t] of Object.entries(saved)) tabTraffic[id] ??= t;
});

let tabTrafficTimer;
function saveTabTraffic() {
  clearTimeout(tabTrafficTimer);
  tabTrafficTimer = setTimeout(() => chrome.storage.session.set({ tabTraffic }), 500);
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^(https?|wss?):$/.test(u.protocol) ? u.hostname : null;
  } catch { return null; }
}

// A third-party entry for this request, or null for first-party/untracked
function trafficEntry(tabId, url) {
  const t = tabTraffic[tabId];
  const host = hostOf(url);
  if (!t || !host || siteOf(host) === siteOf(t.page)) return null;
  return (t.hosts[host] ??= [0, 0]);
}

chrome.webRequest.onBeforeRequest.addListener(({ tabId, type, url }) => {
  if (tabId < 0) return;
  if (type === "main_frame") {
    const page = hostOf(url);
    if (page) tabTraffic[tabId] = { page, hosts: {} };
    else delete tabTraffic[tabId];
  } else {
    const entry = trafficEntry(tabId, url);
    if (!entry) return;
    entry[0]++;
  }
  saveTabTraffic();
}, { urls: ["<all_urls>"] });

// Requests blocked by declarativeNetRequest (Ad Block or ours) end here
chrome.webRequest.onErrorOccurred.addListener(({ tabId, url, error }) => {
  if (tabId < 0 || error !== "net::ERR_BLOCKED_BY_CLIENT") return;
  const entry = trafficEntry(tabId, url);
  if (!entry) return;
  entry[1]++;
  saveTabTraffic();
}, { urls: ["<all_urls>"] });

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabTraffic[tabId];
  saveTabTraffic();
});

// ── Blocking ──

async function getTrackerSettings() {
  const d = await chrome.storage.local.get(["trackers_blocked", "trackers_blocked_hosts"]);
  return {
    trackers: d.trackers_blocked || [],
    hosts: d.trackers_blocked_hosts || [],
  };
}

// Serialize so quick toggles can't interleave their rule updates
const trackerQueue = createQueue();
function syncTrackerRules() {
  return trackerQueue(doSyncTrackerRules).catch((e) => console.warn("trackers sync:", e));
}

async function doSyncTrackerRules() {
  const [settings, db] = await Promise.all([getTrackerSettings(), getTrackerDb()]);
  const domains = new Set(settings.hosts);
  if (db) {
    const trackers = new Set(settings.trackers);
    for (const [domain, id] of Object.entries(db.domains)) {
      if (trackers.has(id)) domains.add(domain);
    }
  }
  const sorted = [...domains].sort();
  const addRules = [];
  for (let i = 0; i < sorted.length; i += TRACKER_DOMAINS_PER_RULE) {
    addRules.push({
      id: TRACKER_RULES.first + addRules.length,
      priority: 1, // same as Ad Block's blocks, so list exceptions and the per-site pause still win
      action: { type: "block" },
      condition: { requestDomains: sorted.slice(i, i + TRACKER_DOMAINS_PER_RULE), domainType: "thirdParty" },
    });
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id).filter((id) => id >= TRACKER_RULES.first && id <= TRACKER_RULES.last),
    addRules,
  });
}

chrome.runtime.onInstalled.addListener(syncTrackerRules);
onLocalChange(["trackers_blocked", "trackers_blocked_hosts"], syncTrackerRules);

// Older versions could block whole categories; Ad Block's lists cover that now
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove("trackers_blocked_categories"));

// ── Popup ──

async function trackersForTab(tabId) {
  await tabTrafficReady;
  const [db, settings] = await Promise.all([getTrackerDb(), getTrackerSettings()]);
  const t = tabTraffic[tabId];
  const result = { page: t?.page ?? null, source: db?.source ?? null, settings, trackers: [], others: [] };
  if (!t) return result;

  const byTracker = {};
  for (const [host, [requests, blocked]] of Object.entries(t.hosts)) {
    const id = db && trackerIdFor(db, host);
    if (!id) {
      result.others.push({ host, requests, blocked });
      continue;
    }
    const [name, category, company] = db.trackers[id];
    const entry = (byTracker[id] ??= { id, name, category, company, hosts: [], requests: 0, blocked: 0 });
    entry.hosts.push(host);
    entry.requests += requests;
    entry.blocked += blocked;
  }
  result.trackers = Object.values(byTracker).sort((a, b) => b.requests - a.requests);
  result.others.sort((a, b) => b.requests - a.requests);
  return result;
}

handle("trackersForTab", ({ tabId }) => trackersForTab(tabId));
handle("trackersSync", syncTrackerRules);
