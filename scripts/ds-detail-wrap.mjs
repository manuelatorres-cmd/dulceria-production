// Codemod: add `className="ds"` to root <div> of detail pages.
//
// Target: pages whose default export returns `<div>` (no className) at
// the top of the JSX. Replaces with .ds scoped wrapper.

import { readFile, writeFile } from "node:fs/promises";

const files = [
  "src/app/(app)/products/[id]/page.tsx",
  "src/app/(app)/fillings/[id]/page.tsx",
  "src/app/(app)/ingredients/[id]/page.tsx",
  "src/app/(app)/packaging/[id]/page.tsx",
  "src/app/(app)/variants/[id]/page.tsx",
  "src/app/(app)/pantry/decoration/[id]/page.tsx",
  "src/app/(app)/customers/[id]/page.tsx",
  "src/app/(app)/quotes/[id]/page.tsx",
  "src/app/(app)/subscriptions/[id]/page.tsx",
  "src/app/(app)/orders/online/[id]/page.tsx",
  "src/app/(app)/pricing/lists/[id]/page.tsx",
  "src/app/(app)/production-orders/[id]/page.tsx",
  "src/app/(app)/production/[id]/page.tsx",
];

const SCOPE = 'className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}';

for (const file of files) {
  let src;
  try {
    src = await readFile(file, "utf8");
  } catch {
    console.log(`MISSING ${file}`);
    continue;
  }
  if (src.includes('className="ds"')) {
    console.log(`SKIP ${file}`);
    continue;
  }
  // Find FIRST `return (\n    <div>` after the default export.
  const re = /(export default function[^{]+\{[\s\S]*?return\s*\(\s*)<div>/;
  if (!re.test(src)) {
    console.log(`NO-MATCH ${file}`);
    continue;
  }
  src = src.replace(re, `$1<div ${SCOPE}>`);
  await writeFile(file, src, "utf8");
  console.log(`WRAPPED ${file}`);
}
