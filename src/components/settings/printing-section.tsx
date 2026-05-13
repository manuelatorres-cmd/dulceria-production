"use client";

import { useState } from "react";
import { IconPrinter as Printer } from "@tabler/icons-react";

export function PrintingSection() {
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
              Shows a &quot;Save labels&quot; button on completed production batches. Generates one PNG
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
