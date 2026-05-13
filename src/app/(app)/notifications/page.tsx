"use client";

import { useMemo, useState } from "react";
import {
  PageHeader,
  Section,
  DsTabNav,
  StatusTag,
  DsButton,
} from "@/components/dulceria";
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
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Notifications"
        meta="Decisions and alerts the brain has queued for you · review at your own pace"
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <DsTabNav
            variant="pills"
            tabs={(["open", "snoozed", "approved", "dismissed"] as NotificationStatus[]).map((s) => ({
              id: s,
              label: s.charAt(0).toUpperCase() + s.slice(1),
            }))}
            activeTab={statusFilter}
            onChange={(id) => setStatusFilter(id as NotificationStatus)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ds-text-muted)",
                fontWeight: 600,
              }}
            >
              Type
            </span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as NotificationType | "all")}
              style={{
                padding: "4px 8px",
                fontSize: 12,
                border: "0.5px solid var(--ds-border-warm)",
                borderRadius: 4,
                background: "var(--ds-card-bg)",
                color: "var(--ds-text-primary)",
              }}
            >
              <option value="all">All types</option>
              {NOTIFICATION_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p
            style={{
              padding: "40px 0",
              textAlign: "center",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              fontStyle: "italic",
              color: "var(--ds-text-muted)",
            }}
          >
            Nothing here. Enjoy the quiet.
          </p>
        ) : (
          byType.map(([type, items]) => (
            <Section
              key={type}
              title={typeLabel(type)}
              action={
                statusFilter === "open" ? (
                  <div style={{ display: "inline-flex", gap: 8 }}>
                    <DsButton
                      variant="default"
                      size="sm"
                      onClick={() => bulkApproveByType(type)}
                    >
                      Approve all
                    </DsButton>
                    <DsButton
                      variant="default"
                      size="sm"
                      onClick={() => bulkDismissByType(type)}
                    >
                      Dismiss all
                    </DsButton>
                  </div>
                ) : (
                  `${items.length}`
                )
              }
            >
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((n) => (
                  <li key={n.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                    <Row notification={n} actionable={statusFilter === "open"} />
                  </li>
                ))}
              </ul>
            </Section>
          ))
        )}
      </div>
    </div>
  );
}

function Row({ notification, actionable }: { notification: Notification; actionable: boolean }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <UrgencyDot urgency={notification.urgency} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: 13,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
          }}
        >
          {notification.title}
        </div>
        {notification.body && (
          <p style={{ fontSize: 12, color: "var(--ds-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
            {notification.body}
          </p>
        )}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>
            {notification.createdAt ? new Date(notification.createdAt).toLocaleString() : ""}
          </span>
          {notification.urgency !== "normal" && (
            <StatusTag kind={urgencyToTagKind(notification.urgency)}>
              {notification.urgency}
            </StatusTag>
          )}
        </div>
      </div>
      {actionable && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <DsButton
            variant="primary"
            size="sm"
            onClick={() => notification.id && approveNotification(notification.id)}
          >
            {notification.actionLabel ?? "Approve"}
          </DsButton>
          <button
            type="button"
            onClick={() => notification.id && snoozeNotification(notification.id)}
            style={textBtnStyle()}
          >
            Snooze 1d
          </button>
          <button
            type="button"
            onClick={() => notification.id && dismissNotification(notification.id)}
            style={{ ...textBtnStyle(), color: "var(--ds-tier-urgent)" }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function UrgencyDot({ urgency }: { urgency: NotificationUrgency }) {
  const bg =
    urgency === "critical"
      ? "var(--ds-tier-urgent)"
      : urgency === "high"
      ? "var(--ds-semantic-warn)"
      : urgency === "normal"
      ? "var(--ds-tier-quarter-focus)"
      : "var(--ds-text-muted)";
  return (
    <span
      aria-hidden
      style={{
        marginTop: 6,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: bg,
        flexShrink: 0,
      }}
    />
  );
}

function urgencyToTagKind(u: NotificationUrgency): "pending" | "overdue" | "neutral" {
  if (u === "critical") return "overdue";
  if (u === "high") return "pending";
  return "neutral";
}

function textBtnStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--ds-text-muted)",
    cursor: "pointer",
    padding: 0,
    fontWeight: 500,
  };
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
