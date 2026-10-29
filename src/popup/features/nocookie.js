// ═══════════════════════════════════
//  Cookie Consent (GDPR) Dismisser
// ═══════════════════════════════════

const nocookieToggle = document.getElementById("nocookieToggle");
const nocookieStatus = document.getElementById("nocookieStatus");

export async function loadNoCookie() {
  const data = await chrome.storage.local.get(["nocookie_enabled"]);
  const enabled = data.nocookie_enabled !== false;
  nocookieToggle.checked = enabled;
  updateNoCookieUI(enabled);
}

function updateNoCookieUI(on) {
  nocookieStatus.textContent = on ? "ON" : "OFF";
  nocookieStatus.className = "status " + (on ? "on" : "off");
}

nocookieToggle.addEventListener("change", async () => {
  const enabled = nocookieToggle.checked;
  updateNoCookieUI(enabled);
  await chrome.storage.local.set({ nocookie_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "nocookie_toggle", enabled }).catch(() => {});
  }
});
