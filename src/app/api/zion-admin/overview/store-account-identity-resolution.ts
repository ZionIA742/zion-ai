export type StoreAccountIdentityIssueCode =
  | "owner_missing"
  | "owner_ambiguous"
  | "auth_user_missing"
  | "owner_profile_missing";

export type StoreAccountIdentityResolution = {
  state: "valid" | "broken";
  issues: Array<{ code: StoreAccountIdentityIssueCode }>;
  owner: {
    state: "resolved" | "missing" | "ambiguous";
    membershipId: string | null;
    userId: string | null;
  };
  authUser: {
    state: "present" | "missing" | "unresolved";
    userId: string | null;
  };
  profile: {
    state: "present" | "missing" | "unresolved";
    userId: string | null;
  };
};

type OwnerMembership = {
  id: string;
  user_id: string;
};

type AuthUser = {
  id: string;
};

type OwnerProfile = {
  user_id: string;
};

export function resolveStoreAccountIdentity(args: {
  ownerMemberships: OwnerMembership[];
  authUsers: AuthUser[];
  ownerProfiles: OwnerProfile[];
}): StoreAccountIdentityResolution {
  const ownerMemberships = args.ownerMemberships;

  if (ownerMemberships.length === 0) {
    return {
      state: "broken",
      issues: [{ code: "owner_missing" }],
      owner: {
        state: "missing",
        membershipId: null,
        userId: null,
      },
      authUser: {
        state: "unresolved",
        userId: null,
      },
      profile: {
        state: "unresolved",
        userId: null,
      },
    };
  }

  if (ownerMemberships.length > 1) {
    return {
      state: "broken",
      issues: [{ code: "owner_ambiguous" }],
      owner: {
        state: "ambiguous",
        membershipId: null,
        userId: null,
      },
      authUser: {
        state: "unresolved",
        userId: null,
      },
      profile: {
        state: "unresolved",
        userId: null,
      },
    };
  }

  const ownerMembership = ownerMemberships[0];
  const ownerUserId = ownerMembership.user_id;
  const authUser = args.authUsers.find((candidate) => candidate.id === ownerUserId) ?? null;
  const profile =
    args.ownerProfiles.find((candidate) => candidate.user_id === ownerUserId) ?? null;
  const issues: Array<{ code: StoreAccountIdentityIssueCode }> = [];

  if (!authUser) {
    issues.push({ code: "auth_user_missing" });
  }

  if (!profile) {
    issues.push({ code: "owner_profile_missing" });
  }

  return {
    state: issues.length === 0 ? "valid" : "broken",
    issues,
    owner: {
      state: "resolved",
      membershipId: ownerMembership.id,
      userId: ownerUserId,
    },
    authUser: {
      state: authUser ? "present" : "missing",
      userId: authUser?.id ?? null,
    },
    profile: {
      state: profile ? "present" : "missing",
      userId: profile?.user_id ?? null,
    },
  };
}
