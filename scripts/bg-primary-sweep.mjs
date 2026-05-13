// Codemod: replace bg-primary/N opacity → DS tint info.
import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // bg-primary/N (opacity tints used for highlight bg) → ds-tint-info
  [/\bbg-primary\/(?:5|10|20)\b/g, "bg-[color:var(--ds-tint-info)]"],
  // border-primary/N → ds-tier-quarter-focus
  [/\bborder-primary\/(?:10|20|30|40)\b/g, "border-[color:var(--ds-tier-quarter-focus)]"],
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
