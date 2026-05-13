"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useFillingCategory,
  useFillingCategoryUsage,
  saveFillingCategory,
  deleteFillingCategory,
  archiveFillingCategory,
  unarchiveFillingCategory,
  useFillings,
} from "@/lib/hooks";
import { UsedInPanel } from "@/components/pantry";
import { InlineNameEditor } from "@/components/inline-name-editor";
import { PageHeader, Section, DsButton, StatusTag } from "@/components/dulceria";
import { IconTrash as Trash2, IconArchive as Archive, IconArchiveOff as ArchiveRestore } from "@tabler/icons-react";
import { useNavigationGuard } from "@/lib/useNavigationGuard";

export default function FillingCategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const categoryId = decodeURIComponent(idStr);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";

  const category = useFillingCategory(categoryId);
  const inUseCount = useFillingCategoryUsage(category?.name);
  const allFillings = useFillings();

  const fillingsUsingCategory = category
    ? allFillings.filter((f) => f.category === category.name && !f.archived)
    : [];

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Navigation guard — delete incomplete record if user leaves a ?new=1 page without saving
  const [savedOnce, setSavedOnce] = useState(false);
  const isDirty = isNew && !savedOnce;
  const handleConfirmLeave = useCallback(async () => {
    if (isNew) {
      try { await deleteFillingCategory(categoryId); } catch { /* ignore — silently keep if in use */ }
    }
  }, [isNew, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps
  useNavigationGuard(isDirty, isNew ? handleConfirmLeave : undefined);

  // Strip ?new=1 once the category loads
  useEffect(() => {
    if (isNew && category && !savedOnce) {
      setSavedOnce(true);
      router.replace(`/fillings/categories/${encodeURIComponent(categoryId)}`);
    }
  }, [isNew, category, savedOnce, categoryId, router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && confirmDelete) setConfirmDelete(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete]);

  if (!category) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  async function handleToggleShelfStable(next: boolean) {
    if (!category) return;
    await saveFillingCategory({
      id: category.id,
      name: category.name,
      shelfStable: next,
      archived: category.archived,
    });
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title={
          <InlineNameEditor
            name={category.name}
            onSave={async (n) => {
              await saveFillingCategory({
                id: category.id,
                name: n,
                shelfStable: category.shelfStable,
                archived: category.archived,
              });
            }}
          />
        }
        meta={`${inUseCount} filling${inUseCount === 1 ? "" : "s"} in this category`}
        badges={
          <>
            {category.shelfStable && <StatusTag kind="ready">Shelf-stable</StatusTag>}
            {category.archived && <StatusTag kind="done">Archived</StatusTag>}
          </>
        }
      />

      <div style={{ padding: "16px 32px 40px" }} className="space-y-6 max-w-lg">

        {/* Shelf-stable toggle */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={category.shelfStable}
              onChange={(e) => handleToggleShelfStable(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Treat as shelf-stable</span>
              <span className="text-xs text-muted-foreground block mt-1">
                When enabled, the production wizard will not auto-scale this filling to fit the moulds. Instead, it asks you for a batch multiplier (e.g. 1×, 2×) so you can prepare a deliberate batch size — useful for fillings made in fixed quantities like pralines or pâtes de fruit.
              </span>
            </span>
          </label>
        </section>

        {/* Read-only info */}
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] divide-y divide-border">
          <div className="flex justify-between items-center px-3 py-2 text-sm">
            <span className="text-muted-foreground">Fillings in this category</span>
            <span>{inUseCount}</span>
          </div>
        </div>

        <UsedInPanel
          singular="filling"
          plural="fillings"
          items={fillingsUsingCategory.map((f) => ({
            id: f.id ?? "",
            name: f.name,
            href: `/fillings/${encodeURIComponent(f.id ?? "")}`,
          }))}
          emptyMessage="No fillings are using this category yet."
        />

        {/* Archive / Delete */}
        <section className="pt-4 border-t border-[color:var(--ds-border-warm)]">
          {category.archived ? (
            <button
              onClick={() => unarchiveFillingCategory(categoryId)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArchiveRestore className="w-4 h-4" /> Unarchive category
            </button>
          ) : inUseCount > 0 ? (
            confirmDelete ? (
              <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Archive className="w-4 h-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium">Archive this category?</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inUseCount} filling{inUseCount === 1 ? "" : "s"} still use{inUseCount === 1 ? "s" : ""} this category, so it can&apos;t be deleted.
                  Archiving hides it from the picker when creating new fillings; existing fillings keep the label.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => { await archiveFillingCategory(categoryId); setConfirmDelete(false); router.replace("/fillings?tab=categories"); }}
                    className="btn-primary px-4 py-2 text-sm"
                  >
                    Yes, archive category
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="btn-secondary px-4 py-2">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Archive className="w-4 h-4" /> Archive category
              </button>
            )
          ) : confirmDelete ? (
            <div className="rounded-[4px] border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm text-destructive font-medium">Delete this category?</p>
              <p className="text-xs text-muted-foreground">
                No fillings are currently using it. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => { await deleteFillingCategory(categoryId); router.replace("/fillings?tab=categories"); }}
                  className="rounded-[4px] bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium"
                >
                  Yes, delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="btn-secondary px-4 py-2">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete category
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
