// src/app/api/openai/test/route.ts
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_API_KEY_NOT_FOUND",
          message: "A variável OPENAI_API_KEY não foi encontrada no .env.local",
        },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "Você é a IA de teste do projeto ZION, uma IA comercial para lojas de piscinas. Responda de forma curta, objetiva e em português do Brasil.",
        },
        {
          role: "user",
          content: "Responda apenas: OpenAI conectada com sucesso ao ZION.",
        },
      ],
    });

    const text = response.output_text?.trim() || "(sem texto retornado)";

    return NextResponse.json({
      ok: true,
      model: "gpt-5-mini",
      text,
      raw_has_output_text: !!response.output_text,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "OPENAI_REQUEST_FAILED",
        message: error?.message ?? "Erro desconhecido ao chamar a OpenAI",
        details: error ?? null,
      },
      { status: 500 }
    );
  }
}