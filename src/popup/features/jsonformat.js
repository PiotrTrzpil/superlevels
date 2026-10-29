// ═══════════════════════════════════
//  JSON Formatter
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

export const loadJsonFormat = featureToggle({
  key: "jsonformat_enabled",
  toggle: document.getElementById("jsonformatToggle"),
  status: document.getElementById("jsonformatStatus"),
  onChange: (enabled) => sendToActiveTab({ type: "jsonformat_toggle", enabled }),
});
