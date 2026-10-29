// ═══════════════════════════════════
//  Popup entry point: navigation between pages, plus the feature modules,
//  each of which wires up its own controls when imported
// ═══════════════════════════════════
import "./features/tabcleaner.js";
import { loadAdblock } from "./features/adblock.js";
import { loadArchive } from "./features/archive.js";
import { loadBookmarkBridge } from "./features/bookmarks.js";
import { loadCookies } from "./features/cookies.js";
import { loadDarkMode } from "./features/darkmode.js";
import { loadJsonFormat } from "./features/jsonformat.js";
import { loadJsToggle } from "./features/jstoggle.js";
import { loadLiveCSS } from "./features/livecss.js";
import { loadAcrFields, loadMusicHistory } from "./features/music.js";
import { loadNoCookie } from "./features/nocookie.js";
import { loadPhotopea } from "./features/photopea.js";
import { enterPiP } from "./features/pip.js";
import { loadRedirects } from "./features/redirects.js";
import { loadSummarize } from "./features/summarize.js";
import { loadTrackers } from "./features/trackers.js";
import { loadUnhook } from "./features/unhook.js";
import { loadXDim } from "./features/xdim.js";
import { loadXReply } from "./features/xreply.js";
import { loadXUnhook } from "./features/xunhook.js";
import { activeTab } from "./lib/tabs.js";

// ── Navigation ──
document.getElementById("navVersion").textContent = `v${chrome.runtime.getManifest().version}`;

function switchToPage(page) {
  const btn = document.querySelector(`.subnav button[data-page="${page}"]`);
  if (!btn) return;
  const subnav = btn.closest(".subnav");
  // Other subnavs keep their active button, so a group reopens on its last page
  document.querySelectorAll(".nav button, .subnav, .page").forEach((el) => el.classList.remove("active"));
  subnav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.nav button[data-group="${subnav.dataset.group}"]`).classList.add("active");
  subnav.classList.add("active");
  btn.classList.add("active");
  document.getElementById("page-" + page).classList.add("active");
  // Defer the data-loading work so the page swap paints first
  const load = () => PAGE_LOADERS[page]?.forEach((fn) => fn());
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(load);
  else setTimeout(load, 0);
  chrome.storage.local.set({ last_tab: page });
}

// Called when a page is shown
const PAGE_LOADERS = {
  cookies: [loadCookies],
  redirects: [loadRedirects],
  darkmode: [loadDarkMode],
  livecss: [loadLiveCSS],
  sites: [loadXDim, loadXUnhook, loadXReply, loadUnhook, loadPhotopea],
  blocking: [loadAdblock, loadNoCookie, loadArchive],
  trackers: [loadTrackers],
  toggles: [loadJsToggle, loadJsonFormat],
  bookmarks: [loadBookmarkBridge],
  summarize: [loadSummarize],
  music: [loadMusicHistory, loadAcrFields],
};

document.querySelectorAll(".nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const subnav = document.querySelector(`.subnav[data-group="${btn.dataset.group}"]`);
    const page = subnav.querySelector("button.active") ?? subnav.querySelector("button");
    switchToPage(page.dataset.page);
  });
});

document.querySelectorAll(".subnav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchToPage(btn.dataset.page);
    // Clicking the PiP tab toggles PiP right away (needs the user gesture,
    // so only on a real click — not when restoring last_tab)
    if (btn.dataset.page === "pip") enterPiP();
  });
});

// Feature rows: clicking the row (not its switch) shows its details;
// which rows are open is remembered across popup opens. A page's only
// feature (.static) stays open.
const feats = document.querySelectorAll(".feat:not(.static)");
feats.forEach((feat) => {
  feat.querySelector(".feat-head").addEventListener("click", (e) => {
    if (e.target.closest(".switch")) return;
    feat.classList.toggle("open");
    const open = [...feats].filter((f) => f.classList.contains("open")).map((f) => f.dataset.feat);
    chrome.storage.local.set({ open_feats: open });
  });
});
chrome.storage.local.get(["open_feats"], ({ open_feats = [] }) => {
  feats.forEach((f) => f.classList.toggle("open", open_feats.includes(f.dataset.feat)));
});

// Sites whose fixes live on the Sites page; the popup opens there on them
const SITE_HOSTS = /(^|\.)(x\.com|twitter\.com|youtube\.com|photopea\.com)$/;

function isFixedSite(url) {
  try { return SITE_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

// Open on the Sites page on a fixed site, else the last open tab — deferred
// so the default page paints first
requestAnimationFrame(async () => {
  const [tab, data] = await Promise.all([
    activeTab(),
    chrome.storage.local.get(["last_tab"]),
  ]);
  if (isFixedSite(tab?.url)) switchToPage("sites");
  else if (data.last_tab) switchToPage(data.last_tab);
});
