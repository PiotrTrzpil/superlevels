// ═══════════════════════════════════
//  No Paywall — send paywalled articles straight to archive.is
// ═══════════════════════════════════
import { ARCHIVE_DEFAULT_SITES } from "../shared/defaults.js";
import { onLocalChange } from "./lib.js";

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
onLocalChange(["archive_enabled", "archive_sites"], loadArchiveSettings);

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
