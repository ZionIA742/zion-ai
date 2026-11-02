export type QuoteCreationIdentity = {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  conversationId?: string | null;
  leadId?: string | null;
};

export type QuoteCreationRequest<TQuote, TItem> = {
  identity: QuoteCreationIdentity;
  creationIdempotencyKey: string;
  quote: TQuote;
  items: TItem[];
};

export type QuoteCreationActor =
  | {
      kind: "user";
      userId: string;
    }
  | {
      kind: "system";
      source: string;
    };

export type QuoteCreationExecution<TQuote, TItem> = {
  actor: QuoteCreationActor;
  request: QuoteCreationRequest<TQuote, TItem>;
};

export type QuoteCreationExecutor<TQuote, TItem, TResult> = (
  execution: QuoteCreationExecution<TQuote, TItem>,
) => Promise<TResult>;

export type SystemQuoteCreationContext = {
  readonly kind: "system";
  readonly source: string;
};

function requireText(value: unknown, code: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(code);
  return normalized;
}

function validateRequest<TQuote, TItem>(
  request: QuoteCreationRequest<TQuote, TItem>,
): QuoteCreationRequest<TQuote, TItem> {
  const identity = request?.identity;

  return {
    ...request,
    identity: {
      organizationId: requireText(
        identity?.organizationId,
        "QUOTE_CREATION_ORGANIZATION_REQUIRED",
      ),
      storeId: requireText(identity?.storeId, "QUOTE_CREATION_STORE_REQUIRED"),
      commercialOpportunityId: requireText(
        identity?.commercialOpportunityId,
        "QUOTE_CREATION_OPPORTUNITY_REQUIRED",
      ),
      conversationId: identity?.conversationId ?? null,
      leadId: identity?.leadId ?? null,
    },
    creationIdempotencyKey: requireText(
      request?.creationIdempotencyKey,
      "QUOTE_CREATION_IDEMPOTENCY_KEY_REQUIRED",
    ),
    items: Array.isArray(request?.items) ? request.items : [],
  };
}

async function executeQuoteCreation<TQuote, TItem, TResult>(args: {
  actor: QuoteCreationActor;
  request: QuoteCreationRequest<TQuote, TItem>;
  execute: QuoteCreationExecutor<TQuote, TItem, TResult>;
}): Promise<TResult> {
  const request = validateRequest(args.request);
  return args.execute({ actor: args.actor, request });
}

/**
 * Human route boundary. The user identity must come from the trusted session,
 * never from request data.
 */
export function createSalesQuoteByUser<TQuote, TItem, TResult>(args: {
  userId: string;
  request: QuoteCreationRequest<TQuote, TItem>;
  execute: QuoteCreationExecutor<TQuote, TItem, TResult>;
}): Promise<TResult> {
  return executeQuoteCreation({
    actor: {
      kind: "user",
      userId: requireText(args.userId, "QUOTE_CREATION_USER_REQUIRED"),
    },
    request: args.request,
    execute: args.execute,
  });
}

/**
 * Server-only boundary for a future system/AI caller. No HTTP route exposes
 * this function, and the caller must provide an internal execution context.
 * The actual atomic SQL writer remains a later step.
 */
export function createSalesQuoteBySystem<TQuote, TItem, TResult>(args: {
  system: SystemQuoteCreationContext;
  request: QuoteCreationRequest<TQuote, TItem>;
  execute: QuoteCreationExecutor<TQuote, TItem, TResult>;
}): Promise<TResult> {
  const source = requireText(
    args.system?.source,
    "QUOTE_CREATION_SYSTEM_SOURCE_REQUIRED",
  );

  if (args.system?.kind !== "system") {
    throw new Error("QUOTE_CREATION_SYSTEM_CONTEXT_INVALID");
  }

  return executeQuoteCreation({
    actor: { kind: "system", source },
    request: args.request,
    execute: args.execute,
  });
}
