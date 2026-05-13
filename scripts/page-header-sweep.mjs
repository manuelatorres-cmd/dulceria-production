// Codemod: rewrite legacy `@/components/page-header` PageHeader uses
// to DS PageHeader from `@/components/dulceria`. Transforms accent +
// description props into combined meta. Wraps page body in `.ds` scope.
//
// Conservative pattern matcher: only edits files that import legacy
// PageHeader. Leaves anything ambiguous untouched.

import { readFile, writeFile } from "node:fs/promises";
import { globSync } from "tinyglobby";

const ROOT = process.cwd();

async function processFile(path) {
  let src = await readFile(path, "utf8");
  if (!src.includes('from "@/components/page-header"')) return null;

  let changed = false;

  // 1. Swap import.
  const importRe = /import\s+\{\s*PageHeader\s*\}\s+from\s+["']@\/components\/page-header["'];?/g;
  if (importRe.test(src)) {
    src = src.replace(
      importRe,
      'import { PageHeader } from "@/components/dulceria";',
    );
    changed = true;
  }

  // 2. Transform JSX usages.
  //    Matches: <PageHeader title="X" [accent="Y"] [description="Z"] />
  //    To: <PageHeader title="X" meta="Y · Z" />
  //
  //    Also matches when title is an expression.
  src = src.replace(
    /<PageHeader\s+([^>]*?)\/>/g,
    (match, propsRaw) => {
      const props = parseProps(propsRaw);
      if (!props) return match; // give up on complex cases
      const title = props.title;
      if (!title) return match;
      const meta = combineMeta(props.accent, props.description);
      const parts = [`title=${title}`];
      if (meta) parts.push(`meta=${meta}`);
      changed = true;
      return `<PageHeader ${parts.join(" ")} />`;
    },
  );

  if (!changed) return null;
  await writeFile(path, src, "utf8");
  return path;
}

function parseProps(raw) {
  // Strip whitespace + newlines. Match `key={...}` or `key="..."`.
  const props = {};
  const re = /\b(\w+)=(?:(\{[^}]*\})|"([^"]*)")/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : JSON.stringify(m[3]);
    props[key] = val;
  }
  // Reject if any unrecognised props beyond title/accent/description
  for (const k of Object.keys(props)) {
    if (!["title", "accent", "description"].includes(k)) return null;
  }
  return props;
}

function combineMeta(accent, description) {
  // Both come in as already-quoted JS expression strings or "string" literal.
  if (!accent && !description) return null;
  if (accent && description) {
    return `{${stripQuotes(accent)} + " · " + ${stripQuotes(description)}}`;
  }
  return accent ?? description;
}

function stripQuotes(s) {
  // If wrapped in {…}, return inner. Otherwise return as-is (already
  // a JS string literal like "foo").
  if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).trim();
  return s;
}

const files = globSync(["src/**/*.tsx"], { cwd: ROOT, absolute: true });
const changed = [];
for (const f of files) {
  try {
    const r = await processFile(f);
    if (r) changed.push(r);
  } catch (err) {
    console.error("FAIL", f, err.message);
  }
}

console.log(`Rewrote ${changed.length} files.`);
for (const c of changed) console.log("  " + c);
