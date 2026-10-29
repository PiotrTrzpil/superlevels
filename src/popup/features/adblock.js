// ═══════════════════════════════════
//  Ad Block
// ═══════════════════════════════════
import { activeTab } from "../lib/tabs.js";
import { showStatus } from "../lib/toggle.js";

const adblockToggle = document.getElementById("adblockToggle");
const adblockStatus = document.getElementById("adblockStatus");
const adblockHostEl = document.getElementById("adblockHost");
const adblockPause = document.getElementById("adblockPause");
const adblockBuild = document.getElementById("adblockBuild");
const adblockExtras = document.getElementById("adblockExtras");
// The consent-banner list sits with Cookie banners rather than the other extras
const COOKIE_LIST = "cookies";
const nocookieList = document.getElementById("nocookieList");

let adblockHost = "";

export async function loadAdblock() {
  const tab = await activeTab();
  adblockHost = "";
  try {
    const url = new URL(tab?.url);
    if (/^https?:$/.test(url.protocol)) adblockHost = url.hostname.replace(/^www\./, "");
  } catch {}
  adblockHostEl.textContent = adblockHost ? `Current site: ${adblockHost}` : "Blocks ads and trackers";

  const [data, meta] = await Promise.all([
    chrome.storage.local.get(["adblock_enabled", "adblock_paused", "adblock_extras"]),
    // Written by scripts/build-adblock.mjs; missing until the lists are built
    fetch("/data/adblock/meta.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const enabled = data.adblock_enabled !== false;
  const paused = data.adblock_paused || [];
  adblockToggle.checked = enabled && !!meta;
  adblockToggle.disabled = !meta;
  adblockPause.checked = paused.some((h) => adblockHost === h || adblockHost.endsWith("." + h));
  adblockPause.disabled = !adblockHost || !meta;
  adblockBuild.textContent = meta
    ? `Lists built ${new Date(meta.builtAt).toLocaleDateString()}: ${meta.rules.toLocaleString()} rules.`
    : "Not set up. Ad Block is optional: build the filter lists with pnpm build:adblock in the extension folder, then reload the extension.";
  renderAdblockExtras(meta?.extras || [], data.adblock_extras || []);
  updateCookieListState();
  if (meta) showStatus(adblockStatus, enabled);
  else {
    adblockStatus.textContent = "NOT BUILT";
    adblockStatus.className = "status off";
  }
}

// One switch per extra list the build produced (meta.extras); all off by default
function renderAdblockExtras(extras, enabledIds) {
  adblockExtras.replaceChildren();
  nocookieList.replaceChildren();
  const cookieList = extras.find((e) => e.id === COOKIE_LIST);
  if (cookieList) nocookieList.append(extraRow(cookieList, enabledIds));
  const rest = extras.filter((e) => e !== cookieList);
  if (!rest.length) return;
  const heading = document.createElement("h2");
  heading.textContent = "Extra lists";
  heading.style.marginTop = "12px";
  adblockExtras.append(heading, ...rest.map((e) => extraRow(e, enabledIds)));
}

// The cookie list's rules only load with Ad Block on; say so where it's shown
function updateCookieListState() {
  const input = nocookieList.querySelector("input");
  if (!input) return;
  input.disabled = !adblockToggle.checked;
  input.parentElement.title = input.disabled ? "Turn on Ad Block to use this" : "";
}

function extraRow(extra, enabledIds) {
  const row = document.createElement("div");
  row.className = "toggle-row";
  row.title = `${extra.rules.toLocaleString()} rules, ${extra.selectors.toLocaleString()} hiding selectors`;
  const text = document.createElement("div");
  text.className = "toggle-text";
  const label = document.createElement("label");
  label.textContent = extra.title;
  text.append(label);
  // Lists built before descriptions existed have none
  if (extra.description) {
    const desc = document.createElement("div");
    desc.className = "opt-desc";
    desc.textContent = extra.description;
    text.append(desc);
  }
  const sw = document.createElement("label");
  sw.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.extra = extra.id;
  input.checked = enabledIds.includes(extra.id);
  input.addEventListener("change", async () => {
    const { adblock_extras = [] } = await chrome.storage.local.get(["adblock_extras"]);
    const rest = adblock_extras.filter((id) => id !== extra.id);
    await chrome.storage.local.set({ adblock_extras: input.checked ? [...rest, extra.id] : rest });
  });
  const slider = document.createElement("span");
  slider.className = "slider";
  sw.append(input, slider);
  row.append(text, sw);
  return row;
}

adblockToggle.addEventListener("change", () => {
  const enabled = adblockToggle.checked;
  showStatus(adblockStatus, enabled);
  chrome.storage.local.set({ adblock_enabled: enabled });
  updateCookieListState();
});

adblockPause.addEventListener("change", async () => {
  if (!adblockHost) return;
  const { adblock_paused = [] } = await chrome.storage.local.get(["adblock_paused"]);
  // Unpausing also clears any parent-domain entry that covered this host
  const rest = adblock_paused.filter((h) => !(adblockHost === h || adblockHost.endsWith("." + h)));
  await chrome.storage.local.set({ adblock_paused: adblockPause.checked ? [...rest, adblockHost] : rest });
  // Wait until the background has swapped the rules, then reload to apply
  await chrome.runtime.sendMessage({ type: "adblockSync" });
  const tab = await activeTab();
  if (tab) chrome.tabs.reload(tab.id);
});
