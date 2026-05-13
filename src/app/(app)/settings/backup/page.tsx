"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { BackupSection } from "@/components/settings/backup-section";

export default function SettingsBackupPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Backup & restore" meta="Export a JSON backup of all your data" />
        <div className="px-4 pb-8 pt-4 max-w-3xl">
          <BackupSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
