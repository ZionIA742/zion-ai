import { strict as assert } from "node:assert";
import {
  formatOperationalHealthIssueLabel,
  getOperationalHealthCommercialEvidenceText,
  getOperationalHealthEmptyGuidance,
  getOperationalHealthIssueGuidance,
} from "./operational-health-guidance";

const issue = (code: string, scope = "assistant") => ({ code, scope });
const labels = {
  assistant_task_failed: "Tarefa da Assistente falhou",
  responsible_notification_failed: "Notificação ao responsável falhou",
};

assert.equal(
  formatOperationalHealthIssueLabel({ code: "assistant_task_failed", count: 1 }, labels),
  "Tarefa da Assistente falhou",
);
assert.equal(
  formatOperationalHealthIssueLabel({ code: "assistant_task_failed", count: 3 }, labels),
  "Tarefa da Assistente falhou (3)",
);
assert.equal(
  formatOperationalHealthIssueLabel({ code: "unrecognized_code", count: 3 }, labels),
  "Ocorrência operacional não reconhecida (3)",
);
assert.equal(
  formatOperationalHealthIssueLabel({ code: "responsible_notification_failed", count: 3 }, labels),
  "Notificação ao responsável falhou (3)",
);

const guidanceCases = [
  ["assistant_task_failed", "impacto operacional", "investigação técnica"],
  ["assistant_task_stale_processing", "estado atualizado", "evolução"],
  ["assistant_task_stale_pending", "Acompanhe a pendência", "processamento posterior"],
  ["responsible_notification_failed", "notificação", "separadamente"],
  ["responsible_notification_uncertain", "confirmação disponível", "reenvio sem confirmação"],
  ["responsible_notification_stale_processing", "situação atualizada", "bloqueio definitivo"],
  ["commercial_action_processing_error", "Problema confirmado", "falha definitiva"],
  ["commercial_action_invalid", "evid", "inv"],
  ["commercial_action_source_partial", "verifica", "incompleta"],
] as const;

for (const [code, expected, expectedAlso] of guidanceCases) {
  const result = getOperationalHealthIssueGuidance(issue(code));
  assert.match(result, new RegExp(expected));
  assert.match(result, new RegExp(expectedAlso));
  assert.doesNotMatch(result, /timeout|worker parou|fila travada|causa técnica:/i);
}

{
  const result = getOperationalHealthIssueGuidance(issue("new_unrecognized_code"));
  assert.equal(result, "A evidência disponível não é suficiente para orientar uma correção específica.");
  assert.doesNotMatch(result, /new_unrecognized_code/);
}

{
  const result = getOperationalHealthEmptyGuidance({ healthState: "unknown", assistantState: "unknown" });
  assert.match(result, /fontes necessárias não estão comprovadamente disponíveis/);
  assert.match(result, /não confirma a saúde integral/);
}

{
  const result = getOperationalHealthEmptyGuidance({ healthState: "healthy", assistantState: "healthy" });
  assert.match(result, /Nenhuma ocorrência/);
  assert.doesNotMatch(result, /saúde integral|saudável em todas/);
}

{
  const result = getOperationalHealthCommercialEvidenceText({
    state: "broken",
    sourceAvailability: "partial",
    processingErrors: 1,
    pendingUnconfirmed: 2,
    processedRecorded: 3,
    invalid: 1,
    noActionsObserved: false,
  });
  assert.match(result, /observadas/);
  assert.match(result, /1 com erro/);
  assert.match(result, /contagens .*observadas/);
}

{
  const result = getOperationalHealthCommercialEvidenceText({
    state: "unknown",
    sourceAvailability: "available",
    processingErrors: 0,
    pendingUnconfirmed: 0,
    processedRecorded: 0,
    invalid: 0,
    noActionsObserved: true,
  });
  assert.match(result, /nenhuma .*observada/);
  assert.match(result, /n.o comprova sa.de comercial/);
}

assert.match(getOperationalHealthCommercialEvidenceText(undefined), /verifica.*n.o dispon.vel/);

console.log(`zion-admin-operational-health-guidance: ${guidanceCases.length + 10} tests passed`);
