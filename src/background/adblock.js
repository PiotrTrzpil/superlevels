// ═══════════════════════════════════
//  Ad Block — EasyList + EasyPrivacy compiled to declarativeNetRequest
//  (scripts/build-adblock.mjs). Chrome does the network blocking itself; here we
//  only load the rules, keep the per-site pause rule, and inject the
//  element-hiding CSS for ad slots the blocked requests leave behind.
//  Optional: the lists aren't committed, and until they're built Ad Block
//  stays off. That's why they're dynamic rules rather than a static
//  ruleset — a manifest ruleset whose file is missing stops the whole
//  extension from loading.
// ═══════════════════════════════════
import { createQueue, onLocalChange } from "./lib.js";
import { handle } from "./messages.js";
import { ADBLOCK_LIST_RULES, ADBLOCK_PAUSE_RULE_ID } from "./rule-ids.js";

const ADBLOCK_CSS_ID = "sl-adblock-generic";

// data/adblock/meta.json is written last by the build; null when not built
let adblockMeta;
function getAdblockMeta() {
  adblockMeta ??= fetch(chrome.runtime.getURL("data/adblock/meta.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return adblockMeta;
}

// Output file of the core lists, or of an extra list ("cookies", …)
const adblockFile = (extra, kind) => `data/adblock/${extra ? `extra-${extra}.` : ""}${kind}`;
const fetchJson = (path) => fetch(chrome.runtime.getURL(path)).then((r) => r.json());

// Cosmetic rules of the core lists merged with the enabled extras, cached
// per combination
let adblockCosmetic = { key: null, value: null };
function getAdblockCosmetic(extras) {
  const key = extras.join(",");
  if (adblockCosmetic.key !== key) {
    const value = Promise.all([null, ...extras].map((e) => fetchJson(adblockFile(e, "cosmetic.json")))).then((lists) => {
      const merged = { excepted: [], specific: {}, exceptions: {}, generichide: new Set(), elemhide: new Set() };
      for (const c of lists) {
        merged.excepted.push(...c.excepted);
        for (const field of ["specific", "exceptions"]) {
          for (const [host, sels] of Object.entries(c[field])) (merged[field][host] ??= []).push(...sels);
        }
        c.generichide.forEach((h) => merged.generichide.add(h));
        c.elemhide.forEach((h) => merged.elemhide.add(h));
      }
      return merged;
    });
    adblockCosmetic = { key, value };
  }
  return adblockCosmetic.value;
}

async function getAdblockSettings() {
  const [d, meta] = await Promise.all([
    chrome.storage.local.get(["adblock_enabled", "adblock_paused", "adblock_extras"]),
    getAdblockMeta(),
  ]);
  // Only extras this build has (a list may have been dropped since)
  const built = new Set((meta?.extras || []).map((e) => e.id));
  const extras = (d.adblock_extras || []).filter((id) => built.has(id)).sort();
  return { enabled: d.adblock_enabled !== false && !!meta, paused: d.adblock_paused || [], meta, extras };
}

// Dynamic rules persist across worker restarts and extension reloads, so
// they're only replaced when a different build or set of lists is wanted
// (null: none)
async function loadAdblockRules(version, extras) {
  const dnr = chrome.declarativeNetRequest;
  const wanted = version && [version, ...extras].join(":");
  const { adblock_rules_version = null } = await chrome.storage.local.get(["adblock_rules_version"]);
  if (adblock_rules_version === wanted) return;
  const rules = wanted
    ? (await Promise.all([null, ...extras].map((e) => fetchJson(adblockFile(e, "rules.json"))))).flat()
    : [];
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id)
      .filter((id) => id >= ADBLOCK_LIST_RULES.first && id <= ADBLOCK_LIST_RULES.last),
    addRules: rules.map((r, i) => ({ ...r, id: ADBLOCK_LIST_RULES.first + i })),
  });
  await chrome.storage.local.set({ adblock_rules_version: wanted });
}

// "a.b.example.com" → ["a.b.example.com", "b.example.com", "example.com"]
function hostChain(host) {
  const parts = host.split(".");
  return parts.slice(0, Math.max(1, parts.length - 1)).map((_, i) => parts.slice(i).join("."));
}

// Serialize so a toggle during startup can't race the initial sync
const adblockQueue = createQueue();
function syncAdblock() {
  return adblockQueue(doSyncAdblock).catch((e) => console.warn("adblock sync:", e));
}

async function doSyncAdblock() {
  const { enabled, paused, meta, extras } = await getAdblockSettings();
  const dnr = chrome.declarativeNetRequest;

  await loadAdblockRules(enabled ? meta.version : null, extras);
  // Paused sites: allow everything in pages whose top frame is on that site
  await dnr.updateDynamicRules({
    removeRuleIds: [ADBLOCK_PAUSE_RULE_ID],
    addRules: enabled && paused.length ? [{
      id: ADBLOCK_PAUSE_RULE_ID,
      priority: 100,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: paused, resourceTypes: ["main_frame"] },
    }] : [],
  });
  await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: enabled });

  // Generic hiding CSS goes on every site except paused ones and those the
  // lists exempt ($generichide) — re-register to update the exclusions
  await chrome.scripting.unregisterContentScripts({ ids: [ADBLOCK_CSS_ID] }).catch(() => {});
  if (!enabled) return;
  const cosmetic = await getAdblockCosmetic(extras);
  const exempt = [...paused, ...cosmetic.generichide, ...cosmetic.elemhide];
  await chrome.scripting.registerContentScripts([{
    id: ADBLOCK_CSS_ID,
    matches: ["<all_urls>"],
    excludeMatches: exempt.map((h) => `*://*.${h}/*`),
    css: [null, ...extras].map((e) => adblockFile(e, e ? "css" : "generic.css")),
    runAt: "document_start",
    allFrames: true,
  }]);
}

syncAdblock();
chrome.runtime.onInstalled.addListener(syncAdblock);
onLocalChange(["adblock_enabled", "adblock_paused", "adblock_extras"], syncAdblock);
handle("adblockSync", syncAdblock);

// Site-specific hiding rules, plus generic selectors some sites un-hide
// (so they can't live in the global stylesheet)
async function adblockCssFor(host) {
  const { enabled, paused, extras } = await getAdblockSettings();
  if (!enabled) return "";
  const chain = hostChain(host);
  if (chain.some((h) => paused.includes(h))) return "";
  const c = await getAdblockCosmetic(extras);
  if (chain.some((h) => c.elemhide.has(h))) return "";

  const selectors = chain.flatMap((h) => c.specific[h] || []);
  if (!chain.some((h) => c.generichide.has(h))) selectors.push(...c.excepted);
  const exceptions = new Set(chain.flatMap((h) => c.exceptions[h] || []));
  return selectors
    .filter((s) => !exceptions.has(s))
    .map((s) => `${s}{display:none!important}`)
    .join("\n");
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  let host;
  try { host = new URL(url).hostname; } catch { return; }
  if (!/^https?:/.test(url)) return;
  const css = await adblockCssFor(host);
  if (!css) return;
  chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css, origin: "USER" }).catch(() => {});
});
