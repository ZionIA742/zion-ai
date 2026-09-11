import { strict as assert } from "node:assert";
import {
  createStoreCepGetHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createGrantedAccess(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "org-1",
      storeId: "store-1",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
  };
}

function createDeniedAccess(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "anonymous",
      status: "anonymous",
      sessionUserId: null,
      safeHtmlDestination: "/login",
      apiDecision: "deny_401",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "anonymous",
      message: "Sem sessao.",
    },
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Faca login para acessar esta API da loja.",
      status: "anonymous",
      reasonCode: "anonymous",
    },
  };
}

function buildRequest(cep: string) {
  return new Request(`https://example.test/api/store/cep?cep=${encodeURIComponent(cep)}`);
}

const tests: TestCase[] = [
  {
    name: "valid CEP returns ViaCEP street district city and state through internal route",
    run: async () => {
      let requestedUrl = "";
      const handler = createStoreCepGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        fetchCep: async (url) => {
          requestedUrl = String(url);
          return Response.json({
            logradouro: "Rua Teste",
            bairro: "Centro",
            localidade: "Suzano",
            uf: "sp",
          });
        },
      });

      const response = await handler(buildRequest("08673-000"));
      const body = (await response.json()) as Record<string, any>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.found, true);
      assert.equal(body.address.street, "Rua Teste");
      assert.equal(body.address.district, "Centro");
      assert.equal(body.address.city, "Suzano");
      assert.equal(body.address.state, "SP");
      assert.equal(requestedUrl, "https://viacep.com.br/ws/08673000/json/");
    },
  },
  {
    name: "missing CEP keeps lookup successful and lets the UI continue manually",
    run: async () => {
      const handler = createStoreCepGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        fetchCep: async () => Response.json({ erro: true }),
      });

      const response = await handler(buildRequest("08673-000"));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.found, false);
      assert.equal(typeof body.message, "string");
    },
  },
  {
    name: "provider failure returns a safe manual-fill message",
    run: async () => {
      const handler = createStoreCepGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        fetchCep: async () => {
          throw new Error("network down");
        },
      });

      const response = await handler(buildRequest("08673-000"));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 503);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_CEP_LOOKUP_FAILED");
      assert.equal(typeof body.message, "string");
    },
  },
  {
    name: "invalid CEP never calls the provider",
    run: async () => {
      let fetchCount = 0;
      const handler = createStoreCepGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        fetchCep: async () => {
          fetchCount += 1;
          return Response.json({});
        },
      });

      const response = await handler(buildRequest("123"));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_CEP_INVALID");
      assert.equal(fetchCount, 0);
    },
  },
  {
    name: "store access denial is preserved before CEP provider lookup",
    run: async () => {
      let fetchCount = 0;
      const handler = createStoreCepGetHandler({
        resolveAccess: async () => createDeniedAccess(),
        fetchCep: async () => {
          fetchCount += 1;
          return Response.json({});
        },
      });

      const response = await handler(buildRequest("08673-000"));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 401);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(fetchCount, 0);
    },
  },
];

void (async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`store-cep-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
