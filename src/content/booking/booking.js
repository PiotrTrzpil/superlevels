// ═══════════════════════════════════
//  superlevels: Booking.com
//  Default sort and filters on search results, minus the pressure tactics
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-booking";
  const APPLIED_KEY = "sl-booking-applied";
  // Once applied, a search's defaults stay out of the way this long (unless it's
  // sent again from the search box), so a filter you remove by hand stays removed
  // across reloads
  const APPLIED_TTL_MS = 30 * 60 * 1000;

  // Keep in sync with BOOKING_DEFAULTS in src/popup/features/booking.js
  const DEFAULTS = {
    sort: "price", score: "80", extras: [],
    budgetMin: 0, budgetMax: 0, budgetCurrency: "", // 0 = no limit on that side
    pressure: true, ads: true, noDorms: true, perNight: true, highlights: true, minReviews: 0,
  };

  // Extra filters, as the key=value pairs Booking's filter sidebar puts in the
  // `nflt` URL parameter. Keep the keys in sync with the popup's checklist.
  const EXTRA_FILTERS = {
    privatebath: "roomfacility=38",
    aircon: "roomfacility=11",
    breakfast: "mealplan=1",
    kitchen: "mealplan=999",
    wifi: "hotelfacility=107",
    pool: "hotelfacility=433",
    hotels: "ht_id=204",
    entire: "privacy_type=3",
    center: "distance=3000",
    freecancel: "fc=2",
  };

  // Urgency nudges ("We have 2 left at this price", "In high demand"…).
  // English only: other languages keep them.
  const PRESSURE_RE = /\bonly \d+ (rooms?|left|apartments?|units?)\b|\bleft at this price\b|\bin high demand\b|\bbooked \d+ times\b|\bpeople (are )?(looking|viewing)\b|\byou missed it\b|\blast booked\b|\bselling out\b|\bjust booked\b/i;
  // Paid placements: Booking labels them "Featured" (ranked higher for a bigger commission)
  const AD_LABEL_RE = /^(featured|sponsored|ad)$/i;
  // The offered unit is a dorm bed ("2× Bed in 10-Female Dormitory Room · 2 beds in dorms").
  // Only the unit is checked, so hostels' private rooms stay.
  const DORM_RE = /\bdorm(itory|itories|s)?\b/i;
  const REVIEWS_RE = /(\d[\d.,\s ]*)\s*reviews?\b/i;

  let enabled = false; // until the stored setting is read
  let settings = DEFAULTS;
  let seenCurrency = ""; // the currency Booking last showed prices in
  let observer = null;
  let scheduled = false;

  // ── Default sort and filters, added to the search URL ──

  function isSearchResults() {
    return /^\/searchresults(\.[\w-]+)?\.html$/.test(location.pathname);
  }

  // What makes a search "the same search": destination, dates, guests
  function searchKey(url) {
    const p = url.searchParams;
    const dest = p.get("dest_id") || p.get("ss");
    if (!dest) return "";
    return ["checkin", "checkout", "group_adults", "group_children", "no_rooms"]
      .reduce((key, name) => `${key}|${p.get(name) ?? ""}`, dest.toLowerCase());
  }

  function readApplied() {
    try {
      const all = JSON.parse(sessionStorage.getItem(APPLIED_KEY) || "{}");
      const now = Date.now();
      return Object.fromEntries(Object.entries(all).filter(([, t]) => now - t < APPLIED_TTL_MS));
    } catch {
      return {};
    }
  }

  function markApplied(key) {
    try {
      sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ ...readApplied(), [key]: Date.now() }));
    } catch {
      // No storage: defaults may be re-added on reload, nothing worse
    }
  }

  // The URL with the defaults added where the search doesn't already set them,
  // or null when nothing needs to change
  function withDefaults(href) {
    const url = new URL(href);
    const p = url.searchParams;
    let changed = false;

    if (settings.sort && !p.get("order")) {
      p.set("order", settings.sort);
      changed = true;
    }

    const pairs = (p.get("nflt") || "").split(";").filter(Boolean);
    const add = (pair) => {
      if (!pairs.includes(pair)) { pairs.push(pair); changed = true; }
    };
    // Any score filter already chosen wins over the default one
    if (settings.score && !pairs.some((pair) => pair.startsWith("review_score="))) {
      add(`review_score=${settings.score}`);
    }
    for (const extra of settings.extras) {
      if (EXTRA_FILTERS[extra]) add(EXTRA_FILTERS[extra]);
    }
    // Budget per night, in the currency it was set in, else the one Booking shows:
    // "price=EUR-50-120-1", or "price=EUR-50-max-1" with no upper limit (the 1
    // means per night). A budget set on Booking's slider wins.
    const { budgetMin, budgetMax } = settings;
    const currency = settings.budgetCurrency || seenCurrency;
    if ((budgetMin > 0 || budgetMax > 0) && currency && !pairs.some((pair) => pair.startsWith("price="))) {
      add(`price=${currency}-${budgetMin || 0}-${budgetMax || "max"}-1`);
    }
    if (!changed) return null;
    p.set("nflt", pairs.join(";"));
    return url.href;
  }

  // Booking marks a search sent from its search box with sb=1; changing filters
  // or the sort on the results drops it
  function isNewSearch(url) {
    return url.searchParams.get("sb") === "1";
  }

  function applyDefaults() {
    if (!enabled || !isSearchResults()) return;
    const url = new URL(location.href);
    const key = searchKey(url);
    if (!key) return;
    // A repeat of a search (reload, back, a filter change) keeps what you set on it
    if (!isNewSearch(url) && readApplied()[key]) return;
    markApplied(key);
    const next = withDefaults(location.href);
    if (next) location.replace(next);
  }

  // ── Results page cleanup ──
  // Everything is marked with data attributes and hidden or shown through CSS,
  // so React can keep re-rendering the page without tripping over added nodes.

  function buildCss() {
    const rules = [];
    if (settings.pressure) rules.push(`[data-sl-pressure] { display: none !important; }`);
    if (settings.ads) rules.push(`[data-sl-ad] { display: none !important; }`);
    if (settings.noDorms) rules.push(`[data-sl-dorm] { display: none !important; }`);
    if (settings.minReviews > 0) rules.push(`[data-sl-few-reviews] { display: none !important; }`);
    if (settings.perNight) {
      rules.push(`[data-sl-per-night]::after {
        content: " · " attr(data-sl-per-night); font-weight: 700;
      }`);
    }
    if (settings.highlights) rules.push(HIGHLIGHT_CSS);
    return rules.join("\n");
  }

  // ── Highlights: what decides a booking, made visible ──
  // Each rule marks one small element of a card (a line like "1 twin bed")
  // good, warn or bad; "key" only makes it stand out. English only.

  const HIGHLIGHT_CSS = `
    [data-sl-hl] { font-weight: 700 !important; }
    [data-sl-hl="good"], [data-sl-hl="warn"], [data-sl-hl="bad"] {
      width: fit-content; padding: 0 5px; border-radius: 4px;
    }
    [data-sl-hl="good"] { color: #006b2e !important; background: #e1f4e7 !important; }
    [data-sl-hl="warn"] { color: #8a4b00 !important; background: #fff0d4 !important; }
    [data-sl-hl="bad"] { color: #b0001a !important; background: #fde3e6 !important; }
    [data-sl-hl="bad"]::before { content: "⚠ "; }
    [data-sl-hl="key"] { font-size: 14px !important; }
  `;

  const FEW_REVIEWS = 50;

  // Distance to the center in km, from "0.6 km from downtown" or "450 m from center"
  function distanceKm(text) {
    const match = /([\d.,]+)\s*(km|m|mi)\b/.exec(text);
    if (!match) return NaN;
    const n = Number(match[1].replace(",", "."));
    return match[2] === "m" ? n / 1000 : match[2] === "mi" ? n * 1.609 : n;
  }

  // The mark for one leaf line of a card, or null
  function lineMark(text, adults) {
    if (/\bbeds? in dorms?\b/i.test(text)) return "bad";
    // One single bed for two or more people
    if (adults >= 2 && /^1 (twin|single) bed$/i.test(text)) return "bad";
    // Sofa or bunk beds, and no proper double to fall back on
    if (/\b(sofa|bunk) beds?\b/i.test(text) && !/\b(full|double|queen|king)\b/i.test(text)) return "warn";
    if (/^shared (bathroom|toilet)\b/i.test(text)) return "bad";
    if (/^entire\b/i.test(text)) return "good";
    if (/^(free cancellation|no prepayment needed)\b/i.test(text)) return "good";
    if (/^breakfast included\b/i.test(text)) return "good";
    const location = /^location (\d+(\.\d+)?)$/i.exec(text);
    if (location) return Number(location[1]) >= 9 ? "good" : null;
    const reviews = /^([\d,.]+) reviews?$/i.exec(text);
    if (reviews) return Number(reviews[1].replace(/\D/g, "")) < FEW_REVIEWS ? "warn" : null;
    return null;
  }

  function markHighlights(card, adults) {
    for (const el of card.querySelectorAll("div, span, strong")) {
      if (el.childElementCount > 0) continue;
      const mark = lineMark(el.textContent.trim(), adults);
      if (mark) el.setAttribute("data-sl-hl", mark);
      else el.removeAttribute("data-sl-hl");
    }
    const distance = card.querySelector('[data-testid="distance"]');
    if (distance) {
      const km = distanceKm(distance.textContent);
      distance.setAttribute("data-sl-hl", km <= 1.5 ? "good" : km >= 4 ? "warn" : "key");
    }
    // "+ €45 taxes and charges": the headline price isn't the price
    const taxes = card.querySelector('[data-testid="taxes-and-charges"]');
    if (taxes && /^includes\b/i.test(taxes.textContent.trim())) taxes.removeAttribute("data-sl-hl");
    else taxes?.setAttribute("data-sl-hl", "bad");
  }

  function injectStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildCss();
  }

  function nights() {
    const p = new URLSearchParams(location.search);
    const checkin = Date.parse(p.get("checkin") ?? "");
    const checkout = Date.parse(p.get("checkout") ?? "");
    if (Number.isNaN(checkin) || Number.isNaN(checkout)) return 0;
    return Math.round((checkout - checkin) / 86_400_000);
  }

  // "€ 1,336" → 1336. List prices are whole amounts, so every digit counts.
  function parseAmount(text) {
    const digits = text.replace(/\D/g, "");
    return digits ? Number(digits) : NaN;
  }

  // The nightly price goes on the "3 nights, 2 adults" line: next to the total it
  // would sit beside a struck-out old total and read like the discount
  function markPerNight(card, stayNights) {
    const price = card.querySelector('[data-testid="price-and-discounted-price"]');
    const line = card.querySelector('[data-testid="price-for-x-nights"]');
    if (!price || !line) return;
    const text = price.textContent.trim();
    const total = parseAmount(text);
    if (stayNights < 2 || !Number.isFinite(total)) {
      line.removeAttribute("data-sl-per-night");
      return;
    }
    const perNight = Math.round(total / stayNights).toLocaleString("en-US");
    // Keep the currency as Booking wrote it: swap the amount for the nightly one
    const label = text.replace(/\d[\d.,\s ]*\d|\d/, perNight);
    line.setAttribute("data-sl-per-night", `${label} / night`);
  }

  function markPressure(card) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (PRESSURE_RE.test(node.nodeValue)) node.parentElement?.setAttribute("data-sl-pressure", "");
    }
  }

  function isAd(card) {
    for (const el of card.querySelectorAll("span, div")) {
      if (el.childElementCount === 0 && AD_LABEL_RE.test(el.textContent.trim())) return true;
    }
    return false;
  }

  // Review count of a card, 0 when it has none, null when it can't be read
  function reviewCount(card) {
    const score = card.querySelector('[data-testid="review-score"]');
    if (!score) return 0;
    const match = REVIEWS_RE.exec(score.textContent);
    return match ? parseAmount(match[1]) : null;
  }

  function processCards() {
    scheduled = false;
    const cards = document.querySelectorAll('[data-testid="property-card"]');
    const stayNights = nights();
    const adults = Number(new URLSearchParams(location.search).get("group_adults")) || 2;
    const counts = [];
    for (const card of cards) {
      markPressure(card);
      card.toggleAttribute("data-sl-ad", isAd(card));
      const unit = card.querySelector('[data-testid="recommended-units"]');
      card.toggleAttribute("data-sl-dorm", DORM_RE.test(unit?.textContent ?? ""));
      markPerNight(card, stayNights);
      markHighlights(card, adults);
      counts.push(reviewCount(card));
    }
    // Hide few-review cards only if the counts can be read at all, so a Booking
    // redesign shows everything instead of hiding everything
    const readable = counts.some((n) => n > 0);
    cards.forEach((card, i) => {
      const n = counts[i];
      card.toggleAttribute("data-sl-few-reviews", readable && n !== null && n < settings.minReviews);
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(processCards);
  }

  function startCleanup() {
    const start = () => {
      if (!enabled) return; // turned off before the page finished loading
      injectStyle();
      if (!observer) {
        observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      schedule();
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  function stopCleanup() {
    observer?.disconnect();
    observer = null;
    document.getElementById(STYLE_ID)?.remove();
  }

  function apply(on, stored) {
    enabled = on;
    settings = { ...DEFAULTS, ...(stored || {}) };
    if (enabled) startCleanup();
    else stopCleanup();
  }

  // Remember the currency Booking shows prices in, so the popup can offer it
  // for the budget
  function rememberCurrency() {
    const trigger = document.querySelector('[data-testid="header-currency-picker-trigger"]');
    const code = trigger?.textContent.trim();
    if (!code || !/^[A-Z]{3}$/.test(code)) return;
    chrome.storage.local.get(["booking_currency"], ({ booking_currency }) => {
      if (booking_currency !== code) chrome.storage.local.set({ booking_currency: code });
    });
  }

  chrome.storage.local.get(["booking_enabled", "booking_settings", "booking_currency"], (data) => {
    seenCurrency = data.booking_currency || "";
    apply(data.booking_enabled !== false, data.booking_settings);
    applyDefaults();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", rememberCurrency, { once: true });
  else rememberCurrency();

  // Booking moves between some pages without a reload (homepage → results)
  window.navigation?.addEventListener("navigatesuccess", applyDefaults);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "booking_update") apply(msg.enabled, msg.settings);
  });
})();
