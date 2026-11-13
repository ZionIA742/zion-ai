export type HumanCommandAction =
  | "takeover_temporary"
  | "create_hard_hold"
  | "release_ai"
  | "ambiguous";

export type HumanCommandActor = "panel_human" | "customer" | "assistant" | "system" | "unknown";
export type HumanCommandChannel = "crm_panel" | "whatsapp" | "internal" | "unknown";
export type HumanCommandDestination = "assistant" | "customer" | "system" | "unknown";

export type HumanCommandContext = {
  conversationId?: string | null;
  organizationId?: string | null;
  storeId?: string | null;
  humanTakeoverActive?: boolean | null;
  hardHoldActive?: boolean | null;
};

export type ResolveHumanCommandInput = {
  messageId?: string | null;
  text?: string | null;
  actorUserId?: string | null;
  actor?: HumanCommandActor;
  channel?: HumanCommandChannel;
  destination?: HumanCommandDestination;
  context?: HumanCommandContext | null;
};

export type HumanCommandDecision = {
  action: HumanCommandAction;
  confidence: "explicit" | "ambiguous";
  reasonCode:
    | "EXPLICIT_HUMAN_TAKEOVER"
    | "EXPLICIT_HARD_HOLD"
    | "EXPLICIT_AI_RELEASE"
    | "CONTEXT_REQUIRED"
    | "ACTOR_NOT_AUTHORIZED"
    | "MESSAGE_NOT_A_COMMAND"
    | "AI_RELEASE_WITHOUT_ACTIVE_TAKEOVER";
  organizationId: string | null;
  storeId: string | null;
  conversationId: string | null;
  sourceMessageId: string | null;
  decisionKey: string | null;
};

function clean(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function baseDecision(
  input: ResolveHumanCommandInput,
  reasonCode: HumanCommandDecision["reasonCode"],
): HumanCommandDecision {
  const context = input.context || null;
  return {
    action: "ambiguous",
    confidence: "ambiguous",
    reasonCode,
    organizationId: clean(context?.organizationId),
    storeId: clean(context?.storeId),
    conversationId: clean(context?.conversationId),
    sourceMessageId: clean(input.messageId),
    decisionKey: null,
  };
}

function explicitDecision(
  input: ResolveHumanCommandInput,
  action: Exclude<HumanCommandAction, "ambiguous">,
  reasonCode: Exclude<HumanCommandDecision["reasonCode"],
    | "CONTEXT_REQUIRED"
    | "ACTOR_NOT_AUTHORIZED"
    | "MESSAGE_NOT_A_COMMAND"
    | "AI_RELEASE_WITHOUT_ACTIVE_TAKEOVER">,
): HumanCommandDecision {
  const context = input.context!;
  const messageId = clean(input.messageId)!;
  return {
    action,
    confidence: "explicit",
    reasonCode,
    organizationId: clean(context.organizationId),
    storeId: clean(context.storeId),
    conversationId: clean(context.conversationId),
    sourceMessageId: messageId,
    decisionKey: `human-command:${messageId}:${action}`,
  };
}

function hasCommandContext(input: ResolveHumanCommandInput): boolean {
  const context = input.context;
  return Boolean(
    clean(input.messageId) &&
      clean(input.actorUserId) &&
      clean(context?.organizationId) &&
      clean(context?.storeId) &&
      clean(context?.conversationId),
  );
}

/**
 * Classifies an explicitly addressed human operator command only.
 * This function is intentionally pure: it never calls an RPC or changes state.
 * Execution must revalidate identity, tenant scope and conversation authority.
 */
export function resolveHumanCommand(input: ResolveHumanCommandInput): HumanCommandDecision {
  const normalized = normalize(input.text);
  if (!normalized) return baseDecision(input, "MESSAGE_NOT_A_COMMAND");

  const isOperatorContext =
    input.actor === "panel_human" &&
    input.channel === "crm_panel" &&
    input.destination === "assistant";

  if (!isOperatorContext) return baseDecision(input, "ACTOR_NOT_AUTHORIZED");
  if (!hasCommandContext(input)) return baseDecision(input, "CONTEXT_REQUIRED");

  if (/^(eu vou cuidar|vou cuidar eu mesmo|vou assumir o atendimento)$/.test(normalized)) {
    return explicitDecision(input, "takeover_temporary", "EXPLICIT_HUMAN_TAKEOVER");
  }

  if (/^(nao responda|não responda|pare de responder|mantenha em espera)$/.test(normalized)) {
    return explicitDecision(input, "create_hard_hold", "EXPLICIT_HARD_HOLD");
  }

  if (/^(pode assumir|pode voltar a responder|libere a ia|retome a ia)$/.test(normalized)) {
    if (input.context?.humanTakeoverActive !== true) {
      return baseDecision(input, "AI_RELEASE_WITHOUT_ACTIVE_TAKEOVER");
    }
    return explicitDecision(input, "release_ai", "EXPLICIT_AI_RELEASE");
  }

  return baseDecision(input, "MESSAGE_NOT_A_COMMAND");
}
