import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useRef,
} from "react";
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createJiti } from "jiti";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});
Object.assign(globalThis, { React });

type StoreContextValue = {
  activeStore: { id: string; name: string } | null;
  organizationId: string | null;
  loading: boolean;
  refreshStores: () => Promise<void>;
};

const storeContext = createContext<StoreContextValue>({
  activeStore: null,
  organizationId: null,
  loading: false,
  refreshStores: async () => undefined,
});

const statusDeferreds = new Map<string, { resolve: (value: Response) => void }>();
const statusRequestCounts = new Map<string, number>();
const saveStrategyResolvers: Array<() => void> = [];
const activationResolvers: Array<() => void> = [];
let embeddedSignupResponseBody: unknown = { ok: true };
let deferEmbeddedSignupResponse = false;
const embeddedSignupResponseResolvers: Array<(value: Response) => void> = [];
const embeddedSignupPosts: Array<Record<string, unknown>> = [];
const facebookLoginCallbacks: Array<(value: { authResponse?: { code?: string } }) => void> = [];
const messageListeners = new Set<(event: { origin: string; data: unknown }) => void>();
let whatsappStatusRequestCount = 0;
type TestSession = {
  phoneNumberId?: string;
  whatsappBusinessAccountId: string;
  connectionMode: "standard" | "business_app_coexistence";
};
type TestFlow = {
  acceptOAuthCode: (value: unknown) => boolean;
  acceptMessage: (event: { origin: string; data: unknown }) => string;
  canSubmit: () => boolean;
  markSubmitting: () => boolean;
  close: () => void;
  getSnapshot: () => { status: string; code: string; session: TestSession | null };
};
let lastTestFlow: TestFlow | null = null;
let markSubmittingCount = 0;
let searchStep: string | null = "4";

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function mockedFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url.includes("/api/store/whatsapp/embedded-signup")) {
    embeddedSignupPosts.push({});
    if (deferEmbeddedSignupResponse) {
      return new Promise<Response>((resolve) => {
        embeddedSignupResponseResolvers.push(resolve);
      });
    }
    return Promise.resolve(response(embeddedSignupResponseBody));
  }
  if (url.includes("/api/store/whatsapp/status")) {
    whatsappStatusRequestCount += 1;
    const storeId = new URL(url, "http://localhost").searchParams.get("storeId") || "";
    if (storeId === "store-normal" && (statusRequestCounts.get(storeId) || 0) >= 1) {
      return Promise.resolve(response({
        ok: true,
        connected: true,
        isActive: true,
        status: "active",
        phoneNumberId: "phone-normal",
        whatsappBusinessAccountId: "waba-normal",
        displayPhoneNumber: "+55 11 98888-1111",
      }));
    }
    statusRequestCounts.set(storeId, (statusRequestCounts.get(storeId) || 0) + 1);
    return new Promise<Response>((resolve) => {
      statusDeferreds.set(storeId, { resolve });
    });
  }
  if (url.includes("/api/store/primary-responsible")) {
    return Promise.resolve(response({ ok: true, responsible: null }));
  }
  if (url.includes("/api/store/readiness")) {
    return Promise.resolve(response({
      ok: true,
      capabilities_by_key: { onboarding_activation: { state: "ready" } },
    }));
  }
  return Promise.resolve(response({ ok: true }));
}

globalThis.fetch = mockedFetch as typeof fetch;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    setTimeout,
    clearTimeout,
    addEventListener(type: string, listener: (event: { origin: string; data: unknown }) => void) {
      if (type === "message") messageListeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: { origin: string; data: unknown }) => void) {
      if (type === "message") messageListeners.delete(listener);
    },
    scrollTo() {},
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    FB: {
      login(callback: (value: { authResponse?: { code?: string } }) => void) {
        facebookLoginCallbacks.push(callback);
      },
    },
  },
});

function dispatchMetaMessage(data: unknown) {
  for (const listener of messageListeners) {
    listener({ origin: "https://www.facebook.com", data });
  }
}

function resolveStatus(storeId: string, body: unknown) {
  const deferred = statusDeferreds.get(storeId);
  assert.ok(deferred, `status pendente ausente para ${storeId}`);
  deferred.resolve(response(body));
}

const mockedSupabase = {
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  rpc: async (name: string) => {
    if (name === "onboarding_get_store_onboarding_scoped") {
      return { data: { status: "in_progress" }, error: null };
    }
    if (name === "onboarding_get_answers_scoped") {
      return { data: {}, error: null };
    }
    if (name === "upsert_store_strategy_settings_with_legacy_mirror_scoped") {
      return new Promise((resolve) => {
        saveStrategyResolvers.push(() => resolve({ data: null, error: null }));
      });
    }
    if (name === "onboarding_complete_store_onboarding_scoped") {
      return new Promise((resolve) => {
        activationResolvers.push(() => resolve({ data: { status: "completed" }, error: null }));
      });
    }
    return { data: null, error: null };
  },
  from: () => {
    const query = {
      select() { return query; },
      eq() { return query; },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  },
};

function mockedModule(request: string) {
  const normalizedRequest = request.replaceAll("\\", "/");
  if (normalizedRequest === "next/navigation") {
    return {
      useRouter: () => ({ replace() {} }),
      useSearchParams: () => new URLSearchParams(searchStep ? `step=${searchStep}` : ""),
    };
  }
  if (normalizedRequest.includes("components/OrgGuard")) {
    return { default: ({ children }: { children: ReactNode }) => children };
  }
  if (normalizedRequest.includes("components/StoreProvider")) {
    return {
      StoreProvider: ({ children }: { children: ReactNode }) => children,
      useStoreContext: () => useContext(storeContext),
    };
  }
  if (normalizedRequest.includes("supabaseBrowser")) return { supabase: mockedSupabase };
  if (normalizedRequest.includes("store-strategy-settings")) {
    return {
      createStoreStrategySettingsInputFromSources: () => ({
        city: "", state: "", serviceRegions: [], serviceRegionModes: [],
        serviceRegionPrimaryMode: null, serviceRegionOutsideConsultation: false,
        serviceRegionNotes: "", storeServices: [], storeServicesOther: "",
        storeDescription: "", mainStoreBrand: "", brandsWorked: [],
        strategyServiceExclusions: [], strategyPrimaryFocus: "",
        strategySellMore: "", strategyCommonCustomer: "", strategyIdealCustomer: "",
        strategyTicketRange: "", strategyPositioning: "", strategyPriorityBrands: [],
        strategyNonWorkedBrands: [], strategyTopLines: [], strategyTopProducts: [],
        strategyDifferentials: [], strategyPromiseLimits: "", strategyAiPresentation: "",
        strategyAiPriorities: "", strategyAiNeverForget: "",
      }),
      normalizeStoreStrategySettingsInput: (value: unknown) => ({ value }),
    };
  }
  if (normalizedRequest.includes("use-meta-embedded-signup-attempt")) {
    return {
      useMetaEmbeddedSignupAttempt: () => {
        const mountedRef = useRef(true);
        const attemptIdRef = useRef(0);
        const flowRef = useRef<TestFlow | null>(null);
        const beginAttempt = (mode: "standard" | "business_app_coexistence") => {
          attemptIdRef.current += 1;
          let status = "authorizing";
          let code = "";
          let session: TestSession | null = null;
          flowRef.current = {
            acceptOAuthCode(value: unknown) { code = typeof value === "string" ? value : ""; return Boolean(code); },
            acceptMessage(event: { origin: string; data: unknown }) {
              const payload = event.data && typeof event.data === "object" && !Array.isArray(event.data)
                ? event.data as { type?: unknown; data?: Record<string, unknown> }
                : {};
              const data = payload.data || {};
              if (event.origin !== "https://www.facebook.com") return "origin_rejected";
              if (payload.type !== "WA_EMBEDDED_SIGNUP") return "ignored_message";
              const eventName = String((payload as { event?: unknown }).event || "");
              if (eventName === "CANCEL" || eventName === "CANCELLED") return "cancelled";
              if (eventName !== "FINISH" && eventName !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return "other_event";
              const phoneNumberId = String(data.phone_number_id || "");
              const whatsappBusinessAccountId = String(data.waba_id || data.whatsapp_business_account_id || "");
              const nextMode = eventName === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
                ? "business_app_coexistence"
                : "standard";
              if (!whatsappBusinessAccountId || (nextMode === "standard" && !phoneNumberId)) return "finish_missing_ids";
              session = {
                ...(phoneNumberId ? { phoneNumberId } : {}),
                whatsappBusinessAccountId,
                connectionMode: nextMode,
              };
              return nextMode === mode ? "finish_valid" : "target_rejected";
            },
            canSubmit() { return Boolean(code && session); },
            markSubmitting() { markSubmittingCount += 1; status = "submitting"; return true; },
            close() { status = "closed"; },
            getSnapshot() { return { status, code, session }; },
          };
          lastTestFlow = flowRef.current;
          return attemptIdRef.current;
        };
        const closeAttempt = (attemptId: number) => {
          if (attemptIdRef.current === attemptId) flowRef.current?.close();
        };
        return {
          mountedRef,
          attemptIdRef,
          flowRef,
          beginAttempt,
          closeAttempt,
          clearTimeout() {},
          startTimeout() {},
          isAttemptActive: (attemptId: number) => Boolean(mountedRef.current && attemptIdRef.current === attemptId && flowRef.current?.getSnapshot().status === "authorizing"),
          isAttemptCurrent: (attemptId: number) => Boolean(mountedRef.current && attemptIdRef.current === attemptId && flowRef.current?.getSnapshot().status !== "closed"),
        };
      },
    };
  }
  if (normalizedRequest.includes("/meta-embedded-signup") && !normalizedRequest.includes("use-meta-embedded-signup-attempt")) {
    return {
      ensureFacebookSdkLoaded: async () => undefined,
      getMetaEmbeddedSignupConfig: () => ({ appId: "app-test", configId: "config-test" }),
      createMetaEmbeddedSignupFlowCoordinator: ({ connectionMode }: { connectionMode: "standard" | "business_app_coexistence" }) => {
        let status: "authorizing" | "submitting" | "closed" = "authorizing";
        let code = "";
        let session: { whatsappBusinessAccountId: string; phoneNumberId?: string; connectionMode: "standard" | "business_app_coexistence" } | null = null;
        return {
          acceptOAuthCode(value: unknown) {
            code = typeof value === "string" ? value : "";
            return Boolean(code);
          },
          acceptMessage(event: { origin: string; data: unknown }) {
            if (event.origin !== "https://www.facebook.com") return "origin_rejected";
            const payload = event.data as { type?: string; event?: string; data?: Record<string, unknown> };
            if (payload?.type !== "WA_EMBEDDED_SIGNUP") return "ignored_message";
            if (payload.event === "CANCEL") return "cancelled";
            const data = payload.data || {};
            const waba = String(data.waba_id || data.whatsapp_business_account_id || "");
            const phone = String(data.phone_number_id || "");
            if (!waba || (payload.event === "FINISH" && !phone)) return "finish_missing_ids";
            session = {
              whatsappBusinessAccountId: waba,
              ...(phone ? { phoneNumberId: phone } : {}),
              connectionMode: payload.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
                ? "business_app_coexistence"
                : "standard",
            };
            return session.connectionMode === connectionMode ? "finish_valid" : "target_rejected";
          },
          canSubmit() { return Boolean(code && session); },
          markSubmitting() { markSubmittingCount += 1; status = "submitting"; return true; },
          close() { status = "closed"; },
          getSnapshot() { return { status, code, session }; },
        };
      },
    };
  }
  if (normalizedRequest.includes("use-meta-embedded-signup-attempt")) {
    return {
      useMetaEmbeddedSignupAttempt: () => ({
        mountedRef: { current: true }, attemptIdRef: { current: 0 }, flowRef: { current: null },
        beginAttempt: () => 1, closeAttempt() {}, clearTimeout() {}, startTimeout() {},
        isAttemptActive: () => false, isAttemptCurrent: () => false,
      }),
    };
  }
  if (normalizedRequest.includes("embedded-signup-recovery")) {
    return {
      EMBEDDED_SIGNUP_SUBMISSION_TIMEOUT_MS: 30_000,
      enrichEmbeddedSignupSessionWithBackendIdentity: (session: unknown) => session,
      isEmbeddedSignupStatusForSession: () => true,
      isEmbeddedSignupResponseUncertain: () => false,
      recoverEmbeddedSignupStatus: async () => ({ outcome: "absent" }),
    };
  }
  if (normalizedRequest.includes("whatsapp-display")) {
    return { formatOfficialWhatsappDisplay: (value: string | null | undefined) => value || "" };
  }
  return null;
}

const pagePath = resolve("src/app/onboarding/page.tsx");
const jiti = createJiti(pagePath, { alias: { "@": resolve("src") }, jsx: true });
const nativeRequire = createRequire(import.meta.url);
for (const request of [
  "next/navigation",
  "../../components/OrgGuard",
  "../../components/StoreProvider",
  "@/lib/supabaseBrowser",
  "@/lib/store-strategy-settings",
  "@/lib/client/meta-embedded-signup",
  "@/lib/client/use-meta-embedded-signup-attempt",
  "@/lib/client/embedded-signup-recovery",
  "./whatsapp-display",
]) {
  const resolved = jiti.resolve(request, { parentURL: pathToFileURL(pagePath).href });
  const mock = mockedModule(request);
  if (!resolved || !mock) throw new Error(`Nao foi possivel preparar mock: ${request}`);
  const cacheEntry = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: mock,
  } as NodeModule;
  nativeRequire.cache[resolved] = cacheEntry;
  nativeRequire.cache[resolved.replaceAll("\\", "/")] = cacheEntry;
}

const { default: OnboardingPage } = await jiti.import(pagePath);

function contextFor(organizationId: string, storeId: string): StoreContextValue {
  return {
    organizationId,
    activeStore: { id: storeId, name: storeId },
    loading: false,
    refreshStores: async () => undefined,
  };
}

function renderPage(initialContext: StoreContextValue) {
  let currentContext = initialContext;
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(
      storeContext.Provider,
      { value: currentContext },
      createElement(OnboardingPage),
    ));
  });
  return {
    get renderer() { return renderer; },
    switchContext(nextContext: StoreContextValue) {
      currentContext = nextContext;
      act(() => {
        renderer.update(createElement(
          storeContext.Provider,
          { value: currentContext },
          createElement(OnboardingPage),
        ));
      });
    },
  };
}

function nodeText(node: { children: unknown[] }) {
  return node.children.map((child) => {
    if (typeof child === "string") return child;
    if (child && typeof child === "object" && "children" in child) {
      return nodeText(child as { children: unknown[] });
    }
    return "";
  }).join(" ");
}

function treeText(renderer: ReactTestRenderer) {
  return nodeText(renderer.root);
}

function buttonByText(renderer: ReactTestRenderer, text: string) {
  return renderer.root.findAllByType("button").find((button) => nodeText(button) === text);
}

const page = renderPage(contextFor("org-a", "store-a"));
const stepFourButton = page.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
assert.ok(stepFourButton);
act(() => stepFourButton.props.onClick());
const yesButton = buttonByText(page.renderer, "Sim");
assert.ok(yesButton);
act(() => yesButton.props.onClick());
const confirmButton = buttonByText(page.renderer, "Confirmar");
assert.ok(confirmButton);
act(() => confirmButton.props.onClick());
assert.equal(treeText(page.renderer).includes(":  Sim Alterar"), true);

page.switchContext(contextFor("org-b", "store-b"));
const buttonsAfterSwitch = page.renderer.root.findAllByType("button");
assert.equal(buttonsAfterSwitch.find((button) => nodeText(button) === "Sim")?.props["aria-pressed"], false);
assert.equal(buttonsAfterSwitch.find((button) => nodeText(button).startsWith("N"))?.props["aria-pressed"], false);
assert.equal(treeText(page.renderer).includes(":  Sim Alterar"), false);
const noButton = buttonsAfterSwitch.find((button) => nodeText(button).startsWith("N"));
assert.ok(noButton);
act(() => noButton.props.onClick());
const confirmNoButton = buttonByText(page.renderer, "Confirmar");
assert.ok(confirmNoButton);
act(() => confirmNoButton.props.onClick());
assert.equal(treeText(page.renderer).includes(":  Não Alterar"), true);

await act(async () => { await Promise.resolve(); });
const storeAStatus = statusDeferreds.get("store-a");
const storeBStatus = statusDeferreds.get("store-b");
assert.ok(storeAStatus);
assert.ok(storeBStatus);
await act(async () => {
  storeAStatus.resolve(response({ ok: true, connected: true, isActive: true, status: "connected", displayPhoneNumber: "A-PHONE" }));
  await Promise.resolve();
});
assert.equal(treeText(page.renderer).includes("A-PHONE"), false);
await act(async () => {
  storeBStatus.resolve(response({ ok: true, connected: true, isActive: true, status: "connected", displayPhoneNumber: "B-PHONE" }));
  await Promise.resolve();
});
assert.equal(treeText(page.renderer).includes("B-PHONE"), true);

page.switchContext(contextFor("org-a", "store-a"));
const buttonsAfterReturn = page.renderer.root.findAllByType("button");
assert.equal(buttonsAfterReturn.find((button) => nodeText(button) === "Sim")?.props["aria-pressed"], false);
assert.equal(treeText(page.renderer).includes(":  Sim Alterar"), false);

const finalAStatus = statusDeferreds.get("store-a");
assert.ok(finalAStatus);
page.switchContext({ activeStore: null, organizationId: null, loading: false, refreshStores: async () => undefined });
await act(async () => {
  finalAStatus.resolve(response({ ok: true, connected: true, isActive: true, status: "connected", displayPhoneNumber: "LOGGED-OUT" }));
  await Promise.resolve();
});
assert.equal(treeText(page.renderer), "");
act(() => page.renderer.unmount());

searchStep = null;
const savePage = renderPage(contextFor("org-a", "store-save"));
const saveStepOne = savePage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("1"));
assert.ok(saveStepOne);
act(() => saveStepOne.props.onClick());
const saveInputs = savePage.renderer.root.findAllByType("input");
const setInput = (index: number, value: string) => {
  const input = saveInputs[index];
  assert.ok(input);
  act(() => input.props.onChange({ target: { value } }));
};
setInput(0, "Loja A");
setInput(1, "Sao Paulo");
setInput(2, "SP");
const saveForm = savePage.renderer.root.findByType("form");
await act(async () => {
  void saveForm.props.onSubmit({ preventDefault() {} });
  await Promise.resolve();
});
assert.equal(saveStrategyResolvers.length, 1);
savePage.switchContext(contextFor("org-b", "store-save-b"));
saveStrategyResolvers.shift()?.();
await act(async () => { await Promise.resolve(); });
assert.equal(treeText(savePage.renderer).includes("salvas."), false);
act(() => savePage.renderer.unmount());

searchStep = "4";
const activationPage = renderPage(contextFor("org-a", "store-activate"));
const activationStep = activationPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
assert.ok(activationStep);
act(() => activationStep.props.onClick());
await act(async () => { await Promise.resolve(); });
const activationStatus = statusDeferreds.get("store-activate");
assert.ok(activationStatus);
await act(async () => {
  activationStatus.resolve(response({ ok: true, connected: true, isActive: true, status: "connected", displayPhoneNumber: "ACTIVATE-PHONE" }));
  await Promise.resolve();
});
const activateButton = activationPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button) === "Ativar ZION");
assert.ok(activateButton);
assert.equal(activateButton.props.disabled, false);
await act(async () => {
  void activateButton.props.onClick();
  await Promise.resolve();
});
await act(async () => { await Promise.resolve(); });
assert.equal(activationResolvers.length, 1);
activationPage.switchContext(contextFor("org-b", "store-activate-b"));
activationResolvers.shift()?.();
await act(async () => { await Promise.resolve(); });
assert.equal(treeText(activationPage.renderer).includes("Onboarding conclu"), false);
act(() => activationPage.renderer.unmount());

function pendingEmbeddedSignupResponse() {
  return {
    ok: true,
    requiresUserAction: true,
    canRetry: false,
    connectionScenario: "zion_number_change_required",
    changeRequest: { id: "request-test", status: "candidate_received", activeIntegrationId: "active-existing" },
    candidate: {
      phoneNumberId: "987654321",
      whatsappBusinessAccountId: "123456789",
      displayPhoneNumber: "+55 11 99999-0000",
      isActive: false,
    },
  };
}

async function finishMetaSignup(
  event = "FINISH",
  data = { waba_id: "123456789", phone_number_id: "987654321" },
  expectSession = true,
) {
  await act(async () => { await Promise.resolve(); });
  const login = facebookLoginCallbacks.at(-1);
  assert.ok(login, "FB.login nao foi acionado");
  assert.ok(messageListeners.size, "listener Meta nao foi registrado");
  act(() => login({ authResponse: { code: "oauth-code" } }));
  act(() => dispatchMetaMessage({
    type: "WA_EMBEDDED_SIGNUP",
     event,
     data,
  }));
  if (expectSession) assert.ok(lastTestFlow?.getSnapshot().session, "sessao nao aceita pelo fluxo de teste");
}

searchStep = "4";
embeddedSignupResponseBody = pendingEmbeddedSignupResponse();
deferEmbeddedSignupResponse = false;
embeddedSignupResponseResolvers.length = 0;
embeddedSignupPosts.length = 0;
const pendingPage = renderPage(contextFor("fbd4afaa-4958-4663-9234-98589ab322c7", "54fb81f4-92e5-463a-af6c-fc1544ea4b04"));
const pendingStep = pendingPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
assert.ok(pendingStep);
act(() => pendingStep.props.onClick());
await act(async () => { await Promise.resolve(); });
resolveStatus("54fb81f4-92e5-463a-af6c-fc1544ea4b04", { ok: true, connected: false, isActive: false, status: "not_connected" });
await act(async () => { await Promise.resolve(); });
const connectButton = buttonByText(pendingPage.renderer, "Conectar Cloud API convencional");
assert.ok(connectButton);
await act(async () => { await connectButton.props.onClick(); });
await finishMetaSignup();
assert.equal(lastTestFlow?.getSnapshot().code, "oauth-code");
assert.ok(lastTestFlow?.getSnapshot().session);
assert.ok(markSubmittingCount > 0, `markSubmitting=${markSubmittingCount}`);
await act(async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
});
const pendingText = treeText(pendingPage.renderer);
assert.equal(embeddedSignupPosts.length, 1, `posts=${embeddedSignupPosts.length} text=${pendingText}`);
assert.ok(pendingText.includes("request-test") && pendingText.includes("pendente"), pendingText);
assert.equal(pendingText.includes("Nenhuma conexao foi marcada como ativa"), true);
assert.equal(pendingText.includes("WHATSAPP_STATUS_NOT_CONFIRMED"), false);
assert.equal(pendingText.includes("Status Conectado"), false);
assert.equal(embeddedSignupPosts.length, 1);
const pendingConnectButton = buttonByText(pendingPage.renderer, "Conectar Cloud API convencional");
assert.ok(pendingConnectButton);
assert.equal(pendingConnectButton.props.disabled, true, JSON.stringify(pendingConnectButton.props));
const verifyButton = pendingPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Verificar") && nodeText(button).includes("existente"));
assert.ok(verifyButton);
assert.equal(verifyButton.props.disabled, true, JSON.stringify(verifyButton.props));
const statusButton = buttonByText(pendingPage.renderer, "Atualizar status");
assert.ok(statusButton);
const statusRequestsBeforeManualCheck = whatsappStatusRequestCount;
act(() => statusButton.props.onClick());
await act(async () => { await Promise.resolve(); });
assert.equal(whatsappStatusRequestCount > statusRequestsBeforeManualCheck, true);
assert.equal(treeText(pendingPage.renderer).includes("request-test"), true);
assert.equal(embeddedSignupPosts.length, 1);
pendingPage.switchContext(contextFor("org-next", "store-next"));
assert.equal(treeText(pendingPage.renderer).includes("request-test"), false);
assert.equal(treeText(pendingPage.renderer).includes("Nenhuma conexao foi marcada como ativa"), false);
act(() => pendingPage.renderer.unmount());

deferEmbeddedSignupResponse = true;
embeddedSignupResponseBody = pendingEmbeddedSignupResponse();
embeddedSignupPosts.length = 0;
const stalePendingPage = renderPage(contextFor("org-stale", "store-stale"));
const staleStep = stalePendingPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
assert.ok(staleStep);
act(() => staleStep.props.onClick());
await act(async () => { await Promise.resolve(); });
resolveStatus("store-stale", { ok: true, connected: false, isActive: false, status: "not_connected" });
await act(async () => { await Promise.resolve(); });
const staleConnectButton = buttonByText(stalePendingPage.renderer, "Conectar Cloud API convencional");
assert.ok(staleConnectButton);
await act(async () => { await staleConnectButton.props.onClick(); });
await finishMetaSignup();
await act(async () => { await Promise.resolve(); });
stalePendingPage.switchContext(contextFor("org-next-2", "store-next-2"));
await act(async () => { await Promise.resolve(); });
const staleResponse = embeddedSignupResponseResolvers[0];
assert.ok(staleResponse, "resposta pendente do Embedded Signup ausente");
staleResponse(response(embeddedSignupResponseBody));
await act(async () => { await Promise.resolve(); await Promise.resolve(); });
assert.equal(treeText(stalePendingPage.renderer).includes("request-test"), false, treeText(stalePendingPage.renderer));
act(() => stalePendingPage.renderer.unmount());
deferEmbeddedSignupResponse = false;
embeddedSignupResponseResolvers.length = 0;

  embeddedSignupPosts.length = 0;
  const rejectedPage = renderPage(contextFor("org-rejected", "store-rejected"));
  const rejectedStep = rejectedPage.renderer.root.findAllByType("button")
    .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
  assert.ok(rejectedStep);
  act(() => rejectedStep.props.onClick());
  await act(async () => { await Promise.resolve(); });
  resolveStatus("store-rejected", { ok: true, connected: false, isActive: false, status: "not_connected" });
  await act(async () => { await Promise.resolve(); });
  const rejectedButton = buttonByText(rejectedPage.renderer, "Manter WhatsApp Business + Cloud API");
  assert.ok(rejectedButton);
  await act(async () => { await rejectedButton.props.onClick(); });
  await finishMetaSignup("UNRELATED_EVENT", { waba_id: "123456789" }, false);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(embeddedSignupPosts.length, 0);
  assert.equal(treeText(rejectedPage.renderer).includes("Diagnóstico técnico seguro"), true);
  act(() => rejectedPage.renderer.unmount());

  embeddedSignupResponseBody = {
    ok: true,
    integration: { phoneNumberId: "phone-coexistence", whatsappBusinessAccountId: "waba-coexistence" },
  };
  embeddedSignupPosts.length = 0;
  const coexistencePage = renderPage(contextFor("org-coexistence", "store-coexistence"));
  const coexistenceStep = coexistencePage.renderer.root.findAllByType("button")
    .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
  assert.ok(coexistenceStep);
  act(() => coexistenceStep.props.onClick());
  await act(async () => { await Promise.resolve(); });
  resolveStatus("store-coexistence", { ok: true, connected: false, isActive: false, status: "not_connected" });
  await act(async () => { await Promise.resolve(); });
  const coexistenceButton = buttonByText(coexistencePage.renderer, "Manter WhatsApp Business + Cloud API");
  assert.ok(coexistenceButton);
  await act(async () => { await coexistenceButton.props.onClick(); });
  await finishMetaSignup("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", { waba_id: "123456789" });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(embeddedSignupPosts.length, 1);
  resolveStatus("store-coexistence", {
    ok: true,
    connected: true,
    isActive: true,
    status: "active",
    phoneNumberId: "phone-coexistence",
    whatsappBusinessAccountId: "waba-coexistence",
    displayPhoneNumber: "+55 11 97777-0000",
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(treeText(coexistencePage.renderer).includes("Conectado"), true);
  act(() => coexistencePage.renderer.unmount());

embeddedSignupResponseBody = {
  ok: true,
  integration: { phoneNumberId: "phone-normal", whatsappBusinessAccountId: "waba-normal" },
};
embeddedSignupPosts.length = 0;
const normalPage = renderPage(contextFor("org-normal", "store-normal"));
const normalStep = normalPage.renderer.root.findAllByType("button")
  .find((button) => nodeText(button).includes("Etapa") && nodeText(button).includes("4"));
assert.ok(normalStep);
act(() => normalStep.props.onClick());
await act(async () => { await Promise.resolve(); });
resolveStatus("store-normal", { ok: true, connected: false, isActive: false, status: "not_connected" });
await act(async () => { await Promise.resolve(); });
const normalConnectButton = buttonByText(normalPage.renderer, "Conectar Cloud API convencional");
assert.ok(normalConnectButton);
await act(async () => { await normalConnectButton.props.onClick(); });
await act(async () => { await Promise.resolve(); });
const normalLogin = facebookLoginCallbacks.at(-1);
assert.ok(normalLogin);
act(() => normalLogin({ authResponse: { code: "oauth-normal" } }));
act(() => dispatchMetaMessage({
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
  data: { waba_id: "waba-normal", phone_number_id: "phone-normal" },
}));
await act(async () => { await Promise.resolve(); await Promise.resolve(); });
resolveStatus("store-normal", {
  ok: true,
  connected: true,
  isActive: true,
  status: "active",
  phoneNumberId: "phone-normal",
  whatsappBusinessAccountId: "waba-normal",
  displayPhoneNumber: "+55 11 98888-1111",
});
await act(async () => { await Promise.resolve(); await Promise.resolve(); });
assert.ok(treeText(normalPage.renderer).includes("Status Conectado"), treeText(normalPage.renderer));
assert.equal(treeText(normalPage.renderer).includes("Pedido de troca"), false);
assert.equal(embeddedSignupPosts.length, 1);
act(() => normalPage.renderer.unmount());

console.log("Onboarding page: mounted integration isolation test passed");
