// ═══════════════════════════════════
//  Trackers
// ═══════════════════════════════════
import { activeTab } from "../lib/tabs.js";

const TRACKER_CATEGORIES = {
  advertising: "Advertising", site_analytics: "Analytics", social_media: "Social media",
  customer_interaction: "Chat & support widgets", pornvertising: "Adult advertising",
  mobile_analytics: "Mobile analytics", telemetry: "Telemetry", consent: "Consent managers",
  audio_video_player: "Video players", comments: "Comments", essential: "Essential",
  cdn: "CDNs", hosting: "Hosting", email: "Email", extensions: "Extensions",
  misc: "Misc", unknown: "Unknown",
};
// Offered as "block everywhere" switches. The rest (CDNs, video players,
// essential, hosting…) break too many sites to block wholesale.
const TRACKER_BLOCKABLE = ["advertising", "site_analytics", "social_media", "customer_interaction", "pornvertising", "mobile_analytics", "telemetry"];
// Storage key for each kind of block switch
const TRACKER_KEYS = { tracker: "trackers_blocked", category: "trackers_blocked_categories", host: "trackers_blocked_hosts" };

const trkSummary = document.getElementById("trkSummary");
const trkHostEl = document.getElementById("trkHost");
const trkList = document.getElementById("trkList");
const trkCategories = document.getElementById("trkCategories");
const trkNote = document.getElementById("trkNote");
const trkReload = document.getElementById("trkReload");

let trkTabId = null;

export async function loadTrackers() {
  const tab = await activeTab();
  trkTabId = tab?.id ?? null;
  const data = trkTabId === null ? null : await chrome.runtime.sendMessage({ type: "trackersForTab", tabId: trkTabId });
  renderTrackers(data);
}

function trkEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// A row's block switch: checked = blocked by you. kind/value pick the storage list.
function trkSwitch(kind, value, checked, { disabled = false, title = "" } = {}) {
  const label = trkEl("label", "switch");
  const input = trkEl("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  label.title = title || (checked ? "Blocked everywhere — click to allow" : "Block everywhere");
  input.addEventListener("change", async () => {
    const key = TRACKER_KEYS[kind];
    const { [key]: list = [] } = await chrome.storage.local.get([key]);
    const rest = list.filter((v) => v !== value);
    await chrome.storage.local.set({ [key]: input.checked ? [...rest, value] : rest });
    await chrome.runtime.sendMessage({ type: "trackersSync" });
    loadTrackers();
  });
  label.append(input, trkEl("span", "slider"));
  return label;
}

function trkChip(requests, blocked) {
  if (blocked && blocked >= requests) return trkEl("span", "trk-chip blocked", "blocked");
  if (blocked) return trkEl("span", "trk-chip partly", `${blocked}/${requests} blocked`);
  return trkEl("span", "trk-chip", "loaded");
}

function renderTrackers(data) {
  trkList.replaceChildren();
  trkCategories.replaceChildren();
  const settings = data?.settings ?? { trackers: [], categories: [], hosts: [] };

  if (!data?.page) {
    trkSummary.textContent = "Trackers";
    trkHostEl.textContent = "";
    trkList.append(trkEl("div", "trk-empty", "No data for this tab yet. Reload the page to see its trackers."));
  } else {
    const blocked = [...data.trackers, ...data.others].filter((t) => t.blocked).length;
    const total = data.trackers.length + data.others.length;
    trkSummary.textContent = `${total} third ${total === 1 ? "party" : "parties"} · ${blocked} blocked`;
    trkHostEl.textContent = `On ${data.page}`;
    if (!total) trkList.append(trkEl("div", "trk-empty", "No third-party requests on this page."));

    // Known trackers, grouped by category (blockable categories first)
    const order = Object.keys(TRACKER_CATEGORIES);
    const groups = Object.groupBy(data.trackers, (t) => t.category);
    for (const category of Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      trkList.append(trkEl("div", "trk-group", TRACKER_CATEGORIES[category] ?? category));
      const byCategory = settings.categories.includes(category);
      for (const t of groups[category]) {
        const row = trkEl("div", "trk-row");
        const name = trkEl("span", "trk-name", t.name);
        name.title = t.hosts.join("\n");
        if (t.company && t.company !== t.name) name.append(trkEl("span", "trk-company", t.company));
        row.append(name, trkEl("span", "trk-count", t.requests), trkChip(t.requests, t.blocked),
          trkSwitch("tracker", t.id, byCategory || settings.trackers.includes(t.id),
            byCategory ? { disabled: true, title: "Blocked with its whole category below" } : {}));
        trkList.append(row);
      }
    }

    if (data.others.length) {
      trkList.append(trkEl("div", "trk-group", data.trackers.length ? "Other third parties" : "Third parties"));
      for (const o of data.others) {
        const row = trkEl("div", "trk-row");
        row.append(trkEl("span", "trk-name", o.host), trkEl("span", "trk-count", o.requests),
          trkChip(o.requests, o.blocked), trkSwitch("host", o.host, settings.hosts.includes(o.host)));
        trkList.append(row);
      }
    }
  }

  for (const category of TRACKER_BLOCKABLE) {
    const row = trkEl("div", "trk-row");
    row.append(trkEl("span", "trk-name", TRACKER_CATEGORIES[category]),
      trkSwitch("category", category, settings.categories.includes(category), { disabled: !data?.source }));
    trkCategories.append(row);
  }

  trkNote.replaceChildren();
  if (data?.source) {
    const link = (text, href) => Object.assign(trkEl("a", "", text), { href, target: "_blank", className: "trk-link" });
    trkNote.append("Tracker data: ", link("WhoTracks.Me", "https://whotracks.me"), " via ",
      link("AdGuard companiesdb", "https://github.com/AdguardTeam/companiesdb"), " (CC BY-SA 4.0). Blocks apply after a reload.");
  } else {
    trkNote.textContent = "Names and categories need the tracker database (optional): run pnpm build:trackers in the extension folder, then reload the extension. Blocks apply after a reload.";
  }
}

trkReload.addEventListener("click", () => {
  if (trkTabId !== null) chrome.tabs.reload(trkTabId);
});

// Refresh the list once the reloaded page has finished loading
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === trkTabId && info.status === "complete" && document.getElementById("page-trackers").classList.contains("active")) {
    loadTrackers();
  }
});
