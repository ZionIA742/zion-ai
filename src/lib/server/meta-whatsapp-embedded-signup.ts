export type MetaWhatsappEmbeddedSignupConfig = {
  graphApiVersion: string;
  appId: string;
  appSecret: string;
};

export type MetaWhatsappEmbeddedSignupValidationInput = {
  code: string;
  whatsappBusinessAccountId: string;
  phoneNumberId?: string;
  connectionMode?: MetaWhatsappEmbeddedSignupConnectionMode;
  twoStepPin: string;
};

export type MetaWhatsappEmbeddedSignupConnectionMode =
  | "standard"
  | "business_app_coexistence";

export type MetaWhatsappEmbeddedSignupValidationResult = {
  accessToken: string;
  whatsappBusinessAccountId: string;
  phoneNumberId: string;
  connectionMode: MetaWhatsappEmbeddedSignupConnectionMode;
  displayPhoneNumber: string;
  graphApiVersion: string;
  appId: string;
  validatedAt: string;
};

export type MetaWhatsappBindingValidationInput = {
  code: string;
  whatsappBusinessAccountId: string;
  phoneNumberId?: string;
  connectionMode?: MetaWhatsappEmbeddedSignupConnectionMode;
};

export type MetaWhatsappEmbeddedSignupDeps = {
  fetch: typeof fetch;
  createAbortController: () => AbortController;
  now: () => Date;
  timeoutMs: number;
};

type MetaJson = Record<string, unknown>;

export type MetaWhatsappErrorEvidence = {
  httpStatus: number;
  metaCode: string | null;
  metaSubcode: string | null;
  metaType: string | null;
  operation: string;
  normalizedCode: string;
};

export class MetaWhatsappEmbeddedSignupError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly evidence: MetaWhatsappErrorEvidence;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    evidence?: Partial<MetaWhatsappErrorEvidence>,
  ) {
    super(message);
    this.name = "MetaWhatsappEmbeddedSignupError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.evidence = {
      httpStatus: evidence?.httpStatus ?? httpStatus,
      metaCode: evidence?.metaCode ?? null,
      metaSubcode: evidence?.metaSubcode ?? null,
      metaType: evidence?.metaType ?? null,
      operation: evidence?.operation ?? "unknown",
      normalizedCode: evidence?.normalizedCode ?? code,
    };
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

function cleanText(value: string | null | undefined) {
  return (value || "").trim();
}

function normalizeMetaId(value: string | null | undefined) {
  return cleanText(value);
}

function createDefaultAbortController() {
  return new AbortController();
}

export function getMetaWhatsappEmbeddedSignupConfig(
  env: NodeJS.ProcessEnv = process.env,
): MetaWhatsappEmbeddedSignupConfig {
  return {
    graphApiVersion: cleanText(env.WHATSAPP_GRAPH_API_VERSION),
    appId: cleanText(env.META_APP_ID),
    appSecret: cleanText(env.META_APP_SECRET),
  };
}

function assertConfig(config: MetaWhatsappEmbeddedSignupConfig) {
  if (!config.graphApiVersion) {
    throw new MetaWhatsappEmbeddedSignupError(
      "WHATSAPP_GRAPH_API_VERSION_NOT_CONFIGURED",
      "Versao da Graph API nao configurada no servidor.",
      500,
    );
  }

  if (!config.appId) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_APP_ID_NOT_CONFIGURED",
      "Meta App ID nao configurado no servidor.",
      500,
    );
  }

  if (!config.appSecret) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_APP_SECRET_NOT_CONFIGURED",
      "Meta App Secret nao configurado no servidor.",
      500,
    );
  }
}

function graphBaseUrl(graphApiVersion: string) {
  return `https://graph.facebook.com/${encodeURIComponent(graphApiVersion)}`;
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  deps: MetaWhatsappEmbeddedSignupDeps,
  operation: string,
) {
  const controller = deps.createAbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);

  try {
    const response = await deps.fetch(url, {
      ...init,
      signal: controller.signal,
    });

    let body: MetaJson | null = null;
    try {
      body = (await response.json()) as MetaJson;
    } catch {
      body = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new MetaWhatsappEmbeddedSignupError(
        "META_REQUEST_TIMEOUT",
        "A Meta nao respondeu a tempo.",
        502,
        { operation },
      );
    }

    throw new MetaWhatsappEmbeddedSignupError(
      "META_REQUEST_FAILED",
      "Falha ao comunicar com a Meta.",
      502,
      { operation },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function requireMetaOk(
  response: { ok: boolean; status: number; body: MetaJson | null },
  code: string,
  message: string,
  operation: string,
) {
  if (response.ok) return;

  const metaError =
    response.body?.error &&
    typeof response.body.error === "object" &&
    !Array.isArray(response.body.error)
      ? (response.body.error as Record<string, unknown>)
      : null;
  const safeMetaValue = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : null;
  const evidence = {
    httpStatus: response.status,
    metaCode: safeMetaValue(metaError?.code),
    metaSubcode: safeMetaValue(metaError?.error_subcode),
    metaType: safeMetaValue(metaError?.type),
    operation,
    normalizedCode: code,
  } satisfies MetaWhatsappErrorEvidence;

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new MetaWhatsappEmbeddedSignupError(
      code,
      message,
      code === "META_CODE_EXCHANGE_FAILED" ? 400 : 422,
      evidence,
    );
  }

  throw new MetaWhatsappEmbeddedSignupError(
    "META_UNAVAILABLE",
    "A Meta nao conseguiu concluir a validacao agora.",
    502,
    { ...evidence, normalizedCode: "META_UNAVAILABLE" },
  );
}

async function exchangeCodeForAccessToken(params: {
  code: string;
  config: MetaWhatsappEmbeddedSignupConfig;
  deps: MetaWhatsappEmbeddedSignupDeps;
}) {
  const body = new URLSearchParams();
  body.set("client_id", params.config.appId);
  body.set("client_secret", params.config.appSecret);
  body.set("code", params.code);

  const response = await fetchJsonWithTimeout(
    `${graphBaseUrl(params.config.graphApiVersion)}/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    },
    params.deps,
    "exchange_code",
  );

  requireMetaOk(
    response,
    "META_CODE_EXCHANGE_FAILED",
    "Nao foi possivel trocar o codigo de autorizacao da Meta.",
    "exchange_code",
  );

  const accessToken =
    typeof response.body?.access_token === "string"
      ? cleanText(response.body.access_token)
      : "";
  if (!accessToken) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_CODE_EXCHANGE_MALFORMED",
      "A Meta nao retornou um token de acesso valido.",
      502,
    );
  }

  return accessToken;
}

async function getMetaObject(params: {
  graphApiVersion: string;
  objectId: string;
  fields: string;
  accessToken: string;
  deps: MetaWhatsappEmbeddedSignupDeps;
}) {
  const url = new URL(`${graphBaseUrl(params.graphApiVersion)}/${encodeURIComponent(params.objectId)}`);
  url.searchParams.set("fields", params.fields);

  return fetchJsonWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
    params.deps,
    "get_waba",
  );
}

async function listWabaPhoneNumbers(params: {
  graphApiVersion: string;
  whatsappBusinessAccountId: string;
  accessToken: string;
  deps: MetaWhatsappEmbeddedSignupDeps;
}) {
  const url = new URL(
    `${graphBaseUrl(params.graphApiVersion)}/${encodeURIComponent(
      params.whatsappBusinessAccountId,
    )}/phone_numbers`,
  );
  url.searchParams.set("fields", "id,display_phone_number");
  url.searchParams.set("limit", "100");

  return fetchJsonWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
    params.deps,
    "list_phone_numbers",
  );
}

async function subscribeWabaApps(params: {
  graphApiVersion: string;
  whatsappBusinessAccountId: string;
  accessToken: string;
  deps: MetaWhatsappEmbeddedSignupDeps;
}) {
  return fetchJsonWithTimeout(
    `${graphBaseUrl(params.graphApiVersion)}/${encodeURIComponent(
      params.whatsappBusinessAccountId,
    )}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
    params.deps,
    "subscribe_waba_apps",
  );
}

async function registerPhoneNumber(params: {
  graphApiVersion: string;
  phoneNumberId: string;
  twoStepPin: string;
  accessToken: string;
  deps: MetaWhatsappEmbeddedSignupDeps;
}) {
  return fetchJsonWithTimeout(
    `${graphBaseUrl(params.graphApiVersion)}/${encodeURIComponent(
      params.phoneNumberId,
    )}/register`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: params.twoStepPin,
      }),
    },
    params.deps,
    "register_phone_number",
  );
}

export async function registerMetaWhatsappEmbeddedSignup(
  validated: MetaWhatsappEmbeddedSignupValidationResult,
  twoStepPin: string,
  options?: {
    config?: MetaWhatsappEmbeddedSignupConfig;
    deps?: Partial<MetaWhatsappEmbeddedSignupDeps>;
  },
): Promise<void> {
  if (
    validated.connectionMode !== "business_app_coexistence" &&
    !/^[0-9]{6}$/.test(twoStepPin)
  ) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_EMBEDDED_SIGNUP_INPUT_INVALID",
      "Payload do Embedded Signup incompleto.",
      400,
    );
  }

  const deps: MetaWhatsappEmbeddedSignupDeps = {
    fetch: options?.deps?.fetch ?? fetch,
    createAbortController:
      options?.deps?.createAbortController ?? createDefaultAbortController,
    now: options?.deps?.now ?? (() => new Date()),
    timeoutMs: options?.deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  const subscribeResponse = await subscribeWabaApps({
    graphApiVersion: validated.graphApiVersion,
    whatsappBusinessAccountId: validated.whatsappBusinessAccountId,
    accessToken: validated.accessToken,
    deps,
  });

  requireMetaOk(
    subscribeResponse,
    "META_SUBSCRIBED_APPS_FAILED",
    "Nao foi possivel ativar os webhooks da Meta. Reinicie o Embedded Signup.",
    "subscribe_waba_apps",
  );

  if (validated.connectionMode === "business_app_coexistence") return;

  const registerResponse = await registerPhoneNumber({
    graphApiVersion: validated.graphApiVersion,
    phoneNumberId: validated.phoneNumberId,
    twoStepPin,
    accessToken: validated.accessToken,
    deps,
  });

  requireMetaOk(
    registerResponse,
    "META_PHONE_REGISTER_FAILED",
    "Nao foi possivel registrar o telefone na Meta. Reinicie o Embedded Signup.",
    "register_phone_number",
  );
}

function findPhoneInList(body: MetaJson | null, phoneNumberId: string) {
  const rows = Array.isArray(body?.data) ? body?.data : [];
  return rows.find((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const id = (row as Record<string, unknown>).id;
    return typeof id === "string" && normalizeMetaId(id) === phoneNumberId;
  }) as Record<string, unknown> | undefined;
}

export async function exchangeAndValidateMetaWhatsappBinding(
  input: MetaWhatsappBindingValidationInput,
  options?: {
    config?: MetaWhatsappEmbeddedSignupConfig;
    deps?: Partial<MetaWhatsappEmbeddedSignupDeps>;
  },
): Promise<MetaWhatsappEmbeddedSignupValidationResult> {
  const config = options?.config ?? getMetaWhatsappEmbeddedSignupConfig();
  assertConfig(config);

  const deps: MetaWhatsappEmbeddedSignupDeps = {
    fetch: options?.deps?.fetch ?? fetch,
    createAbortController:
      options?.deps?.createAbortController ?? createDefaultAbortController,
    now: options?.deps?.now ?? (() => new Date()),
    timeoutMs: options?.deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  const code = cleanText(input.code);
  const expectedWabaId = normalizeMetaId(input.whatsappBusinessAccountId);
  const expectedPhoneId = normalizeMetaId(input.phoneNumberId);
  const connectionMode = input.connectionMode ?? "standard";
  if (
    !code ||
    !expectedWabaId ||
    (connectionMode === "standard" && !expectedPhoneId)
  ) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_EMBEDDED_SIGNUP_INPUT_INVALID",
      "Payload do Embedded Signup incompleto.",
      400,
    );
  }

  const accessToken = await exchangeCodeForAccessToken({
    code,
    config,
    deps,
  });

  const wabaResponse = await getMetaObject({
    graphApiVersion: config.graphApiVersion,
    objectId: expectedWabaId,
    fields: "id",
    accessToken,
    deps,
  });

  requireMetaOk(
    wabaResponse,
    "META_WABA_VALIDATION_FAILED",
    "Nao foi possivel validar a conta WhatsApp Business na Meta.",
    "get_waba",
  );

  const confirmedWabaId =
    typeof wabaResponse.body?.id === "string"
      ? normalizeMetaId(wabaResponse.body.id)
      : "";
  if (confirmedWabaId !== expectedWabaId) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_WABA_VALIDATION_FAILED",
      "A conta WhatsApp Business validada nao corresponde ao Embedded Signup.",
      422,
    );
  }

  const phoneListResponse = await listWabaPhoneNumbers({
    graphApiVersion: config.graphApiVersion,
    whatsappBusinessAccountId: confirmedWabaId,
    accessToken,
    deps,
  });

  requireMetaOk(
    phoneListResponse,
    "META_PHONE_WABA_VALIDATION_FAILED",
    "Nao foi possivel confirmar a relacao entre telefone e WABA na Meta.",
    "list_phone_numbers",
  );

  const phoneRows = Array.isArray(phoneListResponse.body?.data)
    ? phoneListResponse.body.data
    : [];
  const listedPhone = expectedPhoneId
    ? findPhoneInList(phoneListResponse.body, expectedPhoneId)
    : connectionMode === "business_app_coexistence" && phoneRows.length === 1
      ? (phoneRows[0] as Record<string, unknown>)
      : undefined;
  if (!listedPhone) {
    throw new MetaWhatsappEmbeddedSignupError(
      expectedPhoneId ? "META_PHONE_WABA_MISMATCH" : "META_PHONE_DISCOVERY_AMBIGUOUS",
      expectedPhoneId
        ? "O telefone validado nao pertence a conta WhatsApp Business informada."
        : "A Meta retornou mais de um telefone e o Embedded Signup nao identificou qual deve ser conectado.",
      422,
    );
  }

  const listedPhoneId =
    typeof listedPhone.id === "string" ? normalizeMetaId(listedPhone.id) : "";
  if (!listedPhoneId || (expectedPhoneId && listedPhoneId !== expectedPhoneId)) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_PHONE_WABA_MISMATCH",
      "O telefone validado nao pertence a conta WhatsApp Business informada.",
      422,
    );
  }

  const displayPhoneNumber =
    typeof listedPhone.display_phone_number === "string"
      ? cleanText(listedPhone.display_phone_number)
      : "";
  if (!displayPhoneNumber) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_PHONE_DISPLAY_MISSING",
      "A Meta nao retornou o telefone de exibicao.",
      422,
    );
  }

  return {
    accessToken,
    whatsappBusinessAccountId: confirmedWabaId,
    phoneNumberId: listedPhoneId,
    connectionMode,
    displayPhoneNumber,
    graphApiVersion: config.graphApiVersion,
    appId: config.appId,
    validatedAt: deps.now().toISOString(),
  };
}

export async function exchangeAndValidateMetaWhatsappEmbeddedSignup(
  input: MetaWhatsappEmbeddedSignupValidationInput,
  options?: {
    config?: MetaWhatsappEmbeddedSignupConfig;
    deps?: Partial<MetaWhatsappEmbeddedSignupDeps>;
  },
): Promise<MetaWhatsappEmbeddedSignupValidationResult> {
  const twoStepPin = input.twoStepPin;
  if (!/^[0-9]{6}$/.test(twoStepPin)) {
    throw new MetaWhatsappEmbeddedSignupError(
      "META_EMBEDDED_SIGNUP_INPUT_INVALID",
      "Payload do Embedded Signup incompleto.",
      400,
    );
  }

  const validated = await exchangeAndValidateMetaWhatsappBinding(
    {
      code: input.code,
      whatsappBusinessAccountId: input.whatsappBusinessAccountId,
      phoneNumberId: input.phoneNumberId,
      connectionMode: input.connectionMode,
    },
    options,
  );

  await registerMetaWhatsappEmbeddedSignup(validated, twoStepPin, options);

  return validated;
}
