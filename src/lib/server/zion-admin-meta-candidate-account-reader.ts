/**
 * Leitura candidata das contas financeiras Meta.
 *
 * Os vinculos sao historico observado, nao prova
 * de fatura, pagamento, isencao ou custo zero.
 *
 * O censo usa integracoes ATIVAS no momento da
 * leitura. Nao certifica cobertura historica.
 */
import type {
  createServiceSupabaseClient,
} from "./zion-account-provisioning";

type Db = ReturnType<typeof createServiceSupabaseClient>;

type Integration = {
  id: string;
  whatsapp_business_account_id: string | null;
};

type Binding = {
  integration_id: string;
  whatsapp_business_account_id: string;
  event_type: string;
  financial_account_type: string | null;
  financial_account_id: string | null;
  authority_status: string;
};

export type CandidateAccount = {
  financialAccountType: string;
  financialAccountId: string;
};

export type CandidateAccountReadResult =
  | {
      ok: true;
      status: "candidate_only";
      scope: "current_active_integrations";
      accounts: CandidateAccount[];
    }
  | {
      ok: false;
      reason: "CENSUS_UNAVAILABLE" | "CENSUS_INCOMPLETE";
    };

const PAGE = 250;
const MAX_INTEGRATIONS = 5000;
const MAX_EVENTS = 20000;
const WABA = /^\d{5,25}$/;
const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;

export async function readMetaCandidateAccounts(
  db: Db,
): Promise<CandidateAccountReadResult> {
  try {
    const integrations: Integration[] = [];

    for (
      let offset = 0;
      offset < MAX_INTEGRATIONS;
      offset += PAGE
    ) {
      const { data, error } = await db
        .from("external_integrations")
        .select("id,whatsapp_business_account_id")
        .eq("provider", "whatsapp")
        .eq("is_active", true)
        .not("whatsapp_business_account_id", "is", null)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (error || !data) {
        return { ok: false, reason: "CENSUS_UNAVAILABLE" };
      }

      integrations.push(...data);

      if (data.length < PAGE) break;
    }

    if (
      integrations.length === 0 ||
      integrations.length >= MAX_INTEGRATIONS
    ) {
      return { ok: false, reason: "CENSUS_INCOMPLETE" };
    }

    const events: Binding[] = [];

    for (
      let offset = 0;
      offset < MAX_EVENTS;
      offset += PAGE
    ) {
      const { data, error } = await db
        .from("zion_admin_meta_financial_binding_events")
        .select(
          "integration_id,whatsapp_business_account_id,event_type,financial_account_type,financial_account_id,authority_status",
        )
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);

      if (error || !data) {
        return { ok: false, reason: "CENSUS_UNAVAILABLE" };
      }

      events.push(...data);

      if (data.length < PAGE) break;
    }

    if (
      events.length === 0 ||
      events.length >= MAX_EVENTS
    ) {
      return { ok: false, reason: "CENSUS_INCOMPLETE" };
    }

    // Eventos chegam em ordem decrescente de ID.
    // O primeiro evento de cada integracao e o
    // estado candidato mais recente registrado.
    const latest = new Map<string, Binding>();

    for (const event of events) {
      if (!latest.has(event.integration_id)) {
        latest.set(event.integration_id, event);
      }
    }

    const accounts = new Map<string, CandidateAccount>();
    const seenWabas = new Set<string>();

    for (const integration of integrations) {
      const waba = integration.whatsapp_business_account_id;

      if (
        !waba ||
        !WABA.test(waba) ||
        seenWabas.has(waba)
      ) {
        return { ok: false, reason: "CENSUS_INCOMPLETE" };
      }

      seenWabas.add(waba);

      const binding = latest.get(integration.id);

      if (
        !binding ||
        binding.whatsapp_business_account_id !== waba ||
        binding.event_type !== "bound" ||
        binding.authority_status !== "candidate_only" ||
        !(
          binding.financial_account_type ===
            "messaging_account" ||
          binding.financial_account_type ===
            "business_portfolio"
        ) ||
        !binding.financial_account_id ||
        !ACCOUNT.test(binding.financial_account_id)
      ) {
        return { ok: false, reason: "CENSUS_INCOMPLETE" };
      }

      const key = JSON.stringify([
        binding.financial_account_type,
        binding.financial_account_id,
      ]);

      accounts.set(key, {
        financialAccountType: binding.financial_account_type,
        financialAccountId: binding.financial_account_id,
      });
    }

    if (accounts.size === 0) {
      return { ok: false, reason: "CENSUS_INCOMPLETE" };
    }

    return {
      ok: true,
      status: "candidate_only",
      scope: "current_active_integrations",
      accounts: [...accounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, account]) => account),
    };
  } catch {
    return { ok: false, reason: "CENSUS_UNAVAILABLE" };
  }
}