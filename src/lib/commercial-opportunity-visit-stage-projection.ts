export type TechnicalVisitStageProjectionOutcome =
  | "advanced_to_visita_tecnica"
  | "already_in_visit_stage"
  | "stage_not_eligible_for_automatic_visit_projection"
  | "idempotent_replay";

export const TECHNICAL_VISIT_STAGE_PROJECTION_ACCEPTED_OUTCOMES =
  new Set<TechnicalVisitStageProjectionOutcome>([
    "advanced_to_visita_tecnica",
    "already_in_visit_stage",
    "stage_not_eligible_for_automatic_visit_projection",
    "idempotent_replay",
  ]);

export const TECHNICAL_VISIT_STAGE_PROJECTION_REASON_DETAILS =
  "technical visit scheduled";

type VisitStageProjectionRpcRow = {
  commercial_opportunity_id: string;
  appointment_id: string;
  stage: string;
  lifecycle_cycle: number;
  lifecycle_event_id: string | null;
  event_type: string | null;
  reason_code: string | null;
  stage_changed: boolean;
  outcome: string;
  stage_changed_at: string | null;
  updated_at: string | null;
};

export class TechnicalVisitStageProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TechnicalVisitStageProjectionError";
  }
}

export function buildTechnicalVisitStageProjectionIdempotencyKey(args: {
  appointmentId: string;
  commercialOpportunityId: string;
}) {
  return `technical_visit_stage_projection:${args.appointmentId}:${args.commercialOpportunityId}`;
}

export function shouldAttemptTechnicalVisitStageProjection(args: {
  appointmentType: string | null | undefined;
  appointmentStatus: string | null | undefined;
  commercialOpportunityId: string | null | undefined;
}) {
  const appointmentType = String(args.appointmentType || "").trim().toLowerCase();
  const appointmentStatus = String(args.appointmentStatus || "").trim().toLowerCase();
  const commercialOpportunityId =
    String(args.commercialOpportunityId || "").trim() || null;

  return (
    commercialOpportunityId !== null &&
    appointmentType === "technical_visit" &&
    (appointmentStatus === "scheduled" || appointmentStatus === "rescheduled")
  );
}

function normalizeProjectionRow(data: unknown) {
  const row = Array.isArray(data)
    ? ((data[0] as VisitStageProjectionRpcRow | undefined) ?? null)
    : ((data as VisitStageProjectionRpcRow | null) ?? null);

  if (
    !row ||
    !TECHNICAL_VISIT_STAGE_PROJECTION_ACCEPTED_OUTCOMES.has(
      row.outcome as TechnicalVisitStageProjectionOutcome,
    )
  ) {
    throw new TechnicalVisitStageProjectionError(
      "A agenda foi atualizada, mas a projecao comercial retornou um resultado invalido.",
    );
  }

  return row;
}

export async function projectTechnicalVisitStageBySystem(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  appointmentId: string;
  source: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "advance_commercial_opportunity_to_technical_visit_stage_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_appointment_id: args.appointmentId,
      p_idempotency_key: buildTechnicalVisitStageProjectionIdempotencyKey({
        appointmentId: args.appointmentId,
        commercialOpportunityId: args.commercialOpportunityId,
      }),
      p_reason_details: TECHNICAL_VISIT_STAGE_PROJECTION_REASON_DETAILS,
      p_source: args.source,
    },
  );

  if (error) {
    throw new TechnicalVisitStageProjectionError(
      "A agenda foi atualizada, mas nao foi possivel sincronizar a opportunity comercial.",
    );
  }

  return normalizeProjectionRow(data);
}

export async function projectTechnicalVisitStageByUser(args: {
  supabase: {
    rpc: (
      fn: string,
      payload: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  appointmentId: string;
  source: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "advance_commercial_opportunity_to_technical_visit_stage_by_user",
    {
      p_request_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
      p_appointment_id: args.appointmentId,
      p_idempotency_key: buildTechnicalVisitStageProjectionIdempotencyKey({
        appointmentId: args.appointmentId,
        commercialOpportunityId: args.commercialOpportunityId,
      }),
      p_reason_details: TECHNICAL_VISIT_STAGE_PROJECTION_REASON_DETAILS,
      p_source: args.source,
    },
  );

  if (error) {
    throw new TechnicalVisitStageProjectionError(
      "A agenda foi atualizada, mas nao foi possivel sincronizar a opportunity comercial.",
    );
  }

  return normalizeProjectionRow(data);
}
