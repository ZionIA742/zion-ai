import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261114070000_p9_human_takeover_hard_hold_authority.sql",
  ),
  "utf8",
);

const createBody = migration.slice(
  migration.indexOf("create or replace function public.create_human_takeover_hard_hold_scoped"),
  migration.indexOf("create or replace function public.release_human_takeover_hard_hold_scoped"),
);
const releaseBody = migration.slice(
  migration.indexOf("create or replace function public.release_human_takeover_hard_hold_scoped"),
  migration.indexOf("-- Legacy release remains"),
);

test("10.4-B exposes only authenticated scoped hard-hold authorities", () => {
  assert.match(migration, /grant execute on function public\.create_human_takeover_hard_hold_scoped[\s\S]*to authenticated/);
  assert.match(migration, /grant execute on function public\.release_human_takeover_hard_hold_scoped[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.create_human_takeover_hard_hold_scoped[\s\S]*from public, anon, service_role/);
  assert.match(migration, /revoke all on function public\.release_human_takeover_hard_hold_scoped[\s\S]*from public, anon, service_role/);
  assert.match(createBody, /auth\.uid\(\)/);
  assert.match(createBody, /_conversation_transition_role_is_allowed/);
  assert.match(releaseBody, /_conversation_transition_role_is_allowed/);
});

test("10.4-B preserves conversation-to-lease lock order and does not release AI", () => {
  for (const body of [createBody, releaseBody]) {
    const conversationLock = body.indexOf("for update of conversation_row");
    const leaseLock = body.indexOf("from public.conversation_human_takeover_leases lease_row");
    assert.ok(conversationLock >= 0);
    assert.ok(leaseLock > conversationLock);
  }
  assert.match(createBody, /hard_hold = true/);
  assert.match(releaseBody, /hard_hold = false/);
  assert.doesNotMatch(releaseBody, /transition_conversation_state/);
  assert.doesNotMatch(releaseBody, /released_at\s*=/);
});

test("10.4-B persists decision history and protects the legacy release", () => {
  assert.match(migration, /conversation_human_takeover_hard_hold_decisions/);
  assert.match(migration, /decision_type/);
  assert.match(migration, /decision_key/);
  assert.match(migration, /actor_user_id/);
  assert.match(migration, /legacy takeover release cannot cross active hard hold or scope/);
  assert.match(migration, /P9_10_4_B_HARD_HOLD_POSTCONDITION_FAILED/);
});

type State = {
  authenticated: boolean;
  owner: boolean;
  org: string;
  store: string;
  conversationOrg: string;
  conversationStore: string;
  humanActive: boolean;
  status: string;
  lease: { hardHold: boolean; releasedAt: string | null } | null;
  decisions: Map<string, { type: "created" | "released"; reason: string; actor: string }>;
  transitionCount: number;
};

function hardHold(
  state: State,
  type: "created" | "released",
  key: string,
  reason: string,
  actor: string,
) {
  if (!state.authenticated || !state.owner) throw new Error("not authorized");
  if (state.org !== state.conversationOrg || state.store !== state.conversationStore) {
    throw new Error("scope");
  }
  const existing = state.decisions.get(key);
  if (existing) {
    if (existing.type !== type || existing.reason !== reason || existing.actor !== actor) {
      throw new Error("key conflict");
    }
    return;
  }
  if (!state.lease) throw new Error("lease missing");
  if (type === "created") {
    if (
      !state.humanActive ||
      state.status !== "humano_assumiu" ||
      state.lease.releasedAt ||
      state.lease.hardHold
    ) {
      throw new Error("human control inactive");
    }
    state.decisions.set(key, { type, reason, actor });
    state.lease.hardHold = true;
    return;
  }
  if (!state.lease.hardHold) throw new Error("hard hold inactive");
  state.decisions.set(key, { type, reason, actor });
  state.lease.hardHold = false;
}

test("10.4-B behavior model covers authorization, idempotency, release and no AI transition", () => {
  const state: State = {
    authenticated: true,
    owner: true,
    org: "org-a",
    store: "store-a",
    conversationOrg: "org-a",
    conversationStore: "store-a",
    humanActive: true,
    status: "humano_assumiu",
    lease: { hardHold: false, releasedAt: null },
    decisions: new Map(),
    transitionCount: 0,
  };
  hardHold(state, "created", "hold-1", "customer requested pause", "user-a");
  hardHold(state, "created", "hold-1", "customer requested pause", "user-a");
  assert.equal(state.lease?.hardHold, true);
  assert.equal(state.decisions.size, 1);
  assert.equal(state.transitionCount, 0);
  assert.throws(() => hardHold(state, "created", "hold-2", "duplicate active hold", "user-a"));
  hardHold(state, "released", "release-1", "customer resumed", "user-a");
  hardHold(state, "released", "release-1", "customer resumed", "user-a");
  assert.equal(state.lease?.hardHold, false);
  assert.equal(state.transitionCount, 0);
  assert.throws(() => hardHold(state, "released", "release-2", "duplicate release", "user-a"));
  for (const invalid of [
    { ...state, authenticated: false },
    { ...state, owner: false },
    { ...state, org: "org-other" },
    { ...state, store: "store-other" },
  ]) {
    assert.throws(() => hardHold(invalid, "created", "invalid", "must reject", "user-a"));
  }
});
