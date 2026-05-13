"use client";

import Link from "next/link";
import type { SidebarSubItem } from "@/lib/layout/sidebar-config";
import { SidebarIcon } from "@/lib/layout/sidebar-icons";

export type BadgeVariant = "urgent" | "warn" | "ok";

export function SidebarSubitem({
  item,
  active,
  badge,
}: {
  item: SidebarSubItem;
  active: boolean;
  badge?: { count: number; variant: BadgeVariant } | null;
}) {
  return (
    <Link
      href={item.href}
      className={"sb-subitem" + (active ? " sb-subitem-active" : "")}
    >
      <SidebarIcon name={item.icon} size={13} />
      <span className="sb-subitem-label">{item.label}</span>
      {badge && badge.count > 0 && (
        <span className={"sb-subitem-badge sb-subitem-badge-" + badge.variant}>
          {badge.count > 99 ? "99+" : badge.count}
        </span>
      )}
    </Link>
  );
}
