import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { decryptWhatsappTwoStepPin } from "@/lib/server/whatsapp-two-step-pin-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export async function POST(request: Request) {
  const access = await resolveZionAdminApiAccess({
    requiredCapability: "manage_whatsapp_pins",
  });

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  try {
    const body = await request.json().catch(() => null);
    const secretId =
      typeof body?.secretId === "string" ? body.secretId.trim().toLowerCase() : "";
    const organizationId =
      typeof body?.organizationId === "string"
        ? body.organizationId.trim().toLowerCase()
        : "";
    const storeId =
      typeof body?.storeId === "string" ? body.storeId.trim().toLowerCase() : "";

    if (!isUuid(secretId) || !isUuid(organizationId) || !isUuid(storeId)) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PIN_ARGUMENTS_INVALID",
          message: "Informe uma loja e um PIN administrativos validos.",
        },
        400,
      );
    }

    const serviceSupabase = createServiceSupabaseClient();
    const { data, error } = await serviceSupabase.rpc(
      "read_zion_admin_whatsapp_pin_material_by_system",
      {
        p_actor_user_id: access.sessionUserId,
        p_secret_id: secretId,
        p_organization_id: organizationId,
        p_store_id: storeId,
      },
    );

    if (error) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PIN_REVEAL_FAILED",
          message: "Nao foi possivel revelar este PIN.",
        },
        500,
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.secret_id !== secretId) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PIN_NOT_ELIGIBLE",
          message: "Este PIN nao existe ou nao pode ser revelado.",
        },
        404,
      );
    }

    const pin = decryptWhatsappTwoStepPin({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    });

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        secretId,
        secretStatus: row.secret_status,
        pin,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "WHATSAPP_TWO_STEP_PIN_DECRYPT_FAILED") {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          error: "ZION_ADMIN_WHATSAPP_PIN_DECRYPT_FAILED",
          message: "Nao foi possivel descriptografar este PIN.",
        },
        500,
      );
    }

    return createZionAdminApiJsonResponse(
      {
        ok: false,
        error: "ZION_ADMIN_WHATSAPP_PIN_REVEAL_FAILED",
        message: "Nao foi possivel revelar este PIN.",
      },
      500,
    );
  }
}
