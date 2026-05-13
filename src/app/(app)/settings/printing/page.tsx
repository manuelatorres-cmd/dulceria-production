"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { PrintingSection } from "@/components/settings/printing-section";

export default function SettingsPrintingPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Label printing" meta="Niimbot integration for production batch labels" />
        <div className="px-4 pb-8 pt-4 max-w-3xl">
          <PrintingSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
