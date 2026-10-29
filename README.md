# 🚀 superlevels

by [@levelsio](https://x.com/levelsio)

[![GitHub stars](https://img.shields.io/github/stars/levelsio/superlevels?style=social)](https://github.com/levelsio/superlevels/stargazers)

Please star SuperLevels if you like it!

A super Chrome extension that replaces 12+ separate extensions with one open-source, privacy-respecting package.

Most Chrome extensions are closed-source malware/spyware-filled garbage that form a massive security risk. This one is open source and you can read and check the source code (with AI) before you install it, and customize it to your liking!

## Demo

![SuperLevels Demo](demo.gif)

## Security

Before installing any Chrome extension, you should verify it's safe. This extension is fully open source so you can audit every line of code yourself — or let AI do it for you:

1. Clone this repo or point your AI tool at the source code
2. Use [Cursor](https://cursor.sh), [Claude Code](https://claude.ai/claude-code), [Codex](https://openai.com/index/openai-codex/), or any AI coding tool
3. Ask it: *"Analyze this Chrome extension for security vulnerabilities, malware, spyware, data exfiltration, and any suspicious behavior"*
4. Read the report before you install

You should do this for **every** Chrome extension you use. Most extensions are closed-source and can't be audited — this one can.

## Features

### 🚮 Tab Cleaner
Automatically closes inactive tabs after a configurable timeout (default: 3 days; time away from the computer or with Chrome closed doesn't count). Set excluded hosts to keep important tabs alive. Closed tabs are saved to a OneTab-style list page (opened automatically in the background), grouped by day — click a tab to restore it, or restore/delete a whole day at once.

### 🍪 Cookie Editor
Full cookie manager for the current site. View, edit, add, and delete cookies. Export cookies as JSON. Expand any cookie to see and modify all fields including domain, path, SameSite, secure, and httpOnly flags.

### 🔀 Redirect Tracer
See every redirect hop your browser took to reach the current page. Shows status codes (301, 302, 307, etc.) with a visual chain. Copy the full redirect chain to clipboard.

### 🌙 Dark Mode
Instant dark mode for any website using CSS filter inversion. Adjustable brightness. Toggle per-site or globally. Images and videos are automatically re-inverted so they look normal.

### 𝕏 X Dim Mode
Custom dim theme for X/Twitter with 7 color palettes: Dim, Slate, Jade, Plum, Dusk, Ember, or a custom hue. Live preview in the popup.

### ⚡ JS Toggle
Disable JavaScript per-site with one click. Useful for debugging, reading articles without popups, or testing progressive enhancement. Page reloads automatically.

### 🚫 GDPR Cookie Consent Dismisser
Auto-hides and auto-clicks cookie consent banners. Supports OneTrust, CookieBot, Didomi, Quantcast, GDPR plugins, and dozens more frameworks. Toggle off if a site breaks.

### 🎨 Live CSS Editor
Write custom CSS for any website, applied in real-time as you type. Saved per-domain. Supports tab key for indentation.

### 📺 YouTube Unhook
Removes YouTube distractions: no homepage feed, no sidebar suggestions, no end screen overlays, no Shorts. Search still works — just no algorithmic recommendations.

### 🫛 Photopea No Ads
Hides the 320px ad column on [photopea.com](https://www.photopea.com) and expands the editor to the full window width (Photopea sizes the editor from `window.innerWidth - 320`, so a main-world script reports the window as 320px wider). Toggle in the popup.

### 🛡 Ad Block
Blocks ad and tracker requests and hides the empty ad slots they leave behind, like [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home). [EasyList](https://easylist.to) and EasyPrivacy are compiled into Chrome's built-in `declarativeNetRequest` rules (about 13,000 rules covering roughly 90,000 domains), so Chrome does the blocking itself and no page traffic passes through the extension. The icon badge shows how many requests were blocked on the current page. Pause it per site if something breaks. Not included: YouTube video ads, popup blocking, and scriptlet/procedural filters.

**Optional, needs a one-time build.** The compiled lists aren't in the repo. Until you build them, Ad Block stays off and everything else works normally. See [Install](#install), step 7.

### 🗄 No Paywall
Opens paywalled news articles straight on [archive.is](https://archive.is) — e.g. an nytimes.com article goes to `archive.is/https://www.nytimes.com/...`. Only article URLs redirect (homepages and section fronts don't), tracking params are stripped so existing snapshots match, and links clicked from an archive page open the original. The site list (NYT, WSJ, FT, Bloomberg, Economist, plus Dutch, German, French, Italian, Spanish and Nordic papers like NRC, Volkskrant, Spiegel, Zeit, Le Monde, Corriere, El País) is editable in the popup.

### 🎵 Music Recognizer
Shazam-like music identification for any tab. Captures 10 seconds of audio and identifies the song via [ACRCloud](https://www.acrcloud.com/sign-up/) (free signup, bring your own API key). Results link to YouTube. History of recognized songs.

### 🖼 Picture-in-Picture
Pop the largest video on the current tab into a floating PiP window with one click.

### 🗺 Google Maps Links
Re-adds clickable Maps links and map preview cards to Google Search results.

### 🖼 View Image
Adds a "View Image" button back to Google Images, linking directly to the full-size original image.

### {} JSON Formatter
Auto-detects pure JSON response pages and formats them with syntax highlighting, collapsible sections, and a dark theme. Copy or view raw with one click. Never triggers on regular HTML pages.

### 🔖 Bookmark Bridge
Lets programs on your computer reorganize your bookmarks through Chrome's own bookmarks API while Chrome runs, so Chrome Sync uploads the changes the way it uploads edits you make by hand. (Editing Chrome's `Bookmarks` file instead doesn't sync reliably: Sync can undo the edits or bring deleted bookmarks back.) Every batch of changes is listed in the popup and can be undone from there. Off by default. While off, no program runs and nothing can change your bookmarks.

<details>
<summary>Protocol for writing a host</summary>

When the bridge is on, the extension connects to the [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) host `com.superlevels.bookmarks`. Register it by writing `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.superlevels.bookmarks.json`, with `allowed_origins` set to this extension's id. The connection stays open, and the extension retries every minute if it drops.

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

Messages to the extension are limited to 1 MB, so split large changes into several requests with the same `batch`. Code: `bookmarkbridge.js`.
</details>

## Install

1. Download or clone this repo
2. Open Chrome and go to `chrome://extensions/`
3. Click **Manage Extensions** if you're not already there
4. Enable **Developer mode** (toggle in the top right corner)
5. Click **Load unpacked**
6. Select the `superlevels` folder
7. *Optional, for Ad Block:* with [Node.js](https://nodejs.org) 18 or newer, run this in the `superlevels` folder, then click the reload icon on the extension in `chrome://extensions/`:
   ```sh
   node adblock/build.mjs
   ```
   This downloads EasyList and EasyPrivacy and compiles them into `adblock/`. It needs no `pnpm install`. Run it again whenever you want fresher lists.
8. The 🚀 icon appears in your toolbar — you're done!

## Development

The only build step is the optional Ad Block lists. Their outputs (`adblock/*.json`, `adblock/generic.css`) are gitignored.

**Build the ad block lists.** This writes `adblock/rules.json`, `adblock/generic.css`, `adblock/cosmetic.json` and `adblock/meta.json`:

```sh
pnpm build:adblock                                    # download fresh lists
node adblock/build.mjs easylist.txt easyprivacy.txt   # or use local copies
```

The build fails and writes nothing if a download fails, if any rule wouldn't be valid for Chrome, or if the lists look too small. It writes all files at once, so an interrupted build can't leave a mix of old and new. `meta.json` marks a finished build, and the extension turns Ad Block on only when that file exists. The rules are loaded as dynamic `declarativeNetRequest` rules, because a static ruleset in the manifest whose file is missing would stop the whole extension from loading. Then reload the extension in `chrome://extensions` and run the tests.

**Run the tests.** This is an end-to-end run in a real Chromium with the extension loaded. Requests are answered locally, so no network is needed. It takes about 4 seconds.

```sh
pnpm install
pnpm test:setup        # once: downloads Playwright's Chromium (~100 MB)
pnpm test              # Ad Block tests are skipped until the lists are built
HEADED=1 pnpm test     # watch it run in a visible window
```

The tests use Playwright's Chromium because branded Google Chrome ignores `--load-extension`. `tests/extension.mjs` has a small `launchExtension()` helper for writing tests for the other features too.

## Privacy

- **No data collection.** Everything stays local in `chrome.storage.local`.
- **No analytics, no tracking, no phone-home.**
- The Bookmark Bridge is off by default. When on, it talks only to a local program you installed (Chrome native messaging), never to the network.
- Ad Block's filter lists are downloaded only when you run the build yourself, never by the extension at runtime.
- The only external network request is the Music Recognizer, which sends a short audio clip to ACRCloud — and only when you explicitly click "Listen" and provide your own API keys.
- All source code is right here. Read it, audit it, fork it.

## License

MIT
