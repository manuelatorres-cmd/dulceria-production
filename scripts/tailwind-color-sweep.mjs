// Codemod: replace Tailwind default tint classes (amber-50, rose-50, etc.)
// with DS tint tokens.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // Amber → butter (warn)
  [/\bbg-amber-50\b/g, "bg-[color:var(--ds-tint-warn)]"],
  [/\btext-amber-(?:700|800|900)\b/g, "text-[color:var(--ds-semantic-warn)]"],
  [/\bborder-amber-(?:200|300)\b/g, "border-[color:var(--ds-semantic-warn)]"],
  // Rose → urgent
  [/\bbg-rose-50\b/g, "bg-[color:var(--ds-tint-critical)]"],
  [/\btext-rose-(?:700|800)\b/g, "text-[color:var(--ds-tier-urgent)]"],
  // Emerald → positive
  [/\bbg-emerald-50\b/g, "bg-[color:var(--ds-tint-ok)]"],
  [/\btext-emerald-(?:700|800)\b/g, "text-[color:var(--ds-tier-positive)]"],
  // Stone (used for muted)
  [/\bbg-stone-50\b/g, "bg-[color:var(--ds-card-bg)]"],
  [/\bbg-stone-100\b/g, "bg-[color:var(--ds-card-bg-hover)]"],
  [/\btext-stone-(?:500|600|700)\b/g, "text-[color:var(--ds-text-muted)]"],
  [/\btext-stone-(?:800|900)\b/g, "text-[color:var(--ds-text-primary)]"],
  [/\bborder-stone-(?:200|300|400)\b/g, "border-[color:var(--ds-border-warm)]"],
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
