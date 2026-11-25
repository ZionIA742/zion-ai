import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  readHumanResponseCommitmentsBySystem,
  recordHumanResponseCommitmentBySystem,
  transitionHumanResponseCommitmentBySystem,
  type RecordHumanResponseCommitmentInput,
} from "@/lib/server/human-response-commitments";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

type CommitmentRouteDeps = {
  resolveStoreAccess: (params: { requirement: "active"; deps?: Partial<ResolveStoreApiAccessDeps> }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => ServiceSupabaseClient;
};

function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service_role_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function scopedBody(body: Record<string, unknown>, access: StoreApiAccessGranted) {
  const conversationId = text(body.conversationId);
  if (!conversationId) throw new Error("MISSING_CONVERSATION_ID");
  return { conversationId, organizationId: access.organizationId, storeId: access.storeId };
}

export async function GET(request: Request, deps: CommitmentRouteDeps = { resolveStoreAccess: resolveStoreApiAccess, createServiceSupabaseClient }) {
  try {
    const access = await deps.resolveStoreAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    const url = new URL(request.url);
    const commitments = await readHumanResponseCommitmentsBySystem(deps.createServiceSupabaseClient(), {
      organizationId: access.organizationId,
      storeId: access.storeId,
      conversationId: text(url.searchParams.get("conversationId")) || null,
    });
    return response({ ok: true, commitments });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "COMMITMENT_READ_FAILED" }, 400);
  }
}

export async function POST(request: Request, deps: CommitmentRouteDeps = { resolveStoreAccess: resolveStoreApiAccess, createServiceSupabaseClient }) {
  try {
    const access = await deps.resolveStoreAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    const body = (await request.json()) as Record<string, unknown>;
    const scope = scopedBody(body, access);
    const input: RecordHumanResponseCommitmentInput = {
      ...scope,
      conversationSessionId: text(body.conversationSessionId) || null,
      sourceMessageId: text(body.sourceMessageId),
      responsibleUserId: access.sessionUserId,
      dueAt: text(body.dueAt),
      operationKey: text(body.operationKey),
      sourceKind: "panel",
      explicitConfirmation: body.explicitConfirmation === true,
    };
    const id = await recordHumanResponseCommitmentBySystem(deps.createServiceSupabaseClient(), input);
    return response({ ok: true, commitmentId: id });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "COMMITMENT_CREATE_FAILED" }, 400);
  }
}

export async function PATCH(request: Request, deps: CommitmentRouteDeps = { resolveStoreAccess: resolveStoreApiAccess, createServiceSupabaseClient }) {
  try {
    const access = await deps.resolveStoreAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);
    const body = (await request.json()) as Record<string, unknown>;
    const scope = scopedBody(body, access);
    const status = text(body.status) as "active" | "fulfilled" | "cancelled" | "expired";
    const id = await transitionHumanResponseCommitmentBySystem(deps.createServiceSupabaseClient(), {
      commitmentId: text(body.commitmentId),
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      status,
      operationKey: text(body.operationKey),
      dueAt: text(body.dueAt) || null,
    });
    return response({ ok: true, commitmentId: id });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : "COMMITMENT_UPDATE_FAILED" }, 400);
  }
}
