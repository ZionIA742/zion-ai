import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20261114060000_p9_panel_human_release_lease_sync.sql",
  ),
  "utf8",
);

const functionBody = migration.slice(
  migration.indexOf(
    "create or replace function public.panel_release_conversation_to_ai_scoped",
  ),
  migration.indexOf("alter function public.panel_release_conversation_to_ai_scoped"),
);

test("10.4-A preserves the scoped authenticated release contract", () => {
  assert.match(
    migration,
    /alter function public\.panel_release_conversation_to_ai_scoped\([\s\S]*?uuid,\s*uuid,\s*text,\s*text\)/,
  );
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, service_role/);
  assert.match(functionBody, /auth\.uid\(\)/);
  assert.match(functionBody, /request\.jwt\.claim\.role/);
});

test("10.4-A locks conversation before lease and updates the lease after transition", () => {
  const conversationLock = functionBody.indexOf(
    "for update of conversation_row",
  );
  const leaseLock = functionBody.indexOf(
    "from public.conversation_human_takeover_leases lease_row",
  );
  const transition = functionBody.indexOf(
    "perform public.transition_conversation_state_by_user",
  );
  const leaseUpdate = functionBody.indexOf(
    "update public.conversation_human_takeover_leases",
  );

  assert.ok(conversationLock >= 0);
  assert.ok(leaseLock > conversationLock);
  assert.ok(transition > leaseLock);
  assert.ok(leaseUpdate > transition);
  assert.match(functionBody, /released_at/);
  assert.match(functionBody, /release_reason/);
});

test("10.4-A rejects hard holds instead of releasing them", () => {
  assert.match(functionBody, /v_lease\.hard_hold is true/);
  assert.match(
    functionBody,
    /human takeover hard hold requires explicit release authority/,
  );
  assert.doesNotMatch(functionBody, /hard_hold\s*=\s*false/);
});

test("10.4-A remains tenant scoped and idempotent for missing or released leases", () => {
  assert.match(functionBody, /conversation_row\.organization_id = p_organization_id/);
  assert.match(functionBody, /v_lease\.organization_id is distinct from/);
  assert.match(functionBody, /v_lease\.store_id is distinct from/);
  assert.match(functionBody, /when released_at is null then/);
  assert.match(functionBody, /else released_at/);
  assert.match(functionBody, /v_has_lease := found/);
});

test("10.4-A keeps migration postconditions for the installed function", () => {
  assert.match(migration, /P9_10_4_A_PANEL_RELEASE_LEASE_SYNC_POSTCONDITION_FAILED/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, pg_temp, public/);
});

type ReleaseModel = {
  authenticated: boolean;
  organizationId: string;
  storeId: string;
  conversationOrganizationId: string;
  conversationStoreId: string;
  lease: { releasedAt: string | null; releaseReason: string | null; hardHold: boolean } | null;
  transitionCount: number;
};

function releaseModel(state: ReleaseModel, reason: string, failBeforeLeaseUpdate = false) {
  if (!state.authenticated) throw new Error("not authorized");
  if (
    state.organizationId !== state.conversationOrganizationId ||
    state.storeId !== state.conversationStoreId
  ) {
    throw new Error("scope mismatch");
  }
  if (state.lease?.hardHold) throw new Error("hard hold");

  const before = structuredClone(state);
  state.transitionCount += 1;
  try {
    if (failBeforeLeaseUpdate) throw new Error("lease update failed");
    if (state.lease) {
      state.lease.releasedAt ??= "released-at-test";
      state.lease.releaseReason ??= reason;
    }
  } catch (error) {
    Object.assign(state, before);
    throw error;
  }
}

test("10.4-A behavioral model covers authorization, tenant scope, lease states, rollback and hard hold", () => {
  const authorized: ReleaseModel = {
    authenticated: true,
    organizationId: "org-a",
    storeId: "store-a",
    conversationOrganizationId: "org-a",
    conversationStoreId: "store-a",
    lease: { releasedAt: null, releaseReason: null, hardHold: false },
    transitionCount: 0,
  };
  releaseModel(authorized, "manual_release");
  assert.equal(authorized.lease?.releasedAt, "released-at-test");
  assert.equal(authorized.lease?.releaseReason, "manual_release");
  assert.equal(authorized.transitionCount, 1);

  const alreadyReleased = structuredClone(authorized);
  releaseModel(alreadyReleased, "second_release");
  assert.equal(alreadyReleased.lease?.releasedAt, "released-at-test");
  assert.equal(alreadyReleased.lease?.releaseReason, "manual_release");

  const noLease = { ...authorized, lease: null, transitionCount: 0 };
  releaseModel(noLease, "no_lease_release");
  assert.equal(noLease.lease, null);
  assert.equal(noLease.transitionCount, 1);

  const failed = structuredClone(authorized);
  const failedBefore = structuredClone(failed);
  assert.throws(() => releaseModel(failed, "must_rollback", true));
  assert.deepEqual(failed, failedBefore);

  for (const invalid of [
    { ...authorized, authenticated: false },
    { ...authorized, organizationId: "org-other" },
    { ...authorized, storeId: "store-other" },
    { ...authorized, lease: { releasedAt: null, releaseReason: null, hardHold: true } },
  ]) {
    const before = structuredClone(invalid);
    assert.throws(() => releaseModel(invalid, "must_not_release"));
    assert.deepEqual(invalid, before);
  }

  const concurrent = structuredClone(authorized);
  releaseModel(concurrent, "first");
  releaseModel(concurrent, "second");
  assert.equal(concurrent.lease?.releaseReason, "manual_release");
});
