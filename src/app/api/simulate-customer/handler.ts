import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "../../../lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "../../../lib/server/store-api-response";
import { routeIncomingCustomerReplyToOperationalTask } from "../../../lib/server/process-assistant-operational-tasks";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
  text?: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
  is_human_active: boolean | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

type PublicSuccessPayload = {
  ok: true;
  message: string;
  customerMessageSaved: true;
  aiReplySaved: boolean;
};

type PublicErrorPayload = {
  ok: false;
  error: string;
  message: string;
  customerMessageSaved?: boolean;
  aiReplySaved?: boolean;
};

type PrivilegedClient = SupabaseClient;

type HandlerDeps = {
  resolveAccess: () => Promise<StoreApiAccessResult>;
  createDeniedResponse: (access: StoreApiAccessDenied) => NextResponse;
  createPrivilegedClient: () => PrivilegedClient;
  runAiFlow: (args: {
    organizationId: string;
    storeId: string;
    conversationId: string;
  }) => Promise<
    | {
        ok: true;
      }
    | {
        ok: false;
        error: string;
        message: string;
      }
  >;
  routeOperationalCustomerReply: (args: {
    supabase: PrivilegedClient;
    organizationId: string;
    storeId: string;
    conversationId: string;
    messageId: string;
    customerMessage: string;
  }) => Promise<
    | {
        handled: false;
      }
    | {
        handled: true;
        ok: boolean;
        error?: string;
        reason?: string;
      }
  >;
};

const PUBLIC_INVALID_REQUEST_MESSAGE =
  "Envie uma conversa valida e um texto para simular.";
const PUBLIC_ROUTE_FAILED_MESSAGE =
  "Nao foi possivel concluir a simulacao do cliente no momento.";
const PUBLIC_AI_REPLY_UNAVAILABLE_MESSAGE =
  "Mensagem do cliente registrada, mas a IA nao conseguiu concluir a simulacao neste momento.";

function jsonNoStore(payload: PublicSuccessPayload | PublicErrorPayload, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function createPublicError(
  status: number,
  error: string,
  message: string,
  details?: Pick<PublicErrorPayload, "customerMessageSaved" | "aiReplySaved">,
) {
  return jsonNoStore(
    {
      ok: false,
      error,
      message,
      ...(details ?? {}),
    },
    status,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createPrivilegedSupabaseClient(): PrivilegedClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

const defaultDeps: HandlerDeps = {
  resolveAccess: () => resolveStoreApiAccess({ requirement: "active" }),
  createDeniedResponse: createStoreApiDeniedResponse,
  createPrivilegedClient: createPrivilegedSupabaseClient,
  runAiFlow: async (args) => {
    const { generateAndSaveAiSalesReply: runAiFlow } = await import(
      "../../../lib/server/generate-and-save-ai-sales-reply"
    );

    return runAiFlow(args);
  },
  routeOperationalCustomerReply: async (args) =>
    routeIncomingCustomerReplyToOperationalTask({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      customerMessage: args.customerMessage,
      workerName: "simulate-customer-inline-router",
    }),
};

export function createSimulateCustomerPostHandler(
  deps?: Partial<HandlerDeps>,
) {
  const resolvedDeps: HandlerDeps = {
    ...defaultDeps,
    ...deps,
  };

  return async function POST(req: Request) {
    const access = await resolvedDeps.resolveAccess();

    if (!access.ok) {
      return resolvedDeps.createDeniedResponse(access as StoreApiAccessDenied);
    }

    let body: RequestBody;

    try {
      const parsedBody = await req.json();

      if (!isPlainObject(parsedBody)) {
        return createPublicError(
          400,
          "SIMULATE_CUSTOMER_INVALID_REQUEST",
          PUBLIC_INVALID_REQUEST_MESSAGE,
        );
      }

      body = parsedBody as RequestBody;
    } catch {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_INVALID_REQUEST",
        PUBLIC_INVALID_REQUEST_MESSAGE,
      );
    }

    const conversationId = String(body.conversationId || "").trim();
    const text = String(body.text || "").trim();

    if (!conversationId || !text) {
      return createPublicError(
        400,
        "SIMULATE_CUSTOMER_INVALID_REQUEST",
        PUBLIC_INVALID_REQUEST_MESSAGE,
      );
    }

    let supabase: PrivilegedClient;

    try {
      supabase = resolvedDeps.createPrivilegedClient();
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        PUBLIC_ROUTE_FAILED_MESSAGE,
      );
    }

    let conversationData: unknown;
    let conversationError: { message: string } | null;

    try {
      ({
        data: conversationData,
        error: conversationError,
      } = await supabase
        .from("conversations")
        .select("id, organization_id, lead_id, is_human_active")
        .eq("id", conversationId)
        .eq("organization_id", access.organizationId)
        .maybeSingle());
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        PUBLIC_ROUTE_FAILED_MESSAGE,
      );
    }

    const conversation = conversationData as ConversationRow | null;

    if (conversationError) {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        "Nao foi possivel validar a conversa para esta simulacao.",
      );
    }

    if (!conversation) {
      return createPublicError(
        404,
        "SIMULATE_CUSTOMER_CONVERSATION_NOT_AVAILABLE",
        "Conversa indisponivel para esta simulacao.",
      );
    }

    if (conversation.is_human_active) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_CONVERSATION_UNAVAILABLE",
        "A conversa nao pode receber simulacao automatica neste momento.",
      );
    }

    const leadId = String(conversation.lead_id || "").trim();

    if (!leadId) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_CONVERSATION_UNAVAILABLE",
        "A conversa nao esta pronta para simulacao automatica.",
      );
    }

    let leadData: unknown;
    let leadError: { message: string } | null;

    try {
      ({ data: leadData, error: leadError } = await supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle());
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        PUBLIC_ROUTE_FAILED_MESSAGE,
      );
    }

    const lead = leadData as LeadRow | null;

    if (leadError) {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        "Nao foi possivel validar a conversa para esta simulacao.",
      );
    }

    if (!lead) {
      return createPublicError(
        404,
        "SIMULATE_CUSTOMER_CONVERSATION_NOT_AVAILABLE",
        "Conversa indisponivel para esta simulacao.",
      );
    }

    let insertData: unknown;
    let insertError: { message: string } | null;

    try {
      ({
        data: insertData,
        error: insertError,
      } = await supabase.rpc("insert_message", {
        p_conversation_id: conversation.id,
        p_sender: "user",
        p_direction: "incoming",
        p_message_type: "text",
        p_content: text,
        p_external_message_id: null,
        p_media_url: null,
        p_metadata: {
          source: "demo_customer",
          route: "simulate_customer",
        },
      }));
    } catch {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_ROUTE_FAILED",
        PUBLIC_ROUTE_FAILED_MESSAGE,
      );
    }

    if (insertError) {
      return createPublicError(
        500,
        "SIMULATE_CUSTOMER_MESSAGE_SAVE_FAILED",
        "Nao foi possivel registrar a mensagem simulada do cliente.",
      );
    }

    const insertedMessageId =
      typeof insertData === "string"
        ? insertData
        : typeof (insertData as { id?: unknown } | null | undefined)?.id === "string"
          ? String((insertData as { id?: string }).id)
          : "";

    if (insertedMessageId) {
      try {
        const operationalRoute = await resolvedDeps.routeOperationalCustomerReply({
          supabase,
          organizationId: access.organizationId,
          storeId: access.storeId,
          conversationId: conversation.id,
          messageId: insertedMessageId,
          customerMessage: text,
        });

        if (operationalRoute.handled) {
          if (!operationalRoute.ok) {
            return createPublicError(
              409,
              "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE",
              PUBLIC_AI_REPLY_UNAVAILABLE_MESSAGE,
              {
                customerMessageSaved: true,
                aiReplySaved: false,
              },
            );
          }

          return jsonNoStore(
            {
              ok: true,
              message: "Simulacao concluida com sucesso.",
              customerMessageSaved: true,
              aiReplySaved: false,
            },
            200,
          );
        }
      } catch {
        return createPublicError(
          409,
          "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE",
          PUBLIC_AI_REPLY_UNAVAILABLE_MESSAGE,
          {
            customerMessageSaved: true,
            aiReplySaved: false,
          },
        );
      }
    }

    let aiResult:
      | {
          ok: true;
        }
      | {
          ok: false;
          error: string;
          message: string;
        };

    try {
      aiResult = await resolvedDeps.runAiFlow({
        organizationId: access.organizationId,
        storeId: access.storeId,
        conversationId: conversation.id,
      });
    } catch {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE",
        PUBLIC_AI_REPLY_UNAVAILABLE_MESSAGE,
        {
          customerMessageSaved: true,
          aiReplySaved: false,
        },
      );
    }

    if (!aiResult.ok) {
      return createPublicError(
        409,
        "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE",
        PUBLIC_AI_REPLY_UNAVAILABLE_MESSAGE,
        {
          customerMessageSaved: true,
          aiReplySaved: false,
        },
      );
    }

    return jsonNoStore(
      {
        ok: true,
        message: "Simulacao concluida com sucesso.",
        customerMessageSaved: true,
        aiReplySaved: true,
      },
      200,
    );
  };
}

export const POST = createSimulateCustomerPostHandler();
