// ═══════════════════════════════════
//  Per-site "allow ads and trackers": one list (adblock_paused) shared by the
//  Ad Block card and the Trackers page. The background turns it into an
//  allowAllRequests rule that outranks both Ad Block's and the Trackers
//  panel's blocks, whether Ad Block is on or not.
// ═══════════════════════════════════
import { activeTab } from "./tabs.js";

const KEY = "adblock_paused";

// The tab's site as stored ("www." dropped), or "" for non-web pages
export function siteOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : "";
  } catch { return ""; }
}

const covers = (host, entry) => host === entry || host.endsWith("." + entry);

export async function isSiteAllowed(host) {
  if (!host) return false;
  const { [KEY]: list = [] } = await chrome.storage.local.get([KEY]);
  return list.some((h) => covers(host, h));
}

// Saves the choice, waits for the background to swap the rules, then reloads
// the active tab so it applies
export async function setSiteAllowed(host, allowed) {
  if (!host) return;
  const { [KEY]: list = [] } = await chrome.storage.local.get([KEY]);
  // Disallowing also clears any parent-domain entry that covered this host
  const rest = list.filter((h) => !covers(host, h));
  await chrome.storage.local.set({ [KEY]: allowed ? [...rest, host] : rest });
  await chrome.runtime.sendMessage({ type: "adblockSync" });
  const tab = await activeTab();
  if (tab) chrome.tabs.reload(tab.id);
}
