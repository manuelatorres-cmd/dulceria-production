"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/dulceria";
import { exportBackup, importBackup, clearAllData } from "@/lib/backup";
import { useMarketRegion, setMarketRegion, useFacilityMayContain, setFacilityMayContain, useCurrency, setCurrency, useDefaultFillMode, setDefaultFillMode, useIngredients, useFillings, useMouldsList, useProductCategories, useCapacityConfig, saveCapacityConfig, useBlockedDays, saveEventCalendarEntry, deleteEventCalendarEntry, usePeople, savePerson, deletePerson, archivePerson, usePersonUnavailability, savePersonUnavailability, deletePersonUnavailability, useEquipment, saveEquipment, deleteEquipment, archiveEquipment, useProductionSteps, saveProductionStep, deleteProductionStep, reorderProductionSteps } from "@/lib/hooks";
import { getAllergensByRegion, allergenLabel, CURRENCIES, MARKET_LABEL_RULES, WEEKDAYS, EQUIPMENT_KINDS, EQUIPMENT_KIND_LABELS, EQUIPMENT_LOCATIONS, EQUIPMENT_LOCATION_LABELS, PRIMARY_ROLES, ABSENCE_TYPES, ABSENCE_TYPE_LABELS, type CurrencyCode, type MarketRegion, type FillMode, type CapacityConfig, type Weekday, type EventCalendarEntry, type Person, type PersonUnavailability, type Equipment, type EquipmentKind, type ProductionStep, type PrimaryRole, type AbsenceType } from "@/types";
import { capacityConfigStatus, sortWeekdays, collectRoles } from "@/lib/capacity";
import { equipmentAvailability, equipmentReadiness, EQUIPMENT_AVAILABILITY_LABEL } from "@/lib/equipment";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import { loadDemoData, isDemoDataLoaded } from "@/lib/seed-demo";
import { isCloudConfigured } from "@/lib/supabase";
import { IconDownload as Download, IconAlertTriangle as AlertTriangle, IconCircleCheck as CheckCircle, IconFlask as FlaskConical, IconVideo as Video, IconPrinter as Printer, IconPencil as Pencil, IconTrash as Trash2, IconPlus as Plus, IconX as X, IconClock as Clock, IconArchive as Archive, IconArchiveOff as ArchiveRestore, IconChevronDown as ChevronDown, IconChevronRight as ChevronRight, IconCopy as Copy, IconGripVertical as GripVertical } from "@tabler/icons-react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

/** Default skill catalogue — mirrors /settings/skills. Union'd with
 *  whatever skills already live on any person so new ones added via
 *  the dedicated skills page still show up in the editor. */
const DEFAULT_SKILLS = [
  "tempering",
  "shelling",
  "decoration",
  "filling-cook",
  "packing",
  "teaching",
  "cleaning",
  "shop-counter",
];

const PRIMARY_ROLE_LABELS: Record<PrimaryRole, string> = {
  production: "Production",
  shop: "Shop",
  both: "Both",
  other: "Other",
};

const CONTRACT_TYPE_LABELS: Record<NonNullable<Person["contractType"]>, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contractor: "Contractor",
};

export function SettingsAllTabs({ initialTab = "capacity" }: { initialTab?: Tab }) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
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
      <PageHeader title="Settings" meta="Backup, restore, and preferences" />

      {/* Tab strip — order reflects frequency of use (2026-04-24 per
          Manuela): capacity/steps/equipment are the daily/weekly knobs,
          market/printing change rarely, import/backup are maintenance,
          demo mode is development-only. */}
      <div className="flex border-b border-[color:var(--ds-border-warm)] px-4 mb-6">
        <button
          onClick={() => switchTab("capacity")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "capacity" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Capacity &amp; People
        </button>
        <button
          onClick={() => switchTab("steps")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "steps" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Production Steps
        </button>
        <button
          onClick={() => switchTab("equipment")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "equipment" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Equipment
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
          onClick={() => switchTab("import")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "import" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Import
        </button>
        <button
          onClick={() => switchTab("backup")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "backup" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          Backup & Restore
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

        {/* Export */}
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
            onClick={onExport}
            disabled={exporting}
            className="w-full rounded-[4px] bg-primary text-primary-foreground py-2 text-sm font-medium disabled:opacity-50"
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
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
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
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
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
      <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
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
            className="w-full rounded-[4px] border border-[color:var(--ds-border-warm)] py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Load demo data
          </button>
        )}
        {state === "loading" && (
          <div className="py-2 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {state === "done" && (
          <div className="flex items-start gap-2 rounded-[6px] bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">{message}</p>
          </div>
        )}
        {state === "already" && (
          <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">Demo data is already loaded.</p>
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 rounded-[6px] bg-destructive/10 border border-destructive/20 px-3 py-2">
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
      <div className="rounded-[4px] border border-destructive/30 bg-[color:var(--ds-card-bg)] p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Trash2 className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Start from scratch</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently deletes all products, fillings, ingredients, moulds, production plans,
              variants, experiments, and every other record in the app.
              This cannot be undone — export a backup first if you want to keep anything.
            </p>
          </div>
        </div>

        {state === "idle" && (
          <button
            onClick={() => setState("confirm")}
            className="w-full rounded-[4px] border border-destructive/30 text-destructive py-2 text-sm font-medium hover:bg-destructive/5 transition-colors"
          >
            Delete all data
          </button>
        )}
        {state === "confirm" && (
          <div className="rounded-[6px] bg-destructive/10 border border-destructive/20 p-3 space-y-3">
            <p className="text-sm text-destructive font-medium">
              Are you sure? This will permanently delete everything.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="flex-1 rounded-[4px] bg-destructive text-white py-2 text-sm font-medium"
              >
                Yes, delete everything
              </button>
              <button
                onClick={() => setState("idle")}
                className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
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
          <div className="flex items-start gap-2 rounded-[6px] bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">{message}</p>
          </div>
        )}
        {state === "error" && (
          <div className="flex items-start gap-2 rounded-[6px] bg-destructive/10 border border-destructive/20 px-3 py-2">
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
  const [productionBufferDays, setProductionBufferDays] = useState<string>("");
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
    setProductionBufferDays(config?.productionBufferDays != null ? String(config.productionBufferDays) : "");
    setWarnThreshold(config?.warnThresholdPercent != null ? String(config.warnThresholdPercent) : "");
    setCriticalThreshold(config?.criticalThresholdPercent != null ? String(config.criticalThresholdPercent) : "");
    setExpiryWarnDays(config?.stockExpiryWarnDays != null ? String(config.stockExpiryWarnDays) : "");
    setLabourRate(config?.labourHourlyRate != null ? String(config.labourHourlyRate) : "");
    setSyncedAt(configKey);
    // onDirtyChange(false) used to live here but that ran during render
    // of CapacityTab, which React warns about (setState in render of
    // parent). The useEffect below already pushes the current isDirty
    // to the parent whenever it flips — and the post-sync state is
    // equal-to-config, so isDirty becomes false naturally on the next
    // commit. No extra call needed.
  }

  const isDirty = syncedAt !== null && (
    capacityBuffer !== (config?.capacityBufferPercent != null ? String(config.capacityBufferPercent) : "") ||
    fillingBuffer !== (config?.fillingBufferPercent != null ? String(config.fillingBufferPercent) : "") ||
    productionBufferDays !== (config?.productionBufferDays != null ? String(config.productionBufferDays) : "") ||
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
        productionBufferDays: parseBufferDays(productionBufferDays),
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
    productionBufferDays: parseBufferDays(productionBufferDays),
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
          <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">
              Missing: {status.missing.join(", ")}
            </p>
          </div>
        )}
        {status.isComplete && (
          <div className="flex items-start gap-2 rounded-[6px] bg-status-ok-bg border border-status-ok-edge px-3 py-2">
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
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
          <div>
            <label className="label">Production buffer (days)</label>
            <input
              type="number"
              min="0"
              max="14"
              step="1"
              value={productionBufferDays}
              onChange={(e) => setProductionBufferDays(e.target.value)}
              placeholder="e.g. 2"
              className="input"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Safety days between the last scheduled active work and an order's deadline.
              Work lands at latest on (deadline − N working days). Default 2.
            </p>
          </div>
        </div>
      </section>

      {/* Thresholds */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">Dashboard thresholds</h2>
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
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
          className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
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
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
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
  const [editing, setEditing] = useState(false);

  // Always return to view mode when a card is re-opened.
  useEffect(() => {
    if (!expanded) setEditing(false);
  }, [expanded]);

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

  const missing = missingPersonFields(person);

  return (
    <li className={`rounded-[4px] border bg-[color:var(--ds-card-bg)] overflow-hidden ${person.archived ? "border-[color:var(--ds-border-warm)] opacity-70" : "border-[color:var(--ds-border-warm)]"}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate flex items-center gap-2">
              <span className="truncate">{person.name}</span>
              {!person.archived && missing.length > 0 && (
                <span
                  title={`Missing for calculations: ${missing.join(", ")}`}
                  className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)] text-[10px] font-medium px-1.5 py-0.5"
                >
                  <AlertTriangle className="w-3 h-3" /> {missing.length} missing
                </span>
              )}
              {person.archived && <span className="text-xs text-muted-foreground">(archived)</span>}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {(person.roles ?? []).join(", ") || "no roles"}
              {person.primaryRole && person.primaryRole !== "other" && ` · ${PRIMARY_ROLE_LABELS[person.primaryRole]}`}
              {person.isAdmin && " · admin"}
              {person.defaultHoursPerDay != null && ` · ${person.defaultHoursPerDay}h/day`}
              {` · ${workingDaysLabel}`}
              {(person.skills ?? []).length > 0 && ` · ${(person.skills ?? []).length} skill${(person.skills ?? []).length === 1 ? "" : "s"}`}
              {unavailability.length > 0 && ` · ${unavailability.length} unavailable period${unavailability.length > 1 ? "s" : ""}`}
            </p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[color:var(--ds-border-warm)] px-3 py-3 space-y-3">
          {editing ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Editing</p>
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <PersonEditor
                person={person}
                knownRoles={knownRoles}
                onSaved={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Details</p>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-1 text-xs hover:border-foreground/30"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </div>
              <PersonView person={person} />
            </>
          )}

          <PersonUnavailabilityEditor personId={person.id!} unavailability={unavailability} />

          <div className="border-t border-[color:var(--ds-border-warm)] pt-3 flex items-center gap-4">
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

/** Read-only summary of a person, shown on the expanded card before
 *  the user clicks Edit. Mirrors the fields PersonEditor can set —
 *  blanks display as "—" so it's obvious what's missing. */
function PersonView({ person }: { person: Person }) {
  const windowLabel =
    person.startTimeOfDay && person.endTimeOfDay
      ? `${person.startTimeOfDay.slice(0, 5)} – ${person.endTimeOfDay.slice(0, 5)}`
      : person.defaultHoursPerDay != null
      ? `${person.defaultHoursPerDay} h / day`
      : "—";
  const workingDays = (person.workingDays ?? []).length > 0
    ? sortWeekdays(person.workingDays!).map((d) => WEEKDAY_LABELS[d]).join(", ")
    : "—";
  const skills = (person.skills ?? []).length > 0 ? (person.skills ?? []).join(", ") : "—";
  const roles = (person.roles ?? []).length > 0 ? (person.roles ?? []).join(", ") : "—";
  const primaryRole = person.primaryRole ? PRIMARY_ROLE_LABELS[person.primaryRole] : "—";
  const contract = person.contractType ? CONTRACT_TYPE_LABELS[person.contractType] : "—";
  const labour = person.hourlyCostEuros != null ? `€${Number(person.hourlyCostEuros).toFixed(2)} / h` : "—";
  const breakMin = person.breakMinutesPerDay != null ? `${person.breakMinutesPerDay} min` : "—";

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      <ViewRow label="Working hours" value={windowLabel} />
      <ViewRow label="Working days" value={workingDays} />
      <ViewRow label="Break" value={breakMin} />
      <ViewRow label="Primary role" value={primaryRole} />
      <ViewRow label="Skills" value={skills} />
      <ViewRow label="Roles" value={roles} />
      <ViewRow label="Contract" value={contract} />
      <ViewRow label="Labour cost" value={labour} />
      <ViewRow label="Email" value={person.contactEmail || "—"} />
      <ViewRow label="Phone" value={person.contactPhone || "—"} />
      <ViewRow label="Admin" value={person.isAdmin ? "Yes" : "No"} />
    </dl>
  );
}

function ViewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground uppercase tracking-[0.05em] pt-0.5">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </>
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
  const [startTime, setStartTime] = useState(normaliseTimeInput(person?.startTimeOfDay));
  const [endTime, setEndTime] = useState(normaliseTimeInput(person?.endTimeOfDay));
  const [workingDays, setWorkingDays] = useState<Set<Weekday>>(new Set(person?.workingDays ?? []));
  const [skills, setSkills] = useState<Set<string>>(new Set(person?.skills ?? []));
  const [primaryRole, setPrimaryRole] = useState<PrimaryRole | "">((person?.primaryRole as PrimaryRole | undefined) ?? "");
  const [isAdmin, setIsAdmin] = useState<boolean>(!!person?.isAdmin);
  const [hourlyCost, setHourlyCost] = useState(person?.hourlyCostEuros != null ? String(person.hourlyCostEuros) : "");
  const [breakMinutes, setBreakMinutes] = useState(person?.breakMinutesPerDay != null ? String(person.breakMinutesPerDay) : "");
  const [contactEmail, setContactEmail] = useState(person?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(person?.contactPhone ?? "");
  const [contractType, setContractType] = useState<NonNullable<Person["contractType"]> | "">(person?.contractType ?? "");
  const [saving, setSaving] = useState(false);

  // Derived preview of the window duration — keeps the user honest
  // when the end time lands before the start. Shows the hours the
  // scheduler will actually credit this person with.
  const windowHours = (() => {
    if (!startTime || !endTime) return null;
    const s = hhmmToMinutes(startTime);
    const e = hhmmToMinutes(endTime);
    if (s == null || e == null || e <= s) return null;
    return (e - s) / 60;
  })();

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
        startTimeOfDay: startTime || undefined,
        endTimeOfDay: endTime || undefined,
        workingDays: workingDays.size > 0 ? sortWeekdays([...workingDays]) : undefined,
        skills: skills.size > 0 ? [...skills].sort() : undefined,
        primaryRole: primaryRole || undefined,
        isAdmin,
        hourlyCostEuros: parsePositiveNum(hourlyCost) ?? null,
        breakMinutesPerDay: parsePositiveNum(breakMinutes) ?? null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        contractType: contractType || null,
        archived: person?.archived,
      });
      if (isNew) {
        setName("");
        setRoles([]);
        setDefaultHours("");
        setStartTime("");
        setEndTime("");
        setWorkingDays(new Set());
        setSkills(new Set());
        setPrimaryRole("");
        setIsAdmin(false);
        setHourlyCost("");
        setBreakMinutes("");
        setContactEmail("");
        setContactPhone("");
        setContractType("");
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function toggleSkill(skill: string) {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  const availableRoleSuggestions = knownRoles.filter(
    (r) => !roles.some((existing) => existing.toLowerCase() === r.toLowerCase()),
  );

  return (
    <div className={`rounded-[4px] ${isNew ? "border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4" : ""} space-y-3`}>
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
              <span key={r} className="inline-flex items-center gap-1 rounded-[4px] bg-[color:var(--ds-tint-info)] text-primary text-xs font-medium px-2 py-0.5">
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
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-3 py-1.5 text-sm disabled:opacity-50"
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
        <label className="label">Working hours</label>
        <div className="flex items-center gap-2">
          <input
            type="time"
            min="07:00"
            max="23:00"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="input w-32"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="time"
            min="07:00"
            max="23:00"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="input w-32"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {windowHours != null
            ? `${windowHours.toFixed(windowHours % 1 ? 1 : 0)}h/day — the scheduler uses this window.`
            : "Leave blank to fall back to the legacy hours/day field."}
        </p>
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
          Fallback for when no start/end times are set above.
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
                className={`rounded-[4px] border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-[color:var(--ds-card-bg)] text-muted-foreground border-[color:var(--ds-border-warm)] hover:bg-muted"
                }`}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="label">Break / lunch</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="240"
            step="5"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            placeholder="e.g. 30"
            className="input w-24"
          />
          <span className="text-xs text-muted-foreground">minutes/day (subtracted from capacity)</span>
        </div>
      </div>

      <div>
        <label className="label">Skills</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {Array.from(new Set([...DEFAULT_SKILLS, ...(person?.skills ?? [])])).sort().map((skill) => {
            const active = skills.has(skill);
            return (
              <button
                key={skill}
                type="button"
                onClick={() => toggleSkill(skill)}
                className={`rounded-[4px] border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-[color:var(--ds-card-bg)] text-muted-foreground border-[color:var(--ds-border-warm)] hover:bg-muted"
                }`}
              >
                {skill}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Scheduler only assigns a step to people who have the relevant skill.
        </p>
      </div>

      <div>
        <label className="label">Primary role</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {PRIMARY_ROLES.map((pr) => {
            const active = primaryRole === pr;
            return (
              <button
                key={pr}
                type="button"
                onClick={() => setPrimaryRole(active ? "" : pr)}
                className={`rounded-[4px] border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-[color:var(--ds-card-bg)] text-muted-foreground border-[color:var(--ds-border-warm)] hover:bg-muted"
                }`}
              >
                {PRIMARY_ROLE_LABELS[pr]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Where this person mostly works. Shop-only hours are excluded from production capacity.
        </p>
      </div>

      <div>
        <label className="label">Labour cost</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">€</span>
          <input
            type="number"
            min="0"
            max="200"
            step="0.5"
            value={hourlyCost}
            onChange={(e) => setHourlyCost(e.target.value)}
            placeholder="e.g. 18"
            className="input w-28"
          />
          <span className="text-xs text-muted-foreground">per hour · leave blank if this person isn&apos;t costed</span>
        </div>
      </div>

      <div>
        <label className="label">Contract</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {(["full_time", "part_time", "contractor"] as const).map((c) => {
            const active = contractType === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setContractType(active ? "" : c)}
                className={`rounded-[4px] border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-[color:var(--ds-card-bg)] text-muted-foreground border-[color:var(--ds-border-warm)] hover:bg-muted"
                }`}
              >
                {CONTRACT_TYPE_LABELS[c]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="optional"
            className="input"
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="optional"
            className="input"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
          className="w-4 h-4 rounded-[4px] border-[color:var(--ds-border-warm)]"
        />
        <span>Admin — unlocks analytics, full cost breakdown, HACCP incident writes</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add person" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Field list a person needs for the scheduler / capacity maths to
 *  work correctly. Archived people are exempt (they don't contribute
 *  to plans anyway). */
function missingPersonFields(person: Person): string[] {
  const miss: string[] = [];
  const hasWindow = !!person.startTimeOfDay && !!person.endTimeOfDay;
  const hasFallback = person.defaultHoursPerDay != null && person.defaultHoursPerDay > 0;
  if (!hasWindow && !hasFallback) miss.push("working hours");
  if (!person.workingDays || person.workingDays.length === 0) miss.push("working days");
  if (!person.primaryRole) miss.push("primary role");
  if (!person.skills || person.skills.length === 0) miss.push("skills");
  return miss;
}

// Strip optional seconds ("07:00:00" → "07:00") so <input type="time">
// accepts the stored value without the browser rejecting it.
function normaliseTimeInput(t: string | undefined): string {
  if (!t) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function hhmmToMinutes(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function PersonUnavailabilityEditor({ personId, unavailability }: {
  personId: string;
  unavailability: PersonUnavailability[];
}) {
  const [adding, setAdding] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [absenceType, setAbsenceType] = useState<AbsenceType | "">("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!startDate && !!endDate && endDate >= startDate && !saving;

  async function handleAdd() {
    setSaving(true);
    try {
      await savePersonUnavailability({
        personId,
        startDate,
        endDate,
        absenceType: absenceType || null,
        notes: notes.trim() || undefined,
      });
      setAdding(false);
      setStartDate("");
      setEndDate("");
      setAbsenceType("");
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
        <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] bg-muted p-3 space-y-2">
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
            <label className="label">Reason</label>
            <div className="flex flex-wrap gap-1.5">
              {ABSENCE_TYPES.map((t) => {
                const active = absenceType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAbsenceType(active ? "" : t)}
                    className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-[color:var(--ds-card-bg)] text-muted-foreground border-[color:var(--ds-border-warm)] hover:bg-muted"
                    }`}
                  >
                    {ABSENCE_TYPE_LABELS[t]}
                  </button>
                );
              })}
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
              className="rounded-[4px] bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAdding(false); setStartDate(""); setEndDate(""); setAbsenceType(""); setNotes(""); }}
              className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-3 py-1 text-xs"
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
    <li className="flex items-center gap-2 text-xs px-2 py-1 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
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
          <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-status-warn shrink-0 mt-0.5" />
            <p className="text-xs text-status-warn">
              Add at least one piece of equipment so the scheduler has something to assign work to.
            </p>
          </div>
        ) : readiness.isComplete ? (
          <div className="flex items-start gap-2 rounded-[6px] bg-status-ok-bg border border-status-ok-edge px-3 py-2">
            <CheckCircle className="w-4 h-4 text-status-ok shrink-0 mt-0.5" />
            <p className="text-xs text-status-ok">
              All equipment has quantity + throughput set — the scheduler can use it.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-[6px] bg-status-warn-bg border border-status-warn-edge px-3 py-2">
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
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
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
    "text-muted-foreground bg-muted border-[color:var(--ds-border-warm)]";

  return (
    <li className={`rounded-[4px] border bg-[color:var(--ds-card-bg)] overflow-hidden ${eq.archived ? "opacity-70 border-[color:var(--ds-border-warm)]" : "border-[color:var(--ds-border-warm)]"}`}>
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
        <span className={`shrink-0 rounded-[4px] border text-[10px] font-medium px-2 py-0.5 ${availColor}`}>
          {EQUIPMENT_AVAILABILITY_LABEL[avail]}
        </span>
      </div>

      {expanded && (
        <div className="border-t border-[color:var(--ds-border-warm)] px-3 py-3 space-y-3">
          <EquipmentEditor equipment={eq} onSaved={() => { /* stays expanded */ }} />

          <div className="border-t border-[color:var(--ds-border-warm)] pt-3 flex items-center gap-4">
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
  const allEquipment = useEquipment(true);
  const knownManufacturers = useMemo(() => {
    const s = new Set<string>();
    for (const e of allEquipment) if (e.manufacturer) s.add(e.manufacturer.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [allEquipment]);
  const knownModels = useMemo(() => {
    const s = new Set<string>();
    for (const e of allEquipment) if (e.model) s.add(e.model.trim());
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [allEquipment]);
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
    <div className={`space-y-3 ${isNew ? "rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4" : ""}`}>
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
            list="known-manufacturers"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="e.g. Selmi"
            className="input"
          />
          <datalist id="known-manufacturers">
            {knownManufacturers.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
        <div>
          <label className="label">Model (optional)</label>
          <input
            type="text"
            list="known-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Top EX"
            className="input"
          />
          <datalist id="known-models">
            {knownModels.map((m) => <option key={m} value={m} />)}
          </datalist>
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
      <div className="rounded-[6px] bg-muted border border-[color:var(--ds-border-warm)] p-3 space-y-2">
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
          className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add equipment" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
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
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [copyBusy, setCopyBusy] = useState(false);

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

  // Product types that already have at least one step — valid copy sources.
  const typesWithSteps = useMemo(() => {
    const set = new Set<string>();
    for (const s of steps) if (s.productType !== selectedType) set.add(s.productType);
    return [...set].sort();
  }, [steps, selectedType]);

  async function handleCopyFrom() {
    if (!copyFrom || !selectedType) return;
    const source = steps
      .filter((s) => s.productType === copyFrom)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (source.length === 0) return;
    const targetBase = stepsForType.length;
    setCopyBusy(true);
    try {
      // Save sequentially so sortOrder stays stable even if the server
      // reorders on write. Each copy lands at the end of the target list.
      for (let i = 0; i < source.length; i++) {
        const src = source[i];
        await saveProductionStep({
          productType: selectedType,
          name: src.name,
          activeMinutes: src.activeMinutes,
          waitingMinutes: src.waitingMinutes,
          isPackingStep: src.isPackingStep,
          perBatch: src.perBatch,
          sortOrder: targetBase + i,
        });
      }
      setCopyFrom("");
    } finally {
      setCopyBusy(false);
    }
  }

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
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
          No product categories yet. Add one under Products → Categories first.
        </p>
      ) : (
        <>
          <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
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
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-muted-foreground">
                  {stepsForType.length} step{stepsForType.length !== 1 ? "s" : ""} for <strong>{selectedType}</strong>
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  {typesWithSteps.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] text-muted-foreground">Copy all from</label>
                      <select
                        value={copyFrom}
                        onChange={(e) => setCopyFrom(e.target.value)}
                        disabled={copyBusy}
                        className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <option value="">choose type…</option>
                        {typesWithSteps.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleCopyFrom}
                        disabled={!copyFrom || copyBusy}
                        className="flex items-center gap-1 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-2 py-1 text-xs hover:border-foreground/30 disabled:opacity-50"
                        title="Append every step from the chosen type into this one. You can then edit times here without touching the source."
                      >
                        <Copy className="w-3 h-3" /> {copyBusy ? "Copying…" : "Copy"}
                      </button>
                    </div>
                  )}
                  {!adding && (
                    <button
                      onClick={() => setAdding(true)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add step
                    </button>
                  )}
                </div>
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
                <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
                  No steps yet for {selectedType}. Click Add step to start.
                </p>
              ) : (
                <SortableStepList
                  steps={stepsForType}
                  knownStepNames={knownStepNames}
                  productType={selectedType}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Drag-and-drop wrapper around the per-type step list. Uses dnd-kit
 *  (already in the repo for the planner). Persists the new order via
 *  `reorderProductionSteps` which rewrites sortOrder per step. */
function SortableStepList({
  steps, knownStepNames, productType,
}: {
  steps: ProductionStep[];
  knownStepNames: string[];
  productType: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const ids = steps.map((s) => s.id!);

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(steps, oldIdx, newIdx);
    await reorderProductionSteps(productType, next.map((s) => s.id!));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {steps.map((step, i) => (
            <ProductionStepRow
              key={step.id}
              step={step}
              knownStepNames={knownStepNames}
              index={i}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ProductionStepRow({ step, knownStepNames, index }: {
  step: ProductionStep;
  knownStepNames: string[];
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingRemove, setPendingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id!,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  async function handleDelete() {
    if (!step.id) return;
    setBusy(true);
    try { await deleteProductionStep(step.id); }
    finally { setBusy(false); setPendingRemove(false); }
  }

  async function handleDuplicate() {
    if (!step.id) return;
    setBusy(true);
    try {
      // Copy every field except the row identity + sort order. Append
      // with a fresh sortOrder at the end of the list — user can drag
      // it into place after.
      await saveProductionStep({
        productType: step.productType,
        name: `${step.name} copy`,
        activeMinutes: step.activeMinutes,
        waitingMinutes: step.waitingMinutes,
        isPackingStep: step.isPackingStep,
        perBatch: step.perBatch,
        sortOrder: step.sortOrder + 0.5, // reorderProductionSteps will renumber integers
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li ref={setNodeRef} style={style} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          type="button"
        >
          <GripVertical className="w-4 h-4" />
        </button>
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
              {step.isPackingStep && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-primary bg-[color:var(--ds-tint-info)] rounded px-1.5 py-0.5 align-middle">
                  Packing
                </span>
              )}
              {step.perBatch && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5 align-middle">
                  Fixed total
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
        <div className="border-t border-[color:var(--ds-border-warm)] px-3 py-3 space-y-3">
          <ProductionStepEditor
            step={step}
            productType={step.productType}
            knownStepNames={knownStepNames}
            onSaved={() => { /* stays expanded */ }}
          />
          <div className="border-t border-[color:var(--ds-border-warm)] pt-3 flex items-center gap-4">
            <button
              onClick={handleDuplicate}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Create a copy of this step — same times, name suffixed with 'copy'"
            >
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </button>
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
  const [isPackingStep, setIsPackingStep] = useState(!!step?.isPackingStep);
  const [perBatch, setPerBatch] = useState(!!step?.perBatch);
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
        isPackingStep,
        perBatch,
      });
      if (isNew) {
        setName("");
        setActiveMinutes("");
        setWaitingMinutes("");
        setIsPackingStep(false);
        setPerBatch(false);
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
    <div className={`space-y-3 ${isNew ? "rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4" : ""}`}>
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
          <label className="label">
            Active time ({perBatch ? "min / batch" : "min / mould"})
          </label>
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
            {perBatch
              ? "Fixed total for one batch. The scheduler uses this as-is, ignoring how many moulds the wave needs."
              : "Hands-on time per mould. Scheduler multiplies by the number of moulds in the wave."}
          </p>
          {(() => {
            const v = parseFloat(activeMinutes);
            if (!Number.isFinite(v) || v <= 240 || perBatch) return null;
            // Per-mould only — a fixed-total step legitimately runs hours.
            return (
              <p className="text-xs text-status-warn mt-1">
                ⚠ {v} min per mould is unusually high. If this is the
                total for a whole batch, tick &ldquo;Fixed total (not
                per mould)&rdquo; below — otherwise the scheduler
                multiplies by every mould in the wave.
              </p>
            );
          })()}
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
            Per batch — always flat, never multiplied by mould count.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={perBatch}
          onChange={(e) => setPerBatch(e.target.checked)}
          className="w-4 h-4 mt-0.5"
        />
        <span>
          <span className="font-medium">Fixed total (not per mould)</span>
          <span className="block text-xs text-muted-foreground">
            Tick for steps like Cooking or Tempering where time doesn&rsquo;t
            grow with more moulds. Leave unticked for hands-on steps like
            Painting or Shelling.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isPackingStep}
          onChange={(e) => setIsPackingStep(e.target.checked)}
          className="w-4 h-4 mt-0.5"
        />
        <span>
          <span className="font-medium">Packing step</span>
          <span className="block text-xs text-muted-foreground">
            Order-specific packing (load gift box, tie ribbon, apply label).
            When a line is borrowed from Store stock, only these steps are
            scheduled — Store pralines are already polished / painted /
            decorated; the full production cycle runs on the replenishment
            order instead.
          </span>
        </span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || activeMinutes === "" || waitingMinutes === ""}
          className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Add step" : "Save changes"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
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
              className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAdding(false); setName(""); setStartDate(""); setEndDate(""); }}
              className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {blocked.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
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
    <li className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] flex items-center gap-3 px-3 py-2.5">
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

function parseBufferDays(s: string): number | undefined {
  const n = parseInt(s, 10);
  if (isNaN(n) || n < 0 || n > 14) return undefined;
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
            className="flex items-center gap-1.5 rounded-[4px] border border-[color:var(--ds-border-warm)] px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>

        {/* Key-value card */}
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] divide-y divide-border">
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-3">
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <label className="block text-sm font-medium">Display currency</label>
          <select
            value={draftCurrency}
            onChange={(e) => setDraftCurrency(e.target.value as CurrencyCode)}
            className="w-full rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2 text-sm"
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <label className="block text-sm font-medium">Target market</label>
          <select
            value={draftRegion}
            onChange={(e) => setDraftRegion(e.target.value as MarketRegion)}
            className="w-full rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2 text-sm"
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <label className="block text-sm font-medium">Default fill mode</label>
          <select
            value={draftFillMode}
            onChange={(e) => setDraftFillMode(e.target.value as FillMode)}
            className="w-full rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2 text-sm"
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
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-1">
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
          className="flex-1 rounded-[4px] bg-primary text-primary-foreground py-2 text-sm font-medium"
        >
          Save
        </button>
        <button
          onClick={handleCancel}
          className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
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

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
        <SpreadsheetImport
          config={ingredientImportConfig}
          getExistingKeys={getExistingIngredientKeys}
          previewColumns={INGREDIENT_PREVIEW_COLUMNS}
          description="Composition, allergens, nutrition, pricing, sub-ingredient breakdown."
        />
      </section>

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
        <SpreadsheetImport
          config={mouldImportConfig}
          getExistingKeys={getExistingMouldKeys}
          previewColumns={MOULD_PREVIEW_COLUMNS}
          description="Cavity weight, cavity count, filling weight per cavity, ownership."
        />
      </section>

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
        <SpreadsheetImport
          config={packagingImportConfig}
          getExistingKeys={getExistingPackagingKeys}
          previewColumns={PACKAGING_PREVIEW_COLUMNS}
          description="Boxes, trays, or other packaging units with their capacity."
        />
      </section>

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
        <SpreadsheetImport
          config={decorationImportConfig}
          getExistingKeys={getExistingDecorationKeys}
          previewColumns={DECORATION_PREVIEW_COLUMNS}
          description="Cocoa butters, lustre dusts, transfer sheets, and other decoration materials."
        />
      </section>

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
        <SpreadsheetImport
          config={fillingImportConfig}
          getExistingKeys={getExistingFillingKeys}
          previewColumns={FILLING_PREVIEW_COLUMNS}
          description={`Filling recipes with their ingredient lists. Ingredient names must match existing ingredients — syntax per cell: "Sugar:100g | Cream 35%:200ml".`}
        />
      </section>

      <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
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
