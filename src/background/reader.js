// ═══════════════════════════════════
//  Reader view — pulls the article out of a tab with Mozilla's Readability
//  and opens it in the reader page (src/pages/reader/) in a tab next to it.
//  The article is handed over in session storage, so it's gone after a
//  browser restart.
// ═══════════════════════════════════
import { handle } from "./messages.js";

const READER_PAGE = "src/pages/reader/reader.html";
const KEY_PREFIX = "reader:";
// Articles kept in session storage (its quota is 10 MB); older ones are dropped
const MAX_ARTICLES = 20;

// Injected into the page after src/vendor/Readability.js, so it can't use anything from this module
function extractArticle() {
  // Readability rewrites the document it's given
  const article = new Readability(document.cloneNode(true)).parse();
  if (!article?.content) return { error: "Couldn't find an article on this page" };
  // Readability keeps "Title | Site" when the title alone is short
  let title = (article.title || document.title).trim();
  const site = article.siteName?.trim();
  if (site) {
    const sep = String.raw`\s*[|\-–—:·•]\s*`;
    const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = title.replace(new RegExp(`${sep}${escaped}$|^${escaped}${sep}`, "i"), "").trim();
    if (stripped) title = stripped;
  }
  return {
    title,
    byline: article.byline,
    siteName: article.siteName,
    publishedTime: article.publishedTime,
    excerpt: article.excerpt,
    lang: article.lang || document.documentElement.lang,
    dir: article.dir,
    content: article.content,
    length: article.length,
    url: location.href,
  };
}

async function openReader(tab) {
  const target = { tabId: tab.id };
  // Chrome refuses to run scripts on chrome://, the Web Store, extension pages…
  const ok = await chrome.scripting.executeScript({ target, files: ["src/vendor/Readability.js"] })
    .then(() => true, () => false);
  if (!ok) return { error: "Reader view doesn't work on this page" };
  const [{ result } = {}] = await chrome.scripting.executeScript({ target, func: extractArticle });
  if (!result) return { error: "No result" };
  if (result.error) return result;

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  await chrome.storage.session.set({ [KEY_PREFIX + id]: result });
  await pruneArticles();
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`${READER_PAGE}#${id}`),
    index: tab.index + 1,
    openerTabId: tab.id,
    windowId: tab.windowId,
  });
  return { opened: true };
}

// Ids start with the 13-digit time they were made, so sorting them sorts by age
async function pruneArticles() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX)).sort();
  const stale = keys.slice(0, Math.max(0, keys.length - MAX_ARTICLES));
  if (stale.length) await chrome.storage.session.remove(stale);
}

handle("reader", async ({ tabId }) => openReader(await chrome.tabs.get(tabId)));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "reader-view" && tab) openReader(tab);
});
