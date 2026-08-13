type OwnerMembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type CanonicalOwnerResolution =
  | {
      kind: "missing";
    }
  | {
      kind: "ambiguous";
      remainingMembershipIds: string[];
    }
  | {
      kind: "resolved";
      membership: OwnerMembershipRow;
    };

export function resolveCanonicalOwnerMembership(args: {
  ownerMemberships: OwnerMembershipRow[];
}): CanonicalOwnerResolution {
  if (args.ownerMemberships.length === 0) {
    return {
      kind: "missing",
    };
  }

  if (args.ownerMemberships.length > 1) {
    return {
      kind: "ambiguous",
      remainingMembershipIds: args.ownerMemberships.map((membership) => membership.id),
    };
  }

  return {
    kind: "resolved",
    membership: args.ownerMemberships[0],
  };
}
