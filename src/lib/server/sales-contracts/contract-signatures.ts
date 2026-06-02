import type { SalesContract, SalesContractSignature } from "./types";

export function extractClientIp(headers: Headers) {
  const candidates = [
    headers.get("x-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("cf-connecting-ip"),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) {
      continue;
    }

    const first = value.split(",")[0]?.trim() || "";
    if (first) {
      return first;
    }
  }

  return null;
}

export async function loadExistingContractSignature(args: {
  supabase: any;
  contract: SalesContract;
  versionId: string;
  signerType: "customer" | "store";
}) {
  const { data, error } = await args.supabase
    .from("sales_contract_signatures")
    .select("*")
    .eq("contract_id", args.contract.id)
    .eq("organization_id", args.contract.organization_id)
    .eq("store_id", args.contract.store_id)
    .eq("contract_version_id", args.versionId)
    .eq("signer_type", args.signerType)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar assinatura do contrato: ${error.message}`);
  }

  return (data ?? null) as SalesContractSignature | null;
}
