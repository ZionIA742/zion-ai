// Browser-side contract for the independent human edit endpoint.
export type HumanQuoteEditBase = {
  id: string;
  status: string | null;
  updated_at: string | null;
  current_version_id: string | null;
  human_edit_eligible: boolean;
};
export type HumanQuoteEditItem = {
  id?: string | null;
  item_type: "pool" | "catalog_item" | "service" | "custom";
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
};
export type HumanQuoteEditFields = {
  title?: string;
  customer_notes?: string | null;
  internal_notes?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  warranty_terms?: string | null;
  validity_days?: string | number | null;
  discount_cents?: number;
  items?: readonly HumanQuoteEditItem[];
};
export type HumanQuoteEditRequest = Readonly<{
  quoteId: string;
  body: string;
  operationId: string | null;
  unversionedStatus: string | null;
}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function prepareHumanQuoteEditRequest(
  base: HumanQuoteEditBase,
  fields: HumanQuoteEditFields,
  pending: HumanQuoteEditRequest | null = null,
  createOperationId: () => string = () => crypto.randomUUID(),
): HumanQuoteEditRequest {
  if (base.human_edit_eligible !== true) throw new Error("Orcamento nao elegivel para edicao humana.");
  if (!UUID.test(base.id) || typeof base.updated_at !== "string" || !base.updated_at.trim()) {
    throw new Error("Recarregue o orcamento antes de editar.");
  }
  const version = base.current_version_id;
  if (version !== null && (typeof version !== "string" || !UUID.test(version))) {
    throw new Error("Versao invalida. Recarregue o orcamento.");
  }
  if (version === null && base.status !== "draft" && base.status !== "changes_requested") {
    throw new Error("Este orcamento sem versao precisa de regularizacao antes da edicao.");
  }
  const body = JSON.stringify({
    expected_updated_at: base.updated_at,
    expected_current_version_id: version,
    title: fields.title,
    customer_notes: fields.customer_notes,
    internal_notes: fields.internal_notes,
    payment_terms: fields.payment_terms,
    delivery_terms: fields.delivery_terms,
    warranty_terms: fields.warranty_terms,
    validity_days: fields.validity_days,
    discount_cents: fields.discount_cents,
    items: fields.items?.map((item) => ({
      id: item.id ?? null,
      item_type: item.item_type,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      discount_cents: item.discount_cents,
    })),
  });
  if (pending) {
    if (pending.quoteId !== base.id || pending.body !== body ||
        pending.unversionedStatus !== (version === null ? base.status : null) ||
        (version === null ? pending.operationId !== null : !UUID.test(pending.operationId ?? ""))) {
      throw new Error("Existe uma tentativa de salvamento pendente. Confirme seu resultado antes de alterar o conteudo.");
    }
    return pending;
  }
  const operationId = version === null ? null : createOperationId();
  if (operationId !== null && !UUID.test(operationId)) throw new Error("Operacao de edicao invalida.");
  return Object.freeze({ quoteId: base.id, body, operationId, unversionedStatus: version === null ? base.status : null });
}
export class HumanQuoteEditRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "HumanQuoteEditRequestError";
  }
}
export type HumanQuoteEditResult = {
  ok: true;
  quote: { id: string; status: string; current_version_id: string | null; updated_at: string };
  version_id?: string;
  version_number?: number;
  replayed?: boolean;
};
export async function submitHumanQuoteEditRequest(
  request: HumanQuoteEditRequest,
  send: typeof fetch = fetch,
): Promise<HumanQuoteEditResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.operationId !== null) headers["x-zion-quote-edit-operation-id"] = request.operationId;
  const response = await send(`/api/sales-quotes/${encodeURIComponent(request.quoteId)}/edit-human`, {
    method: "PATCH", cache: "no-store", headers, body: request.body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new HumanQuoteEditRequestError(response.status,
      typeof result?.error === "string" ? result.error : "HUMAN_QUOTE_EDIT_FAILED",
      typeof result?.message === "string" ? result.message : "Nao foi possivel confirmar o salvamento.");
  }
  const q = result.quote;
  if (q?.id !== request.quoteId || typeof q.status !== "string" ||
      typeof q.updated_at !== "string" || !q.updated_at.trim() ||
      (request.operationId === null
        ? q.current_version_id !== null || q.status !== request.unversionedStatus
        : result.version_id !== request.operationId || !UUID.test(q.current_version_id ?? "") ||
          !Number.isSafeInteger(result.version_number) || result.version_number <= 0)) {
    throw new HumanQuoteEditRequestError(502, "HUMAN_QUOTE_EDIT_RESULT_INVALID", "Recarregue o orcamento para confirmar o salvamento.");
  }
  return result as HumanQuoteEditResult;
}
