import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import {
  createFirstAccessAttemptId,
  createFirstAccessInviteMetadataPatch,
  createServiceSupabaseClient,
  getFirstAccessInviteRedirectTo,
  mergeProvisioningAppMetadata,
  PROVISIONING_SOURCE,
  type ProvisioningStatus,
} from "@/lib/server/zion-account-provisioning";

type ExistingProfileRow = {
  user_id: string;
};

type ExistingMembershipRow = {
  id: string;
  organization_id: string;
  created_at: string | null;
};

type ExistingStoreRow = {
  id: string;
  organization_id: string;
};

type ExistingSubscriptionRow = {
  organization_id: string;
};

type ProvisioningRow = {
  provisioning_status: string;
  issue_code: string | null;
  issue_message: string | null;
  profile_user_id: string | null;
  organization_id: string | null;
  membership_id: string | null;
  store_id: string | null;
};

type AuthUserLike = {
  id: string;
  email?: string | null;
  invited_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

type ZionAdminAccessContext = {
  ok: true;
  sessionUserId: string;
};

type JsonResponseShape = {
  body: Record<string, unknown>;
  status: number;
};

type ProvisioningCleanupTarget = {
  profileUserId: string | null;
  organizationId: string | null;
  membershipId: string | null;
  storeId: string | null;
};

type CleanupAttemptParams = {
  userId: string;
  currentMetadata: Record<string, unknown> | null | undefined;
  removeAuthUser: boolean;
  markUserFailedOnCleanupFailure: boolean;
  restoreMetadata?: Record<string, unknown> | null | undefined;
  tenantTarget?: ProvisioningCleanupTarget | null;
};

type ExistingProvisioningState = {
  profileExists: boolean;
  membershipRows: ExistingMembershipRow[];
  organizationIds: string[];
  storeRows: ExistingStoreRow[];
  subscriptionRows: ExistingSubscriptionRow[];
};

type ExistingUserDecision =
  | {
      kind: "recover_failed";
    }
  | {
      kind: "repair_provisioned_metadata";
    }
  | {
      kind: "error";
      status: number;
      error: string;
      code:
        | "ACCOUNT_ALREADY_PROVISIONED"
        | "PENDING_INVITE_ALREADY_EXISTS"
        | "REQUIRES_MANUAL_REVIEW"
        | "AUTH_USER_ALREADY_EXISTS";
    };

const PILOT_ACCESS_CODE = "pilot_full_access";
const PARTIAL_REVIEW_CODE = "PROVISIONING_PARTIAL_REQUIRES_REVIEW";
const COMPENSATION_FAILED_CODE = "PROVISIONING_COMPENSATION_FAILED";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPendingInvite(user: AuthUserLike | null | undefined) {
  return Boolean(user?.invited_at && !user?.email_confirmed_at);
}

function isFailedZionAdminUser(user: AuthUserLike | null | undefined) {
  return (
    user?.app_metadata?.provisioned_via === PROVISIONING_SOURCE &&
    (user?.app_metadata?.zion_provisioning_status === "failed" ||
      user?.app_metadata?.zion_provisioning_status === "pending")
  );
}

function isProvisionedZionAdminUser(user: AuthUserLike | null | undefined) {
  return (
    user?.app_metadata?.provisioned_via === PROVISIONING_SOURCE &&
    (user?.app_metadata?.zion_provisioning_status === "pending" ||
      user?.app_metadata?.zion_provisioning_status === "failed")
  );
}

async function findAuthUserByEmail(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  email: string,
) {
  const perPage = 200;
  let page = 1;

  for (;;) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email) === email);

    if (match) {
      return match as AuthUserLike;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }
}

async function loadExistingProvisioningState(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
): Promise<ExistingProvisioningState> {
  const { data: profile, error: profileError } = await serviceSupabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle<ExistingProfileRow>();

  if (profileError) {
    throw profileError;
  }

  const { data: memberships, error: membershipError } = await serviceSupabase
    .from("memberships")
    .select("id, organization_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw membershipError;
  }

  const membershipRows = (memberships ?? []) as ExistingMembershipRow[];
  const organizationIds = Array.from(
    new Set(membershipRows.map((membership) => membership.organization_id).filter(Boolean)),
  );

  let storeRows: ExistingStoreRow[] = [];
  let subscriptionRows: ExistingSubscriptionRow[] = [];

  if (organizationIds.length > 0) {
    const { data: stores, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id")
      .in("organization_id", organizationIds);

    if (storeError) {
      throw storeError;
    }

    storeRows = (stores ?? []) as ExistingStoreRow[];

    const { data: subscriptions, error: subscriptionError } = await serviceSupabase
      .from("subscriptions")
      .select("organization_id")
      .in("organization_id", organizationIds);

    if (subscriptionError) {
      throw subscriptionError;
    }

    subscriptionRows = (subscriptions ?? []) as ExistingSubscriptionRow[];
  }

  return {
    profileExists: Boolean(profile),
    membershipRows,
    organizationIds,
    storeRows,
    subscriptionRows,
  };
}

function classifyExistingUser(
  user: AuthUserLike,
  state: ExistingProvisioningState,
): ExistingUserDecision {
  const membershipCount = state.membershipRows.length;
  const organizationCount = state.organizationIds.length;
  const storeCount = state.storeRows.length;
  const subscriptionCount = state.subscriptionRows.length;

  const hasValidProvisionedShape =
    state.profileExists &&
    membershipCount === 1 &&
    organizationCount === 1 &&
    storeCount === 1 &&
    subscriptionCount === 1;
  const hasEmptyTenantShape =
    membershipCount === 0 &&
    organizationCount === 0 &&
    storeCount === 0 &&
    subscriptionCount === 0;

  if (hasValidProvisionedShape) {
    if (isProvisionedZionAdminUser(user)) {
      return {
        kind: "repair_provisioned_metadata",
      };
    }

    if (isPendingInvite(user)) {
      return {
        kind: "error",
        status: 409,
        code: "PENDING_INVITE_ALREADY_EXISTS",
        error: "Ja existe um convite pendente para este e-mail.",
      };
    }

    return {
      kind: "error",
      status: 409,
      code: "ACCOUNT_ALREADY_PROVISIONED",
      error: "Ja existe uma conta provisionada para este e-mail.",
    };
  }

  if (isFailedZionAdminUser(user) && !user.email_confirmed_at && hasEmptyTenantShape) {
    return {
      kind: "recover_failed",
    };
  }

  if (
    membershipCount > 1 ||
    organizationCount > 1 ||
    storeCount > 1 ||
    subscriptionCount > 1
  ) {
    return {
      kind: "error",
      status: 409,
      code: "REQUIRES_MANUAL_REVIEW",
      error:
        "Este e-mail ja esta ligado a uma estrutura conflitante e exige revisao administrativa antes de novo convite.",
    };
  }

  if (isPendingInvite(user)) {
    return {
      kind: "error",
      status: 409,
      code: "PENDING_INVITE_ALREADY_EXISTS",
      error:
        "Ja existe um convite pendente com provisionamento incompleto. O time interno precisa revisar antes de reenviar.",
    };
  }

  if (
    state.profileExists ||
    membershipCount > 0 ||
    storeCount > 0 ||
    subscriptionCount > 0
  ) {
    return {
      kind: "error",
      status: 409,
      code: "REQUIRES_MANUAL_REVIEW",
      error:
        "Ja existe um estado parcial inconsistente para este e-mail. Revise a conta antes de tentar novo provisionamento.",
    };
  }

  return {
    kind: "error",
    status: 409,
    code: "AUTH_USER_ALREADY_EXISTS",
    error: "Ja existe um usuario com este e-mail.",
  };
}

function getProvisioningFailure(
  provisioningRow: ProvisioningRow | null,
  fallbackMessage: string,
) {
  const issueCode = provisioningRow?.issue_code ?? null;
  const issueMessage = provisioningRow?.issue_message ?? null;

  if (
    issueCode === "user_linked_to_multiple_organizations" ||
    issueCode === "membership_resolution_failed" ||
    issueCode === "organization_missing" ||
    issueCode === "multiple_stores_already_exist" ||
    issueCode === "multiple_subscriptions_found" ||
    issueCode === "subscription_missing_for_existing_store"
  ) {
    return {
      status: 409,
      error:
        "Foi detectado um estado parcial inconsistente e o provisionamento automatico foi interrompido.",
      internalMessage: issueMessage,
    };
  }

  return {
    status: 500,
    error: fallbackMessage,
    internalMessage: issueMessage,
  };
}

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

async function runProvisioningRpc(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  params: {
    userId: string;
    responsibleName: string;
    storeName: string;
  },
) {
  const { data: provisioningRow, error: provisioningError } = await serviceSupabase
    .rpc("zion_admin_provision_account", {
      p_user_id: params.userId,
      p_responsible_name: params.responsibleName,
      p_store_name: params.storeName,
    })
    .single<ProvisioningRow>();

  if (provisioningError || !provisioningRow) {
    throw provisioningError || new Error("Provisioning RPC returned no result.");
  }

  if (provisioningRow.provisioning_status !== "provisioned") {
    const failure = getProvisioningFailure(
      provisioningRow,
      "Falha no provisionamento estrutural da conta.",
    );

    throw Object.assign(new Error(failure.internalMessage || failure.error), {
      publicMessage: failure.error,
      status: failure.status,
    });
  }

  return provisioningRow;
}

async function updateProvisioningMetadata(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  currentMetadata: Record<string, unknown> | null | undefined,
  status: ProvisioningStatus,
  patch?: Record<string, unknown>,
) {
  const nextPatch: Record<string, unknown> = {
    provisioned_via: PROVISIONING_SOURCE,
    zion_provisioning_status: status,
    zion_first_access_required: true,
    ...(patch ?? {}),
  };
  const nextMetadata = mergeProvisioningAppMetadata(currentMetadata, nextPatch);

  const { error } = await serviceSupabase.auth.admin.updateUserById(userId, {
    app_metadata: nextMetadata,
  });

  if (error) {
    throw error;
  }
}

function hasProvisioningTarget(
  target: ProvisioningCleanupTarget | null | undefined,
): target is {
  profileUserId: string;
  organizationId: string;
  membershipId: string;
  storeId: string;
} {
  return Boolean(
    target?.profileUserId &&
      target.organizationId &&
      target.membershipId &&
      target.storeId,
  );
}

async function deleteProvisioningTenantResources(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  target: {
    profileUserId: string;
    organizationId: string;
    membershipId: string;
    storeId: string;
  },
) {
  const { error: onboardingError } = await serviceSupabase
    .from("store_onboarding")
    .delete()
    .eq("organization_id", target.organizationId)
    .eq("store_id", target.storeId);

  if (onboardingError) {
    throw onboardingError;
  }

  const { error: subscriptionError } = await serviceSupabase
    .from("subscriptions")
    .delete()
    .eq("organization_id", target.organizationId);

  if (subscriptionError) {
    throw subscriptionError;
  }

  const { error: storeError } = await serviceSupabase
    .from("stores")
    .delete()
    .eq("id", target.storeId)
    .eq("organization_id", target.organizationId);

  if (storeError) {
    throw storeError;
  }

  const { error: membershipError } = await serviceSupabase
    .from("memberships")
    .delete()
    .eq("id", target.membershipId)
    .eq("organization_id", target.organizationId)
    .eq("user_id", target.profileUserId);

  if (membershipError) {
    throw membershipError;
  }

  const { error: profileError } = await serviceSupabase
    .from("profiles")
    .delete()
    .eq("user_id", target.profileUserId);

  if (profileError) {
    throw profileError;
  }

  const { error: organizationError } = await serviceSupabase
    .from("organizations")
    .delete()
    .eq("id", target.organizationId);

  if (organizationError) {
    throw organizationError;
  }
}

async function markUserAsFailedSafely(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  currentMetadata: Record<string, unknown> | null | undefined,
) {
  try {
    await updateProvisioningMetadata(serviceSupabase, userId, currentMetadata, "failed");
    return true;
  } catch (metadataError) {
    const diagnostics = getErrorDetails(metadataError);

    console.error("[zion-admin/accounts/create] failed to mark partial provisioning:", {
      ...diagnostics,
    });

    return false;
  }
}

async function restoreUserMetadataSafely(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  const { error } = await serviceSupabase.auth.admin.updateUserById(userId, {
    app_metadata: metadata ? { ...metadata } : {},
  });

  if (error) {
    throw error;
  }
}

async function cleanupFailedProvisioningAttempt(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  params: CleanupAttemptParams,
) {
  const cleanupTarget = hasProvisioningTarget(params.tenantTarget)
    ? params.tenantTarget
    : null;
  let metadataRestored = params.restoreMetadata ? false : true;
  let tenantDeleted = cleanupTarget === null;
  let authUserDeleted = false;

  if (params.restoreMetadata) {
    try {
      await restoreUserMetadataSafely(
        serviceSupabase,
        params.userId,
        params.restoreMetadata,
      );
      metadataRestored = true;
    } catch (error) {
      const diagnostics = getErrorDetails(error);

      console.error("[zion-admin/accounts/create] failed to restore original metadata:", {
        message: diagnostics.message,
        code: diagnostics.code,
        status: diagnostics.status,
      });

      return {
        cleaned: false,
        metadataRestored: false,
        tenantDeleted: false,
        authUserDeleted: false,
      };
    }
  }

  if (cleanupTarget) {
    try {
      await deleteProvisioningTenantResources(serviceSupabase, cleanupTarget);
      tenantDeleted = true;
    } catch (error) {
      const diagnostics = getErrorDetails(error);

      console.error("[zion-admin/accounts/create] tenant compensation failed:", {
        message: diagnostics.message,
        code: diagnostics.code,
        status: diagnostics.status,
      });

      if (params.markUserFailedOnCleanupFailure) {
        await markUserAsFailedSafely(serviceSupabase, params.userId, params.currentMetadata);
      }

      return {
        cleaned: false,
        metadataRestored,
        tenantDeleted,
        authUserDeleted: false,
      };
    }
  }

  if (params.removeAuthUser) {
    try {
      const deleteResult = await serviceSupabase.auth.admin.deleteUser(params.userId);

      if (deleteResult.error) {
        const diagnostics = getErrorDetails(deleteResult.error);

        console.error("[zion-admin/accounts/create] cleanup deleteUser error:", {
          message: diagnostics.message,
          code: diagnostics.code,
          status: diagnostics.status,
        });

        if (params.markUserFailedOnCleanupFailure) {
          await markUserAsFailedSafely(serviceSupabase, params.userId, params.currentMetadata);
        }

        return {
          cleaned: false,
          metadataRestored,
          tenantDeleted,
          authUserDeleted: false,
        };
      }

      authUserDeleted = true;
    } catch (error) {
      const diagnostics = getErrorDetails(error);

      console.error("[zion-admin/accounts/create] cleanup deleteUser threw:", {
        message: diagnostics.message,
        code: diagnostics.code,
        status: diagnostics.status,
      });

      if (params.markUserFailedOnCleanupFailure) {
        await markUserAsFailedSafely(serviceSupabase, params.userId, params.currentMetadata);
      }

      return {
        cleaned: false,
        metadataRestored,
        tenantDeleted,
        authUserDeleted: false,
      };
    }
  } else if (params.markUserFailedOnCleanupFailure && !params.restoreMetadata) {
    const failedMarked = await markUserAsFailedSafely(
      serviceSupabase,
      params.userId,
      params.currentMetadata,
    );

    if (!failedMarked) {
      return {
        cleaned: false,
        metadataRestored,
        tenantDeleted,
        authUserDeleted: false,
      };
    }
  }

  return {
    cleaned: true,
    metadataRestored,
    tenantDeleted,
    authUserDeleted,
  };
}

async function createZionAdminAccountCore(params: {
  access: ZionAdminAccessContext;
  body: unknown;
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
}) {
  let invitedUserId: string | null = null;
  let invitedUserAppMetadata: Record<string, unknown> | null | undefined = null;
  let effectiveProcessedUserId: string | null = null;
  let shouldDeleteAuthUserOnCleanup = false;
  let cleanupTarget: ProvisioningCleanupTarget | null = null;
  let originalExistingUserMetadata: Record<string, unknown> | null | undefined = null;

  try {
    const email = normalizeEmail((params.body as { email?: unknown } | null)?.email);
    const storeName = normalizeText((params.body as { storeName?: unknown } | null)?.storeName);
    const responsibleName = normalizeText(
      (params.body as { responsibleName?: unknown } | null)?.responsibleName,
    );

    if (!email) {
      return {
        body: { error: "E-mail e obrigatorio." },
        status: 400,
      } satisfies JsonResponseShape;
    }

    if (!isValidEmail(email)) {
      return {
        body: { error: "E-mail invalido." },
        status: 400,
      } satisfies JsonResponseShape;
    }

    if (!storeName) {
      return {
        body: { error: "Nome da loja e obrigatorio." },
        status: 400,
      } satisfies JsonResponseShape;
    }

    if (!responsibleName) {
      return {
        body: { error: "Nome do responsavel e obrigatorio." },
        status: 400,
      } satisfies JsonResponseShape;
    }

    const serviceSupabase = params.serviceSupabase;

    const existingUser = await findAuthUserByEmail(serviceSupabase, email);

    if (existingUser) {
      const existingState = await loadExistingProvisioningState(
        serviceSupabase,
        existingUser.id,
      );
      const decision = classifyExistingUser(existingUser, existingState);

      if (decision.kind === "repair_provisioned_metadata") {
        effectiveProcessedUserId = existingUser.id;

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          existingUser.app_metadata,
          "provisioned",
        );

        return {
          body: {
            ok: true,
            invited: false,
            recovered: true,
            userId: existingUser.id,
            membershipRole: "owner",
            accessMode: PILOT_ACCESS_CODE,
            nextStep: "metadata_repaired",
            message:
              "A estrutura da conta ja existia e os metadados administrativos de primeiro acesso foram corrigidos.",
          },
          status: 200,
        } satisfies JsonResponseShape;
      }

      if (decision.kind === "recover_failed") {
        effectiveProcessedUserId = existingUser.id;
        originalExistingUserMetadata =
          (existingUser.app_metadata as Record<string, unknown> | null | undefined) ?? null;

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          originalExistingUserMetadata,
          "pending",
        );

        const provisioningRow = await runProvisioningRpc(serviceSupabase, {
          userId: existingUser.id,
          responsibleName,
          storeName,
        });

        cleanupTarget = {
          profileUserId: provisioningRow.profile_user_id,
          organizationId: provisioningRow.organization_id,
          membershipId: provisioningRow.membership_id,
          storeId: provisioningRow.store_id,
        };

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          originalExistingUserMetadata,
          "provisioned",
        );

        return {
          body: {
            ok: true,
            invited: false,
            recovered: true,
            userId: existingUser.id,
            organizationId: provisioningRow.organization_id,
            storeId: provisioningRow.store_id,
            membershipRole: "owner",
            provisioningStatus: provisioningRow.provisioning_status,
            accessMode: PILOT_ACCESS_CODE,
            nextStep: "provisioning_recovered",
            message:
              "O provisionamento da conta foi recuperado. Se o convite original tiver expirado, o reenvio deve ser feito em um fluxo administrativo separado.",
          },
          status: 200,
        } satisfies JsonResponseShape;
      }

      return {
        body: {
          error: decision.error,
          code: decision.code,
        },
        status: decision.status,
      } satisfies JsonResponseShape;
    }

    const firstAccessAttemptId = createFirstAccessAttemptId();
    const inviteSentAt = new Date().toISOString();
    const inviteRedirectTo = getFirstAccessInviteRedirectTo(firstAccessAttemptId);
    const inviteMetadataPatch = createFirstAccessInviteMetadataPatch({
      attemptId: firstAccessAttemptId,
      sentAt: inviteSentAt,
      sentBy: params.access.sessionUserId,
      status: "pending",
    });
    const { data: invitedUserResponse, error: inviteError } =
      await serviceSupabase.auth.admin.inviteUserByEmail(email, {
        data: {
          responsible_name: responsibleName,
          store_name: storeName,
        },
        redirectTo: inviteRedirectTo,
      });

    if (inviteError || !invitedUserResponse.user?.id) {
      const inviteDiagnostics = getErrorDetails(inviteError);

      console.error("[zion-admin/accounts/create] invite error:", {
        message: inviteDiagnostics.message,
        code: inviteDiagnostics.code,
        status: inviteDiagnostics.status,
      });

      return {
        body: { error: "Falha ao enviar o convite da nova conta." },
        status: 500,
      } satisfies JsonResponseShape;
    }

    invitedUserId = invitedUserResponse.user.id;
    effectiveProcessedUserId = invitedUserId;
    shouldDeleteAuthUserOnCleanup = true;
    invitedUserAppMetadata =
      (invitedUserResponse.user.app_metadata as Record<string, unknown> | null | undefined) ??
      null;

    await updateProvisioningMetadata(
      serviceSupabase,
      invitedUserId,
      invitedUserAppMetadata,
      "pending",
      inviteMetadataPatch,
    );

    const provisioningRow = await runProvisioningRpc(serviceSupabase, {
      userId: invitedUserId,
      responsibleName,
      storeName,
    });

    cleanupTarget = {
      profileUserId: provisioningRow.profile_user_id,
      organizationId: provisioningRow.organization_id,
      membershipId: provisioningRow.membership_id,
      storeId: provisioningRow.store_id,
    };

    await updateProvisioningMetadata(
      serviceSupabase,
      invitedUserId,
      invitedUserAppMetadata,
      "provisioned",
      createFirstAccessInviteMetadataPatch({
        attemptId: firstAccessAttemptId,
        sentAt: inviteSentAt,
        sentBy: params.access.sessionUserId,
        status: "provisioned",
      }),
    );

    return {
      body: {
        ok: true,
        invited: true,
        userId: invitedUserId,
        organizationId: provisioningRow.organization_id,
        storeId: provisioningRow.store_id,
        membershipRole: "owner",
        provisioningStatus: provisioningRow.provisioning_status,
        accessMode: PILOT_ACCESS_CODE,
        nextStep: "invite_sent",
        message:
          "Convite enviado. O cliente criara a propria senha e o primeiro acesso seguira para o onboarding.",
      },
      status: 200,
    } satisfies JsonResponseShape;
  } catch (error: unknown) {
    const diagnostics = getErrorDetails(error);

    if (effectiveProcessedUserId) {
      try {
        const cleanup = await cleanupFailedProvisioningAttempt(params.serviceSupabase, {
          userId: effectiveProcessedUserId,
          currentMetadata: invitedUserAppMetadata,
          removeAuthUser: shouldDeleteAuthUserOnCleanup,
          markUserFailedOnCleanupFailure: true,
          restoreMetadata: shouldDeleteAuthUserOnCleanup
            ? null
            : originalExistingUserMetadata,
          tenantTarget: cleanupTarget,
        });

        if (!cleanup.cleaned) {
          console.error("[zion-admin/accounts/create] partial provisioning requires review:", {
            message: diagnostics.message,
            code: diagnostics.code,
            status: diagnostics.status,
          });

          return {
            body: {
              error:
              "Falha administrativa: o provisionamento ficou parcial e exige revisao interna antes de qualquer nova tentativa.",
              code: hasProvisioningTarget(cleanupTarget)
                ? COMPENSATION_FAILED_CODE
                : PARTIAL_REVIEW_CODE,
            },
            status: hasProvisioningTarget(cleanupTarget) ? 503 : 409,
          } satisfies JsonResponseShape;
        }
      } catch (cleanupError) {
        const cleanupDiagnostics = getErrorDetails(cleanupError);

        console.error("[zion-admin/accounts/create] cleanup threw and requires review:", {
          message: cleanupDiagnostics.message,
          code: cleanupDiagnostics.code,
          status: cleanupDiagnostics.status,
        });

        return {
          body: {
            error:
              "Falha administrativa: o provisionamento ficou parcial e exige revisao interna antes de qualquer nova tentativa.",
            code: hasProvisioningTarget(cleanupTarget)
              ? COMPENSATION_FAILED_CODE
              : PARTIAL_REVIEW_CODE,
          },
          status: hasProvisioningTarget(cleanupTarget) ? 503 : 409,
        } satisfies JsonResponseShape;
      }
    }

    console.error("[zion-admin/accounts/create] error:", {
      message: diagnostics.message,
      code: diagnostics.code,
      status: diagnostics.status,
    });

    const status = Number.isInteger(diagnostics.status)
      ? Number(diagnostics.status)
      : 500;
    const publicMessage =
      diagnostics.publicMessage ||
      "Falha tecnica interna ao criar e provisionar a conta.";

    return {
      body: {
        error: publicMessage,
      },
      status,
    } satisfies JsonResponseShape;
  }
}

const testHooks = {
  createZionAdminAccountCore,
  cleanupFailedProvisioningAttempt,
};

Object.assign(globalThis as Record<string, unknown>, {
  __zionAdminAccountsCreateRouteTestHooks: testHooks,
});

export async function POST(request: Request) {
  const access = await resolveZionAdminApiAccess();

  if (!access.ok) {
    return createZionAdminApiDeniedResponse(access);
  }

  const body = await request.json().catch(() => null);
  const result = await createZionAdminAccountCore({
    access,
    body,
    serviceSupabase: createServiceSupabaseClient(),
  });

  return createZionAdminApiJsonResponse(result.body, result.status);
}
