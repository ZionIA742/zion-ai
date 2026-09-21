export type FollowupPrioritySortableRow = {
  commercial_opportunity_id: string;
  hours_since_customer?: number | null;
  followup_type?: string | null;
  suggested_action?: string | null;
};

export type FollowupPriorityInfo = {
  priority_rank?: number | null;
};

export function compareFollowupRowsByCanonicalPriority(
  a: FollowupPrioritySortableRow,
  b: FollowupPrioritySortableRow,
  priorityByOpportunity: Record<string, FollowupPriorityInfo | undefined>,
) {
  const priorityA = priorityByOpportunity[a.commercial_opportunity_id];
  const priorityB = priorityByOpportunity[b.commercial_opportunity_id];
  const rankA = priorityA?.priority_rank ?? Number.NEGATIVE_INFINITY;
  const rankB = priorityB?.priority_rank ?? Number.NEGATIVE_INFINITY;
  if (rankA !== rankB) return rankB - rankA;

  const ha = a.hours_since_customer ?? -1;
  const hb = b.hours_since_customer ?? -1;
  if (ha !== hb) return hb - ha;

  const opportunityCompare = a.commercial_opportunity_id.localeCompare(b.commercial_opportunity_id);
  if (opportunityCompare !== 0) return opportunityCompare;

  return String(a.followup_type || a.suggested_action || "").localeCompare(
    String(b.followup_type || b.suggested_action || "")
  );
}

export function sortFollowupRowsByCanonicalPriority<T extends FollowupPrioritySortableRow>(
  rows: T[],
  priorityByOpportunity: Record<string, FollowupPriorityInfo | undefined>,
) {
  return [...rows].sort((a, b) => compareFollowupRowsByCanonicalPriority(a, b, priorityByOpportunity));
}
