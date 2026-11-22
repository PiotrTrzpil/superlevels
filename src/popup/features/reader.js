// ═══════════════════════════════════
//  Reader view — the work is done by src/background/reader.js, which the
//  keyboard shortcut also uses
// ═══════════════════════════════════
import { activeTab } from "../lib/tabs.js";

const readerBtn = document.getElementById("readerBtn");
const readerStatus = document.getElementById("readerStatus");

export async function loadReader() {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === "reader-view")?.shortcut;
  document.getElementById("readerShortcut").textContent = shortcut
    ? `Shortcut: ${shortcut}.`
    : "Set a keyboard shortcut in chrome://extensions/shortcuts.";
}

readerBtn.addEventListener("click", async () => {
  readerStatus.textContent = "";
  readerStatus.className = "pip-status";
  const tab = await activeTab();
  if (!tab) return;
  readerBtn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: "reader", tabId: tab.id })
    .catch((e) => ({ error: e.message }));
  readerBtn.disabled = false;
  if (result?.error) {
    readerStatus.textContent = result.error;
    readerStatus.className = "pip-status err";
  } else {
    window.close();
  }
});
