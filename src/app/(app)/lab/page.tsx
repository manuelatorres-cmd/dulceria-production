"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, DsTabNav } from "@/components/dulceria";
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
  const [activeTab, setActiveTab] = useState<Tab>(
    TABS.some((t) => t.id === initial) ? initial : "experiments",
  );

  useEffect(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (activeTab === "experiments") sp.delete("tab");
    else sp.set("tab", activeTab);
    const next = sp.toString();
    router.replace(`/lab${next ? `?${next}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Product lab"
        meta="Formulate + balance fillings before committing as products · experiments, ganache balance, recipe templates"
      />
      <div style={{ padding: "0 32px" }}>
        <DsTabNav tabs={TABS} activeTab={activeTab} onChange={(id) => setActiveTab(id as Tab)} />
      </div>
      <div style={{ padding: "16px 32px 40px" }}>
        {activeTab === "experiments" && <ExperimentsTab />}
        {activeTab === "ganache" && <GanacheCalculatorTab />}
        {activeTab === "recipes" && <RecipeCalculatorTab />}
        {activeTab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}
