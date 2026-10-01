import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "zion-store-files";
const SIGNED_URL_EXPIRATION_SECONDS = 60;

type AssistantMessageRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string;
  sender_role: string | null;
  metadata: Record<string, unknown> | null;
};

type AssistantThreadRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_type: string | null;
};

type SignedMediaRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
};

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.");
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function attachmentKind(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "image" || normalized === "audio" || normalized === "file"
    ? normalized
    : null;
}

export function createAssistantSignedMediaUrlGetHandler(
  deps: Partial<SignedMediaRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createPrivilegedClient =
    deps.createPrivilegedClient ?? createSupabaseAdminClient;

  return async function GET(
    _request: Request,
    context: { params: Promise<{ messageId: string }> },
  ) {
    try {
      const messageId = String((await context.params).messageId || "").trim();
      if (!messageId) return json({ ok: false, error: "MISSING_MESSAGE_ID" }, 400);

      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const supabase = createPrivilegedClient();
      const { data: message, error: messageError } = await supabase
        .from("store_assistant_messages")
        .select("id, organization_id, store_id, thread_id, sender_role, metadata")
        .eq("id", messageId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<AssistantMessageRow>();

      if (messageError) return json({ ok: false, error: "LOAD_MESSAGE_FAILED", message: messageError.message }, 500);
      if (!message) return json({ ok: false, error: "MESSAGE_NOT_FOUND" }, 404);
      if (message.sender_role !== "store_responsible" || !message.thread_id) {
        return json({ ok: false, error: "INVALID_ASSISTANT_MEDIA_MESSAGE" }, 422);
      }

      const { data: thread, error: threadError } = await supabase
        .from("store_assistant_threads")
        .select("id, organization_id, store_id, thread_type")
        .eq("id", message.thread_id)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle<AssistantThreadRow>();
      if (threadError) return json({ ok: false, error: "LOAD_THREAD_FAILED", message: threadError.message }, 500);
      if (!thread || thread.thread_type !== "primary") {
        return json({ ok: false, error: "INVALID_ASSISTANT_THREAD" }, 403);
      }

      const metadata = isRecord(message.metadata) ? message.metadata : null;
      const kind = attachmentKind(metadata?.attachment_kind);
      const bucket = String(metadata?.storage_bucket || "").trim();
      const path = String(metadata?.storage_path || "").trim();
      const responsibleId = String(metadata?.responsible_id || "").trim();
      const externalMessageId = String(metadata?.external_message_id || "").trim();
      if (
        !metadata ||
        !kind ||
        bucket !== STORAGE_BUCKET ||
        !path ||
        /^https?:\/\//i.test(path) ||
        !responsibleId ||
        !externalMessageId ||
        metadata.origin !== "whatsapp" ||
        metadata.channel !== "whatsapp"
      ) {
        return json({ ok: false, error: "INVALID_ASSISTANT_MEDIA_MESSAGE" }, 422);
      }

      const { data: signed, error: signedError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_URL_EXPIRATION_SECONDS);
      if (signedError || !signed?.signedUrl) {
        return json({ ok: false, error: "CREATE_SIGNED_MEDIA_URL_FAILED", message: signedError?.message }, 500);
      }

      return json({
        ok: true,
        signedUrl: signed.signedUrl,
        attachmentKind: kind,
        mimeType: String(metadata.mime_type || "").trim() || null,
        fileName: String(metadata.original_file_name || "").trim() || null,
      });
    } catch (error) {
      return json({
        ok: false,
        error: "ASSISTANT_SIGNED_MEDIA_URL_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }, 500);
    }
  };
}

export const GET = createAssistantSignedMediaUrlGetHandler();
