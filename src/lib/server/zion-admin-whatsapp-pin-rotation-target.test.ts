import assert from "node:assert/strict";
import { test } from "node:test";
const { resolveWhatsappPinRotationPhoneTarget } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-target.ts", import.meta.url).href
) as typeof import("./zion-admin-whatsapp-pin-rotation-target");

const actorUserId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const secretId = "8dd11e09-dbf4-4a92-8939-690ce20d8b87";
const integrationId = "5a0c925d-eb22-4c55-9af5-e818664878f5";
const phoneNumberId = "15551234567";
const request = { actorUserId, organizationId, storeId, secretId };

function mock(options: {
  rows?: unknown[];
  secret?: Record<string, unknown> | null;
  integration?: Record<string, unknown> | null;
  rpcError?: unknown;
  secretError?: unknown;
  integrationError?: unknown;
} = {}) {
  const calls: Array<{ table: string; filters: Array<[string,string]> }> = [];
  const listed = options.rows ?? [{ secret_id: secretId, organization_id: organizationId,
    store_id: storeId, secret_status: "active", can_reveal: true }];
  const secret = options.secret === undefined ? {
    id: secretId, organization_id: organizationId, store_id: storeId,
    phone_number_id: phoneNumberId, external_integration_id: integrationId,
    provider: "whatsapp", secret_kind: "two_step_verification_pin", status: "active",
  } : options.secret;
  const integration = options.integration === undefined ? {
    id: integrationId, organization_id: organizationId, store_id: storeId,
    phone_number_id: phoneNumberId, provider: "whatsapp", status: "active", is_active: true,
  } : options.integration;
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "list_zion_admin_whatsapp_pins_by_system");
      assert.equal(args.p_actor_user_id, actorUserId);
      return { data: listed, error: options.rpcError ?? null };
    },
    from: (table: string) => {
      const filters: Array<[string,string]> = [];
      calls.push({ table, filters });
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { filters.push([column,value]); return query; },
        maybeSingle: async () => table === "whatsapp_phone_security_secrets"
          ? { data: secret, error: options.secretError ?? null }
          : { data: integration, error: options.integrationError ?? null },
      };
      return query;
    },
  };
  return { db, calls };
}

test("canonical target is server-only; filters by exact secret, tenant and linked active integration", async () => {
  const { db, calls } = mock();
  assert.equal(await resolveWhatsappPinRotationPhoneTarget(db, request), phoneNumberId);
  assert.deepEqual(calls.map((call) => call.table),
    ["whatsapp_phone_security_secrets", "external_integrations"]);
  for (const call of calls) {
    assert.ok(call.filters.some(([column, v]) => column === "organization_id" && v === organizationId));
    assert.ok(call.filters.some(([column, v]) => column === "store_id" && v === storeId));
  }
});

test("denies malformed actor/tenant/store/secret before privileged queries", async () => {
  const { db, calls } = mock();
  await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, { ...request, secretId: "not-uuid" }), /TARGET_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});

test("denies a secret absent from the authorized list or belonging to another tenant", async () => {
  const { db, calls } = mock({ rows: [{ secret_id: secretId, organization_id: organizationId,
    store_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", secret_status: "active", can_reveal: true }] });
  await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), /TARGET_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});

test("invalidated or pending PIN cannot be a rotation target", async () => {
  for (const status of ["invalidated", "pending"]) {
    const { db, calls } = mock({ rows: [{ secret_id: secretId, organization_id: organizationId,
      store_id: storeId, secret_status: status, can_reveal: true }] });
    await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), /TARGET_UNAVAILABLE/);
    assert.equal(calls.length, 0);
  }
});

test("ambiguous authorized list fails closed", async () => {
  const listed = { secret_id: secretId, organization_id: organizationId, store_id: storeId,
    secret_status: "active", can_reveal: true };
  const { db, calls } = mock({ rows: [listed, listed] });
  await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), /TARGET_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});

test("denies integration with mismatched phone or disabled state", async () => {
  const invalidIntegrations = [
    { id: integrationId, organization_id: organizationId, store_id: storeId,
      phone_number_id: "9999999999", provider: "whatsapp", status: "active", is_active: true },
    { id: integrationId, organization_id: organizationId, store_id: storeId,
      phone_number_id: phoneNumberId, provider: "whatsapp", status: "active", is_active: false },
  ];
  for (const integration of invalidIntegrations) {
    const { db } = mock({ integration });
    await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), /TARGET_UNAVAILABLE/);
  }
});

test("denies missing, incorrect or invalidated secret; no fallback to other numbers", async () => {
  for (const secret of [null, {
    id: secretId, organization_id: organizationId, store_id: storeId,
    phone_number_id: phoneNumberId, external_integration_id: integrationId,
    provider: "whatsapp", secret_kind: "two_step_verification_pin", status: "invalidated",
  }]) {
    const { db } = mock({ secret });
    await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), /TARGET_UNAVAILABLE/);
  }
});

test("SQL error never leaks private database error", async () => {
  const { db } = mock({ rpcError: { message: "sensitive_meta_token_abc" } });
  await assert.rejects(resolveWhatsappPinRotationPhoneTarget(db, request), (error: unknown) =>
    error instanceof Error && error.message === "ZION_ADMIN_PIN_ROTATION_TARGET_UNAVAILABLE");
});
