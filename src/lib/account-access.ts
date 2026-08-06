export type MembershipScope = {
  organization_id: string;
  created_at?: string | null;
};

export type StoreScope = {
  id: string;
  organization_id: string;
  created_at?: string | null;
};

export type AccessResolutionStatus =
  | "ready"
  | "onboarding_required"
  | "missing_profile"
  | "missing_membership"
  | "missing_store"
  | "ambiguous_membership"
  | "provisioning_incomplete"
  | "access_blocked"
  | "first_access_required"
  | "provisioning_pending"
  | "provisioning_failed"
  | "invalid_account";

export type AccessSelectionResult =
  | {
      ok: true;
      organizationId: string;
      stores: StoreScope[];
      primaryStoreId: string;
      membershipCount: number;
      candidateOrganizationCount: number;
    }
  | {
      ok: false;
      status:
        | "missing_membership"
        | "missing_store"
        | "ambiguous_membership"
        | "provisioning_incomplete";
      message: string;
      membershipCount: number;
      candidateOrganizationCount: number;
    };

function byCreatedAtAsc<T extends { created_at?: string | null }>(left: T, right: T) {
  const leftValue = Date.parse(left.created_at ?? "");
  const rightValue = Date.parse(right.created_at ?? "");

  if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) return 0;
  if (Number.isNaN(leftValue)) return 1;
  if (Number.isNaN(rightValue)) return -1;
  return leftValue - rightValue;
}

export function resolveAccessSelection(
  memberships: MembershipScope[],
  stores: StoreScope[],
): AccessSelectionResult {
  const normalizedMemberships = memberships
    .filter((membership) => Boolean(membership.organization_id))
    .sort(byCreatedAtAsc);

  if (normalizedMemberships.length === 0) {
    return {
      ok: false,
      status: "missing_membership",
      message: "Nenhuma organizacao autorizada foi encontrada para esta conta.",
      membershipCount: 0,
      candidateOrganizationCount: 0,
    };
  }

  const storesByOrganization = new Map<string, StoreScope[]>();

  for (const store of stores.filter((item) => Boolean(item.organization_id) && Boolean(item.id))) {
    const bucket = storesByOrganization.get(store.organization_id) ?? [];
    bucket.push(store);
    storesByOrganization.set(store.organization_id, bucket.sort(byCreatedAtAsc));
  }

  const candidateMemberships = normalizedMemberships.filter((membership) => {
    return (storesByOrganization.get(membership.organization_id)?.length ?? 0) > 0;
  });

  const uniqueCandidateOrganizationIds = Array.from(
    new Set(candidateMemberships.map((membership) => membership.organization_id)),
  );

  if (uniqueCandidateOrganizationIds.length === 1) {
    const organizationId = uniqueCandidateOrganizationIds[0];
    const organizationStores = storesByOrganization.get(organizationId) ?? [];

    if (organizationStores.length === 0) {
      return {
        ok: false,
        status: "missing_store",
        message: "A conta tem organizacao liberada, mas ainda nao possui loja vinculada.",
        membershipCount: normalizedMemberships.length,
        candidateOrganizationCount: 0,
      };
    }

    return {
      ok: true,
      organizationId,
      stores: organizationStores,
      primaryStoreId: organizationStores[0].id,
      membershipCount: normalizedMemberships.length,
      candidateOrganizationCount: 1,
    };
  }

  if (uniqueCandidateOrganizationIds.length > 1) {
    return {
      ok: false,
      status: "ambiguous_membership",
      message:
        "A conta possui mais de uma organizacao com acesso valido. O time interno precisa definir qual contexto deve ser usado.",
      membershipCount: normalizedMemberships.length,
      candidateOrganizationCount: uniqueCandidateOrganizationIds.length,
    };
  }

  if (normalizedMemberships.length === 1) {
    return {
      ok: false,
      status: "missing_store",
      message: "A conta foi vinculada, mas a loja inicial ainda nao foi concluida.",
      membershipCount: 1,
      candidateOrganizationCount: 0,
    };
  }

  return {
    ok: false,
    status: "provisioning_incomplete",
    message:
      "A conta possui multiplos vinculos, mas nenhum deles pode ser usado com seguranca porque nao ha uma loja valida associada.",
    membershipCount: normalizedMemberships.length,
    candidateOrganizationCount: 0,
  };
}
