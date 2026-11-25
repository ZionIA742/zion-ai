import {
  QuoteAccessError,
  resolveAuthorizedQuoteScope,
} from "@/lib/server/sales-quotes/quote-auth";

const PAGE_SIZE = 30;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Restrict the search grammar before constructing the
// PostgREST filter. Wildcards and filter delimiters
// supplied by the caller are not accepted.
const SEARCH_PATTERN =
  /^[\p{L}\p{M}\p{N} .()+\/'-]*$/u;

function reply(
  body: Record<string, unknown>,
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function requireUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value.trim())
  ) {
    throw new QuoteAccessError(
      400,
      "INVALID_SCOPE",
      "Escopo invalido.",
    );
  }

  return value.trim().toLowerCase();
}

function readInput(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new QuoteAccessError(
      400,
      "INVALID_REQUEST",
      "Requisicao invalida.",
    );
  }

  const body = value as Record<string, unknown>;

  const organizationId = requireUuid(body.organizationId);
  const storeId = requireUuid(body.storeId);

  const search = body.search === undefined
    ? ""
    : body.search;

  if (
    typeof search !== "string" ||
    search.length > 80 ||
    !SEARCH_PATTERN.test(search)
  ) {
    throw new QuoteAccessError(
      400,
      "INVALID_SEARCH",
      "Pesquisa invalida.",
    );
  }

  const offset = body.offset === undefined
    ? 0
    : body.offset;

  if (
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1000000
  ) {
    throw new QuoteAccessError(
      400,
      "INVALID_OFFSET",
      "Paginacao invalida.",
    );
  }

  const leadId = body.leadId === undefined
    ? null
    : requireUuid(body.leadId);

  if (leadId && (search.trim() || offset !== 0)) {
    throw new QuoteAccessError(
      400,
      "INVALID_LEAD_LOOKUP",
      "Consulta individual invalida.",
    );
  }

  return {
    organizationId,
    storeId,
    search: search.trim(),
    offset,
    leadId,
  };
}

export async function POST(request: Request) {
  try {
    const input = readInput(
      await request.json().catch(() => null),
    );

    // Existing quote authority validates the actual
    // session and active organization membership.
    const scope = await resolveAuthorizedQuoteScope({
      requestOrganizationId: input.organizationId,
      requestStoreId: input.storeId,
    });

    if (
      scope.organizationId !== input.organizationId ||
      scope.store.id !== input.storeId
    ) {
      throw new QuoteAccessError(
        403,
        "SCOPE_MISMATCH",
        "Escopo divergente.",
      );
    }

    // Use the authenticated session client for lead reads.
    // Keep RLS active in addition to explicit tenant filters.
    let query = scope.sessionSupabase
      .from("leads")
      .select("id, organization_id, store_id, name, phone")
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id);

    if (input.leadId) {
      query = query.eq("id", input.leadId);
    } else if (input.search) {
      const pattern = "%" + input.search + "%";

      query = query.or(
        'name.ilike."' + pattern +
        '",phone.ilike."' + pattern + '"',
      );
    }

    // Request one additional row to indicate another page.
    const { data, error } = await query
      .order("name", {
        ascending: true,
        nullsFirst: false,
      })
      .order("id", { ascending: true })
      .range(input.offset, input.offset + PAGE_SIZE);

    if (error || !Array.isArray(data)) {
      return reply({
        ok: false,
        error: "LEAD_SEARCH_FAILED",
        message: "Nao foi possivel consultar os leads.",
      }, 500);
    }

    // Fail closed if the result contradicts the
    // authorized organization or selected store.
    if (
      data.length > PAGE_SIZE + 1 ||
      (input.leadId !== null && data.length > 1) ||
      data.some(row =>
        !row ||
        row.organization_id !== scope.organizationId ||
        row.store_id !== scope.store.id ||
        (input.leadId !== null && row.id !== input.leadId) ||
        typeof row.id !== "string" ||
        !UUID_PATTERN.test(row.id) ||
        (row.name !== null && typeof row.name !== "string") ||
        (row.phone !== null && typeof row.phone !== "string")
      )
    ) {
      return reply({
        ok: false,
        error: "LEAD_RESULT_SCOPE_INVALID",
        message: "Resultado de pesquisa invalido.",
      }, 500);
    }

    const hasMore = data.length > PAGE_SIZE;

    const leads = data.slice(0, PAGE_SIZE).map(row => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
    }));

    return reply({
      ok: true,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      leads,
      hasMore,
      nextOffset: hasMore
        ? input.offset + PAGE_SIZE
        : null,
    });
  } catch (error) {
    if (error instanceof QuoteAccessError) {
      return reply({
        ok: false,
        error: error.code,
        message:
          error.status === 401
            ? "Sessao indisponivel."
            : error.status === 403
              ? "Acesso nao autorizado."
              : error.status === 400
                ? "Parametros invalidos."
                : "Nao foi possivel consultar os leads.",
      }, error.status);
    }

    return reply({
      ok: false,
      error: "UNEXPECTED_ERROR",
      message: "Nao foi possivel consultar os leads.",
    }, 500);
  }
}
