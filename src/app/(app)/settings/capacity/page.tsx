"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { CapacitySection } from "@/components/settings/capacity-section";

export default function SettingsCapacityPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Capacity & people" meta="Workshop weekly capacity, blocked days, staff roster" />
        <div className="px-4 pb-8 pt-4">
          <CapacitySection />
        </div>
      </div>
    </SettingsProvider>
  );
}
