/**
 * Demo data loader — disabled.
 *
 * Historically populated the app with a hand-crafted set of Callebaut/Felchlin
 * ingredients and sample recipes to demonstrate cost-tracking. Under the current
 * "ship empty" policy (see migration 0001 header), we do not inject sample data.
 * The exports are preserved so the Settings page keeps compiling; users populate
 * their data via Settings → Import backup.
 */

export async function isDemoDataLoaded(): Promise<boolean> {
  return false;
}

export async function loadDemoData(): Promise<{ success: boolean; message: string }> {
  return {
    success: false,
    message: "Demo data is disabled. Use Settings → Import backup to restore from a JSON backup.",
  };
}
