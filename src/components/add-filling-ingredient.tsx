"use client";

import { useState, useEffect, useRef, useMemo, type SyntheticEvent } from "react";
import { useIngredients, useFillings, saveFillingIngredient, saveIngredient } from "@/lib/hooks";
import { IconPlus as Plus } from "@tabler/icons-react";

interface AddFillingIngredientProps {
  fillingId: string;
  onAdded: () => void;
}

type ComponentKind = "ingredient" | "filling";

export function AddFillingIngredient({ fillingId, onAdded }: AddFillingIngredientProps) {
  const ingredients = useIngredients();
  const fillings = useFillings();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ComponentKind>("ingredient");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | "">("");
  const [amount, setAmount] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  // Sub-filling catalogue — exclude the current filling so it can't
  // include itself (DB also blocks direct self-reference; deep cycles
  // would still slip past without app-side detection, which is a
  // future hardening step).
  const sourceList = useMemo(() => {
    if (kind === "ingredient") return ingredients;
    return fillings.filter((f) => f.id !== fillingId);
  }, [kind, ingredients, fillings, fillingId]);

  const filtered = (search
    ? sourceList.filter((i) => {
        const q = search.toLowerCase();
        if (kind === "ingredient") {
          const ing = i as typeof ingredients[number];
          return ing.name.toLowerCase().includes(q) ||
            (ing.manufacturer?.toLowerCase().includes(q) ?? false);
        }
        return (i as typeof fillings[number]).name.toLowerCase().includes(q);
      })
    : sourceList
  ).slice(0, 10);

  const trimmedSearch = search.trim();
  const exactMatch = trimmedSearch
    ? sourceList.some((i) => i.name.toLowerCase() === trimmedSearch.toLowerCase())
    : false;
  // Inline "create new" only applies to ingredients — creating a new
  // filling from here is out-of-scope (would require more fields).
  const showCreateOption = kind === "ingredient" && !!trimmedSearch && !selectedId && !exactMatch;

  // Total navigable items = filtered results + optional create row
  const totalItems = filtered.length + (showCreateOption ? 1 : 0);

  // Reset highlight when search changes
  useEffect(() => { setHighlightedIndex(-1); }, [search]);

  // 'n' shortcut to open the form when nothing is focused
  useEffect(() => {
    if (open) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function selectIngredient(ing: (typeof ingredients)[0]) {
    setSelectedId(ing.id!);
    setSearch(ing.manufacturer ? `${ing.name} (${ing.manufacturer})` : ing.name);
    setHighlightedIndex(-1);
  }

  function selectFilling(f: (typeof fillings)[0]) {
    setSelectedId(f.id!);
    setSearch(f.name);
    setHighlightedIndex(-1);
  }

  async function handleCreateNew() {
    if (!trimmedSearch) return;
    const id = await saveIngredient({
      name: trimmedSearch,
      manufacturer: "",
      source: "",
      cost: 0,
      notes: "",
      cacaoFat: 0,
      sugar: 0,
      milkFat: 0,
      water: 0,
      solids: 0,
      otherFats: 0,
      allergens: [],
    });
    setSelectedId(id);
    setSearch(trimmedSearch);
    setHighlightedIndex(-1);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    const showDropdown = !!trimmedSearch && !selectedId && totalItems > 0;
    if (!showDropdown) {
      if (e.key === "Escape") { setOpen(false); setSearch(""); setSelectedId(""); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0) {
        e.preventDefault();
        if (highlightedIndex < filtered.length) {
          if (kind === "ingredient") selectIngredient(filtered[highlightedIndex] as (typeof ingredients)[0]);
          else selectFilling(filtered[highlightedIndex] as (typeof fillings)[0]);
        } else {
          handleCreateNew();
        }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
      setSelectedId("");
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightedIndex] as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  async function handleAdd(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedId || !amount) return;
    await saveFillingIngredient({
      fillingId,
      ingredientId: kind === "ingredient" ? (selectedId as string) : null,
      componentFillingId: kind === "filling" ? (selectedId as string) : null,
      amount: parseFloat(amount) || 0,
      unit: "g",
    });
    setSelectedId("");
    setAmount("");
    setSearch("");
    setOpen(false);
    onAdded();
  }

  function handleCancel() {
    setOpen(false);
    setSearch("");
    setSelectedId("");
    setHighlightedIndex(-1);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-primary font-medium mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Add component
        <kbd className="ml-1 rounded border border-[color:var(--ds-border-warm)] bg-muted px-1 py-0.5 font-sans text-muted-foreground" style={{fontSize: "0.65rem"}}>n</kbd>
      </button>
    );
  }

  return (
    <form onSubmit={handleAdd} className="mt-2 p-2 rounded-md border border-[color:var(--ds-border-warm)] bg-muted space-y-2">
      {/* Kind toggle — ingredient OR an existing filling used as a
          sub-component. Flipping resets the current selection so the
          search behaves sensibly for the new source. */}
      <div className="flex items-center gap-1">
        {(["ingredient", "filling"] as ComponentKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (kind !== k) {
                setKind(k);
                setSearch("");
                setSelectedId("");
                setHighlightedIndex(-1);
              }
            }}
            className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
              kind === k
                ? "bg-accent text-accent-foreground"
                : "bg-[color:var(--ds-card-bg)] text-muted-foreground border border-[color:var(--ds-border-warm)] hover:bg-muted"
            }`}
          >
            {k === "ingredient" ? "Ingredient" : "Another filling"}
          </button>
        ))}
      </div>
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedId(""); }}
          onKeyDown={handleSearchKeyDown}
          placeholder={kind === "ingredient" ? "Search ingredient…" : "Search existing filling…"}
          aria-label="Search component"
          autoFocus
          className="input"
        />
        {trimmedSearch && !selectedId && (filtered.length > 0 || showCreateOption) && (
          <ul ref={listRef} className="mt-1 max-h-40 overflow-y-auto rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
            {filtered.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => kind === "ingredient"
                    ? selectIngredient(item as (typeof ingredients)[0])
                    : selectFilling(item as (typeof fillings)[0])}
                  className={`w-full text-left px-2 py-1.5 text-sm transition-colors ${
                    idx === highlightedIndex ? "bg-[color:var(--ds-tint-info)] text-primary" : "hover:bg-muted"
                  }`}
                >
                  {item.name}
                  {kind === "ingredient" && (item as (typeof ingredients)[0]).manufacturer && (
                    <span className="text-muted-foreground"> ({(item as (typeof ingredients)[0]).manufacturer})</span>
                  )}
                </button>
              </li>
            ))}
            {showCreateOption && (
              <li>
                <button
                  type="button"
                  onClick={handleCreateNew}
                  className={`w-full text-left px-2 py-1.5 text-sm transition-colors border-t border-[color:var(--ds-border-warm)] ${
                    highlightedIndex === filtered.length ? "bg-[color:var(--ds-tint-info)] text-primary" : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  + Create <span className="font-medium text-foreground">"{trimmedSearch}"</span> as new ingredient
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {selectedId && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">Amount</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}
              required
              className="input min-w-[7rem]"
              autoFocus
            />
          </div>
          <span className="text-sm text-muted-foreground pb-1">g</span>
          <button
            type="submit"
            disabled={!amount}
            className="btn-primary px-3 py-1.5"
          >
            Add
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={handleCancel}
        className="text-xs text-muted-foreground"
      >
        Cancel
      </button>
    </form>
  );
}
