// ═══════════════════════════════════
//  X Unhook
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

export const loadXUnhook = featureToggle({
  key: "xunhook_enabled",
  toggle: document.getElementById("xunhookToggle"),
  status: document.getElementById("xunhookStatus"),
  onChange: (enabled) => sendToActiveTab({ type: "xunhook_toggle", enabled }),
});
