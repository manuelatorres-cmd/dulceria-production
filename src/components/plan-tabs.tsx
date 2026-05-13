"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Shared tab switcher used at the top of /plan and /production-brain/daily.
 * URL-driven so refresh / bookmarks preserve active tab. Daily lives at its
 * own route (/production-brain/daily) — porting the full render into /plan
 * would force a 2k-line refactor; routing daily to its existing URL is
 * cheaper and keeps the engine + page intact. Both routes render this strip
 * so the user can flick between Weekly / Pivot / Daily from either entry.
 */
export type PlanView = "weekly" | "pivot" | "daily";

export function PlanTabs({ focusParam }: { focusParam?: string | null } = {}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const focus = focusParam ?? sp.get("focus");
  const focusQs = focus ? `&focus=${encodeURIComponent(focus)}` : "";

  // active tab derives from current pathname + ?view=
  const onDaily = pathname.startsWith("/production-brain/daily");
  const view = onDaily ? "daily" : ((sp.get("view") ?? "weekly") as PlanView);

  const tabs: Array<{ key: PlanView; label: string; href: string }> = [
    { key: "weekly", label: "Weekly", href: `/plan?view=weekly${focusQs}` },
    { key: "pivot",  label: "Pivot",  href: `/plan?view=pivot${focusQs}`  },
    {
      key: "daily",
      label: "Daily",
      // Coming from /plan, mark from=plan so the BackButton on daily reads
      // "Back to Plan" + the sidebar stays scoped to Workshop.
      href: onDaily ? "/production-brain/daily" : "/production-brain/daily?from=plan",
    },
  ];

  return (
    <div className="mb-3 inline-flex rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden text-[12px]">
      {tabs.map((t) => {
        const active = view === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={
              "px-3.5 py-1.5 font-medium transition-colors " +
              (active
                ? "bg-[#4a6b5b] text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-[color:var(--ds-card-bg)]")
            }
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
