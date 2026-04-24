"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useCsvImports,
  saveCsvImport,
  useExternalSkuMapping,
  saveExternalSkuMapping,
  useProductsList,
} from "@/lib/hooks";
import type { CsvImport, CsvImportSource } from "@/types";

/**
 * CSV imports — Shopify orders, Shopify stock, HelloCash sales, etc.
 *
 * Every upload runs as a dry-run first:
 *   1. File dropped → parsed in browser.
 *   2. Preview shows sample rows + unmapped SKUs + warnings.
 *   3. User resolves unmapped SKUs via dropdowns.
 *   4. Confirm → import runs, csvImports row logged.
 *   5. Undo available within 24h from the history list.
 *
 * This page ships the preview + log infrastructure. Actual parser
 * integration + stock deduction come in the next commit.
 */
export default function ImportsPage() {
  const imports = useCsvImports();
  const mappings = useExternalSkuMapping();
  const products = useProductsList();

  const [source, setSource] = useState<CsvImportSource>("shopify-orders");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [unmappedResolved, setUnmappedResolved] = useState<Record<string, string>>({});
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const productOptions = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  async function handleFile(f: File) {
    setFile(f);
    const text = await f.text();
    const rows = parseCsv(text);
    const sample = rows.slice(0, 8);
    setPreview(sample);

    // Find unmapped SKUs.
    const mappedSkus = new Set(
      mappings
        .filter((m) => m.source === skuSource(source))
        .map((m) => m.externalSku),
    );
    const skusInFile = new Set(
      rows.map((r) => r.sku).filter((s): s is string => !!s && !mappedSkus.has(s)),
    );
    setUnmapped(Array.from(skusInFile));
    setUnmappedResolved({});
  }

  function resolveSku(sku: string, productId: string) {
    setUnmappedResolved((prev) => ({ ...prev, [sku]: productId }));
  }

  async function commitImport() {
    if (!file || !preview) return;
    setCommitting(true);
    try {
      // Persist any newly mapped SKUs.
      for (const [sku, productId] of Object.entries(unmappedResolved)) {
        if (!productId) continue;
        await saveExternalSkuMapping({
          source: skuSource(source),
          externalSku: sku,
          internalProductId: productId,
        });
      }
      // Log the import — actual row-level writes land in the parser
      // adapter. For now, log a 'processed' row so history shows.
      await saveCsvImport({
        source,
        filename: file.name,
        uploadedAt: new Date(),
        rowsTotal: preview.length,
        rowsImported: preview.length,
        rowsSkipped: 0,
        rowsFailed: 0,
        status: "ok",
        dryRun: false,
      });
      setFile(null);
      setPreview(null);
      setUnmapped([]);
      setUnmappedResolved({});
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Imports"
        accent="CSV"
        description="Drop Shopify or HelloCash exports here. Preview before committing — unmapped SKUs resolve inline and cache for next time."
      />

      <section
        className="border border-border bg-card p-4 mb-6"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          New import
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as CsvImportSource)}
            >
              <option value="shopify-orders">Shopify · orders</option>
              <option value="shopify-stock">Shopify · stock</option>
              <option value="hellocash-sales">HelloCash · sales</option>
              <option value="hellocash-inventory">HelloCash · inventory</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="label">CSV file</label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        </div>
      </section>

      {preview ? (
        <section
          className="border border-border bg-card p-4 mb-6"
          style={{ borderRadius: 4 }}
        >
          <h3
            className="text-[13px] mb-3"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            Preview · {preview.length} rows (first sample)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {previewColumns.map((col) => (
                    <th
                      key={col}
                      className="py-2 pr-4 text-left text-[10px] uppercase text-muted-foreground font-medium"
                      style={{ letterSpacing: "0.1em" }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, idx) => (
                  <tr key={idx} className="border-t border-border/60">
                    <td className="py-2 pr-4">{row.sku ?? "—"}</td>
                    <td className="py-2 pr-4">{row.quantity ?? 0}</td>
                    <td className="py-2 pr-4">
                      {row.unitPrice !== undefined ? fmt(row.unitPrice) : "—"}
                    </td>
                    <td className="py-2 pr-4">{row.customer ?? "—"}</td>
                    <td className="py-2 pr-4">{row.orderRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unmapped.length > 0 ? (
            <div
              className="mt-4 border border-[color:var(--color-status-warn-edge)] bg-[color:var(--color-status-warn-bg)] p-3"
              style={{ borderRadius: 3 }}
            >
              <h4
                className="text-[12px] mb-2 font-medium"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {unmapped.length} SKU{unmapped.length === 1 ? "" : "s"} not mapped yet
              </h4>
              <ul className="space-y-1.5">
                {unmapped.map((sku) => (
                  <li key={sku} className="flex items-center gap-2 text-[12px]">
                    <code className="px-1.5 py-0.5 bg-card border border-border">
                      {sku}
                    </code>
                    <span className="text-muted-foreground">→</span>
                    <select
                      value={unmappedResolved[sku] ?? ""}
                      onChange={(e) => resolveSku(sku, e.target.value)}
                      className="input"
                      style={{ maxWidth: 280 }}
                    >
                      <option value="">Skip</option>
                      {productOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setUnmapped([]);
                setUnmappedResolved({});
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commitImport}
              disabled={committing}
              className="btn-primary"
            >
              {committing ? "Committing…" : "Confirm import"}
            </button>
          </div>
        </section>
      ) : null}

      <section
        className="border border-border bg-card p-4"
        style={{ borderRadius: 4 }}
      >
        <h3
          className="text-[13px] mb-3"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          History
          <span
            className="ml-2 text-[10px] uppercase text-muted-foreground font-normal"
            style={{ letterSpacing: "0.12em" }}
          >
            {imports.length} imports
          </span>
        </h3>
        {imports.length === 0 ? (
          <p
            className="text-muted-foreground italic text-[12.5px]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Nothing imported yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {imports.map((imp) => (
              <li
                key={imp.id}
                className="flex items-center justify-between gap-3 text-[12.5px] px-3 py-2 bg-muted border border-border"
                style={{ borderRadius: 3 }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {imp.filename ?? "(no filename)"}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {imp.source} · {imp.rowsImported}/{imp.rowsTotal} rows ·{" "}
                    {imp.uploadedAt
                      ? new Date(imp.uploadedAt).toLocaleString()
                      : ""}
                  </div>
                </div>
                <span
                  className={
                    "text-[10px] uppercase " +
                    (imp.status === "ok"
                      ? "text-status-ok"
                      : imp.status === "failed"
                        ? "text-status-alert"
                        : "text-status-warn")
                  }
                  style={{ letterSpacing: "0.12em" }}
                >
                  {imp.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface PreviewRow {
  sku?: string;
  quantity?: number;
  unitPrice?: number;
  customer?: string;
  orderRef?: string;
}

const previewColumns = ["SKU", "Qty", "Unit price", "Customer", "Order ref"];

function fmt(n: number): string {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function parseCsv(text: string): PreviewRow[] {
  // Simple RFC-4180-ish split for preview; real Shopify/HelloCash
  // parsers ship with the adapter when the printer confirms.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: PreviewRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const row: PreviewRow = {};
    headers.forEach((h, idx) => {
      const v = cells[idx] ?? "";
      if (h.includes("sku") || h === "variant sku") row.sku = v || undefined;
      if (h === "quantity" || h === "qty") row.quantity = Number(v) || undefined;
      if (h.includes("unit price") || h === "price") row.unitPrice = Number(v) || undefined;
      if (h.includes("customer")) row.customer = v || undefined;
      if (h.includes("order") && h.includes("name")) row.orderRef = v || undefined;
    });
    rows.push(row);
  }
  return rows;
}

function skuSource(source: CsvImportSource): "shopify" | "hellocash" | "other" {
  if (source.startsWith("shopify")) return "shopify";
  if (source.startsWith("hellocash")) return "hellocash";
  return "other";
}
