import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const organizationId = body.organizationId;
    const conversationId = body.conversationId;
    const text = body.text;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1️⃣ salvar mensagem do cliente
    const { error: insertError } = await supabase.rpc("insert_message", {
      p_conversation_id: conversationId,
      p_sender: "user",
      p_direction: "incoming",
      p_message_type: "text",
      p_content: text,
      p_external_message_id: null,
      p_media_url: null,
      p_metadata: {
        source: "demo_customer"
      }
    });

    if (insertError) {
      return NextResponse.json({
        ok: false,
        error: insertError.message
      });
    }

    // 2️⃣ chamar IA
    const origin = new URL(req.url).origin;

    const aiResponse = await fetch(`${origin}/api/ai/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        organizationId,
        conversationId,
        customerMessage: text
      })
    });

    const aiJson = await aiResponse.json();

    return NextResponse.json({
      ok: true,
      ai: aiJson
    });

  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message
    });
  }
}