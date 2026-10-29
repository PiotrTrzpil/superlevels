// ═══════════════════════════════════
//  Tab Cleaner
// ═══════════════════════════════════
import { DEFAULT_TIMEOUT_MIN } from "../../shared/defaults.js";
import { esc, escA } from "../lib/dom.js";

const enabledEl = document.getElementById("enabled");
const timeoutEl = document.getElementById("timeout");
const timeoutUnitEl = document.getElementById("timeoutUnit");
const MAX_TIMEOUT_MIN = 365 * 24 * 60;

// Show the timeout in the largest unit that divides it evenly
function renderTimeout(minutes) {
  const unit = [1440, 60, 1].find((u) => minutes % u === 0);
  timeoutUnitEl.value = unit;
  timeoutEl.value = minutes / unit;
}
const hostInput = document.getElementById("hostInput");
const addBtn = document.getElementById("addBtn");
const listEl = document.getElementById("list");

const closeGroupedEl = document.getElementById("closeGrouped");

chrome.storage.local.get(["enabled", "timeoutMin", "exclusions", "closeGrouped"], (data) => {
  enabledEl.checked = data.enabled !== false;
  closeGroupedEl.checked = data.closeGrouped === true;
  renderTimeout(data.timeoutMin || DEFAULT_TIMEOUT_MIN);
  renderExclusionList(data.exclusions || []);
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

closeGroupedEl.addEventListener("change", () => {
  chrome.storage.local.set({ closeGrouped: closeGroupedEl.checked });
});

function saveTimeout() {
  const unit = parseInt(timeoutUnitEl.value);
  const amount = Math.max(1, parseInt(timeoutEl.value) || 1);
  const minutes = Math.min(MAX_TIMEOUT_MIN, amount * unit);
  renderTimeout(minutes);
  chrome.storage.local.set({ timeoutMin: minutes });
}

timeoutEl.addEventListener("change", saveTimeout);
timeoutUnitEl.addEventListener("change", saveTimeout);

function addHost() {
  let host = hostInput.value.trim().toLowerCase();
  if (!host) return;
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  chrome.storage.local.get(["exclusions"], (data) => {
    const exclusions = data.exclusions || [];
    if (exclusions.includes(host)) { hostInput.value = ""; return; }
    exclusions.push(host);
    chrome.storage.local.set({ exclusions }, () => {
      hostInput.value = "";
      renderExclusionList(exclusions);
    });
  });
}

addBtn.addEventListener("click", addHost);
hostInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addHost(); });

function removeHost(host) {
  chrome.storage.local.get(["exclusions"], (data) => {
    const exclusions = (data.exclusions || []).filter((h) => h !== host);
    chrome.storage.local.set({ exclusions }, () => renderExclusionList(exclusions));
  });
}

function renderExclusionList(exclusions) {
  if (!exclusions.length) {
    listEl.innerHTML = '<div class="empty">No exclusions — all tabs can be closed</div>';
    return;
  }
  listEl.innerHTML = exclusions
    .map((h) => `<div class="item"><span>${esc(h)}</span><button data-host="${escA(h)}">&times;</button></div>`)
    .join("");
  listEl.querySelectorAll("button[data-host]").forEach((btn) => {
    btn.addEventListener("click", () => removeHost(btn.dataset.host));
  });
}

// ── Closed Tabs list ──
const openClosedBtn = document.getElementById("openClosed");

chrome.storage.local.get(["closed_tabs"], (data) => {
  const count = (data.closed_tabs || []).length;
  if (count) openClosedBtn.textContent += ` (${count})`;
});

openClosedBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "closedOpenPage" });
  window.close();
});
