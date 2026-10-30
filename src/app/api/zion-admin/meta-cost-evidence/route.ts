import { createClient } from "@supabase/supabase-js";

import {
  resolveZionAdminApiAccess,
} from "@/lib/server/zion-admin-api-access";

import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";

import {
  summarizeMetaCostEvidence,
  type MetaCostEvidenceRow,
} from "@/lib/server/zion-admin-meta-cost-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 500;
const MAX_ROWS = 50000;

export async function GET(request: Request) {
  const access = await resolveZionAdminApiAccess();

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  const month = new URL(request.url).searchParams.get("month");

  if (!month || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return createZionAdminApiJsonResponse(
      { ok: false, error: "INVALID_MONTH" },
      400,
    );
  }

  const [year, monthNumber] = month.split("-").map(Number);

  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return createZionAdminApiJsonResponse(
      { ok: false, error: "META_COST_EVIDENCE_UNAVAILABLE" },
      503,
    );
  }

  try {
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const rows: MetaCostEvidenceRow[] = [];
    let complete = false;

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await db
        .from("messages")
        .select("id,store_id,delivered_at,metadata")
        .eq("direction", "outgoing")
        .is("deleted_at", null)
        .gte("delivered_at", start.toISOString())
        .lt("delivered_at", end.toISOString())
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error || !data) {
        throw new Error("META_MESSAGE_QUERY_FAILED");
      }

      rows.push(...(data as MetaCostEvidenceRow[]));

      if (data.length < PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    if (!complete) {
      return createZionAdminApiJsonResponse(
        { ok: false, error: "META_COST_EVIDENCE_LIMIT" },
        503,
      );
    }

    return createZionAdminApiJsonResponse({
      ok: true,
      month,
      source: "whatsapp_delivery_webhook",
      confirmedBilling: false,
      ...summarizeMetaCostEvidence(rows),
    }, 200);
  } catch {
    return createZionAdminApiJsonResponse(
      { ok: false, error: "META_COST_EVIDENCE_UNAVAILABLE" },
      503,
    );
  }
}