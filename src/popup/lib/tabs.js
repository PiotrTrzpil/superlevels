// ═══════════════════════════════════
//  The tab the popup acts on
// ═══════════════════════════════════

// The active tab of the popup's window (undefined if there is none)
export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Tell the active tab's content scripts about a change; pages without them ignore it
export async function sendToActiveTab(msg) {
  const tab = await activeTab();
  if (tab) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
}
