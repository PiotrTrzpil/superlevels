// ═══════════════════════════════════
//  X Unhook
// ═══════════════════════════════════

const xunhookToggle = document.getElementById("xunhookToggle");
const xunhookStatus = document.getElementById("xunhookStatus");

export async function loadXUnhook() {
  const data = await chrome.storage.local.get(["xunhook_enabled"]);
  const enabled = data.xunhook_enabled !== false;
  xunhookToggle.checked = enabled;
  updateXUnhookUI(enabled);
}

function updateXUnhookUI(on) {
  xunhookStatus.textContent = on ? "ON" : "OFF";
  xunhookStatus.className = "status " + (on ? "on" : "off");
}

xunhookToggle.addEventListener("change", async () => {
  const enabled = xunhookToggle.checked;
  updateXUnhookUI(enabled);
  await chrome.storage.local.set({ xunhook_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "xunhook_toggle", enabled }).catch(() => {});
  }
});
