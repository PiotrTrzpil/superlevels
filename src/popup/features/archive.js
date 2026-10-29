// ═══════════════════════════════════
//  No Paywall
// ═══════════════════════════════════
import { ARCHIVE_DEFAULT_SITES } from "../../shared/defaults.js";
import { featureToggle } from "../lib/toggle.js";

const archiveSites = document.getElementById("archiveSites");

const loadArchiveToggle = featureToggle({
  key: "archive_enabled",
  toggle: document.getElementById("archiveToggle"),
  status: document.getElementById("archiveStatus"),
});

export async function loadArchive() {
  await loadArchiveToggle();
  const { archive_sites } = await chrome.storage.local.get(["archive_sites"]);
  const sites = Array.isArray(archive_sites) ? archive_sites : ARCHIVE_DEFAULT_SITES;
  archiveSites.value = sites.join("\n");
}

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
