// ═══════════════════════════════════
//  Feature on/off switches
// ═══════════════════════════════════

// The ON/OFF label next to a feature's switch
export function showStatus(el, on) {
  el.textContent = on ? "ON" : "OFF";
  el.className = "status " + (on ? "on" : "off");
}

// A switch whose state is a boolean in chrome.storage.local. A change shows and
// saves the new state, then calls onChange(enabled). Returns load(), which shows
// the stored state and resolves to it.
export function featureToggle({ key, defaultOn = true, toggle, status, onChange }) {
  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    showStatus(status, enabled);
    await chrome.storage.local.set({ [key]: enabled });
    await onChange?.(enabled);
  });
  return async function load() {
    const { [key]: stored } = await chrome.storage.local.get([key]);
    const enabled = stored ?? defaultOn;
    toggle.checked = enabled;
    showStatus(status, enabled);
    return enabled;
  };
}
