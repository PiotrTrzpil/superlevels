// ═══════════════════════════════════
//  No Paywall — send paywalled articles straight to archive.is
// ═══════════════════════════════════
import { onLocalChange } from "./lib.js";

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
