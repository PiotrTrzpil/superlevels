// ═══════════════════════════════════
//  X Reply Auto-Select
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

export const loadXReply = featureToggle({
  key: "xreply_enabled",
  toggle: document.getElementById("xreplyToggle"),
  status: document.getElementById("xreplyStatus"),
  onChange: (enabled) => sendToActiveTab({ type: "xreply_toggle", enabled }),
});
