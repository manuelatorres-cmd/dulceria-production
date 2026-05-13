"use client";

import Link from "next/link";
import type { SidebarSubItem } from "@/lib/layout/sidebar-config";
import { SidebarIcon } from "@/lib/layout/sidebar-icons";
import { isItemActive } from "@/lib/layout/sidebar-config";

export function SidebarUtility({
  item,
  pathname,
  badge,
}: {
  item: SidebarSubItem;
  pathname: string;
  badge?: number;
}) {
  const active = isItemActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      className={"sb-utility" + (active ? " sb-utility-active" : "")}
    >
      <SidebarIcon name={item.icon} size={15} />
      <span className="sb-utility-label">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="sb-utility-badge">{badge > 99 ? "99+" : badge}</span>
      )}
    </Link>
  );
}
