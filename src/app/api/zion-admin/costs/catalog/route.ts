import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";

export const dynamic = "force-dynamic";

const ACTIONS = ["created", "archived", "restored"] as const;
type CatalogAction = (typeof ACTIONS)[number];

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SERVICE_UNAVAILABLE");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function mapCatalogError(message: string): [number, string] {
  if (/CATALOG_ITEM_ALREADY_EXISTS/.test(message)) {
    return [409, "Este item já existe no catálogo. Reative-o se estiver arquivado."];
  }
  if (/CATALOG_OPERATION_KEY_REUSED/.test(message)) {
    return [409, "A chave desta operação já foi utilizada com dados diferentes."];
  }
  if (/CATALOG_ALREADY_ARCHIVED|CATALOG_ALREADY_ACTIVE/.test(message)) {
    return [409, "O estado do item mudou. Atualize a lista antes de continuar."];
  }
  if (/CATALOG_ITEM_NOT_FOUND/.test(message)) {
    return [404, "Item do catálogo não encontrado."];
  }
  if (/CATALOG_ACTOR_REQUIRED/.test(message)) {
    return [403, "Identidade administrativa inválida."];
  }
  if (/CATALOG_.*INVALID/.test(message)) {
    return [400, "Dados do catálogo inválidos."];
  }
  return [503, "Não foi possível confirmar a operação do catálogo."];
}

export async function GET() {
  const access = await resolveZionAdminApiAccess();

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  if (!access.resolution.capabilities.includes("manage_accounts")) {
    return createZionAdminApiJsonResponse(
      { error: "Acesso ao catálogo não autorizado." },
      403,
    );
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("zion_admin_variable_expense_catalog")
      .select("id,name,category,currency,created_at,updated_at,archived_at")
      .order("name", { ascending: true })
      .order("category", { ascending: true });

    if (error) {
      return createZionAdminApiJsonResponse(
        { error: "Catálogo temporariamente indisponível." },
        503,
      );
    }

    return createZionAdminApiJsonResponse(
      { items: data ?? [] },
      200,
    );
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Não foi possível consultar o catálogo." },
      503,
    );
  }
}

export async function POST(request: Request) {
  const access = await resolveZionAdminApiAccess();

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  if (!access.resolution.capabilities.includes("manage_accounts")) {
    return createZionAdminApiJsonResponse(
      { error: "Edição do catálogo não autorizada." },
      403,
    );
  }

  if (!isUuid(access.sessionUserId)) {
    return createZionAdminApiJsonResponse(
      { error: "Identidade administrativa inválida." },
      403,
    );
  }

  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Corpo da solicitação inválido." },
      400,
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createZionAdminApiJsonResponse(
      { error: "Dados do catálogo inválidos." },
      400,
    );
  }

  const payload = raw as Record<string, unknown>;
  const action = payload.action;

  if (typeof action !== "string" ||
      !(ACTIONS as readonly string[]).includes(action)) {
    return createZionAdminApiJsonResponse(
      { error: "Operação de catálogo inválida." },
      400,
    );
  }

  const catalogAction = action as CatalogAction;
  const operationKey = payload.operationKey;

  if (typeof operationKey !== "string" ||
      operationKey.length < 8 ||
      operationKey.length > 200 ||
      operationKey !== operationKey.trim()) {
    return createZionAdminApiJsonResponse(
      { error: "Chave da operação inválida." },
      400,
    );
  }

  let itemId: string | null = null;
  let name: string | null = null;
  let category: string | null = null;
  let currency: "BRL" | "USD" | null = null;

  if (catalogAction === "created") {
    if (payload.id != null ||
        typeof payload.name !== "string" ||
        typeof payload.category !== "string" ||
        (payload.currency !== "BRL" && payload.currency !== "USD")) {
      return createZionAdminApiJsonResponse(
        { error: "Dados do novo item inválidos." },
        400,
      );
    }

    name = payload.name.trim();
    category = payload.category.trim();
    currency = payload.currency;

    if (name.length < 1 || name.length > 100 ||
        category.length < 1 || category.length > 80) {
      return createZionAdminApiJsonResponse(
        { error: "Nome ou categoria inválidos." },
        400,
      );
    }
  } else {
    if (!isUuid(payload.id) ||
        payload.name != null ||
        payload.category != null ||
        payload.currency != null) {
      return createZionAdminApiJsonResponse(
        { error: "Identificador do item inválido." },
        400,
      );
    }

    itemId = payload.id;
  }

  try {
    const db = createServiceClient();

    const { data, error } = await db.rpc(
      "zion_admin_manage_variable_expense_catalog",
      {
        p_action: catalogAction,
        p_operation_key: operationKey,
        p_item_id: itemId,
        p_name: name,
        p_category: category,
        p_currency: currency,
        p_actor_id: access.sessionUserId,
      },
    );

    if (error) {
      const [status, message] = mapCatalogError(error.message || "");
      return createZionAdminApiJsonResponse({ error: message }, status);
    }

    if (!data || typeof data !== "object" ||
        Array.isArray(data) || !("item" in data)) {
      return createZionAdminApiJsonResponse(
        { error: "Resposta do catálogo não confirmada." },
        503,
      );
    }

    return createZionAdminApiJsonResponse(
      { ok: true, item: data.item, idempotent: data.idempotent },
      200,
    );
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Não foi possível confirmar a operação do catálogo." },
      503,
    );
  }
}