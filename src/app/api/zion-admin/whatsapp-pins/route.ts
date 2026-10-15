import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveZionAdminApiAccess({
    requiredCapability: "manage_whatsapp_pins",
  });

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  try {
    const serviceSupabase = createServiceSupabaseClient();
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
      { ok: true, pins: Array.isArray(data) ? data : [] },
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
