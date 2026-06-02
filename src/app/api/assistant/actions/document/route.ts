import { NextResponse } from "next/server";
import {
  executeAssistantDocumentAction,
  type AssistantDocumentAction,
  type AssistantDocumentType,
} from "@/lib/server/assistant/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DocumentActionRequestBody = {
  action?: string;
  documentType?: string;
  documentId?: string;
};

function isValidAction(value: string): value is AssistantDocumentAction {
  return (
    value === "review" ||
    value === "approve_and_send" ||
    value === "confirm_store_signature"
  );
}

function isValidDocumentType(value: string): value is AssistantDocumentType {
  return value === "quote" || value === "contract";
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DocumentActionRequestBody;
    const action = String(body.action || "").trim();
    const documentType = String(body.documentType || "").trim().toLowerCase();
    const documentId = String(body.documentId || "").trim();

    if (!isValidAction(action)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_ACTION",
          message:
            "A action precisa ser review, approve_and_send ou confirm_store_signature.",
        },
        { status: 400 }
      );
    }

    if (!isValidDocumentType(documentType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_DOCUMENT_TYPE",
          message: "documentType precisa ser quote ou contract.",
        },
        { status: 400 }
      );
    }

    if (!documentId) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_DOCUMENT_ID",
          message: "documentId nao informado.",
        },
        { status: 400 }
      );
    }

    if (!isValidUuid(documentId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_DOCUMENT_ID",
          message: "Dados do documento incompletos ou invalidos.",
        },
        { status: 400 }
      );
    }

    const result = await executeAssistantDocumentAction({
      request,
      action,
      documentType,
      documentId,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        documentType: result.documentType,
        documentId: result.documentId,
        action: result.action,
        message: result.message,
        signedUrl: result.signedUrl,
        error: result.error,
      },
      { status: result.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_DOCUMENT_ACTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro interno ao executar a acao de documento da assistente.",
      },
      { status: 500 }
    );
  }
}
