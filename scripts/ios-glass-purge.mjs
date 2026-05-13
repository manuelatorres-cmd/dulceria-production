// Codemod: replace iOS-glass class artifacts with DS-compatible equivalents.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // backdrop-blur — strip
  [/\bbackdrop-blur-(?:2xl|xl|md|sm)\s*/g, ""],
  // bg-white/65 .. bg-white/80 → bg-[color:var(--ds-card-bg)]
  [/\bbg-white\/(?:55|60|65|70|80)\b/g, "bg-[color:var(--ds-card-bg)]"],
  // border-white/60 → border-[color:var(--ds-border-warm)]
  [/\bborder-white\/(?:55|60|65|70|80)\b/g, "border-[color:var(--ds-border-warm)]"],
];

const files = globSync(["src/**/*.tsx"], { cwd: process.cwd(), absolute: true });
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
