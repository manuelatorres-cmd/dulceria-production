"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useNotifications,
  approveNotification,
  snoozeNotification,
  dismissNotification,
  bulkApproveByType,
  bulkDismissByType,
} from "@/lib/hooks";
import type {
  Notification,
  NotificationStatus,
  NotificationType,
  NotificationUrgency,
} from "@/types";

/**
 * Full-page notification center — richer than the bell dropdown.
 *
 * Filters by urgency + type + status. Bulk actions per type. History
 * of snoozed / dismissed / approved is accessible via the status
 * tabs.
 */
export default function NotificationsPage() {
  const [statusFilter, setStatusFilter] = useState<NotificationStatus>("open");
  const [typeFilter, setTypeFilter] = useState<NotificationType | "all">("all");
  const rows = useNotifications(statusFilter);

  const filtered = useMemo(
    () => (typeFilter === "all" ? rows : rows.filter((r) => r.type === typeFilter)),
    [rows, typeFilter],
  );

  const byType = useMemo(() => {
    const m = new Map<NotificationType, Notification[]>();
    for (const r of filtered) {
      const list = m.get(r.type) ?? [];
      list.push(r);
      m.set(r.type, list);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Decisions and alerts the brain has queued for you. Review at your own pace."
      />

      <div className="flex flex-wrap gap-3 mb-5 items-baseline">
        <span
          className="text-[10px] uppercase text-muted-foreground font-medium"
          style={{ letterSpacing: "0.1em" }}
        >
          Status
        </span>
        {(["open", "snoozed", "approved", "dismissed"] as NotificationStatus[]).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={
                "text-[11.5px] px-2.5 py-1 capitalize border transition-colors " +
                (statusFilter === s
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card border-border text-muted-foreground hover:border-foreground")
              }
              style={{ borderRadius: 3 }}
            >
              {s}
            </button>
          ),
        )}

        <span
          className="text-[10px] uppercase text-muted-foreground font-medium ml-4"
          style={{ letterSpacing: "0.1em" }}
        >
          Type
        </span>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as NotificationType | "all")}
          className="text-[11.5px] px-2.5 py-1 border border-border bg-card"
          style={{ borderRadius: 3 }}
        >
          <option value="all">All types</option>
          {NOTIFICATION_TYPE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p
          className="py-12 text-center text-muted-foreground italic text-[13px]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Nothing here. Enjoy the quiet.
        </p>
      ) : (
        <ul className="space-y-6">
          {byType.map(([type, items]) => (
            <section key={type}>
              <div className="flex items-baseline justify-between mb-2">
                <h3
                  className="text-[14px]"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.012em",
                  }}
                >
                  {typeLabel(type)}
                  <span className="ml-2 text-[10.5px] text-muted-foreground uppercase font-normal" style={{ letterSpacing: "0.1em" }}>
                    {items.length}
                  </span>
                </h3>
                {statusFilter === "open" ? (
                  <div className="flex gap-3 text-[10px] uppercase" style={{ letterSpacing: "0.08em" }}>
                    <button
                      type="button"
                      onClick={() => bulkApproveByType(type)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Approve all
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkDismissByType(type)}
                      className="text-muted-foreground hover:text-[color:var(--color-status-alert)]"
                    >
                      Dismiss all
                    </button>
                  </div>
                ) : null}
              </div>
              <ul className="space-y-1">
                {items.map((n) => (
                  <li key={n.id}>
                    <Row notification={n} actionable={statusFilter === "open"} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  notification,
  actionable,
}: {
  notification: Notification;
  actionable: boolean;
}) {
  return (
    <div
      className="border border-border bg-card px-4 py-3 flex items-start gap-3"
      style={{ borderRadius: 4 }}
    >
      <UrgencyDot urgency={notification.urgency} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[13.5px] leading-snug"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.01em" }}
        >
          {notification.title}
        </div>
        {notification.body ? (
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
            {notification.body}
          </p>
        ) : null}
        <p className="text-[10px] text-muted-foreground mt-2">
          {notification.createdAt
            ? new Date(notification.createdAt).toLocaleString()
            : ""}
          {notification.urgency !== "normal" ? (
            <span className="ml-2 uppercase" style={{ letterSpacing: "0.08em" }}>
              {notification.urgency}
            </span>
          ) : null}
        </p>
      </div>
      {actionable ? (
        <div className="flex flex-col gap-1 items-end">
          <button
            type="button"
            onClick={() => notification.id && approveNotification(notification.id)}
            className="text-[10px] uppercase font-medium text-foreground hover:underline"
            style={{ letterSpacing: "0.08em" }}
          >
            {notification.actionLabel ?? "Approve"}
          </button>
          <button
            type="button"
            onClick={() => notification.id && snoozeNotification(notification.id)}
            className="text-[10px] uppercase font-medium text-muted-foreground hover:text-foreground"
            style={{ letterSpacing: "0.08em" }}
          >
            Snooze 1d
          </button>
          <button
            type="button"
            onClick={() => notification.id && dismissNotification(notification.id)}
            className="text-[10px] uppercase font-medium text-muted-foreground hover:text-[color:var(--color-status-alert)]"
            style={{ letterSpacing: "0.08em" }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UrgencyDot({ urgency }: { urgency: NotificationUrgency }) {
  const cls =
    urgency === "critical"
      ? "bg-[color:var(--color-status-alert)]"
      : urgency === "high"
        ? "bg-[color:var(--color-status-warn)]"
        : urgency === "normal"
          ? "bg-[color:var(--accent-terracotta-ink)]"
          : "bg-muted-foreground/40";
  return <span className={"mt-1.5 w-2 h-2 shrink-0 rounded-full " + cls} />;
}

function typeLabel(type: NotificationType): string {
  const entry = NOTIFICATION_TYPE_OPTIONS.find(([v]) => v === type);
  return entry ? entry[1] : type;
}

const NOTIFICATION_TYPE_OPTIONS: [NotificationType, string][] = [
  ["tier_change", "Priority tier change"],
  ["surplus_routing", "Surplus routing"],
  ["ingredient_late", "Ingredient late"],
  ["ingredient_shortage", "Ingredient shortage"],
  ["ingredient_price_change", "Ingredient price change"],
  ["campaign_conflict", "Campaign conflict"],
  ["campaign_ingredient_advance", "Campaign ingredient advance"],
  ["filling_precook", "Filling pre-cook"],
  ["filling_expiry_warning", "Filling expiry"],
  ["transfer_proposal", "Stock transfer"],
  ["stock_dip", "Stock dip"],
  ["near_expiry", "Near expiry"],
  ["markdown_suggestion", "Markdown suggestion"],
  ["tasting_allocation", "Tasting allocation"],
  ["replenishment_proposal", "Replenishment proposal"],
  ["haccp_incident_open", "HACCP incident"],
  ["contamination_flag", "Contamination flag"],
  ["machine_aging", "Machine aging"],
  ["mould_deep_wash", "Mould deep wash"],
  ["overtime_warning", "Overtime warning"],
  ["quote_expiring", "Quote expiring"],
  ["subscription_cycle_reminder", "Subscription cycle"],
  ["capacity_risk", "Capacity risk"],
  ["rush_impossible", "Rush impossible"],
  ["replacement_issued", "Replacement issued"],
  ["other", "Other"],
];
