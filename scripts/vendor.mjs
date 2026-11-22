#!/usr/bin/env node
// ═══════════════════════════════════
//  superlevels: copies the third-party libraries the extension ships into
//  src/vendor/, unmodified, with their licences. They're committed, so the
//  unpacked extension works without pnpm install (and MV3 forbids loading
//  code from the network). Run after bumping one of them: pnpm vendor
// ═══════════════════════════════════
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/vendor");
const LIBS = [
  {
    pkg: "@mozilla/readability",
    file: "Readability.js",
    licenseFile: "LICENSE.md",
    license: "Apache-2.0",
    use: "pulls the article out of a page for reader view (injected by src/background/reader.js)",
  },
];

await mkdir(OUT, { recursive: true });
const rows = [];
for (const lib of LIBS) {
  const dir = join(ROOT, "node_modules", lib.pkg);
  const { version } = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const base = lib.file.replace(/\.js$/, "");
  await copyFile(join(dir, lib.file), join(OUT, lib.file));
  await copyFile(join(dir, lib.licenseFile), join(OUT, `${base}.LICENSE`));
  rows.push(`| \`${lib.file}\` | [${lib.pkg}](https://www.npmjs.com/package/${lib.pkg}) ${version}, \`${lib.file}\` | ${lib.license}, see \`${base}.LICENSE\` | ${lib.use} |`);
  console.log(`${lib.file}: ${lib.pkg} ${version}`);
}
await writeFile(join(OUT, "README.md"), `# Vendored libraries

Copied unmodified from npm by \`scripts/vendor.mjs\` (\`pnpm vendor\`). Don't edit them here: bump the
version in package.json and run the script again.

| File | Source | Licence | Used for |
|---|---|---|---|
${rows.join("\n")}
`);
