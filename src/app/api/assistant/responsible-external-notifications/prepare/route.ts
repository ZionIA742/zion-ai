import { NextResponse } from "next/server";
import { prepareResponsibleExternalNotification } from "@/lib/server/assistant/responsible-external-notifications";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  organizationId?: string;
  storeId?: string;
  notificationId?: string;
  notificationIds?: unknown;
};

type PrepareNotification = typeof prepareResponsibleExternalNotification;

type PostHandlerDeps = {
  resolveAccess?: typeof resolveStoreApiAccess;
  prepareNotification?: PrepareNotification;
  resolveAccessDeps?: Partial<ResolveStoreApiAccessDeps>;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildTenantMismatchResponse(kind: "organization" | "store") {
  return buildJsonResponse(
    {
      ok: false,
      updated: false,
      reason: "forbidden",
      message:
        kind === "organization"
          ? "organizationId nao corresponde ao tenant autorizado."
          : "storeId nao corresponde a loja autorizada.",
    },
    403,
  );
}

export function createResponsibleExternalNotificationsPreparePostHandler(
  deps: PostHandlerDeps = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const prepareNotification =
    deps.prepareNotification ?? prepareResponsibleExternalNotification;

  return async function handleResponsibleExternalNotificationsPreparePost(
    request: Request,
  ) {
    try {
      const access = await resolveAccess({
        requirement: "active",
        deps: deps.resolveAccessDeps,
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const body = (await request.json().catch(() => ({}))) as PrepareBody;
      const organizationId = String(body.organizationId || "").trim();
      const storeId = String(body.storeId || "").trim();
      const notificationId = String(body.notificationId || "").trim();

      if (
        Array.isArray(body.notificationIds) ||
        Array.isArray(body.notificationId)
      ) {
        return buildJsonResponse(
          {
            ok: false,
            updated: false,
            reason: "batch_not_allowed",
            message: "Envie apenas um notificationId por vez.",
          },
          400,
        );
      }

      if (!organizationId || !storeId || !notificationId) {
        return buildJsonResponse(
          {
            ok: false,
            updated: false,
            reason: "missing_required_fields",
          },
          400,
        );
      }

      if (organizationId !== access.organizationId) {
        return buildTenantMismatchResponse("organization");
      }

      if (storeId !== access.storeId) {
        return buildTenantMismatchResponse("store");
      }

      const result = await prepareNotification({
        organizationId: access.organizationId,
        storeId: access.storeId,
        notificationId,
      });

      return buildJsonResponse(result, result.ok ? 200 : 409);
    } catch (error: any) {
      return buildJsonResponse(
        {
          ok: false,
          updated: false,
          reason: "RESPONSIBLE_EXTERNAL_NOTIFICATION_PREPARE_FAILED",
          message:
            error?.message ||
            "Nao foi possivel preparar a notificacao externa do responsavel.",
        },
        500,
      );
    }
  };
}

export const POST =
  createResponsibleExternalNotificationsPreparePostHandler();
