"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { exportBackup, importBackup, clearAllData } from "@/lib/backup";
import { useMarketRegion, setMarketRegion, useFacilityMayContain, setFacilityMayContain, useCurrency, setCurrency, useDefaultFillMode, setDefaultFillMode, useIngredients, useFillings, useMouldsList, useProductCategories, useCapacityConfig, saveCapacityConfig, useBlockedDays, saveEventCalendarEntry, deleteEventCalendarEntry, usePeople, savePerson, deletePerson, archivePerson, usePersonUnavailability, savePersonUnavailability, deletePersonUnavailability, useEquipment, saveEquipment, deleteEquipment, archiveEquipment, useProductionSteps, saveProductionStep, deleteProductionStep, reorderProductionSteps } from "@/lib/hooks";
import { getAllergensByRegion, allergenLabel, CURRENCIES, MARKET_LABEL_RULES, WEEKDAYS, EQUIPMENT_KINDS, EQUIPMENT_KIND_LABELS, EQUIPMENT_LOCATIONS, EQUIPMENT_LOCATION_LABELS, type CurrencyCode, type MarketRegion, type FillMode, type CapacityConfig, type Weekday, type EventCalendarEntry, type Person, type PersonUnavailability, type Equipment, type EquipmentKind, type ProductionStep } from "@/types";
import { capacityConfigStatus, sortWeekdays, collectRoles } from "@/lib/capacity";
import { equipmentAvailability, equipmentReadiness, EQUIPMENT_AVAILABILITY_LABEL } from "@/lib/equipment";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import { loadDemoData, isDemoDataLoaded } from "@/lib/seed-demo";
import { isCloudConfigured } from "@/lib/supabase";
import { Download, AlertTriangle, CheckCircle, FlaskConical, Video, Printer, Pencil, Trash2, Plus, X, Clock, Archive, ArchiveRestore, ChevronDown, ChevronRight } from "lucide-react";
import { SpreadsheetImport } from "@/components/spreadsheet-import";
import { ingredientImportConfig, getExistingIngredientKeys } from "@/lib/spreadsheet-import-ingredients";
import { mouldImportConfig, getExistingMouldKeys } from "@/lib/spreadsheet-import-moulds";
import { packagingImportConfig, getExistingPackagingKeys } from "@/lib/spreadsheet-import-packaging";
import { decorationImportConfig, getExistingDecorationKeys } from "@/lib/spreadsheet-import-decorations";
import { buildFillingImportConfig, buildIngredientLookup as buildIngredientLookupForFilling, getExistingFillingKeys, type FillingImportRow } from "@/lib/spreadsheet-import-fillings";
import { buildProductImportConfig, buildFillingNameLookup, buildMouldNameLookup, buildIngredientNameLookup, buildProductCategoryLookup, getExistingProductKeys, type ProductImportRow } from "@/lib/spreadsheet-import-products";
import type { Ingredient } from "@/types";

type ImportState = "idle" | "confirm" | "importing" | "done" | "error";
type Tab = "backup" | "import" | "capacity" | "equipment" | "steps" | "market" | "printing" | "demo";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("backup");
  const [marketDirty, setMarketDirty] = useState(false);
  const marketRegion = useMarketRegion();
  const currency = useCurrency();
  const facilityMayContain = useFacilityMayContain();
  const defaultFillMode = useDefaultFillMode();

  const anyDirty = marketDirty;

  // Guard page-level navigation (side nav links, browser close/refresh)
  useNavigationGuard(anyDirty);

  function switchTab(tab: Tab) {
    if (tab === activeTab) return;
    if (anyDirty) {
      if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
      setMarketDirty(false);
    }
    setActiveTab(tab);
  }
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

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setImportState("confirm");
    setErrorMessage("");
    e.target.value = "";
  }

  async function handleConfirmImport() {
    if (!selectedFile) return;
    setImportState("importing");
    try {
      await importBackup(selectedFile);
      setImportState("done");
      setSelectedFile(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Import failed.");
      setImportState("error");
    }
  }

  function handleCancelImport() {
    setSelectedFile(null);
    setImportState("idle");
    setErrorMessage("");
  }

  return (
    <div>
      <PageHeader title="Settings" description="Backup, restore, and preferences" />

      {/* Tab strip */}
      <div className="flex border-b border-border px-4 mb-6">
        <button
          onClick={() => switchTab("backup")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "backup" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Backup & Restore
        </button>
        <button
          onClick={() => switchTab("import")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "import" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Import
        </button>
        <button
          onClick={() => switchTab("capacity")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "capacity" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Capacity &amp; People
        </button>
        <button
          onClick={() => switchTab("equipment")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "equipment" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Equipment
        </button>
        <button
          onClick={() => switchTab("steps")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "steps" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Production Steps
        </button>
        <button
          onClick={() => switchTab("market")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "market" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Target Market
        </button>
        <button
          onClick={() => switchTab("printing")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "printing" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Printing
        </button>
        <button
          onClick={() => switchTab("demo")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "demo" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Demo Mode
        </button>
      </div>

      <div className="px-4 pb-8">
        {activeTab === "backup" ? (
          <BackupTab
            fileInputRef={fileInputRef}
            exporting={exporting}
            importState={importState}
            errorMessage={errorMessage}
            selectedFile={selectedFile}
            onExport={handleExport}
            onFileSelected={handleFileSelected}
            onConfirmImport={handleConfirmImport}
            onCancelImport={handleCancelImport}
          />
        ) : activeTab === "import" ? (
          <ImportTab />
        ) : activeTab === "capacity" ? (
          <CapacityTab onDirtyChange={setMarketDirty} />
        ) : activeTab === "equipment" ? (
          <EquipmentTab />
        ) : activeTab === "steps" ? (
          <ProductionStepsTab />
        ) : activeTab === "market" ? (
          <PreferencesTab marketRegion={marketRegion} onRegionChange={setMarketRegion} currency={currency} onCurrencyChange={setCurrency} facilityMayContain={facilityMayContain} onMayContainChange={setFacilityMayContain} defaultFillMode={defaultFillMode} onFillModeChange={setDefaultFillMode} onDirtyChange={setMarketDirty} />
        ) : activeTab === "printing" ? (
          <LabelPrinterSection />
        ) : activeTab === "demo" ? (
          <DemoTab />
        ) : null}
      </div>
    </div>
  );
}

function BackupTab({
  fileInputRef,
  exporting,
  importState,
  errorMessage,
  selectedFile,
  onExport,
  onFileSelected,
  onConfirmImport,
  onCancelImport,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  exporting: boolean;
  importState: ImportState;
  errorMessage: string;
  selectedFile: File | null;
  onExport: () => void;
  onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Backup & Restore</h2>
        {!isCloudConfigured ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
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

        {/* Export */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
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
            onClick={onExport}
            disabled={exporting}
            className="w-full rounded-full bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export backup"}
          </button>
        </div>

        {/* Import UI removed 2026-04-19: the bulk-restore flow was unreliable
            in practice and the user opted to enter data manually on first run.
            Export still works. The `importBackup()` function stays in
            src/lib/backup.ts (dead code for now) so we can revive the UI later
            without re-deriving all the legacy field migrators. */}
      </section>

      {/* About */}
      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-primary">About</h2>
        <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-1">
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

function DemoTab() {
  return (
    <div className="space-y-6">
      <DemoModeSection />
      <DemoDataSection />
      <ClearAllDataSection />
    </div>
  );
}

function LabelPrinterSection() {
  const [enabled, setEnabled] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("niimbot-printer-enabled") === "true"
  );

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("niimbot-printer-enabled", next ? "true" : "false");
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">Label Printer</h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Printer className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Label printing</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows a "Save labels" button on completed production batches. Generates one PNG
              traceability label per product type and opens the share sheet — save to Photos,
              AirDrop, or open in the Niimbot app to print.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-border"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      </div>
    </section>
  );
}

function DemoModeSection() {
  const [enabled, setEnabled] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("demo-mode") === "true"
  );

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("demo-mode", next ? "true" : "false");
    window.dispatchEvent(new CustomEvent("demo-mode-changed"));
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">Demo Mode</h2>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Touch indicators</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shows a ripple wherever you tap — useful when screen-recording for social media.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${enabled ? "bg-primary" : "bg-border"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}

function DemoDataSection() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "already" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleLoad() {
    setState("loading");
    try {
      const alreadyLoaded = await isDemoDataLoaded();
      if (alreadyLoaded) {
        setState("already");
        return;
      }
      const result = await loadDemoData();
      if (result.success) {
        setState("done");
        setMessage(result.message);
      } else {
        setState("already");
      }
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Failed to load demo data.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-primary">Demo Data</h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Load cost calculation demo</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adds 3 products (Milk Chocolate Ganache, Salted Caramel, Hazelnut Praline)
              with full ingredient data, a cost history showing the switch from{" "}
              <strong>Callebaut → Felchlin</strong> premium couverture in February 2026,
              5 production batches (including one in progress today), and in-stock products
              ready to explore in the Stock tab.
              Existing data is not affected.
            </p>
          </div>
        </div>

        {state === "idle" && (
          <button
            onClick={handleLoad}
            className="w-full rounded-full border border-border py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Load demo data
          </button>
        )}
        {state === "loading" && (
          <div className="py-2 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {state === "done" && (
          <div className="flex items-start gap-2 rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">{message}</p>
          </div>
        )}
        {state === "already" && (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">Demo data is already loaded.</p>
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{message}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ClearAllDataSection() {
  const [state, setState] = useState<"idle" | "confirm" | "clearing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleClear() {
    setState("clearing");
    try {
      await clearAllData();
      setState("done");
      setMessage("All data has been deleted. The app is ready for a fresh start.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Failed to clear data.");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-destructive">Delete All Data</h2>
      <div className="rounded-lg border border-destructive/30 bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Trash2 className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Start from scratch</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently deletes all products, fillings, ingredients, moulds, production plans,
              collections, experiments, and every other record in the app.
              This cannot be undone — export a backup first if you want to keep anything.
            </p>
          </div>
        </div>

        {state === "idle" && (
          <button
            onClick={() => setState("confirm")}
            className="w-full rounded-full border border-destructive/30 text-destructive py-2 text-sm font-medium hover:bg-destructive/5 transition-colors"
          >
            Delete all data
          </button>
        )}
        {state === "confirm" && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 space-y-3">
            <p className="text-sm text-destructive font-medium">
              Are you sure? This will permanently delete everything.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="flex-1 rounded-full bg-destructive text-white py-2 text-sm font-medium"
              >
                Yes, delete everything
              </button>
              <button
                onClick={() => setState("idle")}
                className="rounded-full border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {state === "clearing" && (
          <div className="py-2 text-center text-sm text-muted-foreground">Deleting…</div>
        )}
        {state === "done" && (
          <div className="flex items-start gap-2 rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">{message}</p>
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{message}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Capacity & People (§1 of the production planning stack)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

function CapacityTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const config = useCapacityConfig();
  const people = usePeople(true); // include archived — per-row filtering in UI
  const unavailability = usePersonUnavailability();
  const blocked = useBlockedDays();

  const [capacityBuffer, setCapacityBuffer] = useState<string>("");
  const [fillingBuffer, setFillingBuffer] = useState<string>("");
  const [warnThreshold, setWarnThreshold] = useState<string>("");
  const [criticalThreshold, setCriticalThreshold] = useState<string>("");
  const [expiryWarnDays, setExpiryWarnDays] = useState<string>("");
  const [labourRate, setLabourRate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  // Sync form state when the config first loads
  const configKey = config ? JSON.stringify(config) : "null";
  if (configKey !== syncedAt) {
    setCapacityBuffer(config?.capacityBufferPercent != null ? String(config.capacityBufferPercent) : "");
    setFillingBuffer(config?.fillingBufferPercent != null ? String(config.fillingBufferPercent) : "");
    setWarnThreshold(config?.warnThresholdPercent != null ? String(config.warnThresholdPercent) : "");
    setCriticalThreshold(config?.criticalThresholdPercent != null ? String(config.criticalThresholdPercent) : "");
    setExpiryWarnDays(config?.stockExpiryWarnDays != null ? String(config.stockExpiryWarnDays) : "");
    setLabourRate(config?.labourHourlyRate != null ? String(config.labourHourlyRate) : "");
    setSyncedAt(configKey);
    onDirtyChange(false);
  }

  const isDirty = syncedAt !== null && (
    capacityBuffer !== (config?.capacityBufferPercent != null ? String(config.capacityBufferPercent) : "") ||
    fillingBuffer !== (config?.fillingBufferPercent != null ? String(config.fillingBufferPercent) : "") ||
    warnThreshold !== (config?.warnThresholdPercent != null ? String(config.warnThresholdPercent) : "") ||
    criticalThreshold !== (config?.criticalThresholdPercent != null ? String(config.criticalThresholdPercent) : "") ||
    expiryWarnDays !== (config?.stockExpiryWarnDays != null ? String(config.stockExpiryWarnDays) : "") ||
    labourRate !== (config?.labourHourlyRate != null ? String(config.labourHourlyRate) : "")
  );

  useEffect(() => { onDirtyChange(isDirty); }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true);
    try {
      await saveCapacityConfig({
        capacityBufferPercent: parsePercent(capacityBuffer),
        fillingBufferPercent: parsePercent(fillingBuffer),
        warnThresholdPercent: parsePercent(warnThreshold),
        criticalThresholdPercent: parsePercent(criticalThreshold),
        stockExpiryWarnDays: parseNonNegativeInt(expiryWarnDays),
        labourHourlyRate: parseNonNegativeFloat(labourRate),
      });
    } finally {
      setSaving(false);
    }
  }

  const previewConfig: CapacityConfig = {
    capacityBufferPercent: parsePercent(capacityBuffer),
    fillingBufferPercent: parsePercent(fillingBuffer),
    warnThresholdPercent: parsePercent(warnThreshold),
    criticalThresholdPercent: parsePercent(criticalThreshold),
    stockExpiryWarnDays: parseNonNegativeInt(expiryWarnDays),
    labourHourlyRate: parseNonNegativeFloat(labourRate),
  };
  const status = capacityConfigStatus(previewConfig, people);
  const knownRoles = collectRoles(people);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-primary">Capacity &amp; People</h2>
        <p className="text-xs text-muted-foreground">
          How much production capacity you have on a working day. The reverse scheduler
          sums each person's available hours per day (after unavailability + workshop
          blocked days) and uses the thresholds below to flag overbooked days on the
          dashboard. Partial saves are allowed — the scheduler refuses to run until
          every field is set.
        </p>
        {!status.isComplete && (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">
              Missing: {status.missing.join(", ")}
            </p>
          </div>
        )}
        {status.isComplete && (
          <div className="flex items-start gap-2 rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">All fields set — the scheduler can run.</p>
          </div>
        )}
      </section>

      {/* People */}
      <PeopleSection people={people} unavailability={unavailability} knownRoles={knownRoles} />

      {/* Buffers */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Buffers</h2>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Capacity buffer (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={capacityBuffer}
                onChange={(e) => setCapacityBuffer(e.target.value)}
                placeholder="e.g. 15"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Safety margin applied to the summed people-hours budget. 15% means the
                scheduler aims to fill only 85% so there's room for the unexpected.
              </p>
            </div>
            <div>
              <label className="label">Filling buffer (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={fillingBuffer}
                onChange={(e) => setFillingBuffer(e.target.value)}
                placeholder="e.g. 10"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Extra filling to produce per batch to cover yield loss. 10% means making
                a 220g batch when 200g is needed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Thresholds */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Dashboard thresholds</h2>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Warn threshold (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={warnThreshold}
                onChange={(e) => setWarnThreshold(e.target.value)}
                placeholder="e.g. 80"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Dashboard shows a warning when a day's utilisation passes this %.
              </p>
            </div>
            <div>
              <label className="label">Critical threshold (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={criticalThreshold}
                onChange={(e) => setCriticalThreshold(e.target.value)}
                placeholder="e.g. 95"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Dashboard shows a critical alert at this % — the day is effectively full.
              </p>
            </div>
          </div>
          <div>
            <label className="label">Stock expiry warn window (days)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={expiryWarnDays}
              onChange={(e) => setExpiryWarnDays(e.target.value)}
              placeholder="e.g. 7"
              className="input"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Batches with this many days or fewer until their sell-by date appear
              in the dashboard expiry widget.
            </p>
          </div>
          <div>
            <label className="label">Labour hourly rate</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={labourRate}
              onChange={(e) => setLabourRate(e.target.value)}
              placeholder="e.g. 15.00"
              className="input"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used by the B2B quote calculator to include labour cost. Set in your
              local currency unit per hour.
            </p>
          </div>
        </div>
      </section>

      {/* Save button for capacity-config scalars */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save buffers & thresholds"}
        </button>
        {isDirty && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      {/* Blocked days */}
      <BlockedDaysSection blocked={blocked} />
    </div>
  );
}

// ─── People section ───────────────────────────────────────────────────────

function PeopleSection({ people, unavailability, knownRoles }: {
  people: Person[];
  unavailability: PersonUnavailability[];
  knownRoles: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sort: active first (by name), then archived
  const sorted = [...people].sort((a, b) => {
    if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-primary">People</h2>
          <p className="text-xs text-muted-foreground">
            Add each person who works in production. The scheduler sums their available
            hours per day after their working-day and unavailability settings.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add person
          </button>
        )}
      </div>

      {adding && (
        <PersonEditor
          knownRoles={knownRoles}
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {sorted.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
          No people added yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => {
            const personUnavail = unavailability.filter((u) => u.personId === p.id);
            return (
              <PersonCard
                key={p.id}
                person={p}
                unavailability={personUnavail}
                knownRoles={knownRoles}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id!)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PersonCard({ person, unavailability, knownRoles, expanded, onToggle }: {
  person: Person;
  unavailability: PersonUnavailability[];
  knownRoles: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleArchive(archived: boolean) {
    if (!person.id) return;
    setBusy(true);
    try { await archivePerson(person.id, archived); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!person.id) return;
    setBusy(true);
    try { await deletePerson(person.id); }
    finally { setBusy(false); setPendingRemove(false); }
  }

  const workingDaysLabel = (person.workingDays ?? []).length > 0
    ? sortWeekdays(person.workingDays!).map((d) => WEEKDAY_LABELS[d]).join(", ")
    : "—";

  return (
    <li className={`rounded-lg border bg-card overflow-hidden ${person.archived ? "border-border opacity-70" : "border-border"}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {person.name}
              {person.archived && <span className="ml-2 text-xs text-muted-foreground">(archived)</span>}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {(person.roles ?? []).join(", ") || "no roles"}
              {person.defaultHoursPerDay != null && ` · ${person.defaultHoursPerDay}h/day`}
              {` · ${workingDaysLabel}`}
              {unavailability.length > 0 && ` · ${unavailability.length} unavailable period${unavailability.length > 1 ? "s" : ""}`}
            </p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <PersonEditor
            person={person}
            knownRoles={knownRoles}
            onSaved={() => { /* stays expanded so you can continue editing */ }}
          />

          <PersonUnavailabilityEditor personId={person.id!} unavailability={unavailability} />

          <div className="border-t border-border pt-3 flex items-center gap-4">
            {!person.archived ? (
              <button
                onClick={() => handleArchive(true)}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            ) : (
              <button
                onClick={() => handleArchive(false)}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <ArchiveRestore className="w-3.5 h-3.5" /> Unarchive
              </button>
            )}
            {pendingRemove ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Delete permanently?</span>
                <button onClick={handleDelete} disabled={busy} className="text-red-600 font-medium hover:underline disabled:opacity-50">
                  {busy ? "…" : "Yes"}
                </button>
                <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setPendingRemove(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function PersonEditor({ person, knownRoles, onSaved, onCancel }: {
  person?: Person;
  knownRoles: string[];
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const isNew = !person?.id;
  const [name, setName] = useState(person?.name ?? "");
  const [roles, setRoles] = useState<string[]>(person?.roles ?? []);
  const [roleDraft, setRoleDraft] = useState("");
  const [defaultHours, setDefaultHours] = useState(person?.defaultHoursPerDay != null ? String(person.defaultHoursPerDay) : "");
  const [workingDays, setWorkingDays] = useState<Set<Weekday>>(new Set(person?.workingDays ?? []));
  const [saving, setSaving] = useState(false);

  function addRole(value: string) {
    const v = value.trim();
    if (!v) return;
    if (roles.some((r) => r.toLowerCase() === v.toLowerCase())) {
      setRoleDraft("");
      return;
    }
    setRoles([...roles, v]);
    setRoleDraft("");
  }

  function removeRole(role: string) {
    setRoles(roles.filter((r) => r !== role));
  }

  function toggleWorkingDay(day: Weekday) {
    setWorkingDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await savePerson({
        id: person?.id,
        name: name.trim(),
        roles: roles.length > 0 ? roles : undefined,
        defaultHoursPerDay: parsePositiveNum(defaultHours),
        workingDays: workingDays.size > 0 ? sortWeekdays([...workingDays]) : undefined,
        archived: person?.archived,
      });
      if (isNew) {
        setName("");
        setRoles([]);
        setDefaultHours("");
        setWorkingDays(new Set());
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const availableRoleSuggestions = knownRoles.filter(
    (r) => !roles.some((existing) => existing.toLowerCase() === r.toLowerCase()),
  );

  return (
    <div className={`rounded-lg ${isNew ? "border border-border bg-card p-4" : ""} space-y-3`}>
      <div>
        <label className="label">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Manuela"
          autoFocus={isNew}
          className="input"
        />
      </div>

      <div>
        <label className="label">Roles</label>
        {roles.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {roles.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                {r}
                <button
                  onClick={() => removeRole(r)}
                  className="hover:text-destructive"
                  aria-label={`Remove role ${r}`}
                  type="button"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            list="known-roles"
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(roleDraft); } }}
            placeholder="e.g. chocolatier"
            className="input flex-1"
          />
          <datalist id="known-roles">
            {availableRoleSuggestions.map((r) => <option key={r} value={r} />)}
          </datalist>
          <button
            type="button"
            onClick={() => addRole(roleDraft)}
            disabled={!roleDraft.trim()}
            className="rounded-full border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Add role
          </button>
        </div>
        {knownRoles.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Existing roles on your team: {knownRoles.join(", ")}.
          </p>
        )}
      </div>

      <div>
        <label className="label">Default hours per day</label>
        <input
          type="number"
          min="0.5"
          step="0.5"
          max="24"
          value={defaultHours}
          onChange={(e) => setDefaultHours(e.target.value)}
          placeholder="e.g. 6"
          className="input w-32"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Active production hours on a typical working day.
        </p>
      </div>

      <div>
        <label className="label">Working days</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {WEEKDAYS.map((day) => {
            const active = workingDays.has(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleWorkingDay(day)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add person" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function PersonUnavailabilityEditor({ personId, unavailability }: {
  personId: string;
  unavailability: PersonUnavailability[];
}) {
  const [adding, setAdding] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!startDate && !!endDate && endDate >= startDate && !saving;

  async function handleAdd() {
    setSaving(true);
    try {
      await savePersonUnavailability({ personId, startDate, endDate, notes: notes.trim() || undefined });
      setAdding(false);
      setStartDate("");
      setEndDate("");
      setNotes("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">Unavailable dates</p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">End (inclusive)</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Summer holiday" className="input" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!canSave}
              className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAdding(false); setStartDate(""); setEndDate(""); setNotes(""); }}
              className="rounded-full border border-border px-3 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {unavailability.length === 0 ? (
        <p className="text-xs text-muted-foreground">No unavailable dates.</p>
      ) : (
        <ul className="space-y-1">
          {unavailability.map((u) => <UnavailabilityRow key={u.id} entry={u} />)}
        </ul>
      )}
    </div>
  );
}

function UnavailabilityRow({ entry }: { entry: PersonUnavailability }) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleDelete() {
    if (!entry.id) return;
    setRemoving(true);
    try { await deletePersonUnavailability(entry.id); }
    finally { setRemoving(false); setPendingRemove(false); }
  }

  return (
    <li className="flex items-center gap-2 text-xs px-2 py-1 rounded border border-border bg-card">
      <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        {formatIsoDate(entry.startDate)}
        {entry.startDate !== entry.endDate && ` — ${formatIsoDate(entry.endDate)}`}
        {entry.notes && <span className="text-muted-foreground"> · {entry.notes}</span>}
      </span>
      {pendingRemove ? (
        <span className="flex items-center gap-1.5 shrink-0">
          <button onClick={handleDelete} disabled={removing} className="text-red-600 font-medium hover:underline disabled:opacity-50">
            {removing ? "…" : "Remove"}
          </button>
          <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setPendingRemove(true)}
          className="text-muted-foreground/50 hover:text-destructive shrink-0"
          aria-label="Remove unavailability"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Equipment (§2 of the production planning stack)
// ---------------------------------------------------------------------------

function EquipmentTab() {
  const equipment = useEquipment(true); // include archived; filter per row
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const readiness = equipmentReadiness(equipment);

  // Active first (by name), then archived
  const sorted = [...equipment].sort((a, b) => {
    if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-primary">Equipment</h2>
        <p className="text-xs text-muted-foreground">
          Tempering machines, melting pots, coating belts, and anything else the
          scheduler needs to place tasks on. Throughput (kg/hour) and quantity
          let it estimate duration and run parallel tasks on multiple units.
          Availability below is derived from active production — not set here.
        </p>
        {equipment.filter((e) => !e.archived).length === 0 ? (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">
              Add at least one piece of equipment so the scheduler has something to assign work to.
            </p>
          </div>
        ) : readiness.isComplete ? (
          <div className="flex items-start gap-2 rounded-md bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">
              All equipment has quantity + throughput set — the scheduler can use it.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">
              {readiness.incompleteCount} equipment item{readiness.incompleteCount > 1 ? "s" : ""} missing quantity or kg/hour.
            </p>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {equipment.filter((e) => !e.archived).length} active
          {equipment.filter((e) => e.archived).length > 0 && ` · ${equipment.filter((e) => e.archived).length} archived`}
        </p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add equipment
          </button>
        )}
      </div>

      {adding && (
        <EquipmentEditor
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      {sorted.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
          No equipment added yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((eq) => (
            <EquipmentCard
              key={eq.id}
              equipment={eq}
              expanded={expandedId === eq.id}
              onToggle={() => setExpandedId(expandedId === eq.id ? null : eq.id!)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EquipmentCard({ equipment: eq, expanded, onToggle }: {
  equipment: Equipment;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleArchive(archived: boolean) {
    if (!eq.id) return;
    setBusy(true);
    try { await archiveEquipment(eq.id, archived); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!eq.id) return;
    setBusy(true);
    try { await deleteEquipment(eq.id); }
    finally { setBusy(false); setPendingRemove(false); }
  }

  const avail = equipmentAvailability(eq);
  const availColor =
    avail === "available" ? "text-status-ok bg-status-ok-bg border-status-ok-edge" :
    avail === "in_use" ? "text-status-warn bg-status-warn-bg border-status-warn-edge" :
    "text-muted-foreground bg-muted border-border";

  return (
    <li className={`rounded-lg border bg-card overflow-hidden ${eq.archived ? "opacity-70 border-border" : "border-border"}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{eq.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {EQUIPMENT_KIND_LABELS[eq.kind]}
              {eq.quantity != null && ` · ×${eq.quantity}`}
              {eq.kgPerHour != null && ` · ${eq.kgPerHour} kg/h`}
              {eq.manufacturer && ` · ${eq.manufacturer}`}
            </p>
          </div>
        </button>
        <span className={`shrink-0 rounded-full border text-[10px] font-medium px-2 py-0.5 ${availColor}`}>
          {EQUIPMENT_AVAILABILITY_LABEL[avail]}
        </span>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <EquipmentEditor equipment={eq} onSaved={() => { /* stays expanded */ }} />

          <div className="border-t border-border pt-3 flex items-center gap-4">
            {!eq.archived ? (
              <button
                onClick={() => handleArchive(true)}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            ) : (
              <button
                onClick={() => handleArchive(false)}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <ArchiveRestore className="w-3.5 h-3.5" /> Unarchive
              </button>
            )}
            {pendingRemove ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Delete permanently?</span>
                <button onClick={handleDelete} disabled={busy} className="text-red-600 font-medium hover:underline disabled:opacity-50">
                  {busy ? "…" : "Yes"}
                </button>
                <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setPendingRemove(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function EquipmentEditor({ equipment, onSaved, onCancel }: {
  equipment?: Equipment;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const isNew = !equipment?.id;
  const [name, setName] = useState(equipment?.name ?? "");
  const [kind, setKind] = useState<EquipmentKind>(equipment?.kind ?? "tempering");
  const [quantity, setQuantity] = useState(equipment?.quantity != null ? String(equipment.quantity) : "");
  const [kgPerHour, setKgPerHour] = useState(equipment?.kgPerHour != null ? String(equipment.kgPerHour) : "");
  const [manufacturer, setManufacturer] = useState(equipment?.manufacturer ?? "");
  const [model, setModel] = useState(equipment?.model ?? "");
  const [notes, setNotes] = useState(equipment?.notes ?? "");
  const [requiresTempCheck, setRequiresTempCheck] = useState<boolean>(equipment?.requiresTempCheck ?? false);
  const [tempMinC, setTempMinC] = useState(equipment?.tempMinC != null ? String(equipment.tempMinC) : "");
  const [tempMaxC, setTempMaxC] = useState(equipment?.tempMaxC != null ? String(equipment.tempMaxC) : "");
  const [location, setLocation] = useState<string>(equipment?.location ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await saveEquipment({
        id: equipment?.id,
        name: name.trim(),
        kind,
        quantity: parsePositiveInt(quantity),
        kgPerHour: parsePositiveNum(kgPerHour),
        capacityKg: equipment?.capacityKg,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        notes: notes.trim() || undefined,
        archived: equipment?.archived,
        currentPlanId: equipment?.currentPlanId,
        currentScheduleId: equipment?.currentScheduleId,
        occupiedSince: equipment?.occupiedSince,
        expectedFreeAt: equipment?.expectedFreeAt,
        requiresTempCheck,
        tempMinC: parseOptionalFloat(tempMinC),
        tempMaxC: parseOptionalFloat(tempMaxC),
        location: (location === "shop" || location === "production" || location === "storage") ? location : undefined,
      });
      if (isNew) {
        setName("");
        setKind("tempering");
        setQuantity("");
        setKgPerHour("");
        setManufacturer("");
        setModel("");
        setNotes("");
        setRequiresTempCheck(false);
        setTempMinC("");
        setTempMaxC("");
        setLocation("");
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`space-y-3 ${isNew ? "rounded-lg border border-border bg-card p-4" : ""}`}>
      <div>
        <label className="label">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Chocovision Delta"
          autoFocus={isNew}
          className="input"
        />
      </div>

      <div className={kind === "cooling_system" ? "grid grid-cols-1 gap-3" : "grid grid-cols-3 gap-3"}>
        <div>
          <label className="label">Type</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as EquipmentKind)}
            className="input"
          >
            {EQUIPMENT_KINDS.map((k) => (
              <option key={k} value={k}>{EQUIPMENT_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        {kind !== "cooling_system" && (
          <>
            <div>
              <label className="label">Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 2"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                How many identical units.
              </p>
            </div>
            <div>
              <label className="label">Throughput (kg/hour)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={kgPerHour}
                onChange={(e) => setKgPerHour(e.target.value)}
                placeholder="e.g. 5"
                className="input"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Per unit.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Manufacturer (optional)</label>
          <input
            type="text"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="e.g. Selmi"
            className="input"
          />
        </div>
        <div>
          <label className="label">Model (optional)</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Top EX"
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything the scheduler should ignore but you want to remember"
          className="input resize-none"
        />
      </div>

      {/* HACCP temperature tracking — applies to fridges, freezers, chocolate
          storage, and any other device that needs a daily temperature check. */}
      <div className="rounded-md bg-muted/30 border border-border p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={requiresTempCheck}
            onChange={(e) => setRequiresTempCheck(e.target.checked)}
            className="w-4 h-4"
          />
          Include in daily HACCP temperature log
        </label>
        {requiresTempCheck && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Location</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="input text-sm"
              >
                <option value="">—</option>
                {EQUIPMENT_LOCATIONS.map((l) => (
                  <option key={l} value={l}>{EQUIPMENT_LOCATION_LABELS[l]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Min °C</label>
              <input
                type="number"
                step="0.5"
                value={tempMinC}
                onChange={(e) => setTempMinC(e.target.value)}
                placeholder="e.g. 2"
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label">Max °C</label>
              <input
                type="number"
                step="0.5"
                value={tempMaxC}
                onChange={(e) => setTempMaxC(e.target.value)}
                placeholder="e.g. 5"
                className="input text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add equipment" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Production Steps (§3 of the production planning stack)
// ---------------------------------------------------------------------------

function ProductionStepsTab() {
  const categories = useProductCategories();
  const steps = useProductionSteps();
  const [selectedType, setSelectedType] = useState<string>("");
  const [adding, setAdding] = useState(false);

  // Sync selection when categories load — default to the first active category
  useEffect(() => {
    if (!selectedType && categories.length > 0) {
      const active = categories.filter((c) => !c.archived);
      if (active.length > 0) setSelectedType(active[0].name);
    }
  }, [categories, selectedType]);

  // Steps for the selected product type, ordered
  const stepsForType = useMemo(
    () => steps.filter((s) => s.productType === selectedType).sort((a, b) => a.sortOrder - b.sortOrder),
    [steps, selectedType],
  );

  // All unique step names across every type, for the autocomplete datalist
  const knownStepNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of steps) set.add(s.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [steps]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-primary">Production Steps</h2>
        <p className="text-xs text-muted-foreground">
          Define the production sequence per product type. Each step has a name,
          active time (hands-on work — counts toward the daily capacity budget)
          and waiting time (drying, resting — doesn't). Reuse step names across
          types by picking from the dropdown.
        </p>
      </section>

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
          No product categories yet. Add one under Products → Categories first.
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <label className="label">Product type</label>
            <select
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setAdding(false); }}
              className="input"
            >
              {categories.filter((c) => !c.archived).map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {selectedType && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {stepsForType.length} step{stepsForType.length !== 1 ? "s" : ""} for <strong>{selectedType}</strong>
                </p>
                {!adding && (
                  <button
                    onClick={() => setAdding(true)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add step
                  </button>
                )}
              </div>

              {adding && (
                <ProductionStepEditor
                  productType={selectedType}
                  knownStepNames={knownStepNames}
                  nextSortOrder={stepsForType.length}
                  onSaved={() => setAdding(false)}
                  onCancel={() => setAdding(false)}
                />
              )}

              {stepsForType.length === 0 && !adding ? (
                <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
                  No steps yet for {selectedType}. Click Add step to start.
                </p>
              ) : (
                <ul className="space-y-2">
                  {stepsForType.map((step, i) => (
                    <ProductionStepRow
                      key={step.id}
                      step={step}
                      knownStepNames={knownStepNames}
                      index={i}
                      total={stepsForType.length}
                      onMoveUp={async () => {
                        const next = [...stepsForType];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        await reorderProductionSteps(selectedType, next.map((s) => s.id!));
                      }}
                      onMoveDown={async () => {
                        const next = [...stepsForType];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        await reorderProductionSteps(selectedType, next.map((s) => s.id!));
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProductionStepRow({ step, knownStepNames, index, total, onMoveUp, onMoveDown }: {
  step: ProductionStep;
  knownStepNames: string[];
  index: number;
  total: number;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!step.id) return;
    setBusy(true);
    try { await deleteProductionStep(step.id); }
    finally { setBusy(false); setPendingRemove(false); }
  }

  return (
    <li className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex flex-col shrink-0">
          <button
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label="Move up"
            className="px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground leading-none"
          >
            ↑
          </button>
          <button
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="Move down"
            className="px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground leading-none"
          >
            ↓
          </button>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              <span className="text-muted-foreground mr-1.5">{index + 1}.</span>
              {step.name}
              {step.isFinishingStep && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-primary bg-primary/10 rounded px-1.5 py-0.5 align-middle">
                  Finishing
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Active {step.activeMinutes} min · Waiting {step.waitingMinutes} min
            </p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <ProductionStepEditor
            step={step}
            productType={step.productType}
            knownStepNames={knownStepNames}
            onSaved={() => { /* stays expanded */ }}
          />
          <div className="border-t border-border pt-3">
            {pendingRemove ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Delete this step?</span>
                <button onClick={handleDelete} disabled={busy} className="text-red-600 font-medium hover:underline disabled:opacity-50">
                  {busy ? "…" : "Yes"}
                </button>
                <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setPendingRemove(true)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete step
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ProductionStepEditor({ step, productType, knownStepNames, nextSortOrder, onSaved, onCancel }: {
  step?: ProductionStep;
  productType: string;
  knownStepNames: string[];
  nextSortOrder?: number;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const isNew = !step?.id;
  const [name, setName] = useState(step?.name ?? "");
  const [activeMinutes, setActiveMinutes] = useState(step?.activeMinutes != null ? String(step.activeMinutes) : "");
  const [waitingMinutes, setWaitingMinutes] = useState(step?.waitingMinutes != null ? String(step.waitingMinutes) : "");
  const [isFinishingStep, setIsFinishingStep] = useState(!!step?.isFinishingStep);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleSave() {
    if (!name.trim()) return;
    const active = parseFloat(activeMinutes);
    const waiting = parseFloat(waitingMinutes);
    if (isNaN(active) || active < 0 || isNaN(waiting) || waiting < 0) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveProductionStep({
        id: step?.id,
        productType,
        name: name.trim(),
        activeMinutes: active,
        waitingMinutes: waiting,
        sortOrder: step?.sortOrder ?? nextSortOrder ?? 0,
        isFinishingStep,
      });
      if (isNew) {
        setName("");
        setActiveMinutes("");
        setWaitingMinutes("");
        setIsFinishingStep(false);
      }
      onSaved();
    } catch (err) {
      // Surface the real reason inline. The production-steps table has a
      // unique (productType, name) constraint that's easy to trip when
      // re-adding a previously-used step name — without this message the
      // save button looks like it's just ignoring the click.
      //
      // Supabase throws PostgrestError as a plain object, not an Error
      // instance, so `instanceof Error` misses it and we fall back to
      // reading the shape directly: { message, code, details, hint }.
      const raw: { message?: string; code?: string; details?: string; hint?: string } =
        err instanceof Error ? { message: err.message } : (err as Record<string, string>) ?? {};
      const core = raw.message || raw.details || "Save failed — check the browser console for details";
      const code = raw.code ? ` (code ${raw.code})` : "";
      const pretty = raw.code === "23505" || /duplicate|unique/i.test(core)
        ? `A step called "${name.trim()}" already exists for ${productType}.`
        : `${core}${code}`;
      setSaveError(pretty);
      // Log the full payload so we can diagnose if the UI message isn't enough.
      console.error("saveProductionStep failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`space-y-3 ${isNew ? "rounded-lg border border-border bg-card p-4" : ""}`}>
      <div>
        <label className="label">Step name</label>
        <input
          type="text"
          list="known-step-names"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. tempering, shell, fill"
          autoFocus={isNew}
          className="input"
        />
        <datalist id="known-step-names">
          {knownStepNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        {knownStepNames.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Previously used: {knownStepNames.join(", ")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Active time (min / mould)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={activeMinutes}
            onChange={(e) => setActiveMinutes(e.target.value)}
            placeholder="e.g. 5"
            className="input"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Hands-on time per mould. Counts toward daily capacity.
          </p>
        </div>
        <div>
          <label className="label">Waiting time (min)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={waitingMinutes}
            onChange={(e) => setWaitingMinutes(e.target.value)}
            placeholder="e.g. 20"
            className="input"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Drying / resting. Affects timeline but not capacity.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isFinishingStep}
          onChange={(e) => setIsFinishingStep(e.target.checked)}
          className="w-4 h-4 mt-0.5"
        />
        <span>
          <span className="font-medium">Finishing step</span>
          <span className="block text-xs text-muted-foreground">
            Post-storage tasks (polish, pack, wrap). Only these run when a line
            is fulfilled by borrowing from Store stock — the full production
            cycle runs on the replenishment order instead.
          </span>
        </span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || activeMinutes === "" || waitingMinutes === ""}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add step" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
      {saveError && (
        <p className="text-xs text-status-alert pt-1">{saveError}</p>
      )}
    </div>
  );
}

function BlockedDaysSection({ blocked }: { blocked: EventCalendarEntry[] }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && !!startDate && !!endDate && endDate >= startDate && !saving;

  async function handleAdd() {
    setSaving(true);
    try {
      await saveEventCalendarEntry({
        name: name.trim(),
        kind: "blocked",
        startDate,
        endDate,
      });
      setAdding(false);
      setName("");
      setStartDate("");
      setEndDate("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-primary">Blocked days</h2>
          <p className="text-xs text-muted-foreground">
            Off-days the scheduler skips — vacation, equipment service, public holidays.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add blocked period
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <label className="label">Reason</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer holiday"
              autoFocus
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">End (inclusive)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="input"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!canSave}
              className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAdding(false); setName(""); setStartDate(""); setEndDate(""); }}
              className="rounded-full border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {blocked.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 text-center border border-dashed border-border rounded-lg">
          No blocked periods.
        </p>
      ) : (
        <ul className="space-y-2">
          {blocked.map((entry) => (
            <BlockedDayRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function BlockedDayRow({ entry }: { entry: EventCalendarEntry }) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleDelete() {
    if (!entry.id) return;
    setRemoving(true);
    try {
      await deleteEventCalendarEntry(entry.id);
    } finally {
      setRemoving(false);
      setPendingRemove(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card flex items-center gap-3 px-3 py-2.5">
      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatIsoDate(entry.startDate)}
          {entry.startDate !== entry.endDate && ` — ${formatIsoDate(entry.endDate)}`}
        </p>
      </div>
      {pendingRemove ? (
        <span className="flex items-center gap-1.5 text-xs shrink-0">
          <span className="text-muted-foreground">Remove?</span>
          <button onClick={handleDelete} disabled={removing} className="text-red-600 font-medium hover:underline disabled:opacity-50">
            {removing ? "…" : "Yes"}
          </button>
          <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setPendingRemove(true)}
          className="text-muted-foreground/50 hover:text-destructive shrink-0"
          aria-label="Remove blocked period"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parsePositiveNum(s: string): number | undefined {
  const n = parseFloat(s);
  if (isNaN(n) || n <= 0) return undefined;
  return n;
}
function parseOptionalFloat(s: string): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function parsePositiveInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  if (isNaN(n) || n <= 0) return undefined;
  return n;
}
function parsePercent(s: string): number | undefined {
  const n = parseFloat(s);
  if (isNaN(n) || n < 0 || n > 100) return undefined;
  return n;
}

function parseNonNegativeInt(s: string): number | undefined {
  const n = parseInt(s, 10);
  if (isNaN(n) || n < 0) return undefined;
  return n;
}

function parseNonNegativeFloat(s: string): number | undefined {
  const n = parseFloat(s);
  if (isNaN(n) || n < 0) return undefined;
  return n;
}

function PreferencesTab({
  marketRegion,
  onRegionChange,
  currency,
  onCurrencyChange,
  facilityMayContain,
  onMayContainChange,
  defaultFillMode,
  onFillModeChange,
  onDirtyChange,
}: {
  marketRegion: MarketRegion;
  onRegionChange: (r: MarketRegion) => void;
  currency: CurrencyCode;
  onCurrencyChange: (c: CurrencyCode) => void;
  facilityMayContain: string[];
  onMayContainChange: (allergens: string[]) => void;
  defaultFillMode: FillMode;
  onFillModeChange: (mode: FillMode) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);

  // Draft state — only committed on Save
  const [draftCurrency, setDraftCurrency] = useState(currency);
  const [draftRegion, setDraftRegion] = useState(marketRegion);
  const [draftMayContain, setDraftMayContain] = useState(facilityMayContain);
  const [draftFillMode, setDraftFillMode] = useState(defaultFillMode);

  // Track dirty state — notify parent whenever it changes
  const isDirty = editing && (
    draftCurrency !== currency ||
    draftRegion !== marketRegion ||
    JSON.stringify(draftMayContain) !== JSON.stringify(facilityMayContain) ||
    draftFillMode !== defaultFillMode
  );
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEditing() {
    setDraftCurrency(currency);
    setDraftRegion(marketRegion);
    setDraftMayContain(facilityMayContain);
    setDraftFillMode(defaultFillMode);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
  }

  function handleSave() {
    if (draftCurrency !== currency) onCurrencyChange(draftCurrency);
    if (draftRegion !== marketRegion) onRegionChange(draftRegion);
    if (JSON.stringify(draftMayContain) !== JSON.stringify(facilityMayContain)) onMayContainChange(draftMayContain);
    if (draftFillMode !== defaultFillMode) onFillModeChange(draftFillMode);
    setEditing(false);
  }

  function toggleDraftMayContain(id: string) {
    setDraftMayContain(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active values — draft when editing, committed when reading
  const activeCurrency = editing ? draftCurrency : currency;
  const activeRegion = editing ? draftRegion : marketRegion;
  const activeMayContain = editing ? draftMayContain : facilityMayContain;
  const activeFillMode = editing ? draftFillMode : defaultFillMode;
  const activeAllergens = getAllergensByRegion(activeRegion);
  const rules = MARKET_LABEL_RULES[activeRegion];
  const currencyInfo = CURRENCIES.find(c => c.code === activeCurrency);

  // ---- Read-only view ----
  if (!editing) {
    return (
      <div className="space-y-6">
        {/* Header with edit button */}
        <div className="flex items-center justify-between">
          <div />
          <button
            onClick={startEditing}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>

        {/* Key-value card */}
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          <div className="flex justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">Currency</span>
            <span className="text-sm font-medium">{currencyInfo?.label ?? activeCurrency}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">Target market</span>
            <span className="text-sm font-medium">{rules.label}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">Allergens tracked</span>
            <span className="text-sm font-medium">{activeAllergens.length}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">Default fill mode</span>
            <span className="text-sm font-medium">{activeFillMode === "grams" ? "By grams" : "By percentage"}</span>
          </div>
        </div>

        {/* May Contain summary */}
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground mb-1.5">Facility &ldquo;may contain&rdquo; advisories</p>
          {activeMayContain.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {activeMayContain.map(id => (
                <span key={id} className="rounded-full bg-status-warn-bg text-status-warn border border-status-warn-edge px-2 py-0.5 text-xs font-medium">
                  {allergenLabel(id)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/60">None set</p>
          )}
        </div>
      </div>
    );
  }

  // ---- Edit mode ----
  return (
    <div className="space-y-6">
      {/* Currency */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Currency</h2>
        <p className="text-xs text-muted-foreground">
          All prices, costs, and margins throughout the app are displayed in this currency.
          Changing currency does not convert existing values — it only changes the symbol shown.
        </p>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <label className="block text-sm font-medium">Display currency</label>
          <select
            value={draftCurrency}
            onChange={(e) => setDraftCurrency(e.target.value as CurrencyCode)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* Market & Allergens */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Market &amp; Allergen Compliance</h2>
        <p className="text-xs text-muted-foreground">
          Controls which allergen checklist appears when editing ingredients.
          You are responsible for understanding and complying with your region&rsquo;s labelling regulations.
        </p>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <label className="block text-sm font-medium">Target market</label>
          <select
            value={draftRegion}
            onChange={(e) => setDraftRegion(e.target.value as MarketRegion)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {(Object.entries(MARKET_LABEL_RULES) as [MarketRegion, typeof MARKET_LABEL_RULES["EU"]][]).map(([code, r]) => (
              <option key={code} value={code}>{r.label}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {activeAllergens.length} allergens for this market
          </p>
        </div>
      </section>

      {/* Default fill mode */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Default Fill Mode</h2>
        <p className="text-xs text-muted-foreground">
          Controls how filling amounts are entered by default when assigning fillings to products.
          Individual products can still override this.
        </p>
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <label className="block text-sm font-medium">Default fill mode</label>
          <select
            value={draftFillMode}
            onChange={(e) => setDraftFillMode(e.target.value as FillMode)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="percentage">By percentage</option>
            <option value="grams">By grams</option>
          </select>
        </div>
      </section>

      {/* May Contain */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Facility &ldquo;May Contain&rdquo; Advisories</h2>
        <p className="text-xs text-muted-foreground">
          Cross-contamination risk from shared equipment or production environment. This applies to your
          entire facility — not to individual products.
        </p>
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          {activeAllergens.filter(a => !a.group).map((a) => (
            <label key={a.id} className="flex items-center gap-2.5 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={draftMayContain.includes(a.id)}
                onChange={() => toggleDraftMayContain(a.id)}
                className="shrink-0 accent-[var(--color-primary)]"
              />
              <span className={`text-sm ${draftMayContain.includes(a.id) ? "font-semibold" : ""}`}>
                {a.label}
              </span>
              {a.hint && <span className="text-xs text-muted-foreground">{a.hint}</span>}
            </label>
          ))}
          {activeAllergens.filter(a => a.group === "nuts").length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Tree nuts</p>
              <div className="grid grid-cols-2 gap-x-4">
                {activeAllergens.filter(a => a.group === "nuts").map((a) => (
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={draftMayContain.includes(a.id)}
                      onChange={() => toggleDraftMayContain(a.id)}
                      className="shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className={`text-sm ${draftMayContain.includes(a.id) ? "font-semibold" : ""}`}>
                      {allergenLabel(a.id)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Save / Cancel */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 rounded-full bg-primary text-primary-foreground py-2 text-sm font-medium"
        >
          Save
        </button>
        <button
          onClick={handleCancel}
          className="rounded-full border border-border px-4 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const INGREDIENT_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: Omit<Ingredient, "id">) => d.name },
  { key: "category", label: "Category", accessor: (d: Omit<Ingredient, "id">) => d.category ?? "" },
  { key: "manufacturer", label: "Manufacturer", accessor: (d: Omit<Ingredient, "id">) => d.manufacturer },
];

const MOULD_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: { name: string }) => d.name },
  { key: "cavityWeightG", label: "Cavity g", accessor: (d: { cavityWeightG: number }) => String(d.cavityWeightG) },
  { key: "numberOfCavities", label: "Cavities", accessor: (d: { numberOfCavities: number }) => String(d.numberOfCavities) },
];

const PACKAGING_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: { name: string }) => d.name },
  { key: "capacity", label: "Capacity", accessor: (d: { capacity: number }) => String(d.capacity) },
  { key: "manufacturer", label: "Manufacturer", accessor: (d: { manufacturer?: string }) => d.manufacturer ?? "" },
];

const DECORATION_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: { name: string }) => d.name },
  { key: "type", label: "Type", accessor: (d: { type: string }) => d.type },
  { key: "manufacturer", label: "Manufacturer", accessor: (d: { manufacturer?: string }) => d.manufacturer ?? "" },
];

const FILLING_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: FillingImportRow) => d.filling.name },
  { key: "category", label: "Category", accessor: (d: FillingImportRow) => d.filling.category },
  { key: "ingredients", label: "Ingredients", accessor: (d: FillingImportRow) => `${d.ingredients.length} items` },
];

const PRODUCT_PREVIEW_COLUMNS = [
  { key: "name", label: "Name", accessor: (d: ProductImportRow) => d.product.name },
  { key: "fillMode", label: "Fill mode", accessor: (d: ProductImportRow) => d.product.fillMode ?? "percentage" },
  { key: "fillings", label: "Fillings", accessor: (d: ProductImportRow) => `${d.fillings.length} items` },
];

function ImportTab() {
  // Preload lookup data for relational imports (fillings, products).
  // Hooks are read here so the configs are rebuilt whenever source data changes.
  const allIngredients = useIngredients(true);
  const allFillings = useFillings();
  const allMoulds = useMouldsList(true);
  const allProductCategories = useProductCategories();

  const fillingImportConfig = useMemo(
    () => buildFillingImportConfig(buildIngredientLookupForFilling(allIngredients)),
    [allIngredients],
  );

  const productImportConfig = useMemo(
    () => buildProductImportConfig({
      ingredients: buildIngredientNameLookup(allIngredients),
      fillings: buildFillingNameLookup(allFillings),
      moulds: buildMouldNameLookup(allMoulds),
      productCategories: buildProductCategoryLookup(allProductCategories),
    }),
    [allIngredients, allFillings, allMoulds, allProductCategories],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Import Data</h2>
        <p className="text-xs text-muted-foreground">
          Bulk-import records from an Excel (.xlsx) file. Download the template per entity,
          fill it in, then upload. Duplicates are detected by name (plus manufacturer for
          ingredients) — existing rows are skipped, never overwritten. For fillings and
          products, child rows (ingredient lists / filling references) resolve by name
          against the records already in your database.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={ingredientImportConfig}
          getExistingKeys={getExistingIngredientKeys}
          previewColumns={INGREDIENT_PREVIEW_COLUMNS}
          description="Composition, allergens, nutrition, pricing, sub-ingredient breakdown."
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={mouldImportConfig}
          getExistingKeys={getExistingMouldKeys}
          previewColumns={MOULD_PREVIEW_COLUMNS}
          description="Cavity weight, cavity count, filling weight per cavity, ownership."
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={packagingImportConfig}
          getExistingKeys={getExistingPackagingKeys}
          previewColumns={PACKAGING_PREVIEW_COLUMNS}
          description="Boxes, trays, or other packaging units with their capacity."
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={decorationImportConfig}
          getExistingKeys={getExistingDecorationKeys}
          previewColumns={DECORATION_PREVIEW_COLUMNS}
          description="Cocoa butters, lustre dusts, transfer sheets, and other decoration materials."
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={fillingImportConfig}
          getExistingKeys={getExistingFillingKeys}
          previewColumns={FILLING_PREVIEW_COLUMNS}
          description={`Filling recipes with their ingredient lists. Ingredient names must match existing ingredients — syntax per cell: "Sugar:100g | Cream 35%:200ml".`}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <SpreadsheetImport
          config={productImportConfig}
          getExistingKeys={getExistingProductKeys}
          previewColumns={PRODUCT_PREVIEW_COLUMNS}
          description={`Products with shell chocolate, mould, fillings, and metadata. Names must match existing records. Fillings per cell: "Hazelnut Ganache:50 | Caramel:50".`}
        />
      </section>
    </div>
  );
}
