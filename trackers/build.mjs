#!/usr/bin/env node
// ═══════════════════════════════════
//  superlevels: tracker database for the Trackers panel
//  Builds trackers/db.json (domain → tracker → company + category) from
//  AdGuard's companiesdb, which converts the WhoTracks.Me database to JSON.
//  Licence: CC BY-SA 4.0 (WhoTracks.Me data: CC BY 4.0). That's why the
//  output isn't committed and is credited in the panel; the panel still
//  works without it, just without names and categories.
//  (Ghostery's TrackerDB, DuckDuckGo Tracker Radar and Disconnect are all
//  CC BY-NC-SA, i.e. no commercial use, so they're not used.)
//
//  Usage: node trackers/build.mjs [trackers.json companies.json]
//  With no arguments both files are downloaded from GitHub.
// ═══════════════════════════════════
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "db.json");
const BASE = "https://raw.githubusercontent.com/AdguardTeam/companiesdb/main/dist/";
const SOURCES = ["trackers.json", "companies.json"];
// Far fewer means a download went wrong
const MIN_DOMAINS = 2000;

async function load(paths) {
  const texts = paths.length
    ? await Promise.all(paths.map((p) => readFile(p, "utf8")))
    : await Promise.all(SOURCES.map(async (name) => {
      const res = await fetch(BASE + name);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return res.text();
    }));
  return texts.map((t) => JSON.parse(t));
}

const [src, { companies }] = await load(process.argv.slice(2));

// Compact form: trackers[id] = [name, category, company or null]
const trackers = {};
for (const [id, t] of Object.entries(src.trackers)) {
  trackers[id] = [t.name, src.categories[t.categoryId] ?? "unknown", companies[t.companyId]?.name ?? null];
}
const domains = {};
for (const [domain, id] of Object.entries(src.trackerDomains)) {
  if (trackers[id]) domains[domain] = id;
}
if (Object.keys(domains).length < MIN_DOMAINS) {
  throw new Error(`only ${Object.keys(domains).length} domains; is the source right? Nothing written`);
}

const db = {
  source: "WhoTracks.Me via AdGuard companiesdb — CC BY-SA 4.0",
  updated: src.timeUpdated,
  trackers,
  domains,
};
await writeFile(OUT + ".tmp", JSON.stringify(db) + "\n");
await rename(OUT + ".tmp", OUT);
console.log(`trackers/db.json  ${Object.keys(trackers).length} trackers, ${Object.keys(domains).length} domains`);
