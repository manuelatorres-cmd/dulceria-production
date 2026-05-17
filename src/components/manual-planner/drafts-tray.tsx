"use client";

/**
 * Horizontal strip of in-progress drafts (spec §3.4).
 *
 * One card per parked productionPlans row (status='draft') from
 * useDraftPlans(), plus a synthetic "active" card for the localStorage
 * draft if one exists. Cards are click-to-load and draggable onto the
 * week strip to set pinnedDate.
 */

import { useDraggable } from "@dnd-kit/core";
import type { DraftPlanCard } from "@/lib/hooks";
import type { DraftBatch } from "@/lib/manual-planner/draft-state";

export type TrayCardKind = "active" | "parked";

export interface TrayCard {
  kind: TrayCardKind;
  /** For parked: productionPlans.id. For active: synthetic 'active-draft'. */
  id: string;
  name: string;
  productName: string;
  mouldName: string;
  numberOfCavities: number;
  mouldCount: number;
  totalPieces: number;
  totalDemand: number;
  allocationCount: number;
  surplus: number;
  /** Active-draft pin (from localStorage). Parked is always null. */
  pinnedDate: string | null;
}

export function buildTrayCards(
  parked: DraftPlanCard[],
  active: DraftBatch | null,
): TrayCard[] {
  const cards: TrayCard[] = [];
  if (active) {
    cards.push({
      kind: "active",
      id: "active-draft",
      name: active.name,
      productName: active.productName,
      mouldName: active.mouldName,
      numberOfCavities: active.numberOfCavities,
      mouldCount: active.mouldCount,
      totalPieces: active.totalPieces,
      totalDemand: active.totalDemand,
      allocationCount: active.allocations.length,
      surplus: active.surplus,
      pinnedDate: active.pinnedDate,
    });
  }
  for (const p of parked) {
    cards.push({
      kind: "parked",
      id: p.planId,
      name: p.name,
      productName: p.productName,
      mouldName: p.mouldName,
      numberOfCavities: p.numberOfCavities,
      mouldCount: p.mouldCount,
      totalPieces: p.totalPieces,
      totalDemand: p.totalDemand,
      allocationCount: p.allocationCount,
      surplus: p.surplus,
      pinnedDate: null,
    });
  }
  return cards;
}

export function DraftsTray({
  cards,
  onLoadCard,
  onDeleteCard,
  onNewDraft,
}: {
  cards: TrayCard[];
  onLoadCard: (card: TrayCard) => void;
  onDeleteCard: (card: TrayCard) => void;
  onNewDraft: () => void;
}) {
  return (
    <section
      aria-label="Drafts in progress"
      style={{
        background: "var(--ds-card-bg, #fff)",
        border: "0.5px solid var(--ds-border-warm, #d8d2c7)",
        borderRadius: 6,
        padding: 10,
        marginBottom: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          Drafts · {cards.length} in progress
        </span>
        <span style={{ flex: 1, color: "var(--ds-text-muted, #7a766f)" }}>
          click to edit · drag onto a day to save &amp; pin
        </span>
        <button
          type="button"
          onClick={onNewDraft}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 4,
            border: "0.5px solid var(--ds-border-warm, #d8d2c7)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          + new draft
        </button>
      </header>
      <div
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {cards.length === 0 ? (
          <p
            style={{
              fontSize: 11,
              fontStyle: "italic",
              color: "var(--ds-text-muted, #7a766f)",
              padding: "8px 4px",
            }}
          >
            No drafts yet. Tick a demand line on the left to start one.
          </p>
        ) : (
          cards.map((card) => (
            <DraftCard
              key={card.id}
              card={card}
              onClick={() => onLoadCard(card)}
              onContextMenu={(e) => {
                e.preventDefault();
                onDeleteCard(card);
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraftCard({
  card,
  onClick,
  onContextMenu,
}: {
  card: TrayCard;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `draft-card-${card.id}`,
    data: { kind: "draft-card", trayCardId: card.id, trayCardKind: card.kind },
  });

  // Visual variant per spec
  let bg: string;
  let border: string;
  let pillBg: string;
  let pillFg: string;
  let pillLabel: string;
  if (card.kind === "active") {
    bg = "var(--ds-primary, #1c3937)";
    border = "1px solid var(--ds-primary, #1c3937)";
    pillBg = "rgba(255,255,255,0.18)";
    pillFg = "#fff";
    pillLabel = "editing";
  } else if (card.pinnedDate) {
    bg = "#fff8e6";
    border = "1px solid #e6c97a";
    pillBg = "#e6c97a";
    pillFg = "#1f1d18";
    pillLabel = `pinned · ${shortDow(card.pinnedDate)}`;
  } else {
    bg = "var(--ds-card-bg, #fff)";
    border = "0.5px dashed var(--ds-border-warm, #d8d2c7)";
    pillBg = "rgba(0,0,0,0.05)";
    pillFg = "var(--ds-text-muted, #7a766f)";
    pillLabel = "unscheduled";
  }

  const isActive = card.kind === "active";

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
      title={isActive ? "Active editor" : "Click to load · right-click to delete"}
      style={{
        minWidth: 200,
        maxWidth: 240,
        padding: "8px 10px",
        borderRadius: 6,
        border,
        background: bg,
        color: isActive ? "#fff" : "var(--ds-text-primary, #1f1d18)",
        textAlign: "left",
        cursor: "grab",
        opacity: isDragging ? 0.4 : 1,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "opacity 0.1s ease",
      }}
    >
      <span
        style={{
          alignSelf: "flex-start",
          fontSize: 9,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          padding: "1px 6px",
          borderRadius: 999,
          background: pillBg,
          color: pillFg,
        }}
      >
        {pillLabel}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{card.productName}</span>
      <span
        style={{
          fontSize: 10,
          opacity: isActive ? 0.85 : 0.7,
        }}
      >
        {card.allocationCount} lines · {card.mouldName}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          fontSize: 11,
        }}
      >
        <span className="tabular-nums" style={{ fontWeight: 600 }}>
          {card.totalDemand} / {card.totalPieces}
        </span>
        <span style={{ opacity: isActive ? 0.85 : 0.65 }}>
          {card.mouldCount} fills{card.surplus > 0 ? ` · +${card.surplus} surplus` : ""}
        </span>
      </div>
    </button>
  );
}

function shortDow(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
