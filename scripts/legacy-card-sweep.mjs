// Codemod: replace `rounded-sm border border-border bg-card` legacy
// card patterns with DS tokens.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // Full pattern
  [/rounded-sm border border-border bg-card/g, "rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]"],
  // Common variants
  [/border border-border bg-card/g, "border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]"],
  // border-border alone
  [/\bborder-border\b/g, "border-[color:var(--ds-border-warm)]"],
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
