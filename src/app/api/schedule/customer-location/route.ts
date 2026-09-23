import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import {
  resolveLeadConversationOpportunityContext,
  type LeadOpportunityContextRow,
} from "@/lib/server/crm/lead-conversation-opportunity-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeadScopeRow = {
  id: string;
  organization_id: string;
  store_id: string;
};

type OpportunityScopeRow = {
  id: string;
  organization_id: string;
  store_id: string;
  origin_lead_id: string | null;
  primary_conversation_id: string | null;
  stage: string | null;
  stage_changed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type QualificationKnownFact = {
  factKey?: unknown;
  state?: unknown;
  valueKind?: unknown;
  value?: unknown;
  normalizedValueText?: unknown;
};

type QualificationConflictFact = {
  factKey?: unknown;
};

type QualificationFactsRow = {
  organization_id?: unknown;
  store_id?: unknown;
  commercial_opportunity_id?: unknown;
  known_facts?: unknown;
  conflicts?: unknown;
};

export type ScheduleCustomerLocationState =
  | "confirmed"
  | "inferred"
  | "conflict"
  | "absent";

export type ScheduleCustomerLocationResolution =
  | "resolved"
  | "requires_opportunity_selection"
  | "no_active_opportunity";

type ScheduleCustomerLocationDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => any;
  loadLead: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    leadId: string;
  }) => Promise<LeadScopeRow | null>;
  loadOpportunities: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    leadId: string;
  }) => Promise<OpportunityScopeRow[]>;
  readQualificationFacts: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    commercialOpportunityId: string;
  }) => Promise<QualificationFactsRow[]>;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "*",
    },
  });
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function createPrivilegedClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loadLead(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  leadId: string;
}) {
  const { data, error } = await args.supabase
    .from("leads")
    .select("id, organization_id, store_id")
    .eq("id", args.leadId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar lead da agenda: ${error.message}`);
  }

  return data ?? null;
}

async function loadOpportunities(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  leadId: string;
}) {
  const { data, error } = await args.supabase
    .from("commercial_opportunities")
    .select(
      "id, organization_id, store_id, origin_lead_id, primary_conversation_id, stage, stage_changed_at, created_at, updated_at",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("origin_lead_id", args.leadId);

  if (error) {
    throw new Error(
      `Falha ao carregar opportunities comerciais da agenda: ${error.message}`,
    );
  }

  return (data || []) as OpportunityScopeRow[];
}

async function readQualificationFacts(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "read_commercial_opportunity_qualification_facts_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
    },
  );

  if (error) {
    throw new Error(
      `Falha ao ler qualification facts canonicos: ${error.message}`,
    );
  }

  return Array.isArray(data) ? (data as QualificationFactsRow[]) : [];
}

function toOpportunityContextRow(
  row: OpportunityScopeRow,
): LeadOpportunityContextRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    leadId: row.origin_lead_id || "",
    conversationId: row.primary_conversation_id,
    stage: row.stage,
    stageChangedAt: row.stage_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function resolveLocationFromQualificationFacts(
  row: QualificationFactsRow,
): {
  state: ScheduleCustomerLocationState;
  text: string | null;
} {
  const conflicts = Array.isArray(row.conflicts)
    ? (row.conflicts as QualificationConflictFact[])
    : [];

  const hasLocationConflict = conflicts.some(
    (fact) => normalizeOptionalText(fact?.factKey) === "customer_address_text",
  );

  if (hasLocationConflict) {
    return {
      state: "conflict",
      text: null,
    };
  }

  const knownFacts = Array.isArray(row.known_facts)
    ? (row.known_facts as QualificationKnownFact[])
    : [];

  const locationFact =
    knownFacts.find((fact) => {
      const factKey = normalizeOptionalText(fact?.factKey);
      const state = normalizeOptionalText(fact?.state);

      return (
        factKey === "customer_address_text" &&
        (state === "confirmed" || state === "inferred")
      );
    }) ?? null;

  if (!locationFact) {
    return {
      state: "absent",
      text: null,
    };
  }

  const factState = normalizeOptionalText(locationFact.state);
  const normalizedValueText = normalizeOptionalText(
    locationFact.normalizedValueText,
  );
  const rawText =
    typeof locationFact.value === "string"
      ? normalizeOptionalText(locationFact.value)
      : null;

  const text = rawText || normalizedValueText;

  if (!text || (factState !== "confirmed" && factState !== "inferred")) {
    return {
      state: "absent",
      text: null,
    };
  }

  return {
    state: factState,
    text,
  };
}

export function createScheduleCustomerLocationGetHandler(
  deps: Partial<ScheduleCustomerLocationDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;
  const loadScopedLead = deps.loadLead ?? loadLead;
  const loadScopedOpportunities = deps.loadOpportunities ?? loadOpportunities;
  const readScopedQualificationFacts =
    deps.readQualificationFacts ?? readQualificationFacts;

  return async function GET(request: Request) {
    try {
      const url = new URL(request.url);
      const leadId = normalizeOptionalText(url.searchParams.get("leadId"));
      const requestedOpportunityId = normalizeOptionalText(
        url.searchParams.get("commercialOpportunityId"),
      );

      if (!leadId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_LEAD_ID",
            message: "Informe o lead para consultar a localizacao.",
          },
          400,
        );
      }

      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const organizationId = access.organizationId;
      const storeId = access.storeId;
      const supabase = createClientWithPrivileges();

      const lead = await loadScopedLead({
        supabase,
        organizationId,
        storeId,
        leadId,
      });

      if (!lead) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LEAD_NOT_FOUND",
            message: "Lead nao encontrado no escopo ativo da loja.",
          },
          404,
        );
      }

      const opportunityRows = await loadScopedOpportunities({
        supabase,
        organizationId,
        storeId,
        leadId,
      });

      const context = resolveLeadConversationOpportunityContext({
        organizationId,
        storeId,
        leadId,
        requestedOpportunityId,
        conversations: [],
        opportunities: opportunityRows.map(toOpportunityContextRow),
      });

      if (!context.ok) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_SCOPE_REJECTED",
            message:
              "A opportunity informada nao pertence ao contexto comercial deste lead.",
          },
          404,
        );
      }

      if (context.requiresOpportunitySelection) {
        return buildJsonResponse({
          ok: true,
          leadId,
          commercialOpportunityId: null,
          resolution: "requires_opportunity_selection",
          location: null,
        });
      }

      if (!context.selectedOpportunity) {
        return buildJsonResponse({
          ok: true,
          leadId,
          commercialOpportunityId: null,
          resolution: "no_active_opportunity",
          location: null,
        });
      }

      const commercialOpportunityId = context.selectedOpportunity.id;

      const qualificationRows = await readScopedQualificationFacts({
        supabase,
        organizationId,
        storeId,
        commercialOpportunityId,
      });

      if (qualificationRows.length !== 1) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_QUALIFICATION_SNAPSHOT",
            message:
              "O reader canonico de qualification facts retornou um snapshot invalido.",
          },
          500,
        );
      }

      const qualificationRow = qualificationRows[0];

      if (
        normalizeOptionalText(qualificationRow.organization_id) !==
          organizationId ||
        normalizeOptionalText(qualificationRow.store_id) !== storeId ||
        normalizeOptionalText(
          qualificationRow.commercial_opportunity_id,
        ) !== commercialOpportunityId
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "INVALID_QUALIFICATION_SNAPSHOT_SCOPE",
            message:
              "O snapshot canonico de qualification facts retornou escopo inconsistente.",
          },
          500,
        );
      }

        if (
          !Array.isArray(qualificationRow.known_facts) ||
          !Array.isArray(qualificationRow.conflicts)
        ) {
          return buildJsonResponse(
            {
              ok: false,
              error: "INVALID_QUALIFICATION_SNAPSHOT",
              message:
                "O reader canonico de qualification facts retornou campos obrigatorios invalidos.",
              detail: "MALFORMED_QUALIFICATION_SNAPSHOT_FIELDS",
            },
            500,
          );
        }
      const location = resolveLocationFromQualificationFacts(qualificationRow);

      return buildJsonResponse({
        ok: true,
        leadId,
        commercialOpportunityId,
        resolution: "resolved",
        location,
      });
    } catch (error: unknown) {
      return buildJsonResponse(
        {
          ok: false,
          error: "SCHEDULE_CUSTOMER_LOCATION_ROUTE_FAILED",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Erro interno ao carregar localizacao canonica do cliente.",
        },
        500,
      );
    }
  };
}

export const GET = createScheduleCustomerLocationGetHandler();