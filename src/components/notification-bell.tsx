"use client";

/**
 * Notification bell — always-on-top trigger for the decision queue.
 *
 * Sits in the global shell (top-right of every page). Counter badge
 * shows open, non-snoozed notifications. Tap opens the panel: scrollable
 * card list with Approve / Snooze / Dismiss actions.
 *
 * Keyboard shortcuts while panel is open:
 *   y  → approve focused card
 *   n  → dismiss focused card
 *   s  → snooze focused card 1 day
 *   j/k or ↑/↓ → move focus
 *   Esc → close panel
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useNotifications,
  useOpenNotificationCount,
  approveNotification,
  snoozeNotification,
  dismissNotification,
} from "@/lib/hooks";
import type { Notification, NotificationUrgency } from "@/types";

export function NotificationBell() {
  const count = useOpenNotificationCount();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const items = useNotifications("open");
  const rootRef = useRef<HTMLDivElement>(null);

  // Filter out snoozed items whose snoozeUntil hasn't passed.
  const now = Date.now();
  const visible = items.filter(
    (n) => !n.snoozedUntil || new Date(n.snoozedUntil).getTime() <= now,
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Keyboard shortcuts while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") return setOpen(false);
      if (visible.length === 0) return;
      const focused = visible[focusIdx];
      if (!focused?.id) return;
      if (e.key === "y") {
        void approveNotification(focused.id);
      } else if (e.key === "n") {
        void dismissNotification(focused.id);
      } else if (e.key === "s") {
        void snoozeNotification(focused.id);
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(visible.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, visible, focusIdx]);

  // Reset focus when items change.
  useEffect(() => {
    setFocusIdx(0);
  }, [visible.length]);

  const criticalOpen = visible.some((n) => n.urgency === "critical");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground transition-colors"
      >
        <BellIcon className="w-[18px] h-[18px]" />
        {count > 0 ? (
          <span
            className={
              "absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 text-[9px] font-semibold flex items-center justify-center leading-none text-white " +
              (criticalOpen
                ? "bg-[color:var(--color-status-alert)]"
                : "bg-[color:var(--accent-terracotta-ink)]")
            }
            style={{ borderRadius: 2 }}
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-12 w-[360px] max-h-[520px] overflow-hidden bg-card border border-[color:var(--ds-border-warm)] shadow-lg z-50 flex flex-col"
          style={{ borderRadius: 4 }}
        >
          <header className="flex items-baseline justify-between px-4 pt-4 pb-2 border-b border-[color:var(--ds-border-warm)]">
            <span
              className="text-[10px] text-muted-foreground uppercase font-medium"
              style={{ letterSpacing: "0.12em" }}
            >
              Notifications · {visible.length}
            </span>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-[10px] text-muted-foreground uppercase hover:text-foreground"
              style={{ letterSpacing: "0.08em" }}
            >
              View all
            </Link>
          </header>

          {visible.length === 0 ? (
            <p
              className="px-4 py-10 text-center text-muted-foreground text-[13px] italic"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              All clear.
            </p>
          ) : (
            <ul className="flex-1 overflow-y-auto divide-y divide-border">
              {visible.slice(0, 20).map((n, idx) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  focused={idx === focusIdx}
                  onHover={() => setFocusIdx(idx)}
                />
              ))}
            </ul>
          )}

          <footer
            className="px-4 py-2 border-t border-[color:var(--ds-border-warm)] text-[10px] text-muted-foreground flex gap-3"
            style={{ letterSpacing: "0.06em" }}
          >
            <span><kbd>y</kbd> approve</span>
            <span><kbd>s</kbd> snooze</span>
            <span><kbd>n</kbd> dismiss</span>
            <span className="ml-auto"><kbd>j</kbd>/<kbd>k</kbd> move</span>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({
  notification,
  focused,
  onHover,
}: {
  notification: Notification;
  focused: boolean;
  onHover: () => void;
}) {
  return (
    <li
      onMouseEnter={onHover}
      className={
        "px-4 py-3 transition-colors " +
        (focused ? "bg-muted/80" : "hover:bg-muted/40")
      }
    >
      <div className="flex items-start gap-3">
        <UrgencyDot urgency={notification.urgency} />
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-medium leading-snug"
            style={{ fontFamily: "var(--font-serif)", letterSpacing: "-0.01em", fontWeight: 500 }}
          >
            {notification.title}
          </div>
          {notification.body ? (
            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
              {notification.body}
            </p>
          ) : null}
          <div className="flex gap-2 mt-2">
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
        </div>
      </div>
    </li>
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

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}
