// ═══════════════════════════════════
//  superlevels: Cookie banner refusal
//  Hides the banner and clicks a refusal when the site offers one.
//  Never clicks Accept, Allow, Agree, Close, or Dismiss, and never writes a consent cookie.
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-nocookie";

  // Wrapped in :is(...):not(html, body) — CMPs (and substring matches like
  // [class*="cookie-consent"]) put classes such as sp-message-open or
  // cookie-consent-open on <html>/<body>, which would blank the whole page.
  const HIDE_CSS = `
    :is(#cookie-banner, #cookie-notice, #cookie-consent, #cookie-popup,
    #cookiebanner, #cookienotice, #cookieconsent, #cookiepopup,
    #cookie_banner, #cookie_notice, #cookie_consent, #cookie_popup,
    .cookie-banner, .cookie-notice, .cookie-consent, .cookie-popup,
    .cookiebanner, .cookienotice, .cookieconsent, .cookiepopup,
    .cookie_banner, .cookie_notice, .cookie_consent, .cookie_popup,
    #gdpr-banner, #gdpr-consent, .gdpr-banner, .gdpr-consent,
    #cc-window, .cc-window, .cc-banner, .cc-overlay, .cc-revoke,
    #onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter,
    #ot-sdk-btn-floating,
    .cky-consent-container, #cky-consent,
    .didomi-popup, #didomi-host, #didomi-notice,
    #sp_message_container_0,
    [class*="cookie-banner"], [class*="cookie-consent"],
    [id*="cookie-banner"], [id*="cookie-consent"],
    [class*="CookieBanner"], [class*="CookieConsent"],
    .fc-consent-root, .fc-dialog-overlay, .fc-dialog,
    #qcCmpUi, .qc-cmp2-container,
    .truste_box_overlay, #truste-consent-track,
    .osano-cm-dialog, .osano-cm-window,
    [aria-label="Cookie banner"], [aria-label="cookie consent"],
    .evidon-banner, #_evidon_banner,
    .iubenda-cs-container, #iubenda-cs-banner,
    .klaro, .cookie-modal-wrapper,
    #usercentrics-root, [id^="usercentrics"],
    .cmpboxBG, .cmpbox, #cmpbox, #cmpbox2,
    .js-cookie-consent, .cookie-law-info-bar,
    #cookie-law-info-bar, .cli-modal,
    .eupopup, #eu-cookie-bar, .eu-cookie-compliance-banner,
    #catapult-cookie-bar, .ct-ultimate-gdpr-cookie-popup,
    .cookiealert, #cookiealert, .cookie-alert,
    .consent-banner, #consent-banner, .consent-popup,
    [data-testid="cookie-banner"], [data-testid="cookie-consent"],
    .snigel-cmp-framework, #snigel-cmp-framework,
    .adroll_consent_banner, #adroll_consent_container,
    .termly-consent-banner, #termly-code-snippet-support,
    .CybotCookiebotDialog, #CybotCookiebotDialog,
    #CybotCookiebotDialogBodyUnderlay,
    .cmplz-cookiebanner, #cmplz-cookiebanner-container):not(html, body) {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      z-index: -99999 !important;
    }
    body.cookie-consent-open,
    body.modal-open-cookie,
    body.sp-message-open,
    body.qc-cmp-showing,
    body.cmplz-blocked-content-container,
    html.sp-message-open,
    html.cookie-consent-open,
    body.ot-overflow-hidden,
    html.ot-overflow-hidden {
      overflow: auto !important;
      position: static !important;
    }
    .cc-grower { max-height: 0 !important; }
  `;

  // Vendor reject controls. These ids and classes are the refuse action, never Accept,
  // Allow, Agree, Close, or Dismiss (those record a yes, or save whatever was pre-ticked).
  const REJECT_SELECTORS = [
    "#onetrust-reject-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#CybotCookiebotDialogBodyLevelButtonDecline",
    ".cky-btn-reject",
    "#didomi-notice-disagree-button",
    ".didomi-continue-without-agreeing",
    "[data-cookiefirst-action='reject']",
    "[data-cookiefirst-action='decline']",
    ".osano-cm-denyAll",
    ".osano-cm-deny",
    ".iubenda-cs-reject-btn",
    ".cmplz-deny",
    ".cmplz-btn.cmplz-deny",
    ".wt-cli-reject-btn",
    "#cookie_action_close_header_reject",
    ".cc-deny",
    "[data-tid='banner-decline']",
    ".fc-cta-do-not-consent",
    "button[data-gdpr='reject']",
    "button[data-gdpr='decline']",
    "[data-testid='uc-deny-all-button']",
    "[data-testid='uc-reject-all-button']",
  ];

  // The whole accessible name must be a refusal. "Accept", "Agree", "Save" and
  // "Allow selection" do not match, so they are never clicked.
  const REJECT_LABELS = new Set([
    "reject", "reject all", "reject all cookies", "reject additional cookies",
    "reject non-essential", "reject non-essential cookies",
    "refuse", "refuse all", "decline", "decline all", "decline all cookies",
    "deny", "deny all", "deny all cookies", "disagree",
    "necessary only", "essential only", "essentials only",
    "only necessary", "only essential", "only required",
    "only necessary cookies", "only essential cookies",
    "use necessary only", "use necessary cookies only",
    "continue without accepting", "continue without agreeing",
    "alle ablehnen", "alles ablehnen", "ablehnen", "nur notwendige", "nur essenzielle",
    "tout refuser", "refuser", "continuer sans accepter", "je refuse",
    "alles weigeren", "weigeren", "alles afwijzen", "afwijzen", "alleen noodzakelijke",
    "odrzuć", "odrzuć wszystko", "odrzuć wszystkie", "tylko niezbędne", "nie zgadzam się",
    "rechazar", "rechazar todo", "rechazar todas",
    "rifiuta", "rifiuta tutto", "rifiuta tutti",
    "avvisa", "avvisa alla", "afvis", "afvis alle",
    "rejeitar", "rejeitar tudo", "recusar", "recusar tudo",
    "odmítnout", "odmítnout vše", "hylkää", "hylkää kaikki",
  ]);

  // Generic labels also appear on invitations and friend requests, so only buttons
  // inside a consent dialog qualify. The extra hosts are frameworks whose root
  // has neither "cookie" nor "consent" in the name.
  const CONSENT_SCOPE = `:is(
    [class*="cookie" i], [id*="cookie" i],
    [class*="consent" i], [id*="consent" i],
    [class*="gdpr" i], [id*="gdpr" i],
    #sp_message_container_0, #qcCmpUi, .qc-cmp2-container,
    .truste_box_overlay, .osano-cm-dialog, .osano-cm-window,
    .evidon-banner, #_evidon_banner, .klaro,
    .cmpbox, #cmpbox, #cmpbox2,
    .snigel-cmp-framework, #usercentrics-root, [id^="usercentrics"]
  ):not(html, body)`;
  const BUTTON = "button, [role='button'], input[type='button'], input[type='submit']";
  const clicked = new WeakSet();

  function searchRoots() {
    const roots = [document];
    for (const host of document.querySelectorAll("#usercentrics-root, [id^='usercentrics']")) {
      if (host.shadowRoot) roots.push(host.shadowRoot);
    }
    return roots;
  }

  function labelOf(el) {
    const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.textContent || "";
    return raw.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  }

  function isRejectLabel(text) {
    return REJECT_LABELS.has(text.toLowerCase());
  }

  function rejectButtonIn(root) {
    for (const el of root.querySelectorAll(BUTTON)) {
      if (!clicked.has(el) && isRejectLabel(labelOf(el))) return el;
    }
    return null;
  }

  function findReject() {
    for (const sel of REJECT_SELECTORS) {
      for (const root of searchRoots()) {
        const el = root.querySelector(sel);
        if (el && !clicked.has(el)) return el;
      }
    }
    for (const root of searchRoots()) {
      for (const scope of root.querySelectorAll(CONSENT_SCOPE)) {
        const found = rejectButtonIn(scope);
        if (found) return found;
      }
      if (root.host && root.host.matches && root.host.matches(CONSENT_SCOPE)) {
        const found = rejectButtonIn(root);
        if (found) return found;
      }
    }
    return null;
  }

  function clickReject() {
    const target = findReject();
    if (!target) return;
    clicked.add(target);
    // The handler belongs to the page. A throw there must not stop later refusals.
    try { target.click(); } catch { /* page handler */ }
  }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = HIDE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeCSS() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  // Banners show up late. One scan per frame is enough, and the hide rule does not
  // block the click: a refusal is clicked even after the dialog is display:none.
  let active = false;
  let scheduled = false;
  let observer = null;

  function schedule() {
    if (!active || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (active) clickReject();
    });
  }

  function activate() {
    if (active) return;
    active = true;
    injectCSS();
    schedule();
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function deactivate() {
    active = false;
    scheduled = false;
    observer?.disconnect();
    observer = null;
    removeCSS();
  }

  // Check storage and apply
  chrome.storage.local.get(["nocookie_enabled"], (data) => {
    if (data.nocookie_enabled !== false) activate();
  });

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "nocookie_toggle") {
      if (msg.enabled) activate();
      else deactivate();
    }
  });
})();
