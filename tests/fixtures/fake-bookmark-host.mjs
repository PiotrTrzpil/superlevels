// ═══════════════════════════════════
//  Native messaging host for tests: forwards JSON lines from a Unix socket
//  ($FAKE_HOST_SOCKET) to the extension and writes back its answers, the way a
//  real bridge host would. Removes the socket when Chrome closes stdin.
// ═══════════════════════════════════
import { createServer } from "node:net";
import { rmSync } from "node:fs";

const socketPath = process.env.FAKE_HOST_SOCKET;
const pending = new Map();
let nextId = 1;

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
    const length = buffer.readUInt32LE(0);
    const message = JSON.parse(buffer.subarray(4, 4 + length));
    buffer = buffer.subarray(4 + length);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

const server = createServer((conn) => {
  let line = "";
  conn.on("data", (chunk) => {
    line += chunk;
    let nl;
    while ((nl = line.indexOf("\n")) >= 0) {
      const { method, params } = JSON.parse(line.slice(0, nl));
      line = line.slice(nl + 1);
      const id = nextId++;
      pending.set(id, ({ id: _, ...reply }) => conn.write(JSON.stringify(reply) + "\n"));
      send({ id, method, params });
    }
  });
});
server.listen(socketPath);

process.stdin.on("end", () => {
  server.close();
  rmSync(socketPath, { force: true });
  process.exit(0);
});
