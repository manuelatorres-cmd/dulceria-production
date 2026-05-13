// Codemod: add `className="ds"` + ds-page-bg style to root <div> in pages
// that import DS PageHeader but don't yet have .ds scope.

import { readFile, writeFile } from "node:fs/promises";

const files = [
  "src/app/(app)/pricing/page.tsx",
  "src/app/(app)/reports/sales/page.tsx",
  "src/app/(app)/observatory/product-cost/page.tsx",
  "src/app/(app)/plan/fillings/page.tsx",
  "src/app/(app)/production/page.tsx",
  "src/app/(app)/shop/counter/page.tsx",
  "src/app/(app)/shop/daily-count/page.tsx",
  "src/app/(app)/production-brain/dashboard/page.tsx",
  "src/app/(app)/quotes/new/page.tsx",
];

for (const file of files) {
  let src = await readFile(file, "utf8");
  if (src.includes('className="ds"')) {
    console.log(`SKIP ${file} (already has .ds)`);
    continue;
  }
  // Find the FIRST `return (` followed by `<div>` or `<div className=...>` in the default export.
  // Conservative: match `return (\s*<div>` to add `className="ds"`. Skip if it's `<div className=...>` already (don't override).
  const re = /(return\s*\(\s*)<div>(\s*<PageHeader)/;
  if (!re.test(src)) {
    console.log(`SKIP ${file} (no plain <div> wrapping PageHeader)`);
    continue;
  }
  src = src.replace(
    re,
    '$1<div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>$2',
  );
  await writeFile(file, src, "utf8");
  console.log(`WRAPPED ${file}`);
}
