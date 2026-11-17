// ═══════════════════════════════════
//  Booking.com search defaults
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

// Keep in sync with DEFAULTS in src/content/booking/booking.js
const BOOKING_DEFAULTS = {
  sort: "price", score: "80", extras: [],
  budgetMin: 0, budgetMax: 0, budgetCurrency: "", // 0 = no limit on that side
  pressure: true, ads: true, noDorms: true, perNight: true, highlights: true, minReviews: 0,
};

const sortEl = document.getElementById("bookingSort");
const scoreEl = document.getElementById("bookingScore");
const minReviewsEl = document.getElementById("bookingMinReviews");
const budgetMinEl = document.getElementById("bookingBudgetMin");
const budgetMaxEl = document.getElementById("bookingBudgetMax");
const budgetCurrencyEl = document.getElementById("bookingBudgetCurrency");
const extraEls = document.querySelectorAll("#bookingExtras [data-extra]");
const cleanEls = document.querySelectorAll("#bookingCleanup [data-clean]");

async function getSettings() {
  const { booking_settings } = await chrome.storage.local.get(["booking_settings"]);
  return { ...BOOKING_DEFAULTS, ...(booking_settings || {}) };
}

async function saveSettings(change) {
  const settings = { ...(await getSettings()), ...change };
  await chrome.storage.local.set({ booking_settings: settings });
  await pushState();
}

async function pushState() {
  const { booking_enabled } = await chrome.storage.local.get(["booking_enabled"]);
  await sendToActiveTab({
    type: "booking_update",
    enabled: booking_enabled !== false,
    settings: await getSettings(),
  });
}

const loadBookingToggle = featureToggle({
  key: "booking_enabled",
  toggle: document.getElementById("bookingToggle"),
  status: document.getElementById("bookingStatus"),
  onChange: pushState,
});

export async function loadBooking() {
  await loadBookingToggle();
  const settings = await getSettings();
  sortEl.value = settings.sort;
  scoreEl.value = settings.score;
  minReviewsEl.value = String(settings.minReviews);
  budgetMinEl.value = settings.budgetMin || "";
  budgetMaxEl.value = settings.budgetMax || "";
  // The currency the budget was set in, else the one Booking last showed
  const { booking_currency } = await chrome.storage.local.get(["booking_currency"]);
  budgetCurrencyEl.value = settings.budgetCurrency || booking_currency || "";
  extraEls.forEach((el) => el.classList.toggle("off", !settings.extras.includes(el.dataset.extra)));
  cleanEls.forEach((el) => el.classList.toggle("off", !settings[el.dataset.clean]));
}

sortEl.addEventListener("change", () => saveSettings({ sort: sortEl.value }));
scoreEl.addEventListener("change", () => saveSettings({ score: scoreEl.value }));
minReviewsEl.addEventListener("change", () => saveSettings({ minReviews: Number(minReviewsEl.value) }));

// Amounts are whole numbers in the currency next to them; an empty field means no
// limit on that side
function saveBudget() {
  const amount = (el) => Math.max(0, Math.round(Number(el.value) || 0));
  budgetCurrencyEl.value = budgetCurrencyEl.value.trim().toUpperCase();
  return saveSettings({
    budgetMin: amount(budgetMinEl),
    budgetMax: amount(budgetMaxEl),
    budgetCurrency: /^[A-Z]{3}$/.test(budgetCurrencyEl.value) ? budgetCurrencyEl.value : "",
  });
}
[budgetMinEl, budgetMaxEl, budgetCurrencyEl].forEach((el) => el.addEventListener("change", saveBudget));

extraEls.forEach((el) => {
  el.addEventListener("click", async () => {
    const on = el.classList.toggle("off") === false;
    const { extras } = await getSettings();
    const next = on ? [...new Set([...extras, el.dataset.extra])] : extras.filter((x) => x !== el.dataset.extra);
    await saveSettings({ extras: next });
  });
});

cleanEls.forEach((el) => {
  el.addEventListener("click", async () => {
    const on = el.classList.toggle("off") === false;
    await saveSettings({ [el.dataset.clean]: on });
  });
});
