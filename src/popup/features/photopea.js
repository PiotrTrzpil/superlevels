// ═══════════════════════════════════
//  Photopea No Ads
// ═══════════════════════════════════
import { featureToggle } from "../lib/toggle.js";

export const loadPhotopea = featureToggle({
  key: "photopea_enabled",
  toggle: document.getElementById("photopeaToggle"),
  status: document.getElementById("photopeaStatus"),
  // The width fix runs at page load, so reload any open Photopea tabs
  onChange: async () => {
    const tabs = await chrome.tabs.query({ url: ["*://www.photopea.com/*", "*://photopea.com/*"] });
    for (const tab of tabs) chrome.tabs.reload(tab.id).catch(() => {});
  },
});
