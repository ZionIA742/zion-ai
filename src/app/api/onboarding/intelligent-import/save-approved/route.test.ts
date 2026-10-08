import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSaveApprovedIntelligentImportGetHandler,
  createSaveApprovedIntelligentImportPostHandler,
} from "./route";
import {
  IntelligentImportSaveAccessError,
  type IntelligentImportSaveAuthorizedScope,
} from "@/lib/server/onboarding-intelligent-import-save";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

function createGrantedAccess(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_onboarding_required",
      sessionUserId: "user-1",
      safeHtmlDestination: "/onboarding",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "onboarding_required",
      message: "Conta em onboarding liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
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
      message: "Acesso negado.",
    },
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Acesso negado.",
      status: "anonymous",
      reasonCode: "anonymous",
    },
  };
}

function createJsonRequest(body: unknown, reads: { count: number }) {
  return {
    json: async () => {
      reads.count += 1;
      return body;
    },
  } as unknown as Request;
}

function saveResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    message: "ok",
    ok: true,
    summary: {
      blockedDuplicate: 0,
      invalid: 0,
      saved: 0,
      total: 0,
      valid: 0,
    },
    validateOnly: false,
    ...overrides,
  } as never;
}

test("denied access uses the canonical response before reading the body or saving", async () => {
  const reads = { count: 0 };
  const denied = createDeniedAccess();
  let saveCalls = 0;
  const handler = createSaveApprovedIntelligentImportPostHandler({
    resolveAccess: async ({ requirement }) => {
      assert.equal(requirement, "active_or_onboarding");
      return denied;
    },
    saveApproved: async () => {
      saveCalls += 1;
      throw new Error("save must not run");
    },
  });

  const response = await handler(
    createJsonRequest({ organizationId: "body-org", storeId: "body-store" }, reads),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, denied.httpStatus);
  assert.deepEqual(body, denied.payload);
  assert.equal(reads.count, 0);
  assert.equal(saveCalls, 0);
});

test("allowed access is resolved first and canonical scope replaces spoofed body ids", async () => {
  const events: string[] = [];
  const reads = { count: 0 };
  let receivedPayload: Record<string, unknown> | null = null;
  let receivedScope: IntelligentImportSaveAuthorizedScope | null = null;
  const handler = createSaveApprovedIntelligentImportPostHandler({
    resolveAccess: async ({ requirement }) => {
      assert.equal(requirement, "active_or_onboarding");
      events.push("access");
      return createGrantedAccess();
    },
    saveApproved: async (payload, scope) => {
      events.push("save");
      receivedPayload = payload as unknown as Record<string, unknown>;
      receivedScope = scope;
      return saveResult();
    },
  });

  const requestBody = {
    organizationId: "body-org",
    storeId: "body-store",
    importedFileIds: ["file-1"],
    items: [{ name: "Produto" }],
    context: { debugParser: false },
    reviewAudit: { globalReviewConfirmation: { confirmed: true } },
    selectedMediaRefs: [{ stagingAssetId: "asset-1" }],
    validateOnly: false,
  };
  const response = await handler(createJsonRequest(requestBody, reads));
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(events, ["access", "save"]);
  assert.equal(reads.count, 1);
  assert.equal(receivedPayload?.organizationId, "access-org");
  assert.equal(receivedPayload?.storeId, "access-store");
  assert.deepEqual(receivedPayload?.importedFileIds, ["file-1"]);
  assert.deepEqual(receivedPayload?.items, [{ name: "Produto" }]);
  assert.deepEqual(receivedPayload?.context, { debugParser: false });
  assert.deepEqual(receivedPayload?.reviewAudit, requestBody.reviewAudit);
  assert.deepEqual(receivedPayload?.selectedMediaRefs, requestBody.selectedMediaRefs);
  assert.equal(receivedPayload?.validateOnly, false);
  assert.deepEqual(receivedScope, {
    organizationId: "access-org",
    storeId: "access-store",
  });
});

test("save result status preserves success, validate-only failure, and conflict", async () => {
  for (const scenario of [
    { result: saveResult(), validateOnly: false, status: 200 },
    { result: saveResult({ ok: false, validateOnly: true }), validateOnly: true, status: 200 },
    { result: saveResult({ ok: false }), validateOnly: false, status: 409 },
  ]) {
    const handler = createSaveApprovedIntelligentImportPostHandler({
      resolveAccess: async () => createGrantedAccess(),
      saveApproved: async () => scenario.result,
    });
    const response = await handler(
      createJsonRequest({ validateOnly: scenario.validateOnly }, { count: 0 }),
    );
    assert.equal(response.status, scenario.status);
  }
});

test("IntelligentImportSaveAccessError keeps its HTTP mapping", async () => {
  const handler = createSaveApprovedIntelligentImportPostHandler({
    resolveAccess: async () => createGrantedAccess(),
    saveApproved: async () => {
      throw new IntelligentImportSaveAccessError(422, "INVALID_SCOPE", "Escopo invalido.");
    },
  });

  const response = await handler(createJsonRequest({}, { count: 0 }));
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 422);
  assert.equal(body.message, "Escopo invalido.");
  assert.equal(body.validateOnly, true);
});

test("GET uses the canonical access gate for denied and granted access", async () => {
  let requirement: string | null = null;
  const deniedHandler = createSaveApprovedIntelligentImportGetHandler({
    resolveAccess: async ({ requirement: received }) => {
      requirement = received;
      return createDeniedAccess();
    },
  });
  const deniedResponse = await deniedHandler();
  assert.equal(deniedResponse.status, 401);
  assert.equal(requirement, "active_or_onboarding");

  const grantedHandler = createSaveApprovedIntelligentImportGetHandler({
    resolveAccess: async ({ requirement: received }) => {
      requirement = received;
      return createGrantedAccess();
    },
  });
  const grantedResponse = await grantedHandler();
  const body = (await grantedResponse.json()) as Record<string, unknown>;
  assert.equal(grantedResponse.status, 200);
  assert.equal(requirement, "active_or_onboarding");
  assert.equal(body.route, "onboarding/intelligent-import/save-approved");
  assert.equal(body.method, "POST");
});

test("route and helper keep the canonical authority contract", () => {
  const routePath = join(process.cwd(), "src/app/api/onboarding/intelligent-import/save-approved/route.ts");
  const helperPath = join(process.cwd(), "src/lib/server/onboarding-intelligent-import-save.ts");
  const routeSource = readFileSync(routePath, "utf8");
  const helperSource = readFileSync(helperPath, "utf8");

  assert.equal(routeSource.includes("resolveStoreApiAccess"), true);
  assert.equal(routeSource.includes("createStoreApiDeniedResponse"), true);
  assert.equal(routeSource.includes('requirement: "active_or_onboarding"'), true);
  assert.equal(routeSource.includes("body.organizationId"), false);
  assert.equal(routeSource.includes("body.storeId"), false);
  assert.equal(routeSource.includes("createSupabaseServerClient"), false);
  assert.equal(routeSource.includes("auth.getUser"), false);
  assert.equal(routeSource.includes("getSession"), false);
  assert.equal(helperSource.includes(".from(\"memberships\")"), false);
  assert.equal(helperSource.includes("auth.getUser"), false);
  assert.equal(helperSource.includes("authenticateIntelligentImportSaveRequest"), false);
  assert.equal(helperSource.includes("uniqueOrganizationIds"), false);
  assert.equal(helperSource.includes("loadAuthorizedStore"), false);
  assert.equal(helperSource.includes("createServiceSupabaseClient"), true);
});

test("new test file is UTF-8 without BOM or trailing whitespace", () => {
  const path = join(process.cwd(), "src/app/api/onboarding/intelligent-import/save-approved/route.test.ts");
  const bytes = readFileSync(path);
  assert.equal(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, false);
  const text = bytes.toString("utf8");
  assert.equal(Buffer.from(text, "utf8").equals(bytes), true);
  assert.equal(text.split(/\r?\n/).some((line) => /[ \t]+$/.test(line)), false);
});
