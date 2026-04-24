"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
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
  Package,
  Layers,
  Leaf,
  Grid3x3,
  Boxes,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

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
        (m) =>
          m.currentState === "needs-wash" || m.currentState === "in-deep-wash",
      ),
    [mouldPool],
  );

  const lowIngredients = useMemo(() => {
    const thresholdG = new Map<string, number>();
    const onHandG = new Map<string, number>();
    for (const s of ingredientStock) {
      onHandG.set(s.ingredientId, s.quantityG ?? 0);
      if (s.lowStockThresholdG != null)
        thresholdG.set(s.ingredientId, s.lowStockThresholdG);
    }
    return ingredients
      .filter((ing) => {
        if (!ing.id) return false;
        const t = thresholdG.get(ing.id);
        if (t == null) return false;
        return (onHandG.get(ing.id) ?? 0) <= t;
      })
      .map((ing) => ({
        ...ing,
        thresholdG: thresholdG.get(ing.id!) ?? 0,
      }));
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
    <div>
      <PageHeader
        title="Pantry"
        description="Products, fillings, ingredients, moulds, packaging — the building blocks."
      />

      <div className="px-4 pb-10 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi
            label="Products"
            value={products.length}
            sub={`${lowProducts.length} low / gone`}
            href="/products"
            icon={<Package className="w-4 h-4" />}
            accent={lowProducts.length > 0 ? "warn" : undefined}
          />
          <Kpi
            label="Fillings"
            value={fillings.length}
            sub="current versions"
            href="/fillings"
            icon={<Layers className="w-4 h-4" />}
          />
          <Kpi
            label="Ingredients"
            value={ingredients.length}
            sub={`${lowIngredients.length} below reorder`}
            href="/ingredients"
            icon={<Leaf className="w-4 h-4" />}
            accent={lowIngredients.length > 0 ? "warn" : undefined}
          />
          <Kpi
            label="Moulds"
            value={moulds.length}
            sub={`${brokenMoulds.length} broken · ${needsWashMoulds.length} need wash`}
            href="/moulds"
            icon={<Grid3x3 className="w-4 h-4" />}
            accent={brokenMoulds.length > 0 ? "alert" : needsWashMoulds.length > 0 ? "warn" : undefined}
          />
          <Kpi
            label="Packaging"
            value={packaging.length}
            sub="SKUs"
            href="/packaging"
            icon={<Boxes className="w-4 h-4" />}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DashCard title="Stock alerts · products" href="/stock">
            {lowProducts.length === 0 ? (
              <EmptyLine text="Every product has stock. Nothing to worry about." />
            ) : (
              <ul className="divide-y divide-border">
                {lowProducts.slice(0, 7).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/products/${p.id}`}
                      className="flex items-center gap-3 px-1 py-2 hover:bg-muted/30 rounded-sm"
                    >
                      <AlertTriangle
                        className={
                          "w-4 h-4 shrink-0 " +
                          (p.status === "gone"
                            ? "text-status-alert"
                            : "text-status-warn")
                        }
                      />
                      <span className="text-[13px] flex-1 truncate">
                        {p.name}
                      </span>
                      <span
                        className={
                          "text-[10.5px] uppercase tracking-wider " +
                          (p.status === "gone"
                            ? "text-status-alert"
                            : "text-status-warn")
                        }
                      >
                        {p.status}
                      </span>
                    </Link>
                  </li>
                ))}
                {lowProducts.length > 7 && (
                  <li className="pt-2 text-[11px] text-muted-foreground italic">
                    +{lowProducts.length - 7} more
                  </li>
                )}
              </ul>
            )}
          </DashCard>

          <DashCard title="Ingredients below reorder point" href="/ingredients">
            {lowIngredients.length === 0 ? (
              <EmptyLine text="Every ingredient above reorder threshold." />
            ) : (
              <ul className="divide-y divide-border">
                {lowIngredients.slice(0, 7).map((ing) => (
                  <li key={ing.id}>
                    <Link
                      href={`/ingredients/${ing.id}`}
                      className="flex items-center gap-3 px-1 py-2 hover:bg-muted/30 rounded-sm"
                    >
                      <Leaf className="w-4 h-4 text-status-warn shrink-0" />
                      <span className="text-[13px] flex-1 truncate">
                        {ing.name}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground tabular-nums">
                        threshold {(ing.thresholdG / 1000).toFixed(1)}kg
                      </span>
                    </Link>
                  </li>
                ))}
                {lowIngredients.length > 7 && (
                  <li className="pt-2 text-[11px] text-muted-foreground italic">
                    +{lowIngredients.length - 7} more
                  </li>
                )}
              </ul>
            )}
          </DashCard>
        </div>

        <QuickActions />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  href,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  href: string;
  accent?: "warn" | "alert";
}) {
  return (
    <Link
      href={href}
      className="block border border-border bg-card hover:border-foreground transition-colors px-3 py-3"
      style={{ borderRadius: 4 }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] uppercase text-muted-foreground"
          style={{ letterSpacing: "0.12em" }}
        >
          {label}
        </span>
        <span
          className={
            accent === "alert"
              ? "text-status-alert"
              : accent === "warn"
                ? "text-status-warn"
                : "text-muted-foreground"
          }
        >
          {icon}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[26px] leading-none tabular-nums"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
      </div>
      <div className="text-[10.5px] text-muted-foreground mt-1 truncate">
        {sub}
      </div>
    </Link>
  );
}

function DashCard({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="border border-border bg-card"
      style={{ borderRadius: 4 }}
    >
      <header className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3
          className="text-[13px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h3>
        {href && (
          <Link
            href={href}
            className="text-[10.5px] uppercase text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            style={{ letterSpacing: "0.1em" }}
          >
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </header>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p
      className="text-[12px] text-muted-foreground italic py-4"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      {text}
    </p>
  );
}

function QuickActions() {
  const actions = [
    { href: "/products", label: "Products" },
    { href: "/fillings", label: "Fillings" },
    { href: "/ingredients", label: "Ingredients" },
    { href: "/moulds", label: "Moulds" },
    { href: "/packaging", label: "Packaging" },
    { href: "/variants", label: "Variants" },
    { href: "/collections", label: "Collections" },
    { href: "/pantry/decoration", label: "Decoration" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="border border-border bg-muted hover:bg-card hover:border-foreground px-3 py-3 text-[12.5px]"
          style={{
            borderRadius: 3,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}
