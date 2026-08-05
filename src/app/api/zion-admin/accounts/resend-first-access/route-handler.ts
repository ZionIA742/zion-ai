import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import type { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
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
};

function getErrorDetails(error: unknown) {
  const value = error as {
    message?: string | null;
    code?: string | null;
    status?: number | null;
  } | null;

  return {
    message: value?.message ?? null,
    code: value?.code ?? null,
    status: value?.status ?? null,
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
  try {
    const access = (await deps.resolveAccess()) as ZionAdminAccessResult;

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

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

    const serviceSupabase = deps.createServiceSupabase();
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    if (!store?.id || !store.organization_id) {
      return createZionAdminApiJsonResponse(
        {
          error: "Loja nao encontrada.",
        },
        404,
      );
    }

    const { data: memberships, error: membershipsError } = await serviceSupabase
      .from("memberships")
      .select("user_id, organization_id, role, created_at")
      .eq("organization_id", store.organization_id)
      .order("created_at", { ascending: true });

    if (membershipsError) {
      throw membershipsError;
    }

    const ownerMemberships = ((memberships ?? []) as MembershipRow[]).filter(
      (row) => normalizeRole(row.role) === "owner",
    );

    if (ownerMemberships.length !== 1) {
      return createZionAdminApiJsonResponse(
        {
          error: "A loja possui alvo de primeiro acesso inexistente ou ambiguo.",
        },
        409,
      );
    }

    const targetMembership = ownerMemberships[0];
    const { data: internalAdminRow, error: internalAdminError } = await serviceSupabase
      .from("zion_internal_admins")
      .select("user_id")
      .eq("user_id", targetMembership.user_id)
      .maybeSingle<{ user_id: string | null }>();

    if (internalAdminError) {
      throw internalAdminError;
    }

    if (internalAdminRow?.user_id) {
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
      return createZionAdminApiJsonResponse(
        {
          error: "A conta da loja esta bloqueada e nao pode receber reenvio comum.",
        },
        409,
      );
    }

    if (deps.isInviteCooldownActive(authUser.app_metadata)) {
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
        return createZionAdminApiJsonResponse(
          {
            error:
              "A metadata administrativa do primeiro acesso exige revisao manual antes de novo envio.",
          },
          409,
        );
      }

      if (restoreState.replacedByNewerAttempt) {
        return createZionAdminApiJsonResponse(
          {
            error:
              "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
          },
          409,
        );
      }

      throw deliveryError;
    }

    const latestAuthUser = await deps.getAuthAdminUserByIdWithRetry(
      serviceSupabase,
      authUser.id,
    );

    if (deps.readFirstAccessInviteId(latestAuthUser.app_metadata) !== nextAttemptId) {
      return createZionAdminApiJsonResponse(
        {
          error:
            "Outro reenvio mais recente substituiu esta tentativa. Use apenas o ultimo link enviado.",
        },
        409,
      );
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
    console.error("[zion-admin/accounts/resend-first-access] error:", getErrorDetails(error));

    return createZionAdminApiJsonResponse(
      {
        error: "Nao foi possivel reenviar o link de primeira senha.",
      },
      500,
    );
  }
}
