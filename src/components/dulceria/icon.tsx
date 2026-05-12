"use client";

/**
 * Design-system icon wrapper.
 *
 * Re-exports Tabler outline icons under one import path so usage sites
 * stay consistent. Tabler icons default to `stroke={2}`; we lower to 1.5
 * to match the spec's 0.5px-border aesthetic.
 *
 * Spec phase 5 sizes:
 *   14px — stat card headers, attention items
 *   16px — nav, list rows
 *   20px — section headers
 *   24px — empty states
 *
 * Color inherits via `currentColor` so the icon picks up text-primary
 * vs text-muted from its context, matching the spec rule.
 */

import type { Icon as TablerIcon, IconProps } from "@tabler/icons-react";

export type DsIconSize = 14 | 16 | 20 | 24;

export interface DsIconProps extends Omit<IconProps, "size" | "stroke"> {
  /** Tabler icon component to render. */
  icon: TablerIcon;
  /** Size in px. Defaults to 16. */
  size?: DsIconSize;
}

export function DsIcon({ icon: Icon, size = 16, ...rest }: DsIconProps) {
  return <Icon size={size} stroke={1.5} {...rest} />;
}
