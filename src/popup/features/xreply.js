// ═══════════════════════════════════
//  X Reply Auto-Select
// ═══════════════════════════════════

const xreplyToggle = document.getElementById("xreplyToggle");
const xreplyStatus = document.getElementById("xreplyStatus");

export async function loadXReply() {
  const data = await chrome.storage.local.get(["xreply_enabled"]);
  const enabled = data.xreply_enabled !== false;
  xreplyToggle.checked = enabled;
  updateXReplyUI(enabled);
}

function updateXReplyUI(on) {
  xreplyStatus.textContent = on ? "ON" : "OFF";
  xreplyStatus.className = "status " + (on ? "on" : "off");
}

xreplyToggle.addEventListener("change", async () => {
  const enabled = xreplyToggle.checked;
  updateXReplyUI(enabled);
  await chrome.storage.local.set({ xreply_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "xreply_toggle", enabled }).catch(() => {});
  }
});
