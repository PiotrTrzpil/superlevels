// ═══════════════════════════════════
//  Cookie banners: refuse where the site offers it, never record an Accept.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), "src/content/nocookie.js");

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function open(html) {
  const page = await browser.newPage();
  // setContent does not run addInitScript in this Playwright, so the mock lives in the page.
  await page.setContent(`
    <script>
      window.__clicks = [];
      window.chrome = {
        storage: { local: { get: (_keys, cb) => cb({ nocookie_enabled: true }) } },
        runtime: { onMessage: { addListener() {} } },
      };
    </script>
    ${html}
  `);
  await page.addScriptTag({ path: SCRIPT });
  await page.waitForSelector("#sl-nocookie", { state: "attached" });
  return page;
}

function button(id, label, extra = "") {
  return `<button id="${id}" ${extra} onclick="__clicks.push('${id}')">${label}</button>`;
}

test("clicks the refusal and not the accept button, then hides the banner", async () => {
  const page = await open(`
    <div id="onetrust-banner-sdk" class="cookie-banner">
      ${button("onetrust-accept-btn-handler", "Accept all")}
      ${button("onetrust-reject-all-handler", "Reject all")}
    </div>
    ${button("invite", "Accept")}
    ${button("friend", "Reject")}
  `);
  await page.waitForFunction(() => window.__clicks.includes("onetrust-reject-all-handler"));
  assert.deepEqual(await page.evaluate(() => window.__clicks), ["onetrust-reject-all-handler"]);
  assert.equal(await page.$eval("#onetrust-banner-sdk", (el) => getComputedStyle(el).display), "none");
  await page.close();
});

test("a banner with only an accept button is hidden and not accepted", async () => {
  const page = await open(`
    <div class="cookie-banner">
      ${button("only-accept", "Accept all")}
      ${button("allow", "Allow all")}
      ${button("agree", "Agree")}
    </div>
  `);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => window.__clicks), []);
  assert.equal(await page.$eval(".cookie-banner", (el) => getComputedStyle(el).display), "none");
  await page.close();
});

test("matches a localized refusal and ignores the accept next to it", async () => {
  const page = await open(`
    <div class="consent-banner">
      ${button("de-accept", "Alle akzeptieren")}
      ${button("de-reject", "Alle ablehnen")}
    </div>
  `);
  await page.waitForFunction(() => window.__clicks.includes("de-reject"));
  assert.deepEqual(await page.evaluate(() => window.__clicks), ["de-reject"]);
  await page.close();
});

test("refuses inside an open shadow root and does not accept there", async () => {
  const page = await open(`
    <div id="usercentrics-root"></div>
    <script>
      const root = document.getElementById("usercentrics-root").attachShadow({ mode: "open" });
      for (const [id, label] of [["uc-accept-all-button", "Accept all"], ["uc-deny-all-button", "Deny"]]) {
        const button = document.createElement("button");
        button.dataset.testid = id;
        button.textContent = label;
        button.onclick = () => __clicks.push(id);
        root.append(button);
      }
    </script>
  `);
  await page.waitForFunction(() => window.__clicks.includes("uc-deny-all-button"));
  assert.deepEqual(await page.evaluate(() => window.__clicks), ["uc-deny-all-button"]);
  await page.close();
});

test("refuses a banner that appears after the script loads", async () => {
  const page = await open(`<p>no banner yet</p>`);
  await page.evaluate(() => {
    setTimeout(() => {
      const banner = document.createElement("div");
      banner.className = "cookie-consent";
      banner.innerHTML = "<button id='late-accept'>Accept</button><button id='late-reject'>Reject all</button>";
      banner.querySelector("#late-accept").onclick = () => __clicks.push("late-accept");
      banner.querySelector("#late-reject").onclick = () => __clicks.push("late-reject");
      document.body.append(banner);
    }, 50);
  });
  await page.waitForFunction(() => window.__clicks.includes("late-reject"));
  assert.deepEqual(await page.evaluate(() => window.__clicks), ["late-reject"]);
  await page.close();
});
