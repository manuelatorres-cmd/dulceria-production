"use client";

import { useState } from "react";
import { loadDemoData, isDemoDataLoaded } from "@/lib/seed-demo";
import { clearAllData } from "@/lib/backup";
import { IconVideo as Video, IconFlask as FlaskConical, IconCircleCheck as CheckCircle, IconAlertTriangle as AlertTriangle, IconTrash as Trash2 } from "@tabler/icons-react";

export function DemoSection() {
  return (
    <div className="space-y-6">
      <DemoModeSubSection />
      <DemoDataSubSection />
      <ClearAllDataSubSection />
    </div>
  );
}

function DemoModeSubSection() {
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

function DemoDataSubSection() {
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

function ClearAllDataSubSection() {
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
