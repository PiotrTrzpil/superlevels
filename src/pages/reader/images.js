// ═══════════════════════════════════
//  Downloads an article's images for the zip export. The extension's host
//  permissions let an extension page fetch them from any site, CORS aside.
// ═══════════════════════════════════

const TIMEOUT_MS = 15000;
const MAX_BYTES = 25 * 1024 * 1024;
const PARALLEL = 6;
const EXTENSIONS = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico",
};

// "images/03-photo.jpg": numbered, so two "image.jpg"s from different folders don't collide
function localName(url, type, index) {
  const path = new URL(url).pathname;
  const last = decodeURIComponent(path.split("/").pop() || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  const stem = last.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
  const ext = EXTENSIONS[type] ?? path.match(/\.([a-z0-9]{2,5})$/i)?.[1].toLowerCase() ?? "img";
  return `images/${String(index + 1).padStart(2, "0")}-${stem}.${ext}`;
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  // An HTML error page served with 200 isn't an image
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") throw new Error(`not an image: ${type}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error("too large");
  return { type, data };
}

// urls → Map(url → { name, data }); the ones that fail are left out
export async function downloadImages(urls) {
  const unique = [...new Set(urls)];
  const found = new Map();
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const index = next++;
      const url = unique[index];
      try {
        const { type, data } = await fetchImage(url);
        found.set(url, { name: localName(url, type, index), data });
      } catch (e) {
        console.warn("reader: image not saved", url, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, unique.length) }, worker));
  return found;
}
