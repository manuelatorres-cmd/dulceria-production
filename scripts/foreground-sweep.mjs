// Codemod: sweep `bg-foreground text-background` → DS deep-teal pattern.
// Many toggle buttons use bg-foreground for active state; align to DS.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  [/\bbg-foreground text-background border-foreground\b/g, "bg-[color:var(--ds-tier-quarter-focus)] text-white border-[color:var(--ds-tier-quarter-focus)]"],
  [/\bbg-foreground text-background\b/g, "bg-[color:var(--ds-tier-quarter-focus)] text-white"],
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
