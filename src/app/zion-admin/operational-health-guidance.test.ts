import { strict as assert } from "node:assert";
import {
  formatOperationalHealthIssueLabel,
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

console.log(`zion-admin-operational-health-guidance: ${guidanceCases.length + 7} tests passed`);
