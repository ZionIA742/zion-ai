import { NextResponse } from "next/server";
import { processWhatsappInbox } from "@/lib/server/whatsapp-inbox-processor";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  limit?: number;
};

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "whatsapp-process-inbox",
    method: "GET",
    message: "rota publicada e funcionando",
  });
}

export async function POST(request: Request) {
  try {
    const internalSecret = process.env.AI_INTERNAL_ROUTE_SECRET;

    if (!internalSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI_INTERNAL_ROUTE_SECRET nao esta definido no servidor",
        },
        { status: 500 },
      );
    }

    const providedSecret = request.headers.get("x-zion-internal-secret");

    if (!providedSecret || providedSecret !== internalSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: "unauthorized",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? body.limit
        : 10;

    if (!organizationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "organizationId e obrigatorio",
        },
        { status: 400 },
      );
    }

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId e obrigatorio",
        },
        { status: 400 },
      );
    }

    const result = await processWhatsappInbox({
      organizationId,
      storeId,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro interno inesperado";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
