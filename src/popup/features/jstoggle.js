// ═══════════════════════════════════
//  JavaScript Toggle
// ═══════════════════════════════════
import { activeTab } from "../lib/tabs.js";

const jsToggle = document.getElementById("jsToggle");
const jsStatus = document.getElementById("jsStatus");
const jsIndicator = document.getElementById("jsIndicator");
const jsHostLabel = document.getElementById("jsHostLabel");

let jsHost = "";

export async function loadJsToggle() {
  const tab = await activeTab();
  if (!tab || !tab.url) return;

  // Content settings only apply to web pages (not chrome://, the new tab page, etc.)
  try {
    const url = new URL(tab.url);
    jsHost = /^https?:$/.test(url.protocol) ? url.hostname : "";
  } catch { jsHost = ""; }
  jsHostLabel.textContent = jsHost || "No accessible page";

  if (!jsHost) return;

  if (!chrome.contentSettings || !chrome.contentSettings.javascript) return;
  chrome.contentSettings.javascript.get({ primaryUrl: tab.url }, (details) => {
    const enabled = details.setting === "allow";
    jsToggle.checked = enabled;
    updateJsUI(enabled);
  });
}

function updateJsUI(enabled) {
  jsStatus.textContent = enabled ? "ENABLED" : "DISABLED";
  jsStatus.className = "status " + (enabled ? "on" : "off");
  jsIndicator.className = "indicator " + (enabled ? "on" : "off");
}

jsToggle.addEventListener("change", async () => {
  if (!jsHost) {
    jsToggle.checked = !jsToggle.checked;
    return;
  }
  const enabled = jsToggle.checked;
  updateJsUI(enabled);

  if (!chrome.contentSettings || !chrome.contentSettings.javascript) return;
  const pattern = `https://${jsHost}/*`;
  chrome.contentSettings.javascript.set({
    primaryPattern: pattern,
    setting: enabled ? "allow" : "block",
  });
  // Also set for http
  chrome.contentSettings.javascript.set({
    primaryPattern: `http://${jsHost}/*`,
    setting: enabled ? "allow" : "block",
  });

  // Reload the tab so the change takes effect
  const tab = await activeTab();
  if (tab) chrome.tabs.reload(tab.id);
});
