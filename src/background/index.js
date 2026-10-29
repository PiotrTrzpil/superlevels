// ═══════════════════════════════════
//  Service worker entry point. Each feature module registers its own event
//  listeners when it's imported, so all of them are in place before Chrome
//  dispatches the event that woke the worker.
// ═══════════════════════════════════
import "./messages.js";
import "./tabcleaner.js";
import "./closed-tabs.js";
import "./redirects.js";
import "./pip.js";
import "./photopea.js";
import "./archive.js";
import "./adblock.js";
import "./trackers.js";
import "./bookmarkbridge.js";
