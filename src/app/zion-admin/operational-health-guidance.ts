export type OperationalHealthGuidanceIssue = {
  code: string;
  scope: string;
  count?: number;
};

export function formatOperationalHealthIssueLabel(
  issue: Pick<OperationalHealthGuidanceIssue, "code" | "count">,
  labels: Record<string, string>,
) {
  const baseLabel = labels[issue.code] ?? "Ocorrência operacional não reconhecida";
  return issue.count && issue.count > 1
    ? `${baseLabel} (${issue.count})`
    : baseLabel;
}

export function getOperationalHealthIssueGuidance(
  issue: OperationalHealthGuidanceIssue,
) {
  switch (issue.code) {
    case "assistant_task_failed":
      return "Verifique o impacto operacional registrado e encaminhe o caso para investigação técnica, se necessário.";
    case "assistant_task_stale_processing":
      return "Verifique o estado atualizado da tarefa e sua evolução.";
    case "assistant_task_stale_pending":
      return "Acompanhe a pendência e verifique se houve processamento posterior.";
    case "responsible_notification_failed":
      return "Verifique a ocorrência da notificação separadamente da execução da Assistente.";
    case "responsible_notification_uncertain":
      return "Confira o registro e a confirmação disponível antes de concluir sobre a entrega ou falha. Não faça reenvio sem confirmação.";
    case "responsible_notification_stale_processing":
      return "Verifique a situação atualizada da notificação; o intervalo monitorado não comprova bloqueio definitivo.";
    default:
      return "A evidência disponível não é suficiente para orientar uma correção específica.";
  }
}

export function getOperationalHealthEmptyGuidance(args: {
  healthState: string;
  assistantState: string;
}) {
  if (args.healthState === "unknown" || args.assistantState === "unknown") {
    return "Não há ocorrências classificadas, mas as fontes necessárias não estão comprovadamente disponíveis; isso não confirma a saúde integral da Assistente.";
  }

  return "Nenhuma ocorrência da Assistente foi observada nas fontes monitoradas neste recorte.";
}
