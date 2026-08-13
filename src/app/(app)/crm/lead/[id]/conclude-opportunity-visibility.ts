const HUMAN_CONCLUSION_ENABLED_STAGES = new Set(["pos_venda"]);
const HUMAN_POST_SALE_REOPEN_ENABLED_STAGES = new Set([
  "concluido_sem_mais_acoes",
]);

function normalizeOpportunityStage(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() || null;
}

export function canEnableConcludeOpportunityAction(value: string | null | undefined) {
  const normalizedStage = normalizeOpportunityStage(value);
  return normalizedStage ? HUMAN_CONCLUSION_ENABLED_STAGES.has(normalizedStage) : false;
}

export function canRenderConcludeOpportunityAction(
  _selectedOpportunityStage: string | null | undefined,
  _hasSelectedOpportunity: boolean,
) {
  return true;
}

export function canEnableReopenForPostSaleAction(
  value: string | null | undefined,
) {
  const normalizedStage = normalizeOpportunityStage(value);
  return normalizedStage
    ? HUMAN_POST_SALE_REOPEN_ENABLED_STAGES.has(normalizedStage)
    : false;
}

export function canRenderReopenForPostSaleAction(
  selectedOpportunityStage: string | null | undefined,
  hasSelectedOpportunity: boolean,
) {
  return (
    hasSelectedOpportunity &&
    canEnableReopenForPostSaleAction(selectedOpportunityStage)
  );
}
