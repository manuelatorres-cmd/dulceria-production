"use client";

import {
  PageHeader,
  HubCard,
  Section,
} from "@/components/dulceria";

/**
 * Settings hub landing. Was a 3274-line monolith with all 8 tabs in
 * one file; now a wayfinding hub with one HubCard per subroute. The
 * tab bodies live in per-section files (backup-section.tsx, etc.) and are
 * rendered by each /settings/<tab>/page.tsx subroute.
 */
export default function SettingsHubPage() {
  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Settings"
        meta="Configure capacity, equipment, market preferences, imports, and backups"
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Section title="Operations">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard
              href="/settings/capacity"
              icon="Users"
              title="Capacity & People"
              description="Staff, shifts, daily capacity, blocked days"
            />
            <HubCard
              href="/settings/steps"
              icon="ListNumbers"
              title="Production steps"
              description="Step definitions, dependencies, per-category overrides"
            />
            <HubCard
              href="/settings/equipment"
              icon="Tool"
              title="Equipment"
              description="Tempering machines, melting pots, mould pool"
            />
            <HubCard
              href="/settings/skills"
              icon="Award"
              title="Skills"
              description="Person × skill matrix + admin flag"
            />
            <HubCard
              href="/settings/setup"
              icon="ChecklistRtl"
              title="Setup checklist"
              description="Data-health dashboard: minimums, tiers, missing fields"
            />
          </div>
        </Section>

        <Section title="Preferences">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard
              href="/settings/market"
              icon="World"
              title="Target market"
              description="Region, currency, fill mode, allergen labelling rules"
            />
            <HubCard
              href="/settings/printing"
              icon="Printer"
              title="Printing"
              description="Label printer toggle (Niimbot)"
            />
          </div>
        </Section>

        <Section title="Data">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard
              href="/settings/import"
              icon="FileUpload"
              title="Import"
              description="Spreadsheet imports for ingredients, moulds, packaging, decorations, fillings, products"
            />
            <HubCard
              href="/settings/backup"
              icon="DeviceFloppy"
              title="Backup & restore"
              description="Export a JSON snapshot of all data"
            />
            <HubCard
              href="/settings/demo"
              icon="Flask"
              title="Demo mode"
              description="Load demo data, clear all data"
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
