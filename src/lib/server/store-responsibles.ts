import { createClient } from "@supabase/supabase-js";

export type CanonicalStoreResponsible = {
  id: string;
  name: string | null;
  role: string | null;
  whatsappNumber: string;
};

type StoreResponsibleRow = {
  id: string;
  name: string | null;
  role: string | null;
  whatsapp_number: string | null;
};

export type LoadCanonicalStoreResponsibleResult =
  | {
      ok: true;
      responsible: CanonicalStoreResponsible;
    }
  | {
      ok: false;
      reason:
        | "responsible_primary_not_configured"
        | "responsible_primary_state_invalid"
        | "responsible_primary_invalid_destination";
    };

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function normalizeResponsibleWhatsappDestination(value: string): string | null {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  if (digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length >= 12 && digits.length <= 15) {
    return digits;
  }

  return null;
}

export async function loadCanonicalActivePrimaryStoreResponsible(args: {
  supabase?: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  storeId: string;
}): Promise<LoadCanonicalStoreResponsibleResult> {
  const supabase = args.supabase || getSupabaseAdmin();

  const { data, error } = await supabase
    .from("store_responsibles")
    .select("id, name, role, whatsapp_number")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("is_primary", true)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Falha ao carregar store_responsibles canonicos: ${error.message}`);
  }

  const rows = ((data || []) as StoreResponsibleRow[]).map((row) => ({
    id: row.id,
    name: cleanText(row.name) || null,
    role: cleanText(row.role) || null,
    whatsappNumber: normalizeResponsibleWhatsappDestination(
      cleanText(row.whatsapp_number)
    ),
  }));

  if (rows.length === 0) {
    return { ok: false, reason: "responsible_primary_not_configured" };
  }

  if (rows.length !== 1) {
    return { ok: false, reason: "responsible_primary_state_invalid" };
  }

  if (!rows[0]?.whatsappNumber) {
    return { ok: false, reason: "responsible_primary_invalid_destination" };
  }

  return {
    ok: true,
    responsible: {
      id: rows[0].id,
      name: rows[0].name,
      role: rows[0].role,
      whatsappNumber: rows[0].whatsappNumber,
    },
  };
}
