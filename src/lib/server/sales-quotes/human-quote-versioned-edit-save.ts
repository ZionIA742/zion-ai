import { createHash } from "node:crypto";
import { QuoteAccessError, type resolveAuthorizedExistingQuote } from "./quote-auth";
import { assertHumanQuoteEditEligibility } from "./human-quote-edit-provenance";
import { prepareHumanQuoteVersionedSnapshot } from "./human-quote-versioned-edit-snapshot";
import { renderHumanQuoteRevisionPdf } from "./human-quote-versioned-edit-pdf-render";
import { storeHumanQuoteRevisionPdf } from "./human-quote-versioned-edit-pdf-storage";
import type { SalesQuoteItemRow, SalesQuoteVersionRow } from "./types";

type Scope = Awaited<ReturnType<typeof resolveAuthorizedExistingQuote>>;
type Preparation = Parameters<typeof prepareHumanQuoteVersionedSnapshot>[0];
type Visual = Omit<Parameters<typeof renderHumanQuoteRevisionPdf>[0], "prepared">;
type Presentation = Visual & { settings: Preparation["settings"] };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Canonical JSON preserves array order and ignores object key order.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new QuoteAccessError(400, "INVALID_EDIT_INPUT", "Dados de edicao invalidos.");
}

function conflict(): never {
  throw new QuoteAccessError(409, "HUMAN_REVISION_OPERATION_CONFLICT", "Esta operacao ja foi utilizada com outros dados.");
}

// The caller must resolve authorization from the session, never from the request body.
export async function saveHumanQuoteVersionedEdit(args: {
  scope: Scope;
  operationId: string;
  body: unknown;
  loadPresentation: () => Promise<Presentation>;
}) {
  const { scope } = args;
  const { quote, supabase } = scope;
  assertHumanQuoteEditEligibility(quote);
  if (scope.organizationId !== quote.organization_id || scope.store.id !== quote.store_id) {
    throw new QuoteAccessError(403, "HUMAN_REVISION_SCOPE_MISMATCH", "Orcamento fora do escopo.");
  }
  if (typeof args.operationId !== "string" || !UUID_RE.test(args.operationId)) {
    throw new QuoteAccessError(400, "INVALID_REVISION_OPERATION_ID", "Identificador de operacao invalido.");
  }
  if (!args.body || typeof args.body !== "object" || Array.isArray(args.body)) {
    throw new QuoteAccessError(400, "INVALID_EDIT_INPUT", "Dados de edicao invalidos.");
  }
  const body = structuredClone(args.body) as Record<string, unknown>;
  const operationId = args.operationId.toLowerCase();
  const fingerprint = createHash("sha256").update(canonicalJson([
    "zion-human-edit-http-v1", quote.organization_id, quote.store_id, quote.id,
    scope.user.id, operationId, body,
  ])).digest("hex");

  async function readReplay() {
    const { data: row, error } = await supabase.from("sales_quote_versions")
      .select("id,quote_id,organization_id,store_id,version_number,generated_by,store_file_id,quote_snapshot")
      .eq("id", operationId).eq("quote_id", quote.id)
      .eq("organization_id", quote.organization_id).eq("store_id", quote.store_id).maybeSingle();
    if (error) throw new Error("HUMAN_REVISION_REPLAY_READ_FAILED");
    if (!row) return null;
    if (row.id !== operationId || row.quote_id !== quote.id || row.organization_id !== quote.organization_id ||
        row.store_id !== quote.store_id || row.generated_by !== "human_revision" || !row.store_file_id ||
        row.quote_snapshot?.humanEditRequest?.sha256 !== fingerprint ||
        !Number.isInteger(row.version_number) || row.version_number <= 0) conflict();
    const { data: current, error: currentError } = await supabase.from("sales_quotes")
      .select("id,current_version_id,updated_at,status")
      .eq("id", quote.id).eq("organization_id", quote.organization_id).eq("store_id", quote.store_id).maybeSingle();
    if (currentError || !current || current.id !== quote.id) throw new Error("HUMAN_REVISION_REPLAY_QUOTE_READ_FAILED");
    return {
      quote_id: quote.id, version_id: row.id, version_number: row.version_number,
      current_version_id: current.current_version_id, updated_at: current.updated_at,
      quote_status: current.status, replayed: true,
    };
  }

  const replay = await readReplay();
  if (replay) return replay;
  const previousId = quote.current_version_id;
  if (!previousId || body.expected_current_version_id !== previousId || body.expected_updated_at !== quote.updated_at) {
    throw new QuoteAccessError(409, "HUMAN_QUOTE_EDIT_STALE", "O orcamento mudou. Atualize antes de editar.");
  }
  const { data: previousVersion, error: versionError } = await supabase.from("sales_quote_versions")
    .select("id,quote_id,organization_id,store_id,version_number,status,quote_kind,store_file_id,storage_bucket,storage_path,quote_snapshot,created_at")
    .eq("id", previousId).eq("quote_id", quote.id).eq("organization_id", quote.organization_id)
    .eq("store_id", quote.store_id).maybeSingle();
  if (versionError || !previousVersion) throw new Error("HUMAN_REVISION_PREVIOUS_VERSION_READ_FAILED");
  const { data: items, error: itemsError } = await supabase.from("sales_quote_items").select("*")
    .eq("quote_id", quote.id).eq("organization_id", quote.organization_id).eq("store_id", quote.store_id)
    .order("sort_order", { ascending: true });
  if (itemsError || !items) throw new Error("HUMAN_REVISION_ITEMS_READ_FAILED");
  const visual = await args.loadPresentation();
  const prepared = prepareHumanQuoteVersionedSnapshot({
    quote, currentItems: items as SalesQuoteItemRow[], body, operationId,
    previousVersion: previousVersion as SalesQuoteVersionRow, store: scope.store, lead: scope.lead,
    settings: visual.settings, generatedAt: new Date().toISOString(),
  });
  const rendered = await renderHumanQuoteRevisionPdf({ prepared, storeLogo: visual.storeLogo, brandVisual: visual.brandVisual });
  const stored = await storeHumanQuoteRevisionPdf({ supabase, prepared, pdfBytes: rendered.pdfBytes });
  const { data, error } = await supabase.rpc("apply_human_sales_quote_versioned_edit_by_system", {
    ...rendered.rpc,
    p_store_file_id: stored.storeFileId,
    p_quote_snapshot: { ...rendered.snapshot, humanEditRequest: { sha256: fingerprint } },
  });
  if (error) {
    // Handles an ambiguous response or a concurrent successful duplicate without a second write.
    const completed = await readReplay();
    if (completed) return completed;
    if (error.code === "40001" || error.code === "23505") {
      throw new QuoteAccessError(409, "HUMAN_QUOTE_EDIT_CONFLICT", "O orcamento mudou ou a operacao ja foi utilizada.");
    }
    throw new Error("HUMAN_REVISION_SAVE_FAILED");
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.quote_id !== quote.id || result.version_id !== operationId ||
      !Number.isInteger(result.version_number) || result.version_number <= 0 ||
      typeof result.replayed !== "boolean" || typeof result.updated_at !== "string" ||
      (!result.replayed && (result.current_version_id !== operationId || result.quote_status !== "draft"))) {
    throw new Error("HUMAN_REVISION_SAVE_RESULT_INVALID");
  }
  return {
    quote_id: result.quote_id, version_id: result.version_id, version_number: result.version_number,
    current_version_id: result.current_version_id, updated_at: result.updated_at,
    quote_status: result.quote_status, replayed: result.replayed,
  };
}
