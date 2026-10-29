// ═══════════════════════════════════
//  Navigation
// ═══════════════════════════════════
function switchToPage(page) {
  const btn = document.querySelector(`.subnav button[data-page="${page}"]`);
  if (!btn) return;
  const subnav = btn.closest(".subnav");
  // Other subnavs keep their active button, so a group reopens on its last page
  document.querySelectorAll(".nav button, .subnav, .page").forEach((el) => el.classList.remove("active"));
  subnav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  document.querySelector(`.nav button[data-group="${subnav.dataset.group}"]`).classList.add("active");
  subnav.classList.add("active");
  btn.classList.add("active");
  document.getElementById("page-" + page).classList.add("active");
  // Defer the data-loading work so the page swap paints first
  const load = () => PAGE_LOADERS[page]?.forEach((fn) => fn());
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(load);
  else setTimeout(load, 0);
  chrome.storage.local.set({ last_tab: page });
}

// Called when a page is shown; function declarations below, so hoisted
const PAGE_LOADERS = {
  cookies: [loadCookies],
  redirects: [loadRedirects],
  darkmode: [loadDarkMode],
  livecss: [loadLiveCSS],
  sites: [loadXDim, loadXUnhook, loadXReply, loadUnhook, loadPhotopea],
  blocking: [loadAdblock, loadNoCookie, loadArchive],
  trackers: [loadTrackers],
  toggles: [loadJsToggle, loadJsonFormat],
  bookmarks: [loadBookmarkBridge],
  summarize: [loadSummarize],
  music: [loadMusicHistory, loadAcrFields],
};

document.querySelectorAll(".nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const subnav = document.querySelector(`.subnav[data-group="${btn.dataset.group}"]`);
    const page = subnav.querySelector("button.active") ?? subnav.querySelector("button");
    switchToPage(page.dataset.page);
  });
});

document.querySelectorAll(".subnav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchToPage(btn.dataset.page);
    // Clicking the PiP tab toggles PiP right away (needs the user gesture,
    // so only on a real click — not when restoring last_tab)
    if (btn.dataset.page === "pip") enterPiP();
  });
});

// Feature rows: clicking the row (not its switch) shows its details;
// which rows are open is remembered across popup opens
const feats = document.querySelectorAll(".feat");
feats.forEach((feat) => {
  feat.querySelector(".feat-head").addEventListener("click", (e) => {
    if (e.target.closest(".switch")) return;
    feat.classList.toggle("open");
    const open = [...feats].filter((f) => f.classList.contains("open")).map((f) => f.dataset.feat);
    chrome.storage.local.set({ open_feats: open });
  });
});
chrome.storage.local.get(["open_feats"], ({ open_feats = [] }) => {
  feats.forEach((f) => f.classList.toggle("open", open_feats.includes(f.dataset.feat)));
});

// Sites whose fixes live on the Sites page; the popup opens there on them
const SITE_HOSTS = /(^|\.)(x\.com|twitter\.com|youtube\.com|photopea\.com)$/;

function isFixedSite(url) {
  try { return SITE_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

// Open on the Sites page on a fixed site, else the last open tab — deferred
// so the default page paints first
requestAnimationFrame(async () => {
  const [[tab], data] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get(["last_tab"]),
  ]);
  if (isFixedSite(tab?.url)) switchToPage("sites");
  else if (data.last_tab) switchToPage(data.last_tab);
});

// ═══════════════════════════════════
//  Tab Cleaner
// ═══════════════════════════════════
const enabledEl = document.getElementById("enabled");
const timeoutEl = document.getElementById("timeout");
const timeoutUnitEl = document.getElementById("timeoutUnit");
const DEFAULT_TIMEOUT_MIN = 3 * 24 * 60; // keep in sync with src/background/tabcleaner.js
const MAX_TIMEOUT_MIN = 365 * 24 * 60;

// Show the timeout in the largest unit that divides it evenly
function renderTimeout(minutes) {
  const unit = [1440, 60, 1].find((u) => minutes % u === 0);
  timeoutUnitEl.value = unit;
  timeoutEl.value = minutes / unit;
}
const hostInput = document.getElementById("hostInput");
const addBtn = document.getElementById("addBtn");
const listEl = document.getElementById("list");

chrome.storage.local.get(["enabled", "timeoutMin", "exclusions"], (data) => {
  enabledEl.checked = data.enabled !== false;
  renderTimeout(data.timeoutMin || DEFAULT_TIMEOUT_MIN);
  renderExclusionList(data.exclusions || []);
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

function saveTimeout() {
  const unit = parseInt(timeoutUnitEl.value);
  const amount = Math.max(1, parseInt(timeoutEl.value) || 1);
  const minutes = Math.min(MAX_TIMEOUT_MIN, amount * unit);
  renderTimeout(minutes);
  chrome.storage.local.set({ timeoutMin: minutes });
}

timeoutEl.addEventListener("change", saveTimeout);
timeoutUnitEl.addEventListener("change", saveTimeout);

function addHost() {
  let host = hostInput.value.trim().toLowerCase();
  if (!host) return;
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  chrome.storage.local.get(["exclusions"], (data) => {
    const exclusions = data.exclusions || [];
    if (exclusions.includes(host)) { hostInput.value = ""; return; }
    exclusions.push(host);
    chrome.storage.local.set({ exclusions }, () => {
      hostInput.value = "";
      renderExclusionList(exclusions);
    });
  });
}

addBtn.addEventListener("click", addHost);
hostInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addHost(); });

function removeHost(host) {
  chrome.storage.local.get(["exclusions"], (data) => {
    const exclusions = (data.exclusions || []).filter((h) => h !== host);
    chrome.storage.local.set({ exclusions }, () => renderExclusionList(exclusions));
  });
}

function renderExclusionList(exclusions) {
  if (!exclusions.length) {
    listEl.innerHTML = '<div class="empty">No exclusions — all tabs can be closed</div>';
    return;
  }
  listEl.innerHTML = exclusions
    .map((h) => `<div class="item"><span>${esc(h)}</span><button data-host="${escA(h)}">&times;</button></div>`)
    .join("");
  listEl.querySelectorAll("button[data-host]").forEach((btn) => {
    btn.addEventListener("click", () => removeHost(btn.dataset.host));
  });
}

// ── Closed Tabs list ──
const openClosedBtn = document.getElementById("openClosed");

chrome.storage.local.get(["closed_tabs"], (data) => {
  const count = (data.closed_tabs || []).length;
  if (count) openClosedBtn.textContent += ` (${count})`;
});

openClosedBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "closedOpenPage" });
  window.close();
});

// ═══════════════════════════════════
//  Cookie Editor
// ═══════════════════════════════════
const cookieDomainEl = document.getElementById("cookieDomain");
const cookieCountEl = document.getElementById("cookieCount");
const cookieListEl = document.getElementById("cookieList");

let currentUrl = "";
let currentDomain = "";
let allCookies = [];

async function loadCookies() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    cookieDomainEl.textContent = "No accessible page";
    cookieCountEl.textContent = "0";
    cookieListEl.innerHTML = '<div class="empty">Cannot read cookies from this page</div>';
    return;
  }
  currentUrl = tab.url;
  try {
    currentDomain = new URL(tab.url).hostname;
  } catch {
    currentDomain = "";
  }
  cookieDomainEl.textContent = currentDomain;

  const cookies = await chrome.cookies.getAll({ url: tab.url });
  cookies.sort((a, b) => a.name.localeCompare(b.name));
  allCookies = cookies;
  cookieCountEl.textContent = cookies.length;
  renderCookies(cookies);
}

function renderCookies(cookies) {
  if (!cookies.length) {
    cookieListEl.innerHTML = '<div class="empty">No cookies for this site</div>';
    return;
  }
  cookieListEl.innerHTML = cookies.map((c, i) => `
    <div class="cookie-item" data-idx="${i}">
      <div class="cookie-row">
        <span class="cookie-chevron">&#9660;</span>
        <span class="cookie-name">${esc(c.name)}</span>
        <button class="cookie-del" data-delidx="${i}" title="Delete">&times;</button>
      </div>
      <div class="cookie-details">
        <div class="cookie-field">
          <label>Name</label>
          <input type="text" value="${escA(c.name)}" data-field="name" data-i="${i}">
        </div>
        <div class="cookie-field">
          <label>Value</label>
          <textarea data-field="value" data-i="${i}">${esc(c.value)}</textarea>
        </div>
        <div class="advanced-toggle" data-adv="${i}">Show Advanced</div>
        <div class="advanced-fields" data-advf="${i}">
          <div class="cookie-field">
            <label>Domain</label>
            <input type="text" value="${escA(c.domain)}" data-field="domain" data-i="${i}">
          </div>
          <div class="cookie-field">
            <label>Path</label>
            <input type="text" value="${escA(c.path)}" data-field="path" data-i="${i}">
          </div>
          <div class="cookie-field">
            <label>SameSite</label>
            <input type="text" value="${escA(c.sameSite || "unspecified")}" data-field="sameSite" data-i="${i}">
          </div>
          <div class="cookie-field">
            <label>Secure: ${c.secure ? "Yes" : "No"} &nbsp;|&nbsp; HttpOnly: ${c.httpOnly ? "Yes" : "No"}</label>
          </div>
        </div>
        <div class="cookie-actions">
          <button class="btn-save" data-saveidx="${i}">&#128190; Save</button>
          <button class="btn-del2" data-delidx="${i}">&#128465; Delete</button>
        </div>
      </div>
    </div>
  `).join("");

  // Expand / collapse
  cookieListEl.querySelectorAll(".cookie-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".cookie-del")) return;
      row.closest(".cookie-item").classList.toggle("expanded");
    });
  });

  // Show Advanced
  cookieListEl.querySelectorAll(".advanced-toggle").forEach((t) => {
    t.addEventListener("click", () => {
      const fields = cookieListEl.querySelector(`.advanced-fields[data-advf="${t.dataset.adv}"]`);
      fields.classList.toggle("show");
      t.textContent = fields.classList.contains("show") ? "Hide Advanced" : "Show Advanced";
    });
  });

  // Delete buttons
  cookieListEl.querySelectorAll("[data-delidx]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCookie(allCookies[parseInt(btn.dataset.delidx)]);
    });
  });

  // Save buttons
  cookieListEl.querySelectorAll("[data-saveidx]").forEach((btn) => {
    btn.addEventListener("click", () => saveCookie(parseInt(btn.dataset.saveidx)));
  });
}

async function deleteCookie(cookie) {
  const protocol = cookie.secure ? "https" : "http";
  const url = `${protocol}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
  await chrome.cookies.remove({ url, name: cookie.name });
  loadCookies();
}

async function saveCookie(idx) {
  const original = allCookies[idx];
  const item = cookieListEl.querySelector(`.cookie-item[data-idx="${idx}"]`);

  const nameEl = item.querySelector('[data-field="name"]');
  const valueEl = item.querySelector('[data-field="value"]');
  const domainEl = item.querySelector('[data-field="domain"]');
  const pathEl = item.querySelector('[data-field="path"]');
  const sameSiteEl = item.querySelector('[data-field="sameSite"]');

  const protocol = original.secure ? "https" : "http";
  const domain = domainEl ? domainEl.value : original.domain;
  const path = pathEl ? pathEl.value : original.path;
  const newUrl = `${protocol}://${domain.replace(/^\./, "")}${path}`;

  const details = {
    url: newUrl,
    name: nameEl.value,
    value: valueEl.value,
    path: path,
    secure: original.secure,
    httpOnly: original.httpOnly,
    sameSite: sameSiteEl ? sameSiteEl.value : original.sameSite || "unspecified",
  };
  if (!original.hostOnly) details.domain = domain;
  if (original.expirationDate) details.expirationDate = original.expirationDate;

  // Write the new cookie before touching the old one, so an invalid edit
  // (e.g. a bad SameSite value) doesn't delete the cookie outright
  const saved = await chrome.cookies.set(details).catch((err) => {
    alert(`Could not save cookie: ${err.message}`);
    return null;
  });
  if (!saved) return;

  // Renamed or moved: the old cookie is a separate one, remove it
  if (saved.name !== original.name || saved.domain !== original.domain || saved.path !== original.path) {
    await deleteCookie(original);
  } else {
    loadCookies();
  }
}

// Delete All
document.getElementById("btnDeleteAll").addEventListener("click", async () => {
  if (!allCookies.length) return;
  for (const c of allCookies) {
    const protocol = c.secure ? "https" : "http";
    const url = `${protocol}://${c.domain.replace(/^\./, "")}${c.path}`;
    await chrome.cookies.remove({ url, name: c.name });
  }
  loadCookies();
});

// Refresh
document.getElementById("btnRefresh").addEventListener("click", () => loadCookies());

// Export
document.getElementById("btnExport").addEventListener("click", () => {
  if (!allCookies.length) return;
  const data = JSON.stringify(allCookies, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cookies-${currentDomain}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Add Cookie Modal
const addModal = document.getElementById("addModal");
document.getElementById("btnAdd").addEventListener("click", () => {
  document.getElementById("newDomain").value = currentDomain ? "." + currentDomain : "";
  document.getElementById("newPath").value = "/";
  document.getElementById("newName").value = "";
  document.getElementById("newValue").value = "";
  addModal.classList.add("show");
});
document.getElementById("modalCancel").addEventListener("click", () => {
  addModal.classList.remove("show");
});
addModal.addEventListener("click", (e) => {
  if (e.target === addModal) addModal.classList.remove("show");
});
document.getElementById("modalSave").addEventListener("click", async () => {
  const name = document.getElementById("newName").value.trim();
  if (!name) return;
  const domain = document.getElementById("newDomain").value.trim();
  const path = document.getElementById("newPath").value.trim() || "/";
  const url = `https://${domain.replace(/^\./, "")}${path}`;
  await chrome.cookies.set({
    url,
    name,
    value: document.getElementById("newValue").value,
    domain,
    path,
  });
  addModal.classList.remove("show");
  loadCookies();
});

// ═══════════════════════════════════
//  Redirect Tracer
// ═══════════════════════════════════
const redirectChainEl = document.getElementById("redirectChain");
let lastRedirectText = "";

async function loadRedirects() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    redirectChainEl.innerHTML = '<div class="redirect-empty"><div class="big-icon">🔀</div><p>No active tab</p></div>';
    return;
  }

  const data = await chrome.runtime.sendMessage({ type: "getRedirects", tabId: tab.id });
  const chain = data.chain || [];
  const finalUrl = data.finalUrl || tab.url;
  const finalStatus = data.finalStatus || 200;

  if (!chain.length) {
    // No redirects — just show the final URL
    redirectChainEl.innerHTML = renderStep(finalUrl, finalStatus, true, false);
    lastRedirectText = `${finalUrl}\n${finalStatus}: Final destination`;
    return;
  }

  let html = "";
  let text = "";
  chain.forEach((hop, i) => {
    const label = getRedirectLabel(hop.statusCode);
    html += renderStep(hop.url, hop.statusCode, false, true);
    text += `${hop.url}\n${hop.statusCode}: ${label} to ${hop.redirectUrl}\n\n`;
  });
  // Final destination
  html += renderStep(finalUrl, finalStatus, true, false);
  text += `${finalUrl}\n${finalStatus}: Final destination`;

  redirectChainEl.innerHTML = html;
  lastRedirectText = text;
}

function renderStep(url, statusCode, isFinal, hasConnector) {
  const iconClass = isFinal ? (statusCode >= 400 ? "error" : "final") : "redirect";
  const codeClass = statusCode >= 500 ? "code-5xx" : statusCode >= 400 ? "code-4xx" : `code-${statusCode}`;
  const label = isFinal ? "Final destination" : getRedirectLabel(statusCode);
  const arrow = isFinal
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="#6af38a" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="#6ab0f3" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';

  return `
    <div class="redirect-step">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="step-icon ${iconClass}">${arrow}</div>
        ${hasConnector ? '<div class="step-connector"></div>' : ''}
      </div>
      <div class="step-content">
        <div class="step-url">${esc(url)}</div>
        <div class="step-status"><span class="code ${codeClass}">${statusCode}</span> ${esc(label)}</div>
      </div>
    </div>
  `;
}

function getRedirectLabel(code) {
  const labels = {
    301: "Permanent redirect",
    302: "Temporary redirect (Found)",
    303: "See Other",
    307: "Temporary redirect",
    308: "Permanent redirect",
  };
  return labels[code] || `Redirect (${code})`;
}

document.getElementById("btnRedirectRefresh").addEventListener("click", () => loadRedirects());

document.getElementById("btnRedirectCopy").addEventListener("click", async () => {
  if (!lastRedirectText) return;
  await navigator.clipboard.writeText(lastRedirectText);
  const btn = document.getElementById("btnRedirectCopy");
  const orig = btn.querySelector("span").textContent;
  btn.querySelector("span").textContent = "Copied!";
  setTimeout(() => { btn.querySelector("span").textContent = orig; }, 1500);
});

// ═══════════════════════════════════
//  Dark Mode
// ═══════════════════════════════════
const darkToggle = document.getElementById("darkToggle");
const darkStatus = document.getElementById("darkStatus");
const darkHostEl = document.getElementById("darkHost");
const darkBrightness = document.getElementById("darkBrightness");
const darkBrightnessVal = document.getElementById("darkBrightnessVal");
const scopeSite = document.getElementById("scopeSite");
const scopeGlobal = document.getElementById("scopeGlobal");

let darkHost = "";
let darkScope = "site"; // "site" or "global"

async function loadDarkMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  try { darkHost = new URL(tab.url).hostname; } catch { darkHost = ""; }
  darkHostEl.textContent = darkHost ? `Current site: ${darkHost}` : "";

  const siteKey = "darkmode_" + darkHost;
  const data = await chrome.storage.local.get([siteKey, "darkmode_global", "darkmode_brightness"]);

  const brightness = data.darkmode_brightness || 100;
  darkBrightness.value = brightness;
  darkBrightnessVal.textContent = brightness + "%";

  const siteState = data[siteKey];
  const globalState = data.darkmode_global || false;
  const enabled = siteState !== undefined ? siteState : globalState;

  darkToggle.checked = enabled;
  updateDarkStatus(enabled);
}

function updateDarkStatus(on) {
  darkStatus.textContent = on ? "ON" : "OFF";
  darkStatus.className = "status " + (on ? "on" : "off");
}

async function applyDark() {
  const enabled = darkToggle.checked;
  const brightness = parseInt(darkBrightness.value);
  updateDarkStatus(enabled);

  // Save preference
  if (darkScope === "global") {
    await chrome.storage.local.set({ darkmode_global: enabled });
    // "All sites" is a master switch: clear any per-site overrides so that
    // toggling it (esp. OFF) truly applies everywhere. Otherwise a leftover
    // per-site value keeps winning over global and the site stays dark.
    const all = await chrome.storage.local.get(null);
    const overrides = Object.keys(all).filter(
      (k) =>
        k.startsWith("darkmode_") &&
        k !== "darkmode_global" &&
        k !== "darkmode_brightness"
    );
    if (overrides.length) await chrome.storage.local.remove(overrides);
  } else {
    const siteKey = "darkmode_" + darkHost;
    await chrome.storage.local.set({ [siteKey]: enabled });
  }
  await chrome.storage.local.set({ darkmode_brightness: brightness });

  // Send to active tab's content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, {
      type: "darkmode_toggle",
      enabled,
      brightness,
    }).catch(() => {});
  }
}

darkToggle.addEventListener("change", applyDark);

darkBrightness.addEventListener("input", () => {
  darkBrightnessVal.textContent = darkBrightness.value + "%";
});
darkBrightness.addEventListener("change", applyDark);

scopeSite.addEventListener("click", () => {
  darkScope = "site";
  scopeSite.classList.add("active");
  scopeGlobal.classList.remove("active");
});
scopeGlobal.addEventListener("click", () => {
  darkScope = "global";
  scopeGlobal.classList.add("active");
  scopeSite.classList.remove("active");
});

// ═══════════════════════════════════
//  X Dim Mode
// ═══════════════════════════════════
const xdimToggle = document.getElementById("xdimToggle");
const xdimStatus = document.getElementById("xdimStatus");
const xdimPreview = document.getElementById("xdimPreview");
const xdimHueSlider = document.getElementById("xdimHueSlider");
const xdimHueVal = document.getElementById("xdimHueVal");
const xdimCustomHueSection = document.getElementById("xdimCustomHueSection");
const xdimDots = document.querySelectorAll(".xdim-dot");

const XDIM_THEMES = {
  dim:   { hue: 210, sat: 34 },
  slate: { hue: 210, sat: 8  },
  jade:  { hue: 150, sat: 34 },
  plum:  { hue: 270, sat: 34 },
  dusk:  { hue: 330, sat: 34 },
  ember: { hue: 25,  sat: 34 },
};

let xdimTheme = "dim";
let xdimCustomHue = 210;

async function loadXDim() {
  const data = await chrome.storage.local.get(["xdim_enabled", "xdim_theme", "xdim_customHue"]);
  const enabled = data.xdim_enabled || false;
  xdimTheme = data.xdim_theme ?? "dim";
  xdimCustomHue = data.xdim_customHue ?? 210;

  xdimToggle.checked = enabled;
  xdimHueSlider.value = xdimCustomHue;
  xdimHueVal.textContent = xdimCustomHue + "°";

  updateXDimStatus(enabled);
  updateXDimThemeDots();
  updateXDimPreview();
}

function updateXDimStatus(on) {
  xdimStatus.textContent = on ? "ON" : "OFF";
  xdimStatus.className = "status " + (on ? "on" : "off");
}

function updateXDimThemeDots() {
  xdimDots.forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.theme === xdimTheme);
  });
  xdimCustomHueSection.classList.toggle("show", xdimTheme === "custom");
}

function getXDimHueSat() {
  if (xdimTheme === "custom") return { hue: xdimCustomHue, sat: 34 };
  return XDIM_THEMES[xdimTheme] || XDIM_THEMES.dim;
}

function updateXDimPreview() {
  const { hue: h, sat: s } = getXDimHueSat();
  const bSat = Math.round(s * 0.47);
  const bar = xdimPreview.querySelector(".xdim-preview-bar");
  const tweet = xdimPreview.querySelector(".xdim-preview-tweet");
  bar.style.background = `hsl(${h}, ${s}%, 16%)`;
  bar.style.color = `hsl(${h}, ${Math.round(s * 0.32)}%, 60%)`;
  tweet.style.background = `hsl(${h}, ${s}%, 13%)`;
  tweet.style.color = `hsl(${h}, ${Math.round(s * 0.32)}%, 60%)`;
  tweet.style.borderColor = `hsl(${h}, ${bSat}%, 26%)`;
}

xdimToggle.addEventListener("change", async () => {
  const enabled = xdimToggle.checked;
  updateXDimStatus(enabled);
  await chrome.storage.local.set({ xdim_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "xdim_toggle", enabled }).catch(() => {});
  }
});

xdimDots.forEach((dot) => {
  dot.addEventListener("click", async () => {
    xdimTheme = dot.dataset.theme;
    updateXDimThemeDots();
    updateXDimPreview();
    await chrome.storage.local.set({ xdim_theme: xdimTheme });
  });
});

xdimHueSlider.addEventListener("input", () => {
  xdimCustomHue = parseInt(xdimHueSlider.value);
  xdimHueVal.textContent = xdimCustomHue + "°";
  updateXDimPreview();
});
xdimHueSlider.addEventListener("change", async () => {
  xdimCustomHue = parseInt(xdimHueSlider.value);
  await chrome.storage.local.set({ xdim_customHue: xdimCustomHue });
});

// ═══════════════════════════════════
//  Ad Block
// ═══════════════════════════════════
const adblockToggle = document.getElementById("adblockToggle");
const adblockStatus = document.getElementById("adblockStatus");
const adblockHostEl = document.getElementById("adblockHost");
const adblockPause = document.getElementById("adblockPause");
const adblockBuild = document.getElementById("adblockBuild");
const adblockExtras = document.getElementById("adblockExtras");

let adblockHost = "";

async function loadAdblock() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  if (meta) updateAdblockUI(enabled);
  else {
    adblockStatus.textContent = "NOT BUILT";
    adblockStatus.className = "status off";
  }
}

// One switch per extra list the build produced (meta.extras); all off by default
function renderAdblockExtras(extras, enabledIds) {
  adblockExtras.replaceChildren();
  if (!extras.length) return;
  const heading = document.createElement("h2");
  heading.textContent = "Extra lists";
  heading.style.marginTop = "12px";
  adblockExtras.append(heading);
  for (const extra of extras) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    const label = document.createElement("label");
    label.textContent = extra.title;
    label.title = `${extra.rules.toLocaleString()} rules, ${extra.selectors.toLocaleString()} hiding selectors`;
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
    row.append(label, sw);
    adblockExtras.append(row);
  }
}

function updateAdblockUI(on) {
  adblockStatus.textContent = on ? "ON" : "OFF";
  adblockStatus.className = "status " + (on ? "on" : "off");
}

adblockToggle.addEventListener("change", () => {
  const enabled = adblockToggle.checked;
  updateAdblockUI(enabled);
  chrome.storage.local.set({ adblock_enabled: enabled });
});

adblockPause.addEventListener("change", async () => {
  if (!adblockHost) return;
  const { adblock_paused = [] } = await chrome.storage.local.get(["adblock_paused"]);
  // Unpausing also clears any parent-domain entry that covered this host
  const rest = adblock_paused.filter((h) => !(adblockHost === h || adblockHost.endsWith("." + h)));
  await chrome.storage.local.set({ adblock_paused: adblockPause.checked ? [...rest, adblockHost] : rest });
  // Wait until the background has swapped the rules, then reload to apply
  await chrome.runtime.sendMessage({ type: "adblockSync" });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.reload(tab.id);
});

// ═══════════════════════════════════
//  Trackers
// ═══════════════════════════════════
const TRACKER_CATEGORIES = {
  advertising: "Advertising", site_analytics: "Analytics", social_media: "Social media",
  customer_interaction: "Chat & support widgets", pornvertising: "Adult advertising",
  mobile_analytics: "Mobile analytics", telemetry: "Telemetry", consent: "Consent managers",
  audio_video_player: "Video players", comments: "Comments", essential: "Essential",
  cdn: "CDNs", hosting: "Hosting", email: "Email", extensions: "Extensions",
  misc: "Misc", unknown: "Unknown",
};
// Offered as "block everywhere" switches. The rest (CDNs, video players,
// essential, hosting…) break too many sites to block wholesale.
const TRACKER_BLOCKABLE = ["advertising", "site_analytics", "social_media", "customer_interaction", "pornvertising", "mobile_analytics", "telemetry"];
// Storage key for each kind of block switch
const TRACKER_KEYS = { tracker: "trackers_blocked", category: "trackers_blocked_categories", host: "trackers_blocked_hosts" };

const trkSummary = document.getElementById("trkSummary");
const trkHostEl = document.getElementById("trkHost");
const trkList = document.getElementById("trkList");
const trkCategories = document.getElementById("trkCategories");
const trkNote = document.getElementById("trkNote");
const trkReload = document.getElementById("trkReload");

let trkTabId = null;

async function loadTrackers() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  trkTabId = tab?.id ?? null;
  const data = trkTabId === null ? null : await chrome.runtime.sendMessage({ type: "trackersForTab", tabId: trkTabId });
  renderTrackers(data);
}

function trkEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// A row's block switch: checked = blocked by you. kind/value pick the storage list.
function trkSwitch(kind, value, checked, { disabled = false, title = "" } = {}) {
  const label = trkEl("label", "switch");
  const input = trkEl("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  label.title = title || (checked ? "Blocked everywhere — click to allow" : "Block everywhere");
  input.addEventListener("change", async () => {
    const key = TRACKER_KEYS[kind];
    const { [key]: list = [] } = await chrome.storage.local.get([key]);
    const rest = list.filter((v) => v !== value);
    await chrome.storage.local.set({ [key]: input.checked ? [...rest, value] : rest });
    await chrome.runtime.sendMessage({ type: "trackersSync" });
    loadTrackers();
  });
  label.append(input, trkEl("span", "slider"));
  return label;
}

function trkChip(requests, blocked) {
  if (blocked && blocked >= requests) return trkEl("span", "trk-chip blocked", "blocked");
  if (blocked) return trkEl("span", "trk-chip partly", `${blocked}/${requests} blocked`);
  return trkEl("span", "trk-chip", "loaded");
}

function renderTrackers(data) {
  trkList.replaceChildren();
  trkCategories.replaceChildren();
  const settings = data?.settings ?? { trackers: [], categories: [], hosts: [] };

  if (!data?.page) {
    trkSummary.textContent = "Trackers";
    trkHostEl.textContent = "";
    trkList.append(trkEl("div", "trk-empty", "No data for this tab yet. Reload the page to see its trackers."));
  } else {
    const blocked = [...data.trackers, ...data.others].filter((t) => t.blocked).length;
    const total = data.trackers.length + data.others.length;
    trkSummary.textContent = `${total} third ${total === 1 ? "party" : "parties"} · ${blocked} blocked`;
    trkHostEl.textContent = `On ${data.page}`;
    if (!total) trkList.append(trkEl("div", "trk-empty", "No third-party requests on this page."));

    // Known trackers, grouped by category (blockable categories first)
    const order = Object.keys(TRACKER_CATEGORIES);
    const groups = Object.groupBy(data.trackers, (t) => t.category);
    for (const category of Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
      trkList.append(trkEl("div", "trk-group", TRACKER_CATEGORIES[category] ?? category));
      const byCategory = settings.categories.includes(category);
      for (const t of groups[category]) {
        const row = trkEl("div", "trk-row");
        const name = trkEl("span", "trk-name", t.name);
        name.title = t.hosts.join("\n");
        if (t.company && t.company !== t.name) name.append(trkEl("span", "trk-company", t.company));
        row.append(name, trkEl("span", "trk-count", t.requests), trkChip(t.requests, t.blocked),
          trkSwitch("tracker", t.id, byCategory || settings.trackers.includes(t.id),
            byCategory ? { disabled: true, title: "Blocked with its whole category below" } : {}));
        trkList.append(row);
      }
    }

    if (data.others.length) {
      trkList.append(trkEl("div", "trk-group", data.trackers.length ? "Other third parties" : "Third parties"));
      for (const o of data.others) {
        const row = trkEl("div", "trk-row");
        row.append(trkEl("span", "trk-name", o.host), trkEl("span", "trk-count", o.requests),
          trkChip(o.requests, o.blocked), trkSwitch("host", o.host, settings.hosts.includes(o.host)));
        trkList.append(row);
      }
    }
  }

  for (const category of TRACKER_BLOCKABLE) {
    const row = trkEl("div", "trk-row");
    row.append(trkEl("span", "trk-name", TRACKER_CATEGORIES[category]),
      trkSwitch("category", category, settings.categories.includes(category), { disabled: !data?.source }));
    trkCategories.append(row);
  }

  trkNote.replaceChildren();
  if (data?.source) {
    const link = (text, href) => Object.assign(trkEl("a", "", text), { href, target: "_blank", style: "color:#888" });
    trkNote.append("Tracker data: ", link("WhoTracks.Me", "https://whotracks.me"), " via ",
      link("AdGuard companiesdb", "https://github.com/AdguardTeam/companiesdb"), " (CC BY-SA 4.0). Blocks apply after a reload.");
  } else {
    trkNote.textContent = "Names and categories need the tracker database (optional): run pnpm build:trackers in the extension folder, then reload the extension. Blocks apply after a reload.";
  }
}

trkReload.addEventListener("click", () => {
  if (trkTabId !== null) chrome.tabs.reload(trkTabId);
});

// Refresh the list once the reloaded page has finished loading
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === trkTabId && info.status === "complete" && document.getElementById("page-trackers").classList.contains("active")) {
    loadTrackers();
  }
});

// ═══════════════════════════════════
//  Cookie Consent (GDPR) Dismisser
// ═══════════════════════════════════
const nocookieToggle = document.getElementById("nocookieToggle");
const nocookieStatus = document.getElementById("nocookieStatus");

async function loadNoCookie() {
  const data = await chrome.storage.local.get(["nocookie_enabled"]);
  const enabled = data.nocookie_enabled !== false;
  nocookieToggle.checked = enabled;
  updateNoCookieUI(enabled);
}

function updateNoCookieUI(on) {
  nocookieStatus.textContent = on ? "ON" : "OFF";
  nocookieStatus.className = "status " + (on ? "on" : "off");
}

nocookieToggle.addEventListener("change", async () => {
  const enabled = nocookieToggle.checked;
  updateNoCookieUI(enabled);
  await chrome.storage.local.set({ nocookie_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "nocookie_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  Live CSS Editor
// ═══════════════════════════════════
const livecssHostEl = document.getElementById("livecssHost");
const livecssEditor = document.getElementById("livecssEditor");
const livecssSave = document.getElementById("livecssSave");
const livecssClear = document.getElementById("livecssClear");

let livecssHost = "";

async function loadLiveCSS() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  try { livecssHost = new URL(tab.url).hostname; } catch { livecssHost = ""; }
  livecssHostEl.textContent = livecssHost ? `Editing CSS for: ${livecssHost}` : "No accessible page";

  const key = "livecss_" + livecssHost;
  const data = await chrome.storage.local.get([key]);
  livecssEditor.value = data[key] || "";
}

// Live preview as user types
livecssEditor.addEventListener("input", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "livecss_update", css: livecssEditor.value }).catch(() => {});
  }
});

// Allow Tab key to insert spaces in textarea
livecssEditor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = livecssEditor.selectionStart;
    const end = livecssEditor.selectionEnd;
    livecssEditor.value = livecssEditor.value.substring(0, start) + "  " + livecssEditor.value.substring(end);
    livecssEditor.selectionStart = livecssEditor.selectionEnd = start + 2;
    livecssEditor.dispatchEvent(new Event("input"));
  }
});

livecssSave.addEventListener("click", async () => {
  const key = "livecss_" + livecssHost;
  await chrome.storage.local.set({ [key]: livecssEditor.value });
  livecssSave.textContent = "Saved!";
  setTimeout(() => { livecssSave.textContent = "Save"; }, 1500);
});

livecssClear.addEventListener("click", async () => {
  livecssEditor.value = "";
  const key = "livecss_" + livecssHost;
  await chrome.storage.local.remove(key);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "livecss_update", css: "" }).catch(() => {});
  }
});

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

async function loadUnhook() {
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

// ═══════════════════════════════════
//  X Unhook
// ═══════════════════════════════════
const xunhookToggle = document.getElementById("xunhookToggle");
const xunhookStatus = document.getElementById("xunhookStatus");

async function loadXUnhook() {
  const data = await chrome.storage.local.get(["xunhook_enabled"]);
  const enabled = data.xunhook_enabled !== false;
  xunhookToggle.checked = enabled;
  updateXUnhookUI(enabled);
}

function updateXUnhookUI(on) {
  xunhookStatus.textContent = on ? "ON" : "OFF";
  xunhookStatus.className = "status " + (on ? "on" : "off");
}

xunhookToggle.addEventListener("change", async () => {
  const enabled = xunhookToggle.checked;
  updateXUnhookUI(enabled);
  await chrome.storage.local.set({ xunhook_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "xunhook_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  Photopea No Ads
// ═══════════════════════════════════
const photopeaToggle = document.getElementById("photopeaToggle");
const photopeaStatus = document.getElementById("photopeaStatus");

async function loadPhotopea() {
  const data = await chrome.storage.local.get(["photopea_enabled"]);
  const enabled = data.photopea_enabled !== false;
  photopeaToggle.checked = enabled;
  updatePhotopeaUI(enabled);
}

function updatePhotopeaUI(on) {
  photopeaStatus.textContent = on ? "ON" : "OFF";
  photopeaStatus.className = "status " + (on ? "on" : "off");
}

photopeaToggle.addEventListener("change", async () => {
  const enabled = photopeaToggle.checked;
  updatePhotopeaUI(enabled);
  await chrome.storage.local.set({ photopea_enabled: enabled });

  // The width fix runs at page load, so reload any open Photopea tabs
  const tabs = await chrome.tabs.query({ url: ["*://www.photopea.com/*", "*://photopea.com/*"] });
  for (const tab of tabs) chrome.tabs.reload(tab.id).catch(() => {});
});

// ═══════════════════════════════════
//  No Paywall
// ═══════════════════════════════════
const ARCHIVE_DEFAULT_SITES = [
  "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "washingtonpost.com",
  "economist.com", "newyorker.com", "theatlantic.com", "wired.com",
  "businessinsider.com", "telegraph.co.uk", "thetimes.co.uk", "latimes.com",
  "theverge.com", "reuters.com", "fortune.com", "newscientist.com",
  "scientificamerican.com", "404media.co", "forbes.com", "technologyreview.com",
  "foreignpolicy.com", "afr.com", "smh.com.au", "theglobeandmail.com", "scmp.com",
  "chronicle.com", "ajc.com", "texasmonthly.com", "outsideonline.com", "americanbanker.com",
  "spectator.co.uk", "newstatesman.com", "irishtimes.com",
  // Netherlands / Belgium
  "nrc.nl", "volkskrant.nl", "telegraaf.nl", "parool.nl", "trouw.nl", "ad.nl", "fd.nl",
  "ftm.nl", "nd.nl", "rd.nl", "groene.nl",
  "gelderlander.nl", "bndestem.nl", "bd.nl", "ed.nl", "pzc.nl", "tubantia.nl", "destentor.nl",
  "noordhollandsdagblad.nl", "haarlemsdagblad.nl", "leidschdagblad.nl", "gooieneemlander.nl",
  "ijmuidercourant.nl", "limburger.nl", "dvhn.nl", "lc.nl",
  "standaard.be", "demorgen.be", "hln.be", "nieuwsblad.be", "gva.be", "hbvl.be", "tijd.be",
  // Germany / Austria / Switzerland
  "spiegel.de", "zeit.de", "faz.net", "sueddeutsche.de", "welt.de", "handelsblatt.com",
  "tagesspiegel.de", "derstandard.at", "diepresse.com", "nzz.ch", "tagesanzeiger.ch",
  // France / Italy / Spain
  "lemonde.fr", "lefigaro.fr", "liberation.fr", "lesechos.fr", "mediapart.fr", "lepoint.fr",
  "corriere.it", "repubblica.it", "ilsole24ore.com", "elpais.com", "elmundo.es", "lavanguardia.com",
  // Nordics
  "dn.se", "svd.se", "aftenposten.no", "hs.fi", "politiken.dk", "berlingske.dk",
];
const archiveToggle = document.getElementById("archiveToggle");
const archiveStatus = document.getElementById("archiveStatus");
const archiveSites = document.getElementById("archiveSites");

async function loadArchive() {
  const data = await chrome.storage.local.get(["archive_enabled", "archive_sites"]);
  const enabled = data.archive_enabled !== false;
  archiveToggle.checked = enabled;
  updateArchiveUI(enabled);
  const sites = Array.isArray(data.archive_sites) ? data.archive_sites : ARCHIVE_DEFAULT_SITES;
  archiveSites.value = sites.join("\n");
}

function updateArchiveUI(on) {
  archiveStatus.textContent = on ? "ON" : "OFF";
  archiveStatus.className = "status " + (on ? "on" : "off");
}

archiveToggle.addEventListener("change", () => {
  const enabled = archiveToggle.checked;
  updateArchiveUI(enabled);
  chrome.storage.local.set({ archive_enabled: enabled });
});

let archiveSaveTimer;
archiveSites.addEventListener("input", () => {
  clearTimeout(archiveSaveTimer);
  archiveSaveTimer = setTimeout(() => {
    const sites = archiveSites.value.split("\n")
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
      .filter(Boolean);
    chrome.storage.local.set({ archive_sites: sites });
  }, 300);
});

// ═══════════════════════════════════
//  Bookmark Bridge
// ═══════════════════════════════════
const bookmarksToggle = document.getElementById("bookmarksToggle");
const bookmarksStatus = document.getElementById("bookmarksStatus");
const bookmarksConn = document.getElementById("bookmarksConn");
const bookmarksBatches = document.getElementById("bookmarksBatches");
const bookmarksNote = document.getElementById("bookmarksNote");
const BOOKMARK_OP_LABELS = { create: "added", move: "moved", update: "renamed", remove: "removed" };

async function loadBookmarkBridge() {
  const data = await chrome.storage.local.get(["bookmarks_bridge_enabled", "bookmarks_batches"]);
  const enabled = !!data.bookmarks_bridge_enabled;
  bookmarksToggle.checked = enabled;
  bookmarksStatus.textContent = enabled ? "ON" : "OFF";
  bookmarksStatus.className = "status " + (enabled ? "on" : "off");
  renderBookmarkBatches(data.bookmarks_batches || []);
  if (!enabled) {
    bookmarksConn.textContent = "Off: no host runs, and no program on this computer can change your bookmarks.";
    return;
  }
  const status = await chrome.runtime.sendMessage({ type: "bookmarkBridgeStatus" }).catch(() => null);
  bookmarksConn.textContent = status?.connected
    ? "Connected to the host com.superlevels.bookmarks."
    : `Not connected${status?.error ? `: ${status.error}` : ""}. Retries every minute.`;
}

function renderBookmarkBatches(batches) {
  bookmarksBatches.replaceChildren();
  if (!batches.length) {
    bookmarksBatches.innerHTML = '<div class="empty">No changes yet</div>';
    return;
  }
  const undoable = batches.find((b) => !b.undone);
  for (const batch of batches) {
    const item = document.createElement("div");
    item.className = "item";
    const text = document.createElement("span");
    const counts = Object.entries(batch.counts)
      .map(([op, n]) => `${n} ${BOOKMARK_OP_LABELS[op] || op}`)
      .join(", ");
    const when = new Date(batch.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    text.textContent = `${batch.label} · ${when} · ${counts}` +
      (batch.undone ? " · undone" : "") + (batch.error ? ` · ${batch.error}` : "");
    item.append(text);
    if (batch === undoable) {
      const btn = document.createElement("button");
      btn.textContent = "↶";
      btn.title = "Undo this batch";
      btn.addEventListener("click", undoBookmarkBatch);
      item.append(btn);
    }
    bookmarksBatches.append(item);
  }
}

async function undoBookmarkBatch() {
  bookmarksNote.textContent = "Undoing…";
  const result = await chrome.runtime.sendMessage({ type: "bookmarkBridgeUndo" })
    .catch((e) => ({ error: e.message }));
  bookmarksNote.textContent = result?.error ? `Undo failed: ${result.error}` : "Undone.";
  loadBookmarkBridge();
}

bookmarksToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ bookmarks_bridge_enabled: bookmarksToggle.checked });
  // Give the background a moment to connect before showing the status
  setTimeout(loadBookmarkBridge, 500);
});

document.querySelectorAll("[data-bookmark-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/bookmarks/bookmarks.html#${btn.dataset.bookmarkView}`) });
  });
});

// ═══════════════════════════════════
//  X Reply Auto-Select
// ═══════════════════════════════════
const xreplyToggle = document.getElementById("xreplyToggle");
const xreplyStatus = document.getElementById("xreplyStatus");

async function loadXReply() {
  const data = await chrome.storage.local.get(["xreply_enabled"]);
  const enabled = data.xreply_enabled !== false;
  xreplyToggle.checked = enabled;
  updateXReplyUI(enabled);
}

function updateXReplyUI(on) {
  xreplyStatus.textContent = on ? "ON" : "OFF";
  xreplyStatus.className = "status " + (on ? "on" : "off");
}

xreplyToggle.addEventListener("change", async () => {
  const enabled = xreplyToggle.checked;
  updateXReplyUI(enabled);
  await chrome.storage.local.set({ xreply_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "xreply_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  JavaScript Toggle
// ═══════════════════════════════════
const jsToggle = document.getElementById("jsToggle");
const jsStatus = document.getElementById("jsStatus");
const jsIndicator = document.getElementById("jsIndicator");
const jsHostLabel = document.getElementById("jsHostLabel");

let jsHost = "";

async function loadJsToggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  // Content settings only apply to web pages (not chrome://, the new tab page, etc.)
  try {
    const url = new URL(tab.url);
    jsHost = /^https?:$/.test(url.protocol) ? url.hostname : "";
  } catch { jsHost = ""; }
  jsHostLabel.textContent = jsHost || "No accessible page";

  if (!jsHost) return;

  if (!chrome.contentSettings || !chrome.contentSettings.javascript) return;
  chrome.contentSettings.javascript.get({ primaryUrl: tab.url }, (details) => {
    const enabled = details.setting === "allow";
    jsToggle.checked = enabled;
    updateJsUI(enabled);
  });
}

function updateJsUI(enabled) {
  jsStatus.textContent = enabled ? "ENABLED" : "DISABLED";
  jsStatus.className = "status " + (enabled ? "on" : "off");
  jsIndicator.className = "indicator " + (enabled ? "on" : "off");
}

jsToggle.addEventListener("change", async () => {
  if (!jsHost) {
    jsToggle.checked = !jsToggle.checked;
    return;
  }
  const enabled = jsToggle.checked;
  updateJsUI(enabled);

  if (!chrome.contentSettings || !chrome.contentSettings.javascript) return;
  const pattern = `https://${jsHost}/*`;
  chrome.contentSettings.javascript.set({
    primaryPattern: pattern,
    setting: enabled ? "allow" : "block",
  });
  // Also set for http
  chrome.contentSettings.javascript.set({
    primaryPattern: `http://${jsHost}/*`,
    setting: enabled ? "allow" : "block",
  });

  // Reload the tab so the change takes effect
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.reload(tab.id);
});

// ═══════════════════════════════════
//  Music Recognizer (ACRCloud)
// ═══════════════════════════════════
// ACRCloud credentials — loaded from storage so they're not hardcoded in source
let ACR_HOST = "";
let ACR_KEY = "";
let ACR_SECRET = "";

// Load saved creds (set defaults on first run)
chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
  ACR_HOST = data.acr_host || "identify-eu-west-1.acrcloud.com";
  ACR_KEY = data.acr_key || "";
  ACR_SECRET = data.acr_secret || "";
});

const listenBtn = document.getElementById("listenBtn");
const listenTimer = document.getElementById("listenTimer");
const listenLabel = document.getElementById("listenLabel");
const musicResult = document.getElementById("musicResult");
const musicHistoryEl = document.getElementById("musicHistory");
let isRecording = false;

listenBtn.addEventListener("click", () => {
  if (isRecording) return;
  startListening();
});

async function startListening() {
  if (!ACR_KEY || !ACR_SECRET) {
    musicResult.innerHTML = `<div class="music-error">ACRCloud credentials not set. <a href="https://www.acrcloud.com/sign-up/" target="_blank" style="color:#6a9fd8;">Sign up free</a> and add them below.</div>`;
    showAcrConfig();
    return;
  }
  isRecording = true;
  listenBtn.classList.add("recording");
  listenBtn.closest(".music-center").classList.add("active");
  listenLabel.textContent = "Listening...";
  musicResult.innerHTML = "";

  let seconds = 10;
  listenTimer.textContent = seconds + "s";
  const interval = setInterval(() => {
    seconds--;
    listenTimer.textContent = seconds + "s";
    if (seconds <= 0) clearInterval(interval);
  }, 1000);

  try {
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (s) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!s) return reject(new Error("No audio stream"));
        resolve(s);
      });
    });

    // Pipe audio back to speakers so user still hears it
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    // Record 10 seconds
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        source.disconnect();
        audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: "audio/webm" }));
      };
      recorder.start();
      setTimeout(() => recorder.stop(), 10000);
    });

    clearInterval(interval);
    listenTimer.textContent = "";
    listenLabel.textContent = "Identifying...";

    const result = await identifyWithACR(blob);
    showResult(result);
  } catch (err) {
    clearInterval(interval);
    musicResult.innerHTML = `<div class="music-error">${esc(err.message)}</div>`;
    showAcrConfig();
  } finally {
    isRecording = false;
    listenBtn.classList.remove("recording");
    listenBtn.closest(".music-center").classList.remove("active");
    listenTimer.textContent = "";
    listenLabel.textContent = "Tap to listen";
  }
}

async function hmacSha1(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function identifyWithACR(audioBlob) {
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${ACR_KEY}\naudio\n1\n${timestamp}`;
  const signature = await hmacSha1(ACR_SECRET, stringToSign);

  const arrayBuf = await audioBlob.arrayBuffer();
  const form = new FormData();
  form.append("access_key", ACR_KEY);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", signature);
  form.append("timestamp", timestamp.toString());
  form.append("sample_bytes", arrayBuf.byteLength.toString());
  form.append("sample", audioBlob, "sample.webm");

  const resp = await fetch(`https://${ACR_HOST}/v1/identify`, { method: "POST", body: form });
  const data = await resp.json();

  if (data.status && data.status.code === 0 && data.metadata) {
    const music = data.metadata.music;
    const humming = data.metadata.humming;
    if (music && music.length > 0) return music[0];
    if (humming && humming.length > 0) return humming[0];
    throw new Error("Song recognized but no match found. Try a clearer part of the track.");
  } else if (data.status && data.status.code === 0) {
    throw new Error("No match found. Try during a clearer part of the song (e.g. chorus).");
  } else if (data.status && data.status.code === 1001) {
    throw new Error("No music detected. Make sure audio is playing in the tab.");
  } else {
    throw new Error(data.status ? data.status.msg : "Unknown error");
  }
}

function showResult(song) {
  const title = song.title || "Unknown";
  const artist = (song.artists || []).map((a) => a.name).join(", ") || "Unknown";
  const album = song.album ? song.album.name : "";

  const ytQuery = encodeURIComponent(`${title} ${artist}`);
  const ytUrl = `https://www.youtube.com/results?search_query=${ytQuery}`;

  musicResult.innerHTML = `
    <a class="song-card" href="${ytUrl}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer;">
      <div class="art">🎵</div>
      <div class="info">
        <div class="title">${esc(title)}</div>
        <div class="artist">${esc(artist)}</div>
        ${album ? `<div class="album">${esc(album)}</div>` : ""}
      </div>
      <div style="color:#e94560;font-size:18px;flex-shrink:0;">▶</div>
    </a>
  `;

  // Save to history
  chrome.storage.local.get(["music_history"], (data) => {
    const history = data.music_history || [];
    history.unshift({ title, artist, album, time: Date.now() });
    if (history.length > 20) history.length = 20;
    chrome.storage.local.set({ music_history: history }, loadMusicHistory);
  });
}

// ACR config save/load
document.getElementById("acrSaveBtn").addEventListener("click", () => {
  const host = document.getElementById("acrHost").value.trim();
  const key = document.getElementById("acrKey").value.trim();
  const secret = document.getElementById("acrSecret").value.trim();
  ACR_HOST = host || ACR_HOST;
  ACR_KEY = key;
  ACR_SECRET = secret;
  chrome.storage.local.set({ acr_host: ACR_HOST, acr_key: ACR_KEY, acr_secret: ACR_SECRET });
  document.getElementById("acrSaveBtn").textContent = "Saved!";
  setTimeout(() => { document.getElementById("acrSaveBtn").textContent = "Save"; }, 1500);
});

function showAcrConfig() {
  document.getElementById("acrConfig").style.display = "";
}

document.getElementById("acrSettingsBtn").addEventListener("click", () => {
  const cfg = document.getElementById("acrConfig");
  if (cfg.style.display === "none") {
    cfg.style.display = "";
    // Load fields without the auto-hide logic
    chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
      document.getElementById("acrHost").value = data.acr_host || "identify-eu-west-1.acrcloud.com";
      document.getElementById("acrKey").value = data.acr_key || "";
      document.getElementById("acrSecret").value = data.acr_secret || "";
    });
  } else {
    cfg.style.display = "none";
  }
});

// Load ACR fields when music tab opens
function loadAcrFields() {
  chrome.storage.local.get(["acr_host", "acr_key", "acr_secret"], (data) => {
    document.getElementById("acrHost").value = data.acr_host || "identify-eu-west-1.acrcloud.com";
    document.getElementById("acrKey").value = data.acr_key || "";
    document.getElementById("acrSecret").value = data.acr_secret || "";
    // Only show config if creds are missing
    if (!data.acr_key || !data.acr_secret) showAcrConfig();
    else document.getElementById("acrConfig").style.display = "none";
  });
}

function loadMusicHistory() {
  chrome.storage.local.get(["music_history"], (data) => {
    const history = data.music_history || [];
    if (!history.length) {
      musicHistoryEl.innerHTML = "";
      return;
    }
    musicHistoryEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><h2>Recent</h2><button id="clearHistory" style="background:none;border:none;color:#e94560;font-size:11px;cursor:pointer;">Clear</button></div>` + history.map((h) => {
      const q = encodeURIComponent(`${h.title} ${h.artist}`);
      return `<a class="history-item" href="https://www.youtube.com/results?search_query=${q}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer;">
        <span class="h-title">${esc(h.title)}</span>
        <span class="h-artist">${esc(h.artist)}</span>
        <span style="color:#e94560;font-size:12px;flex-shrink:0;">▶</span>
      </a>`;
    }).join("");
    document.getElementById("clearHistory").addEventListener("click", () => {
      chrome.storage.local.remove("music_history", loadMusicHistory);
    });
  });
}

// ═══════════════════════════════════
//  Picture-in-Picture
// ═══════════════════════════════════
const pipBtn = document.getElementById("pipBtn");
const pipLabel = document.getElementById("pipLabel");
const pipStatus = document.getElementById("pipStatus");

pipBtn.addEventListener("click", enterPiP);

async function enterPiP() {
  pipStatus.textContent = "";
  pipStatus.className = "pip-status";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    pipStatus.textContent = "No active tab";
    pipStatus.className = "pip-status err";
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: "pip", tabId: tab.id });
    if (!result) {
      pipStatus.textContent = "Could not access page";
      pipStatus.className = "pip-status err";
    } else if (result.error) {
      pipStatus.textContent = result.error;
      pipStatus.className = "pip-status err";
    } else if (result.action === "entered") {
      pipStatus.textContent = "Video in Picture-in-Picture";
      pipStatus.className = "pip-status ok";
      pipBtn.classList.add("active");
    } else if (result.action === "exited") {
      pipStatus.textContent = "Exited Picture-in-Picture";
      pipStatus.className = "pip-status ok";
      pipBtn.classList.remove("active");
    }
  } catch (err) {
    pipStatus.textContent = err.message;
    pipStatus.className = "pip-status err";
  }
}

// ═══════════════════════════════════
//  JSON Formatter
// ═══════════════════════════════════
const jsonformatToggle = document.getElementById("jsonformatToggle");
const jsonformatStatus = document.getElementById("jsonformatStatus");

async function loadJsonFormat() {
  const data = await chrome.storage.local.get(["jsonformat_enabled"]);
  const enabled = data.jsonformat_enabled !== false;
  jsonformatToggle.checked = enabled;
  updateJsonFormatUI(enabled);
}

function updateJsonFormatUI(on) {
  jsonformatStatus.textContent = on ? "ON" : "OFF";
  jsonformatStatus.className = "status " + (on ? "on" : "off");
}

jsonformatToggle.addEventListener("change", async () => {
  const enabled = jsonformatToggle.checked;
  updateJsonFormatUI(enabled);
  await chrome.storage.local.set({ jsonformat_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "jsonformat_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  AI Summarize
// ═══════════════════════════════════
const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o",
    signup: "https://platform.openai.com/api-keys",
    keyHint: "(sk-...)",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-opus-5-5",
    signup: "https://console.anthropic.com/settings/keys",
    keyHint: "(sk-ant-...)",
  },
  xai: {
    label: "xAI",
    defaultModel: "grok-4",
    signup: "https://console.x.ai/",
    keyHint: "(xai-...)",
  },
};

const LENGTH_PROMPTS = {
  brief: "Summarize it in 3-4 clear sentences.",
  bullets: "Summarize it as 5-8 concise bullet points, each starting with '- '.",
  detailed: "Write a detailed summary with a short intro paragraph followed by key points.",
};

const aiProviderEl = document.getElementById("aiProvider");
const aiLengthEl = document.getElementById("aiLength");
const aiKeyEl = document.getElementById("aiKey");
const aiModelEl = document.getElementById("aiModel");
const aiResultEl = document.getElementById("aiResult");
const aiConfigEl = document.getElementById("aiConfig");
const summarizeBtn = document.getElementById("summarizeBtn");

function loadSummarize() {
  chrome.storage.local.get(["ai_provider", "ai_length"], (data) => {
    aiProviderEl.value = data.ai_provider || "openai";
    if (data.ai_length) aiLengthEl.value = data.ai_length;
    refreshAiProviderFields();
  });
}

// Populate key + model inputs and signup link for the currently selected provider
function refreshAiProviderFields() {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  chrome.storage.local.get(
    [`ai_key_${provider}`, `ai_model_${provider}`],
    (data) => {
      const key = data[`ai_key_${provider}`] || "";
      aiKeyEl.value = key;
      aiModelEl.value = data[`ai_model_${provider}`] || cfg.defaultModel;
      document.getElementById("aiSignupLink").href = cfg.signup;
      document.getElementById("aiKeyHint").textContent = cfg.keyHint;
      // Auto-open config if no key saved for this provider yet
      aiConfigEl.style.display = key ? "none" : "block";
    }
  );
}

aiProviderEl.addEventListener("change", () => {
  chrome.storage.local.set({ ai_provider: aiProviderEl.value });
  refreshAiProviderFields();
});

aiLengthEl.addEventListener("change", () => {
  chrome.storage.local.set({ ai_length: aiLengthEl.value });
});

document.getElementById("aiSettingsBtn").addEventListener("click", () => {
  aiConfigEl.style.display = aiConfigEl.style.display === "none" ? "block" : "none";
});

document.getElementById("aiSaveBtn").addEventListener("click", () => {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  chrome.storage.local.set(
    {
      [`ai_key_${provider}`]: aiKeyEl.value.trim(),
      [`ai_model_${provider}`]: aiModelEl.value.trim() || cfg.defaultModel,
    },
    () => {
      aiConfigEl.style.display = "none";
    }
  );
});

function showAiResult(html, cls) {
  aiResultEl.className = "ai-result show";
  aiResultEl.innerHTML = cls === "err" ? `<span class="ai-err">${html}</span>` : html;
}

// Grab the visible text of the active tab, capped to keep token use sane
function extractPageText() {
  const el = document.querySelector("main, article") || document.body;
  const text = (el.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 20000) };
}

summarizeBtn.addEventListener("click", async () => {
  const provider = aiProviderEl.value;
  const cfg = AI_PROVIDERS[provider];
  const key = aiKeyEl.value.trim();
  const model = aiModelEl.value.trim() || cfg.defaultModel;

  if (!key) {
    aiConfigEl.style.display = "block";
    showAiResult(`Add your ${cfg.label} API key first.`, "err");
    return;
  }

  summarizeBtn.disabled = true;
  showAiResult(`<span class="ai-spin">Reading page…</span>`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
      throw new Error("Can't read this page. Open a normal website tab.");
    }
    const [{ result: page } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText,
    });
    if (!page || !page.text) throw new Error("No readable text found on this page.");

    showAiResult(`<span class="ai-spin">Summarizing with ${cfg.label}…</span>`);

    const system =
      "You are a helpful assistant that summarizes web pages. Be accurate and concise. Use plain text with '- ' for bullet points.";
    const user =
      `Summarize this web page. ${LENGTH_PROMPTS[aiLengthEl.value]}\n\n` +
      `Title: ${page.title}\nURL: ${page.url}\n\n${page.text}`;

    const summary = await callAiProvider(provider, model, key, system, user);
    renderSummary(summary);
    chrome.storage.local.set({ ai_length: aiLengthEl.value });
  } catch (err) {
    showAiResult(esc(err.message || "Something went wrong."), "err");
  } finally {
    summarizeBtn.disabled = false;
  }
});

// Dispatch to the right provider API. Returns the summary text.
async function callAiProvider(provider, model, key, system, user) {
  let url, headers, body, pick;

  if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // Required for calling the API directly from a browser/extension context
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = {
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    };
    pick = (d) => (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } else {
    // OpenAI and xAI share the OpenAI-compatible chat completions shape
    url =
      provider === "xai"
        ? "https://api.x.ai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", Authorization: `Bearer ${key}` };
    body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    pick = (d) => d.choices?.[0]?.message?.content || "";
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.type || `HTTP ${res.status}`;
    throw new Error(`${AI_PROVIDERS[provider].label}: ${msg}`);
  }
  const text = pick(data);
  if (!text) throw new Error("Empty response from provider.");
  return text.trim();
}

// Minimal safe markdown: escape, then **bold**, and '- ' bullet lists
function renderSummary(text) {
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+/.test(line);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${fmtInline(line.replace(/^[-*•]\s+/, ""))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line) html += `<p style="margin:6px 0">${fmtInline(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  showAiResult(`<button class="ai-copy" id="aiCopyBtn">Copy</button>${html}`);
  document.getElementById("aiCopyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      const b = document.getElementById("aiCopyBtn");
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    });
  });
}

function fmtInline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

// ═══════════════════════════════════
//  Helpers
// ═══════════════════════════════════
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function escA(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
