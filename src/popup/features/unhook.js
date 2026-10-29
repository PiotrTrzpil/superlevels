// ═══════════════════════════════════
//  YouTube Unhook
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

const unhookFeatureEls = document.querySelectorAll("#unhookFeatures .unhook-feature");
const UNHOOK_FEATURE_DEFAULTS = { homepage: true, sidebar: true, endscreen: true, shorts: true, wider: true };

async function getUnhookFeatures() {
  const data = await chrome.storage.local.get(["unhook_features"]);
  return { ...UNHOOK_FEATURE_DEFAULTS, ...(data.unhook_features || {}) };
}

const loadUnhookToggle = featureToggle({
  key: "unhook_enabled",
  toggle: document.getElementById("unhookToggle"),
  status: document.getElementById("unhookStatus"),
  onChange: pushUnhookState,
});

export async function loadUnhook() {
  await loadUnhookToggle();
  const features = await getUnhookFeatures();
  unhookFeatureEls.forEach((el) => {
    el.classList.toggle("off", features[el.dataset.feature] === false);
  });
}

async function pushUnhookState() {
  const data = await chrome.storage.local.get(["unhook_enabled"]);
  const enabled = data.unhook_enabled !== false;
  const features = await getUnhookFeatures();
  await sendToActiveTab({ type: "unhook_toggle", enabled, features });
}

unhookFeatureEls.forEach((el) => {
  el.addEventListener("click", async () => {
    const features = await getUnhookFeatures();
    const key = el.dataset.feature;
    features[key] = !features[key];
    el.classList.toggle("off", !features[key]);
    await chrome.storage.local.set({ unhook_features: features });
    await pushUnhookState();
  });
});
