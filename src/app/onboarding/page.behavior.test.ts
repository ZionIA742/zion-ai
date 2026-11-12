import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
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
const saveStrategyResolvers: Array<() => void> = [];
const activationResolvers: Array<() => void> = [];
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
  if (url.includes("/api/store/whatsapp/status")) {
    const storeId = new URL(url, "http://localhost").searchParams.get("storeId") || "";
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
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
  },
});

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
  if (normalizedRequest.includes("meta-embedded-signup")) {
    return {
      ensureFacebookSdkLoaded: async () => undefined,
      getMetaEmbeddedSignupConfig: () => ({ appId: "", configId: "" }),
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

const { default: OnboardingPage } = await import("./page");

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

console.log("Onboarding page: mounted integration isolation test passed");
