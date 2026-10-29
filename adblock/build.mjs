#!/usr/bin/env node
// ═══════════════════════════════════
//  superlevels: Ad Block list compiler
//  Turns EasyList + EasyPrivacy into the files the extension ships:
//    rules.json    — declarativeNetRequest ruleset (network blocking)
//    generic.css   — generic element hiding, injected on every site
//    cosmetic.json — site-specific element hiding + exceptions
//    meta.json     — build version; its presence turns Ad Block on
//  The outputs aren't committed: Ad Block is optional, and the extension
//  works without them.
//  ABP network filters map almost 1:1 onto DNR (urlFilter uses the same
//  ||, ^, * and | syntax). Filters DNR can't express — regexes, redirects,
//  $csp, $removeparam, popups — are skipped, as are scriptlets (+js) and
//  procedural cosmetic filters (#?#).
//
//  Usage: node adblock/build.mjs [easylist.txt easyprivacy.txt]
//  With no arguments the lists are downloaded from easylist.to.
// ═══════════════════════════════════
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const LISTS = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
];
const DOMAINS_PER_RULE = 1000;
// The rules are loaded as dynamic rules, capped at 30,000 per extension;
// leave room for the per-site pause rule
const MAX_RULES = 29000;
// Far fewer means a download went wrong (e.g. an error page served as 200)
const MIN_RULES = 5000;
const MIN_SELECTORS = 1000;
// Exceptions beat blocks, $important blocks beat exceptions. The per-site
// pause rule (dynamic, priority 100 in background.js) beats everything.
const PRIORITY = { block: 1, allow: 2, important: 3 };

const TYPE_MAP = {
  script: "script", image: "image", stylesheet: "stylesheet", css: "stylesheet",
  object: "object", xmlhttprequest: "xmlhttprequest", xhr: "xmlhttprequest",
  subdocument: "sub_frame", frame: "sub_frame", ping: "ping", beacon: "ping",
  media: "media", font: "font", websocket: "websocket", other: "other",
};
const ALL_TYPES = ["main_frame", ...new Set(Object.values(TYPE_MAP))];
// Options that don't change which requests match — safe to ignore
const IGNORED_OPTIONS = new Set(["~popup", "~document", "~match-case"]);
// Extended (non-CSS) pseudo-classes that would make a selector invalid
const NON_CSS = /:-abp-|:has-text\(|:contains\(|:xpath\(|:upward\(|:matches-css|:style\(|:remove\(|:matches-path|:min-text-length|:watch-attr|:others\(|:matches-attr|:if\(|:if-not\(/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

async function loadLists(paths) {
  if (paths.length) return Promise.all(paths.map((p) => readFile(p, "utf8")));
  return Promise.all(LISTS.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  }));
}

// ── Network filters ──

// Parse one network filter into a DNR rule (minus id), or null if DNR
// can't express it
function parseNetwork(line) {
  const allow = line.startsWith("@@");
  if (allow) line = line.slice(2);

  const dollar = line.lastIndexOf("$");
  let pattern = dollar === -1 ? line : line.slice(0, dollar);
  const options = dollar === -1 ? [] : line.slice(dollar + 1).split(",");

  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 1) return null; // regex
  if (!/^[\x21-\x7e]*$/.test(pattern)) return null; // urlFilter must be ASCII

  const condition = {};
  const types = new Set();
  const excludedTypes = new Set();
  let important = false;
  let wholePage = false; // @@...$document — allowlist the whole page

  for (const opt of options) {
    const [name, value] = opt.split("=");
    const neg = name.startsWith("~");
    const key = neg ? name.slice(1) : name;
    if (IGNORED_OPTIONS.has(name)) continue;
    if (key in TYPE_MAP) (neg ? excludedTypes : types).add(TYPE_MAP[key]);
    else if (key === "third-party" || key === "3p") condition.domainType = neg ? "firstParty" : "thirdParty";
    else if (key === "first-party" || key === "1p") condition.domainType = neg ? "thirdParty" : "firstParty";
    else if (name === "match-case") condition.isUrlFilterCaseSensitive = true;
    else if (name === "important") important = true;
    else if (name === "document" || name === "doc") {
      if (allow) wholePage = true;
      else types.add("main_frame");
    } else if (name === "all") ALL_TYPES.forEach((t) => types.add(t));
    else if (name === "domain" || name === "from") {
      const domains = value.split("|");
      if (domains.some((d) => d.includes("*") || !DOMAIN_RE.test(d.replace(/^~/, "")))) return null;
      const inc = domains.filter((d) => !d.startsWith("~"));
      const exc = domains.filter((d) => d.startsWith("~")).map((d) => d.slice(1));
      if (inc.length) condition.initiatorDomains = inc;
      if (exc.length) condition.excludedInitiatorDomains = exc;
    } else return null; // $popup, $redirect, $csp, $removeparam, $generichide, …
  }

  if (pattern === "" || pattern === "*") {
    // A filter that's only options (e.g. `$script,domain=x.com`) needs a
    // domain condition, otherwise it would match everything
    if (!condition.initiatorDomains) return null;
    pattern = "";
  }
  if (pattern.startsWith("||*")) pattern = pattern.slice(2); // invalid in DNR
  if (pattern) condition.urlFilter = pattern;

  if (wholePage) {
    if (types.size || excludedTypes.size) return null;
    return { priority: PRIORITY.allow, action: { type: "allowAllRequests" }, condition: { ...condition, resourceTypes: ["main_frame", "sub_frame"] } };
  }
  if (types.size) condition.resourceTypes = [...types].filter((t) => !excludedTypes.has(t));
  else if (excludedTypes.size) condition.excludedResourceTypes = [...excludedTypes];
  if (condition.resourceTypes?.length === 0) return null;

  const priority = allow ? PRIORITY.allow : important ? PRIORITY.important : PRIORITY.block;
  return { priority, action: { type: allow ? "allow" : "block" }, condition };
}

// `||domain^` blocks with no other condition (besides third-party) are
// merged into a few big requestDomains rules — far cheaper than one rule each
function plainDomain(rule) {
  const { condition: c, action, priority } = rule;
  if (action.type !== "block" || priority !== PRIORITY.block) return null;
  const m = c.urlFilter?.match(/^\|\|([a-z0-9.-]+)\^$/);
  if (!m || !DOMAIN_RE.test(m[1])) return null;
  const extra = Object.keys(c).filter((k) => k !== "urlFilter" && !(k === "domainType" && c.domainType === "thirdParty"));
  return extra.length ? null : { domain: m[1], thirdParty: !!c.domainType };
}

// Drop domains already covered by a parent domain in the same set
function collapse(domains) {
  return [...domains].filter((d) => {
    for (let i = d.indexOf("."); i !== -1; i = d.indexOf(".", i + 1)) {
      if (domains.has(d.slice(i + 1))) return false;
    }
    return true;
  }).sort();
}

function compileNetwork(lines) {
  const anyParty = new Set();
  const thirdParty = new Set();
  const others = new Map(); // dedupe by JSON
  let skipped = 0;

  for (const line of lines) {
    const rule = parseNetwork(line);
    if (!rule) { skipped++; continue; }
    const plain = plainDomain(rule);
    if (plain) (plain.thirdParty ? thirdParty : anyParty).add(plain.domain);
    else others.set(JSON.stringify(rule), rule);
  }
  for (const d of anyParty) thirdParty.delete(d);

  const rules = [];
  const pushDomains = (domains, condition) => {
    for (let i = 0; i < domains.length; i += DOMAINS_PER_RULE) {
      rules.push({ priority: PRIORITY.block, action: { type: "block" }, condition: { requestDomains: domains.slice(i, i + DOMAINS_PER_RULE), ...condition } });
    }
  };
  pushDomains(collapse(anyParty), {});
  pushDomains(collapse(thirdParty), { domainType: "thirdParty" });
  // Exceptions first so they survive the cap, then blocks
  const sorted = [...others.values()].sort((a, b) => (b.action.type !== "block") - (a.action.type !== "block"));
  rules.push(...sorted);

  if (rules.length > MAX_RULES) {
    console.warn(`warning: ${rules.length} rules, keeping the first ${MAX_RULES}`);
    rules.length = MAX_RULES;
  }
  // Rule ids are assigned when background.js loads the rules
  return { rules, skipped };
}

// Chrome rejects the whole updateDynamicRules call if any rule is invalid,
// so catch anything the parser shouldn't have produced here
const ACTIONS = new Set(["block", "allow", "allowAllRequests"]);
const RESOURCE_TYPES = new Set(ALL_TYPES);
function ruleError(rule) {
  const { priority, action, condition: c, ...extra } = rule;
  if (Object.keys(extra).length) return `unexpected keys ${Object.keys(extra)}`;
  if (!Number.isInteger(priority) || priority < 1) return "bad priority";
  if (!ACTIONS.has(action?.type)) return "bad action";
  if (!c || !Object.keys(c).length) return "empty condition";
  if (c.urlFilter !== undefined && (!c.urlFilter || !/^[\x21-\x7e]+$/.test(c.urlFilter) || c.urlFilter.startsWith("||*"))) return "bad urlFilter";
  for (const key of ["requestDomains", "initiatorDomains", "excludedInitiatorDomains"]) {
    if (c[key] !== undefined && (!c[key].length || !c[key].every((d) => DOMAIN_RE.test(d)))) return `bad ${key}`;
  }
  for (const key of ["resourceTypes", "excludedResourceTypes"]) {
    if (c[key] !== undefined && (!c[key].length || !c[key].every((t) => RESOURCE_TYPES.has(t)))) return `bad ${key}`;
  }
  if (c.domainType !== undefined && !["firstParty", "thirdParty"].includes(c.domainType)) return "bad domainType";
  return null;
}

// ── Cosmetic filters ──

function addTo(map, key, value) {
  (map[key] ??= new Set()).add(value);
}

function mapToObject(map, keep = () => true) {
  const out = {};
  for (const host of Object.keys(map).sort()) {
    const sels = [...map[host]].filter(keep).sort();
    if (sels.length) out[host] = sels;
  }
  return out;
}

function compileCosmetic(lines) {
  const generic = new Set();
  const specific = {};   // host → selectors
  const exceptions = {}; // host → selectors (#@#)
  const generichide = new Set(); // hosts with generic hiding off
  const elemhide = new Set();    // hosts with all hiding off

  for (const line of lines) {
    const hide = line.match(/^@@\|\|([a-z0-9.-]+)\^?\$(generichide|ghide|elemhide|ehide)$/);
    if (hide) {
      if (DOMAIN_RE.test(hide[1])) (hide[2].startsWith("g") ? generichide : elemhide).add(hide[1]);
      continue;
    }

    const m = line.match(/^([^#]*)(##|#@#)(.+)$/);
    if (!m) continue;
    const [, domainList, sep, selector] = m;
    if (NON_CSS.test(selector) || /[{}]/.test(selector) || selector.startsWith("+js(")) continue;
    const domains = domainList ? domainList.split(",") : [];
    if (domains.some((d) => d.includes("*"))) continue; // example.* — not supported
    const include = domains.filter((d) => !d.startsWith("~"));
    const exclude = domains.filter((d) => d.startsWith("~")).map((d) => d.slice(1));

    if (sep === "#@#") {
      for (const d of include) addTo(exceptions, d, selector);
    } else if (include.length === 0) {
      generic.add(selector);
      for (const d of exclude) addTo(exceptions, d, selector);
    } else {
      for (const d of include) addTo(specific, d, selector);
      for (const d of exclude) addTo(exceptions, d, selector);
    }
  }

  // Generic selectors that some site un-hides can't go in the global
  // stylesheet; they're injected per site instead, minus the exceptions.
  const excepted = new Set(Object.values(exceptions).flatMap((s) => [...s]).filter((s) => generic.has(s)));
  for (const s of excepted) generic.delete(s);

  return {
    generic: [...generic].sort(),
    cosmetic: {
      excepted: [...excepted].sort(),
      specific: mapToObject(specific, (s) => !generic.has(s)),
      exceptions: mapToObject(exceptions),
      generichide: [...generichide].sort(),
      elemhide: [...elemhide].sort(),
    },
  };
}

// ── Main ──

const texts = await loadLists(process.argv.slice(2));
const lines = texts.flatMap((t) => t.split("\n")).map((l) => l.trim())
  .filter((l) => l && !l.startsWith("!") && !l.startsWith("["));
const isCosmetic = (l) => /#[@?$%]?#/.test(l) && !l.startsWith("@@") && !l.startsWith("||") && !l.startsWith("|");

const { rules, skipped } = compileNetwork(lines.filter((l) => !isCosmetic(l)));
const { generic, cosmetic } = compileCosmetic(lines);

const invalid = rules.map((r) => [ruleError(r), r]).filter(([e]) => e);
if (invalid.length) {
  for (const [e, r] of invalid.slice(0, 5)) console.error(`${e}: ${JSON.stringify(r)}`);
  throw new Error(`${invalid.length} invalid rules, nothing written`);
}
if (rules.length < MIN_RULES || generic.length < MIN_SELECTORS) {
  throw new Error(`only ${rules.length} rules and ${generic.length} selectors; are the lists right? Nothing written`);
}

// One rule per selector: an invalid selector then only drops itself,
// not the whole selector list it's grouped with
const files = {
  "rules.json": "[\n" + rules.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n",
  "generic.css": generic.map((s) => `${s}{display:none!important}`).join("\n") + "\n",
  "cosmetic.json": JSON.stringify(cosmetic) + "\n",
};
const hash = createHash("sha256");
for (const text of Object.values(files)) hash.update(text);
// Written last: background.js only uses the other files once this exists
files["meta.json"] = JSON.stringify({
  version: hash.digest("hex").slice(0, 16),
  builtAt: new Date().toISOString(),
  rules: rules.length,
  selectors: generic.length,
}) + "\n";

// Write everything to temp files first, so an interrupted build can't
// leave a mix of old and new outputs
for (const [name, text] of Object.entries(files)) await writeFile(join(OUT_DIR, name + ".tmp"), text);
for (const name of Object.keys(files)) await rename(join(OUT_DIR, name + ".tmp"), join(OUT_DIR, name));

const domains = rules.reduce((n, r) => n + (r.condition.requestDomains?.length ?? 0), 0);
console.log(`rules.json     ${rules.length} rules (${domains} domains merged), ${skipped} filters skipped`);
console.log(`generic.css    ${generic.length} selectors`);
console.log(`cosmetic.json  ${Object.keys(cosmetic.specific).length} sites, ${cosmetic.excepted.length} excepted generic selectors`);
