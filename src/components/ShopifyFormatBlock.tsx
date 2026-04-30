"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { IngredientListEntry } from "@/lib/ingredientList";
import type { NutritionData } from "@/lib/nutrition";
import {
  buildShopifyIngredientHtml,
  buildShopifyIngredientText,
  buildShopifyNutritionLine,
} from "@/lib/shopifyLabel";

interface Props {
  entries: IngredientListEntry[];
  per100g: NutritionData | null | undefined;
}

/**
 * Two copy-ready strings for pasting into Shopify product fields:
 *   - "Zutaten: …" with allergens bolded (HTML on copy)
 *   - Tight nutrition metafield string (plain text)
 *
 * Hidden when there's no ingredient list AND no nutrition data.
 */
export function ShopifyFormatBlock({ entries, per100g }: Props) {
  const ingredientHtml = buildShopifyIngredientHtml(entries);
  const ingredientText = buildShopifyIngredientText(entries);
  const nutritionLine = per100g ? buildShopifyNutritionLine(per100g) : "";
  const hasNutrition = per100g
    ? Object.values(per100g).some((v) => typeof v === "number" && Number.isFinite(v))
    : false;

  if (!ingredientHtml && !hasNutrition) return null;

  return (
    <div className="mt-4 rounded-sm border border-dashed border-border bg-muted/20 p-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Shopify-Format
      </h3>
      {ingredientHtml && (
        <CopyRow
          label="Zutaten (HTML)"
          previewHtml={ingredientHtml}
          copyHtml={ingredientHtml}
          copyText={ingredientText}
        />
      )}
      {hasNutrition && (
        <CopyRow
          label="Nährwerte"
          previewText={nutritionLine}
          copyText={nutritionLine}
        />
      )}
    </div>
  );
}

interface CopyRowProps {
  label: string;
  previewHtml?: string;
  previewText?: string;
  copyHtml?: string;
  copyText: string;
}

function CopyRow({ label, previewHtml, previewText, copyHtml, copyText }: CopyRowProps) {
  const [copied, setCopied] = useState<"html" | "text" | null>(null);

  async function handleCopy(kind: "html" | "text") {
    if (kind === "html" && copyHtml && typeof window !== "undefined" && "ClipboardItem" in window) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([copyHtml], { type: "text/html" }),
            "text/plain": new Blob([copyText], { type: "text/plain" }),
          }),
        ]);
        setCopied("html");
        setTimeout(() => setCopied(null), 2000);
        return;
      } catch {
        // fall through to plain-text copy
      }
    }
    await navigator.clipboard.writeText(kind === "html" ? (copyHtml ?? copyText) : copyText);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <div className="flex items-center gap-1">
          {copyHtml && (
            <button
              type="button"
              onClick={() => handleCopy("html")}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
              title="Copy formatted (with bold allergens)"
            >
              {copied === "html" ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
              {copied === "html" ? "Kopiert" : "HTML"}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleCopy("text")}
            className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
            title="Copy plain text"
          >
            {copied === "text" ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
            {copied === "text" ? "Kopiert" : "Text"}
          </button>
        </div>
      </div>
      <div className="rounded-sm bg-card border border-border px-2 py-1.5 text-xs leading-relaxed font-mono break-words">
        {previewHtml ? (
          <span dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <span>{previewText}</span>
        )}
      </div>
    </div>
  );
}
