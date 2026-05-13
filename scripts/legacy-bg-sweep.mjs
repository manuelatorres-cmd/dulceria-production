// Codemod: replace standalone `bg-card` (without border-border) → DS card-bg.
// Also `bg-card/80` → DS card-bg.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // bg-card/N → bg-[color:var(--ds-card-bg)]
  [/\bbg-card\/(?:50|60|65|70|80|85|90)\b/g, "bg-[color:var(--ds-card-bg)]"],
  // bg-card standalone (be careful: bg-card-foreground etc — \b boundary helps)
  [/\bbg-card\b/g, "bg-[color:var(--ds-card-bg)]"],
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
