"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  useMarketRegion, setMarketRegion,
  useCurrency, setCurrency,
  useFacilityMayContain, setFacilityMayContain,
  useDefaultFillMode, setDefaultFillMode,
} from "@/lib/hooks";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import type { CurrencyCode, MarketRegion, FillMode } from "@/types";

/**
 * Centralises shared settings state across the 8 settings subroutes.
 * Each subroute renders its own SettingsProvider; sections inside the
 * subroute consume this context for dirty tracking + preference helpers
 * without prop-drilling.
 */

type DirtyMap = Record<string, boolean>;

interface SettingsContextValue {
  marketRegion: MarketRegion;
  setMarketRegion: (r: MarketRegion) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  facilityMayContain: string[];
  setFacilityMayContain: (a: string[]) => void;
  defaultFillMode: FillMode;
  setDefaultFillMode: (m: FillMode) => void;

  /** Mark a section dirty/clean; used by navigation guard. */
  setSectionDirty: (section: string, dirty: boolean) => void;
  /** True when any section reports dirty. */
  isDirty: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const marketRegion = useMarketRegion();
  const currency = useCurrency();
  const facilityMayContain = useFacilityMayContain();
  const defaultFillMode = useDefaultFillMode();

  const [dirtyMap, setDirtyMap] = useState<DirtyMap>({});
  const isDirty = useMemo(() => Object.values(dirtyMap).some(Boolean), [dirtyMap]);

  useNavigationGuard(isDirty);

  const setSectionDirty = useCallback((section: string, dirty: boolean) => {
    setDirtyMap((prev) => {
      if (!!prev[section] === dirty) return prev;
      return { ...prev, [section]: dirty };
    });
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({
    marketRegion,
    setMarketRegion,
    currency,
    setCurrency,
    facilityMayContain,
    setFacilityMayContain,
    defaultFillMode,
    setDefaultFillMode,
    setSectionDirty,
    isDirty,
  }), [marketRegion, currency, facilityMayContain, defaultFillMode, setSectionDirty, isDirty]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
