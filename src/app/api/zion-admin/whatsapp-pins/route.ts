import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export async function GET(request: Request) {
  const access = await resolveZionAdminApiAccess({
    requiredCapability: "manage_whatsapp_pins",
  });

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organization_id")?.trim().toLowerCase() || "";
    const storeId = url.searchParams.get("store_id")?.trim().toLowerCase() || "";
    if (!isUuid(organizationId) || !isUuid(storeId)) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PINS_SCOPE_REQUIRED",
          message: "Informe uma organizacao e uma loja validas.",
        },
        400,
      );
    }

    const serviceSupabase = createServiceSupabaseClient();
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id")
      .eq("id", storeId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (storeError || !store?.id) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PINS_SCOPE_INVALID",
          message: "A loja informada nao pertence a organizacao selecionada.",
        },
        404,
      );
    }

    const { data, error } = await serviceSupabase.rpc(
      "list_zion_admin_whatsapp_pins_by_system",
      { p_actor_user_id: access.sessionUserId },
    );

    if (error) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PINS_LIST_FAILED",
          message: "Nao foi possivel carregar os PINs administrativos.",
        },
        500,
      );
    }

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        pins: (Array.isArray(data) ? data : []).filter(
          (pin) =>
            pin &&
            pin.organization_id === organizationId &&
            pin.store_id === storeId,
        ),
      },
      200,
    );
  } catch {
    return createZionAdminApiJsonResponse(
      {
        ok: false,
        error: "ZION_ADMIN_WHATSAPP_PINS_LIST_FAILED",
        message: "Nao foi possivel carregar os PINs administrativos.",
      },
      500,
    );
  }
}
