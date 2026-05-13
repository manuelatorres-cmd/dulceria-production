"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SIDEBAR_CONFIG, isInSpace } from "@/lib/layout/sidebar-config";

const STORAGE_KEY = "dulceria.sidebar.v1";

interface PersistedShape {
  manualOpen: string[];
  manualClosed: string[];
}

function loadPersisted(): PersistedShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.manualOpen) &&
      Array.isArray(parsed.manualClosed)
    ) {
      return parsed as PersistedShape;
    }
    return null;
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Sidebar expansion state.
 *
 * - The active route's parent space is auto-expanded.
 * - On top of that, the user can manually toggle any space open or
 *   closed. Manual choices persist across reloads via localStorage
 *   under `dulceria.sidebar.v1`.
 * - Closing an auto-expanded space records a "manual close" override
 *   so the user's intent wins until they navigate to a different
 *   space.
 */
export function useSidebarState() {
  const pathname = usePathname();
  const [manualOpen, setManualOpen] = useState<Set<string>>(new Set());
  const [manualClosed, setManualClosed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persisted = loadPersisted();
    if (persisted) {
      setManualOpen(new Set(persisted.manualOpen));
      setManualClosed(new Set(persisted.manualClosed));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePersisted({
      manualOpen: Array.from(manualOpen),
      manualClosed: Array.from(manualClosed),
    });
  }, [manualOpen, manualClosed, hydrated]);

  const autoExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const space of SIDEBAR_CONFIG) {
      if (isInSpace(pathname, space)) set.add(space.id);
    }
    return set;
  }, [pathname]);

  const expandedSpaces = useMemo(() => {
    const next = new Set<string>([...autoExpanded, ...manualOpen]);
    for (const id of manualClosed) next.delete(id);
    return next;
  }, [autoExpanded, manualOpen, manualClosed]);

  const toggleSpace = useCallback(
    (id: string) => {
      const isAuto = autoExpanded.has(id);
      const isOpen = expandedSpaces.has(id);
      if (isOpen) {
        // Close — if it was auto-expanded, record the close override.
        if (isAuto) {
          setManualClosed((cur) => {
            const next = new Set(cur);
            next.add(id);
            return next;
          });
        }
        setManualOpen((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
      } else {
        setManualClosed((cur) => {
          const next = new Set(cur);
          next.delete(id);
          return next;
        });
        setManualOpen((cur) => {
          const next = new Set(cur);
          next.add(id);
          return next;
        });
      }
    },
    [autoExpanded, expandedSpaces],
  );

  return { expandedSpaces, toggleSpace };
}
