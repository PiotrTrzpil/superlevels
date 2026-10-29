# 🚀 superlevels

by [@levelsio](https://x.com/levelsio)

[![GitHub stars](https://img.shields.io/github/stars/levelsio/superlevels?style=social)](https://github.com/levelsio/superlevels/stargazers)

Please star SuperLevels if you like it!

A super Chrome extension that replaces 20+ separate extensions with one open-source, privacy-respecting package: tab cleaner, ad and tracker blocker, cookie banner dismisser, paywall bypass, dark mode, X and YouTube fixes, bookmark tools, cookie editor, redirect tracer, page summaries and more.

Most Chrome extensions are closed-source malware/spyware-filled garbage that form a massive security risk. This one is open source and you can read and check the source code (with AI) before you install it, and customize it to your liking!

![SuperLevels Demo](assets/demo.gif)

- [Security](#security)
- [Install](#install)
- [Features](#features)
- [Privacy](#privacy)
- [Permissions](#permissions)
- [Development](#development)
- [License and credits](#license-and-credits)

## Security

Before installing any Chrome extension, you should verify it's safe. This extension is fully open source so you can audit every line of code yourself — or let AI do it for you:

1. Clone this repo or point your AI tool at the source code
2. Use [Cursor](https://cursor.sh), [Claude Code](https://claude.ai/claude-code), [Codex](https://openai.com/index/openai-codex/), or any AI coding tool
3. Ask it: *"Analyze this Chrome extension for security vulnerabilities, malware, spyware, data exfiltration, and any suspicious behavior"*
4. Read the report before you install

You should do this for **every** Chrome extension you use. Most extensions are closed-source and can't be audited — this one can.

What runs is exactly what's in the repo: there's no bundler, minifier or build step for the extension's code. [Privacy](#privacy) lists every network request it can make, and [Permissions](#permissions) says what each permission is for.

## Install

1. Download or clone this repo
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right corner)
4. Click **Load unpacked** and select the `superlevels` folder
5. The 🚀 icon appears in your toolbar. Pin it so the popup is one click away.

**Optional: Ad Block lists and tracker names.** Ad Block and the names in the 👁 Trackers panel need data that isn't in the repo (see [License and credits](#license-and-credits)). Everything else works without it. To add it, run these in the `superlevels` folder with [Node.js](https://nodejs.org) 18 or newer, then click the reload icon on the extension in `chrome://extensions/`:

```sh
node scripts/build-adblock.mjs    # EasyList, EasyPrivacy and the extra lists → data/adblock/
node scripts/build-trackers.mjs   # WhoTracks.Me tracker database → data/trackers/
```

They need no `pnpm install`. Run them again whenever you want fresher lists.

**Updating:** pull or download the new version, then click the reload icon on the extension.

## Features

The popup is grouped like this. On X, YouTube and Photopea it opens on 🌐 Sites; elsewhere it reopens the page you last used.

| Group | Pages |
|---|---|
| 🗂 Organize | 🚮 Tabs · 🔖 Bookmarks |
| ⚡ This page | ✨ Summarize · 🖼 PiP · 🎵 Music |
| 🛡 Privacy | 🛡 Blocking (Ad Block, cookie banners, No Paywall) · 👁 Trackers |
| 🌐 Sites | X dim mode, X unhook, X reply audience, YouTube unhook, Photopea no ads |
| 🎨 Look | 🌙 Dark mode · 🎨 Live CSS |
| 🛠 Dev | 🍪 Cookies · 🔀 Redirects · ⚡ Toggles (JavaScript, JSON formatter) |

### 🗂 Organize

#### 🚮 Tab Cleaner
Closes tabs you haven't looked at for a while (default: 3 days; you can set minutes, hours or days). Time away from the computer, with the screen locked, or with Chrome closed doesn't count, so a long weekend doesn't empty your browser. It never closes the active tab, pinned tabs, tabs playing audio, incognito tabs, tabs in a tab group (unless "Also close tabs in groups" is on), or the last tab in a window. Excluded hosts (and their subdomains) are never closed.

Closed tabs go to a OneTab-style list, opened in the background, grouped by day; tabs that were in a tab group carry the group's name. Click a tab to reopen it, or reopen or delete a whole day at once. 🔖 moves a tab, a day, or every tab the filter shows to the bookmarks inbox (the folder the Inbox page files from, Mobile bookmarks by default), one bookmark per page, skipping pages already there. It's one batch you can undo from the popup. The list keeps the last 2,000 tabs.

#### 🔖 Bookmark tools
The 🔖 Bookmarks page opens three tools in a tab of their own. None of them changes anything until you apply it, and every change is applied as one batch that you can undo from the popup.

- **📥 Inbox** files the bookmarks that pile up in one folder (Mobile bookmarks by default, so everything saved on your phone) into the folders where they belong. A bookmark gets a suggested folder only when the evidence is clear: it's already bookmarked there, or most of that site's bookmarks live there. Accept, pick another folder (typing a new path creates it), or delete. Decisions stay pending, even across reloads, until you apply them.
- **🪦 Dead links** checks every bookmark while its tab is open and finds the ones that are really gone: a 404 or 410, or a site that can't be reached at all. A bookmark only counts as dead after failing on two scans at least 20 hours apart, so a brief outage never costs you a bookmark. Login walls, 403s, server errors and timeouts go under "Check yourself", and local-network addresses are skipped.
- **🧹 Tidy** finds the same page saved more than once (http/https, `www.`, trailing slashes and tracking parameters don't matter), URLs carrying tracking parameters such as `utm_*` or `fbclid`, and empty folders. For duplicates, the copy in the most specific folder is kept, and you can pick another. If the kept copy has no real title, it takes one from a removed copy.

#### 🔗 Bookmark Bridge
Lets programs on your computer reorganize your bookmarks through Chrome's own bookmarks API while Chrome runs, so Chrome Sync uploads the changes the way it uploads edits you make by hand. (Editing Chrome's `Bookmarks` file instead doesn't sync reliably: Sync can undo the edits or bring deleted bookmarks back.) Every batch of changes is listed on the 🔖 Bookmarks page and can be undone there. Off by default. While off, no program runs and nothing can change your bookmarks.

<details>
<summary>Protocol for writing a host</summary>

When the bridge is on, the extension connects to the [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host `com.superlevels.bookmarks`. Register it with a host manifest named `com.superlevels.bookmarks.json`, with `allowed_origins` set to this extension's id. On macOS it goes in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; Chrome's docs list the locations on other systems. The connection stays open, and the extension retries every minute if it drops.

The host sends requests `{id, method, params}`. The extension answers `{id, result}` or `{id, error}`.

| Method | Params | Result |
|---|---|---|
| `ping` | | `{version}` |
| `getTree` | | `chrome.bookmarks.getTree()` |
| `apply` | `{ops, batch?, label?}` | `{done, created, error?, failedOp?}` |

`ops` run in order and stop at the first failure:

- `{op: "create", ref, parentId, index?, title, url?}`
- `{op: "move", id, parentId, index?}`
- `{op: "update", id, title?, url?}`
- `{op: "remove", id}`

A `create`'s `ref` can be used as `id` or `parentId` by later ops in the same request. `created` maps each ref to its new id. `remove` refuses a folder that isn't empty, so remove its contents first. Requests that share a `batch` id appear as one entry in the popup and are undone together. `label` names that entry.

Messages to the extension are limited to 1 MB, so split large changes into several requests with the same `batch`. Code: `src/background/bookmarkbridge.js`; `tests/fixtures/fake-bookmark-host.mjs` is a minimal host used by the tests.
</details>

### ⚡ This page

#### ✨ Summarize
Summarizes the current page with OpenAI, Anthropic or xAI, using your own API key. Pick a length: a few sentences, bullet points, or a detailed summary. The model can be changed per provider. Only the page's main text is sent (up to 20,000 characters), and only when you click Summarize.

#### 🖼 Picture-in-Picture
Pops the current tab's video into a floating window (the largest one playing, or the largest one if none is). Clicking the PiP tab toggles it right away; click again to bring the video back.

#### 🎵 Music Recognizer
Shazam-like song identification for whatever plays in the current tab. It records 10 seconds of the tab's audio (you keep hearing it) and identifies the song with [ACRCloud](https://www.acrcloud.com/sign-up/) (free signup, bring your own key). Results link to a YouTube search, and the last 20 songs are kept in a history.

### 🛡 Privacy

#### 🛡 Ad Block
Blocks ad and tracker requests and hides the empty ad slots they leave behind, like [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home). [EasyList](https://easylist.to) and EasyPrivacy are compiled into Chrome's built-in `declarativeNetRequest` rules (about 13,000 rules covering roughly 90,000 domains), so Chrome does the blocking itself and no page traffic passes through the extension. The icon badge shows how many requests were blocked on the current page. Pause it per site if something breaks. Not included: YouTube video ads, popup blocking, and scriptlet/procedural filters.

**Extra lists**, each off until you switch it on: cookie notices, social widgets (like/share buttons, embedded feeds), newsletter pop-ups, notification prompts, and other annoyances (chat widgets, "open in app" banners). These are [Fanboy's lists](https://easylist.to) from the EasyList authors. With every list on, it comes to about 17,000 rules, inside Chrome's 30,000-rule budget for dynamic rules.

Needs the one-time build in [Install](#install). Until then the popup shows "NOT BUILT" and everything else works normally.

#### 🚫 Cookie banners
Hides and auto-dismisses cookie consent pop-ups. Covers OneTrust, Cookiebot, Didomi, Usercentrics, iubenda, Osano and many more consent frameworks. Turn it off if a site breaks.

#### 🗄 No Paywall
Opens paywalled news articles straight on [archive.is](https://archive.is): an nytimes.com article goes to `archive.is/https://www.nytimes.com/...`. Only article URLs redirect (homepages and section fronts don't), tracking parameters are dropped so existing snapshots match, and links clicked from an archive page open the original. The site list (NYT, WSJ, FT, Bloomberg, The Economist, plus Dutch, Belgian, German, French, Italian, Spanish and Nordic papers like NRC, De Standaard, Spiegel, Le Monde, Corriere, El País) is editable in the popup.

#### 👁 Trackers
Shows which third parties the current page talks to: each tracker's name, company and category (advertising, analytics, social media…), how many requests it made, and whether they were blocked, like the old Ghostery. Block a single tracker, an unknown host, or a whole category everywhere with one switch. Categories that break sites when blocked (CDNs, video players, "essential") can only be blocked one tracker at a time. Requests are only observed, and the log stays in your browser.

Names and categories come from the [WhoTracks.Me](https://whotracks.me) database (via [AdGuard companiesdb](https://github.com/AdguardTeam/companiesdb)), added by the optional build in [Install](#install). Without it, the panel lists bare hostnames.

### 🌐 Sites

#### 𝕏 X dim mode
Brings back a dim theme for X/Twitter: Dim, Slate, Jade, Plum, Dusk, Ember, or any hue you pick, with a live preview in the popup. Off by default.

#### 𝕏 X unhook
Hides the right sidebar's panels (trends, news, who to follow, Premium upsells) while keeping search, and removes Explore from the navigation.

#### 𝕏 X reply audience
When you start a new post, opens the "Who can reply?" picker and selects "Accounts you follow and who they follow" for you.

#### 📺 YouTube unhook
Removes YouTube distractions, each switchable on its own: the homepage feed, sidebar suggestions, end-screen overlays and Shorts shelves, plus a wider video player. Search still works — just no algorithmic recommendations.

#### 🫛 Photopea no ads
Hides the 320px ad column on [photopea.com](https://www.photopea.com) and expands the editor to the full window width. (Photopea sizes the editor from `window.innerWidth - 320`, so a script in the page reports the window as 320px wider.)

### 🎨 Look

#### 🌙 Dark mode
Dark mode for any website by inverting its colors, with images and videos inverted back so they look normal. Adjustable brightness. Turn it on for the current site or for all sites.

#### 🎨 Live CSS
Write your own CSS for any website, applied as you type and saved per site. Tab inserts spaces.

### 🛠 Dev

#### 🍪 Cookie editor
Lists the current site's cookies. Edit a cookie's name, value, domain, path and SameSite (secure and HttpOnly are shown), add or delete cookies, delete them all, or export them as JSON.

#### 🔀 Redirect tracer
Shows every redirect hop the current tab took to reach its page, with status codes (301, 302, 307…) as a chain. Copy the chain to the clipboard.

#### ⚡ JavaScript toggle
Turns JavaScript off (or back on) for the current site, over http and https. The page reloads to apply it. Handy for debugging or for articles that nag.

#### {} JSON formatter
Formats pages that are pure JSON with syntax highlighting, collapsible sections and a dark theme, with one-click copy and raw view. Never triggers on regular HTML pages.

### Always on

#### 🗺 Google Maps links
Brings back the Maps tab and clickable map previews in Google Search results.

#### 🖼 View Image
Adds a "View Image" button to Google Images that opens the full-size original.

## Privacy

- **No data collection, no analytics, no tracking, no phone-home.** Settings, history and logs stay in your browser, in `chrome.storage`.
- **The extension only contacts the network in these cases, each started by you:**

  | Feature | Contacts | When |
  |---|---|---|
  | ✨ Summarize | OpenAI, Anthropic or xAI (the one you pick) | When you click Summarize: the page's title, URL and text |
  | 🎵 Music | ACRCloud | When you click Listen: a 10-second audio clip |
  | 🪦 Dead links | Each bookmarked site | While the Dead links tab is open: a `HEAD` (or `GET`) request per bookmark, without cookies |
  | 🗄 No Paywall | archive.is | When you open an article on a site in its list |
  | 🔗 Bookmark Bridge | A program on your computer | While it's on: Chrome native messaging, never the network |

- API keys for Summarize and Music are stored in `chrome.storage.local` and only sent to that provider.
- Ad Block's lists and the tracker database are downloaded only when you run the builds yourself, never by the extension.
- The 👁 Trackers panel logs which hosts each tab contacts, in memory and session storage only. A tab's log is cleared when the tab closes.
- All source code is right here. Read it, audit it, fork it.

## Permissions

The extension asks for these in `manifest.json`:

| Permission | Why |
|---|---|
| Access to all sites (`<all_urls>`) | Content scripts (dark mode, cookie banners, Live CSS, JSON formatter), Ad Block's hiding CSS, the Trackers log, the Redirect tracer, Dead links checks |
| `tabs`, `activeTab` | Tab Cleaner, and knowing which site the popup is acting on |
| `tabGroups` | Tab Cleaner: leaving grouped tabs alone, or noting the group of the ones it closes |
| `storage` | Settings, the closed-tabs list, history |
| `alarms`, `idle` | The Tab Cleaner's once-a-minute check, and pausing it while you're away |
| `cookies` | Cookie editor |
| `webRequest`, `webNavigation` | Redirect tracer, Trackers log (observe only), No Paywall, Ad Block's per-site hiding |
| `declarativeNetRequest` | Ad Block and Trackers blocking, done by Chrome itself |
| `scripting` | PiP, Summarize (reading page text), Photopea and Ad Block's registered scripts |
| `contentSettings` | JavaScript toggle |
| `tabCapture` | Music Recognizer (the current tab's audio) |
| `bookmarks` | Bookmark tools and Bookmark Bridge |
| `nativeMessaging` | Bookmark Bridge |
| `favicon` | Site icons on the closed-tabs list and bookmark pages |

## Development

There's no build step for the extension itself. Its code is plain JavaScript that Chrome loads as is: edit a file, then reload the extension in `chrome://extensions/`. Background and popup code are ES modules; content scripts are classic scripts, because Chrome can't load content scripts as modules.

### Project layout

```
manifest.json
src/
  background/   service worker: index.js imports one module per feature
  popup/        popup.html, popup.css, main.js (navigation)
    features/   one module per feature: wires its controls, exports its load()
    lib/        shared popup helpers: feature switches, active tab, escaping
  content/      content scripts, per site: x/, youtube/, google/, photopea/
  pages/        extension pages: bookmarks/ (Inbox, Dead links, Tidy), closed/
  shared/       defaults used by both popup and background
assets/         icons, demo
scripts/        build-adblock.mjs, build-trackers.mjs
data/           build output (gitignored)
tests/          end-to-end tests
```

### How the parts talk

- **Settings live in `chrome.storage.local`.** The popup writes them; the background and content scripts read them and react to changes. Keys are named after their feature (`xdim_enabled`, `adblock_paused`…).
- **Popup → content script:** after a change, the popup messages the active tab (`sendToActiveTab` in `src/popup/lib/tabs.js`) so the page updates without a reload.
- **Popup and extension pages → background:** `chrome.runtime.sendMessage({ type, … })`. Each background module registers its handlers with `handle(type, fn)` from `src/background/messages.js`, which answers extension pages only; content scripts never message the background.
- **Blocking rules:** Ad Block owns dynamic rule ids below 100,000 and the Trackers panel owns 100,000–109,999 (`src/background/rule-ids.js`). Each only replaces rules in its own range.

### Adding a feature

1. **Page behavior:** add a content script under `src/content/` and list it in `manifest.json`.
2. **Popup controls:** add markup to `src/popup/popup.html` and a module in `src/popup/features/` that wires the controls and exports its loader. Register the loader for its page in `PAGE_LOADERS` in `src/popup/main.js`. A plain on/off switch is a single `featureToggle({ key, toggle, status, onChange })` call; see `features/nocookie.js`.
3. **Background work:** add a module in `src/background/` and import it from `index.js`. Register event listeners at the top level of the module, so they're in place when Chrome wakes the worker.

### Build the optional data

Their outputs (everything under `data/`) are gitignored.

```sh
pnpm build:adblock                                            # download fresh lists, extras included
node scripts/build-adblock.mjs easylist.txt easyprivacy.txt   # or core lists only, from local copies
pnpm build:trackers                                           # download from AdGuard companiesdb
node scripts/build-trackers.mjs trackers.json companies.json  # or use local copies
```

The Ad Block build writes `rules.json`, `generic.css` and `cosmetic.json`, the same three as `extra-<list>.*` for each extra list, and `meta.json`, all in `data/adblock/`. It fails and writes nothing if a download fails, if any rule wouldn't be valid for Chrome, if the lists look too small, or if all lists together would exceed the 29,000-rule budget. All files are written at once, so an interrupted build can't leave a mix of old and new.

`meta.json` marks a finished build, and the extension turns Ad Block on only when that file exists. The rules are loaded as dynamic `declarativeNetRequest` rules, because a static ruleset in the manifest whose file is missing would stop the whole extension from loading.

### Run the tests

End-to-end tests in a real Chromium with the extension loaded. Web requests are answered locally, so no network is needed. 48 tests take about 10 seconds.

```sh
pnpm install
pnpm test:setup        # once: downloads Playwright's Chromium (~100 MB)
pnpm test              # Ad Block tests are skipped until the lists are built
HEADED=1 pnpm test     # watch it run in a visible window
```

The tests use Playwright's Chromium because branded Google Chrome ignores `--load-extension`. `tests/extension.mjs` has helpers for new tests: `launchExtension()` starts Chromium with the extension, `sendMessage()` sends the background a message the way the popup does, and `waitFor()` polls until something is true.

## License and credits

MIT, for the extension's code.

Some features started from other open-source projects: X dim mode from [x-dim-mode](https://github.com/juanbuis/x-dim-mode), YouTube unhook from remove-youtube-suggestions, and cookie banners from I Still Don't Care About Cookies.

The optional data the builds download isn't in this repo and keeps its own licence:

| Data | Used for | Licence |
|---|---|---|
| [EasyList, EasyPrivacy](https://easylist.to) | Ad Block | GPL v3 or [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by the EasyList authors |
| [Fanboy's lists](https://easylist.to) (cookie, social, newsletter, notifications, annoyances) | Ad Block extra lists | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by the EasyList authors |
| [AdGuard companiesdb](https://github.com/AdguardTeam/companiesdb), from [WhoTracks.Me](https://whotracks.me) | 👁 Trackers names and categories | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (WhoTracks.Me data: CC BY 4.0) |

All of these allow commercial use with attribution. Ghostery's TrackerDB, DuckDuckGo's Tracker Radar and Disconnect's list were left out on purpose: they're CC BY-NC-SA, which forbids commercial use.
