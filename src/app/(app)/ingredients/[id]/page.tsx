"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavigationGuard } from "@/lib/useNavigationGuard";
import { useIngredient, useIngredients, useIngredientUsage, saveIngredient, deleteIngredient, archiveIngredient, unarchiveIngredient, checkIngredientBeforeDelete, useIngredientPriceHistory, deleteIngredientPriceHistoryEntry, setIngredientLowStock, setIngredientOutOfStock, markIngredientOrdered, useCurrencySymbol, useIngredientStock, useIngredientStockMovements, receiveIngredientStock, adjustIngredientStock, setIngredientLowStockThreshold } from "@/lib/hooks";
import type { IngredientDeleteCheck } from "@/lib/hooks";
import { IngredientForm } from "@/components/ingredient-form";
import { COMPOSITION_FIELDS, allergenLabel, type Ingredient } from "@/types";
import { ArrowLeft, Pencil, Layers, Trash2, ChevronDown, X, AlertTriangle, Archive, ArchiveRestore } from "lucide-react";
import { UsedInPanel } from "@/components/pantry";
import { InlineNameEditor } from "@/components/inline-name-editor";
import { StockStatusPanel } from "@/components/stock-status-panel";
import { getNutrientsByMarket, getNutritionPanelTitle, hasNutritionData, formatNutrientValue, percentDailyValue, getMissingMandatoryNutrients, fillDerivedNutrition } from "@/lib/nutrition";
import { useMarketRegion } from "@/lib/hooks";
import Link from "next/link";


export default function IngredientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const ingredientId = decodeURIComponent(idStr);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  const sym = useCurrencySymbol();
  const ingredient = useIngredient(ingredientId);
  const allIngredients = useIngredients();
  const usage = useIngredientUsage(ingredientId);
  const priceHistory = useIngredientPriceHistory(ingredientId);
  const manufacturers = [...new Set(allIngredients.map((i) => i.manufacturer).filter(Boolean))];
  const ingredientBrands = [...new Set(allIngredients.map((i) => i.brand).filter(Boolean))] as string[];
  const ingredientVendors = [...new Set(allIngredients.map((i) => i.vendor).filter(Boolean))] as string[];
  const sources = [...new Set(allIngredients.map((i) => i.source).filter(Boolean))];
  const [priceHistoryExpanded, setPriceHistoryExpanded] = useState(false);
  const [pendingRemovePriceEntry, setPendingRemovePriceEntry] = useState<string | null>(null);

  const [editing, setEditing] = useState(isNew);
  const [formDirty, setFormDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCheck, setDeleteCheck] = useState<IngredientDeleteCheck | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "composition" | "ingredients" | "allergens" | "pricing" | "nutrition" | "shell" | "stock">("details");
  const market = useMarketRegion();

  const [savedOnce, setSavedOnce] = useState(false);
  const formIsDirty = editing && formDirty;
  const isDirty = (isNew && !savedOnce) || formIsDirty;
  const handleConfirmLeave = useCallback(async () => {
    if (isNew && ingredient?.id) {
      await deleteIngredient(ingredient.id);
    }
  }, [isNew, ingredient?.id]);
  const { safeBack } = useNavigationGuard(isDirty, isNew ? handleConfirmLeave : undefined);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(false);
      else if (editing) handleCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ingredient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  function handleSaved() {
    setSavedOnce(true);
    setEditing(false);
    setFormDirty(false);
    if (isNew) router.replace(`/ingredients/${encodeURIComponent(ingredientId)}`);
  }

  function handleCancel() {
    setEditing(false);
    setFormDirty(false);
    if (isNew) router.replace(`/ingredients/${encodeURIComponent(ingredientId)}`);
  }

  const tags = ingredient.allergens.filter(Boolean);

  const costPerGram =
    ingredient.purchaseCost != null &&
    ingredient.purchaseQty != null &&
    ingredient.gramsPerUnit != null &&
    ingredient.purchaseQty * ingredient.gramsPerUnit > 0
      ? ingredient.purchaseCost / (ingredient.purchaseQty * ingredient.gramsPerUnit)
      : null;

  return (
    <div>
      <div className="px-4 pt-6 pb-2">
        <button onClick={() => safeBack()} className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-3">
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="px-4 pb-4">
        {/* Name + edit button — always visible above tabs */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <InlineNameEditor
              name={ingredient.name}
              onSave={async (n) => { await saveIngredient({ ...ingredient, name: n }); }}
              className="text-xl font-bold"
            />
            {ingredient.archived && (
              <span className="rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-[10px] font-medium flex items-center gap-1 shrink-0">
                <Archive className="w-3 h-3" /> Archived
              </span>
            )}
          </div>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0"
              aria-label="Edit ingredient"
            >
              <Pencil className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {!editing && (
          <>
            {/* Subtitle — manufacturer, brand, vendor, source, category */}
            {(ingredient.manufacturer || ingredient.brand || ingredient.vendor || ingredient.source || ingredient.category) && (
              <div className="mb-3">
                {ingredient.manufacturer && (
                  <p className="text-sm text-muted-foreground mt-0.5">{ingredient.manufacturer}</p>
                )}
                {ingredient.brand && (
                  <p className="text-sm text-muted-foreground">{ingredient.brand}</p>
                )}
                {ingredient.vendor && (
                  <p className="text-sm text-muted-foreground">{ingredient.vendor}</p>
                )}
                {ingredient.source && (
                  <p className="text-sm text-muted-foreground">{ingredient.source}</p>
                )}
                {ingredient.category && (
                  <p className="text-sm text-primary mt-0.5">{ingredient.category}</p>
                )}
              </div>
            )}

            {/* Stock status */}
            <div className="mb-4">
              <StockStatusPanel
                lowStock={ingredient.lowStock}
                lowStockOrdered={ingredient.lowStockOrdered}
                outOfStock={ingredient.outOfStock}
                itemName={ingredient.name}
                onFlagLowStock={() => setIngredientLowStock(ingredientId, true)}
                onFlagOutOfStock={() => setIngredientOutOfStock(ingredientId, true)}
                onMarkOrdered={() => markIngredientOrdered(ingredientId)}
                onClearOutOfStock={() => setIngredientOutOfStock(ingredientId, false)}
                onClearLowStock={() => setIngredientLowStock(ingredientId, false)}
              />
            </div>
          </>
        )}
      </div>

      {/* Tab strip — always visible. The Shell tab shows whenever the
          ingredient is flagged shellCapable OR the user is actively editing
          (so they can reach the checkbox on a fresh row before saving).
          Previously gated on `category === "Chocolate"`, which hid the tab
          after reload for any ingredient whose category string didn't match
          that exact casing. */}
      <div className="flex border-b border-border mb-4 px-4 overflow-x-auto">
        {(
          (editing || ingredient.shellCapable)
            ? ["details", "shell", "composition", "ingredients", "allergens", "pricing", "nutrition", "stock"] as const
            : ["details", "composition", "ingredients", "allergens", "pricing", "nutrition", "stock"] as const
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors ${
              activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="px-4 pb-6">
        {editing ? (
          <IngredientForm
            ingredient={ingredient}
            manufacturers={manufacturers}
            brands={ingredientBrands}
            vendors={ingredientVendors}
            sources={sources}
            onSaved={handleSaved}
            onCancel={handleCancel}
            onDirtyChange={setFormDirty}
            activeSection={activeTab === "stock" ? "details" : activeTab}
          />
        ) : (
          <>
            {/* Details tab */}
            {activeTab === "details" && (
              <div>
                {ingredient.notes && (
                  <div className="mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground mb-1">Notes</h2>
                    <p className="text-sm whitespace-pre-wrap">{ingredient.notes}</p>
                  </div>
                )}

                <UsedInPanel
                  singular="filling"
                  plural="fillings"
                  items={usage.map(({ filling, products }) => ({
                    id: filling.id ?? "",
                    name: filling.name,
                    href: `/fillings/${encodeURIComponent(filling.id ?? "")}`,
                    icon: <Layers aria-hidden="true" className="w-4 h-4" />,
                    subItems: products.map((r) => r.name),
                  }))}
                  emptyMessage={!ingredient.notes ? "This ingredient hasn't been added to any fillings yet." : undefined}
                  className="mt-2"
                />
              </div>
            )}

            {/* Composition tab */}
            {activeTab === "composition" && (
              <div>
                {COMPOSITION_FIELDS.some((f) => (ingredient[f.key] ?? 0) > 0) ? (
                  <div className="rounded-lg border border-border bg-card divide-y divide-border">
                    {COMPOSITION_FIELDS.filter((f) => (ingredient[f.key] ?? 0) > 0).map((f) => (
                      <div key={f.key} className="flex justify-between px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{f.label}</span>
                        <span className="font-medium">{ingredient[f.key]}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">No composition data recorded. <button onClick={() => setEditing(true)} className="text-primary hover:underline">Edit ingredient</button> to add it.</p>
                )}
              </div>
            )}

            {/* Sub-ingredients tab */}
            {activeTab === "ingredients" && (
              <div>
                {ingredient.subIngredients && ingredient.subIngredients.length > 0 ? (
                  <div className="rounded-lg border border-border bg-card divide-y divide-border">
                    {ingredient.subIngredients.map((s, i) => (
                      <div key={i} className="px-3 py-2 text-sm text-foreground">
                        {s.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">
                    No sub-ingredients recorded.{" "}
                    <button onClick={() => setEditing(true)} className="text-primary hover:underline">Edit ingredient</button>{" "}
                    to add a breakdown (used for ingredient-list text on fillings, products, and collections).
                  </p>
                )}
              </div>
            )}

            {/* Allergens tab */}
            {activeTab === "allergens" && (
              <div>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-status-warn-bg text-status-warn border border-status-warn-edge px-3 py-1 text-sm font-bold"
                      >
                        {allergenLabel(a)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">No allergens declared. <button onClick={() => setEditing(true)} className="text-primary hover:underline">Edit ingredient</button> to add them.</p>
                )}
              </div>
            )}

            {/* Pricing tab */}
            {activeTab === "pricing" && (
              <div>
                {ingredient.purchaseCost != null ? (
                  <div className="mb-4">
                    <div className="rounded-lg border border-border bg-card px-3 py-2 space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Purchase cost</span>
                        <span className="font-medium">{sym}{ingredient.purchaseCost}</span>
                      </div>
                      {ingredient.purchaseQty != null && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Quantity</span>
                          <span>{ingredient.purchaseQty} {ingredient.purchaseUnit}</span>
                        </div>
                      )}
                      {costPerGram !== null && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Cost per gram</span>
                          <span className="font-medium text-primary">
                            {sym}{costPerGram < 0.01 ? costPerGram.toFixed(4) : costPerGram.toFixed(3)}/g
                          </span>
                        </div>
                      )}
                      {ingredient.purchaseDate && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Updated</span>
                          <span>
                            {new Intl.DateTimeFormat(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }).format(new Date(ingredient.purchaseDate))}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4 py-4">No pricing data recorded. <button onClick={() => setEditing(true)} className="text-primary hover:underline">Edit ingredient</button> to add it.</p>
                )}

                {priceHistory.length > 0 && (
                  <div>
                    <button
                      onClick={() => setPriceHistoryExpanded((v) => !v)}
                      className="flex items-center gap-2 w-full text-left mb-2"
                    >
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${priceHistoryExpanded ? "" : "-rotate-90"}`} />
                      <h2 className="text-sm font-medium text-muted-foreground">Price history</h2>
                      <span className="text-xs text-muted-foreground">({priceHistory.length})</span>
                    </button>
                    {priceHistoryExpanded && (
                      <ul className="space-y-1 ml-6">
                        {priceHistory.map((entry) => (
                          <li key={entry.id} className="rounded-md border border-border bg-card px-3 py-2">
                            <div className="flex justify-between items-baseline gap-2">
                              <span className="text-sm font-medium text-primary">
                                {sym}{entry.costPerGram < 0.01 ? entry.costPerGram.toFixed(4) : entry.costPerGram.toFixed(3)}/g
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {new Date(entry.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                                </span>
                                {pendingRemovePriceEntry === entry.id ? (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <span className="text-muted-foreground">Delete?</span>
                                    <button
                                      onClick={async () => { await deleteIngredientPriceHistoryEntry(entry.id!); setPendingRemovePriceEntry(null); }}
                                      className="text-red-600 font-medium hover:underline"
                                    >Yes</button>
                                    <button
                                      onClick={() => setPendingRemovePriceEntry(null)}
                                      className="text-muted-foreground hover:underline"
                                    >Cancel</button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setPendingRemovePriceEntry(entry.id!)}
                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                    aria-label="Delete price entry"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            {(entry.purchaseCost != null || entry.purchaseQty != null) && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {entry.purchaseCost != null && `${sym}${entry.purchaseCost}`}
                                {entry.purchaseQty != null && ` for ${entry.purchaseQty}${entry.purchaseUnit ?? ""}`}
                                {entry.gramsPerUnit != null && ` (${entry.gramsPerUnit}g/unit)`}
                              </p>
                            )}
                            {entry.note && (
                              <p className="text-xs text-muted-foreground italic mt-0.5">{entry.note}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Nutrition tab */}
            {activeTab === "nutrition" && (
              <IngredientNutritionReadView ingredient={ingredient} market={market} onEdit={() => setEditing(true)} />
            )}

            {/* Shell tab (Chocolate only) */}
            {activeTab === "shell" && (
              <ShellTabReadView
                ingredient={ingredient}
                onEdit={() => setEditing(true)}
              />
            )}

            {/* Stock tab — grams on hand, receive, history */}
            {activeTab === "stock" && (
              <IngredientStockPanel ingredientId={ingredientId} />
            )}

            <div className="mt-8 border-t border-border pt-4 space-y-4">
              {ingredient.archived && (
                <button
                  onClick={async () => { await unarchiveIngredient(ingredientId); }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArchiveRestore className="w-4 h-4" /> Unarchive ingredient
                </button>
              )}
              {confirmDelete && deleteCheck ? (
                <IngredientDeletePanel
                  check={deleteCheck}
                  onDelete={async () => { await deleteIngredient(ingredientId); router.replace("/ingredients"); }}
                  onArchive={async () => { await archiveIngredient(ingredientId); router.replace("/ingredients"); }}
                  onCancel={() => { setConfirmDelete(false); setDeleteCheck(null); }}
                />
              ) : (
                <button
                  onClick={async () => {
                    const check = await checkIngredientBeforeDelete(ingredientId);
                    setDeleteCheck(check);
                    setConfirmDelete(true);
                  }}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete ingredient
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ShellTabReadView({
  ingredient,
  onEdit,
}: {
  ingredient: Ingredient;
  onEdit: () => void;
}) {
  if (!ingredient.shellCapable) {
    return (
      <div>
        <p className="text-sm text-muted-foreground py-4">
          Not marked as shell chocolate.{" "}
          <button onClick={onEdit} className="text-primary hover:underline">Edit ingredient</button> to enable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-medium">
          Shell chocolate (couverture)
        </span>
      </div>
    </div>
  );
}

function IngredientDeletePanel({
  check,
  onDelete,
  onArchive,
  onCancel,
}: {
  check: IngredientDeleteCheck;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onCancel: () => void;
}) {
  const { activeFillings, produced } = check;
  const hasActiveFillings = activeFillings.length > 0;

  // Case 3: produced AND still in active fillings → blocked
  if (produced && hasActiveFillings) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-muted p-4 space-y-3">
        <p className="text-sm font-medium text-warning">Cannot remove this ingredient</p>
        <p className="text-xs text-muted-foreground">
          This ingredient has been used in production and is still part of {activeFillings.length === 1 ? "an active filling" : `${activeFillings.length} active fillings`}.
          Replace it in {activeFillings.length === 1 ? "this filling" : "these fillings"} first, then you can archive it.
        </p>
        <ul className="space-y-1">
          {activeFillings.map((l) => (
            <li key={l.id} className="text-xs font-medium flex items-center gap-1.5">
              <Link href={`/fillings/${encodeURIComponent(l.id ?? '')}`} className="text-primary underline underline-offset-2 hover:text-primary/80">
                {l.name}
              </Link>
            </li>
          ))}
        </ul>
        <button onClick={onCancel} className="btn-secondary px-4 py-2">
          OK
        </button>
      </div>
    );
  }

  // Case 4: produced but only in superseded fillings → safe to archive
  if (produced && !hasActiveFillings) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <p className="text-sm font-medium text-destructive">Archive this ingredient?</p>
        <p className="text-xs text-muted-foreground">
          This ingredient has been used in production batches. It will be archived — hidden from lists but preserved for history.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onArchive}
            className="inline-flex items-center justify-center rounded-full bg-warning text-warning-foreground px-4 py-2 text-sm font-medium transition-colors hover:bg-warning/90"
          >
            Archive ingredient
          </button>
          <button onClick={onCancel} className="btn-secondary px-4 py-2">Cancel</button>
        </div>
      </div>
    );
  }

  // Case 2: in active fillings but never produced → warn, allow delete
  if (hasActiveFillings) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <p className="text-sm font-medium text-destructive">Delete this ingredient?</p>
        <p className="text-xs text-muted-foreground">
          This ingredient is used in {activeFillings.length} filling{activeFillings.length !== 1 ? "s" : ""}. Deleting it will remove it from {activeFillings.length === 1 ? "that filling" : "those fillings"}. This cannot be undone.
        </p>
        <ul className="space-y-1">
          {activeFillings.map((l) => (
            <li key={l.id} className="text-xs font-medium flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-destructive shrink-0" />
              {l.name}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center rounded-full bg-destructive text-white px-4 py-2 text-sm font-medium transition-colors hover:bg-destructive/90"
          >
            Yes, delete ingredient
          </button>
          <button onClick={onCancel} className="btn-secondary px-4 py-2">Cancel</button>
        </div>
      </div>
    );
  }

  // Case 1: not in use anywhere → simple delete
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
      <p className="text-sm font-medium text-destructive">Delete this ingredient?</p>
      <p className="text-xs text-muted-foreground">This will permanently remove the ingredient from your library. This cannot be undone.</p>
      <div className="flex gap-2">
        <button
          onClick={onDelete}
          className="inline-flex items-center justify-center rounded-lg bg-destructive text-white px-4 py-2 text-sm font-medium transition-colors hover:bg-destructive/90"
        >
          Yes, delete ingredient
        </button>
        <button onClick={onCancel} className="btn-secondary px-4 py-2">Cancel</button>
      </div>
    </div>
  );
}

function IngredientNutritionReadView({ ingredient, market, onEdit }: { ingredient: Ingredient; market: import("@/types").MarketRegion; onEdit: () => void }) {
  const nutrients = getNutrientsByMarket(market);
  const panelTitle = getNutritionPanelTitle(market);
  const nutrition = ingredient.nutrition ? fillDerivedNutrition(ingredient.nutrition) : undefined;
  const hasData = hasNutritionData(nutrition);
  const missing = getMissingMandatoryNutrients(nutrition, market);
  const showDV = market === "US";

  if (!hasData) {
    return (
      <div>
        <p className="text-sm text-muted-foreground py-4">
          No nutrition data recorded.{" "}
          <button onClick={onEdit} className="text-primary hover:underline">Edit ingredient</button> to add it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground mb-2">{panelTitle}</h2>
      <p className="text-xs text-muted-foreground mb-3">Values per 100g</p>

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {nutrients.map((n) => {
          const val = nutrition?.[n.key];
          const dv = showDV ? percentDailyValue(val, n.dailyValue) : undefined;
          return (
            <div key={n.key} className="flex items-baseline justify-between px-3 py-2 text-sm">
              <span className={`text-muted-foreground ${n.indent === 1 ? "ml-4" : n.indent === 2 ? "ml-8" : ""}`}>
                {n.label}
              </span>
              <div className="flex items-baseline gap-3">
                <span className={`font-medium ${val == null ? "text-muted-foreground/50" : ""}`}>
                  {formatNutrientValue(val, n.unit)}
                </span>
                {dv != null && (
                  <span className="text-xs text-muted-foreground w-10 text-right">{dv}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {missing.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {missing.length} mandatory {missing.length === 1 ? "nutrient" : "nutrients"} missing for {market} labels:{" "}
            {missing.map(m => m.label).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

/** Format any thrown value into a human-readable string. Handles
 *  three shapes: Error instances (use .message), Supabase/PostgREST
 *  error objects (which have .message + .code + .details + .hint and
 *  aren't Error instances — rendering them directly gives
 *  "[object Object]"), and everything else. */
function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const core = o.message || o.details || "Operation failed";
    const code = o.code ? ` (code ${o.code})` : "";
    const hint = o.hint ? ` — ${o.hint}` : "";
    return `${core}${code}${hint}`;
  }
  return String(e);
}

// ── Ingredient Stock panel ────────────────────────────────────────
//
// Grams-on-hand view. Three things:
//   - current balance (big number, low-stock warning if below
//     threshold)
//   - Receive stock form ("I bought 5kg of nougat")
//   - Last 20 movements for audit
//
// Used by the Stock tab on /ingredients/[id].
function IngredientStockPanel({ ingredientId }: { ingredientId: string }) {
  const stock = useIngredientStock(ingredientId);
  const movements = useIngredientStockMovements(ingredientId, 20);
  const [receiveInput, setReceiveInput] = useState("");
  const [receiveNotes, setReceiveNotes] = useState("");
  const [adjustInput, setAdjustInput] = useState("");
  const [thresholdInput, setThresholdInput] = useState(
    stock?.lowStockThresholdG != null ? String(stock.lowStockThresholdG) : "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setThresholdInput(stock?.lowStockThresholdG != null ? String(stock.lowStockThresholdG) : "");
  }, [stock?.lowStockThresholdG]);

  const currentG = Number(stock?.quantityG ?? 0);
  const threshold = stock?.lowStockThresholdG != null ? Number(stock.lowStockThresholdG) : null;
  const belowThreshold = threshold != null && currentG < threshold;

  async function handleReceive() {
    const qty = parseFloat(receiveInput);
    if (!Number.isFinite(qty) || qty <= 0) { setErr("Enter a positive quantity in grams."); return; }
    setBusy(true); setErr("");
    try {
      await receiveIngredientStock(ingredientId, qty, receiveNotes.trim() || undefined);
      setReceiveInput(""); setReceiveNotes("");
    } catch (e) {
      setErr(formatError(e));
      console.error("Ingredient stock error:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjust(sign: 1 | -1) {
    const qty = parseFloat(adjustInput);
    if (!Number.isFinite(qty) || qty <= 0) { setErr("Enter a positive quantity in grams."); return; }
    setBusy(true); setErr("");
    try {
      await adjustIngredientStock({
        ingredientId,
        deltaG: sign * qty,
        reason: "recount",
        notes: sign < 0 ? "Manual recount (down)" : "Manual recount (up)",
      });
      setAdjustInput("");
    } catch (e) {
      setErr(formatError(e));
      console.error("Ingredient stock error:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleThreshold() {
    const trimmed = thresholdInput.trim();
    const val = trimmed === "" ? null : parseFloat(trimmed);
    if (val != null && (!Number.isFinite(val) || val < 0)) {
      setErr("Threshold must be 0 or a positive number of grams."); return;
    }
    setBusy(true); setErr("");
    try {
      await setIngredientLowStockThreshold(ingredientId, val);
    } catch (e) {
      setErr(formatError(e));
      console.error("Ingredient stock error:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Current balance */}
      <div className={`rounded-lg border p-4 ${belowThreshold ? "border-status-warn bg-status-warn-bg/30" : "border-border bg-card"}`}>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">On hand</p>
        <p className={`text-3xl font-bold tabular-nums ${belowThreshold ? "text-status-warn" : "text-foreground"}`}>
          {currentG.toLocaleString("en-GB", { maximumFractionDigits: 1 })} <span className="text-base font-normal text-muted-foreground">g</span>
        </p>
        {threshold != null && (
          <p className="text-xs text-muted-foreground mt-1">
            Low-stock threshold: {threshold} g{belowThreshold ? " — restock soon" : ""}
          </p>
        )}
      </div>

      {err && (
        <div className="rounded-md border border-status-alert-edge bg-status-alert-bg px-3 py-2 text-xs text-status-alert">
          {err}
        </div>
      )}

      {/* Receive stock */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-primary">Receive stock</h3>
        <p className="text-xs text-muted-foreground">Just bought more of this ingredient? Enter grams here.</p>
        <div className="flex gap-2 items-center">
          <input
            type="number" min="0" step="0.1"
            value={receiveInput}
            onChange={(e) => setReceiveInput(e.target.value)}
            placeholder="e.g. 5000"
            className="input flex-1"
            disabled={busy}
          />
          <span className="text-sm text-muted-foreground">g</span>
          <button
            onClick={handleReceive}
            disabled={busy || !receiveInput}
            className="rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Receive
          </button>
        </div>
        <input
          type="text"
          value={receiveNotes}
          onChange={(e) => setReceiveNotes(e.target.value)}
          placeholder="Optional note (supplier, batch, purchase ref…)"
          className="input text-sm"
          disabled={busy}
        />
      </section>

      {/* Manual adjust (recount) */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-primary">Adjust (recount / waste)</h3>
        <p className="text-xs text-muted-foreground">For corrections after a count, or writing off waste.</p>
        <div className="flex gap-2 items-center">
          <input
            type="number" min="0" step="0.1"
            value={adjustInput}
            onChange={(e) => setAdjustInput(e.target.value)}
            placeholder="grams"
            className="input flex-1"
            disabled={busy}
          />
          <button
            onClick={() => handleAdjust(+1)}
            disabled={busy || !adjustInput}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            + Add
          </button>
          <button
            onClick={() => handleAdjust(-1)}
            disabled={busy || !adjustInput}
            className="rounded-full border border-status-warn-edge bg-status-warn-bg text-status-warn px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            − Remove
          </button>
        </div>
      </section>

      {/* Low-stock threshold */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold text-primary">Low-stock alert threshold</h3>
        <p className="text-xs text-muted-foreground">Empty to disable alerts for this ingredient.</p>
        <div className="flex gap-2 items-center">
          <input
            type="number" min="0" step="0.1"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            placeholder="e.g. 500"
            className="input flex-1"
            disabled={busy}
          />
          <span className="text-sm text-muted-foreground">g</span>
          <button
            onClick={handleThreshold}
            disabled={busy}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      {/* Movement history */}
      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/40">
          <h3 className="text-sm font-semibold text-primary">Recent movements</h3>
        </div>
        {movements.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No movements yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {movements.map((m) => {
              const sign = Number(m.deltaG) > 0 ? "+" : "";
              const color = Number(m.deltaG) > 0 ? "text-status-ok" : "text-status-warn";
              return (
                <li key={m.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                  <span className={`tabular-nums font-medium w-20 ${color}`}>
                    {sign}{Number(m.deltaG).toLocaleString("en-GB", { maximumFractionDigits: 1 })} g
                  </span>
                  <span className="text-muted-foreground uppercase text-[10px] tracking-wide w-24 shrink-0">
                    {m.reason.replace(/_/g, " ")}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground">{m.notes ?? ""}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {m.movedAt ? new Date(m.movedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
