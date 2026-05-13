"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { ImportSection } from "@/components/settings/import-section";

export default function SettingsImportPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Spreadsheet import" meta="Bulk-import ingredients, moulds, packaging, decorations, fillings, products" />
        <div className="px-4 pb-8 pt-4">
          <ImportSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
