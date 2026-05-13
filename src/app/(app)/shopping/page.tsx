"use client";

import { useState, useMemo } from "react";
import { useIngredients, usePackagingList, useShoppingItems, setIngredientLowStock, markIngredientOrdered, unorderIngredient, setPackagingLowStock, markPackagingOrdered, unorderPackaging, saveShoppingItem, markShoppingItemOrdered, deleteShoppingItem, useDecorationMaterials, setDecorationMaterialLowStock, markDecorationMaterialOrdered, unorderDecorationMaterial, useOrders, useAllOrderItems, useProductsList, useMouldsList, useCapacityConfig, saveIngredient, useAllIngredientStock, useCampaigns, useProductionOrders, useAllProductionOrderItems, receiveIngredientStock } from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { computeShoppingNeeds } from "@/lib/shopping-needs";
import { PageHeader } from "@/components/dulceria";
import { IconShoppingCart as ShoppingCart, IconCheck as Check, IconChevronDown as ChevronDown, IconPlus as Plus, IconX as X, IconTrash as Trash2, IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";
import Link from "next/link";
import { SHOPPING_ITEM_CATEGORIES, DECORATION_MATERIAL_TYPE_LABELS, type ProductFilling, type FillingIngredient } from "@/types";

function timeAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default function ShoppingPage() {
  const ingredients = useIngredients(false);
  const packaging = usePackagingList();
  const shoppingItems = useShoppingItems();
  const decorationMaterials = useDecorationMaterials();

  const [orderedExpanded, setOrderedExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");
  const [newNote, setNewNote] = useState("");

  // For auto-recognition: track which DB record the typed name matches
  const [matchedIngredientId, setMatchedIngredientId] = useState<string | null>(null);
  const [matchedPackagingId, setMatchedPackagingId] = useState<string | null>(null);

  // Combined suggestion list for datalist
  const suggestions = useMemo(() => {
    const ing = ingredients.map((i) => ({ id: i.id!, name: i.name, type: "ingredient" as const, category: i.category }));
    const pkg = packaging.map((p) => ({ id: p.id!, name: p.name, type: "packaging" as const, category: undefined }));
    return [...ing, ...pkg];
  }, [ingredients, packaging]);

  function inferCategory(type: "ingredient" | "packaging", ingCategory?: string): string {
    if (type === "packaging") return "Packaging";
    if (ingCategory === "Cocoa Butters") return "Cocoa Butter";
    return "Ingredient";
  }

  function handleNameChange(value: string) {
    setNewName(value);
    const lower = value.trim().toLowerCase();
    const match = suggestions.find((s) => s.name.toLowerCase() === lower);
    if (match) {
      setMatchedIngredientId(match.type === "ingredient" ? match.id : null);
      setMatchedPackagingId(match.type === "packaging" ? match.id : null);
      setNewCategory(inferCategory(match.type, match.category ?? undefined));
    } else {
      setMatchedIngredientId(null);
      setMatchedPackagingId(null);
    }
  }

  // Pending: low stock but not yet ordered
  const pendingIngredients = useMemo(
    () => ingredients.filter((i) => i.lowStock && !i.lowStockOrdered),
    [ingredients]
  );
  const pendingPackaging = useMemo(
    () => packaging.filter((p) => p.lowStock && !p.lowStockOrdered),
    [packaging]
  );
  const pendingMaterials = useMemo(
    () => decorationMaterials.filter((m) => m.lowStock && !m.lowStockOrdered),
    [decorationMaterials]
  );
  const pendingItems = useMemo(
    () => shoppingItems.filter((s) => !s.orderedAt).sort((a, b) => b.addedAt - a.addedAt),
    [shoppingItems]
  );

  // Ordered: flagged and order placed, awaiting delivery
  const orderedIngredients = useMemo(
    () => ingredients.filter((i) => i.lowStock && i.lowStockOrdered),
    [ingredients]
  );
  const orderedPackaging = useMemo(
    () => packaging.filter((p) => p.lowStock && p.lowStockOrdered),
    [packaging]
  );
  const orderedMaterials = useMemo(
    () => decorationMaterials.filter((m) => m.lowStock && m.lowStockOrdered),
    [decorationMaterials]
  );
  const orderedItems = useMemo(
    () => shoppingItems.filter((s) => !!s.orderedAt).sort((a, b) => b.orderedAt! - a.orderedAt!),
    [shoppingItems]
  );

  const totalPending = pendingIngredients.length + pendingPackaging.length + pendingMaterials.length + pendingItems.length;
  const totalOrdered = orderedIngredients.length + orderedPackaging.length + orderedMaterials.length + orderedItems.length;

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (matchedIngredientId) {
      await setIngredientLowStock(matchedIngredientId, true);
    } else if (matchedPackagingId) {
      await setPackagingLowStock(matchedPackagingId, true);
    } else {
      await saveShoppingItem({
        name: newName.trim(),
        category: newCategory || undefined,
        note: newNote.trim() || undefined,
        addedAt: Date.now(),
      });
    }
    setNewName("");
    setNewCategory("");
    setNewNote("");
    setMatchedIngredientId(null);
    setMatchedPackagingId(null);
    setShowAddForm(false);
  }

  function resetAddForm() {
    setShowAddForm(false);
    setNewName("");
    setNewCategory("");
    setNewNote("");
    setMatchedIngredientId(null);
    setMatchedPackagingId(null);
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Shopping list" meta="Items to reorder for the workshop" />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }}>

        <IngredientStockBelowThresholdSection />

        <PlannedDemandSection />

        {totalPending === 0 && totalOrdered === 0 && !showAddForm && (
          <div className="py-12 text-center">
            <ShoppingCart className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nothing to order — all stocked up.</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary"
            >
              <Plus className="w-4 h-4" /> Add an item
            </button>
          </div>
        )}

        {(totalPending > 0 || totalOrdered > 0 || showAddForm) && (
          <>
            {/* Pending section */}
            {totalPending > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Needs ordering ({totalPending})
                </h2>

                {pendingIngredients.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 ml-1">Ingredients</p>
                    <ul className="space-y-1.5">
                      {pendingIngredients.map((ing) => (
                        <li key={ing.id} className={`flex items-center gap-3 rounded-[4px] border px-3 py-2.5 ${ing.outOfStock ? "border-status-alert-edge bg-status-alert-bg" : "border-status-warn-edge bg-status-warn-bg"}`}>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${ing.outOfStock ? "bg-status-alert-edge" : "bg-status-warn-edge"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{ing.name}</p>
                              {ing.outOfStock && (
                                <span className="text-[10px] font-medium text-status-alert bg-status-alert-bg px-1.5 py-0.5 rounded-full shrink-0">out of stock</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {ing.category && <span className="text-xs text-muted-foreground">{ing.category}</span>}
                              {ing.lowStockSince && (
                                <>
                                  {ing.category && <span className="text-muted-foreground/40 text-xs">·</span>}
                                  <span className="text-xs text-muted-foreground">flagged {timeAgo(ing.lowStockSince)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Link
                              href={`/ingredients/${encodeURIComponent(ing.id ?? "")}`}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => markIngredientOrdered(ing.id!)}
                              className="inline-flex items-center gap-1 rounded-[4px] bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium"
                              title="Mark as ordered"
                            >
                              <Check className="w-3 h-3" /> Ordered
                            </button>
                            {pendingRemove === `ing-${ing.id}` ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Remove?</span>
                                <button
                                  onClick={() => { setIngredientLowStock(ing.id!, false); setPendingRemove(null); }}
                                  className="text-red-600 font-medium hover:underline"
                                >Yes</button>
                                <button onClick={() => setPendingRemove(null)} className="text-muted-foreground hover:underline">Cancel</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setPendingRemove(`ing-${ing.id}`)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                title="Remove from list"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pendingPackaging.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 ml-1">Packaging</p>
                    <ul className="space-y-1.5">
                      {pendingPackaging.map((pkg) => (
                        <li key={pkg.id} className="flex items-center gap-3 rounded-[4px] border border-status-warn-edge bg-status-warn-bg px-3 py-2.5">
                          <div className="w-2 h-2 rounded-full bg-status-warn-edge shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{pkg.name}</p>
                            {pkg.lowStockSince && (
                              <span className="text-xs text-muted-foreground">flagged {timeAgo(pkg.lowStockSince)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Link
                              href={`/packaging/${encodeURIComponent(pkg.id ?? "")}`}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => markPackagingOrdered(pkg.id!)}
                              className="inline-flex items-center gap-1 rounded-[4px] bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium"
                              title="Mark as ordered"
                            >
                              <Check className="w-3 h-3" /> Ordered
                            </button>
                            {pendingRemove === `pkg-${pkg.id}` ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Remove?</span>
                                <button
                                  onClick={() => { setPackagingLowStock(pkg.id!, false); setPendingRemove(null); }}
                                  className="text-red-600 font-medium hover:underline"
                                >Yes</button>
                                <button onClick={() => setPendingRemove(null)} className="text-muted-foreground hover:underline">Cancel</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setPendingRemove(`pkg-${pkg.id}`)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                title="Remove from list"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pendingMaterials.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 ml-1">Decoration</p>
                    <ul className="space-y-1.5">
                      {pendingMaterials.map((m) => (
                        <li key={m.id} className={`flex items-center gap-3 rounded-[4px] border px-3 py-2.5 ${m.outOfStock ? "border-status-alert-edge bg-status-alert-bg" : "border-status-warn-edge bg-status-warn-bg"}`}>
                          <span
                            className="w-2 h-2 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: m.color ?? (m.outOfStock ? "#f87171" : "#fbbf24") }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{m.name}</p>
                              {m.outOfStock && (
                                <span className="text-[10px] font-medium text-status-alert bg-status-alert-bg px-1.5 py-0.5 rounded-full shrink-0">out of stock</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs text-muted-foreground">{DECORATION_MATERIAL_TYPE_LABELS[m.type]}</span>
                              {m.lowStockSince && (
                                <>
                                  <span className="text-muted-foreground/40 text-xs">·</span>
                                  <span className="text-xs text-muted-foreground">flagged {timeAgo(m.lowStockSince)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Link
                              href={`/pantry/decoration/${encodeURIComponent(m.id ?? "")}`}
                              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => markDecorationMaterialOrdered(m.id!)}
                              className="inline-flex items-center gap-1 rounded-[4px] bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium"
                              title="Mark as ordered"
                            >
                              <Check className="w-3 h-3" /> Ordered
                            </button>
                            {pendingRemove === `mat-${m.id}` ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Remove?</span>
                                <button
                                  onClick={() => { setDecorationMaterialLowStock(m.id!, false); setPendingRemove(null); }}
                                  className="text-red-600 font-medium hover:underline"
                                >Yes</button>
                                <button onClick={() => setPendingRemove(null)} className="text-muted-foreground hover:underline">Cancel</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setPendingRemove(`mat-${m.id}`)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                title="Remove from list"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {pendingItems.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 ml-1">Other items</p>
                    <ul className="space-y-1.5">
                      {pendingItems.map((item) => (
                        <li key={item.id} className="flex items-center gap-3 rounded-[4px] border border-status-warn-edge bg-status-warn-bg px-3 py-2.5">
                          <div className="w-2 h-2 rounded-full bg-status-warn-edge shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                              {item.note && (
                                <>
                                  {item.category && <span className="text-muted-foreground/40 text-xs">·</span>}
                                  <span className="text-xs text-muted-foreground italic truncate">{item.note}</span>
                                </>
                              )}
                              <span className="text-muted-foreground/40 text-xs">·</span>
                              <span className="text-xs text-muted-foreground">added {timeAgo(item.addedAt)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => markShoppingItemOrdered(item.id!)}
                              className="inline-flex items-center gap-1 rounded-[4px] bg-primary text-primary-foreground px-2.5 py-1.5 text-xs font-medium"
                              title="Mark as ordered"
                            >
                              <Check className="w-3 h-3" /> Ordered
                            </button>
                            {pendingRemove === `item-${item.id}` ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">Delete?</span>
                                <button
                                  onClick={() => { deleteShoppingItem(item.id!); setPendingRemove(null); }}
                                  className="text-red-600 font-medium hover:underline"
                                >Yes</button>
                                <button onClick={() => setPendingRemove(null)} className="text-muted-foreground hover:underline">Cancel</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setPendingRemove(`item-${item.id}`)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                title="Delete"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Add item */}
            {showAddForm ? (
              <form onSubmit={handleAddItem} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 space-y-2">
                <div>
                  <input
                    type="text"
                    list="shopping-suggestions"
                    value={newName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Item name…"
                    autoFocus
                    required
                    className="input"
                  />
                  <datalist id="shopping-suggestions">
                    {suggestions.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                  {(matchedIngredientId || matchedPackagingId) && (
                    <p className="text-xs text-primary mt-1">
                      Recognised — will flag as low stock directly.
                    </p>
                  )}
                </div>
                {!(matchedIngredientId || matchedPackagingId) && (
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="input"
                  >
                    <option value="">Category (optional)</option>
                    {SHOPPING_ITEM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                {newCategory && (matchedIngredientId || matchedPackagingId) && (
                  <p className="text-xs text-muted-foreground">Category: {newCategory}</p>
                )}
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Note — quantity, supplier, link… (optional)"
                  className="input"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={!newName.trim()} className="btn-primary flex-1 py-2">
                    Add
                  </button>
                  <button type="button" onClick={resetAddForm} className="btn-secondary px-4 py-2">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-4 h-4" /> Add item
              </button>
            )}

            {/* Ordered / awaiting delivery */}
            {totalOrdered > 0 && (
              <section>
                <button
                  onClick={() => setOrderedExpanded((v) => !v)}
                  className="flex items-center gap-2 w-full text-left mb-2"
                >
                  <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${orderedExpanded ? "" : "-rotate-90"}`} />
                  <h2 className="text-sm font-semibold text-muted-foreground">Ordered — awaiting delivery ({totalOrdered})</h2>
                </button>
                {orderedExpanded && (
                  <ul className="space-y-1.5 ml-6">
                    {orderedIngredients.map((ing) => (
                      <li key={ing.id} className="flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5">
                        <div className="w-2 h-2 rounded-full bg-status-ok-edge shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{ing.name}</p>
                          <span className="text-xs text-muted-foreground">{ing.category ?? "Ingredient"}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => unorderIngredient(ing.id!)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Move back to needs ordering"
                          >
                            Undo order
                          </button>
                          <button
                            onClick={() => setIngredientLowStock(ing.id!, false)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Mark as restocked — remove from list"
                          >
                            <Check className="w-3 h-3" /> Restocked
                          </button>
                        </div>
                      </li>
                    ))}
                    {orderedPackaging.map((pkg) => (
                      <li key={pkg.id} className="flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5">
                        <div className="w-2 h-2 rounded-full bg-status-ok-edge shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{pkg.name}</p>
                          <span className="text-xs text-muted-foreground">Packaging</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => unorderPackaging(pkg.id!)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Move back to needs ordering"
                          >
                            Undo order
                          </button>
                          <button
                            onClick={() => setPackagingLowStock(pkg.id!, false)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Mark as restocked — remove from list"
                          >
                            <Check className="w-3 h-3" /> Restocked
                          </button>
                        </div>
                      </li>
                    ))}
                    {orderedMaterials.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0 border border-black/10"
                          style={{ backgroundColor: m.color ?? "#86efac" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          <span className="text-xs text-muted-foreground">{DECORATION_MATERIAL_TYPE_LABELS[m.type]}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => unorderDecorationMaterial(m.id!)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Move back to needs ordering"
                          >
                            Undo order
                          </button>
                          <button
                            onClick={() => setDecorationMaterialLowStock(m.id!, false)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-[color:var(--ds-border-warm)] rounded-full px-2.5 py-1.5 transition-colors"
                            title="Mark as restocked — remove from list"
                          >
                            <Check className="w-3 h-3" /> Restocked
                          </button>
                        </div>
                      </li>
                    ))}
                    {orderedItems.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-3 py-2.5">
                        <div className="w-2 h-2 rounded-full bg-status-ok-edge shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                        </div>
                        {pendingRemove === `ordered-${item.id}` ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">Delete?</span>
                            <button
                              onClick={() => { deleteShoppingItem(item.id!); setPendingRemove(null); }}
                              className="text-red-600 font-medium hover:underline"
                            >Yes</button>
                            <button onClick={() => setPendingRemove(null)} className="text-muted-foreground hover:underline">Cancel</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setPendingRemove(`ordered-${item.id}`)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planned-demand section (§6 production planning)
// ---------------------------------------------------------------------------

function PlannedDemandSection() {
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const moulds = useMouldsList(true);
  const ingredients = useIngredients(true);
  const config = useCapacityConfig();

  const productIds = useMemo(() => products.map((p) => p.id!).filter(Boolean), [products]);

  const { data: productFillings = [] } = useQuery({
    queryKey: ["product-fillings", "all-for-shopping"],
    enabled: productIds.length > 0,
    queryFn: async () =>
      assertOk(await supabase.from("productFillings").select("*")) as ProductFilling[],
  });

  const fillingIds = useMemo(
    () => [...new Set(productFillings.map((pf) => pf.fillingId))],
    [productFillings],
  );

  const { data: fillingIngredients = [] } = useQuery({
    queryKey: ["filling-ingredients", "all-for-shopping"],
    enabled: fillingIds.length > 0,
    queryFn: async () =>
      assertOk(await supabase.from("fillingIngredients").select("*")) as FillingIngredient[],
  });

  const fiByFilling = useMemo(() => {
    const m = new Map<string, FillingIngredient[]>();
    for (const li of fillingIngredients) {
      const arr = m.get(li.fillingId) ?? [];
      arr.push(li);
      m.set(li.fillingId, arr);
    }
    return m;
  }, [fillingIngredients]);

  const ingredientStockTopLevel = useAllIngredientStock();
  const campaignsForShopping = useCampaigns();
  const productionOrdersForShopping = useProductionOrders();
  const productionOrderItemsForShopping = useAllProductionOrderItems();
  const { rows, warnings } = useMemo(
    () => computeShoppingNeeds({
      orders,
      orderItems,
      products,
      moulds,
      productFillings,
      fillingIngredientsByFillingId: fiByFilling,
      ingredients,
      config,
      ingredientStock: ingredientStockTopLevel,
      campaigns: campaignsForShopping,
      productionOrders: productionOrdersForShopping,
      productionOrderItems: productionOrderItemsForShopping,
    }),
    [orders, orderItems, products, moulds, productFillings, fiByFilling, ingredients, config, ingredientStockTopLevel, campaignsForShopping, productionOrdersForShopping, productionOrderItemsForShopping],
  );

  const shortfalls = rows.filter((r) => r.shortageG > 0);
  if (shortfalls.length === 0 && warnings.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-primary">Planned demand</h2>
      <p className="text-xs text-muted-foreground">
        Ingredients needed to fulfil open orders, minus current stock. Update stock values from
        each ingredient's detail page or the inline field below.
      </p>

      {warnings.length > 0 && (
        <div className="rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 space-y-1">
          {warnings.slice(0, 5).map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-status-warn">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
          {warnings.length > 5 && (
            <p className="text-xs text-status-warn">…and {warnings.length - 5} more.</p>
          )}
        </div>
      )}

      {shortfalls.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-[color:var(--ds-border-warm)] rounded-[4px]">
          You have enough stock for every open order.
        </p>
      ) : (
        <ShortageBySupplier shortfalls={shortfalls} ingredients={ingredients} />
      )}
    </section>
  );
}

/** Group planned-demand shortfalls by supplier (`ingredient.vendor`)
 *  with per-row purchase units, unit price, subtotal, plus per-group
 *  and grand totals. Falls back to "Other" when no vendor is set. */
function ShortageBySupplier({
  shortfalls, ingredients,
}: {
  shortfalls: { ingredientId: string; name: string; neededG: number; onHandG: number; shortageG: number; purchaseUnit?: string; gramsPerUnit?: number }[];
  ingredients: import("@/types").Ingredient[];
}) {
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients]);

  type EnrichedRow = {
    row: typeof shortfalls[number];
    ing: import("@/types").Ingredient | undefined;
    vendor: string;
    unitsToBuy: number | null;
    unitLabel: string;
    unitPrice: number | null;
    subtotal: number | null;
  };

  const enriched: EnrichedRow[] = useMemo(() => shortfalls.map((row) => {
    const ing = ingMap.get(row.ingredientId);
    const gramsPerUnit = ing?.gramsPerUnit ?? row.gramsPerUnit ?? null;
    const unitLabel = ing?.purchaseUnit ?? row.purchaseUnit ?? "g";
    const unitsToBuy = gramsPerUnit && gramsPerUnit > 0
      ? Math.ceil(row.shortageG / gramsPerUnit)
      : null;
    // Unit price = purchaseCost / purchaseQty (defaults to 1 when unset).
    const unitPrice = ing?.purchaseCost && (ing.purchaseQty ?? 1) > 0
      ? ing.purchaseCost / (ing.purchaseQty ?? 1)
      : null;
    const subtotal = unitsToBuy != null && unitPrice != null
      ? unitsToBuy * unitPrice
      : null;
    return {
      row,
      ing,
      vendor: ing?.vendor?.trim() || "Other / no supplier set",
      unitsToBuy,
      unitLabel,
      unitPrice,
      subtotal,
    };
  }), [shortfalls, ingMap]);

  const groups = useMemo(() => {
    const m = new Map<string, EnrichedRow[]>();
    for (const r of enriched) {
      const arr = m.get(r.vendor) ?? [];
      arr.push(r);
      m.set(r.vendor, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [enriched]);

  const grandTotal = enriched.reduce((s, r) => s + (r.subtotal ?? 0), 0);
  const fmt = (v: number) => `€${v.toFixed(2).replace(/\.00$/, "")}`;

  return (
    <div className="space-y-3">
      {groups.map(([vendor, rows]) => {
        const vendorTotal = rows.reduce((s, r) => s + (r.subtotal ?? 0), 0);
        return (
          <div key={vendor} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted border-b border-[color:var(--ds-border-warm)]">
              <h3
                className="text-[13px]"
                style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
              >
                {vendor}
                <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-normal">
                  {rows.length} item{rows.length === 1 ? "" : "s"}
                </span>
              </h3>
              <span className="text-[11px] tabular-nums font-medium">≈ {fmt(vendorTotal)}</span>
            </div>
            <div className="hidden sm:flex items-center px-3 py-1 text-[10px] uppercase tracking-[0.06em] text-muted-foreground bg-muted/20 border-b border-[color:var(--ds-border-warm)]">
              <span className="flex-1">Ingredient</span>
              <span className="w-20 text-right">Short</span>
              <span className="w-24 text-right">Buy</span>
              <span className="w-20 text-right">Unit €</span>
              <span className="w-20 text-right">Subtotal</span>
              <span className="w-32 text-right">Received</span>
            </div>
            {rows.map((r) => (
              <BuyRowWithBreakdown key={r.row.ingredientId} r={r} />
            ))}
          </div>
        );
      })}
      <div className="flex items-center justify-between px-3 py-2 rounded-[4px] border border-[color:var(--ds-border-warm)] bg-muted">
        <span className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground font-medium">Approx. total to buy</span>
        <span className="text-[14px] tabular-nums font-semibold">≈ {fmt(grandTotal)}</span>
      </div>
    </div>
  );
}

/** Buy row with click-to-expand "why this much?" breakdown. Each
 *  contribution shows its source (Order / Campaign / PO), the
 *  product driving it, whether it's shell or filling, and grams. */
function BuyRowWithBreakdown({ r }: {
  r: {
    row: { ingredientId: string; name: string; shortageG: number; neededG?: number; onHandG?: number; purchaseUnit?: string; gramsPerUnit?: number; breakdown?: Array<{ kind: string; source: string; productName: string; grams: number; via: string }> };
    unitsToBuy: number | null;
    unitLabel: string;
    unitPrice: number | null;
    subtotal: number | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const breakdown = r.row.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;
  const fmt = (v: number) => `€${v.toFixed(2).replace(/\.00$/, "")}`;
  return (
    <>
      <div
        className="flex items-center px-3 py-1.5 text-sm border-b border-[color:var(--ds-border-warm)] last:border-b-0 cursor-pointer hover:bg-muted/20"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex-1 flex items-baseline gap-1.5 min-w-0">
          <span className="text-[10px] opacity-60 shrink-0 w-3">
            {hasBreakdown ? (open ? "▾" : "▸") : ""}
          </span>
          <Link
            href={`/ingredients/${encodeURIComponent(r.row.ingredientId)}`}
            className="truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {r.row.name}
          </Link>
        </span>
        <span className="w-20 text-right tabular-nums text-muted-foreground">{formatGrams(r.row.shortageG)}</span>
        <span className="w-24 text-right tabular-nums">
          {r.unitsToBuy != null ? `${r.unitsToBuy} ${r.unitLabel}` : "—"}
        </span>
        <span className="w-20 text-right tabular-nums text-muted-foreground">
          {r.unitPrice != null ? fmt(r.unitPrice) : "—"}
        </span>
        <span className="w-20 text-right tabular-nums font-medium">
          {r.subtotal != null ? fmt(r.subtotal) : "—"}
        </span>
        <span className="w-32 flex justify-end" onClick={(e) => e.stopPropagation()}>
          <ReceiveCell
            ingredientId={r.row.ingredientId}
            purchaseUnit={r.row.purchaseUnit}
            gramsPerUnit={r.row.gramsPerUnit}
          />
        </span>
      </div>
      {open && hasBreakdown && (
        <div className="px-3 py-2 bg-muted/20 border-b border-[color:var(--ds-border-warm)] text-[11.5px]">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground mb-1.5">
            Where does this demand come from?
          </p>
          <p className="text-[10.5px] text-muted-foreground mb-2">
            Total needed: <b>{formatGrams(r.row.neededG ?? 0)}</b> · on hand: <b>{formatGrams(r.row.onHandG ?? 0)}</b> · short: <b>{formatGrams(r.row.shortageG)}</b>
          </p>
          <ul className="space-y-0.5" style={{ listStyle: "none", padding: 0 }}>
            {breakdown.map((b, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span
                  className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{
                    background:
                      b.kind === "order" ? "rgba(43,108,176,0.12)"
                      : b.kind === "campaign" ? "rgba(106,58,140,0.12)"
                      : "rgba(74,107,91,0.12)",
                    color:
                      b.kind === "order" ? "#2b6cb0"
                      : b.kind === "campaign" ? "#6a3a8c"
                      : "var(--accent-mint-ink)",
                  }}
                >
                  {b.kind}
                </span>
                <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
                  {b.source}
                </span>
                <span className="text-muted-foreground">·</span>
                <span>{b.productName}</span>
                <span className="text-[10px] text-muted-foreground">({b.via})</span>
                <span className="ml-auto tabular-nums font-medium">{formatGrams(b.grams)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Tiny inline "received" cell — operator types the amount in
 *  whichever unit they bought it (purchase unit / kg / g), the
 *  ingredient stock gets bumped in grams via `receiveIngredientStock`.
 *
 *  When the ingredient has a `purchaseUnit` + `gramsPerUnit` set
 *  (e.g. strawberry puree: "pcs" × 3000 g per piece), that unit is
 *  the default — type "2" → adds 6000 g. Operator can toggle to kg
 *  or g for off-pack receives. */
function ReceiveCell({ ingredientId, purchaseUnit, gramsPerUnit }: {
  ingredientId: string;
  purchaseUnit?: string;
  gramsPerUnit?: number;
}) {
  const hasPack = !!purchaseUnit && !!gramsPerUnit && gramsPerUnit > 0;
  type UnitMode = "pack" | "kg" | "g";
  const [unitMode, setUnitMode] = useState<UnitMode>(hasPack ? "pack" : "g");
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function unitLabel(m: UnitMode): string {
    if (m === "pack") return purchaseUnit ?? "pcs";
    return m;
  }

  async function submit() {
    if (saving) return;
    const trimmed = val.trim().replace(",", ".");
    if (!trimmed) return;
    const n = parseFloat(trimmed);
    if (isNaN(n) || n <= 0) return;
    let grams: number;
    if (unitMode === "pack" && gramsPerUnit) grams = n * gramsPerUnit;
    else if (unitMode === "kg") grams = n * 1000;
    else grams = n;
    setSaving(true);
    try {
      await receiveIngredientStock(ingredientId, grams, "Received via shopping list");
      setVal("");
      setFlash(`+${formatGrams(grams)}`);
      setTimeout(() => setFlash(null), 1800);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Receive failed");
    } finally {
      setSaving(false);
    }
  }

  // Cycle through the available unit modes when the unit chip is
  // clicked. pack → kg → g → pack…
  function cycleUnit() {
    setUnitMode((m) => {
      if (hasPack) return m === "pack" ? "kg" : m === "kg" ? "g" : "pack";
      return m === "kg" ? "g" : "kg";
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        placeholder={hasPack && unitMode === "pack" ? `# ${purchaseUnit}` : "amount"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        className="input !w-14 text-[11px] !py-0.5 text-right"
        disabled={saving}
        title={
          hasPack && unitMode === "pack"
            ? `Number of ${purchaseUnit} (1 ${purchaseUnit} = ${gramsPerUnit} g)`
            : "Amount received"
        }
      />
      <button
        type="button"
        onClick={cycleUnit}
        title="Click to switch unit"
        className="text-[10px] px-1.5 py-0.5 rounded-[4px] border border-[color:var(--ds-border-warm)] bg-muted hover:bg-muted min-w-[28px]"
      >
        {unitLabel(unitMode)}
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={saving || !val.trim()}
        className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[color:var(--ds-tier-quarter-focus)] text-white disabled:opacity-40"
      >
        Add
      </button>
      {flash && (
        <span className="text-[10px] text-status-ok-ink">{flash}</span>
      )}
    </span>
  );
}

function ShortageRow({ row, ingredients }: {
  row: { ingredientId: string; name: string; neededG: number; onHandG: number; shortageG: number; purchaseUnit?: string; gramsPerUnit?: number };
  ingredients: import("@/types").Ingredient[];
}) {
  const [stockStr, setStockStr] = useState(String(row.onHandG));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSaveStock() {
    const n = parseFloat(stockStr);
    if (isNaN(n) || n < 0) return;
    const ing = ingredients.find((i) => i.id === row.ingredientId);
    if (!ing) return;
    setSaving(true);
    try {
      await saveIngredient({ ...ing, currentStockG: n });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center px-3 py-1.5 text-sm border-b border-[color:var(--ds-border-warm)] last:border-b-0">
      <Link
        href={`/ingredients/${encodeURIComponent(row.ingredientId)}`}
        className="flex-1 truncate hover:underline"
      >
        {row.name}
      </Link>
      <span className="w-24 text-right tabular-nums">{formatGrams(row.neededG)}</span>
      <span className="w-28 text-right tabular-nums">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="number"
              min="0"
              step="1"
              value={stockStr}
              onChange={(e) => setStockStr(e.target.value)}
              onBlur={handleSaveStock}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveStock(); if (e.key === "Escape") setEditing(false); }}
              className="input !w-20 text-xs !py-0.5"
              autoFocus
            />
            <span className="text-xs text-muted-foreground">g</span>
          </span>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="hover:underline"
            disabled={saving}
          >
            {formatGrams(row.onHandG)}
          </button>
        )}
      </span>
      <span className="w-24 text-right tabular-nums font-medium text-destructive">
        {formatGrams(row.shortageG)}
      </span>
    </div>
  );
}

function formatGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  return `${Math.round(g)} g`;
}

/** Ingredients whose live grams-on-hand balance is below their
 *  configured lowStockThresholdG. Independent of open-order demand —
 *  just "what's below the line." Clicking a row jumps to the Stock
 *  tab of that ingredient, where the operator can hit Receive. */
function IngredientStockBelowThresholdSection() {
  const ingredients = useIngredients(false);
  const stock = useAllIngredientStock();
  const rows = useMemo(() => {
    const byId = new Map(ingredients.map((i) => [i.id!, i]));
    return stock
      .filter((s) => s.lowStockThresholdG != null && Number(s.quantityG) < Number(s.lowStockThresholdG))
      .map((s) => ({
        ingredientId: s.ingredientId,
        name: byId.get(s.ingredientId)?.name ?? s.ingredientId,
        quantityG: Number(s.quantityG),
        thresholdG: Number(s.lowStockThresholdG ?? 0),
        shortageG: Math.max(0, Number(s.lowStockThresholdG ?? 0) - Number(s.quantityG)),
        purchaseUnit: byId.get(s.ingredientId)?.purchaseUnit,
        gramsPerUnit: byId.get(s.ingredientId)?.gramsPerUnit,
      }))
      .sort((a, b) => (a.quantityG / a.thresholdG) - (b.quantityG / b.thresholdG));
  }, [stock, ingredients]);

  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-primary">Below stock threshold</h2>
      <p className="text-xs text-muted-foreground">
        Ingredients currently under the low-stock threshold you set on each ingredient's Stock tab.
        Open the ingredient to Receive more.
      </p>
      <div className="rounded-[4px] border border-status-warn/40 bg-status-warn-bg/20 overflow-hidden">
        <div className="flex items-center px-3 py-2 bg-muted border-b border-[color:var(--ds-border-warm)] text-xs font-semibold text-muted-foreground">
          <span className="flex-1">Ingredient</span>
          <span className="w-24 text-right">On hand</span>
          <span className="w-28 text-right">Threshold</span>
          <span className="w-24 text-right">Short by</span>
          <span className="w-32 text-right">Received</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.ingredientId}
            className="flex items-center px-3 py-2 text-sm border-b border-[color:var(--ds-border-warm)] last:border-b-0 hover:bg-muted/20"
          >
            <Link
              href={`/ingredients/${encodeURIComponent(row.ingredientId)}?tab=stock`}
              className="flex-1 truncate hover:underline"
            >
              {row.name}
            </Link>
            <span className="w-24 text-right tabular-nums text-status-warn font-medium">
              {formatGrams(row.quantityG)}
            </span>
            <span className="w-28 text-right tabular-nums text-muted-foreground">
              {formatGrams(row.thresholdG)}
            </span>
            <span className="w-24 text-right tabular-nums font-medium text-destructive">
              {formatGrams(row.shortageG)}
            </span>
            <span className="w-32 flex justify-end">
              <ReceiveCell
                ingredientId={row.ingredientId}
                purchaseUnit={row.purchaseUnit}
                gramsPerUnit={row.gramsPerUnit}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
