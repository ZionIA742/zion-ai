// src/app/api/ai/reply/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "LEGACY_AI_REPLY_ENDPOINT_DISABLED",
      message:
        "Este endpoint legado foi desativado para evitar bypass do motor comercial avançado. Use o fluxo baseado em insert_message + trigger + worker.",
    },
    { status: 410 }
  );
}