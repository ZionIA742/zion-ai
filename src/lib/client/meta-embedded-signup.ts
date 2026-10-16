export type FacebookLoginResponse = {
  authResponse?: {
    code?: unknown;
  } | null;
  status?: string;
};

export type FacebookSdk = {
  init: (options: {
    appId: string;
    version: string;
    cookie?: boolean;
    xfbml?: boolean;
  }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        version: "v4";
        featureType: "whatsapp_business_app_onboarding";
        sessionInfoVersion: "3";
      };
    },
  ) => void;
};

export type MetaEmbeddedSignupSession = {
  whatsappBusinessAccountId: string;
  phoneNumberId?: string;
  connectionMode: "standard" | "business_app_coexistence";
};

export type MetaEmbeddedSignupFlowCoordinator = {
  acceptOAuthCode: (code: unknown) => boolean;
  acceptMessage: (event: Pick<MessageEvent, "origin" | "data">) => MetaEmbeddedSignupMessageDiagnostic | "target_rejected";
  canSubmit: () => boolean;
  markSubmitting: () => boolean;
  close: () => void;
  getSnapshot: () => { status: "authorizing" | "submitting" | "closed"; code: string; session: MetaEmbeddedSignupSession | null };
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk";
const FACEBOOK_SDK_SRC = "https://connect.facebook.net/pt_BR/sdk.js";
const DEFAULT_FACEBOOK_GRAPH_API_VERSION = "v23.0";
const META_EMBEDDED_SIGNUP_MESSAGE_TYPE = "WA_EMBEDDED_SIGNUP";
const META_EMBEDDED_SIGNUP_ALLOWED_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
]);
let facebookSdkLoadPromise: Promise<void> | null = null;

export type MetaEmbeddedSignupMessageDiagnostic =
  | "origin_rejected"
  | "ignored_message"
  | "other_event"
  | "cancelled"
  | "finish_missing_context"
  | "finish_missing_ids"
  | "finish_valid";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getFacebookGraphApiVersion() {
  const configuredVersion = cleanText(process.env.NEXT_PUBLIC_WHATSAPP_GRAPH_API_VERSION);
  return /^v\d+\.\d+$/.test(configuredVersion)
    ? configuredVersion
    : DEFAULT_FACEBOOK_GRAPH_API_VERSION;
}

const FACEBOOK_GRAPH_API_VERSION = getFacebookGraphApiVersion();

export function getMetaEmbeddedSignupConfig() {
  return {
    appId: cleanText(process.env.NEXT_PUBLIC_META_APP_ID),
    configId: cleanText(process.env.NEXT_PUBLIC_META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID),
  };
}

function normalizeMetaIdentifier(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[0-9]{6,32}$/.test(normalized) ? normalized : "";
}

export function isAllowedMetaEmbeddedSignupOrigin(origin: string) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    return url.protocol === "https:" && META_EMBEDDED_SIGNUP_ALLOWED_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

function parseMessageData(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

export function classifyMetaEmbeddedSignupMessage(
  event: Pick<MessageEvent, "origin" | "data">,
): MetaEmbeddedSignupMessageDiagnostic {
  if (!isAllowedMetaEmbeddedSignupOrigin(event.origin)) return "origin_rejected";

  const payload = parseMessageData(event.data);
  if (!payload || payload.type !== META_EMBEDDED_SIGNUP_MESSAGE_TYPE) return "ignored_message";

  const eventName = cleanText(payload.event).toUpperCase();
  if (eventName === "CANCEL" || eventName === "CANCELLED") return "cancelled";
  if (eventName !== "FINISH" && eventName !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    return "other_event";
  }

  const payloadData =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};
  const wabaId =
    normalizeMetaIdentifier(payloadData.whatsapp_business_account_id) ||
    normalizeMetaIdentifier(payloadData.waba_id) ||
    normalizeMetaIdentifier(payload.whatsapp_business_account_id) ||
    normalizeMetaIdentifier(payload.waba_id);
  const phoneNumberId =
    normalizeMetaIdentifier(payloadData.phone_number_id) ||
    normalizeMetaIdentifier(payloadData.phoneNumberId) ||
    normalizeMetaIdentifier(payload.phone_number_id);

  if (!wabaId && !phoneNumberId) return "finish_missing_context";
  if (!wabaId || (eventName === "FINISH" && !phoneNumberId)) return "finish_missing_ids";
  return "finish_valid";
}

export function extractMetaEmbeddedSignupSession(
  event: Pick<MessageEvent, "origin" | "data">,
): MetaEmbeddedSignupSession | null {
  if (!isAllowedMetaEmbeddedSignupOrigin(event.origin)) return null;

  const payload = parseMessageData(event.data);
  if (!payload || payload.type !== META_EMBEDDED_SIGNUP_MESSAGE_TYPE) return null;

  const eventName = cleanText(payload.event).toUpperCase();
  const connectionMode =
    eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ? "business_app_coexistence"
      : eventName === "FINISH"
        ? "standard"
        : null;
  if (!connectionMode) return null;

  const payloadData =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};

  const whatsappBusinessAccountId =
    normalizeMetaIdentifier(payloadData.whatsapp_business_account_id) ||
    normalizeMetaIdentifier(payloadData.waba_id) ||
    normalizeMetaIdentifier(payload.whatsapp_business_account_id) ||
    normalizeMetaIdentifier(payload.waba_id);
  const phoneNumberId =
    normalizeMetaIdentifier(payloadData.phone_number_id) ||
    normalizeMetaIdentifier(payloadData.phoneNumberId) ||
    normalizeMetaIdentifier(payload.phone_number_id);

  if (!whatsappBusinessAccountId) return null;
  if (connectionMode === "standard" && !phoneNumberId) return null;

  return {
    whatsappBusinessAccountId,
    ...(phoneNumberId ? { phoneNumberId } : {}),
    connectionMode,
  };
}

export function isMetaEmbeddedSignupCancellation(
  event: Pick<MessageEvent, "origin" | "data">,
) {
  if (!isAllowedMetaEmbeddedSignupOrigin(event.origin)) return false;

  const payload = parseMessageData(event.data);
  if (!payload || payload.type !== META_EMBEDDED_SIGNUP_MESSAGE_TYPE) return false;

  const eventName = cleanText(payload.event).toUpperCase();
  return eventName === "CANCEL" || eventName === "CANCELLED";
}

export function createMetaEmbeddedSignupFlowCoordinator(args: {
  wabaId: string;
  phoneNumberId: string;
}): MetaEmbeddedSignupFlowCoordinator {
  let status: "authorizing" | "submitting" | "closed" = "authorizing";
  let code = "";
  let session: MetaEmbeddedSignupSession | null = null;

  return {
    acceptOAuthCode(value) {
      if (status !== "authorizing") return false;
      const normalized = cleanText(value);
      if (!normalized) return false;
      code = normalized;
      return true;
    },
    acceptMessage(event) {
      if (status !== "authorizing") return "ignored_message";
      const diagnostic = classifyMetaEmbeddedSignupMessage(event);
      if (diagnostic !== "finish_valid") {
        if (diagnostic === "cancelled") status = "closed";
        return diagnostic;
      }

      const candidate = extractMetaEmbeddedSignupSession(event);
      if (
        !candidate ||
        candidate.whatsappBusinessAccountId !== args.wabaId ||
        candidate.phoneNumberId !== args.phoneNumberId
      ) {
        return "target_rejected";
      }

      session = candidate;
      return "finish_valid";
    },
    canSubmit() {
      return status === "authorizing" && Boolean(code && session);
    },
    markSubmitting() {
      if (status !== "authorizing" || !code || !session) return false;
      status = "submitting";
      return true;
    },
    close() {
      status = "closed";
    },
    getSnapshot() {
      return { status, code, session };
    },
  };
}

export function isMetaEmbeddedSignupFlowActive(args: {
  expectedFlowId: number;
  currentFlowId: number | null | undefined;
  status: "authorizing" | "submitting" | "closed" | null | undefined;
}) {
  return args.currentFlowId === args.expectedFlowId && args.status === "authorizing";
}

export function ensureFacebookSdkLoaded(appId: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("FACEBOOK_SDK_BROWSER_UNAVAILABLE"));
  }

  if (!appId) return Promise.reject(new Error("FACEBOOK_SDK_APP_ID_MISSING"));

  if (window.FB) {
    window.FB.init({
      appId,
      version: FACEBOOK_GRAPH_API_VERSION,
      cookie: true,
      xfbml: false,
    });
    return Promise.resolve();
  }

  if (facebookSdkLoadPromise) return facebookSdkLoadPromise;

  facebookSdkLoadPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(FACEBOOK_SDK_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript || document.createElement("script");
    const previousFbAsyncInit = window.fbAsyncInit;
    let settled = false;
    let timeoutId: number | null = null;

    const cleanup = () => {
      script.removeEventListener("load", handleScriptLoad);
      script.removeEventListener("error", handleScriptError);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (window.fbAsyncInit === handleFacebookSdkReady) window.fbAsyncInit = previousFbAsyncInit;
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      facebookSdkLoadPromise = null;
      if (!window.FB && script.parentNode) script.parentNode.removeChild(script);
      reject(new Error(message));
    };

    const handleFacebookSdkReady = () => {
      if (!window.FB) {
        fail("FACEBOOK_SDK_UNAVAILABLE");
        return;
      }

      if (settled) return;
      try {
        window.FB.init({
          appId,
          version: FACEBOOK_GRAPH_API_VERSION,
          cookie: true,
          xfbml: false,
        });
        settled = true;
        cleanup();
        resolve();
      } catch {
        fail("FACEBOOK_SDK_INIT_FAILED");
      }
    };

    const handleScriptLoad = () => handleFacebookSdkReady();
    const handleScriptError = () => fail("FACEBOOK_SDK_LOAD_FAILED");

    window.fbAsyncInit = handleFacebookSdkReady;
    script.addEventListener("load", handleScriptLoad, { once: true });
    script.addEventListener("error", handleScriptError, { once: true });
    timeoutId = window.setTimeout(() => fail("FACEBOOK_SDK_UNAVAILABLE"), 10000);

    if (!existingScript) {
      script.id = FACEBOOK_SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = FACEBOOK_SDK_SRC;
      document.body.appendChild(script);
    } else if (["complete", "loaded"].includes((script as HTMLScriptElement & { readyState?: string }).readyState || "")) {
      handleFacebookSdkReady();
    }
  });

  return facebookSdkLoadPromise;
}
