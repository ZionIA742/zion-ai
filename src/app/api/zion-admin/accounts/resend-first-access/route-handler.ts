import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import type { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { type writeZionAdminAuditEvent } from "@/lib/server/zion-admin-audit";
import type {
  createFirstAccessAttemptId,
  createFirstAccessInviteMetadataPatch,
  createServiceSupabaseClient,
  getAuthAdminUserByIdWithRetry,
  getAuthAdminUserById,
  getFirstAccessInviteCooldownRemainingMs,
  getFirstAccessInviteRedirectTo,
  getProvisioningAccountAccessSummary,
  isFirstAccessInviteCooldownActive,
  maskEmail,
  mergeProvisioningAppMetadata,
  readFirstAccessInviteId,
} from "@/lib/server/zion-account-provisioning";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type MembershipRow = {
  id: string;
  user_id: string;
  organization_id: string;
  role: string | null;
  created_at: string | null;
};

type ZionAdminAccessResult = Awaited<ReturnType<typeof resolveZionAdminApiAccess>>;

export type ResendFirstAccessHandlerDeps = {
  resolveAccess: typeof resolveZionAdminApiAccess;
  createServiceSupabase: typeof createServiceSupabaseClient;
  createAttemptId: typeof createFirstAccessAttemptId;
  createInviteMetadataPatch: typeof createFirstAccessInviteMetadataPatch;
  getAuthAdminUserById: typeof getAuthAdminUserById;
  getAuthAdminUserByIdWithRetry: typeof getAuthAdminUserByIdWithRetry;
  getCooldownRemainingMs: typeof getFirstAccessInviteCooldownRemainingMs;
  getInviteRedirectTo: typeof getFirstAccessInviteRedirectTo;
  getAccountAccessSummary: typeof getProvisioningAccountAccessSummary;
  isInviteCooldownActive: typeof isFirstAccessInviteCooldownActive;
  maskEmail: typeof maskEmail;
  mergeProvisioningAppMetadata: typeof mergeProvisioningAppMetadata;
  readFirstAccessInviteId: typeof readFirstAccessInviteId;
  writeAuditEvent: typeof writeZionAdminAuditEvent;
};

function getErrorDetails(error: unknown) {
  const value = error as {
    message?: string | null;
    code?: string | null;
    status?: number | null;
    publicMessage?: string | null;
  } | null;

  return {
    message: value?.message ?? null,
    code: value?.code ?? null,
    status: value?.status ?? null,
    publicMessage: value?.publicMessage ?? null,
  };
}

function normalizeRole(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isConfirmedAuthUser(user: { email_confirmed_at?: string | null } | null | undefined) {
  return Boolean(String(user?.email_confirmed_at || "").trim());
}

async function restorePreviousMetadata(
  deps: ResendFirstAccessHandlerDeps,
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  previousMetadata: Record<string, unknown> | null,
  expectedAttemptId: string,
) {
  const latestUser = await deps.getAuthAdminUserById(serviceSupabase, userId);

  if (deps.readFirstAccessInviteId(latestUser.app_metadata) !== expectedAttemptId) {
    return {
      restored: false,
      replacedByNewerAttempt: true,
    };
  }

  const { error: restoreError } = await serviceSupabase.auth.admin.updateUserById(userId, {
    app_metadata: previousMetadata ?? {},
  });

  if (restoreError) {
    return {
      restored: false,
      replacedByNewerAttempt: false,
    };
  }

  return {
    restored: true,
    replacedByNewerAttempt: false,
  };
}

export async function handleResendFirstAccess(
  request: Request,
  deps: ResendFirstAccessHandlerDeps,
): Promise<Response> {
  let actorUserId: string | null = null;
  let resolvedStore: StoreRow | null = null;
  let resolvedMembership: MembershipRow | null = null;
  let resolvedTargetUserId: string | null = null;
  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient> | null = null;
  let operationId: string | null = null;

  try {
    const access = (await deps.resolveAccess()) as ZionAdminAccessResult;

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    actorUserId = access.sessionUserId;

    const body = await request.json().catch(() => null);
    const storeId = String(body?.storeId || "").trim();

    if (!storeId) {
      return createZionAdminApiJsonResponse(
        {
          error: "Store ID obrigatorio.",
        },
        400,
      );
    }

    serviceSupabase = deps.createServiceSupabase();
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    resolvedStore = store ?? null;

    if (!store?.id || !store.organization_id) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "store",
        targetId: storeId || null,
        outcome: "denied",
        reasonCode: "store_not_found",
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Loja nao encontrada.",
        },
        404,
      );
    }

    const { data: memberships, error: membershipsError } = await serviceSupabase
      .from("memberships")
      .select("id, user_id, organization_id, role, created_at")
      .eq("organization_id", store.organization_id)
      .order("created_at", { ascending: true });

    if (membershipsError) {
      throw membershipsError;
    }

    const ownerMemberships = ((memberships ?? []) as MembershipRow[]).filter(
      (row) => normalizeRole(row.role) === "owner",
    );

    if (ownerMemberships.length !== 1) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "store",
        targetId: store.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "owner_target_ambiguous",
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "A loja possui alvo de primeiro acesso inexistente ou ambiguo.",
        },
        409,
      );
    }

    const targetMembership = ownerMemberships[0];
    resolvedMembership = targetMembership;
    resolvedTargetUserId = targetMembership.user_id;
    const { data: internalAdminRow, error: internalAdminError } = await serviceSupabase
      .from("zion_internal_admins")
      .select("user_id")
      .eq("user_id", targetMembership.user_id)
      .maybeSingle<{ user_id: string | null }>();

    if (internalAdminError) {
      throw internalAdminError;
    }

    if (internalAdminRow?.user_id) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: targetMembership.user_id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "internal_admin_target_protected",
        membershipId: targetMembership.id,
        userId: targetMembership.user_id,
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "A conta interna do ZION nao pode receber convite de loja.",
        },
        409,
      );
    }

    const authUser = await deps.getAuthAdminUserById(serviceSupabase, targetMembership.user_id);
    const accountSummary = deps.getAccountAccessSummary(authUser);

    if (accountSummary.status !== "first_access_pending") {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: authUser.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "first_access_not_pending",
        membershipId: targetMembership.id,
        userId: authUser.id,
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Esta conta nao esta apta para reenviar o link de primeira senha.",
        },
        409,
      );
    }

    const { data: commercialAccess, error: commercialAccessError } = await serviceSupabase.rpc(
      "get_org_access_status",
      {
        p_org_id: store.organization_id,
      },
    );

    if (commercialAccessError) {
      throw commercialAccessError;
    }

    if (
      commercialAccess &&
      typeof commercialAccess === "object" &&
      "is_blocked" in commercialAccess &&
      (commercialAccess as { is_blocked?: unknown }).is_blocked === true
    ) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: authUser.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "account_blocked",
        membershipId: targetMembership.id,
        userId: authUser.id,
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "A conta da loja esta bloqueada e nao pode receber reenvio comum.",
        },
        409,
      );
    }

    if (deps.isInviteCooldownActive(authUser.app_metadata)) {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: authUser.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "denied",
        reasonCode: "first_access_cooldown_active",
        membershipId: targetMembership.id,
        userId: authUser.id,
        serviceSupabase,
      });
      return createZionAdminApiJsonResponse(
        {
          error: "Aguarde antes de reenviar um novo link.",
          cooldownRemainingMs: deps.getCooldownRemainingMs(authUser.app_metadata),
        },
        429,
      );
    }

    const previousMetadata = authUser.app_metadata ?? null;
    const nextAttemptId = deps.createAttemptId();
    const sentAt = new Date().toISOString();
    const redirectTo = deps.getInviteRedirectTo(nextAttemptId);
    const nextMetadata = deps.mergeProvisioningAppMetadata(
      previousMetadata,
      deps.createInviteMetadataPatch({
        attemptId: nextAttemptId,
        sentAt,
        sentBy: access.sessionUserId,
        status: "provisioned",
      }),
    );

    operationId =
      (await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: authUser.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "started",
        membershipId: targetMembership.id,
        userId: authUser.id,
        serviceSupabase,
      })) ?? crypto.randomUUID();

    const { error: metadataError } = await serviceSupabase.auth.admin.updateUserById(authUser.id, {
      app_metadata: nextMetadata,
    });

    if (metadataError) {
      throw metadataError;
    }

    const email = String(authUser.email || "").trim().toLowerCase();
    let deliveryError: unknown = null;

    if (isConfirmedAuthUser(authUser)) {
      const { error } = await serviceSupabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      deliveryError = error;
    } else {
      const { error } = await serviceSupabase.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      deliveryError = error;
    }

    if (deliveryError) {
      const restoreState = await restorePreviousMetadata(
        deps,
        serviceSupabase,
        authUser.id,
        previousMetadata,
        nextAttemptId,
      );

      if (!restoreState.restored && !restoreState.replacedByNewerAttempt) {
        throw Object.assign(
          new Error(
            "A metadata administrativa do primeiro acesso exige revisao manual antes de novo envio.",
          ),
          {
            publicMessage:
              "A metadata administrativa do primeiro acesso exige revisao manual antes de novo envio.",
            status: 409,
          },
        );
      }

      if (restoreState.replacedByNewerAttempt) {
        throw Object.assign(
          new Error(
            "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
          ),
          {
            publicMessage:
              "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
            status: 409,
          },
        );
      }

      throw deliveryError;
    }

    const latestAuthUser = await deps.getAuthAdminUserByIdWithRetry(
      serviceSupabase,
      authUser.id,
    );

    if (deps.readFirstAccessInviteId(latestAuthUser.app_metadata) !== nextAttemptId) {
      throw Object.assign(
        new Error(
          "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
        ),
        {
          publicMessage:
            "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
          status: 409,
        },
      );
    }

    try {
      await deps.writeAuditEvent({
        actorUserId: access.sessionUserId,
        action: "account.first_access_resend",
        targetType: "user",
        targetId: authUser.id,
        organizationId: store.organization_id,
        storeId: store.id,
        outcome: "success",
        operationId,
        membershipId: targetMembership.id,
        userId: authUser.id,
        serviceSupabase,
      });
    } catch (auditError) {
      console.error("[zion-admin][accounts][resend-first-access][audit-terminal-failed]", {
        operation_id: operationId,
        phase: "success",
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        storeId: store.id,
        emailMasked: deps.maskEmail(authUser.email),
        accessStatus: "first_access_pending",
        lastInviteSentAt: sentAt,
        cooldownRemainingMs: 60_000,
      },
      200,
    );
  } catch (error: unknown) {
    const diagnostics = getErrorDetails(error);

    console.error("[zion-admin/accounts/resend-first-access] error:", diagnostics);

    try {
      if (actorUserId && serviceSupabase && operationId) {
        await deps.writeAuditEvent({
          actorUserId,
          action: "account.first_access_resend",
          targetType: resolvedTargetUserId ? "user" : "store",
          targetId: resolvedTargetUserId || resolvedStore?.id || null,
          organizationId: resolvedStore?.organization_id || resolvedMembership?.organization_id || null,
          storeId: resolvedStore?.id || null,
          outcome: "failed",
          operationId,
          reasonCode: "resend_first_access_failed",
          membershipId: resolvedMembership?.id || null,
          userId: resolvedTargetUserId,
          serviceSupabase,
        });
      }
    } catch (auditError) {
      console.error("[zion-admin][accounts][resend-first-access][audit-terminal-failed]", {
        operation_id: operationId,
        phase: "failed",
        error: auditError instanceof Error ? auditError.message : String(auditError),
      });
    }

    return createZionAdminApiJsonResponse(
      {
        error:
          diagnostics.publicMessage || "Nao foi possivel reenviar o link de primeira senha.",
      },
      Number.isInteger(diagnostics.status) ? Number(diagnostics.status) : 500,
    );
  }
}
