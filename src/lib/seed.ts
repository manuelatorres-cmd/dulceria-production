/**
 * First-run ingredient seeder.
 *
 * Historically this bootstrapped a fresh browser with the bundled
 * `public/seed/ingredients.csv`. The app now uses the "ship empty, user writes
 * everything on first run" policy (see migration 0001 header), so the seeder is
 * intentionally a no-op. The export is preserved so `seed-loader` keeps
 * compiling; users populate their data via Settings → Import backup.
 */
export async function seedIfNeeded(): Promise<void> {
  // No-op — see file header.
  return;
}
