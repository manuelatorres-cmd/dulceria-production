"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SIDEBAR_CONFIG, isInSpace } from "@/lib/layout/sidebar-config";

/**
 * Sidebar expansion state.
 *
 * The active route's parent space is auto-expanded; on top of that, the
 * user can manually toggle other spaces open or closed. Persisted state
 * (localStorage) is honest-deferred to Phase 4 — for now, manually
 * toggled set is in-memory per session.
 */
export function useSidebarState() {
  const pathname = usePathname();
  const [manualOpen, setManualOpen] = useState<Set<string>>(new Set());
  const [manualClosed, setManualClosed] = useState<Set<string>>(new Set());

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
