"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ExperimentsTab } from "./experiments-tab";
import { GanacheCalculatorTab } from "./ganache-calculator-tab";
import { RecipeCalculatorTab } from "./recipe-calculator-tab";
import { AuditTab } from "./audit-tab";

type Tab = "experiments" | "ganache" | "recipes" | "audit";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "experiments", label: "Experiments" },
  { id: "ganache", label: "Ganache calculator" },
  { id: "recipes", label: "Recipe calculator" },
  { id: "audit", label: "Audit recipes" },
];

export default function LabPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initial: Tab = (params.get("tab") as Tab) ?? "experiments";
  const [activeTab, setActiveTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "experiments");

  useEffect(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (activeTab === "experiments") sp.delete("tab");
    else sp.set("tab", activeTab);
    const next = sp.toString();
    router.replace(`/lab${next ? `?${next}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="px-4 sm:px-6 pt-2 pb-12 max-w-6xl mx-auto">
      <PageHeader
        title="Product Lab"
        description="Formulate and balance fillings before committing them as products. Three workspaces: live experiments, the ganache balance checker, and recipe templates for every filling category."
      />

      <div className="flex border-b border-border mb-6 -mx-1 sm:-mx-2 px-1 sm:px-2 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "experiments" && <ExperimentsTab />}
        {activeTab === "ganache" && <GanacheCalculatorTab />}
        {activeTab === "recipes" && <RecipeCalculatorTab />}
        {activeTab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}
