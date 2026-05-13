// Codemod: add `className="ds"` scope to any page.tsx whose default export
// returns `<div>` (no className) at root. Skips files already containing `"ds"`.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const SCOPE = 'className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}';

const SKIP = new Set([
  // pages with bespoke scope handling
  "src/app/(app)/wall/page.tsx",
  "src/app/(app)/production-brain/manual/page.tsx",
  "src/app/(app)/app/page.tsx",
  "src/app/(app)/library/page.tsx",
  // settings subroutes — wrap inherited via SettingsAllTabs
  "src/app/(app)/settings/backup/page.tsx",
  "src/app/(app)/settings/capacity/page.tsx",
  "src/app/(app)/settings/demo/page.tsx",
  "src/app/(app)/settings/equipment/page.tsx",
  "src/app/(app)/settings/import/page.tsx",
  "src/app/(app)/settings/market/page.tsx",
  "src/app/(app)/settings/printing/page.tsx",
  "src/app/(app)/settings/steps/page.tsx",
]);

const files = globSync(["src/app/**/page.tsx"], { cwd: process.cwd(), absolute: false });
const changed = [];
for (const file of files) {
  const norm = file.replace(/\\/g, "/");
  if (SKIP.has(norm)) {
    console.log(`SKIP-EXPLICIT ${norm}`);
    continue;
  }
  let src;
  try {
    src = await readFile(file, "utf8");
  } catch {
    continue;
  }
  if (src.includes('className="ds') || src.includes('"ds ')) {
    console.log(`SKIP-HAS ${norm}`);
    continue;
  }
  const re = /(export default function[^{]+\{[\s\S]*?return\s*\(\s*)<div>/;
  if (!re.test(src)) {
    console.log(`NO-MATCH ${norm}`);
    continue;
  }
  src = src.replace(re, `$1<div ${SCOPE}>`);
  await writeFile(file, src, "utf8");
  changed.push(norm);
}

console.log(`\nRewrote ${changed.length} files.`);
for (const c of changed) console.log("  " + c);
