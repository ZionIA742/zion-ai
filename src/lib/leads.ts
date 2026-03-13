import { supabase } from "@/lib/supabaseBrowser";
import type { ColunaId } from "@/config/crm";

export type LeadRow = {
  id: string;
  org_id: string;
  store_id: string;
  state: ColunaId | string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function fetchLeads(params?: { storeId?: string; limit?: number }) {
  const limit = params?.limit ?? 200;

  let q = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.storeId) q = q.eq("store_id", params.storeId);

  const { data, error } = await q;
  if (error) throw new Error(`fetchLeads falhou: ${error.message}`);

  return (data ?? []) as LeadRow[];
}

export async function updateLeadState(leadId: string, nextState: ColunaId) {
  const { data, error } = await supabase
    .from("leads")
    .update({ state: nextState })
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw new Error(`updateLeadState falhou: ${error.message}`);
  return data as LeadRow;
}

export async function assumeLeadHuman(leadId: string) {
  return updateLeadState(leadId, "humano_assumiu");
}