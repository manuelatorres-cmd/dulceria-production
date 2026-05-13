"use client";

import { useRef, useState } from "react";
import { exportBackup, importBackup } from "@/lib/backup";
import { isCloudConfigured } from "@/lib/supabase";
import { IconDownload as Download } from "@tabler/icons-react";

type ImportState = "idle" | "confirm" | "importing" | "done" | "error";

/**
 * Backup & restore section. Self-contained — owns its file/import state.
 * Import UI removed 2026-04-19 (legacy migrator unreliable); export retained.
 * Hooks for re-enabling import kept inert below.
 */
export function BackupSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await exportBackup();
    } finally {
      setExporting(false);
    }
  }

  // Kept so import UI can be re-enabled later without rederiving legacy
  // field migrators. Currently unused.
  void selectedFile; void importState; void errorMessage; void fileInputRef;
  void importBackup; void setSelectedFile; void setImportState; void setErrorMessage;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Backup & Restore</h2>
        {!isCloudConfigured ? (
          <div className="rounded-[4px] border border-[color:var(--ds-semantic-warn)] bg-[color:var(--ds-tint-warn)] p-3 text-xs text-[color:var(--ds-semantic-warn)] space-y-1">
            <p>
              <strong>You&apos;re using local-only mode.</strong> All data lives in this browser
              and isn&apos;t synced anywhere.
            </p>
            <p>
              Export regularly — especially on iOS Safari, which may clear storage after a few
              weeks of inactivity. Installing to the Home Screen reduces (but doesn&apos;t
              eliminate) that risk.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Your data syncs across devices when signed in. Export a backup regularly as an extra
            safety net.
          </p>
        )}

        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-2">
          <div className="flex items-start gap-3">
            <Download className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Export backup</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Downloads a <code>.json</code> file containing all your ingredients, products,
                fillings, moulds, and production plans.
              </p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full rounded-[4px] bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export backup"}
          </button>
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">About</h2>
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3 space-y-1">
          <p className="text-sm font-medium">Dulceria{isCloudConfigured ? "" : " — local only"}</p>
          {isCloudConfigured ? (
            <>
              <p className="text-xs text-muted-foreground">Chocolatier toolkit, synced via Supabase.</p>
              <p className="text-xs text-muted-foreground">Your data is securely synced across all your devices.</p>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Chocolatier toolkit, running locally in your browser.</p>
              <p className="text-xs text-muted-foreground">Your data lives in this device&apos;s storage only — use Export to keep a backup.</p>
              <p className="text-xs text-muted-foreground">Tip: install as a PWA (via your browser&apos;s &ldquo;Install app&rdquo; or &ldquo;Add to Home Screen&rdquo;) to use offline like a native app.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
