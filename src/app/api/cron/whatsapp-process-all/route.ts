import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { processWhatsappInbox } from "@/lib/server/whatsapp-inbox-processor";
import { processWhatsappPendingMessages } from "@/lib/server/whatsapp-external-sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WhatsappIntegrationRow = {
  organization_id: string | null;
  store_id: string | null;
};

type StoreExecutionSummary = {
  organizationId: string;
  storeId: string;
  inbox?: {
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  pending?: {
    processed: number;
    sent: number;
    failed: number;
  };
  error?: string;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isCronRequestAuthorized(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";

  if (!cronSecret) {
    return { ok: false, mode: "missing_cron_secret" as const };
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, mode: "invalid_cron_authorization" as const };
  }

  return { ok: true, mode: "authorized_by_cron_secret" as const };
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseEnvLimit(envValue: string | undefined, defaultValue: number) {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(Math.trunc(parsed), 100));
}

async function listActiveWhatsappStores() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("external_integrations")
    .select("organization_id, store_id")
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .eq("status", "active")
    .not("organization_id", "is", null)
    .not("store_id", "is", null);

  if (error) {
    throw new Error(`Falha ao listar integracoes WhatsApp ativas: ${error.message}`);
  }

  const deduped = new Map<string, { organizationId: string; storeId: string }>();

  for (const row of (data || []) as WhatsappIntegrationRow[]) {
    const organizationId = String(row.organization_id || "").trim();
    const storeId = String(row.store_id || "").trim();

    if (!organizationId || !storeId) {
      continue;
    }

    deduped.set(`${organizationId}:${storeId}`, {
      organizationId,
      storeId,
    });
  }

  return Array.from(deduped.values());
}

export async function GET(req: Request) {
  const auth = isCronRequestAuthorized(req);

  if (!auth.ok) {
    return buildJsonResponse(
      {
        ok: false,
        error: "UNAUTHORIZED_CRON_ROUTE",
        message: "Cron nao autorizado. Verifique CRON_SECRET e o header Authorization.",
      },
      401,
    );
  }

  const startedAt = new Date().toISOString();

  try {
    const inboxLimit = parseEnvLimit(process.env.WHATSAPP_CRON_INBOX_LIMIT, 10);
    const pendingLimit = parseEnvLimit(process.env.WHATSAPP_CRON_PENDING_LIMIT, 10);
    const stores = await listActiveWhatsappStores();

    if (stores.length === 0) {
      return buildJsonResponse({
        ok: true,
        authMode: auth.mode,
        route: "cron/whatsapp-process-all",
        message: "no_active_whatsapp_integrations",
        startedAt,
        finishedAt: new Date().toISOString(),
        totalStores: 0,
        processedStores: 0,
        storeErrors: 0,
        inboxProcessed: 0,
        inboxSucceeded: 0,
        inboxFailed: 0,
        pendingProcessed: 0,
        pendingSent: 0,
        pendingFailed: 0,
        results: [] as StoreExecutionSummary[],
      });
    }

    const results: StoreExecutionSummary[] = [];
    let processedStores = 0;
    let storeErrors = 0;
    let inboxProcessed = 0;
    let inboxSucceeded = 0;
    let inboxFailed = 0;
    let pendingProcessed = 0;
    let pendingSent = 0;
    let pendingFailed = 0;

    for (const store of stores) {
      try {
        const inboxResult = await processWhatsappInbox({
          organizationId: store.organizationId,
          storeId: store.storeId,
          limit: inboxLimit,
        });

        const pendingResult = await processWhatsappPendingMessages({
          organizationId: store.organizationId,
          storeId: store.storeId,
          limit: pendingLimit,
        });

        processedStores += 1;
        inboxProcessed += inboxResult.processed;
        inboxSucceeded += inboxResult.succeeded;
        inboxFailed += inboxResult.failed;
        pendingProcessed += pendingResult.processed;
        pendingSent += pendingResult.sent;
        pendingFailed += pendingResult.failed;

        results.push({
          organizationId: store.organizationId,
          storeId: store.storeId,
          inbox: {
            processed: inboxResult.processed,
            succeeded: inboxResult.succeeded,
            failed: inboxResult.failed,
            skipped: inboxResult.skipped,
          },
          pending: {
            processed: pendingResult.processed,
            sent: pendingResult.sent,
            failed: pendingResult.failed,
          },
        });
      } catch (error) {
        storeErrors += 1;
        results.push({
          organizationId: store.organizationId,
          storeId: store.storeId,
          error:
            error instanceof Error
              ? error.message
              : "Erro inesperado ao processar loja no cron do WhatsApp.",
        });
      }
    }

    return buildJsonResponse({
      ok: true,
      authMode: auth.mode,
      route: "cron/whatsapp-process-all",
      startedAt,
      finishedAt: new Date().toISOString(),
      totalStores: stores.length,
      processedStores,
      storeErrors,
      inboxProcessed,
      inboxSucceeded,
      inboxFailed,
      pendingProcessed,
      pendingSent,
      pendingFailed,
      limits: {
        inbox: inboxLimit,
        pending: pendingLimit,
      },
      results,
    });
  } catch (error) {
    return buildJsonResponse(
      {
        ok: false,
        error: "WHATSAPP_PROCESS_ALL_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro interno no cron de processamento do WhatsApp.",
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      500,
    );
  }
}
