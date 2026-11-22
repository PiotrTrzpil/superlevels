// ═══════════════════════════════════
//  HTML to Markdown (CommonMark, plus GFM tables and strikethrough) for the
//  reader page. It only has to handle what the reader's sanitizer keeps, so
//  anything it doesn't know is read for its contents.
// ═══════════════════════════════════

const HEADINGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const BLOCKS = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION",
  "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION",
  "SUMMARY", "TABLE", "UL"]);
const SKIP = new Set(["VIDEO", "AUDIO", "SOURCE", "TRACK"]);

const isBlock = (node) => node.nodeType === Node.ELEMENT_NODE && BLOCKS.has(node.nodeName);

// Characters that would otherwise turn text into markup. An underscore only
// matters at a word's edge (snake_case stays as it is).
function escapeText(text) {
  return text
    .replace(/[\\`*[\]<]/g, "\\$&")
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace("_", "\\_"))
    .replace(/~~/g, "\\~\\~");
}

// What would start a heading, quote, list or rule at the start of a line
function escapeLineStart(line) {
  return line.replace(/^(\s*)([#>+-]|=+$|\d+[.)])(?=\s|$)/, (_m, space, mark) =>
    space + (/^\d/.test(mark) ? mark.replace(/[.)]$/, "\\$&") : "\\" + mark));
}

function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^`|`$|^ .* $/.test(text) ? " " : "";
  return fence + pad + text + pad + fence;
}

function wrap(mark, inner) {
  const trimmed = inner.trim();
  if (!trimmed) return inner;
  // Spaces just inside the marks would stop them from working
  return inner.slice(0, inner.indexOf(trimmed[0])) + mark + trimmed + mark + inner.slice(inner.lastIndexOf(trimmed.at(-1)) + 1);
}

const destination = (url) => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);
const titlePart = (el) => (el.title ? ` "${el.title.replace(/["\\]/g, "\\$&")}"` : "");

// Inline content: text with whitespace collapsed; "\n" only from <br>
function inline(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.data.replace(/\s+/g, " "));
  if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.nodeName)) return "";
  const inner = () => [...node.childNodes].map(inline).join("");
  switch (node.nodeName) {
    case "BR": return "\\\n";
    case "STRONG": case "B": return wrap("**", inner());
    case "EM": case "I": case "CITE": case "DFN": case "VAR": return wrap("*", inner());
    case "DEL": case "S": return wrap("~~", inner());
    case "CODE": case "KBD": case "SAMP": return node.textContent ? codeSpan(node.textContent.replace(/\s+/g, " ")) : "";
    case "IMG": {
      const src = node.getAttribute("src");
      return src ? `![${escapeText(node.alt || "")}](${destination(src)}${titlePart(node)})` : "";
    }
    case "A": {
      const text = inner();
      const href = node.getAttribute("href");
      if (!href || !text.trim()) return text;
      return `[${text.trim()}](${destination(href)}${titlePart(node)})`;
    }
    default: return isBlock(node) ? " " + blocks(node).join(" ") + " " : inner();
  }
}

// A run of inline nodes as one paragraph (or nothing, if it's only whitespace)
function paragraph(nodes) {
  const text = nodes.map(inline).join("")
    .split("\n").map((line) => line.replace(/ +/g, " ").trim()).join("\n")
    .replace(/^(\\\n)+|(\\\n)+$/g, "").trim();
  return text ? text.split("\n").map(escapeLineStart).join("\n") : "";
}

const indent = (text, prefix, first = prefix) =>
  text.split("\n").map((line, i) => (line ? (i ? prefix : first) + line : line.trimEnd() || (i ? "" : first.trimEnd()))).join("\n");

function list(node) {
  const ordered = node.nodeName === "OL";
  let n = Number(node.getAttribute("start")) || 1;
  const items = [...node.children].filter((li) => li.nodeName === "LI").map((li) => {
    const marker = ordered ? `${n++}. ` : "- ";
    // An item without paragraphs of its own is tight: its text and a nested list on consecutive lines
    const tight = ![...li.children].some((child) => child.nodeName === "P");
    const body = blocks(li).join(tight ? "\n" : "\n\n");
    return indent(body, " ".repeat(marker.length), marker) || marker.trimEnd();
  });
  // A blank line inside any item makes the list loose; keep its items apart too
  return items.join(items.some((item) => item.includes("\n\n")) ? "\n\n" : "\n");
}

function table(node) {
  const rows = [...node.querySelectorAll("tr")].filter((tr) => tr.closest("table") === node)
    .map((tr) => [...tr.children].filter((c) => c.nodeName === "TD" || c.nodeName === "TH")
      .map((cell) => paragraph([...cell.childNodes]).replace(/\\?\n/g, " ").replace(/\|/g, "\\|")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function pre(node) {
  const code = node.textContent.replace(/\n$/, "");
  // A fence only ends the block at the start of a line (up to 3 spaces in)
  const longest = Math.max(2, ...(code.match(/^ {0,3}`{3,}/gm) || []).map((run) => run.trim().length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${code}\n${fence}`;
}

// One block element as Markdown blocks
function block(node) {
  const level = HEADINGS[node.nodeName];
  if (level) {
    const text = paragraph([...node.childNodes]).replace(/\\?\n/g, " ").replace(/^\\(?=#)/, "");
    return text ? ["#".repeat(level) + " " + text] : [];
  }
  switch (node.nodeName) {
    case "P": { const text = paragraph([...node.childNodes]); return text ? [text] : []; }
    case "HR": return ["---"];
    case "PRE": return [pre(node)];
    case "UL": case "OL": { const text = list(node); return text ? [text] : []; }
    case "TABLE": { const text = table(node); return text ? [text] : []; }
    case "BLOCKQUOTE": {
      const inner = blocks(node).join("\n\n");
      return inner ? [inner.split("\n").map((line) => (line ? "> " + line : ">")).join("\n")] : [];
    }
    case "FIGCAPTION": { const text = paragraph([...node.childNodes]); return text ? [wrap("*", text)] : []; }
    default: return blocks(node);
  }
}

// The children of a node as Markdown blocks (paragraphs, lists, …)
function blocks(node) {
  const out = [];
  let run = [];
  const flush = () => {
    const text = paragraph(run);
    if (text) out.push(text);
    run = [];
  };
  for (const child of node.childNodes) {
    if (isBlock(child)) {
      flush();
      out.push(...block(child));
    } else {
      run.push(child);
    }
  }
  flush();
  return out;
}

export function htmlToMarkdown(root) {
  return blocks(root).join("\n\n");
}
