import assert from "node:assert/strict";
import { resolveStoreAccountIdentity } from "./store-account-identity-resolution.ts";

const membership = (overrides = {}) => ({
  id: "membership-1",
  organization_id: "org-1",
  user_id: "user-1",
  role: "owner",
  is_active: true,
  ...overrides,
});

const authUser = (overrides = {}) => ({
  id: "user-1",
  email: "owner@example.com",
  ...overrides,
});

const profile = (overrides = {}) => ({
  user_id: "user-1",
  is_blocked: false,
  ...overrides,
});

const validInput = (overrides = {}) => ({
  ownerMemberships: [membership()],
  authUsers: [authUser()],
  ownerProfiles: [profile()],
  ...overrides,
});

const tests = [
  {
    name: "owner missing",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerMemberships: [],
      });

      assert.equal(result.state, "broken");
      assert.deepEqual(result.issues, [{ code: "owner_missing" }]);
      assert.deepEqual(result.owner, {
        state: "missing",
        membershipId: null,
        userId: null,
      });
    },
  },
  {
    name: "owner ambiguous",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerMemberships: [membership(), membership({ id: "membership-2", user_id: "user-2" })],
        authUsers: [authUser(), authUser({ id: "user-2" })],
        ownerProfiles: [profile(), profile({ user_id: "user-2" })],
      });

      assert.equal(result.state, "broken");
      assert.deepEqual(result.issues, [{ code: "owner_ambiguous" }]);
      assert.deepEqual(result.owner, {
        state: "ambiguous",
        membershipId: null,
        userId: null,
      });
      assert.equal(result.authUser.state, "unresolved");
      assert.equal(result.profile.state, "unresolved");
    },
  },
  {
    name: "owner resolved with missing auth user",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        authUsers: [],
      });

      assert.equal(result.state, "broken");
      assert.deepEqual(result.issues, [{ code: "auth_user_missing" }]);
      assert.deepEqual(result.authUser, { state: "missing", userId: null });
    },
  },
  {
    name: "owner resolved with auth user and missing profile",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerProfiles: [],
      });

      assert.equal(result.state, "broken");
      assert.deepEqual(result.issues, [{ code: "owner_profile_missing" }]);
      assert.deepEqual(result.authUser, { state: "present", userId: "user-1" });
      assert.deepEqual(result.profile, { state: "missing", userId: null });
    },
  },
  {
    name: "valid identity",
    run() {
      const result = resolveStoreAccountIdentity(validInput());

      assert.equal(result.state, "valid");
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: "inactive owner remains valid identity",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerMemberships: [membership({ is_active: false })],
      });

      assert.equal(result.state, "valid");
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: "blocked profile remains valid identity",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerProfiles: [profile({ is_blocked: true })],
      });

      assert.equal(result.state, "valid");
      assert.deepEqual(result.issues, []);
    },
  },
  {
    name: "projection preserves canonical ids",
    run() {
      const result = resolveStoreAccountIdentity(validInput());

      assert.deepEqual(result.owner, {
        state: "resolved",
        membershipId: "membership-1",
        userId: "user-1",
      });
      assert.deepEqual(result.authUser, { state: "present", userId: "user-1" });
      assert.deepEqual(result.profile, { state: "present", userId: "user-1" });
    },
  },
  {
    name: "ambiguous owners never select a candidate",
    run() {
      const result = resolveStoreAccountIdentity({
        ...validInput(),
        ownerMemberships: [
          membership({ id: "membership-a", user_id: "user-a" }),
          membership({ id: "membership-b", user_id: "user-b" }),
        ],
        authUsers: [authUser({ id: "user-a" }), authUser({ id: "user-b" })],
        ownerProfiles: [profile({ user_id: "user-a" }), profile({ user_id: "user-b" })],
      });

      assert.equal(result.owner.membershipId, null);
      assert.equal(result.owner.userId, null);
      assert.equal(result.authUser.userId, null);
      assert.equal(result.profile.userId, null);
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`zion-admin-overview-store-account-identity-resolution: ${tests.length} tests passed`);
