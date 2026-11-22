// ═══════════════════════════════════
//  Reader page: shows an article that src/background/reader.js pulled out
//  of a tab (handed over in session storage under reader:<id>, the id being
//  this page's hash), and saves it as Markdown.
// ═══════════════════════════════════
import { downloadImages } from "./images.js";
import { htmlToMarkdown } from "./markdown.js";
import { zip } from "./zip.js";

const $ = (id) => document.getElementById(id);
const FONT_SIZES = [15, 17, 19, 21, 24, 28];
const DEFAULT_FONT_SIZE = 2;

// The article HTML comes from a web page. Extension pages can't run inline
// scripts anyway, but anything that isn't plain article markup is dropped too.
const DROP = new Set(["SCRIPT", "STYLE", "LINK", "META", "IFRAME", "FRAME", "OBJECT", "EMBED", "FORM", "INPUT",
  "BUTTON", "SELECT", "TEXTAREA", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "CANVAS", "DIALOG"]);
const KEEP = new Set(["A", "ABBR", "B", "BLOCKQUOTE", "BR", "CAPTION", "CITE", "CODE", "DD", "DEL", "DETAILS", "DFN",
  "DIV", "DL", "DT", "EM", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "INS",
  "KBD", "LI", "MARK", "OL", "P", "PICTURE", "PRE", "Q", "S", "SAMP", "SECTION", "SMALL", "SOURCE", "SPAN",
  "STRONG", "SUB", "SUMMARY", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TIME", "TR", "U", "UL",
  "VAR", "VIDEO", "ARTICLE", "HEADER", "FOOTER", "ASIDE", "MAIN"]);
const ATTRS = new Set(["href", "src", "srcset", "alt", "title", "colspan", "rowspan", "datetime", "start",
  "lang", "dir", "width", "height", "poster", "controls", "type", "media", "sizes"]);
const URL_ATTRS = new Set(["href", "src", "poster"]);

function safeUrl(value, attr) {
  try {
    const { protocol } = new URL(value);
    if (protocol === "http:" || protocol === "https:") return true;
    if (attr === "href") return protocol === "mailto:";
    return protocol === "data:" && /^data:image\//i.test(value);
  } catch {
    return false; // Readability makes every link absolute, so a relative one is junk
  }
}

function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (!el.isConnected) continue; // inside something already dropped
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) { el.remove(); continue; }
    if (!KEEP.has(tag)) { el.replaceWith(...el.childNodes); continue; }
    for (const { name, value } of [...el.attributes]) {
      if (!ATTRS.has(name) || (URL_ATTRS.has(name) && !safeUrl(value, name))) el.removeAttribute(name);
    }
    if (tag === "A" && el.hasAttribute("href") && !el.getAttribute("href").startsWith("mailto:")) {
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
  }
  return doc.body;
}

// A copy of the shown article to convert; Readability leaves the article's
// own title in the content more often than not, and it's in the front matter
function contentCopy(article) {
  const content = $("content").cloneNode(true);
  for (const h1 of content.querySelectorAll("h1")) {
    if (h1.textContent.trim() === article.title.trim()) h1.remove();
  }
  return content;
}

function toMarkdown(article, content) {
  const front = [
    ["title", article.title],
    ["source", article.url],
    ["author", article.byline],
    ["site", article.siteName],
    ["published", article.publishedTime],
    ["saved", new Date().toISOString().slice(0, 10)],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${front.join("\n")}\n---\n\n# ${article.title}\n\n${htmlToMarkdown(content)}\n`;
}

function baseName(title) {
  return title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "article";
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The Markdown with its images in images/, pointed at by relative paths.
// An image that can't be downloaded keeps its web address.
async function saveZip(article) {
  const content = contentCopy(article);
  const imgs = [...content.querySelectorAll("img[src]")];
  const images = await downloadImages(imgs.map((img) => img.src));
  for (const img of imgs) {
    const local = images.get(img.src);
    if (local) img.setAttribute("src", local.name);
  }
  const base = baseName(article.title);
  const files = [{ name: `${base}.md`, data: toMarkdown(article, content) },
    ...[...images.values()].map(({ name, data }) => ({ name, data }))];
  download(`${base}.zip`, zip(files));
  const total = new Set(imgs.map((img) => img.src)).size;
  return total === images.size ? "Saved" : `Saved, ${images.size} of ${total} images`;
}

function flash(button, text) {
  const was = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = was), 1500);
}

function metaLine(article) {
  const parts = [];
  if (article.byline) parts.push(article.byline);
  if (article.publishedTime) {
    const date = new Date(article.publishedTime);
    if (!isNaN(date)) parts.push(date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  }
  const words = ($("content").textContent.match(/\S+/g) || []).length;
  parts.push(`${Math.max(1, Math.round(words / 230))} min read`);
  const site = document.createElement("a");
  site.href = article.url;
  site.textContent = article.siteName || new URL(article.url).hostname.replace(/^www\./, "");
  $("meta").append(site, ...parts.map((p) => ` · ${p}`));
}

// ── Look: font size, family and theme, remembered across articles ──
const look = { size: DEFAULT_FONT_SIZE, sans: false, light: false };

function applyLook() {
  document.body.style.setProperty("--reader-size", `${FONT_SIZES[look.size]}px`);
  document.body.classList.toggle("sans", look.sans);
  document.body.classList.toggle("light", look.light);
  $("fontFamily").textContent = look.sans ? "Serif" : "Sans";
  $("theme").textContent = look.light ? "Dark" : "Light";
  $("fontSmaller").disabled = look.size === 0;
  $("fontLarger").disabled = look.size === FONT_SIZES.length - 1;
}

function setLook(change) {
  Object.assign(look, change);
  applyLook();
  chrome.storage.local.set({ reader_look: look });
}

$("fontSmaller").addEventListener("click", () => setLook({ size: Math.max(0, look.size - 1) }));
$("fontLarger").addEventListener("click", () => setLook({ size: Math.min(FONT_SIZES.length - 1, look.size + 1) }));
$("fontFamily").addEventListener("click", () => setLook({ sans: !look.sans }));
$("theme").addEventListener("click", () => setLook({ light: !look.light }));

function showError(text) {
  $("state").textContent = text;
  $("state").className = "state err";
  for (const id of ["copyMd", "saveMd", "saveZip"]) $(id).disabled = true;
}

async function init() {
  const { reader_look } = await chrome.storage.local.get(["reader_look"]);
  Object.assign(look, reader_look);
  applyLook();

  const key = `reader:${location.hash.slice(1)}`;
  const { [key]: article } = await chrome.storage.session.get([key]);
  if (!article) {
    $("original").hidden = true;
    showError("This article is no longer here (reader articles are cleared when Chrome restarts). Open the page and turn on reader view again.");
    return;
  }

  document.title = `📖 ${article.title}`;
  $("original").href = article.url;
  const main = $("article");
  if (article.lang) main.lang = article.lang;
  if (article.dir) main.dir = article.dir;
  $("title").textContent = article.title;
  $("content").replaceChildren(...sanitize(article.content).childNodes);
  metaLine(article);
  $("state").hidden = true;
  main.hidden = false;

  const markdown = () => toMarkdown(article, contentCopy(article));
  $("saveMd").addEventListener("click", () =>
    download(`${baseName(article.title)}.md`, new Blob([markdown()], { type: "text/markdown;charset=utf-8" })));
  $("saveZip").addEventListener("click", async () => {
    const button = $("saveZip");
    button.disabled = true;
    button.textContent = "Saving…";
    const message = await saveZip(article).catch((e) => `Failed: ${e.message}`);
    button.textContent = "Save .zip";
    button.disabled = false;
    flash(button, message);
  });
  $("copyMd").addEventListener("click", () =>
    navigator.clipboard.writeText(markdown()).then(() => flash($("copyMd"), "Copied!"), () => flash($("copyMd"), "Copy failed")));
}

init();
