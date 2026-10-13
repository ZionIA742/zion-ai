export type ContractRuleReviewStatus = "approved" | "rejected" | "edited";

export type ContractRuleReviewUiRule = {
  id: string;
  label: string | null;
  value_text: string | null;
  review_revision?: number | null;
  reviewRevision?: number | null;
};

export type ContractRuleReviewAttempts = Record<string, string>;

export type ContractRuleReviewRequest = {
  storeId: string;
  reviewStatus: ContractRuleReviewStatus;
  expectedRevision: number;
  idempotencyKey: string;
  valueText?: string;
  label?: string;
};

export type ContractRuleReviewApiResult = {
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
};

export type ContractRuleReviewSubmission = {
  request: ContractRuleReviewRequest;
  result: ContractRuleReviewApiResult;
};

function cleanText(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function getContractRuleExpectedRevision(
  rule: ContractRuleReviewUiRule,
) {
  const revision = rule.reviewRevision ?? rule.review_revision ?? null;
  return revision !== null && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null;
}

export function buildContractRuleReviewRequest(args: {
  storeId: string;
  rule: ContractRuleReviewUiRule;
  reviewStatus: ContractRuleReviewStatus;
  draftValue: string | null | undefined;
  attempts: ContractRuleReviewAttempts;
  randomUUID?: () => string;
}) {
  const expectedRevision = getContractRuleExpectedRevision(args.rule);
  if (expectedRevision === null) {
    throw new Error(
      "A revisao atual dessa regra nao esta disponivel. Recarregue a tela e tente novamente.",
    );
  }

  const valueText = args.draftValue || null;
  const label = cleanText(args.rule.label);
  const fingerprint = JSON.stringify({
    ruleId: args.rule.id,
    expectedRevision,
    reviewStatus: args.reviewStatus,
    valueText,
    label,
  });
  const idempotencyKey =
    args.attempts[fingerprint] ??
    (args.randomUUID ?? (() => crypto.randomUUID()))();
  args.attempts[fingerprint] = idempotencyKey;

  return {
    fingerprint,
    request: {
      storeId: args.storeId,
      reviewStatus: args.reviewStatus,
      expectedRevision,
      idempotencyKey,
      valueText: valueText || undefined,
      label: label || undefined,
    } satisfies ContractRuleReviewRequest,
  };
}

export async function submitContractRuleReview(args: {
  rule: ContractRuleReviewUiRule;
  storeId: string;
  reviewStatus: ContractRuleReviewStatus;
  draftValue: string | null | undefined;
  attempts: ContractRuleReviewAttempts;
  fetchImpl?: typeof fetch;
  randomUUID?: () => string;
}) : Promise<ContractRuleReviewSubmission> {
  const built = buildContractRuleReviewRequest(args);
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `/api/store-contract-templates/rules/${args.rule.id}/review`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(built.request),
    },
  );
  const result = (await response.json().catch(() => null)) as ContractRuleReviewApiResult | null;

  if (!response.ok || !result?.ok) {
    if (response.status === 409) {
      throw Object.assign(
        new Error(
          result?.message ||
            "A regra foi alterada por outra revisao. O estado atualizado foi carregado; confira seu ajuste antes de tentar novamente.",
        ),
        { code: "CONTRACT_RULE_REVIEW_CONFLICT", status: 409 },
      );
    }
    throw new Error(result?.message || "Nao foi possivel revisar essa regra.");
  }

  return { request: built.request, result };
}

export function preserveContractRuleDraftAfterConflict(args: {
  drafts: Record<string, string>;
  ruleId: string;
  draftBeforeRefresh: string;
}) {
  return {
    ...args.drafts,
    [args.ruleId]: args.draftBeforeRefresh,
  };
}
