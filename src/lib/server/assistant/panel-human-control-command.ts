// The SQL RPC is the sole authority; this classifier only routes panel text.
export type PanelHumanControlExecutor = (args: {
  p_organization_id: string;
  p_store_id: string;
  p_human_message_id: string;
}) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

type Reply = { ok: true; aiText: string } | { ok: false; error: string; message: string };
type Result = { handled: false } | { handled: true; result: Reply };

type Input = {
  organizationId: string;
  storeId: string;
  humanMessageId: string;
  readMessage: () => PromiseLike<{ data: unknown; error: unknown }>;
  execute: PanelHumanControlExecutor;
  persist: (input: { content: string; messageType: string; metadata: Record<string, unknown>; relatedConversationId?: string | null }) => Promise<{ message?: string } | null>;
};

export function isPanelHumanControlCandidate(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(?:eu vou cuidar|vou cuidar eu mesmo|vou assumir o atendimento|nao responda|pare de responder|mantenha em espera|pode assumir|pode voltar a responder|libere a ia|retome a ia)(?:$|[.!?,;:]|\s+para(?:\s|$))/.test(normalized)
    || /^(?:libere a ia|retome a ia|vou assumir o atendimento|pode voltar a responder|pare de responder|nao responda)(?:\s|$)/.test(normalized);
}

const knownDenials: Readonly<Record<string, string>> = {
  N30B_COMMAND_NOT_AUTHORIZED: 'Voce nao tem permissao para executar esse comando.',
  N30B_COMMAND_SOURCE_INVALID: 'Nao consegui validar a autoria dessa mensagem. Envie um novo comando pelo painel.',
  N30B_COMMAND_RECEIPT_SCOPE: 'Nao consegui validar o registro desse comando.',
  N30B_COMMAND_EXPIRED: 'Esse comando expirou. Envie um novo comando.',
  N30B_COMMAND_SUPERSEDED: 'Esse comando foi superado por uma mensagem mais recente. Envie um novo comando.',
  N30B_COMMAND_EXPLICIT_TARGET_REQUIRED: 'Informe o nome completo do cliente em um novo comando, por exemplo: libere a IA para Maria Silva.',
  N30B_COMMAND_TARGET_NOT_UNIQUE: 'Nao encontrei um atendimento unico para esse cliente. Nenhuma alteracao foi feita.',
  N30B_COMMAND_TARGET_SCOPE: 'Nao consegui validar o atendimento dessa loja.',
  N30B_COMMAND_LEASE_SCOPE: 'Nao consegui validar o controle desse atendimento.',
  N30B_COMMAND_STALE_CONTROL: 'O controle do atendimento mudou depois desse comando. Envie um novo comando.',
  N30B_COMMAND_ACTIVE_TAKEOVER_REQUIRED: 'Esse comando exige um atendimento sob controle humano ativo.',
  N30B_COMMAND_HARD_HOLD_ACTIVE: 'O atendimento continua bloqueado. A suspensao explicita precisa ser removida antes de devolver para a IA.',
};

export async function handlePanelHumanControlCommand(input: Input): Promise<Result> {
  const failure = (error: string, message: string): Result => ({ handled: true, result: { ok: false, error, message } });
  const source = await input.readMessage();
  const row = source.data as { id?: unknown; content?: unknown; message_type?: unknown } | null;
  if (source.error || !row || row.id !== input.humanMessageId || typeof row.content !== 'string') {
    return failure('PANEL_CONTROL_SOURCE_UNAVAILABLE', 'Nao consegui carregar a mensagem exata do painel.');
  }
  if (row.message_type !== 'text' || !isPanelHumanControlCandidate(row.content)) return { handled: false };
  const response = await input.execute({ p_organization_id: input.organizationId, p_store_id: input.storeId, p_human_message_id: input.humanMessageId });
  let text: string;
  let target: string | null = null;
  let outcome: string;
  let action: string | null = null;
  if (response.error) {
    const code = response.error.message;
    if (!Object.prototype.hasOwnProperty.call(knownDenials, code)) return failure('PANEL_CONTROL_RPC_FAILED', 'Nao consegui confirmar a execucao do comando. Tente recuperar a resposta.');
    text = knownDenials[code];
    outcome = 'denied';
  } else {
    const result = Array.isArray(response.data) && response.data.length === 1 ? response.data[0] as Record<string, unknown> : null;
    if (!result || (result.outcome !== 'applied' && result.outcome !== 'replayed') || typeof result.target_conversation_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.target_conversation_id) || (result.command_action !== 'takeover_temporary' && result.command_action !== 'create_hard_hold' && result.command_action !== 'release_ai')) {
      return failure('PANEL_CONTROL_RPC_RESULT_INVALID', 'Nao consegui confirmar o resultado do comando.');
    }
    target = result.target_conversation_id;
    outcome = result.outcome;
    action = result.command_action;
    text = outcome === 'replayed' ? 'Esse comando ja foi executado anteriormente. Nao alterei novamente o controle do atendimento.'
      : action === 'takeover_temporary' ? 'Certo. O atendimento esta sob controle humano. A IA Vendedora nao reassumira automaticamente.'
      : action === 'create_hard_hold' ? 'Certo. O bloqueio explicito do atendimento esta ativo.'
      : 'Certo. O controle do atendimento foi devolvido para a IA Vendedora.';
  }
  const error = await input.persist({ content: text, messageType: 'text', relatedConversationId: target, metadata: { source: 'assistant.reply.route', human_control_command: true, command_outcome: outcome, command_action: action } });
  if (error) return failure('SAVE_ASSISTANT_MESSAGE_FAILED', 'Nao consegui confirmar a gravacao da resposta. Tente recuperar a resposta.');
  return { handled: true, result: { ok: true, aiText: text } };
}
