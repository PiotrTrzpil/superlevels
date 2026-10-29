// ═══════════════════════════════════
//  Photopea No Ads — MAIN-world script registration
//  (must run in the page world before Photopea's own scripts)
// ═══════════════════════════════════
import { createQueue, onLocalChange } from "./lib.js";

const PHOTOPEA_SCRIPT_ID = "sl-photopea-main";
const PHOTOPEA_SCRIPT_FILE = "src/content/photopea/photopea-main.js";

// Serialize so a toggle during startup can't race the initial registration
const photopeaQueue = createQueue();
function syncPhotopeaScript() {
  return photopeaQueue(doSyncPhotopeaScript).catch(() => {});
}

async function doSyncPhotopeaScript() {
  const { photopea_enabled } = await chrome.storage.local.get(["photopea_enabled"]);
  const enabled = photopea_enabled !== false;
  let existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PHOTOPEA_SCRIPT_ID] });
  // Registrations outlive extension updates; drop one left pointing at an older file path
  if (existing.length > 0 && existing[0].js?.join() !== PHOTOPEA_SCRIPT_FILE) {
    await chrome.scripting.unregisterContentScripts({ ids: [PHOTOPEA_SCRIPT_ID] }).catch(() => {});
    existing = [];
  }
  if (enabled && existing.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: PHOTOPEA_SCRIPT_ID,
      matches: ["*://www.photopea.com/*", "*://photopea.com/*"],
      js: [PHOTOPEA_SCRIPT_FILE],
      runAt: "document_start",
      world: "MAIN",
    }]).catch(() => {});
  } else if (!enabled && existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [PHOTOPEA_SCRIPT_ID] }).catch(() => {});
  }
}

syncPhotopeaScript();
chrome.runtime.onInstalled.addListener(syncPhotopeaScript);
onLocalChange(["photopea_enabled"], syncPhotopeaScript);
