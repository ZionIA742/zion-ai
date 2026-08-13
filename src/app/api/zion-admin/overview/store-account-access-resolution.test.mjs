import assert from "node:assert/strict";
import { resolveCanonicalOwnerMembership } from "./store-account-access-resolution.ts";

function createMembership(overrides = {}) {
  return {
    id: "membership-1",
    organization_id: "org-1",
    user_id: "user-1",
    role: "owner",
    is_active: true,
    created_at: "2026-08-13T12:00:00.000Z",
    ...overrides,
  };
}

const tests = [
  {
    name: "um owner unico e resolvido",
    run() {
      const result = resolveCanonicalOwnerMembership({
        ownerMemberships: [createMembership()],
      });

      assert.equal(result.kind, "resolved");
      assert.equal(result.membership.id, "membership-1");
    },
  },
  {
    name: "owner unico bloqueado ou inactive continua resolvido",
    run() {
      const result = resolveCanonicalOwnerMembership({
        ownerMemberships: [
          createMembership({
            is_active: false,
          }),
        ],
      });

      assert.equal(result.kind, "resolved");
      assert.equal(result.membership.id, "membership-1");
    },
  },
  {
    name: "dois owners permanecem ambiguos",
    run() {
      const result = resolveCanonicalOwnerMembership({
        ownerMemberships: [
          createMembership(),
          createMembership({
            id: "membership-2",
            user_id: "user-2",
          }),
        ],
      });

      assert.equal(result.kind, "ambiguous");
      assert.deepEqual(result.remainingMembershipIds, ["membership-1", "membership-2"]);
    },
  },
  {
    name: "nenhum owner retorna missing",
    run() {
      const result = resolveCanonicalOwnerMembership({
        ownerMemberships: [],
      });

      assert.equal(result.kind, "missing");
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`zion-admin-overview-store-account-access-resolution: ${tests.length} tests passed`);
