// Codemod: standardize remaining radius tokens.
// rounded-md (Tailwind 6px) → rounded-[6px] (DS small card radius)
// rounded-lg (Tailwind 8px) → rounded-[8px] (DS card radius)

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  [/\brounded-md\b/g, "rounded-[6px]"],
  [/\brounded-lg\b/g, "rounded-[8px]"],
];

const files = globSync(["src/**/*.tsx"], { cwd: process.cwd() });
const changed = [];
for (const file of files) {
  const orig = await readFile(file, "utf8");
  let out = orig;
  for (const [re, repl] of REPLACEMENTS) out = out.replace(re, repl);
  if (out !== orig) {
    await writeFile(file, out, "utf8");
    changed.push(file);
  }
}
console.log(`Rewrote ${changed.length} files.`);
