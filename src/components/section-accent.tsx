"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * v6 (Atelier Sage): single brand accent app-wide. The previous per-section
 * pastel routing was retired with the v5→v6 palette migration — every route
 * now inherits the default `--color-accent` (deep sage) from globals.css.
 *
 * Legacy `--accent-*-bg` / `--accent-*-ink` tokens still exist for any
 * stragglers reading them directly (e.g. order-channel pills); the
 * `body[data-accent="…"]` overrides are intentionally not triggered.
 *
 * To bring section-level accents back: re-populate this map and define
 * matching `body[data-accent="<name>"]` rules in globals.css.
 */
const ROUTE_ACCENTS: Record<string, string> = {
  // intentionally empty — single brand accent across the app
};

function resolveAccent(pathname: string): string | null {
  let best: { prefix: string; accent: string } | null = null;
  for (const [prefix, accent] of Object.entries(ROUTE_ACCENTS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, accent };
      }
    }
  }
  return best?.accent ?? null;
}

export function SectionAccent() {
  const pathname = usePathname();
  useEffect(() => {
    const accent = resolveAccent(pathname);
    if (accent) {
      document.body.dataset.accent = accent;
    } else {
      delete document.body.dataset.accent;
    }
  }, [pathname]);
  return null;
}
