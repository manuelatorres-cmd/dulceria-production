"use client";

/**
 * Historically bootstrapped a fresh browser with the upstream app's default product /
 * filling / ingredient / decoration / shell-design categories. Intentionally
 * empty now: under the "no seed data" rule (2026-04-19) the app ships empty.
 * Users populate their own categories via Settings → Import backup, or by
 * creating them on the relevant category pages.
 *
 * Kept as a rendered component (not deleted) so `layout.tsx` stays unchanged;
 * may be repurposed later for other first-run concerns (e.g. routing the
 * user to Settings if capacityConfig is missing).
 */
export function SeedLoader() {
  return null;
}
