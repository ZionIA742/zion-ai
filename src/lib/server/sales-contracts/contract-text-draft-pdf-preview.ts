/**
 * ZION P9: read-only PDF preview of the SAVED draft for one authorized opportunity.
 * This code has no access to storage writers, canonical contract versions, or messaging.
 * Authorization and tenant/opportunity checks are delegated to the existing draft GET.
 */
export type ContractTextDraftPdfPreviewDeps = {
  getAuthorizedDraft: (request: Request) => Promise<Response>;
  renderPdf: (input: { text: string }) => Promise<Uint8Array>;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_CHARS = 300_000;
const PDF_RENDER_CODES = new Set([
  "EMPTY_TEXT", "TEXT_TOO_LONG", "UNSUPPORTED_CHARACTER", "CONTROL_CHARACTER",
]);

function failure(status: number, error: string, message: string): Response {
  return Response.json(
    { ok: false, error, message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export function createContractTextDraftPdfPreviewHandler(deps: ContractTextDraftPdfPreviewDeps) {
  return async function GET(request: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return failure(400, "INVALID_PREVIEW_URL", "URL de pre-visualizacao invalida.");
    }
    const leadId = url.searchParams.get("leadId")?.trim() || "";
    const commercialOpportunityId = url.searchParams.get("commercialOpportunityId")?.trim() || "";
    if (
      url.searchParams.getAll("leadId").length !== 1 ||
      url.searchParams.getAll("commercialOpportunityId").length !== 1 ||
      !UUID.test(leadId) || !UUID.test(commercialOpportunityId)
    ) {
      return failure(400, "INVALID_PREVIEW_SCOPE", "Lead e oportunidade validos sao obrigatorios.");
    }

    // Call the already scoped, authenticated server-side draft GET. It selects the
    // current authorized store's active template version and SAVED draft only.
    let source: Response;
    try {
      source = await deps.getAuthorizedDraft(request);
    } catch {
      return failure(500, "DRAFT_PREVIEW_READ_FAILED", "Nao foi possivel recuperar o rascunho salvo.");
    }
    if (!source.ok) {
      // Preserve access denial, but never echo internal details or draft content.
      const status = [400, 401, 403, 404, 409].includes(source.status) ? source.status : 500;
      return failure(status, "DRAFT_PREVIEW_NOT_ALLOWED", "Nao foi possivel acessar o rascunho desta oportunidade.");
    }

    let parsed: unknown;
    try {
      parsed = await source.json();
    } catch {
      return failure(502, "DRAFT_PREVIEW_INVALID_SOURCE", "Resposta do rascunho invalida.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failure(502, "DRAFT_PREVIEW_INVALID_SOURCE", "Resposta do rascunho invalida.");
    }
    const sourceBody = parsed as Record<string, unknown>;
    if (sourceBody.ok !== true || !sourceBody.draft || typeof sourceBody.draft !== "object" || Array.isArray(sourceBody.draft)) {
      return failure(409, "DRAFT_PREVIEW_NO_SAVED_DRAFT", "Salve um rascunho antes de gerar a previa.");
    }
    const draft = sourceBody.draft as Record<string, unknown>;
    const text = draft.text;
    const revision = draft.revision;
    const templateVersionId = draft.templateVersionId;
    if (
      typeof text !== "string" || !text.trim() || text.length > MAX_CHARS ||
      typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
      typeof templateVersionId !== "string" || !UUID.test(templateVersionId) ||
      templateVersionId !== sourceBody.templateVersionId
    ) {
      return failure(409, "DRAFT_PREVIEW_INVALID_DRAFT", "O rascunho salvo esta indisponivel ou inconsistente.");
    }

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await deps.renderPdf({ text });
    } catch (error) {
      if (
        error && typeof error === "object" && "code" in error &&
        typeof error.code === "string" && PDF_RENDER_CODES.has(error.code)
      ) {
        return failure(422, "DRAFT_PREVIEW_RENDER_UNSUPPORTED", "O PDF nao pode representar integralmente este texto. Nenhum PDF foi produzido.");
      }
      return failure(500, "DRAFT_PREVIEW_RENDER_FAILED", "Nao foi possivel gerar a previa em PDF.");
    }
    if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
      return failure(500, "DRAFT_PREVIEW_RENDER_EMPTY", "O renderizador nao retornou um PDF valido.");
    }

    // Make an owned Uint8Array with an ArrayBuffer-backed type acceptable to Response.
    const body = new Uint8Array(pdfBytes.byteLength);
    body.set(pdfBytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="zion-contrato-rascunho-revisao-${revision}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-ZION-Draft-Revision": String(revision),
      },
    });
  };
}
