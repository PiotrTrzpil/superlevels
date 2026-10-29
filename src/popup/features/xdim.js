// ═══════════════════════════════════
//  X Dim Mode
// ═══════════════════════════════════
import { sendToActiveTab } from "../lib/tabs.js";
import { featureToggle } from "../lib/toggle.js";

const xdimPreview = document.getElementById("xdimPreview");
const xdimHueSlider = document.getElementById("xdimHueSlider");
const xdimHueVal = document.getElementById("xdimHueVal");
const xdimCustomHueSection = document.getElementById("xdimCustomHueSection");
const xdimDots = document.querySelectorAll(".xdim-dot");

const XDIM_THEMES = {
  dim:   { hue: 210, sat: 34 },
  slate: { hue: 210, sat: 8  },
  jade:  { hue: 150, sat: 34 },
  plum:  { hue: 270, sat: 34 },
  dusk:  { hue: 330, sat: 34 },
  ember: { hue: 25,  sat: 34 },
};

let xdimTheme = "dim";
let xdimCustomHue = 210;

const loadXDimToggle = featureToggle({
  key: "xdim_enabled",
  defaultOn: false,
  toggle: document.getElementById("xdimToggle"),
  status: document.getElementById("xdimStatus"),
  onChange: (enabled) => sendToActiveTab({ type: "xdim_toggle", enabled }),
});

export async function loadXDim() {
  await loadXDimToggle();
  const data = await chrome.storage.local.get(["xdim_theme", "xdim_customHue"]);
  xdimTheme = data.xdim_theme ?? "dim";
  xdimCustomHue = data.xdim_customHue ?? 210;

  xdimHueSlider.value = xdimCustomHue;
  xdimHueVal.textContent = xdimCustomHue + "°";

  updateXDimThemeDots();
  updateXDimPreview();
}

function updateXDimThemeDots() {
  xdimDots.forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.theme === xdimTheme);
  });
  xdimCustomHueSection.classList.toggle("show", xdimTheme === "custom");
}

function getXDimHueSat() {
  if (xdimTheme === "custom") return { hue: xdimCustomHue, sat: 34 };
  return XDIM_THEMES[xdimTheme] || XDIM_THEMES.dim;
}

function updateXDimPreview() {
  const { hue: h, sat: s } = getXDimHueSat();
  const bSat = Math.round(s * 0.47);
  const bar = xdimPreview.querySelector(".xdim-preview-bar");
  const tweet = xdimPreview.querySelector(".xdim-preview-tweet");
  bar.style.background = `hsl(${h}, ${s}%, 16%)`;
  bar.style.color = `hsl(${h}, ${Math.round(s * 0.32)}%, 60%)`;
  tweet.style.background = `hsl(${h}, ${s}%, 13%)`;
  tweet.style.color = `hsl(${h}, ${Math.round(s * 0.32)}%, 60%)`;
  tweet.style.borderColor = `hsl(${h}, ${bSat}%, 26%)`;
}

xdimDots.forEach((dot) => {
  dot.addEventListener("click", async () => {
    xdimTheme = dot.dataset.theme;
    updateXDimThemeDots();
    updateXDimPreview();
    await chrome.storage.local.set({ xdim_theme: xdimTheme });
  });
});

xdimHueSlider.addEventListener("input", () => {
  xdimCustomHue = parseInt(xdimHueSlider.value);
  xdimHueVal.textContent = xdimCustomHue + "°";
  updateXDimPreview();
});
xdimHueSlider.addEventListener("change", async () => {
  xdimCustomHue = parseInt(xdimHueSlider.value);
  await chrome.storage.local.set({ xdim_customHue: xdimCustomHue });
});
