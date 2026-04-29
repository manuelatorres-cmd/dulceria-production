"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList,
  usePeople,
  useEquipment,
  useEquipmentInstances,
  useColdStorageUnits,
  useCampaigns,
  useStockLocationMinimums,
  useFillings,
} from "@/lib/hooks";

/**
 * Settings · Setup wizard
 *
 * Scans the database for missing required fields and surfaces a
 * one-screen checklist. Each section shows the gap, counts the
 * offenders, and links to the right edit page. Lets Manuela fill in
 * foundational data without hunting through every detail page.
 *
 * Intended as the first-run experience AND an ongoing data-health
 * dashboard — if a new product lands without MSVs, it shows up here.
 */
export default function SetupWizardPage() {
  const products = useProductsList(true);
  const people = usePeople(true);
  const equipment = useEquipment(true);
  const instances = useEquipmentInstances();
  const storage = useColdStorageUnits();
  const campaigns = useCampaigns();
  const stockMinimums = useStockLocationMinimums();
  const fillings = useFillings();

  // For each product: does it have a min set for at least one location?
  const missingMinProducts = useMemo(() => {
    const hasMin = new Set(stockMinimums.map((m) => m.productId));
    return products.filter(
      (p) => !p.archived && !hasMin.has(p.id ?? ""),
    );
  }, [products, stockMinimums]);

  // Products without a priority tier.
  const missingTierProducts = useMemo(
    () =>
      products.filter(
        (p) => !p.archived && (p.priorityTier === undefined || p.priorityTier === null),
      ),
    [products],
  );

  // People without a role / skills configured.
  const missingSkillPeople = useMemo(
    () =>
      people.filter(
        (p) => !p.archived && (!p.skills || p.skills.length === 0),
      ),
    [people],
  );

  // People without admin flag decision (for first run).
  const needsAdminDecision = people.filter((p) => !p.archived).length > 0 &&
    people.filter((p) => !p.archived && p.isAdmin).length === 0;

  // Equipment types without any physical instances.
  const equipmentWithoutInstances = useMemo(() => {
    const instEquipIds = new Set(instances.map((i) => i.equipmentId));
    return equipment.filter((e) => !e.archived && !instEquipIds.has(e.id ?? ""));
  }, [equipment, instances]);

  // Cold-storage units configured?
  const noColdStorage = storage.length === 0;

  // Fillings without a water activity / shelf life combination.
  const missingAwFillings = useMemo(
    () =>
      fillings.filter(
        (f) =>
          !f.archived &&
          ((f.waterActivity === undefined || f.waterActivity === null) ||
            !f.shelfLifeWeeks),
      ),
    [fillings],
  );

  const noCampaigns = campaigns.length === 0;

  const sections: SetupSection[] = [
    {
      key: "min-stock",
      title: "Minimum stock per product",
      description:
        "The brain can't propose replenishments without a minimum. Set one per product per location.",
      count: missingMinProducts.length,
      items: missingMinProducts.slice(0, 8).map((p) => ({
        label: p.name,
        href: `/products/${encodeURIComponent(p.id ?? "")}`,
      })),
      fixLabel: "Open product",
    },
    {
      key: "tier",
      title: "Priority tier",
      description:
        "Tier 1 = top seller never displaced; tier 2 normal; tier 3 first to push when capacity is tight. Set it so rush displacement works right.",
      count: missingTierProducts.length,
      items: missingTierProducts.slice(0, 8).map((p) => ({
        label: p.name,
        href: `/products/${encodeURIComponent(p.id ?? "")}`,
      })),
      fixLabel: "Set tier",
    },
    {
      key: "skills",
      title: "Staff skills",
      description:
        "Tag each person with skills (tempering, shelling, cooking, teaching, cleaning, packing). Needed for labor cost per batch + teaching gate.",
      count: missingSkillPeople.length,
      items: missingSkillPeople.slice(0, 8).map((p) => ({
        label: p.name,
        href: `/settings#people`,
      })),
      fixLabel: "Open person",
    },
    {
      key: "admin",
      title: "Admin role",
      description:
        "Pick at least one person who owns HACCP + contamination handling + analytics access.",
      count: needsAdminDecision ? 1 : 0,
      items: needsAdminDecision
        ? [
            {
              label: "No admin designated yet",
              href: `/settings#people`,
            },
          ]
        : [],
      fixLabel: "Assign admin",
    },
    {
      key: "equipment-instances",
      title: "Physical equipment instances",
      description:
        "Each equipment type needs at least one physical instance so the tempering dashboard can track chocolate loads.",
      count: equipmentWithoutInstances.length,
      items: equipmentWithoutInstances.slice(0, 8).map((e) => ({
        label: e.name,
        href: `/production-brain/equipment`,
      })),
      fixLabel: "Add instance",
    },
    {
      key: "cold-storage",
      title: "Cold-storage units",
      description:
        "Configure the fridges + freezers so HACCP temperature logs can land against a unit.",
      count: noColdStorage ? 1 : 0,
      items: noColdStorage
        ? [{ label: "No cold storage units configured", href: `/production-brain/haccp` }]
        : [],
      fixLabel: "Open HACCP",
    },
    {
      key: "fillings-aw",
      title: "Water activity on fillings",
      description:
        "Enter Aw per filling so shelf life is calculable. Optional for now, unlocks the shelf-life suggestion engine when on.",
      count: missingAwFillings.length,
      items: missingAwFillings.slice(0, 8).map((f) => ({
        label: f.name,
        href: `/fillings/${encodeURIComponent(f.id ?? "")}`,
      })),
      fixLabel: "Open filling",
    },
    {
      key: "campaigns",
      title: "Campaigns",
      description:
        "Seasonal + limited-edition campaigns drive ramp-up proposals. Add Easter / Mother's Day / Christmas etc.",
      count: noCampaigns ? 1 : 0,
      items: noCampaigns
        ? [{ label: "No campaigns yet", href: `/production-brain/planner` }]
        : [],
      fixLabel: "Plan a campaign",
    },
  ];

  const totalGaps = sections.reduce((s, sec) => s + sec.count, 0);

  return (
    <div>
      <PageHeader
        title="Setup"
        accent="First-run wizard"
        description="Data the brain needs before it can schedule properly. Fill each section or dismiss entries you don't plan to use yet."
      />

      <section
        className="mb-6 border border-border bg-card p-4"
        style={{ borderRadius: 4 }}
      >
        <div className="flex items-baseline justify-between">
          <h3
            className="text-[14px]"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            {totalGaps === 0 ? "All foundations set." : "Gaps to close"}
          </h3>
          <span
            className={
              "text-[10.5px] uppercase " +
              (totalGaps === 0 ? "text-status-ok" : "text-status-warn")
            }
            style={{ letterSpacing: "0.12em" }}
          >
            {totalGaps} {totalGaps === 1 ? "item" : "items"}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          Brain runs with partial data — you'll just get quieter proposals and
          a few empty states. Start where it hurts most.
        </p>
      </section>

      <div className="space-y-4">
        {sections.map((s) => (
          <Section key={s.key} section={s} />
        ))}
      </div>

      <footer
        className="mt-8 border-t border-border pt-5 text-[11px] text-muted-foreground max-w-2xl"
        style={{ letterSpacing: "0.01em" }}
      >
        You can always come back to this page — it stays accurate as you
        add products, people, fillings. If a section hits zero, it shows
        as green and stays folded out of your way.
      </footer>
    </div>
  );
}

function Section({ section }: { section: SetupSection }) {
  const done = section.count === 0;
  return (
    <section
      className={
        "border p-4 " +
        (done
          ? "bg-card border-border opacity-70"
          : "bg-card border-border")
      }
      style={{ borderRadius: 4 }}
    >
      <header className="flex items-baseline justify-between mb-2">
        <h4
          className="text-[14px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          {section.title}
          <span
            className={
              "ml-2 text-[10.5px] uppercase font-normal " +
              (done ? "text-status-ok" : "text-status-warn")
            }
            style={{ letterSpacing: "0.12em" }}
          >
            {done ? "✓ done" : `${section.count} missing`}
          </span>
        </h4>
      </header>
      <p className="text-[12px] text-muted-foreground leading-relaxed max-w-2xl mb-3">
        {section.description}
      </p>
      {section.items.length > 0 ? (
        <ul className="space-y-1">
          {section.items.map((it) => (
            <li
              key={it.href + it.label}
              className="flex items-center justify-between gap-3 text-[12.5px] px-3 py-1.5 bg-[color:var(--color-muted)] border border-border"
              style={{ borderRadius: 3 }}
            >
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {it.label}
              </span>
              <Link
                href={it.href}
                className="text-[10px] uppercase hover:text-foreground text-muted-foreground"
                style={{ letterSpacing: "0.1em" }}
              >
                {section.fixLabel} →
              </Link>
            </li>
          ))}
          {section.count > section.items.length ? (
            <li className="text-[10.5px] text-muted-foreground italic px-3 py-1">
              + {section.count - section.items.length} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

interface SetupSection {
  key: string;
  title: string;
  description: string;
  count: number;
  items: Array<{ label: string; href: string }>;
  fixLabel: string;
}
