// ═══════════════════════════════════
//  Bookmark Bridge: a native host (tests/fixtures/fake-bookmark-host.mjs) drives
//  chrome.bookmarks through the extension; batches are journaled and undoable,
//  and turning the bridge off stops the host.
// ═══════════════════════════════════
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "./extension.mjs";
import { openBookmarks, seedBookmarks, treeShape, undoLatest, batches } from "./bookmarks-helpers.mjs";

const HOST = "com.superlevels.bookmarks";
// Unix socket paths are limited to 104 bytes on macOS; stay short.
const dir = mkdtempSync("/tmp/slb-");
const socketPath = join(dir, "s");
let ext;

// One request over the host's socket, as a local program would send it.
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const conn = connect(socketPath);
    let data = "";
    conn.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        conn.end();
        resolve(JSON.parse(data));
      }
    });
    conn.on("error", reject);
    conn.write(JSON.stringify({ method, params }) + "\n");
  });
}

const setBridge = (on) => ext.page.evaluate((on) => chrome.storage.local.set({ bookmarks_bridge_enabled: on }), on);

before(async () => {
  // Chromium runs the host with its own environment, so a wrapper pins node and the socket.
  const wrapper = join(dir, "host.sh");
  const script = fileURLToPath(new URL("./fixtures/fake-bookmark-host.mjs", import.meta.url));
  writeFileSync(wrapper, `#!/bin/sh\nFAKE_HOST_SOCKET='${socketPath}' exec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  ext = await openBookmarks("", { nativeHosts: { [HOST]: wrapper } });
});
after(async () => {
  await ext?.context.close();
  rmSync(dir, { recursive: true, force: true });
});

test("off by default: no host runs", async () => {
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(existsSync(socketPath), false);
  const status = await ext.page.evaluate(() => chrome.runtime.sendMessage({ type: "bookmarkBridgeStatus" }));
  assert.equal(status.connected, false);
});

test("on: the host can read and change bookmarks, as one undoable batch", async () => {
  const { page } = ext;
  const ids = await seedBookmarks(page, {
    bar: [{ title: "Read later", children: [{ title: "Essay", url: "https://essay.example/" }] }],
    other: [{ title: "Tool", url: "https://tool.example/" }],
  });
  const before = await treeShape(page);

  await setBridge(true);
  await waitFor(() => existsSync(socketPath), { timeout: 10000 });
  assert.equal((await call("ping")).result.version.length > 0, true);
  const tree = (await call("getTree")).result;
  assert.equal(tree[0].children[0].children[0].title, "Read later");

  // Two requests, one batch: the second uses the folder the first created.
  const first = await call("apply", {
    batch: "b1", label: "cli run",
    ops: [{ op: "create", ref: "dev", parentId: "1", index: 0, title: "Dev" }],
  });
  const devId = first.result.created.dev;
  const second = await call("apply", {
    batch: "b1", label: "cli run",
    ops: [
      { op: "move", id: ids.Tool, parentId: devId },
      { op: "update", id: ids.Essay, title: "Essay (read)" },
    ],
  });
  assert.equal(second.result.done, 2);

  const [batch, ...rest] = await batches(page);
  assert.equal(rest.length, 0);
  assert.equal(batch.label, "cli run");
  assert.deepEqual(batch.counts, { create: 1, move: 1, update: 1 });

  const failed = await call("apply", { ops: [{ op: "remove", id: ids["Read later"] }] });
  assert.match(failed.result.error, /non-empty|Can't remove/i);
  assert.equal(failed.result.done, 0);

  assert.deepEqual(await undoLatest(page), { ok: true });
  assert.deepEqual(await treeShape(page), before);
});

test("unknown methods and ops are errors, not crashes", async () => {
  assert.match((await call("nope")).error, /Unknown method/);
  assert.match((await call("apply", { ops: [{ op: "explode" }] })).result.error, /Unknown op/);
});

test("off again: the host exits", async () => {
  await setBridge(false);
  await waitFor(() => !existsSync(socketPath), { timeout: 10000 });
});
