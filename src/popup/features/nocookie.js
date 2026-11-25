// ═══════════════════════════════════
//  Cookie banners: hide the dialog and click Reject, never Accept
// ═══════════════════════════════════
import { activeTab, sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";
import { siteOf } from "../lib/site-allow.js";

const KEY = "nocookie_allowed_sites";
const allowToggle = document.getElementById("nocookieAllowSite");
const allowRow = document.getElementById("nocookieAllowRow");

let site = "";
const covers = (entry) => site === entry || site.endsWith("." + entry);

async function allowedHere() {
  const { [KEY]: list = [] } = await chrome.storage.local.get([KEY]);
  return !!site && list.some(covers);
}

// The page's script runs only when the feature is on and this site isn't allowed
async function tellPage() {
  const { nocookie_enabled } = await chrome.storage.local.get(["nocookie_enabled"]);
  sendToActiveTab({ type: "nocookie_toggle", enabled: nocookie_enabled !== false && !(await allowedHere()) });
}

const loadToggle = featureToggle({
  key: "nocookie_enabled",
  toggle: document.getElementById("nocookieToggle"),
  status: document.getElementById("nocookieStatus"),
  onChange: tellPage,
});

export async function loadNoCookie() {
  site = siteOf((await activeTab())?.url);
  allowRow.hidden = !site;
  allowToggle.checked = await allowedHere();
  return loadToggle();
}

allowToggle.addEventListener("change", async () => {
  if (!site) return;
  const { [KEY]: list = [] } = await chrome.storage.local.get([KEY]);
  // Disallowing also clears any parent-domain entry that covered this site
  const rest = list.filter((h) => !covers(h));
  await chrome.storage.local.set({ [KEY]: allowToggle.checked ? [...rest, site] : rest });
  await tellPage();
});
