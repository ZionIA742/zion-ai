import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import {
  exchangeAndValidateMetaWhatsappEmbeddedSignup,
  MetaWhatsappEmbeddedSignupError,
  type MetaWhatsappEmbeddedSignupValidationInput,
  type MetaWhatsappEmbeddedSignupValidationResult,
} from "@/lib/server/meta-whatsapp-embedded-signup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmbeddedSignupRequestBody = {
  code?: unknown;
  whatsappBusinessAccountId?: unknown;
  phoneNumberId?: unknown;
  twoStepPin?: unknown;
  changeRequestIdempotencyKey?: unknown;
};

type MaterializedWhatsappIntegration = {
  integration_id: string;
  outcome: string;
  provider: string;
  status: string;
  is_active: boolean;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  display_phone_number: string;
};

type MaterializedWhatsappBindingCandidate = {
  request_id: string;
  outcome: string;
  status: string;
  active_integration_id: string;
  candidate_phone_number_id: string;
  candidate_whatsapp_business_account_id: string;
  candidate_display_phone_number: string;
};

type PrivilegedClient = ReturnType<typeof createClient>;

type EmbeddedSignupRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => PrivilegedClient;
  validateEmbeddedSignup: (
    input: MetaWhatsappEmbeddedSignupValidationInput,
  ) => Promise<MetaWhatsappEmbeddedSignupValidationResult>;
};

const MAX_PAYLOAD_BYTES = 8 * 1024;

function createJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function trimInputString(value: unknown) {
  return isString(value) ? value.trim() : null;
}

function createPrivilegedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role nao configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isPayloadTooLarge(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  return Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES;
}

async function readRequestBody(request: Request) {
  if (isPayloadTooLarge(request)) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "PAYLOAD_TOO_LARGE",
          message: "Payload do Embedded Signup muito grande.",
        },
        413,
      ),
    };
  }

  let body: EmbeddedSignupRequestBody | null = null;

  try {
    body = (await request.json()) as EmbeddedSignupRequestBody;
  } catch {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "INVALID_JSON",
          message: "Envie um JSON valido.",
        },
        400,
      ),
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "INVALID_EMBEDDED_SIGNUP_PAYLOAD",
          message: "Payload do Embedded Signup invalido.",
        },
        400,
      ),
    };
  }

  if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "PAYLOAD_TOO_LARGE",
          message: "Payload do Embedded Signup muito grande.",
        },
        413,
      ),
    };
  }

  return {
    ok: true as const,
    body,
  };
}

function validatePayload(body: EmbeddedSignupRequestBody) {
  const code = trimInputString(body.code);
  const whatsappBusinessAccountId = trimInputString(body.whatsappBusinessAccountId);
  const phoneNumberId = trimInputString(body.phoneNumberId);

  if (!code) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "MISSING_CODE",
          message: "Codigo de autorizacao do Embedded Signup ausente.",
        },
        400,
      ),
    };
  }

  if (!whatsappBusinessAccountId) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "MISSING_WHATSAPP_BUSINESS_ACCOUNT_ID",
          message: "WhatsApp Business Account ausente.",
        },
        400,
      ),
    };
  }

  if (!phoneNumberId) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "MISSING_PHONE_NUMBER_ID",
          message: "Phone Number ID ausente.",
        },
        400,
      ),
    };
  }

  if (!isString(body.twoStepPin)) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "INVALID_TWO_STEP_PIN",
          message: "PIN de duas etapas invalido.",
        },
        400,
      ),
    };
  }

  const twoStepPin = body.twoStepPin;
  if (!/^[0-9]{6}$/.test(twoStepPin)) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "INVALID_TWO_STEP_PIN",
          message: "PIN de duas etapas invalido.",
        },
        400,
      ),
    };
  }

  return {
    ok: true as const,
    input: {
      code,
      whatsappBusinessAccountId,
      phoneNumberId,
      twoStepPin,
    },
  };
}

function mapWriterError(error: { message?: string | null } | null | undefined) {
  const message = cleanText(error?.message);

  if (
    message.includes("PHONE_ALREADY_BOUND") ||
    message.includes("PHONE_CHANGE_REQUIRES_SAFE_FLOW") ||
    message.includes("WABA_MISMATCH") ||
    message.includes("CONCURRENT_CONFLICT") ||
    message.includes("CANDIDATE_CONFLICT") ||
    message.includes("CANDIDATE_PHONE_ALREADY_BOUND") ||
    message.includes("ACTIVE_BINDING_AMBIGUOUS") ||
    message.includes("ACTIVE_BINDING_CHANGED")
  ) {
    return {
      status: 409,
      error: "WHATSAPP_EMBEDDED_SIGNUP_CONFLICT",
      message:
        "Nao foi possivel conectar este WhatsApp para esta loja. Reinicie o Embedded Signup.",
    };
  }

  return {
    status: 500,
    error: "WHATSAPP_EMBEDDED_SIGNUP_MATERIALIZATION_FAILED",
    message:
      "A Meta autorizou o acesso, mas nao foi possivel salvar a integracao. Reinicie o Embedded Signup.",
  };
}

function isNoChangeCandidateError(error: { message?: string | null } | null | undefined) {
  const message = cleanText(error?.message);
  return (
    message.includes("ZION_WHATSAPP_CHANGE_REQUIRES_ACTIVE_BINDING") ||
    message.includes("ZION_WHATSAPP_CHANGE_NOT_REQUIRED")
  );
}

function mapMetaError(error: MetaWhatsappEmbeddedSignupError) {
  return {
    status: error.httpStatus,
    body: {
      ok: false,
      error: error.code,
      message: error.message,
    },
  };
}

function sanitizeUnexpectedError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: "UnknownError" };
  }

  const record = error as Record<string, unknown>;
  return {
    name: cleanText(record.name) || "Error",
    code: cleanText(record.code) || null,
  };
}

export function createStoreWhatsappEmbeddedSignupPostHandler(
  deps: Partial<EmbeddedSignupRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;
  const validateEmbeddedSignup =
    deps.validateEmbeddedSignup ?? exchangeAndValidateMetaWhatsappEmbeddedSignup;

  return async function POST(request: Request) {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    const bodyResult = await readRequestBody(request);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const payloadResult = validatePayload(bodyResult.body);
    if (!payloadResult.ok) {
      return payloadResult.response;
    }

    let validated: MetaWhatsappEmbeddedSignupValidationResult;

    try {
      validated = await validateEmbeddedSignup(payloadResult.input);
    } catch (error) {
      if (error instanceof MetaWhatsappEmbeddedSignupError) {
        const mapped = mapMetaError(error);
        return createJsonResponse(mapped.body, mapped.status);
      }

      console.error("[api/store/whatsapp/embedded-signup][POST] Meta validation error:", sanitizeUnexpectedError(error));

      return createJsonResponse(
        {
          ok: false,
          error: "META_EMBEDDED_SIGNUP_VALIDATION_FAILED",
          message: "Nao foi possivel validar o Embedded Signup na Meta.",
        },
        502,
      );
    }

    try {
      const privilegedClient = createClientWithPrivileges();
      const idempotencyKey =
        trimInputString(bodyResult.body.changeRequestIdempotencyKey) ||
        `embedded-signup:${validated.phoneNumberId}`;
      const candidateResult = await privilegedClient.rpc(
        "materialize_whatsapp_binding_candidate_by_system",
        {
          p_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_source: "meta_embedded_signup",
          p_idempotency_key: idempotencyKey,
          p_whatsapp_business_account_id: validated.whatsappBusinessAccountId,
          p_phone_number_id: validated.phoneNumberId,
          p_display_phone_number: validated.displayPhoneNumber,
          p_provenance: {
            graph_api_version: validated.graphApiVersion,
            meta_app_id: validated.appId,
            validated_at: validated.validatedAt,
          },
        },
      );

      if (!candidateResult.error) {
        const candidateRow = (Array.isArray(candidateResult.data)
          ? candidateResult.data[0]
          : candidateResult.data) as MaterializedWhatsappBindingCandidate | null;

        if (!candidateRow) {
          throw new Error("Candidate writer returned no change request.");
        }

        return createJsonResponse({
          ok: true,
          outcome: candidateRow.outcome,
          changeRequest: {
            id: candidateRow.request_id,
            status: candidateRow.status,
            activeIntegrationId: candidateRow.active_integration_id,
          },
          candidate: {
            phoneNumberId: candidateRow.candidate_phone_number_id,
            whatsappBusinessAccountId:
              candidateRow.candidate_whatsapp_business_account_id,
            displayPhoneNumber: candidateRow.candidate_display_phone_number,
            isActive: false,
          },
        });
      }

      if (!isNoChangeCandidateError(candidateResult.error)) {
        const mapped = mapWriterError(candidateResult.error);
        return createJsonResponse(
          { ok: false, error: mapped.error, message: mapped.message },
          mapped.status,
        );
      }

      const { data, error } = await privilegedClient.rpc(
        "materialize_store_whatsapp_embedded_signup_by_system",
        {
          p_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_whatsapp_business_account_id: validated.whatsappBusinessAccountId,
          p_phone_number_id: validated.phoneNumberId,
          p_display_phone_number: validated.displayPhoneNumber,
          p_access_token: validated.accessToken,
          p_meta_graph_api_version: validated.graphApiVersion,
          p_meta_app_id: validated.appId,
          p_validated_at: validated.validatedAt,
        },
      );

      if (error) {
        const mapped = mapWriterError(error);
        return createJsonResponse(
          {
            ok: false,
            error: mapped.error,
            message: mapped.message,
          },
          mapped.status,
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("Embedded Signup writer returned no integration.");
      }

      const integration = row as MaterializedWhatsappIntegration;

      return createJsonResponse({
        ok: true,
        outcome: integration.outcome,
        integration: {
          id: integration.integration_id,
          provider: integration.provider,
          status: integration.status,
          isActive: integration.is_active === true,
          phoneNumberId: integration.phone_number_id,
          whatsappBusinessAccountId: integration.whatsapp_business_account_id,
          displayPhoneNumber: integration.display_phone_number,
        },
      });
    } catch (error) {
      console.error("[api/store/whatsapp/embedded-signup][POST] writer error:", sanitizeUnexpectedError(error));

      return createJsonResponse(
        {
          ok: false,
          error: "WHATSAPP_EMBEDDED_SIGNUP_ROUTE_FAILED",
          message:
            "Nao foi possivel concluir a conexao do WhatsApp. Reinicie o Embedded Signup.",
        },
        500,
      );
    }
  };
}

export const POST = createStoreWhatsappEmbeddedSignupPostHandler();
