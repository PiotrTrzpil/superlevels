// ═══════════════════════════════════
//  Redirect Tracer
// ═══════════════════════════════════
import { handle } from "./messages.js";

// { tabId: { chain: [{url, statusCode, statusLine}], finalUrl, finalStatus } }
// Mirrored to storage.session per tab, so the popup still gets the chain after
// the service worker was killed while idle.
const redirectData = {};
const redirectKey = (tabId) => "redirects_" + tabId;

function saveRedirects(tabId) {
  chrome.storage.session.set({ [redirectKey(tabId)]: redirectData[tabId] });
}

async function getRedirects(tabId) {
  if (redirectData[tabId]) return redirectData[tabId];
  const key = redirectKey(tabId);
  const { [key]: saved } = await chrome.storage.session.get([key]);
  return saved || { chain: [], finalUrl: null, finalStatus: null };
}

// When a new main-frame navigation starts, reset the chain
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
  saveRedirects(details.tabId);
});

// Capture each redirect hop
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    if (!redirectData[details.tabId]) {
      redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
    }
    redirectData[details.tabId].chain.push({
      url: details.url,
      statusCode: details.statusCode,
      statusLine: details.statusLine || "",
      redirectUrl: details.redirectUrl,
    });
    saveRedirects(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// Capture final completed request
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    if (!redirectData[details.tabId]) {
      redirectData[details.tabId] = { chain: [], finalUrl: null, finalStatus: null };
    }
    redirectData[details.tabId].finalUrl = details.url;
    redirectData[details.tabId].finalStatus = details.statusCode;
    saveRedirects(details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete redirectData[tabId];
  chrome.storage.session.remove(redirectKey(tabId));
});

handle("getRedirects", ({ tabId }) => getRedirects(tabId));
