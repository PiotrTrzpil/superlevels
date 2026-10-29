// ═══════════════════════════════════
//  Photopea No Ads
// ═══════════════════════════════════

const photopeaToggle = document.getElementById("photopeaToggle");
const photopeaStatus = document.getElementById("photopeaStatus");

export async function loadPhotopea() {
  const data = await chrome.storage.local.get(["photopea_enabled"]);
  const enabled = data.photopea_enabled !== false;
  photopeaToggle.checked = enabled;
  updatePhotopeaUI(enabled);
}

function updatePhotopeaUI(on) {
  photopeaStatus.textContent = on ? "ON" : "OFF";
  photopeaStatus.className = "status " + (on ? "on" : "off");
}

photopeaToggle.addEventListener("change", async () => {
  const enabled = photopeaToggle.checked;
  updatePhotopeaUI(enabled);
  await chrome.storage.local.set({ photopea_enabled: enabled });

  // The width fix runs at page load, so reload any open Photopea tabs
  const tabs = await chrome.tabs.query({ url: ["*://www.photopea.com/*", "*://photopea.com/*"] });
  for (const tab of tabs) chrome.tabs.reload(tab.id).catch(() => {});
});
