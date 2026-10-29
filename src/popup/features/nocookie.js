// ═══════════════════════════════════
//  Cookie Consent (GDPR) Dismisser
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

export const loadNoCookie = featureToggle({
  key: "nocookie_enabled",
  toggle: document.getElementById("nocookieToggle"),
  status: document.getElementById("nocookieStatus"),
  onChange: (enabled) => sendToActiveTab({ type: "nocookie_toggle", enabled }),
});
