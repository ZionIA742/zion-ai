import {
  resolveAccessState,
  type AccessResolution,
  type AccessResolutionFailure,
  type CommercialAccess,
  type ProvisioningStatus,
  type RequestedAccessDomain,
  type ResolveAccessStateInput,
} from "../account-access-resolution";
import {
  PROVISIONING_SOURCE,
  createServiceSupabaseClient,
  getAuthAdminUserById,
  resolvePasswordLoginRequirement,
  type AuthAdminUser,
} from "./zion-account-provisioning";

type RequestUser = {
  id?: string | null;
};

type RequestScopedSupabaseClient = {
  auth: {
    getUser: () => Promise<{
      data: {
        user: RequestUser | null;
      };
      error: unknown;
    }>;
    getClaims?: () => Promise<{
      data: {
        claims?: {
          iat?: number | null;
        } | null;
      } | null;
      error: unknown;
    }>;
  };
};

type MembershipRow = {
  organization_id?: unknown;
  created_at?: unknown;
};

type StoreRow = {
  id?: unknown;
  organization_id?: unknown;
  created_at?: unknown;
};

type ResolverServiceClient = unknown;

type RequestUserResult =
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: RequestUser; jwtIssuedAtSeconds: number | null }
  | {
      kind: "unavailable";
      failure: AccessResolutionFailure;
    };

type MembershipFacts = {
  membershipCount: number;
  distinctOrganizationCount: number;
  organizationId: string | null;
};

type StoreFacts = {
  storeCount: number;
  storeId: string | null;
};

type CommercialAccessPayload = {
  subscription_status?: unknown;
  grace_until?: unknown;
  is_blocked?: unknown;
  reason?: unknown;
  token_limit_mensal?: unknown;
  token_consumido_atual?: unknown;
  token_pct?: unknown;
  ai_mode?: unknown;
};

export type AccountAccessResolverDeps = {
  createServiceClient: () => ResolverServiceClient;
  getRequestUser: (
    supabase: RequestScopedSupabaseClient,
  ) => Promise<RequestUserResult>;
  getAuthAdminUser: (
    serviceSupabase: ResolverServiceClient,
    userId: string,
  ) => Promise<AuthAdminUser>;
  lookupActiveZionAdmin: (
    serviceSupabase: ResolverServiceClient,
    userId: string,
  ) => Promise<boolean>;
  lookupProfileExists: (
    serviceSupabase: ResolverServiceClient,
    userId: string,
  ) => Promise<boolean>;
  listMemberships: (
    serviceSupabase: ResolverServiceClient,
    userId: string,
  ) => Promise<unknown>;
  lookupOrganizationExists: (
    serviceSupabase: ResolverServiceClient,
    organizationId: string,
  ) => Promise<boolean>;
  listStores: (
    serviceSupabase: ResolverServiceClient,
    organizationId: string,
  ) => Promise<unknown>;
  fetchCommercialAccess: (
    serviceSupabase: ResolverServiceClient,
    organizationId: string,
  ) => Promise<unknown>;
  fetchOnboardingRecord: (
    serviceSupabase: ResolverServiceClient,
    organizationId: string,
    storeId: string,
  ) => Promise<unknown>;
};

export type ResolveAccessForRequestParams = {
  requestedDomain: RequestedAccessDomain;
  supabase: RequestScopedSupabaseClient;
  deps?: Partial<AccountAccessResolverDeps>;
};

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function createFacts(
  requestedDomain: RequestedAccessDomain,
  overrides: Partial<ResolveAccessStateInput> = {},
): ResolveAccessStateInput {
  return {
    requestedDomain,
    hasSession: false,
    isActiveZionAdmin: false,
    provisioningStatus: "unknown",
    firstAccessRequired: false,
    passwordLoginRequired: false,
    hasProfile: false,
    membershipCount: 0,
    distinctOrganizationCount: 0,
    organizationExists: false,
    storeCount: 0,
    commercialAccess: "unknown",
    onboardingRequired: false,
    sessionUserId: null,
    organizationId: null,
    storeId: null,
    resolutionFailure: null,
    ...overrides,
  };
}

function createUnavailableResolution(
  requestedDomain: RequestedAccessDomain,
  failure: AccessResolutionFailure,
  sessionUserId: string | null = null,
) {
  return resolveAccessState(
    createFacts(requestedDomain, {
      hasSession: sessionUserId !== null,
      sessionUserId,
      resolutionFailure: failure,
    }),
  );
}

function createLookupUnavailableFailure(
  reasonCode: AccessResolutionFailure["reasonCode"],
  message: string,
): AccessResolutionFailure {
  return { reasonCode, message };
}

function normalizeProvisioningFacts(user: AuthAdminUser): {
  provisioningStatus: ProvisioningStatus;
  firstAccessRequired: boolean;
} {
  const metadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {};
  const source = metadata.provisioned_via;
  const rawStatus = metadata.zion_provisioning_status;
  const provisioningStatus: ProvisioningStatus =
    source === PROVISIONING_SOURCE &&
    (rawStatus === "pending" ||
      rawStatus === "provisioned" ||
      rawStatus === "failed")
      ? rawStatus
      : "unknown";

  return {
    provisioningStatus,
    firstAccessRequired:
      provisioningStatus === "provisioned" &&
      metadata.zion_first_access_required === true,
  };
}

function normalizeMembershipFacts(
  rows: unknown,
): MembershipFacts | AccessResolutionFailure {
  if (!Array.isArray(rows)) {
    return createLookupUnavailableFailure(
      "malformed_memberships_contract",
      "Memberships retornaram um contrato invalido para resolucao de acesso.",
    );
  }

  const organizationIds: string[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      return createLookupUnavailableFailure(
        "malformed_memberships_contract",
        "Memberships retornaram uma linha malformada para resolucao de acesso.",
      );
    }

    const organizationId = normalizeNonEmptyString(
      (row as MembershipRow).organization_id,
    );

    if (!organizationId) {
      return createLookupUnavailableFailure(
        "malformed_memberships_contract",
        "Memberships retornaram organization_id invalido para resolucao de acesso.",
      );
    }

    organizationIds.push(organizationId);
  }

  if (organizationIds.length !== rows.length) {
    return createLookupUnavailableFailure(
      "malformed_memberships_contract",
      "Memberships retornaram quantidade inconsistente de organization_id validos.",
    );
  }

  const distinctOrganizationIds = Array.from(new Set(organizationIds));

  return {
    membershipCount: rows.length,
    distinctOrganizationCount: distinctOrganizationIds.length,
    organizationId:
      distinctOrganizationIds.length === 1 ? distinctOrganizationIds[0] : null,
  };
}

function normalizeStoreFacts(
  rows: unknown,
  organizationId: string,
): StoreFacts | AccessResolutionFailure {
  if (!Array.isArray(rows)) {
    return createLookupUnavailableFailure(
      "malformed_stores_contract",
      "Stores retornaram um contrato invalido para resolucao de acesso.",
    );
  }

  const storeIds = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      return createLookupUnavailableFailure(
        "malformed_stores_contract",
        "Stores retornaram uma linha malformada para resolucao de acesso.",
      );
    }

    const storeId = normalizeNonEmptyString((row as StoreRow).id);
    const rowOrganizationId = normalizeNonEmptyString(
      (row as StoreRow).organization_id,
    );

    if (!storeId || !rowOrganizationId) {
      return createLookupUnavailableFailure(
        "malformed_stores_contract",
        "Stores retornaram identificadores invalidos para resolucao de acesso.",
      );
    }

    if (rowOrganizationId !== organizationId) {
      return createLookupUnavailableFailure(
        "malformed_stores_contract",
        "Stores retornaram organization_id divergente do contexto consultado.",
      );
    }

    if (storeIds.has(storeId)) {
      return createLookupUnavailableFailure(
        "malformed_stores_contract",
        "Stores retornaram ids duplicados para resolucao de acesso.",
      );
    }

    storeIds.add(storeId);
  }

  const distinctStoreIds = Array.from(storeIds);

  return {
    storeCount: distinctStoreIds.length,
    storeId: distinctStoreIds.length === 1 ? distinctStoreIds[0] : null,
  };
}

function normalizeCommercialAccess(
  value: unknown,
): CommercialAccess | AccessResolutionFailure {
  if (!value || typeof value !== "object") {
    return createLookupUnavailableFailure(
      "malformed_commercial_access_contract",
      "O payload comercial retornou um contrato invalido para resolucao de acesso.",
    );
  }

  const row = value as CommercialAccessPayload;
  const aiMode = row.ai_mode;

  if (
    typeof row.subscription_status !== "string" ||
    !(row.grace_until === null || typeof row.grace_until === "string") ||
    typeof row.is_blocked !== "boolean" ||
    !(row.reason === null || typeof row.reason === "string") ||
    typeof row.token_limit_mensal !== "number" ||
    typeof row.token_consumido_atual !== "number" ||
    typeof row.token_pct !== "number" ||
    (aiMode !== "normal" && aiMode !== "econ" && aiMode !== "blocked")
  ) {
    return createLookupUnavailableFailure(
      "malformed_commercial_access_contract",
      "O payload comercial retornou colunas obrigatorias ausentes ou mal tipadas.",
    );
  }

  return row.is_blocked ? "blocked" : "allowed";
}

function logOnboardingContractDiagnostic(value: unknown) {
  const isArrayValue = Array.isArray(value);
  const normalizedValue =
    isArrayValue && value.length === 1 ? value[0] : value;
  const objectValue =
    normalizedValue && typeof normalizedValue === "object" ? normalizedValue : null;
  const statusValue = objectValue
    ? (objectValue as { status?: unknown }).status
    : undefined;

  console.info("[account-access-resolver]", {
    stepCode: "onboarding_contract_diagnostic",
    returnKind:
      value == null ? "null" : isArrayValue ? "array" : typeof value === "object" ? "object" : typeof value,
    elementCount: isArrayValue ? value.length : null,
    propertyNames: objectValue ? Object.keys(objectValue).sort() : [],
    statusType:
      statusValue === null ? "null" : Array.isArray(statusValue) ? "array" : typeof statusValue,
    statusValue: typeof statusValue === "string" ? statusValue : null,
    hasSupabaseError: false,
  });
}

function normalizeOnboardingRequired(
  value: unknown,
): boolean | AccessResolutionFailure {
  const normalizedValue = Array.isArray(value)
    ? value.length === 0
      ? null
      : value.length === 1
        ? value[0]
        : createLookupUnavailableFailure(
            "malformed_onboarding_contract",
            "O onboarding retornou multiplas linhas para uma loja que deveria ser unica.",
          )
    : value;

  if (
    normalizedValue &&
    typeof normalizedValue === "object" &&
    "reasonCode" in normalizedValue
  ) {
    return normalizedValue as AccessResolutionFailure;
  }

  if (normalizedValue == null) {
    return true;
  }

  if (!normalizedValue || typeof normalizedValue !== "object") {
    return createLookupUnavailableFailure(
      "malformed_onboarding_contract",
      "O onboarding retornou um contrato invalido para resolucao de acesso.",
    );
  }

  const status = normalizeNonEmptyString(
    (normalizedValue as { status?: unknown }).status,
  );

  if (status === null) {
    return createLookupUnavailableFailure(
      "malformed_onboarding_contract",
      "O onboarding nao informou um status valido para resolucao de acesso.",
    );
  }

  switch (status.toLowerCase()) {
    case "not_started":
    case "in_progress":
      return true;
    case "completed":
      return false;
    default:
      return createLookupUnavailableFailure(
        "malformed_onboarding_contract",
        "O onboarding retornou um status fora do contrato aprovado.",
      );
  }
}

function buildDefaultDeps(): AccountAccessResolverDeps {
  return {
    createServiceClient: () => createServiceSupabaseClient(),
    getRequestUser: async (supabase) => {
      try {
        let jwtIssuedAtSeconds: number | null = null;

        if (typeof supabase.auth.getClaims === "function") {
          const claimsResult = await supabase.auth.getClaims();

          if (claimsResult.error) {
            return {
              kind: "unavailable",
              failure: createLookupUnavailableFailure(
                "request_auth_unavailable",
                "Nao foi possivel validar os claims verificados da sessao autenticada.",
              ),
            };
          }

          const iat = claimsResult.data?.claims?.iat;
          jwtIssuedAtSeconds = typeof iat === "number" && Number.isFinite(iat) ? iat : null;
        }

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error) {
          return {
            kind: "unavailable",
            failure: createLookupUnavailableFailure(
              "request_auth_unavailable",
              "Nao foi possivel validar a sessao autenticada na camada de request.",
            ),
          };
        }

        if (!user) {
          return { kind: "anonymous" };
        }

        return {
          kind: "authenticated",
          user,
          jwtIssuedAtSeconds,
        };
      } catch {
        return {
          kind: "unavailable",
          failure: createLookupUnavailableFailure(
            "request_auth_unavailable",
            "A consulta de autenticacao da requisicao falhou antes de resolver o usuario.",
          ),
        };
      }
    },
    getAuthAdminUser: async (serviceSupabase, userId) =>
      getAuthAdminUserById(
        serviceSupabase as ReturnType<typeof createServiceSupabaseClient>,
        userId,
      ),
    lookupActiveZionAdmin: async (serviceSupabase, userId) => {
      const { data, error } = await (
        serviceSupabase as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string | boolean) => {
                eq: (column: string, value: string | boolean) => {
                  maybeSingle: () => Promise<{
                    data: { id?: string | null } | null;
                    error: unknown;
                  }>;
                };
              };
            };
          };
        }
      )
        .from("zion_internal_admins")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return Boolean(data?.id);
    },
    lookupProfileExists: async (serviceSupabase, userId) => {
      const { data, error } = await (
        serviceSupabase as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string) => {
                maybeSingle: () => Promise<{
                  data: { user_id?: string | null } | null;
                  error: unknown;
                }>;
              };
            };
          };
        }
      )
        .from("profiles")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return Boolean(normalizeNonEmptyString(data?.user_id));
    },
    listMemberships: async (serviceSupabase, userId) => {
      const { data, error } = await (
        serviceSupabase as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => Promise<{
                  data: MembershipRow[] | null;
                  error: unknown;
                }>;
              };
            };
          };
        }
      )
        .from("memberships")
        .select("organization_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
    lookupOrganizationExists: async (serviceSupabase, organizationId) => {
      const { data, error } = await (
        serviceSupabase as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string) => {
                maybeSingle: () => Promise<{
                  data: { id?: string | null } | null;
                  error: unknown;
                }>;
              };
            };
          };
        }
      )
        .from("organizations")
        .select("id")
        .eq("id", organizationId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return Boolean(normalizeNonEmptyString(data?.id));
    },
    listStores: async (serviceSupabase, organizationId) => {
      const { data, error } = await (
        serviceSupabase as {
          from: (table: string) => {
            select: (columns: string) => {
              eq: (column: string, value: string) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => Promise<{
                  data: StoreRow[] | null;
                  error: unknown;
                }>;
              };
            };
          };
        }
      )
        .from("stores")
        .select("id, organization_id, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      return data ?? [];
    },
    fetchCommercialAccess: async (serviceSupabase, organizationId) => {
      const { data, error } = await (
        serviceSupabase as {
          rpc: (
            fn: string,
            args: Record<string, string>,
          ) => Promise<{
            data: unknown;
            error: unknown;
          }>;
        }
      ).rpc("get_org_access_status", {
        p_org_id: organizationId,
      });

      if (error) {
        throw error;
      }

      return data;
    },
    fetchOnboardingRecord: async (serviceSupabase, organizationId, storeId) => {
      const { data, error } = await (
        serviceSupabase as {
          rpc: (
            fn: string,
            args: Record<string, string>,
          ) => {
            maybeSingle: () => Promise<{
              data: unknown;
              error: unknown;
            }>;
          };
        }
      )
        .rpc("onboarding_get_store_onboarding_scoped", {
          p_organization_id: organizationId,
          p_store_id: storeId,
        })
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data;
    },
  };
}

export async function resolveAccessForRequest({
  requestedDomain,
  supabase,
  deps: depsOverrides,
}: ResolveAccessForRequestParams): Promise<AccessResolution> {
  const deps: AccountAccessResolverDeps = {
    ...buildDefaultDeps(),
    ...depsOverrides,
  };

  let requestUserResult: RequestUserResult;
  try {
    requestUserResult = await deps.getRequestUser(supabase);
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "request_auth_unavailable",
        "A autenticacao da requisicao falhou antes de resolver o usuario.",
      ),
    );
  }

  if (requestUserResult.kind === "unavailable") {
    return createUnavailableResolution(
      requestedDomain,
      requestUserResult.failure,
    );
  }

  if (requestUserResult.kind === "anonymous") {
    return resolveAccessState(createFacts(requestedDomain));
  }

  const sessionUserId = normalizeNonEmptyString(requestUserResult.user.id);
  const facts = createFacts(requestedDomain, {
    hasSession: true,
    sessionUserId,
  });

  if (!sessionUserId) {
    return resolveAccessState(facts);
  }

  let serviceSupabase: ResolverServiceClient;
  try {
    serviceSupabase = deps.createServiceClient();
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "service_client_unavailable",
        "Nao foi possivel criar o cliente de servico para resolver o acesso.",
      ),
      sessionUserId,
    );
  }

  try {
    const isActiveZionAdmin = await deps.lookupActiveZionAdmin(
      serviceSupabase,
      sessionUserId,
    );

    if (typeof isActiveZionAdmin !== "boolean") {
      return createUnavailableResolution(
        requestedDomain,
        createLookupUnavailableFailure(
          "zion_admin_lookup_unavailable",
          "A consulta de Zion-ADM retornou um contrato invalido.",
        ),
        sessionUserId,
      );
    }

    facts.isActiveZionAdmin = isActiveZionAdmin;
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "zion_admin_lookup_unavailable",
        "Nao foi possivel consultar o vinculo Zion-ADM da conta autenticada.",
      ),
      sessionUserId,
    );
  }

  if (
    requestedDomain === "zion_admin" ||
    (requestedDomain === "public" && facts.isActiveZionAdmin)
  ) {
    return resolveAccessState(facts);
  }

  let authAdminUser: AuthAdminUser;
  try {
    authAdminUser = await deps.getAuthAdminUser(serviceSupabase, sessionUserId);
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "auth_admin_lookup_unavailable",
        "Nao foi possivel consultar o usuario canonicamente no Auth Admin.",
      ),
      sessionUserId,
    );
  }

  if (normalizeNonEmptyString(authAdminUser.id) !== sessionUserId) {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "malformed_auth_admin_user",
        "O Auth Admin retornou um usuario divergente da sessao autenticada.",
      ),
      sessionUserId,
    );
  }

  const provisioningFacts = normalizeProvisioningFacts(authAdminUser);
  facts.provisioningStatus = provisioningFacts.provisioningStatus;
  facts.firstAccessRequired = provisioningFacts.firstAccessRequired;

  const passwordLoginRequirement = resolvePasswordLoginRequirement(
    authAdminUser,
    requestUserResult.jwtIssuedAtSeconds,
  );
  facts.passwordLoginRequired = passwordLoginRequirement.state === "login_required";

  let hasProfile: boolean;
  try {
    hasProfile = await deps.lookupProfileExists(serviceSupabase, sessionUserId);
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "profile_lookup_unavailable",
        "Nao foi possivel consultar o profile operacional da conta autenticada.",
      ),
      sessionUserId,
    );
  }

  if (typeof hasProfile !== "boolean") {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "profile_lookup_unavailable",
        "A consulta de profile retornou um contrato invalido.",
      ),
      sessionUserId,
    );
  }

  facts.hasProfile = hasProfile;

  if (!facts.hasProfile) {
    return resolveAccessState(facts);
  }

  let membershipFacts: MembershipFacts | AccessResolutionFailure;
  try {
    membershipFacts = normalizeMembershipFacts(
      await deps.listMemberships(serviceSupabase, sessionUserId),
    );
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "memberships_lookup_unavailable",
        "Nao foi possivel consultar as memberships da conta autenticada.",
      ),
      sessionUserId,
    );
  }

  if ("reasonCode" in membershipFacts) {
    return createUnavailableResolution(
      requestedDomain,
      membershipFacts,
      sessionUserId,
    );
  }

  facts.membershipCount = membershipFacts.membershipCount;
  facts.distinctOrganizationCount =
    membershipFacts.distinctOrganizationCount;
  facts.organizationId = membershipFacts.organizationId;

  if (
    facts.membershipCount === 0 ||
    facts.distinctOrganizationCount !== 1 ||
    !facts.organizationId
  ) {
    return resolveAccessState(facts);
  }

  let organizationExists: boolean;
  try {
    organizationExists = await deps.lookupOrganizationExists(
      serviceSupabase,
      facts.organizationId,
    );
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "organization_lookup_unavailable",
        "Nao foi possivel consultar a organizacao canonica da membership.",
      ),
      sessionUserId,
    );
  }

  if (typeof organizationExists !== "boolean") {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "organization_lookup_unavailable",
        "A consulta de organizacao retornou um contrato invalido.",
      ),
      sessionUserId,
    );
  }

  facts.organizationExists = organizationExists;

  if (!facts.organizationExists) {
    return resolveAccessState(facts);
  }

  let storeFacts: StoreFacts | AccessResolutionFailure;
  try {
    storeFacts = normalizeStoreFacts(
      await deps.listStores(serviceSupabase, facts.organizationId),
      facts.organizationId,
    );
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "stores_lookup_unavailable",
        "Nao foi possivel consultar as lojas da organizacao autenticada.",
      ),
      sessionUserId,
    );
  }

  if ("reasonCode" in storeFacts) {
    return createUnavailableResolution(
      requestedDomain,
      storeFacts,
      sessionUserId,
    );
  }

  facts.storeCount = storeFacts.storeCount;
  facts.storeId = storeFacts.storeId;

  if (facts.storeCount !== 1 || !facts.storeId) {
    return resolveAccessState(facts);
  }

  let commercialAccess: CommercialAccess | AccessResolutionFailure;
  try {
    commercialAccess = normalizeCommercialAccess(
      await deps.fetchCommercialAccess(serviceSupabase, facts.organizationId),
    );
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "commercial_access_lookup_unavailable",
        "Nao foi possivel consultar o gate comercial da organizacao.",
      ),
      sessionUserId,
    );
  }

  if (typeof commercialAccess !== "string") {
    return createUnavailableResolution(
      requestedDomain,
      commercialAccess,
      sessionUserId,
    );
  }

  facts.commercialAccess = commercialAccess;

  if (facts.commercialAccess !== "allowed") {
    return resolveAccessState(facts);
  }

  let onboardingRequired: boolean | AccessResolutionFailure;
  try {
    const onboardingRecord = await deps.fetchOnboardingRecord(
      serviceSupabase,
      facts.organizationId,
      facts.storeId,
    );
    logOnboardingContractDiagnostic(onboardingRecord);
    onboardingRequired = normalizeOnboardingRequired(onboardingRecord);
  } catch {
    return createUnavailableResolution(
      requestedDomain,
      createLookupUnavailableFailure(
        "onboarding_lookup_unavailable",
        "Nao foi possivel consultar o onboarding da organizacao autenticada.",
      ),
      sessionUserId,
    );
  }

  if (typeof onboardingRequired !== "boolean") {
    return createUnavailableResolution(
      requestedDomain,
      onboardingRequired,
      sessionUserId,
    );
  }

  facts.onboardingRequired = onboardingRequired;

  return resolveAccessState(facts);
}
