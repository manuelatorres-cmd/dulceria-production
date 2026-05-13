"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  useProductsList,
  useFillings,
  useIngredients,
  useMouldsList,
  usePackagingList,
  useMouldPool,
  useAllIngredientStock,
  useProductStockAlerts,
} from "@/lib/hooks";
import {
  PageHeader,
  Section,
  StatCard,
  HubCard,
} from "@/components/dulceria";
import {
  IconLeaf,
  IconArrowRight,
  IconAlertTriangle,
} from "@tabler/icons-react";

export default function PantryPage() {
  const products = useProductsList();
  const fillings = useFillings();
  const ingredients = useIngredients();
  const moulds = useMouldsList();
  const packaging = usePackagingList();
  const mouldPool = useMouldPool();
  const ingredientStock = useAllIngredientStock();
  const productStockAlerts = useProductStockAlerts();

  const brokenMoulds = useMemo(
    () => mouldPool.filter((m) => m.currentState === "broken"),
    [mouldPool],
  );
  const needsWashMoulds = useMemo(
    () =>
      mouldPool.filter(
        (m) => m.currentState === "needs-wash" || m.currentState === "in-deep-wash",
      ),
    [mouldPool],
  );

  const lowIngredients = useMemo(() => {
    const thresholdG = new Map<string, number>();
    const onHandG = new Map<string, number>();
    for (const s of ingredientStock) {
      onHandG.set(s.ingredientId, s.quantityG ?? 0);
      if (s.lowStockThresholdG != null) thresholdG.set(s.ingredientId, s.lowStockThresholdG);
    }
    return ingredients
      .filter((ing) => {
        if (!ing.id) return false;
        const t = thresholdG.get(ing.id);
        if (t == null) return false;
        return (onHandG.get(ing.id) ?? 0) <= t;
      })
      .map((ing) => ({ ...ing, thresholdG: thresholdG.get(ing.id!) ?? 0 }));
  }, [ingredients, ingredientStock]);

  const lowProducts = useMemo(() => {
    const out: Array<{ name: string; status: "low" | "gone"; id: string }> = [];
    for (const p of products) {
      if (!p.id) continue;
      const alert = productStockAlerts.get(p.id);
      if (alert) out.push({ id: p.id, name: p.name, status: alert });
    }
    return out.sort((a, b) =>
      a.status === b.status ? a.name.localeCompare(b.name) : a.status === "gone" ? -1 : 1,
    );
  }, [products, productStockAlerts]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Pantry"
        meta="Products, fillings, ingredients, moulds, packaging — the building blocks"
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            variant={lowProducts.length > 0 ? "warn" : "default"}
            label="Products"
            value={products.length}
            meta={`${lowProducts.length} low / gone`}
            onClick={() => (window.location.href = "/products")}
          />
          <StatCard
            variant="default"
            label="Fillings"
            value={fillings.length}
            meta="current versions"
            onClick={() => (window.location.href = "/fillings")}
          />
          <StatCard
            variant={lowIngredients.length > 0 ? "warn" : "default"}
            label="Ingredients"
            value={ingredients.length}
            meta={`${lowIngredients.length} below reorder`}
            onClick={() => (window.location.href = "/ingredients")}
          />
          <StatCard
            variant={brokenMoulds.length > 0 ? "urgent" : needsWashMoulds.length > 0 ? "warn" : "default"}
            label="Moulds"
            value={moulds.length}
            meta={`${brokenMoulds.length} broken · ${needsWashMoulds.length} need wash`}
            onClick={() => (window.location.href = "/moulds")}
          />
          <StatCard
            variant="default"
            label="Packaging"
            value={packaging.length}
            meta="SKUs"
            onClick={() => (window.location.href = "/packaging")}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 12,
          }}
        >
          <Section
            title="Stock alerts · products"
            action={
              <Link
                href="/stock"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ds-text-muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                className="hover:[color:var(--ds-text-primary)]"
              >
                Open <IconArrowRight size={11} stroke={1.5} />
              </Link>
            }
          >
            {lowProducts.length === 0 ? (
              <p
                style={{
                  padding: "16px",
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--ds-text-muted)",
                  fontSize: 12,
                }}
              >
                Every product has stock. Nothing to worry about.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {lowProducts.slice(0, 7).map((p) => (
                  <li key={p.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                    <Link
                      href={`/products/${p.id}`}
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
                      <IconAlertTriangle
                        size={14}
                        stroke={1.5}
                        style={{
                          color: p.status === "gone" ? "var(--ds-tier-urgent)" : "var(--ds-semantic-warn)",
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: p.status === "gone" ? "var(--ds-tier-urgent)" : "var(--ds-semantic-warn)",
                          fontWeight: 600,
                        }}
                      >
                        {p.status}
                      </span>
                    </Link>
                  </li>
                ))}
                {lowProducts.length > 7 && (
                  <li
                    style={{
                      padding: "8px 16px",
                      fontSize: 11,
                      color: "var(--ds-text-muted)",
                      fontStyle: "italic",
                      borderTop: "0.5px solid var(--ds-border-warm)",
                    }}
                  >
                    +{lowProducts.length - 7} more
                  </li>
                )}
              </ul>
            )}
          </Section>

          <Section
            title="Ingredients below reorder"
            action={
              <Link
                href="/ingredients"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ds-text-muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
                className="hover:[color:var(--ds-text-primary)]"
              >
                Open <IconArrowRight size={11} stroke={1.5} />
              </Link>
            }
          >
            {lowIngredients.length === 0 ? (
              <p
                style={{
                  padding: "16px",
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--ds-text-muted)",
                  fontSize: 12,
                }}
              >
                Every ingredient above reorder threshold.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {lowIngredients.slice(0, 7).map((ing) => (
                  <li key={ing.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                    <Link
                      href={`/ingredients/${ing.id}`}
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
                      <IconLeaf
                        size={14}
                        stroke={1.5}
                        style={{ color: "var(--ds-semantic-warn)", flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ing.name}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                        threshold {(ing.thresholdG / 1000).toFixed(1)}kg
                      </span>
                    </Link>
                  </li>
                ))}
                {lowIngredients.length > 7 && (
                  <li
                    style={{
                      padding: "8px 16px",
                      fontSize: 11,
                      color: "var(--ds-text-muted)",
                      fontStyle: "italic",
                      borderTop: "0.5px solid var(--ds-border-warm)",
                    }}
                  >
                    +{lowIngredients.length - 7} more
                  </li>
                )}
              </ul>
            )}
          </Section>
        </div>

        <Section title="Browse pantry">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard href="/products" icon="Package" title="Products" description="Catalogue + category groupings" />
            <HubCard href="/fillings" icon="Stack" title="Fillings" description="Current filling versions" />
            <HubCard href="/ingredients" icon="Leaf" title="Ingredients" description="Raw materials + composition data" />
            <HubCard href="/moulds" icon="Grid3x3" title="Moulds" description="Cavity weight + count specs" />
            <HubCard href="/packaging" icon="BoxMultiple" title="Packaging" description="Boxes + inserts + SKUs" />
            <HubCard href="/variants" icon="Calendar" title="Variants" description="Seasonal + standard assortments" />
            <HubCard href="/collections" icon="Tags" title="Collections" description="Variant labels grouped" />
            <HubCard href="/pantry/decoration" icon="Palette" title="Decoration" description="Cocoa butter, lustre dusts, designs" />
          </div>
        </Section>
      </div>
    </div>
  );
}
