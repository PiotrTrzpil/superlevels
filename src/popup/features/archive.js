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

export async function loadArchive() {
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
