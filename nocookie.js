// ═══════════════════════════════════
//  superlevels: Cookie Consent Auto-Dismisser
//  Based on I-Still-Dont-Care-About-Cookies
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

  const CLICK_SELECTORS = [
    "#onetrust-accept-btn-handler",
    "#accept-recommended-btn-handler",
    ".onetrust-close-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "#CybotCookiebotDialogBodyLevelButtonAccept",
    ".cky-btn-accept",
    "#didomi-notice-agree-button",
    ".didomi-continue-without-agreeing",
    ".qc-cmp2-summary-buttons button[mode='primary']",
    ".qc-cmp-button[mode='primary']",
    ".fc-cta-consent .fc-primary-button",
    ".cc-accept", ".cc-btn.cc-dismiss", ".cc-allow",
    "[data-cookiefirst-action='accept']",
    ".cookie-accept", ".js-cookie-accept",
    ".cli-plugin-accept-btn",
    "#cookie_action_close_header",
    ".eupopup-button_1",
    "#eu-cookie-compliance-accept",
    ".iubenda-cs-accept-btn",
    ".osano-cm-accept-all",
    ".accept-cookies-button",
    "button[data-gdpr='accept']",
    ".js-accept-cookies",
    ".cmplz-btn.cmplz-accept",
    ".snigel-cmp-accept-all",
    '[aria-label="Accept cookies" i]',
    '[aria-label="Close" i][class*="cookie" i]',
    '[aria-label="Close" i][class*="consent" i]',
  ];

  // Generic labels like "Accept" or "Agree" also appear on invitations, friend
  // requests and terms dialogs, so only click them inside a cookie/consent box
  const CONSENT_SCOPE = ':is([class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], [id*="gdpr" i]):not(html, body)';
  const GENERIC_ACCEPT = [
    'button[title="Accept" i]', 'button[title="Accept all" i]', 'button[title="Allow all" i]',
    'button[title="Agree" i]', '[aria-label="Accept" i]', '[aria-label="Accept all" i]',
    '[aria-label="Allow all" i]', '[aria-label="Agree" i]',
    '.agree-button', '#agree-button', "[data-action='accept']",
  ];
  CLICK_SELECTORS.push(...GENERIC_ACCEPT.map((sel) => `${CONSENT_SCOPE} ${sel}`));

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = HIDE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function tryClick() {
    for (const sel of CLICK_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          el.click();
          return true;
        }
      } catch {}
    }
    return false;
  }

  function removeCSS() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function activate() {
    injectCSS();
    setTimeout(tryClick, 500);
    setTimeout(tryClick, 1500);
    setTimeout(tryClick, 3000);
    setTimeout(tryClick, 5000);
  }

  // Check storage and apply
  chrome.storage.local.get(["nocookie_enabled"], (data) => {
    if (data.nocookie_enabled !== false) activate();
  });

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "nocookie_toggle") {
      if (msg.enabled) activate();
      else removeCSS();
    }
  });
})();
