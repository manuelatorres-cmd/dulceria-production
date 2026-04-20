"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useCustomer, saveCustomer, setCustomerArchived,
  useCustomerContacts, saveCustomerContact, deleteCustomerContact,
  useCustomerFollowups, saveCustomerFollowup, completeCustomerFollowup, deleteCustomerFollowup,
  useOrders, useAllOrderItems, useProductsList, useQuotes,
} from "@/lib/hooks";
import { computeCustomerAnalytics } from "@/lib/customerAnalytics";
import {
  ArrowLeft, Phone, Mail, Users, ClipboardList, Plus, Trash2, Check, Archive, FileText,
} from "lucide-react";
import {
  CUSTOMER_CONTACT_KINDS, CUSTOMER_CONTACT_LABELS,
  type CustomerContactKind,
  ORDER_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from "@/types";

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const customer = useCustomer(id);
  const contacts = useCustomerContacts(id);
  const followups = useCustomerFollowups(id);
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const products = useProductsList(true);
  const quotes = useQuotes({ customerId: id });

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    vatNumber: "",
    tags: "",
    notes: "",
  }));

  // Hydrate form when the customer first loads
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  if (customer && hydratedFor !== customer.id) {
    setForm({
      companyName: customer.companyName,
      contactName: customer.contactName ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      vatNumber: customer.vatNumber ?? "",
      tags: (customer.tags ?? []).join(", "),
      notes: customer.notes ?? "",
    });
    setHydratedFor(customer.id!);
  }

  const [newContactKind, setNewContactKind] = useState<CustomerContactKind>("call");
  const [newContactSummary, setNewContactSummary] = useState("");
  const [newContactBody, setNewContactBody] = useState("");

  const [newFollowupDue, setNewFollowupDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [newFollowupSubject, setNewFollowupSubject] = useState("");

  const analytics = useMemo(() => customer ? computeCustomerAnalytics({
    customerId: customer.id!,
    orders,
    orderItems,
    productRetailPrice: new Map(), // TODO wire retail price once available
  }) : null, [customer, orders, orderItems]);

  const customerOrders = useMemo(
    () => orders
      .filter((o) => o.customerId === id)
      .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime()),
    [orders, id],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, typeof orderItems>();
    for (const it of orderItems) {
      const arr = m.get(it.orderId) ?? [];
      arr.push(it);
      m.set(it.orderId, arr);
    }
    return m;
  }, [orderItems]);

  if (customer === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (customer === null) {
    return (
      <div className="p-6">
        <Link href="/customers" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to customers
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">Customer not found.</p>
      </div>
    );
  }

  async function handleSaveProfile() {
    if (!customer) return;
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    await saveCustomer({
      id: customer.id,
      companyName: form.companyName.trim(),
      contactName: form.contactName.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      vatNumber: form.vatNumber.trim() || undefined,
      tags,
      notes: form.notes.trim() || undefined,
      archived: customer.archived,
    });
    setEditing(false);
  }

  async function handleAddContact() {
    if (!customer || !newContactSummary.trim()) return;
    await saveCustomerContact({
      customerId: customer.id!,
      kind: newContactKind,
      summary: newContactSummary.trim(),
      body: newContactBody.trim() || undefined,
      contactedAt: new Date(),
    });
    setNewContactSummary("");
    setNewContactBody("");
    setNewContactKind("call");
  }

  async function handleAddFollowup() {
    if (!customer || !newFollowupSubject.trim() || !newFollowupDue) return;
    await saveCustomerFollowup({
      customerId: customer.id!,
      dueDate: newFollowupDue,
      subject: newFollowupSubject.trim(),
      origin: "manual",
    });
    setNewFollowupSubject("");
    setNewFollowupDue(new Date().toISOString().slice(0, 10));
  }

  return (
    <div>
      <PageHeader title={customer.companyName} description={customer.contactName ?? "B2B customer"} />
      <div className="px-4 pb-10 space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/customers" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> All customers
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/quotes/new?customerId=${encodeURIComponent(customer.id!)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent text-accent-foreground px-3 py-1.5 text-xs font-medium"
            >
              <FileText className="w-3.5 h-3.5" /> New quote
            </Link>
            <button
              onClick={() => setCustomerArchived(customer.id!, !customer.archived)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Archive className="w-3 h-3" /> {customer.archived ? "Restore" : "Archive"}
            </button>
          </div>
        </div>

        {/* Profile */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary">Profile</h2>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">Edit</button>
            )}
          </div>
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Company name</label>
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="input text-sm" />
              </div>
              <div>
                <label className="label">Contact name</label>
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="input text-sm" />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input text-sm" />
              </div>
              <div>
                <label className="label">Phone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input text-sm" />
              </div>
              <div>
                <label className="label">VAT number</label>
                <input value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} className="input text-sm" />
              </div>
              <div className="col-span-2">
                <label className="label">Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input text-sm" />
              </div>
              <div className="col-span-2">
                <label className="label">Tags (comma-separated)</label>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="hotel, pastry_shop" className="input text-sm" />
              </div>
              <div className="col-span-2">
                <label className="label">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="input text-sm resize-none" />
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <button onClick={() => { setEditing(false); setHydratedFor(null); }} className="text-xs text-muted-foreground">Cancel</button>
                <button onClick={handleSaveProfile} className="rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">Save</button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {customer.contactName && <><dt className="text-muted-foreground text-xs">Contact</dt><dd>{customer.contactName}</dd></>}
              {customer.email && <><dt className="text-muted-foreground text-xs">Email</dt><dd className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a></dd></>}
              {customer.phone && <><dt className="text-muted-foreground text-xs">Phone</dt><dd className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {customer.phone}</dd></>}
              {customer.vatNumber && <><dt className="text-muted-foreground text-xs">VAT</dt><dd className="font-mono text-xs">{customer.vatNumber}</dd></>}
              {customer.address && <><dt className="text-muted-foreground text-xs">Address</dt><dd>{customer.address}</dd></>}
              {customer.tags?.length ? (
                <><dt className="text-muted-foreground text-xs">Tags</dt>
                <dd className="flex gap-1 flex-wrap">
                  {customer.tags.map((t) => (<span key={t} className="rounded-full border border-border px-1.5 py-0 text-[10px]">{t}</span>))}
                </dd></>
              ) : null}
              {customer.notes && <><dt className="text-muted-foreground text-xs col-span-2">Notes</dt><dd className="col-span-2 text-xs text-foreground whitespace-pre-line">{customer.notes}</dd></>}
            </dl>
          )}
        </section>

        {/* Analytics */}
        {analytics && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-primary mb-3">Performance</h2>
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Orders" value={`${analytics.orderCount}`} />
              <Metric label="Lifetime" value={`€${analytics.lifetimeValue.toFixed(2)}`} />
              <Metric label="Avg order" value={`€${analytics.averageOrderValue.toFixed(2)}`} />
              <Metric
                label="Last order"
                value={
                  analytics.daysSinceLastOrder == null
                    ? "—"
                    : analytics.daysSinceLastOrder === 0
                      ? "today"
                      : `${analytics.daysSinceLastOrder}d ago`
                }
              />
            </div>
            {analytics.medianDaysBetweenOrders != null && (
              <p className="mt-2 text-xs text-muted-foreground">
                Typical gap between orders: {Math.round(analytics.medianDaysBetweenOrders)} days
              </p>
            )}
            {analytics.seasonalSuggestion && (
              <div className="mt-3 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-foreground">
                <p className="font-medium text-primary">Seasonal reminder</p>
                <p className="mt-0.5">{analytics.seasonalSuggestion.note}</p>
                <button
                  onClick={async () => {
                    const d = analytics.seasonalSuggestion!.suggestedFollowupOn;
                    await saveCustomerFollowup({
                      customerId: customer!.id!,
                      dueDate: d.toISOString().slice(0, 10),
                      subject: "Seasonal follow-up",
                      notes: analytics.seasonalSuggestion!.note,
                      origin: "seasonal",
                    });
                  }}
                  className="mt-1.5 text-xs text-primary hover:underline"
                >
                  Add as follow-up →
                </button>
              </div>
            )}
          </section>
        )}

        {/* Contact log */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5"><Users className="w-4 h-4" /> Contact log</h2>
            <span className="text-xs text-muted-foreground">{contacts.length} {contacts.length === 1 ? "entry" : "entries"}</span>
          </div>
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              {CUSTOMER_CONTACT_KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => setNewContactKind(k)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${newContactKind === k ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground"}`}
                >
                  {CUSTOMER_CONTACT_LABELS[k]}
                </button>
              ))}
            </div>
            <input
              value={newContactSummary}
              onChange={(e) => setNewContactSummary(e.target.value)}
              placeholder="Summary (e.g. 'Asked about Christmas hampers')"
              className="input text-sm"
            />
            <textarea
              value={newContactBody}
              onChange={(e) => setNewContactBody(e.target.value)}
              placeholder="Full notes (optional)"
              rows={2}
              className="input text-sm resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={handleAddContact}
                disabled={!newContactSummary.trim()}
                className="rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Log contact
              </button>
            </div>
          </div>
          {contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No contact log entries yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {contacts.map((c) => (
                <li key={c.id} className="px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{CUSTOMER_CONTACT_LABELS[c.kind]}</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(c.contactedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                      <p className="text-sm mt-0.5">{c.summary}</p>
                      {c.body && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{c.body}</p>}
                    </div>
                    <button
                      onClick={() => deleteCustomerContact(c.id!)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete contact log entry"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Follow-ups */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Follow-ups</h2>
            <span className="text-xs text-muted-foreground">
              {followups.filter((f) => !f.completedAt).length} open
            </span>
          </div>
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <input
                type="date"
                value={newFollowupDue}
                onChange={(e) => setNewFollowupDue(e.target.value)}
                className="input text-sm w-auto"
              />
              <input
                value={newFollowupSubject}
                onChange={(e) => setNewFollowupSubject(e.target.value)}
                placeholder="What to follow up on"
                className="input text-sm flex-1 min-w-0"
              />
              <button
                onClick={handleAddFollowup}
                disabled={!newFollowupSubject.trim() || !newFollowupDue}
                className="rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
          {followups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No follow-ups yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {followups.map((f) => {
                const overdue = !f.completedAt && new Date(f.dueDate) < new Date(new Date().toISOString().slice(0, 10));
                return (
                  <li key={f.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <button
                      onClick={() => completeCustomerFollowup(f.id!, !f.completedAt)}
                      className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        f.completedAt
                          ? "bg-status-ok border-status-ok text-white"
                          : overdue
                            ? "border-status-alert"
                            : "border-border"
                      }`}
                      aria-label="Toggle complete"
                    >
                      {f.completedAt && <Check className="w-2.5 h-2.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${f.completedAt ? "line-through text-muted-foreground" : ""}`}>{f.subject}</p>
                      <p className={`text-[11px] ${overdue && !f.completedAt ? "text-status-alert" : "text-muted-foreground"}`}>
                        due {new Date(f.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {f.origin === "seasonal" && " · seasonal"}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteCustomerFollowup(f.id!)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete follow-up"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Order history */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary">Order history</h2>
            <span className="text-xs text-muted-foreground">{customerOrders.length} {customerOrders.length === 1 ? "order" : "orders"}</span>
          </div>
          {customerOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No orders linked to this customer yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {customerOrders.map((o) => {
                const items = itemsByOrder.get(o.id!) ?? [];
                const value = items.reduce((acc, it) => acc + (it.unitPrice ?? 0) * it.quantity, 0);
                return (
                  <li key={o.id}>
                    <Link href={`/orders/${encodeURIComponent(o.id!)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30">
                      <div className="min-w-0">
                        <p className="text-sm truncate">
                          {items.length > 0
                            ? items.map((it) => `${productById.get(it.productId)?.name ?? "Product"} ×${it.quantity}`).join(", ")
                            : <span className="text-muted-foreground italic">no items</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {ORDER_STATUS_LABELS[o.status]}
                          {" · "}
                          deadline {new Date(o.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </div>
                      {value > 0 && <span className="text-xs tabular-nums shrink-0">€{value.toFixed(2)}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quotes */}
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5"><FileText className="w-4 h-4" /> Quotes</h2>
            <Link
              href={`/quotes/new?customerId=${encodeURIComponent(customer.id!)}`}
              className="text-xs text-primary hover:underline"
            >
              New quote →
            </Link>
          </div>
          {quotes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No quotes yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {quotes.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotes/${encodeURIComponent(q.id!)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{q.title || "Untitled quote"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {QUOTE_STATUS_LABELS[q.status]}
                        {q.sellPrice != null && ` · €${Number(q.sellPrice).toFixed(2)}`}
                        {q.marginPercent != null && ` · ${Number(q.marginPercent).toFixed(0)}% margin`}
                      </p>
                    </div>
                    {q.feasible === false && (
                      <span className="text-[10px] text-status-warn uppercase tracking-wide">at risk</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
