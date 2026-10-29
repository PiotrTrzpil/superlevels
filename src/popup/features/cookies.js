// ═══════════════════════════════════
//  Cookie Editor
// ═══════════════════════════════════
import { esc, escA } from "../lib/dom.js";

const cookieDomainEl = document.getElementById("cookieDomain");
const cookieCountEl = document.getElementById("cookieCount");
const cookieListEl = document.getElementById("cookieList");

let currentUrl = "";
let currentDomain = "";
let allCookies = [];

export async function loadCookies() {
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
