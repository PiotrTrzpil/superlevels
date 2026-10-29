// ═══════════════════════════════════
//  YouTube Unhook
// ═══════════════════════════════════

const unhookToggle = document.getElementById("unhookToggle");
const unhookStatus = document.getElementById("unhookStatus");
const unhookFeatureEls = document.querySelectorAll("#unhookFeatures .unhook-feature");
const UNHOOK_FEATURE_DEFAULTS = { homepage: true, sidebar: true, endscreen: true, shorts: true, wider: true };

async function getUnhookFeatures() {
  const data = await chrome.storage.local.get(["unhook_features"]);
  return { ...UNHOOK_FEATURE_DEFAULTS, ...(data.unhook_features || {}) };
}

export async function loadUnhook() {
  const data = await chrome.storage.local.get(["unhook_enabled"]);
  const enabled = data.unhook_enabled !== false;
  unhookToggle.checked = enabled;
  updateUnhookUI(enabled);
  const features = await getUnhookFeatures();
  unhookFeatureEls.forEach((el) => {
    el.classList.toggle("off", features[el.dataset.feature] === false);
  });
}

function updateUnhookUI(on) {
  unhookStatus.textContent = on ? "ON" : "OFF";
  unhookStatus.className = "status " + (on ? "on" : "off");
}

async function pushUnhookState() {
  const data = await chrome.storage.local.get(["unhook_enabled"]);
  const enabled = data.unhook_enabled !== false;
  const features = await getUnhookFeatures();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "unhook_toggle", enabled, features }).catch(() => {});
  }
}

unhookToggle.addEventListener("change", async () => {
  const enabled = unhookToggle.checked;
  updateUnhookUI(enabled);
  await chrome.storage.local.set({ unhook_enabled: enabled });
  await pushUnhookState();
});

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
