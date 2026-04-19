/**
 * Pure helpers for the Equipment settings tab + scheduler.
 *
 * Availability is derived from `currentPlanId`/`currentScheduleId` set
 * by the reverse scheduler (§5 — not yet wired). Until then the helper
 * simply reports "available" for everything non-archived.
 */

import type { Equipment, EquipmentAvailability } from "@/types";

export function equipmentAvailability(eq: Equipment): EquipmentAvailability {
  if (eq.archived) return "archived";
  if (eq.currentPlanId || eq.currentScheduleId) return "in_use";
  return "available";
}

export const EQUIPMENT_AVAILABILITY_LABEL: Record<EquipmentAvailability, string> = {
  available: "Available",
  in_use: "In use",
  archived: "Archived",
};

export interface EquipmentReadiness {
  /** True when every non-archived piece has kind + quantity + kgPerHour set. */
  isComplete: boolean;
  /** Number of non-archived equipment rows still missing data. */
  incompleteCount: number;
}

/** Summary used by the Settings UI banner + (later) the scheduler gate. */
export function equipmentReadiness(all: Equipment[]): EquipmentReadiness {
  const active = all.filter((e) => !e.archived);
  const incomplete = active.filter(
    (e) =>
      typeof e.quantity !== "number" ||
      e.quantity <= 0 ||
      typeof e.kgPerHour !== "number" ||
      e.kgPerHour <= 0,
  );
  return {
    isComplete: active.length > 0 && incomplete.length === 0,
    incompleteCount: incomplete.length,
  };
}
