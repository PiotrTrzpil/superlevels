// ═══════════════════════════════════
//  Runtime messages from extension pages (popup, bookmarks, closed tabs)
//  One listener for the whole worker; each module registers a handler per
//  message type. A handler returns its response, or a promise of it; a
//  thrown error is answered as { error }.
//  Content scripts never message the background, and they run inside web
//  pages, so only extension pages are answered.
// ═══════════════════════════════════
const handlers = {};

export function handle(type, handler) {
  handlers[type] = handler;
}

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler || !fromExtensionPage(sender)) return;
  Promise.resolve()
    .then(() => handler(msg))
    .then((result) => sendResponse(result ?? {}), (e) => sendResponse({ error: e.message ?? String(e) }));
  return true; // async sendResponse
});
