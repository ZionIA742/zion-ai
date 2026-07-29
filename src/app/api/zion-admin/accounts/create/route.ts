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
const METADATA_REVIEW_CODE = "PROVISIONING_METADATA_REQUIRES_REVIEW";

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

async function deleteUserOrMarkFailed(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  currentMetadata: Record<string, unknown> | null | undefined,
) {
  let deleteError:
    | {
        message?: string | null;
        code?: string | null;
        status?: number | null;
      }
    | null = null;

  try {
    const deleteResult = await serviceSupabase.auth.admin.deleteUser(userId);
    deleteError = deleteResult.error;
  } catch (error) {
    const diagnostics = getErrorDetails(error);

    console.error("[zion-admin/accounts/create] cleanup deleteUser threw:", {
      userId,
      message: diagnostics.message,
      code: diagnostics.code,
      status: diagnostics.status,
    });

    deleteError = {
      message: diagnostics.message,
      code: diagnostics.code,
      status: diagnostics.status,
    };
  }

  if (!deleteError) {
    return {
      deleted: true,
    };
  }

  console.error("[zion-admin/accounts/create] cleanup deleteUser error:", {
    userId,
    message: deleteError.message,
    code: deleteError.code ?? null,
    status: deleteError.status ?? null,
  });

  try {
    await updateProvisioningMetadata(serviceSupabase, userId, currentMetadata, "failed");
  } catch (metadataError) {
    const diagnostics = getErrorDetails(metadataError);

    console.error("[zion-admin/accounts/create] failed to mark partial provisioning:", {
      userId,
      ...diagnostics,
    });
  }

  return {
    deleted: false,
  };
}

export async function POST(request: Request) {
  let invitedUserId: string | null = null;
  let invitedUserAppMetadata: Record<string, unknown> | null | undefined = null;
  let effectiveProcessedUserId: string | null = null;
  let provisioningSucceeded = false;
  let metadataReviewRequired = false;

  try {
    const access = await resolveZionAdminApiAccess();

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    const body = await request.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const storeName = normalizeText(body?.storeName);
    const responsibleName = normalizeText(body?.responsibleName);

    if (!email) {
      return createZionAdminApiJsonResponse(
        { error: "E-mail e obrigatorio." },
        400,
      );
    }

    if (!isValidEmail(email)) {
      return createZionAdminApiJsonResponse({ error: "E-mail invalido." }, 400);
    }

    if (!storeName) {
      return createZionAdminApiJsonResponse(
        { error: "Nome da loja e obrigatorio." },
        400,
      );
    }

    if (!responsibleName) {
      return createZionAdminApiJsonResponse(
        { error: "Nome do responsavel e obrigatorio." },
        400,
      );
    }

    const serviceSupabase = createServiceSupabaseClient();

    const existingUser = await findAuthUserByEmail(serviceSupabase, email);

    if (existingUser) {
      const existingState = await loadExistingProvisioningState(
        serviceSupabase,
        existingUser.id,
      );
      const decision = classifyExistingUser(existingUser, existingState);

      if (decision.kind === "repair_provisioned_metadata") {
        effectiveProcessedUserId = existingUser.id;
        metadataReviewRequired = true;

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          existingUser.app_metadata,
          "provisioned",
        );

        return createZionAdminApiJsonResponse(
          {
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
          200,
        );
      }

      if (decision.kind === "recover_failed") {
        effectiveProcessedUserId = existingUser.id;

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          existingUser.app_metadata,
          "pending",
        );

        const provisioningRow = await runProvisioningRpc(serviceSupabase, {
          userId: existingUser.id,
          responsibleName,
          storeName,
        });

        provisioningSucceeded = true;
        metadataReviewRequired = true;

        await updateProvisioningMetadata(
          serviceSupabase,
          existingUser.id,
          existingUser.app_metadata,
          "provisioned",
        );

        return createZionAdminApiJsonResponse(
          {
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
          200,
        );
      }

      return createZionAdminApiJsonResponse(
        {
          error: decision.error,
          code: decision.code,
        },
        decision.status,
      );
    }

    const firstAccessAttemptId = createFirstAccessAttemptId();
    const inviteSentAt = new Date().toISOString();
    const inviteRedirectTo = getFirstAccessInviteRedirectTo(firstAccessAttemptId);
    const inviteMetadataPatch = createFirstAccessInviteMetadataPatch({
      attemptId: firstAccessAttemptId,
      sentAt: inviteSentAt,
      sentBy: access.sessionUserId,
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

      return createZionAdminApiJsonResponse(
        { error: "Falha ao enviar o convite da nova conta." },
        500,
      );
    }

    invitedUserId = invitedUserResponse.user.id;
    effectiveProcessedUserId = invitedUserId;
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

    provisioningSucceeded = true;
    metadataReviewRequired = true;

    await updateProvisioningMetadata(
      serviceSupabase,
      invitedUserId,
      invitedUserAppMetadata,
      "provisioned",
      createFirstAccessInviteMetadataPatch({
        attemptId: firstAccessAttemptId,
        sentAt: inviteSentAt,
        sentBy: access.sessionUserId,
        status: "provisioned",
      }),
    );

    return createZionAdminApiJsonResponse(
      {
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
      200,
    );
  } catch (error: unknown) {
    const diagnostics = getErrorDetails(error);

    if (metadataReviewRequired && provisioningSucceeded && effectiveProcessedUserId) {
      console.error("[zion-admin/accounts/create] metadata requires review after tenant provisioning:", {
        userId: effectiveProcessedUserId,
        message: diagnostics.message,
        code: diagnostics.code,
        status: diagnostics.status,
      });

      return createZionAdminApiJsonResponse(
        {
          error:
            "O tenant foi criado, mas a marcacao administrativa final do primeiro acesso falhou e exige revisao interna.",
          code: METADATA_REVIEW_CODE,
        },
        409,
      );
    }

    if (invitedUserId) {
      try {
        const serviceSupabase = createServiceSupabaseClient();
        const cleanup = await deleteUserOrMarkFailed(
          serviceSupabase,
          invitedUserId,
          invitedUserAppMetadata,
        );

        if (!cleanup.deleted) {
          console.error("[zion-admin/accounts/create] partial provisioning requires review:", {
            invitedUserId,
            message: diagnostics.message,
            code: diagnostics.code,
            status: diagnostics.status,
          });

          return createZionAdminApiJsonResponse(
            {
              error:
                "Falha administrativa: o provisionamento ficou parcial e exige revisao interna antes de qualquer nova tentativa.",
              code: PARTIAL_REVIEW_CODE,
            },
            409,
          );
        }
      } catch (cleanupError) {
        const cleanupDiagnostics = getErrorDetails(cleanupError);

        console.error("[zion-admin/accounts/create] cleanup threw and requires review:", {
          invitedUserId,
          message: cleanupDiagnostics.message,
          code: cleanupDiagnostics.code,
          status: cleanupDiagnostics.status,
        });

        return createZionAdminApiJsonResponse(
          {
            error:
              "Falha administrativa: o provisionamento ficou parcial e exige revisao interna antes de qualquer nova tentativa.",
            code: PARTIAL_REVIEW_CODE,
          },
          409,
        );
      }
    }

    console.error("[zion-admin/accounts/create] error:", {
      effectiveProcessedUserId,
      invitedUserId,
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

    return createZionAdminApiJsonResponse(
      {
        error: publicMessage,
      },
      status,
    );
  }
}
