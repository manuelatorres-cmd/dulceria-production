"use client";

/**
 * iOS "Add to Home Screen" install banner.
 *
 * Historically nudged Safari users to install the PWA so iOS wouldn't clear
 * their local IndexedDB after a few weeks of inactivity. Now that the data
 * layer is Supabase, local-storage eviction is no longer a data-loss risk, so
 * the banner is a no-op. Kept as a stub in case we want to revive it for
 * offline-first reasons later.
 */
export function IosInstallBanner() {
  return null;
}
