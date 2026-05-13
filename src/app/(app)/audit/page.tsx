"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useProductsList, useVariants, useAllVariantPackagings, useAllVariantPackagingProducts,
  useAllVariantPackagingComponents, useIngredients, useFillings, useMouldsList,
  usePackagingList, useProductCategories, useAllFillingIngredients,
} from "@/lib/hooks";
import { IconAlertTriangle as AlertTriangle, IconCircleCheck as CheckCircle, IconChevronRight as ChevronRight, IconChevronDown as ChevronDown } from "@tabler/icons-react";
import { PageHeader, Section, StatCard } from "@/components/dulceria";

type Issue = {
  entity: string;       // table name e.g. "Product"
  name: string;         // row name e.g. "Strawberry Nougat"
  href: string;         // deep link to fix
  missing: string[];    // human-readable list of missing fields
};

export default function AuditPage() {
  const products = useProductsList(true);
  const variants = useVariants();
  const vps = useAllVariantPackagings();
  const vpProducts = useAllVariantPackagingProducts();
  const vpComponents = useAllVariantPackagingComponents();
  const ingredients = useIngredients();
  const fillings = useFillings();
  const fillingIngs = useAllFillingIngredients();
  const moulds = useMouldsList();
  const packagings = usePackagingList();
  const categories = useProductCategories(true);
  const catNameById = useMemo(() => new Map(categories.map((c) => [c.id!, c.name])), [categories]);

  // ── Build issues per entity ───────────────────────────────────
  const productIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    for (const p of products) {
      if (p.archived) continue;
      const missing: string[] = [];
      if (!p.productCategoryId) missing.push("category");
      if (!p.defaultMouldId) missing.push("default mould");
      const hasShellSource = !!p.shellIngredientId || !!p.shellFillingId;
      if (!hasShellSource && (p.shellPercentage ?? 0) > 0) missing.push("shell source");
      if (p.shellPercentage == null) missing.push("shell %");
      if (missing.length === 0) continue;
      out.push({
        entity: "Product", name: p.name, href: `/products/${p.id}`, missing,
      });
    }
    return out;
  }, [products]);

  const packagingMap = useMemo(() => new Map(packagings.map((p) => [p.id!, p])), [packagings]);

  const variantIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    const vpByVariant = new Map<string, typeof vps>();
    for (const vp of vps) {
      const arr = vpByVariant.get(vp.variantId) ?? [];
      arr.push(vp);
      vpByVariant.set(vp.variantId, arr);
    }
    const vpProdsByVp = new Map<string, typeof vpProducts>();
    for (const vpp of vpProducts) {
      const arr = vpProdsByVp.get(vpp.variantPackagingId) ?? [];
      arr.push(vpp);
      vpProdsByVp.set(vpp.variantPackagingId, arr);
    }
    void vpComponents;

    for (const v of variants) {
      const sizes = vpByVariant.get(v.id!) ?? [];
      if (sizes.length === 0) {
        out.push({
          entity: "Variant", name: v.name,
          href: `/variants/${v.id}`,
          missing: ["no sizes / packagings"],
        });
        continue;
      }
      // One row per problematic size — deep link via #vp-<id> anchor.
      for (const vp of sizes) {
        const sizeMissing: string[] = [];
        const price = vp.price > 0 ? vp.price : vp.sellPrice;
        if (!price || price <= 0) sizeMissing.push("price = 0");
        // Packaging-components check disabled: no UI yet to add them on the
        // variant page. Re-enable once that section ships.
        // Composition check — curated variants of any size (loose carries
        // exactly 1 product so production / cost / stock can resolve).
        if (v.kind === "curated") {
          const prods = vpProdsByVp.get(vp.id!) ?? [];
          if (prods.length === 0) {
            sizeMissing.push(vp.packagingId ? "no chocolate composition" : "no chocolate picked for loose size");
          } else {
            for (const pp of prods) {
              if (!pp.qty || pp.qty <= 0) {
                const prodName = products.find((p) => p.id === pp.productId)?.name ?? pp.productId.slice(0, 6);
                sizeMissing.push(`"${prodName}" qty = 0`);
              }
            }
          }
        }
        if (sizeMissing.length === 0) continue;
        const sizeLabel = vp.packagingId
          ? (packagingMap.get(vp.packagingId)?.name ?? `size ${vp.packagingId.slice(0, 4)}`)
          : "loose / no packaging";
        out.push({
          entity: "Variant",
          name: `${v.name} · ${sizeLabel}`,
          href: `/variants/${v.id}#vp-${vp.id}`,
          missing: sizeMissing,
        });
      }
    }
    return out;
  }, [variants, vps, vpProducts, vpComponents, products, packagingMap]);

  const ingredientIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    for (const i of ingredients) {
      if (i.archived || i.pricingIrrelevant) continue;
      const missing: string[] = [];
      const hasPurchase = !!i.purchaseCost && i.purchaseCost > 0;
      const hasLegacy = !!i.cost && i.cost > 0;
      if (!hasPurchase && !hasLegacy) missing.push("price");
      else if (hasPurchase && (!i.purchaseQty || i.purchaseQty <= 0)) missing.push("purchase qty");
      if (!i.category) missing.push("category");
      if (missing.length === 0) continue;
      out.push({
        entity: "Ingredient", name: i.name, href: `/ingredients/${i.id}`, missing,
      });
    }
    return out;
  }, [ingredients]);

  const fillingIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    const ingsByFilling = new Map<string, typeof fillingIngs>();
    for (const fi of fillingIngs) {
      const arr = ingsByFilling.get(fi.fillingId) ?? [];
      arr.push(fi);
      ingsByFilling.set(fi.fillingId, arr);
    }
    for (const f of fillings) {
      if (f.archived) continue;
      const missing: string[] = [];
      const ings = ingsByFilling.get(f.id!) ?? [];
      if (ings.length === 0) missing.push("no ingredients");
      if (!f.category) missing.push("category");
      // Shelf life feeds the auto-derived product shelf life. Without
      // it the product page can't compute a correct expiry → flag.
      if (f.shelfLifeWeeks == null || f.shelfLifeWeeks <= 0) missing.push("shelf life");
      if (missing.length === 0) continue;
      out.push({
        entity: "Filling", name: f.name, href: `/fillings/${f.id}`, missing,
      });
    }
    return out;
  }, [fillings, fillingIngs]);

  const mouldIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    for (const m of moulds) {
      if (m.archived) continue;
      const missing: string[] = [];
      if (!m.numberOfCavities || m.numberOfCavities <= 0) missing.push("number of cavities");
      if (!m.cavityWeightG || m.cavityWeightG <= 0) missing.push("cavity weight");
      if (missing.length === 0) continue;
      out.push({
        entity: "Mould", name: m.name, href: `/moulds/${m.id}`, missing,
      });
    }
    return out;
  }, [moulds]);

  const packagingIssues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    for (const p of packagings) {
      if (p.archived) continue;
      const missing: string[] = [];
      if (!p.capacity || p.capacity <= 0) missing.push("capacity");
      if (missing.length === 0) continue;
      out.push({
        entity: "Packaging", name: p.name, href: `/packaging/${p.id}`, missing,
      });
    }
    return out;
  }, [packagings]);

  const groups = [
    { title: "Variants", issues: variantIssues, color: "#9b4f48", bg: "#fdeeea" },
    { title: "Products", issues: productIssues, color: "#8a7030", bg: "#fdf8e2" },
    { title: "Ingredients", issues: ingredientIssues, color: "#4b6b8f", bg: "#eff5fb" },
    { title: "Fillings", issues: fillingIssues, color: "#6a4d89", bg: "#f3eef6" },
    { title: "Moulds", issues: mouldIssues, color: "#9a6640", bg: "#fdf1e2" },
    { title: "Packaging", issues: packagingIssues, color: "#5c7050", bg: "#eff3ec" },
  ];

  const totalIssues = groups.reduce((s, g) => s + g.issues.length, 0);

  const groupsWithIssues = groups.filter((g) => g.issues.length > 0);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Data audit"
        meta="Every product, variant, ingredient, filling, mould and packaging row checked against required fields · click any row to jump to the fix page"
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            variant={totalIssues === 0 ? "ok" : "urgent"}
            label="Rows needing attention"
            value={totalIssues}
            meta={
              totalIssues === 0
                ? "All clean — nothing missing"
                : `Across ${groupsWithIssues.length} table${groupsWithIssues.length === 1 ? "" : "s"}`
            }
            icon={
              totalIssues === 0 ? (
                <CheckCircle size={16} stroke={1.5} />
              ) : (
                <AlertTriangle size={16} stroke={1.5} />
              )
            }
          />
        </div>

        {groups.map((g) => (
          <AuditGroup key={g.title} title={g.title} issues={g.issues} color={g.color} bg={g.bg} />
        ))}
      </div>
    </div>
  );
}

function AuditGroup({ title, issues, color, bg }: { title: string; issues: Issue[]; color: string; bg: string }) {
  const [expanded, setExpanded] = useState(issues.length > 0 && issues.length <= 8);
  void color; void bg;
  return (
    <Section
      title={title}
      action={
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 12,
            background: issues.length === 0 ? "var(--ds-tint-ok)" : "var(--ds-tint-critical)",
            color: issues.length === 0 ? "var(--ds-tier-positive)" : "var(--ds-tier-urgent)",
            border: `0.5px solid ${issues.length === 0 ? "var(--ds-tier-positive)" : "var(--ds-tier-urgent)"}`,
          }}
        >
          {issues.length === 0 ? "all good" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </span>
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "10px 16px",
          background: "transparent",
          border: "none",
          borderTop: "0.5px solid var(--ds-border-warm)",
          fontSize: 12,
          color: "var(--ds-text-muted)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        className="hover:bg-[color:var(--ds-card-bg-hover)]"
      >
        {expanded ? <ChevronDown size={12} stroke={1.5} /> : <ChevronRight size={12} stroke={1.5} />}
        {expanded ? "Hide" : "Show"} issues
      </button>
      {expanded && issues.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {issues.map((i, idx) => (
            <li key={idx} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
              <Link
                href={i.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  textDecoration: "none",
                  color: "inherit",
                }}
                className="hover:bg-[color:var(--ds-card-bg-hover)]"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      fontSize: 13,
                    }}
                  >
                    {i.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--ds-text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Missing: {i.missing.join(" · ")}
                  </div>
                </div>
                <ChevronRight size={14} stroke={1.5} style={{ color: "var(--ds-text-muted)", flexShrink: 0 }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
