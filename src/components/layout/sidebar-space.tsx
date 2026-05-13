"use client";

import { Fragment } from "react";
import type { SidebarSpace as SidebarSpaceDef, BadgeKey } from "@/lib/layout/sidebar-config";
import { isItemActive, isInSpace } from "@/lib/layout/sidebar-config";
import { SidebarIcon } from "@/lib/layout/sidebar-icons";
import { SidebarSubitem, type BadgeVariant } from "./sidebar-subitem";

export type BadgeMap = Partial<Record<BadgeKey, { count: number; variant: BadgeVariant } | null>>;

export function SidebarSpace({
  space,
  expanded,
  pathname,
  badges,
  onToggle,
}: {
  space: SidebarSpaceDef;
  expanded: boolean;
  pathname: string;
  badges: BadgeMap;
  onToggle: () => void;
}) {
  const active = isInSpace(pathname, space);
  return (
    <>
      <button
        type="button"
        className={
          "sb-space" +
          (active ? " sb-space-active" : "") +
          (expanded ? " sb-space-expanded" : "")
        }
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <SidebarIcon name={space.icon} size={16} />
        <span className="sb-space-label">{space.label}</span>
        <span aria-hidden className="sb-space-chevron">
          {expanded ? "▾" : "›"}
        </span>
      </button>
      {expanded && (
        <div className="sb-subsection">
          {space.groups.map((group, gi) => (
            <Fragment key={`${space.id}-${gi}`}>
              {group.label && (
                <div className="sb-subgroup-label">{group.label}</div>
              )}
              {group.items.map((item) => (
                <SidebarSubitem
                  key={item.href}
                  item={item}
                  active={isItemActive(pathname, item.href)}
                  badge={item.badgeKey ? badges[item.badgeKey] : null}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
