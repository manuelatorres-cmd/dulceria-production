// Codemod: replace remaining legacy tokens with DS equivalents.
// - rounded-sm border border-border bg-card → DS card pattern
// - border-border / bg-card → DS border-warm / card-bg
// - status-alert-bg / status-warn-bg etc — leave (these are semantic)
// Targets visible inner-section styling that still feels legacy.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // backdrop-blur-[Npx] residual
  [/\bbackdrop-blur-\[[^\]]+\]/g, ""],
  // rounded-[18px] / rounded-[14px] → rounded-[8px] (DS card radius)
  [/\brounded-\[18px\]/g, "rounded-[8px]"],
  [/\brounded-\[14px\]/g, "rounded-[6px]"],
];

const files = globSync(["src/app/**/page.tsx"], { cwd: process.cwd() });
const changed = [];
for (const file of files) {
  const orig = await readFile(file, "utf8");
  let out = orig;
  for (const [re, repl] of REPLACEMENTS) {
    out = out.replace(re, repl);
  }
  if (out !== orig) {
    await writeFile(file, out, "utf8");
    changed.push(file);
  }
}
console.log(`Rewrote ${changed.length} files.`);
for (const c of changed) console.log("  " + c);
