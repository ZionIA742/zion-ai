import { NextResponse } from "next/server";
import {
  executeAssistantContractWorkflowAction,
  type AssistantContractWorkflowAction,
} from "@/lib/server/assistant/contract-workflow-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContractWorkflowActionRequestBody = {
  action?: string;
  messageId?: string;
};

function isValidAction(value: string): value is AssistantContractWorkflowAction {
  return value === "generate_contract";
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ContractWorkflowActionRequestBody;
    const action = String(body.action || "").trim();
    const messageId = String(body.messageId || "").trim();

    if (!isValidAction(action)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_ACTION",
          message: "A action precisa ser generate_contract.",
        },
        { status: 400 }
      );
    }

    if (!messageId) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_MESSAGE_ID",
          message: "messageId nao informado.",
        },
        { status: 400 }
      );
    }

    if (!isValidUuid(messageId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_MESSAGE_ID",
          message: "Message ID invalido.",
        },
        { status: 400 }
      );
    }

    const result = await executeAssistantContractWorkflowAction({
      request,
      action,
      messageId,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        action: result.action,
        messageId: result.messageId,
        message: result.message,
        error: result.error,
      },
      { status: result.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_CONTRACT_WORKFLOW_ROUTE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro interno ao executar a acao do card de pre-contrato.",
      },
      { status: 500 }
    );
  }
}
