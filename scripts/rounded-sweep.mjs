// Codemod: standardize border radius tokens.
// rounded-sm (Tailwind 2px) → rounded-[6px] (DS default).
// rounded-md (6px) stays.
// rounded-lg (8px) → rounded-[8px] (DS).

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  [/\brounded-sm\b/g, "rounded-[4px]"], // small radius for inputs/badges
  // border-status-* (legacy semantic) — keep, those map correctly via CSS vars
];

const files = globSync(["src/**/*.tsx"], { cwd: process.cwd() });
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
