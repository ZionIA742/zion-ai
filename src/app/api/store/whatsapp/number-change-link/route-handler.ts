import { NextResponse } from "next/server";
import { resolveStoreApiAccess } from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";
import { hashWhatsappNumberChangeToken } from "@/lib/server/whatsapp-number-change-link";
import {
  readWhatsappBindingChangeRequest,
  WhatsappBindingChangeOperationError,
} from "@/lib/server/whatsapp-binding-change-operation";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

type NumberChangeSupabaseClient = {
  from(table: string): NumberChangeQuery;
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
};

type NumberChangeQuery = {
  select(columns: string): NumberChangeQuery;
  eq(column: string, value: unknown): NumberChangeQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown | null }>;
};

type NumberChangeRouteDeps = {
  resolveAccess: typeof resolveStoreApiAccess;
  createServiceClient: () => NumberChangeSupabaseClient;
};

function tokenFrom(request: Request) {
  return new URL(request.url).searchParams.get("token")?.trim() || "";
}

function serviceClient() {
  return createServiceSupabaseClient() as unknown as NumberChangeSupabaseClient;
}

function operationErrorResponse(error: unknown) {
  if (error instanceof WhatsappBindingChangeOperationError) {
    return json({ ok: false, error: error.code }, error.httpStatus);
  }
  return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_STATE_UNAVAILABLE" }, 503);
}

async function resolveLink(
  request: Request,
  allowCompletedForCompletion = false,
  deps: NumberChangeRouteDeps = {
    resolveAccess: resolveStoreApiAccess,
    createServiceClient: serviceClient,
  },
) {
  const access = await deps.resolveAccess({ requirement: "active_or_onboarding" });
  if (!access.ok) return { response: createStoreApiDeniedResponse(access) } as const;
  const token = tokenFrom(request);
  if (!token) return { response: json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_TOKEN_REQUIRED" }, 400) } as const;
  const client = deps.createServiceClient();
  const result = await client.rpc("resolve_whatsapp_number_change_link_by_system", {
    p_token_hash: hashWhatsappNumberChangeToken(token),
  });
  let row = (Array.isArray(result.data) ? result.data[0] : result.data) as {
    link_id?: string;
    organization_id?: string;
    store_id?: string;
    provider?: string;
    status?: string;
    expires_at?: string;
    started_at?: string | null;
    binding_change_request_id?: string | null;
    responsible_user_id?: string;
  } | null;
  let resolutionError = result.error;
  if (allowCompletedForCompletion && (result.error || !row)) {
    const completedLookup = await client.from("whatsapp_number_change_links")
      .select("id, organization_id, store_id, provider, status, expires_at, started_at, binding_change_request_id, responsible_user_id")
      .eq("token_hash", hashWhatsappNumberChangeToken(token))
      .maybeSingle();
    const candidate = completedLookup.data as typeof row;
    if (!completedLookup.error && candidate?.status === "completed") {
      row = { ...candidate, link_id: candidate.link_id ?? (candidate as { id?: string }).id };
      resolutionError = null;
    }
  }
  if (resolutionError || !row || row.organization_id !== access.organizationId || row.store_id !== access.storeId || row.provider !== "whatsapp" || row.responsible_user_id !== access.sessionUserId) {
    return { response: json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_UNAUTHORIZED" }, 403) } as const;
  }
  return { access, client, row } as const;
}

export function createWhatsappNumberChangeLinkRouteHandler(
  overrides: Partial<NumberChangeRouteDeps> = {},
) {
  const deps: NumberChangeRouteDeps = {
    resolveAccess: overrides.resolveAccess ?? resolveStoreApiAccess,
    createServiceClient: overrides.createServiceClient ?? serviceClient,
  };

  return {
    async GET(request: Request) {
      try {
        const resolved = await resolveLink(request, false, deps);
        if ("response" in resolved) return resolved.response;
        let changeRequest: Awaited<ReturnType<typeof readWhatsappBindingChangeRequest>> | null = null;
        if (resolved.row.binding_change_request_id) {
          try {
            changeRequest = await readWhatsappBindingChangeRequest({
              supabase: resolved.client as never,
              organizationId: resolved.access.organizationId,
              storeId: resolved.access.storeId,
              requestId: resolved.row.binding_change_request_id,
            });
          } catch (error) {
            return operationErrorResponse(error);
          }
          if (changeRequest.provider !== "whatsapp" || changeRequest.id !== resolved.row.binding_change_request_id) {
            return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_STATE_INCONSISTENT" }, 409);
          }
        }
        const store = await resolved.client.from("stores").select("id, name").eq("id", resolved.access.storeId).maybeSingle();
        const integration = await resolved.client.from("external_integrations").select("status, is_active, phone_number_id, display_phone_number").eq("organization_id", resolved.access.organizationId).eq("store_id", resolved.access.storeId).eq("provider", "whatsapp").eq("is_active", true).maybeSingle();
        return json({ ok: true, link: { status: resolved.row.status, expiresAt: resolved.row.expires_at, startedAt: resolved.row.started_at, requestId: resolved.row.binding_change_request_id }, changeRequest, store: store.data, integration: integration.data });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "WHATSAPP_NUMBER_CHANGE_LINK_READ_FAILED" }, 503);
      }
    },

    async POST(request: Request) {
      try {
        const body = await request.json().catch(() => null) as { action?: unknown } | null;
        const resolved = await resolveLink(request, body?.action === "complete", deps);
        if ("response" in resolved) return resolved.response;
        if (body?.action !== "start" && body?.action !== "complete") return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_ACTION_INVALID" }, 400);
        if (body.action === "complete") {
          if (resolved.row.status === "completed") return json({ ok: true, status: "completed" });
          if (resolved.row.status !== "started" || !resolved.row.binding_change_request_id) {
            return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_NOT_READY" }, 409);
          }
          const changeRequest = await readWhatsappBindingChangeRequest({
            supabase: resolved.client as never,
            organizationId: resolved.access.organizationId,
            storeId: resolved.access.storeId,
            requestId: resolved.row.binding_change_request_id,
          });
          if (changeRequest.status !== "completed") {
            return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_REQUEST_NOT_COMPLETED" }, 409);
          }
          const completed = await resolved.client.rpc("complete_whatsapp_number_change_link_by_system", {
            p_link_id: resolved.row.link_id,
            p_organization_id: resolved.access.organizationId,
            p_store_id: resolved.access.storeId,
            p_provider: "whatsapp",
          });
          const completedRow = Array.isArray(completed.data) ? completed.data[0] : completed.data;
          if (completed.error || !completedRow || typeof completedRow !== "object" || (completedRow as { status?: unknown }).status !== "completed") {
            return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_COMPLETION_FAILED" }, 409);
          }
          return json({ ok: true, status: "completed" });
        }
        const started = await resolved.client.rpc("start_whatsapp_number_change_link_by_system", {
          p_link_id: resolved.row.link_id,
          p_organization_id: resolved.access.organizationId,
          p_store_id: resolved.access.storeId,
          p_provider: "whatsapp",
          p_responsible_user_id: resolved.access.sessionUserId,
        });
        if (started.error) return json({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_START_FAILED" }, 409);
        return json({ ok: true, status: "started", expiresAt: resolved.row.expires_at });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "WHATSAPP_NUMBER_CHANGE_LINK_START_FAILED" }, 503);
      }
    },
  };
}
