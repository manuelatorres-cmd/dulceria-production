// Codemod: replace recurring hex literals (semantic accent pastels + neutrals)
// with DS accent CSS vars across src/app.
// Excludes intentional palette/chart hex (e.g. observatory product-cost
// chocolate shades, variants palette swatches, stats health dots).

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const REPLACEMENTS = [
  // Accent pastel pairs
  ['"#fdeeea"', '"var(--accent-blush-bg)"'],
  ['"#fdf1e2"', '"var(--accent-peach-bg)"'],
  ['"#9a6640"', '"var(--accent-peach-ink)"'],
  ['"#f3eef6"', '"var(--accent-lilac-bg)"'],
  ['"#6a4d89"', '"var(--accent-lilac-ink)"'],
  ['"#eff3ec"', '"var(--accent-sage-bg)"'],
  ['"#5c7050"', '"var(--accent-sage-ink)"'],
  ['"#fef9e6"', '"var(--accent-butter-bg)"'],
  // Neutrals
  ['"#1c1d1f"', '"var(--ds-text-primary)"'],
  ['"#8a8780"', '"var(--ds-text-muted)"'],
  // Deep teal (signature primary mint-ink)
  ['"#4a6b5b"', '"var(--accent-mint-ink)"'],
  // Arbitrary tailwind values inside [#hex]
  ['[#4a6b5b]', '[var(--accent-mint-ink)]'],
  ['[#3d5b4d]', '[var(--ds-tier-quarter-focus)]'],
  ['[#fef9e6]', '[var(--accent-butter-bg)]'],
  ['[#fdeeea]', '[var(--accent-blush-bg)]'],
  ['[#fdf1e2]', '[var(--accent-peach-bg)]'],
  ['[#f3eef6]', '[var(--accent-lilac-bg)]'],
  ['[#eff3ec]', '[var(--accent-sage-bg)]'],
];

const SKIP = [
  "src/app/(app)/observatory/product-cost/page.tsx",
  "src/app/(app)/variants/[id]/page.tsx",
  "src/app/(app)/stats/page.tsx",
];

const files = globSync(["src/app/**/page.tsx"], { cwd: process.cwd() });
const changed = [];
for (const file of files) {
  const norm = file.replaceAll("\\", "/");
  if (SKIP.includes(norm)) continue;
  const orig = await readFile(file, "utf8");
  let out = orig;
  for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
  if (out !== orig) {
    await writeFile(file, out, "utf8");
    changed.push(file);
  }
}
console.log(`Rewrote ${changed.length} files.`);
for (const f of changed) console.log("  " + f);
