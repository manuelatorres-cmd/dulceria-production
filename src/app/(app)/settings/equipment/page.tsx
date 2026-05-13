"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { EquipmentSection } from "@/components/settings/equipment-section";

export default function SettingsEquipmentPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Equipment" meta="Tempering machines, cold storage, mould pool" />
        <div className="px-4 pb-8 pt-4">
          <EquipmentSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
