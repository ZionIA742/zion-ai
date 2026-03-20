// src/app/api/schedule/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ScheduleItemRow = {
  item_kind: string;
  item_id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  title: string;
  item_type: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
  source: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const organizationId = String(
      url.searchParams.get("organizationId") || ""
    ).trim();

    const storeId = String(url.searchParams.get("storeId") || "").trim();

    const start = String(url.searchParams.get("start") || "").trim();
    const end = String(url.searchParams.get("end") || "").trim();

    if (!organizationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_ORGANIZATION_ID",
          message: "organizationId não informado.",
        },
        { status: 400 }
      );
    }

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_STORE_ID",
          message: "storeId não informado.",
        },
        { status: 400 }
      );
    }

    if (!start) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_START",
          message: "Parâmetro start não informado.",
        },
        { status: 400 }
      );
    }

    if (!end) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_END",
          message: "Parâmetro end não informado.",
        },
        { status: 400 }
      );
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_START",
          message: "Parâmetro start inválido.",
        },
        { status: 400 }
      );
    }

    if (Number.isNaN(endDate.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_END",
          message: "Parâmetro end inválido.",
        },
        { status: 400 }
      );
    }

    if (endDate <= startDate) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_RANGE",
          message: "O parâmetro end deve ser maior que start.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message:
            "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase.rpc("list_store_schedule_items", {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_start_at: startDate.toISOString(),
      p_end_at: endDate.toISOString(),
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_SCHEDULE_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const items = ((data || []) as ScheduleItemRow[]).map((item) => ({
      itemKind: item.item_kind,
      itemId: item.item_id,
      organizationId: item.organization_id,
      storeId: item.store_id,
      leadId: item.lead_id,
      conversationId: item.conversation_id,
      title: item.title,
      itemType: item.item_type,
      status: item.status,
      startAt: item.start_at,
      endAt: item.end_at,
      customerName: item.customer_name,
      customerPhone: item.customer_phone,
      addressText: item.address_text,
      notes: item.notes,
      source: item.source,
      createdByUserId: item.created_by_user_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));

    return NextResponse.json({
      ok: true,
      organizationId,
      storeId,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      count: items.length,
      items,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SCHEDULE_ROUTE_FAILED",
        message: error?.message || "Erro interno ao carregar agenda.",
      },
      { status: 500 }
    );
  }
}