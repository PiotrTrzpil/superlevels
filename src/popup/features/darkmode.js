// ═══════════════════════════════════
//  Dark Mode
// ═══════════════════════════════════
import { activeTab, sendToActiveTab } from "../lib/tabs.js";
import { showStatus } from "../lib/toggle.js";

const darkToggle = document.getElementById("darkToggle");
const darkStatus = document.getElementById("darkStatus");
const darkHostEl = document.getElementById("darkHost");
const darkBrightness = document.getElementById("darkBrightness");
const darkBrightnessVal = document.getElementById("darkBrightnessVal");
const scopeSite = document.getElementById("scopeSite");
const scopeGlobal = document.getElementById("scopeGlobal");

let darkHost = "";
let darkScope = "site"; // "site" or "global"

export async function loadDarkMode() {
  const tab = await activeTab();
  if (!tab || !tab.url) return;

  try { darkHost = new URL(tab.url).hostname; } catch { darkHost = ""; }
  darkHostEl.textContent = darkHost ? `Current site: ${darkHost}` : "";

  const siteKey = "darkmode_" + darkHost;
  const data = await chrome.storage.local.get([siteKey, "darkmode_global", "darkmode_brightness"]);

  const brightness = data.darkmode_brightness || 100;
  darkBrightness.value = brightness;
  darkBrightnessVal.textContent = brightness + "%";

  const siteState = data[siteKey];
  const globalState = data.darkmode_global || false;
  const enabled = siteState !== undefined ? siteState : globalState;

  darkToggle.checked = enabled;
  showStatus(darkStatus, enabled);
}

async function applyDark() {
  const enabled = darkToggle.checked;
  const brightness = parseInt(darkBrightness.value);
  showStatus(darkStatus, enabled);

  // Save preference
  if (darkScope === "global") {
    await chrome.storage.local.set({ darkmode_global: enabled });
    // "All sites" is a master switch: clear any per-site overrides so that
    // toggling it (esp. OFF) truly applies everywhere. Otherwise a leftover
    // per-site value keeps winning over global and the site stays dark.
    const all = await chrome.storage.local.get(null);
    const overrides = Object.keys(all).filter(
      (k) =>
        k.startsWith("darkmode_") &&
        k !== "darkmode_global" &&
        k !== "darkmode_brightness"
    );
    if (overrides.length) await chrome.storage.local.remove(overrides);
  } else {
    const siteKey = "darkmode_" + darkHost;
    await chrome.storage.local.set({ [siteKey]: enabled });
  }
  await chrome.storage.local.set({ darkmode_brightness: brightness });

  // Send to active tab's content script
  sendToActiveTab({ type: "darkmode_toggle", enabled, brightness });
}

darkToggle.addEventListener("change", applyDark);

darkBrightness.addEventListener("input", () => {
  darkBrightnessVal.textContent = darkBrightness.value + "%";
});
darkBrightness.addEventListener("change", applyDark);

scopeSite.addEventListener("click", () => {
  darkScope = "site";
  scopeSite.classList.add("active");
  scopeGlobal.classList.remove("active");
});
scopeGlobal.addEventListener("click", () => {
  darkScope = "global";
  scopeGlobal.classList.add("active");
  scopeSite.classList.remove("active");
});
