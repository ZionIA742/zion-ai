import type { SalesQuoteItemRow, SalesQuoteVersionRow } from "./types";
import { buildHumanQuoteVersionedEditRpcArgs } from "./human-quote-draft-edit-input";
import { buildQuoteSnapshot } from "./quote-versioning";

type Input = Parameters<typeof buildHumanQuoteVersionedEditRpcArgs>[0];
type SnapshotInput = Parameters<typeof buildQuoteSnapshot>[0];

// These values come from the authorized server scope, never from HTTP JSON.
export function prepareHumanQuoteVersionedSnapshot(args: Input & {
  previousVersion: SalesQuoteVersionRow;
  store: SnapshotInput["store"];
  lead: SnapshotInput["lead"];
  settings: SnapshotInput["settings"];
  generatedAt: string;
}) {
  const rpc = buildHumanQuoteVersionedEditRpcArgs(args);
  const { quote, previousVersion, store, lead, settings } = args;
  if (
    previousVersion.id !== rpc.p_expected_current_version_id ||
    previousVersion.quote_id !== quote.id ||
    previousVersion.organization_id !== quote.organization_id ||
    previousVersion.store_id !== quote.store_id ||
    store.id !== quote.store_id ||
    (lead?.id ?? null) !== quote.lead_id
  ) {
    throw new Error("HUMAN_REVISION_SNAPSHOT_SCOPE_MISMATCH");
  }

  const quoteKind = previousVersion.quote_kind ?? null;
  if (quoteKind !== null && quoteKind !== "preliminary" && quoteKind !== "definitive") {
    throw new Error("HUMAN_REVISION_SNAPSHOT_KIND_INVALID");
  }
  const generatedAt = new Date(args.generatedAt).toISOString();

  // Mirror the SQL writer's btrim (ASCII spaces) for legacy SKU values.
  const normalizedItems = rpc.p_items.map((item) => ({
    ...item,
    sku: item.sku?.replace(/^ +| +$/g, "") || null,
  }));
  const previousItems = new Map(args.currentItems.map((item) => [item.id.toLowerCase(), item]));
  const items: SalesQuoteItemRow[] = normalizedItems.map((item) => {
    const previous = previousItems.get(item.id);
    return {
      ...previous,
      ...item,
      quote_id: quote.id,
      organization_id: quote.organization_id,
      store_id: quote.store_id,
      created_at: previous?.created_at ?? null,
      updated_at: previous?.updated_at ?? null,
    };
  });
  const metadata = {
    ...quote.metadata,
    payment_terms: rpc.p_payment_terms,
    delivery_terms: rpc.p_delivery_terms,
    warranty_terms: rpc.p_warranty_terms,
    validity_days: rpc.p_validity_days,
    valid_until: rpc.p_valid_until,
  };
  const projectedQuote = {
    ...quote,
    status: "draft",
    current_version_id: rpc.p_operation_id,
    title: rpc.p_title,
    customer_notes: rpc.p_customer_notes,
    internal_notes: rpc.p_internal_notes,
    payment_terms: rpc.p_payment_terms,
    delivery_terms: rpc.p_delivery_terms,
    warranty_terms: rpc.p_warranty_terms,
    valid_until: rpc.p_valid_until,
    subtotal_cents: rpc.p_subtotal_cents,
    discount_cents: rpc.p_discount_cents,
    total_cents: rpc.p_total_cents,
    metadata,
  };
  const snapshot = {
    ...buildQuoteSnapshot({ quote: projectedQuote, items, store, lead, settings, quoteKind }),
    generatedAt,
  };
  return {
    quote: projectedQuote,
    items,
    snapshot,
    quoteKind,
    rpc: { ...rpc, p_items: normalizedItems, p_quote_snapshot: snapshot },
  };
}
