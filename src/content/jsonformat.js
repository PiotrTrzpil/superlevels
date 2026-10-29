// ═══════════════════════════════════
//  superlevels: JSON Formatter
//  Auto-detects pure JSON pages and formats with syntax highlighting
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "sl-jsonformat";
  // Original page text, captured on first format so the toggle can restore it
  let originalRaw = null;

  function isJsonPage() {
    // Primary signal: content type
    const ct = document.contentType || "";
    if (ct.includes("json")) return true;

    // Fallback: single <pre> with valid JSON (APIs served as text/plain)
    const body = document.body;
    if (!body) return false;

    // Reject pages with real HTML structure
    const children = body.children;
    if (children.length !== 1) return false;
    if (children[0].tagName !== "PRE") return false;

    // Check if <pre> contains valid JSON
    const text = children[0].textContent.trim();
    if (!text) return false;
    // Quick check: must start with { or [
    if (text[0] !== "{" && text[0] !== "[") return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  function syntaxHighlight(json) {
    // Escape HTML
    json = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = "sl-jf-number";
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? "sl-jf-key" : "sl-jf-string";
        } else if (/true|false/.test(match)) {
          cls = "sl-jf-bool";
        } else if (/null/.test(match)) {
          cls = "sl-jf-null";
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  function buildCollapsible(obj, indent) {
    indent = indent || 0;
    const pad = "  ".repeat(indent);
    const padInner = "  ".repeat(indent + 1);

    if (obj === null) return '<span class="sl-jf-null">null</span>';
    if (typeof obj !== "object") {
      // Primitive — let syntaxHighlight handle it via JSON.stringify
      return syntaxHighlight(JSON.stringify(obj));
    }

    const isArray = Array.isArray(obj);
    const open = isArray ? "[" : "{";
    const close = isArray ? "]" : "}";
    const entries = isArray ? obj : Object.keys(obj);

    if (entries.length === 0) {
      return isArray ? "[]" : "{}";
    }

    let html = `<span class="sl-jf-toggle" data-collapsed="false">${open}</span>`;
    html += `<span class="sl-jf-collapsible">`;
    html += "\n";

    entries.forEach((entry, i) => {
      const key = isArray ? null : entry;
      const val = isArray ? entry : obj[entry];
      const comma = i < entries.length - 1 ? "," : "";

      html += padInner;
      if (key !== null) {
        html += `<span class="sl-jf-key">"${escHtml(key)}"</span>: `;
      }
      html += buildCollapsible(val, indent + 1);
      html += comma + "\n";
    });

    html += `</span>`;
    html += `<span class="sl-jf-ellipsis" style="display:none">...</span>`;
    html += pad + close;

    return html;
  }

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function readRawText() {
    if (document.body.children.length === 1 && document.body.children[0].tagName === "PRE") {
      return document.body.children[0].textContent;
    } else if (document.body.querySelector("pre")) {
      return document.body.querySelector("pre").textContent;
    }
    return document.body.textContent;
  }

  function showRaw() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
    document.body.innerHTML = "";
    const pre = document.createElement("pre");
    pre.textContent = originalRaw.trim();
    document.body.appendChild(pre);
  }

  function applyJsonFormat() {
    if (document.getElementById(STYLE_ID)) return; // already formatted
    // Get raw JSON text (once — after formatting, the body holds our markup)
    const raw = originalRaw ?? readRawText();

    let parsed;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      return; // Can't parse — bail
    }
    originalRaw = raw;

    // Inject styles
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body {
        margin: 0; padding: 0;
        background: #161616 !important;
        color: #e8e8e8 !important;
        font-family: 'SF Mono', 'Consolas', 'Monaco', 'Menlo', monospace !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
      }
      .sl-jf-wrap {
        padding: 16px 20px;
        white-space: pre;
        overflow-x: auto;
        tab-size: 2;
      }
      .sl-jf-key { color: #d4a574; }
      .sl-jf-string { color: color-mix(in srgb, #4ade80 55%, #bbb); }
      .sl-jf-number { color: color-mix(in srgb, #60a5fa 45%, #aaa); }
      .sl-jf-bool { color: color-mix(in srgb, #fbbf24 55%, #bbb); }
      .sl-jf-null { color: #777; font-style: italic; }
      .sl-jf-toggle {
        cursor: pointer;
        user-select: none;
        position: relative;
      }
      .sl-jf-toggle:hover { text-decoration: underline; }
      .sl-jf-toggle::before {
        content: "▼";
        display: inline-block;
        width: 1em;
        margin-left: -1em;
        font-size: 10px;
        color: #666;
        transition: transform 0.15s;
      }
      .sl-jf-toggle[data-collapsed="true"]::before {
        transform: rotate(-90deg);
      }
      .sl-jf-ellipsis {
        color: #666;
        cursor: pointer;
      }
      .sl-jf-toolbar {
        position: fixed; top: 8px; right: 12px;
        display: flex; gap: 6px; z-index: 99999;
      }
      .sl-jf-toolbar button {
        padding: 5px 10px;
        background: #1e1e1e;
        color: #bbb;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        font-size: 11px;
        font-family: -apple-system, sans-serif;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .sl-jf-toolbar button:hover {
        background: #242424;
        color: #e8e8e8;
        border-color: #3a3a3a;
      }
    `;

    // Replace body content
    document.head.appendChild(style);
    document.body.innerHTML = "";

    // Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "sl-jf-toolbar";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify(parsed, null, 2)).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });

    const rawBtn = document.createElement("button");
    rawBtn.textContent = "Raw";
    rawBtn.addEventListener("click", showRaw);

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = "Collapse All";
    collapseBtn.addEventListener("click", () => {
      const all = document.querySelectorAll(".sl-jf-toggle");
      const shouldCollapse = collapseBtn.textContent === "Collapse All";
      all.forEach((t) => {
        t.dataset.collapsed = shouldCollapse ? "true" : "false";
        const block = t.nextElementSibling;
        const ellipsis = block.nextElementSibling;
        if (block) block.style.display = shouldCollapse ? "none" : "";
        if (ellipsis) ellipsis.style.display = shouldCollapse ? "inline" : "none";
      });
      collapseBtn.textContent = shouldCollapse ? "Expand All" : "Collapse All";
    });

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(collapseBtn);
    toolbar.appendChild(rawBtn);
    document.body.appendChild(toolbar);

    // Formatted JSON
    const wrap = document.createElement("div");
    wrap.className = "sl-jf-wrap";
    wrap.innerHTML = buildCollapsible(parsed, 0);
    document.body.appendChild(wrap);

    // Toggle click handler (event delegation); the "..." of a collapsed block expands it too
    wrap.addEventListener("click", (e) => {
      const clickedEllipsis = e.target.closest(".sl-jf-ellipsis");
      const toggle = clickedEllipsis
        ? clickedEllipsis.previousElementSibling.previousElementSibling
        : e.target.closest(".sl-jf-toggle");
      if (!toggle) return;
      const collapsed = toggle.dataset.collapsed === "true";
      toggle.dataset.collapsed = collapsed ? "false" : "true";
      const block = toggle.nextElementSibling;
      const ellipsis = block.nextElementSibling;
      if (block) block.style.display = collapsed ? "" : "none";
      if (ellipsis) ellipsis.style.display = collapsed ? "none" : "inline";
    });
  }

  function removeFormat() {
    if (document.getElementById(STYLE_ID)) showRaw();
  }

  // Check storage and apply
  chrome.storage.local.get(["jsonformat_enabled"], (data) => {
    if (data.jsonformat_enabled !== false && isJsonPage()) {
      applyJsonFormat();
    }
  });

  // Listen for toggle from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "jsonformat_toggle") {
      if (msg.enabled && isJsonPage()) applyJsonFormat();
      else removeFormat();
    }
  });
})();
