"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { IconChevronRight as ChevronRight, IconPlus as Plus, IconStack as Layers, IconTrash as Trash2, IconFlask as FlaskConical, IconPlayerPlay as Play, IconPencil as Pencil, IconGitBranch as GitBranch } from "@tabler/icons-react";
import { useExperiments, saveExperiment, deleteExperiment, forkExperimentVersion, useFillings } from "@/lib/hooks";
import { GANACHE_TYPES, type GanacheType } from "@/types";

type CreateMode = "blank" | "clone" | null;

export function ExperimentsTab() {
  const router = useRouter();
  const experiments = useExperiments();
  const fillings = useFillings();
  const ganacheFillings = fillings.filter((l) => l.category === "Ganaches (Emulsions)");

  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [newName, setNewName] = useState("");
  const [newGanacheType, setNewGanacheType] = useState<GanacheType>("dark");
  const [cloneFillingId, setCloneFillingId] = useState<string | "">("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPromoted, setShowPromoted] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createMode) {
      nameInputRef.current?.focus();
      setNewName("");
      setCloneFillingId("");
    }
  }, [createMode]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n") setCreateMode("blank");
      if (e.key === "Escape") setCreateMode(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function handleCreateBlank() {
    if (!newName.trim()) return;
    setSaving(true);
    const id = await saveExperiment({
      name: newName.trim(),
      ganacheType: newGanacheType,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    router.push(`/calculator/${encodeURIComponent(String(id))}?new=1`);
  }

  async function handleClone() {
    if (!cloneFillingId || !newName.trim()) return;
    setSaving(true);
    const id = await saveExperiment({
      name: newName.trim(),
      ganacheType: newGanacheType,
      sourceFillingId: cloneFillingId ?? undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    router.push(`/calculator/${encodeURIComponent(String(id))}?clone=${encodeURIComponent(cloneFillingId ?? "")}`);
  }

  async function handleDelete(id: string) {
    await deleteExperiment(id);
    setDeleteId(null);
  }

  async function handleNewVersion(id: string) {
    const newId = await forkExperimentVersion(id);
    router.push(`/calculator/${encodeURIComponent(newId)}?new=1`);
  }

  const activeExperiments = experiments.filter((e) => e.status !== "promoted");
  const promotedExperiments = experiments.filter((e) => e.status === "promoted");

  if (experiments.length === 0 && createMode === null) {
    return (
      <div className="max-w-lg space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-5">
          Start your first experiment
        </p>
        <button
          onClick={() => setCreateMode("blank")}
          title="New blank experiment (n)"
          className="w-full text-left group rounded-[4px] border-2 border-[color:var(--ds-tier-quarter-focus)] bg-[color:var(--ds-tint-info)] hover:border-[color:var(--ds-tier-quarter-focus)] hover:bg-[color:var(--ds-tint-info)] transition-all px-5 py-4"
        >
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-[4px] bg-[color:var(--ds-tint-info)] group-hover:bg-[color:var(--ds-tint-info)] transition-colors flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Start from scratch</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Build a new ganache formula and balance it against your target composition ranges.
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto mt-1 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>
        <button
          onClick={() => setCreateMode("clone")}
          className="w-full text-left group rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:border-[color:var(--ds-tier-quarter-focus)] hover:bg-muted transition-all px-5 py-4"
        >
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-[4px] bg-muted group-hover:bg-[color:var(--ds-tint-info)] transition-colors flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Clone a ganache filling</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Start from an existing product filling and tweak the proportions.
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto mt-1 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setCreateMode(createMode === "blank" ? null : "blank")}
          title="New blank experiment (n)"
          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="w-4 h-4" /> New experiment
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          onClick={() => setCreateMode(createMode === "clone" ? null : "clone")}
          className={`flex items-center gap-1.5 text-sm transition-colors ${createMode === "clone" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Layers className="w-4 h-4" /> Clone a filling
        </button>
      </div>

      {createMode && (
        <CreateForm
          mode={createMode}
          onCancel={() => setCreateMode(null)}
          nameInputRef={nameInputRef}
          newName={newName}
          setNewName={setNewName}
          newGanacheType={newGanacheType}
          setNewGanacheType={setNewGanacheType}
          cloneFillingId={cloneFillingId}
          setCloneFillingId={setCloneFillingId}
          ganacheFillings={ganacheFillings}
          saving={saving}
          onCreateBlank={handleCreateBlank}
          onClone={handleClone}
        />
      )}

      {activeExperiments.length > 0 && (
        <section className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Brewing
          </p>
          <ul className="space-y-2">
            {activeExperiments.map((exp) => (
              <ExperimentCard
                key={exp.id}
                exp={exp}
                deleteId={deleteId}
                setDeleteId={setDeleteId}
                onDelete={handleDelete}
                onNewVersion={handleNewVersion}
                router={router}
              />
            ))}
          </ul>
        </section>
      )}

      {promotedExperiments.length > 0 && (
        <section>
          <button
            onClick={() => setShowPromoted((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 hover:text-foreground transition-colors"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showPromoted ? "rotate-90" : ""}`} />
            Promoted to fillings
            <span className="font-normal normal-case tracking-normal">({promotedExperiments.length})</span>
          </button>
          {showPromoted && (
            <ul className="space-y-2">
              {promotedExperiments.map((exp) => (
                <ExperimentCard
                  key={exp.id}
                  exp={exp}
                  deleteId={deleteId}
                  setDeleteId={setDeleteId}
                  onDelete={handleDelete}
                  onNewVersion={handleNewVersion}
                  router={router}
                  muted
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function formatRelativeDate(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Updated today";
  if (diffDays === 1) return "Updated yesterday";
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  return `Updated ${d.toLocaleDateString("de-AT", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined })}`;
}

function CreateForm({
  mode,
  onCancel,
  nameInputRef,
  newName,
  setNewName,
  newGanacheType,
  setNewGanacheType,
  cloneFillingId,
  setCloneFillingId,
  ganacheFillings,
  saving,
  onCreateBlank,
  onClone,
}: {
  mode: "blank" | "clone";
  onCancel: () => void;
  nameInputRef: RefObject<HTMLInputElement | null>;
  newName: string;
  setNewName: (v: string) => void;
  newGanacheType: GanacheType;
  setNewGanacheType: (v: GanacheType) => void;
  cloneFillingId: string;
  setCloneFillingId: (v: string) => void;
  ganacheFillings: { id?: string; name: string }[];
  saving: boolean;
  onCreateBlank: () => void;
  onClone: () => void;
}) {
  const canSubmit = mode === "blank"
    ? newName.trim().length > 0 && !saving
    : newName.trim().length > 0 && !!cloneFillingId && !saving;

  return (
    <div className="mb-6 rounded-[4px] border border-[color:var(--ds-border-warm)] bg-muted p-4 space-y-3">
      <p className="text-sm font-medium">
        {mode === "blank" ? "New blank experiment" : "Clone a ganache filling"}
      </p>
      <div>
        <label className="label">Name</label>
        <input
          ref={nameInputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && canSubmit) {
              mode === "blank" ? onCreateBlank() : onClone();
            }
          }}
          placeholder="e.g. Raspberry dark ganache v2…"
          className="input w-full"
        />
      </div>
      {mode === "clone" && (
        <div>
          <label className="label">Source filling</label>
          <select
            value={cloneFillingId}
            onChange={(e) => setCloneFillingId(e.target.value || "")}
            className="input w-full"
          >
            <option value="">Select a ganache filling…</option>
            {ganacheFillings.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="label">Chocolate type</label>
        <select
          value={newGanacheType}
          onChange={(e) => setNewGanacheType(e.target.value as GanacheType)}
          className="input w-full"
        >
          {GANACHE_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={mode === "blank" ? onCreateBlank : onClone}
          disabled={!canSubmit}
          className="btn-primary px-4 py-1.5 text-sm"
        >
          {mode === "blank" ? "Create" : "Clone & open"}
        </button>
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ExperimentCard({
  exp,
  deleteId,
  setDeleteId,
  onDelete,
  onNewVersion,
  router,
  muted = false,
}: {
  exp: { id?: string; name: string; ganacheType?: string; status?: string; version?: number; promotedFillingId?: string; updatedAt?: Date };
  deleteId: string | null;
  setDeleteId: (id: string | null) => void;
  onDelete: (id: string) => void;
  onNewVersion: (id: string) => void;
  router: ReturnType<typeof useRouter>;
  muted?: boolean;
}) {
  const id = exp.id!;

  if (deleteId === id) {
    return (
      <li>
        <div className="p-3 rounded-[4px] border border-destructive/30 bg-destructive/5 text-sm space-y-2">
          <p className="font-medium">Delete &ldquo;{exp.name}&rdquo;?</p>
          <p className="text-muted-foreground text-xs">This experiment will be permanently removed.</p>
          <div className="flex gap-3">
            <button onClick={() => onDelete(id)} className="text-destructive font-medium text-xs hover:underline">
              Yes, delete
            </button>
            <button onClick={() => setDeleteId(null)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      </li>
    );
  }

  const typeLabel = exp.ganacheType
    ? exp.ganacheType.charAt(0).toUpperCase() + exp.ganacheType.slice(1)
    : null;
  const needsWork = exp.status === "to_improve";
  const isPromoted = exp.status === "promoted";

  return (
    <li>
      <div className={`rounded-[4px] border transition-colors ${muted ? "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]" : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]"}`}>
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`}>
                  {exp.name}
                </span>
                {(exp.version ?? 1) > 1 && (
                  <span className="text-xs text-muted-foreground/60 font-mono">v{exp.version}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {typeLabel && (
                  <span className="text-xs text-muted-foreground">{typeLabel} chocolate</span>
                )}
                {typeLabel && exp.updatedAt && (
                  <span className="text-xs text-muted-foreground/40">·</span>
                )}
                {exp.updatedAt && (
                  <span className="text-xs text-muted-foreground/60">{formatRelativeDate(exp.updatedAt)}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {needsWork && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-status-warn-bg text-status-warn font-medium">
                  Needs work
                </span>
              )}
              {isPromoted && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-status-ok-bg text-status-ok font-medium">
                  Promoted ✓
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 flex items-center gap-2">
          {!isPromoted && (
            <>
              <button
                onClick={() => router.push(`/calculator/${encodeURIComponent(id)}/run`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-accent text-primary-foreground text-xs font-semibold hover:bg-accent/90 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Make product
              </button>
              <button
                onClick={() => router.push(`/calculator/${encodeURIComponent(id)}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] border border-[color:var(--ds-border-warm)] text-xs text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit product
              </button>
              {needsWork && (
                <button
                  onClick={() => onNewVersion(id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] border border-[color:var(--ds-tier-quarter-focus)] text-xs text-primary hover:bg-[color:var(--ds-tint-info)] transition-colors"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  New version
                </button>
              )}
            </>
          )}
          {isPromoted && (
            <button
              onClick={() => exp.promotedFillingId
                ? router.push(`/fillings/${encodeURIComponent(exp.promotedFillingId)}`)
                : router.push(`/calculator/${encodeURIComponent(id)}`)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View filling <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setDeleteId(id)}
            className="ml-auto p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-full hover:bg-destructive/5"
            aria-label="Delete experiment"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}
