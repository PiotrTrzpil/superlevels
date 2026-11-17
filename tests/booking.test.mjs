// ═══════════════════════════════════
//  Booking.com: default sort and filters on new searches, cleaner result cards.
//  booking.com is served from a fake page; the cards copy the markup of a real
//  results page.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = readFileSync(
  join(dirname(dirname(fileURLToPath(import.meta.url))), "src/content/booking/booking.js"), "utf8");

const SEARCH = "https://www.booking.com/searchresults.html?ss=Lisbon&dest_id=-2167973&dest_type=city"
  + "&checkin=2027-01-07&checkout=2027-01-10&group_adults=2&no_rooms=1&group_children=0";

function card({ title, featured = false, left = "", unit = "Double Room with Private Bathroom", price, reviews }) {
  return `
    <div data-testid="property-card">
      <div data-testid="title">${title}</div>
      ${featured ? `<span class="f323fd7e96">Featured</span>` : ""}
      <div data-testid="review-score"><div>Scored 8.7</div><div>Excellent</div><div>${reviews} reviews</div></div>
      <div data-testid="recommended-units">${unit}</div>
      ${left ? `<div class="cc87802d18">${left}</div>` : ""}
      <div data-testid="price-for-x-nights">3 nights, 2 adults</div>
      <span data-testid="price-and-discounted-price">${price}</span>
    </div>`;
}

const RESULTS = `<!doctype html><html><head></head><body>
  ${card({ title: "Dona Graca", left: "We have 2 left at this price", price: "€&nbsp;1,336", reviews: "661" })}
  ${card({ title: "Hotel ibis", featured: true, price: "€&nbsp;858", reviews: "3,842" })}
  ${card({ title: "Tiny place", price: "€&nbsp;977", reviews: "10" })}
  ${card({ title: "Sant Jordi Hostels", unit: "2× Bed in 10-Female Dormitory Room · 2 beds in dorms",
    price: "€&nbsp;300", reviews: "900" })}
  ${card({ title: "Hostel private room", unit: "Double Room · 2 bunk beds", price: "€&nbsp;600", reviews: "900" })}
</body></html>`;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// A tab on booking.com with the content script running at document start,
// as Chrome runs it, and these stored settings
async function open(settings = {}, otherStored = {}) {
  const page = await browser.newPage();
  await page.route("https://www.booking.com/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: RESULTS }));
  await page.addInitScript(({ stored, script }) => {
    window.chrome = {
      storage: { local: { get: (_keys, cb) => cb(stored), set() {} } },
      runtime: { onMessage: { addListener() {} } },
    };
    // Playwright runs init scripts before the page exists; the content script runs then too
    new Function(script)();
  }, { stored: { ...otherStored, booking_settings: settings }, script: SCRIPT });
  return page;
}

// The page's URL once the script has had its chance to redirect
async function settledUrl(page, url) {
  await page.goto(url);
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  return new URL(page.url());
}

test("a new search gets the default sort and 8+ score, plus chosen extras", async () => {
  const page = await open({ extras: ["privatebath", "breakfast"] });
  const url = await settledUrl(page, SEARCH);
  assert.equal(url.searchParams.get("order"), "price");
  assert.equal(url.searchParams.get("nflt"), "review_score=80;roomfacility=38;mealplan=1");
  await page.close();
});

test("a budget per night goes in as Booking's price filter, in its own currency", async () => {
  const page = await open({ budgetMin: 50, budgetMax: 120, budgetCurrency: "EUR" });
  const url = await settledUrl(page, SEARCH);
  assert.equal(url.searchParams.get("nflt"), "review_score=80;price=EUR-50-120-1");
  await page.close();
});

test("a budget without its own currency uses the one Booking last showed", async () => {
  const page = await open({ budgetMax: 400 }, { booking_currency: "EUR" });
  const url = await settledUrl(page, SEARCH);
  assert.equal(url.searchParams.get("nflt"), "review_score=80;price=EUR-0-400-1");
  await page.close();
});

test("a budget with only a minimum has no upper limit, as Booking's slider writes it", async () => {
  const page = await open({ budgetMin: 50, budgetCurrency: "EUR" });
  const url = await settledUrl(page, SEARCH);
  assert.equal(url.searchParams.get("nflt"), "review_score=80;price=EUR-50-max-1");
  await page.close();
});

test("no budget without a currency", async () => {
  const page = await open({ budgetMax: 120 });
  const url = await settledUrl(page, SEARCH);
  assert.equal(url.searchParams.get("nflt"), "review_score=80");
  await page.close();
});

test("a sort or score the search already has is kept", async () => {
  const page = await open();
  const url = await settledUrl(page, `${SEARCH}&order=distance_from_search&nflt=review_score%3D90%3Bht_id%3D204`);
  assert.equal(url.searchParams.get("order"), "distance_from_search");
  assert.equal(url.searchParams.get("nflt"), "review_score=90;ht_id=204");
  await page.close();
});

test("a filter removed by hand stays removed on reload", async () => {
  const page = await open();
  const first = await settledUrl(page, SEARCH);
  assert.equal(first.searchParams.get("nflt"), "review_score=80");
  // As if the score filter was unticked on Booking: same search, no filters
  const again = await settledUrl(page, `${SEARCH}&order=price`);
  assert.equal(again.searchParams.get("nflt"), null);
  await page.close();
});

test("the same search sent again from the search box gets the defaults again", async () => {
  const page = await open();
  await settledUrl(page, SEARCH);
  await settledUrl(page, `${SEARCH}&order=price`); // the score filter unticked by hand
  const fresh = await settledUrl(page, `${SEARCH}&sb=1&src_elem=sb`);
  assert.equal(fresh.searchParams.get("nflt"), "review_score=80");
  assert.equal(fresh.searchParams.get("order"), "price");
  await page.close();
});

test("cards: no pressure lines, Featured listings or dorm beds, a nightly price, few-review places hidden", async () => {
  const page = await open({ minReviews: 50 });
  await settledUrl(page, SEARCH);
  await page.waitForSelector("[data-sl-per-night]", { state: "attached" });
  const cards = await page.$$eval('[data-testid="property-card"]', (els) => els.map((el) => ({
    shown: getComputedStyle(el).display !== "none",
    pressureShown: [...el.querySelectorAll("div")]
      .some((d) => d.textContent.includes("left at this price") && getComputedStyle(d).display !== "none"),
    perNight: el.querySelector("[data-sl-per-night]")?.getAttribute("data-sl-per-night"),
  })));
  // The currency keeps Booking's no-break space
  const eur = (n) => `€\u00a0${n} / night`;
  assert.deepEqual(cards, [
    { shown: true, pressureShown: false, perNight: eur(445) },
    { shown: false, pressureShown: false, perNight: eur(286) }, // Featured
    { shown: false, pressureShown: false, perNight: eur(326) }, // 10 reviews
    { shown: false, pressureShown: false, perNight: eur(100) }, // dorm beds
    { shown: true, pressureShown: false, perNight: eur(200) }, // hostel's private room
  ]);
  await page.close();
});

test("highlights: single bed for two, sofa-only beds, extra fees, distance, thin reviews, the good news", async () => {
  const page = await browser.newPage();
  await page.route("https://www.booking.com/**", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><head></head><body>
      <div data-testid="property-card">
        <button data-testid="distance">0.6 km from downtown</button>
        <div id="reviews">11 reviews</div>
        <span id="location">Location 9.5</span>
        <span id="entire">Entire apartment</span>
        <div id="single">1 twin bed</div>
        <div id="sofaOnly">2 beds (1 twin, 1 sofa bed)</div>
        <div id="sofaAndFull">2 beds (1 full, 1 sofa bed)</div>
        <strong id="cancel">Free cancellation</strong>
        <div data-testid="taxes-and-charges">+ €45 taxes and charges</div>
      </div>
      <div data-testid="property-card">
        <button data-testid="distance">5.2 km from downtown</button>
        <div id="manyReviews">3,426 reviews</div>
        <div data-testid="taxes-and-charges">Includes taxes and fees</div>
      </div>
    </body></html>`,
  }));
  await page.addInitScript((script) => {
    window.chrome = {
      storage: { local: { get: (_keys, cb) => cb({ booking_settings: { sort: "", score: "" } }) } },
      runtime: { onMessage: { addListener() {} } },
    };
    new Function(script)();
  }, SCRIPT);
  await page.goto(`${SEARCH}&order=price`);
  await page.waitForSelector("#cancel[data-sl-hl]", { state: "attached" });
  const marks = await page.evaluate(() => {
    const mark = (el) => el?.getAttribute("data-sl-hl") ?? null;
    const [near, far] = document.querySelectorAll('[data-testid="distance"]');
    const [fees, included] = document.querySelectorAll('[data-testid="taxes-and-charges"]');
    return {
      near: mark(near), far: mark(far), fees: mark(fees), included: mark(included),
      ...Object.fromEntries(["reviews", "manyReviews", "location", "entire", "single", "sofaOnly", "sofaAndFull", "cancel"]
        .map((id) => [id, mark(document.getElementById(id))])),
    };
  });
  assert.deepEqual(marks, {
    near: "good", far: "warn", fees: "bad", included: null,
    reviews: "warn", manyReviews: null, location: "good", entire: "good",
    single: "bad", sofaOnly: "warn", sofaAndFull: null, cancel: "good",
  });
  await page.close();
});
