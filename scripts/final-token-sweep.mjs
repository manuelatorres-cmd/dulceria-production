// Codemod: replace remaining legacy patterns with DS tokens.
// - border-border/N opacity → DS warm border
// - rounded-[Npx] non-standard radii → align
// - inline border style: 0.5px solid var(--color-border) → warm border

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // border-border/N → DS warm border (lose the opacity nuance, acceptable)
  [/\bborder-border\/(?:30|40|50|60|70|80)\b/g, "border-[color:var(--ds-border-warm)]"],
  // border-[color:var(--ds-border-warm)]/N (codemod artifact)
  [/\bborder-\[color:var\(--ds-border-warm\)\]\/(?:30|40|50|60|70|80)\b/g, "border-[color:var(--ds-border-warm)]"],
  // bg-muted/N opacity variants → bg-muted
  [/\bbg-muted\/(?:30|40|50|60|70|80)\b/g, "bg-muted"],
  // text-status-blush → text-status-alert (consistency)
  [/\btext-status-blush\b/g, "text-status-alert"],
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
