"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { StepsSection } from "@/components/settings/steps-section";

export default function SettingsStepsPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Production steps" meta="Per-product workflow templates" />
        <div className="px-4 pb-8 pt-4">
          <StepsSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
