import assert from "node:assert/strict";
import { resolveStoreIntegrity } from "./store-integrity-resolution.ts";

const owner = (overrides = {}) => ({
  id: "owner-1",
  user_id: "user-1",
  is_active: true,
  ...overrides,
});

const base = (overrides = {}) => ({
  organizationState: "present",
  ownerMemberships: [owner()],
  ownerProfiles: [{ user_id: "user-1" }],
  subscriptions: [{ status: "active" }],
  ...overrides,
});

const tests = [
  ["healthy", base()],
  ["organization ausente", base({ organizationState: "missing" })],
  ["zero owners", base({ ownerMemberships: [] })],
  ["owner e subscription ausentes", base({ ownerMemberships: [], subscriptions: [] })],
  ["dois owners", base({ ownerMemberships: [owner(), owner({ id: "owner-2", user_id: "user-2" })] })],
  ["owner inativo", base({ ownerMemberships: [owner({ is_active: false })] })],
  ["profile ausente", base({ ownerProfiles: [] })],
  ["subscription ausente", base({ subscriptions: [] })],
  ["subscriptions multiplas", base({ subscriptions: [{ status: "active" }, { status: "trial" }] })],
  ["subscription comercial nao e corrupcao", base({ subscriptions: [{ status: "suspended" }] })],
  ["profiles unknown nunca e healthy", base({ ownerProfiles: null })],
  ["memberships unknown nunca e healthy", base({ ownerMemberships: null })],
  ["fonte desconhecida nunca e healthy", base({ subscriptions: null })],
  ["broken comprovado prevalece sobre unknown", base({ ownerMemberships: [], subscriptions: null })],
];

for (const [name, input] of tests) {
  const result = resolveStoreIntegrity(input);
  if (name === "healthy") assert.equal(result.state, "healthy");
  if (name === "organization ausente") {
    assert.equal(result.state, "broken");
    assert.deepEqual(result.issues[0], { code: "organization_missing", severity: "error", scope: "organization" });
  }
  if (name === "zero owners") assert.equal(result.state, "broken");
  if (name === "owner e subscription ausentes") {
    assert.equal(result.state, "broken");
    assert.deepEqual(result.issues.map((issue) => issue.code), ["owner_missing", "subscription_missing"]);
  }
  if (name === "dois owners") assert.equal(result.owner.state, "ambiguous");
  if (name === "owner inativo") assert.equal(result.state, "warning");
  if (name === "profile ausente") assert.equal(result.state, "warning");
  if (name === "subscription ausente") assert.equal(result.subscription.state, "missing");
  if (name === "subscriptions multiplas") assert.equal(result.state, "broken");
  if (name === "subscription comercial nao e corrupcao") assert.equal(result.state, "healthy");
  if (name === "profiles unknown nunca e healthy") assert.notEqual(result.state, "healthy");
  if (name === "memberships unknown nunca e healthy") assert.notEqual(result.state, "healthy");
  if (name === "fonte desconhecida nunca e healthy") assert.equal(result.state, "unknown");
  if (name === "broken comprovado prevalece sobre unknown") assert.equal(result.state, "broken");
}

assert.deepEqual(
  resolveStoreIntegrity(base({ ownerMemberships: [], subscriptions: [] })).issues.map((issue) => issue.code),
  ["owner_missing", "subscription_missing"],
);

console.log(`zion-admin-overview-store-integrity-resolution: ${tests.length + 1} tests passed`);
