import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  advanceWhatsappBindingChangeRequest,
  cancelWhatsappBindingChangeRequest,
  cutoverWhatsappBindingChangeRequest,
  expireWhatsappBindingChangeRequest,
  readWhatsappBindingChangeRequest,
  WhatsappBindingChangeOperationError,
  type WhatsappBindingChangeSupabaseLike,
} from "@/lib/server/whatsapp-binding-change-operation";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import { exchangeAndValidateMetaWhatsappBinding } from "@/lib/server/meta-whatsapp-embedded-signup";
import type { WhatsappBindingFreshTokenValidator } from "@/lib/server/whatsapp-binding-change-operation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BindingChangeAction = "validate" | "ready" | "cutover" | "cancel" | "expire";

type BindingChangeRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => WhatsappBindingChangeSupabaseLike;
  validateFreshToken?: WhatsappBindingFreshTokenValidator;
};

const FORBIDDEN_CLIENT_KEYS = new Set([
  "activeIntegrationId",
  "active_integration_id",
  "expectedActiveIntegrationId",
  "candidate",
  "candidateWaba",
  "candidatePhoneNumberId",
  "candidateDisplayPhoneNumber",
  "candidate_whatsapp_business_account_id",
  "candidate_phone_number_id",
  "candidate_display_phone_number",
  "whatsappBusinessAccountId",
  "phoneNumberId",
  "accessToken",
  "access_token",
  "token",
  "refreshToken",
  "refresh_token",
  "authorization_code",
]);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function createPrivilegedClient(): WhatsappBindingChangeSupabaseLike {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as WhatsappBindingChangeSupabaseLike;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRequestId(request: Request) {
  return cleanText(new URL(request.url).searchParams.get("request_id"));
}

function assertSafeBodyKeys(body: Record<string, unknown>) {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_CLIENT_KEYS.has(key)) {
      throw new WhatsappBindingChangeOperationError(
        "WHATSAPP_BINDING_CHANGE_FORBIDDEN_INPUT",
        400,
      );
    }
  }
}

async function readJsonBody(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new WhatsappBindingChangeOperationError(
        "WHATSAPP_BINDING_CHANGE_INVALID_BODY",
        400,
      );
    }
    const record = body as Record<string, unknown>;
    assertSafeBodyKeys(record);
    return record;
  } catch (error) {
    if (error instanceof WhatsappBindingChangeOperationError) throw error;
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_INVALID_BODY",
      400,
    );
  }
}

function resolveAction(value: unknown): BindingChangeAction {
  const action = cleanText(value);
  if (
    action !== "validate" &&
    action !== "ready" &&
    action !== "cutover" &&
    action !== "cancel" &&
    action !== "expire"
  ) {
    throw new WhatsappBindingChangeOperationError(
      "WHATSAPP_BINDING_CHANGE_ACTION_INVALID",
      400,
    );
  }
  return action;
}

function toErrorResponse(error: unknown) {
  if (error instanceof WhatsappBindingChangeOperationError) {
    return response({ ok: false, error: error.code }, error.httpStatus);
  }
  return response(
    { ok: false, error: "WHATSAPP_BINDING_CHANGE_OPERATION_FAILED" },
    503,
  );
}

export function createWhatsappBindingChangeRouteHandler(
  deps: Partial<BindingChangeRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;
  const validateFreshToken =
    deps.validateFreshToken ?? exchangeAndValidateMetaWhatsappBinding;

  return {
    async GET(request: Request) {
      const access = await resolveAccess({ requirement: "active_or_onboarding" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const requestId = getRequestId(request);
      try {
        const bindingRequest = await readWhatsappBindingChangeRequest({
          supabase: createClientWithPrivileges(),
          organizationId: access.organizationId,
          storeId: access.storeId,
          requestId,
        });
        return response({ ok: true, request: bindingRequest });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async POST(request: Request) {
      const access = await resolveAccess({ requirement: "active_or_onboarding" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      try {
        const body = await readJsonBody(request);
        const requestId = cleanText(body.requestId ?? body.request_id);
        if (!requestId) {
          throw new WhatsappBindingChangeOperationError(
            "WHATSAPP_BINDING_CHANGE_REQUEST_REQUIRED",
            400,
          );
        }
        const action = resolveAction(body.action);
        if (action !== "cutover" && "authorizationCode" in body) {
          throw new WhatsappBindingChangeOperationError(
            "WHATSAPP_BINDING_CHANGE_FORBIDDEN_INPUT",
            400,
          );
        }
        const operationArgs = {
          supabase: createClientWithPrivileges(),
          organizationId: access.organizationId,
          storeId: access.storeId,
          requestId,
        };

        const bindingRequest =
          action === "validate"
            ? await advanceWhatsappBindingChangeRequest({
                ...operationArgs,
                nextStatus: "validating",
              })
            : action === "ready"
              ? await advanceWhatsappBindingChangeRequest({
                  ...operationArgs,
                  nextStatus: "ready_to_cutover",
                })
              : action === "cutover"
                ? await cutoverWhatsappBindingChangeRequest({
                    ...operationArgs,
                    authorizationCode: cleanText(body.authorizationCode),
                    validateFreshToken,
                  })
                : action === "cancel"
                  ? await cancelWhatsappBindingChangeRequest(operationArgs)
                  : await expireWhatsappBindingChangeRequest(operationArgs);

        return response({ ok: true, action, request: bindingRequest });
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}

const handlers = createWhatsappBindingChangeRouteHandler();
export const GET = handlers.GET;
export const POST = handlers.POST;
