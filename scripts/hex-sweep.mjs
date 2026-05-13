// Codemod: replace hardcoded pastel hex literals with CSS-var references.
import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const HEX_MAP = {
  // Mint
  "#e3ebe6": "var(--accent-mint-bg)",
  "#cfe5d9": "var(--accent-mint-edge)",
  "#f1faf4": "var(--accent-mint-bg)",
  "#2e4839": "var(--accent-mint-ink)",
  "#4a7a5e": "var(--accent-mint-ink)",
  // Butter
  "#fdf8e2": "var(--accent-butter-bg)",
  "#fbf3d7": "var(--accent-butter-bg)",
  "#8a7030": "var(--accent-butter-ink)",
  // Sky
  "#eff5fb": "var(--accent-sky-bg)",
  "#e8f0f9": "var(--accent-sky-bg)",
  "#4b6b8f": "var(--accent-sky-ink)",
  // Blush
  "#fdeae3": "var(--accent-blush-bg)",
  "#fbe6e3": "var(--accent-blush-bg)",
  "#9b4f48": "var(--accent-blush-ink)",
};

const files = globSync(["src/**/*.tsx"], { cwd: process.cwd() });
const changed = [];
for (const file of files) {
  const orig = await readFile(file, "utf8");
  let out = orig;
  for (const [hex, varRef] of Object.entries(HEX_MAP)) {
    // Replace anywhere except inside HEX comparison contexts (rare in JSX)
    out = out.split(hex).join(varRef);
  }
  if (out !== orig) {
    await writeFile(file, out, "utf8");
    changed.push(file);
  }
}
console.log(`Rewrote ${changed.length} files.`);
