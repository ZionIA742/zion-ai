import { NextResponse } from "next/server";
import {
  canInsertQuoteConversationEvent,
  insertQuoteConversationEvent,
} from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { loadStoreQuoteSettings } from "@/lib/server/sales-quotes/quote-settings";
import {
  buildQuotePdfMessageMetadata,
} from "@/lib/server/sales-quotes/quote-storage";
import type {
  SalesQuoteVersionRow,
  StoreFileRow,
} from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEND_EVENT_TYPE = "orcamento_enviado";
const OPEN_COMMERCIAL_QUOTE_TASK_STATUSES = [
  "open",
  "in_progress",
  "ready_to_execute",
  "waiting_user_choice",
  "waiting_customer_response",
] as const;
const DEFAULT_MESSAGE_CONTENT = "Segue o orçamento em PDF para você conferir.";

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao enviar o orçamento.",
    },
    { status: 500 }
  );
}

function extractInsertMessageId(data: unknown) {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "id" in first) {
      return String((first as { id?: string | null }).id || "").trim() || null;
    }
    if (typeof first === "string") return first.trim() || null;
  }

  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id?: string | null }).id || "").trim() || null;
  }

  if (typeof data === "string") {
    return data.trim() || null;
  }

  return null;
}

async function loadCommercialQuoteTaskIdsByConversation(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  const safeConversationId = String(args.conversationId || "").trim();
  if (!safeConversationId) {
    return [] as string[];
  }

  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("task_type", "commercial_quote_request")
    .eq("related_conversation_id", safeConversationId)
    .in("status", [...OPEN_COMMERCIAL_QUOTE_TASK_STATUSES]);

  if (error) {
    throw new Error(
      `Falha ao carregar tarefas comerciais por conversa: ${error.message}`
    );
  }

  return Array.isArray(data)
    ? data
        .map((row) => String((row as { id?: string | null }).id || "").trim())
        .filter(Boolean)
    : [];
}

async function loadCommercialQuoteTaskIdsByLead(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  leadId: string;
}) {
  const safeLeadId = String(args.leadId || "").trim();
  if (!safeLeadId) {
    return [] as string[];
  }

  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("task_type", "commercial_quote_request")
    .eq("related_lead_id", safeLeadId)
    .in("status", [...OPEN_COMMERCIAL_QUOTE_TASK_STATUSES]);

  if (error) {
    throw new Error(`Falha ao carregar tarefas comerciais por lead: ${error.message}`);
  }

  return Array.isArray(data)
    ? data
        .map((row) => String((row as { id?: string | null }).id || "").trim())
        .filter(Boolean)
    : [];
}

async function resolveOpenCommercialQuoteTasks(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId?: string | null;
  leadId?: string | null;
  resolvedAt: string;
}) {
  const taskIds = new Set<string>();
  const safeConversationId = String(args.conversationId || "").trim();
  const safeLeadId = String(args.leadId || "").trim();

  if (safeConversationId) {
    const conversationTaskIds = await loadCommercialQuoteTaskIdsByConversation({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: safeConversationId,
    });

    conversationTaskIds.forEach((taskId) => taskIds.add(taskId));
  }

  if (safeLeadId) {
    const leadTaskIds = await loadCommercialQuoteTaskIdsByLead({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      leadId: safeLeadId,
    });

    leadTaskIds.forEach((taskId) => taskIds.add(taskId));
  }

  if (taskIds.size === 0) {
    return;
  }

  const { error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .update({
      status: "resolved",
      resolved_at: args.resolvedAt,
      updated_at: args.resolvedAt,
    })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("task_type", "commercial_quote_request")
    .in("status", [...OPEN_COMMERCIAL_QUOTE_TASK_STATUSES])
    .in("id", [...taskIds]);

  if (error) {
    throw new Error(`Falha ao resolver tarefas comerciais do orcamento: ${error.message}`);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);

    if (String(scope.quote.status || "").trim().toLowerCase() === "sent") {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_ALREADY_SENT",
          message: "Este orcamento ja foi enviado ao cliente.",
        },
        { status: 409 }
      );
    }

    const conversationId = String(scope.quote.conversation_id || "").trim();
    if (!conversationId) {
      throw new QuoteAccessError(
        400,
        "QUOTE_CONVERSATION_REQUIRED",
        "Este orcamento nao possui conversation_id para envio ao cliente."
      );
    }

    const currentVersionId = String(scope.quote.current_version_id || "").trim();
    if (!currentVersionId) {
      throw new QuoteAccessError(
        400,
        "QUOTE_VERSION_REQUIRED",
        "Este orcamento ainda nao possui uma versao de PDF gerada."
      );
    }

    const { data: versionData, error: versionError } = await scope.supabase
      .from("sales_quote_versions")
      .select(
        "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at"
      )
      .eq("id", currentVersionId)
      .eq("quote_id", scope.quote.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .maybeSingle();

    if (versionError) {
      throw new Error(`Falha ao carregar sales_quote_versions: ${versionError.message}`);
    }

    if (!versionData) {
      throw new QuoteAccessError(
        404,
        "QUOTE_VERSION_NOT_FOUND",
        "Versao atual do orcamento nao encontrada."
      );
    }

    const version = versionData as SalesQuoteVersionRow;

    if (String(version.status || "").trim().toLowerCase() === "sent") {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_VERSION_ALREADY_SENT",
          message: "A versao atual deste orcamento ja foi enviada ao cliente.",
        },
        { status: 409 }
      );
    }

    const { settings } = await loadStoreQuoteSettings({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    if (!settings.quotePdfEnabled) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_PDF_DISABLED",
          message: "O envio de orcamento em PDF esta desabilitado para esta loja.",
        },
        { status: 403 }
      );
    }

    if (!settings.aiCanSendQuoteToCustomer) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_SEND_DISABLED",
          message: "Esta loja nao permite envio automatico de orcamento ao cliente.",
        },
        { status: 403 }
      );
    }

    if (
      settings.requiresHumanApprovalBeforeSend &&
      String(scope.quote.status || "").trim().toLowerCase() !== "approved"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_REQUIRES_APPROVAL",
          message: "Este orcamento precisa ser aprovado antes de ser enviado ao cliente.",
        },
        { status: 409 }
      );
    }

    const eventGuard = await canInsertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: SEND_EVENT_TYPE,
    });

    if (!eventGuard.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_EVENT_NOT_ALLOWED",
          message: "O envio do orcamento nao esta permitido no estado atual da conversa.",
        },
        { status: 409 }
      );
    }

    const storeFileId = String(version.store_file_id || "").trim();
    let storeFile: StoreFileRow | null = null;

    if (storeFileId) {
      const { data: storeFileData, error: storeFileError } = await scope.supabase
        .from("store_files")
        .select(
          "id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type, size_bytes, uploaded_by, created_at, updated_at"
        )
        .eq("id", storeFileId)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .maybeSingle();

      if (storeFileError) {
        throw new Error(`Falha ao carregar store_files: ${storeFileError.message}`);
      }

      if (storeFileData) {
        storeFile = storeFileData as StoreFileRow;
      }
    }

    const storageBucket =
      String(storeFile?.storage_bucket || version.storage_bucket || "").trim() || null;
    const storagePath =
      String(storeFile?.storage_path || version.storage_path || "").trim() || null;
    const originalFilename =
      String(storeFile?.original_filename || version.original_filename || "").trim() || null;
    const mimeType =
      String(storeFile?.mime_type || version.mime_type || "").trim() || "application/pdf";
    const sizeBytes =
      typeof storeFile?.size_bytes === "number"
        ? storeFile.size_bytes
        : typeof version.size_bytes === "number"
          ? version.size_bytes
          : null;

    if (!storageBucket || !storagePath) {
      throw new QuoteAccessError(
        400,
        "QUOTE_FILE_MISSING",
        "A versao atual do orcamento nao possui storage_bucket/storage_path validos."
      );
    }

    if (!originalFilename) {
      throw new QuoteAccessError(
        400,
        "QUOTE_FILENAME_MISSING",
        "A versao atual do orcamento nao possui original_filename valido."
      );
    }

    const metadata = {
      ...buildQuotePdfMessageMetadata({
        quoteId: scope.quote.id,
        versionId: version.id,
        quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
        storagePath,
        originalFilename,
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : 0,
      }),
      mime_type: mimeType || "application/pdf",
      sales_quote_id: scope.quote.id,
      sales_quote_version_id: version.id,
    };

    const { data: insertData, error: insertError } = await scope.supabase.rpc(
      "insert_message",
      {
        p_conversation_id: conversationId,
        p_sender: "human",
        p_direction: "outgoing",
        p_message_type: "text",
        p_content: DEFAULT_MESSAGE_CONTENT,
        p_external_message_id: null,
        p_media_url: null,
        p_metadata: metadata,
      }
    );

    if (insertError) {
      throw new Error(`Falha ao criar mensagem do orcamento: ${insertError.message}`);
    }

    const messageId = extractInsertMessageId(insertData);
    if (!messageId) {
      throw new Error("A mensagem foi criada, mas nao foi possivel identificar o message_id.");
    }

    const sentAt = new Date().toISOString();
    const leadId = String(scope.quote.lead_id || "").trim();

    const { error: quoteUpdateError } = await scope.supabase
      .from("sales_quotes")
      .update({
        status: "sent",
        sent_at: sentAt,
      })
      .eq("id", scope.quote.id);

    if (quoteUpdateError) {
      throw new Error(`Falha ao atualizar sales_quotes: ${quoteUpdateError.message}`);
    }

    const { error: versionUpdateError } = await scope.supabase
      .from("sales_quote_versions")
      .update({
        status: "sent",
        sent_at: sentAt,
      })
      .eq("id", version.id);

    if (versionUpdateError) {
      throw new Error(
        `Falha ao atualizar sales_quote_versions: ${versionUpdateError.message}`
      );
    }

    await resolveOpenCommercialQuoteTasks({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      conversationId,
      leadId,
      resolvedAt: sentAt,
    });

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: {
        ...scope.quote,
        status: "sent",
      },
      eventType: SEND_EVENT_TYPE,
      payload: {
        quote_id: scope.quote.id,
        version_id: version.id,
        quote_number: scope.quote.quote_number,
        total_cents: scope.quote.total_cents,
        message_id: messageId,
        status: "sent",
      },
      createdBy: "human",
    });

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      quoteNumber: scope.quote.quote_number,
      status: "sent",
      versionId: version.id,
      messageId,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
