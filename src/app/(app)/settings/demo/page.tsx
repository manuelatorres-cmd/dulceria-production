"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { DemoSection } from "@/components/settings/demo-section";

export default function SettingsDemoPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Demo mode" meta="Touch indicators, demo data, delete-all" />
        <div className="px-4 pb-8 pt-4 max-w-3xl">
          <DemoSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
