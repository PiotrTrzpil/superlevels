// ═══════════════════════════════════
//  Reader view: a page's article opens in the reader tab, cleaned up, and
//  saves as Markdown. The page is served by a Playwright route (no network).
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { launchExtension, sendMessage } from "./extension.mjs";

const PAGE_URL = "https://news.reader.test/2026/story";
const PIC_URL = "https://news.reader.test/pic.jpg";
const PIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const PARA = (n) => `<p>Paragraph ${n} of the story, with enough words in it to read as real article text for Readability, which wants a few hundred characters before it trusts a block of content as the main body of the page.</p>`;
const PAGE = `<!DOCTYPE html><html lang="en"><head><title>The Story | Reader News</title>
  <meta property="og:site_name" content="Reader News"></head><body>
  <nav><a href="/">Home</a> <a href="/world">World</a></nav>
  <article>
    <h1>The Story</h1>
    <p class="byline">By Ada Writer</p>
    ${PARA(1)}
    <p>See <a href="/related" onclick="alert(1)">the related piece</a> and <a href="javascript:alert(2)">this</a>.</p>
    <img src="/pic.jpg" alt="A picture" onerror="alert(3)">
    <figure><img src="https://cdn.reader.test/gone.png" alt="Gone"></figure>
    <h2>Details</h2>
    <ul><li>first point</li><li>second point</li></ul>
    <pre><code>const x = 1;</code></pre>
    ${PARA(2)}${PARA(3)}${PARA(4)}
  </article>
  <aside class="sidebar"><h3>Most read</h3><a href="/other">Something else</a></aside>
  <footer>© Reader News</footer>
</body></html>`;

let ext;
before(async () => {
  ext = await launchExtension();
  await ext.context.route(/^https?:/, (route) => route.request().resourceType() === "document"
    ? route.fulfill({ contentType: "text/html", body: PAGE })
    : route.request().url() === PIC_URL
      ? route.fulfill({ contentType: "image/jpeg", body: PIC })
      : route.fulfill({ status: 404, body: "" }));
});
after(async () => { await ext?.context.close(); });

async function openReader() {
  const page = await ext.context.newPage();
  await page.goto(PAGE_URL);
  const tabId = await ext.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, PAGE_URL);
  const [reader, result] = await Promise.all([
    ext.context.waitForEvent("page", (p) => p.url().includes("/src/pages/reader/reader.html#")),
    sendMessage(ext, { type: "reader", tabId }),
  ]);
  assert.deepEqual(result, { opened: true });
  await reader.locator("#article").waitFor();
  return reader;
}

test("shows the article without the page chrome, and without scripts or unsafe links", async () => {
  const reader = await openReader();
  assert.equal(await reader.locator("#title").textContent(), "The Story");
  assert.match(await reader.locator("#meta").textContent(), /^Reader News · By Ada Writer · 1 min read$/);
  assert.equal(await reader.locator("#original").getAttribute("href"), PAGE_URL);

  const content = reader.locator("#content");
  assert.match(await content.textContent(), /Paragraph 4 of the story/);
  assert.doesNotMatch(await content.textContent(), /Most read|World|Reader News/);
  assert.equal(await content.locator("[onclick], [onerror]").count(), 0);
  assert.deepEqual(await content.locator("a").evaluateAll((links) => links.map((a) => [a.textContent, a.href])),
    [["the related piece", "https://news.reader.test/related"]]);
  assert.deepEqual(await content.locator("img").evaluateAll((imgs) => imgs.map((img) => img.src)),
    [PIC_URL, "https://cdn.reader.test/gone.png"]);
  await reader.close();
});

test("Save .md downloads the article as Markdown with its source in the front matter", async () => {
  const reader = await openReader();
  const [download] = await Promise.all([reader.waitForEvent("download"), reader.getByText("Save .md").click()]);
  assert.equal(download.suggestedFilename(), "The Story.md");
  const md = await readFile(await download.path(), "utf8");
  assert.match(md, /^---\ntitle: "The Story"\nsource: "https:\/\/news\.reader\.test\/2026\/story"\nauthor: "By Ada Writer"\nsite: "Reader News"\nsaved: "\d{4}-\d\d-\d\d"\n---\n\n# The Story\n\n/);
  assert.equal(md.match(/^# The Story$/gm).length, 1);
  assert.match(md, /\[the related piece\]\(https:\/\/news\.reader\.test\/related\)/);
  assert.match(md, /!\[A picture\]\(https:\/\/news\.reader\.test\/pic\.jpg\)/);
  assert.match(md, /^## Details$/m);
  assert.match(md, /^- first point$/m);
  assert.match(md, /```\nconst x = 1;\n```/);
  await reader.close();
});

test("Save .zip has the Markdown and the images it could download, linked by relative paths", async () => {
  const reader = await openReader();
  const [download] = await Promise.all([reader.waitForEvent("download"), reader.getByText("Save .zip").click()]);
  assert.equal(download.suggestedFilename(), "The Story.zip");
  await reader.getByText("Saved, 1 of 2 images").waitFor();
  const path = await download.path();
  assert.deepEqual(execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n"),
    ["The Story.md", "images/01-pic.jpg"]);
  execFileSync("unzip", ["-tq", path]); // CRCs check out
  assert.deepEqual(execFileSync("unzip", ["-p", path, "images/01-pic.jpg"]), PIC);
  const md = execFileSync("unzip", ["-p", path, "The Story.md"], { encoding: "utf8" });
  assert.match(md, /^!\[A picture\]\(images\/01-pic\.jpg\)$/m);
  assert.match(md, /^!\[Gone\]\(https:\/\/cdn\.reader\.test\/gone\.png\)$/m);
  await reader.close();
});

// The converter on its own, run in the reader page (it needs a DOM)
async function markdownOf(html) {
  const page = ext.converter ??= await (async () => {
    const p = await ext.context.newPage();
    await p.goto(`chrome-extension://${ext.extensionId}/src/pages/reader/reader.html`);
    return p;
  })();
  return page.evaluate(async (html) => {
    const { htmlToMarkdown } = await import("./markdown.js");
    const root = document.createElement("div");
    root.innerHTML = html;
    return htmlToMarkdown(root);
  }, html);
}

test("Markdown: inline marks, links, images and line breaks", async () => {
  assert.equal(await markdownOf(`<p>Some <b>bold</b>, <em> spaced </em>, <del>gone</del> and <a href="https://a.test/x" title="T">a link</a>.<br>Next line with <code>a\`b</code> and <img src="https://a.test/p q.png" alt="pic"></p>`),
    'Some **bold**, *spaced* , ~~gone~~ and [a link](https://a.test/x "T").\\\nNext line with ``a`b`` and ![pic](<https://a.test/p q.png>)');
});

test("Markdown: text that looks like markup is escaped, snake_case is left alone", async () => {
  assert.equal(await markdownOf("<p># not a heading *or* [link] in snake_case and _this_</p><p>1. not a list</p><p>- nor this</p>"),
    "\\# not a heading \\*or\\* \\[link\\] in snake_case and \\_this\\_\n\n1\\. not a list\n\n\\- nor this");
});

test("Markdown: nested and loose lists, quotes, code blocks, headings and rules", async () => {
  assert.equal(await markdownOf(`
    <h2>Head <i>ing</i></h2>
    <ol start="3"><li>three<ul><li>nested</li></ul></li><li>four</li></ol>
    <ul><li><p>loose one</p><p>more</p></li><li>loose two</li></ul>
    <blockquote><p>quoted</p><ul><li>item</li></ul></blockquote>
    <pre><code>has
\`\`\`
fence</code></pre>
    <hr><div>bare <span>div</span> text</div>`),
    [
      "## Head *ing*",
      "3. three\n   - nested\n4. four",
      "- loose one\n\n  more\n\n- loose two",
      "> quoted\n>\n> - item",
      "````\nhas\n```\nfence\n````",
      "---",
      "bare div text",
    ].join("\n\n"));
});

test("Markdown: tables become GFM tables, ragged rows padded and pipes escaped", async () => {
  assert.equal(await markdownOf("<table><tr><th>Name</th><th>Note</th></tr><tr><td>a|b</td><td>x<br>y</td></tr><tr><td>only</td></tr></table>"),
    "| Name | Note |\n| --- | --- |\n| a\\|b | x y |\n| only |  |");
});

test("refuses pages Chrome won't let it read", async () => {
  const page = await ext.context.newPage();
  await page.goto("chrome://version");
  const tabId = await ext.worker.evaluate(async () => (await chrome.tabs.query({ url: "chrome://version/" }))[0].id);
  assert.deepEqual(await sendMessage(ext, { type: "reader", tabId }), { error: "Reader view doesn't work on this page" });
  await page.close();
});
