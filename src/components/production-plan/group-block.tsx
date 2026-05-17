"use client";

import {
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconLock as Lock,
  IconLockOpen as LockOpen,
  IconHourglass as Hourglass,
  IconAlertTriangle as AlertTriangle,
  IconGripVertical as GripVertical,
} from "@tabler/icons-react";
import type { StepBlockEntry } from "./step-block";
import { formatMinutes } from "./format-minutes";

export interface StepGroup {
  /** Unique key — `${stepName}|${isLocked ? "locked" : "open"}|${passive}`. */
  key: string;
  stepName: string;
  isLocked: boolean;
  passive: boolean;
  hasConflict: boolean;
  /** Sum of activeMinutes (or waitingMinutes when passive) over members. */
  totalMinutes: number;
  members: StepBlockEntry[];
}

export function GroupBlock({
  group,
  expanded,
  onToggle,
  onLockToggle,
  density,
  draggable,
  dragHandleProps,
  isDragging,
  children,
}: {
  group: StepGroup;
  expanded: boolean;
  onToggle: () => void;
  /** Called when the user clicks the lock icon. Receives every member
   *  planId and the requested new state so the caller can pin/unpin in
   *  one round-trip. */
  onLockToggle?: (planIds: string[], lock: boolean) => void;
  /** Density flows from DayColumn — controls font + padding parity with StepBlock. */
  density: "two-line" | "compact";
  draggable?: boolean;
  /** Spread on the drag handle — supplies dnd-kit listeners + attributes. */
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
  /** Individual StepBlocks rendered inline when expanded. */
  children?: React.ReactNode;
}) {
  // Border + colour match StepBlock variant matrix so the group reads as the
  // same kind of thing as its children.
  let leftBorder: string;
  let leftStyle: "solid" | "dashed";
  let bg: string;
  let textColor: string;
  let italic = false;
  if (group.hasConflict) {
    leftBorder = "var(--wp-rose)";
    leftStyle = "solid";
    bg = "var(--wp-conflict-tint)";
    textColor = "var(--wp-text-primary)";
  } else if (group.passive) {
    leftBorder = "var(--wp-text-muted)";
    leftStyle = "dashed";
    bg = "transparent";
    textColor = "var(--wp-text-muted)";
    italic = true;
  } else if (group.isLocked) {
    leftBorder = "var(--wp-teal)";
    leftStyle = "solid";
    bg = "var(--wp-page-bg)";
    textColor = "var(--wp-text-primary)";
  } else {
    leftBorder = "var(--wp-blush)";
    leftStyle = "solid";
    bg = "var(--wp-page-bg)";
    textColor = "var(--wp-text-primary)";
  }

  const memberPlanIds = group.members.map((m) => m.planId);
  const memberCountLabel = group.members.length === 1 ? "1 batch" : `${group.members.length} batches`;

  function handleLockClick(e: React.MouseEvent): void {
    e.stopPropagation();
    if (!onLockToggle) return;
    onLockToggle(memberPlanIds, !group.isLocked);
  }

  return (
    <div>
      <div
        style={{
          padding: density === "compact" ? "4px 8px" : "7px 9px",
          borderRadius: 3,
          fontSize: density === "compact" ? 11 : 12,
          lineHeight: 1.35,
          background: bg,
          border: group.passive
            ? "0.5px dashed var(--wp-border-warm)"
            : group.hasConflict
            ? "0.5px solid var(--wp-rose)"
            : "0.5px solid var(--wp-border-warm)",
          borderLeft: `3px ${leftStyle} ${leftBorder}`,
          color: textColor,
          fontStyle: italic ? "italic" : "normal",
          transition: "background 0.1s ease, transform 0.08s ease",
          display: "flex",
          flexDirection: "column",
          gap: density === "compact" ? 1 : 2,
          opacity: isDragging ? 0.4 : 1,
        }}
        className="hover:bg-[color:var(--wp-hover-bg)]"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {draggable && !group.passive && (
            <span
              {...(dragHandleProps ?? {})}
              title="Drag whole step"
              style={{
                cursor: "grab",
                display: "inline-flex",
                alignItems: "center",
                opacity: 0.55,
              }}
            >
              <GripVertical className="w-3 h-3" />
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
              textAlign: "left",
              minWidth: 0,
            }}
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 shrink-0" />
            )}
            <span
              style={{
                flex: 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {group.hasConflict && (
                <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "var(--wp-rose)" }} />
              )}
              {group.isLocked && !group.passive && !group.hasConflict && (
                <Lock className="w-3 h-3 shrink-0" style={{ color: "var(--wp-teal)" }} />
              )}
              {group.passive && (
                <Hourglass className="w-3 h-3 shrink-0" style={{ color: "var(--wp-text-muted)" }} />
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {group.stepName}
              </span>
            </span>
            <span
              className="tabular-nums shrink-0"
              style={{ color: "var(--wp-text-muted)", fontSize: 11 }}
            >
              {memberCountLabel}
            </span>
          </button>
          {onLockToggle && !group.passive && (
            <button
              type="button"
              onClick={handleLockClick}
              title={group.isLocked ? "Unlock all batches in this step" : "Lock all batches in this step"}
              style={{
                background: "transparent",
                border: "none",
                padding: 2,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                color: group.isLocked ? "var(--wp-teal)" : "var(--wp-text-muted)",
              }}
            >
              {group.isLocked ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <LockOpen className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--wp-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ flex: 1 }}>
            {expanded ? "click to collapse" : "click to expand"}
          </span>
          <span className="tabular-nums shrink-0">
            {group.passive ? `${formatMinutes(group.totalMinutes)} passive` : `${formatMinutes(group.totalMinutes)} total`}
          </span>
        </div>
      </div>
      {expanded && children && (
        <div
          style={{
            marginTop: 4,
            paddingLeft: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            borderLeft: "0.5px dashed var(--wp-border-warm)",
            marginLeft: 4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// 2026-05-17: was 5 — Manuela's spec is "every step is a group, even single
// batches", so the group/solo distinction collapses to "always group".
// Solos still come back as an empty array for callers that handle them
// separately.
const GROUP_THRESHOLD = 1;

/** Build groups from a flat entry list. Entries that don't hit the
 *  threshold for their key remain ungrouped (returned as `solos`).
 *  Groups carry totalMinutes (active for non-passive, waiting for
 *  passive) and a members list sorted by product name. */
export function buildStepGroups(
  entries: StepBlockEntry[],
): { groups: StepGroup[]; solos: StepBlockEntry[] } {
  const buckets = new Map<string, StepBlockEntry[]>();
  for (const e of entries) {
    const passive =
      !!e.step && e.step.activeMinutes <= 0 && (e.step.waitingMinutes ?? 0) > 0;
    const stepName = e.step?.name ?? e.planName;
    const key = `${stepName}|${e.isLocked ? "locked" : "open"}|${passive ? "passive" : "active"}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  const groups: StepGroup[] = [];
  const solos: StepBlockEntry[] = [];
  for (const [key, arr] of buckets) {
    if (arr.length >= GROUP_THRESHOLD) {
      const sample = arr[0];
      const passive =
        !!sample.step &&
        sample.step.activeMinutes <= 0 &&
        (sample.step.waitingMinutes ?? 0) > 0;
      const stepName = sample.step?.name ?? sample.planName;
      const totalMinutes = arr.reduce((s, e) => {
        const mins = passive
          ? e.step?.waitingMinutes ?? 0
          : e.step?.activeMinutes ?? 0;
        return s + mins;
      }, 0);
      const hasConflict = arr.some((e) => !!e.hasConflict);
      const sortedMembers = arr
        .slice()
        .sort((a, b) => a.productName.localeCompare(b.productName));
      groups.push({
        key,
        stepName,
        isLocked: sample.isLocked,
        passive,
        hasConflict,
        totalMinutes,
        members: sortedMembers,
      });
    } else {
      for (const e of arr) solos.push(e);
    }
  }
  return { groups, solos };
}
