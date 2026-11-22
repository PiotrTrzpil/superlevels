// ═══════════════════════════════════
//  Minimal ZIP writer: files stored uncompressed (the reader zips images,
//  which are compressed already, and a little Markdown), UTF-8 names.
// ═══════════════════════════════════

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, as zip stores them
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function header(size, fields) {
  const view = new DataView(new ArrayBuffer(size));
  let at = 0;
  for (const [bytes, value] of fields) {
    if (bytes === 4) view.setUint32(at, value, true);
    else view.setUint16(at, value, true);
    at += bytes;
  }
  return new Uint8Array(view.buffer);
}

const UTF8_NAMES = 0x0800;

// files: [{ name, data: Uint8Array | string }] → a Blob of the zip
export function zip(files, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const common = [[2, 20], [2, UTF8_NAMES], [2, 0], [2, time], [2, day], [4, crc], [4, data.length], [4, data.length], [2, name.length], [2, 0]];
    const local = header(30, [[4, 0x04034b50], ...common]);
    parts.push(local, name, data);
    central.push(header(46, [[4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]), name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, [[4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, centralSize], [4, offset], [2, 0]]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
