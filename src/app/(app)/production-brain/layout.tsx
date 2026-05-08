"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeatureFlag, FEATURE_FLAGS, setEnabled } from "@/lib/featureFlags";

const TABS: { href: string; label: string }[] = [
  { href: "/production-brain/dashboard", label: "Dashboard" },
  { href: "/production-brain/daily", label: "Daily" },
  { href: "/production-brain/planner", label: "Planner" },
  { href: "/production-brain/needed", label: "Needed" },
  { href: "/production-brain/equipment", label: "Equipment" },
  { href: "/production-brain/haccp", label: "HACCP" },
];

export default function ProductionBrainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const enabled = useFeatureFlag(FEATURE_FLAGS.productionBrain);
  const pathname = usePathname();

  if (!enabled) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6 text-center">
        <h1 className="text-2xl tracking-tight mb-2">Production Brain (preview)</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The production-brain rewrite ships behind a feature flag while it
          stabilises. Enable it on this device to preview the new dashboard,
          daily view, and drag-drop planner.
        </p>
        <button
          className="btn-primary"
          onClick={() => setEnabled(FEATURE_FLAGS.productionBrain, true)}
        >
          Enable production-brain
        </button>
        <p className="text-xs text-muted-foreground mt-4">
          You can disable it again anytime from this page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <nav className="flex flex-wrap gap-1 mb-5 p-1 rounded-sm bg-muted w-fit">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                "px-4 py-1.5 text-sm rounded-full transition-colors " +
                (active
                  ? "bg-card text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-card/60")
              }
            >
              {tab.label}
            </Link>
          );
        })}
        <button
          className="ml-2 text-xs text-muted-foreground hover:text-foreground px-3"
          onClick={() => setEnabled(FEATURE_FLAGS.productionBrain, false)}
          title="Hide the production-brain preview on this device."
        >
          Disable preview
        </button>
      </nav>
      {children}
    </div>
  );
}
