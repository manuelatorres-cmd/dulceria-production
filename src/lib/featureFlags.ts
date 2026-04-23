/**
 * Feature flags — lightweight, client-side toggles so new UI (production-brain,
 * shop-counter) can ship hidden until verified.
 *
 * Storage: localStorage only. No Supabase round-trip. A flag is per-device.
 * That's intentional — each user enables new routes on their own tablet when
 * ready. Clearing browser data resets flags (safe default).
 *
 * To enable a flag manually without a UI:
 *   localStorage.setItem('dulceria.ff.production-brain', '1'); location.reload();
 *
 * To add a new flag:
 *   1. Add constant to FEATURE_FLAGS below
 *   2. Call `useFeatureFlag(FEATURE_FLAGS.newThing)` in the component that gates on it
 *   3. Add row to settings page flag list (src/app/(app)/settings/page.tsx)
 */

import { useEffect, useState } from "react";

export const FEATURE_FLAGS = {
  productionBrain: "production-brain",
  shopCounter: "shop-counter",
} as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

const STORAGE_PREFIX = "dulceria.ff.";

export function isEnabled(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage.getItem(STORAGE_PREFIX + flag);
  return v === "1" || v === "true";
}

export function setEnabled(flag: FeatureFlag, enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) {
    window.localStorage.setItem(STORAGE_PREFIX + flag, "1");
  } else {
    window.localStorage.removeItem(STORAGE_PREFIX + flag);
  }
  window.dispatchEvent(new Event("dulceria-ff-change"));
}

export function listEnabled(): FeatureFlag[] {
  if (typeof window === "undefined") return [];
  return Object.values(FEATURE_FLAGS).filter(isEnabled);
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [enabled, setEnabledState] = useState<boolean>(() => isEnabled(flag));
  useEffect(() => {
    const sync = () => setEnabledState(isEnabled(flag));
    sync();
    window.addEventListener("dulceria-ff-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("dulceria-ff-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, [flag]);
  return enabled;
}
