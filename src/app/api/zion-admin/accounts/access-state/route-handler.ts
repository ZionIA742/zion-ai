import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import type { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import type { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

type ZionAdminAccessResult = Awaited<ReturnType<typeof resolveZionAdminApiAccess>>;

type MembershipRow = {
  id: string;
  user_id: string;
  organization_id: string;
  role: string | null;
  is_active: boolean | null;
};

type ProfileRow = {
  user_id: string;
  is_blocked: boolean | null;
};

type InternalAdminRow = {
  user_id: string | null;
};

type AccessStateAction = "block" | "reactivate";

export type AccessStateHandlerDeps = {
  resolveAccess: typeof resolveZionAdminApiAccess;
  createServiceSupabase: typeof createServiceSupabaseClient;
};

function normalizeAction(value: unknown): AccessStateAction | null {
  return value === "block" || value === "reactivate" ? value : null;
}

function normalizeRole(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function deriveAccessState(isProfileBlocked: boolean | null, isMembershipActive: boolean | null) {
  if (isProfileBlocked === false && isMembershipActive === true) {
    return "active" as const;
  }

  if (isProfileBlocked === null || isMembershipActive === null) {
    return "unavailable" as const;
  }

  return "blocked" as const;
}

async function updateMembershipActiveState(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  membershipId: string,
  isActive: boolean,
) {
  const { data, error } = await serviceSupabase
    .from("memberships")
    .update({
      is_active: isActive,
    })
    .eq("id", membershipId)
    .select("id, is_active")
    .maybeSingle<{ id: string; is_active: boolean | null }>();

  if (error) {
    throw error;
  }

  if (!data?.id) {
    throw new Error("Membership target not found during update.");
  }

  return data;
}

async function updateProfileBlockedState(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  userId: string,
  isBlocked: boolean,
) {
  const { data, error } = await serviceSupabase
    .from("profiles")
    .update({
      is_blocked: isBlocked,
    })
    .eq("user_id", userId)
    .select("user_id, is_blocked")
    .maybeSingle<{ user_id: string; is_blocked: boolean | null }>();

  if (error) {
    throw error;
  }

  if (!data?.user_id) {
    throw new Error("Profile target not found during update.");
  }

  return data;
}

export async function handleAccessStateMutation(
  request: Request,
  deps: AccessStateHandlerDeps,
): Promise<Response> {
  try {
    const access = (await deps.resolveAccess()) as ZionAdminAccessResult;

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    const body = await request.json().catch(() => null);
    const membershipId = String(body?.membershipId || "").trim();
    const action = normalizeAction(body?.action);

    if (!membershipId) {
      return createZionAdminApiJsonResponse(
        {
          error: "Membership ID obrigatorio.",
        },
        400,
      );
    }

    if (!action) {
      return createZionAdminApiJsonResponse(
        {
          error: "Acao invalida.",
        },
        400,
      );
    }

    const serviceSupabase = deps.createServiceSupabase();
    const { data: membership, error: membershipError } = await serviceSupabase
      .from("memberships")
      .select("id, user_id, organization_id, role, is_active")
      .eq("id", membershipId)
      .maybeSingle<MembershipRow>();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.id || !membership.user_id || !membership.organization_id) {
      return createZionAdminApiJsonResponse(
        {
          error: "Membership alvo nao encontrada.",
        },
        404,
      );
    }

    if (normalizeRole(membership.role) !== "owner") {
      return createZionAdminApiJsonResponse(
        {
          error: "Somente a conta owner da loja pode ser administrada nesta etapa.",
        },
        409,
      );
    }

    if (membership.user_id === access.sessionUserId) {
      return createZionAdminApiJsonResponse(
        {
          error: "A conta interna do ZION nao pode alterar o proprio acesso.",
        },
        409,
      );
    }

    const { data: internalAdminRow, error: internalAdminError } = await serviceSupabase
      .from("zion_internal_admins")
      .select("user_id")
      .eq("user_id", membership.user_id)
      .maybeSingle<InternalAdminRow>();

    if (internalAdminError) {
      throw internalAdminError;
    }

    if (internalAdminRow?.user_id) {
      return createZionAdminApiJsonResponse(
        {
          error: "A conta interna do ZION nao pode ser bloqueada ou reativada por esta rota.",
        },
        409,
      );
    }

    const { data: profile, error: profileError } = await serviceSupabase
      .from("profiles")
      .select("user_id, is_blocked")
      .eq("user_id", membership.user_id)
      .maybeSingle<ProfileRow>();

    if (profileError) {
      throw profileError;
    }

    if (!profile?.user_id) {
      return createZionAdminApiJsonResponse(
        {
          error: "Profile alvo nao encontrado.",
        },
        404,
      );
    }

    let nextProfileBlocked = profile.is_blocked;
    let nextMembershipActive = membership.is_active;

    if (action === "block") {
      const nextMembership = await updateMembershipActiveState(
        serviceSupabase,
        membership.id,
        false,
      );
      nextMembershipActive = nextMembership.is_active;

      const nextProfile = await updateProfileBlockedState(
        serviceSupabase,
        membership.user_id,
        true,
      );
      nextProfileBlocked = nextProfile.is_blocked;
    } else {
      const nextProfile = await updateProfileBlockedState(
        serviceSupabase,
        membership.user_id,
        false,
      );
      nextProfileBlocked = nextProfile.is_blocked;

      const nextMembership = await updateMembershipActiveState(
        serviceSupabase,
        membership.id,
        true,
      );
      nextMembershipActive = nextMembership.is_active;
    }

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        membershipId: membership.id,
        userId: membership.user_id,
        organizationId: membership.organization_id,
        action,
        accessState: deriveAccessState(nextProfileBlocked, nextMembershipActive),
        isProfileBlocked: nextProfileBlocked,
        isMembershipActive: nextMembershipActive,
      },
      200,
    );
  } catch (error) {
    console.error("[zion-admin][accounts][access-state] unexpected error", error);
    return createZionAdminApiJsonResponse(
      {
        error: "Falha interna ao atualizar o estado de acesso.",
      },
      500,
    );
  }
}
