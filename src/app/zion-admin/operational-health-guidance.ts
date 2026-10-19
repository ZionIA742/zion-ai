export type OperationalHealthGuidanceIssue = {
  code: string;
  scope: string;
  count?: number;
};

export type OperationalHealthCommercialEvidence = {
  state: string;
  sourceAvailability: "available" | "partial" | "unavailable";
  processingErrors: number | null;
  pendingUnconfirmed: number | null;
  processedRecorded: number | null;
  invalid: number | null;
  noActionsObserved: boolean;
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
    case "commercial_action_processing_error":
      return "Problema confirmado no processamento da a\u00e7\u00e3o comercial; isso n\u00e3o comprova falha definitiva da IA.";
    case "commercial_action_invalid":
      return "A evid\u00eancia da a\u00e7\u00e3o comercial est\u00e1 inv\u00e1lida e n\u00e3o permite concluir sobre a fila.";
    case "commercial_action_source_partial":
    case "commercial_action_source_unavailable":
      return "A verifica\u00e7\u00e3o das a\u00e7\u00f5es comerciais est\u00e1 incompleta; n\u00e3o conclua sobre aus\u00eancia de pend\u00eancias.";
    default:
      return "A evidência disponível não é suficiente para orientar uma correção específica.";
  }
}

export function getOperationalHealthCommercialEvidenceText(
  commercial: OperationalHealthCommercialEvidence | null | undefined,
) {
  if (!commercial) {
    return "A\u00e7\u00f5es comerciais: verifica\u00e7\u00e3o n\u00e3o dispon\u00edvel neste contrato.";
  }

  if (commercial.noActionsObserved) {
    return "A\u00e7\u00f5es comerciais: nenhuma a\u00e7\u00e3o observada no recorte; isso n\u00e3o comprova sa\u00fade comercial.";
  }

  const observed = (value: number | null) =>
    value === null ? "indispon\u00edvel" : String(value);
  const availability = commercial.sourceAvailability === "available"
    ? ""
    : " A fonte est\u00e1 incompleta; as contagens s\u00e3o observadas e podem n\u00e3o representar o total.";

  return `A\u00e7\u00f5es comerciais observadas: ${observed(commercial.processedRecorded)} processada(s), ${observed(commercial.pendingUnconfirmed)} pendente(s), ${observed(commercial.processingErrors)} com erro registrado e ${observed(commercial.invalid)} inv\u00e1lida(s).${availability}`;
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
