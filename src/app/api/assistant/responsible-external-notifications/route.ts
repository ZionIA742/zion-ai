import { NextResponse } from "next/server";
import { listResponsibleExternalNotifications } from "@/lib/server/assistant/responsible-external-notifications";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ListNotifications = typeof listResponsibleExternalNotifications;

type GetHandlerDeps = {
  resolveAccess?: typeof resolveStoreApiAccess;
  listNotifications?: ListNotifications;
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
      error: "FORBIDDEN",
      message:
        kind === "organization"
          ? "organizationId nao corresponde ao tenant autorizado."
          : "storeId nao corresponde a loja autorizada.",
    },
    403,
  );
}

export function createResponsibleExternalNotificationsGetHandler(
  deps: GetHandlerDeps = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const listNotifications =
    deps.listNotifications ?? listResponsibleExternalNotifications;

  return async function handleResponsibleExternalNotificationsGet(
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

      const searchParams = new URL(request.url).searchParams;
      const requestedOrganizationId = String(
        searchParams.get("organizationId") || "",
      ).trim();
      const requestedStoreId = String(searchParams.get("storeId") || "").trim();

      if (!requestedStoreId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_STORE_ID",
            message: "Store ID nao informado.",
          },
          400,
        );
      }

      if (!requestedOrganizationId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_ORGANIZATION_ID",
            message: "organizationId nao informado.",
          },
          400,
        );
      }

      if (requestedOrganizationId !== access.organizationId) {
        return buildTenantMismatchResponse("organization");
      }

      if (requestedStoreId !== access.storeId) {
        return buildTenantMismatchResponse("store");
      }

      const status = String(searchParams.get("status") || "").trim();
      const limit = Math.min(
        Math.max(Number(searchParams.get("limit") || 20), 1),
        100,
      );

      const result = await listNotifications({
        organizationId: access.organizationId,
        storeId: access.storeId,
        status,
        limit,
      });

      return buildJsonResponse(result);
    } catch (error: any) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_RESPONSIBLE_EXTERNAL_NOTIFICATIONS_FAILED",
          message:
            error?.message ||
            "Nao foi possivel carregar a fila externa do responsavel.",
        },
        500,
      );
    }
  };
}

export const GET = createResponsibleExternalNotificationsGetHandler();
