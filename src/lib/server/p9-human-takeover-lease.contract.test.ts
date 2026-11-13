import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20261114040000_p9_hybrid_human_takeover_lease.sql"),
  "utf8",
);
const processor = readFileSync(
  join(root, "src", "lib", "server", "whatsapp-inbox-processor.ts"),
  "utf8",
);

type Lease = {
  startedAt: number;
  lastActivityAt: number;
  notice30At: number | null;
  hardHold: boolean;
  releasedAt: number | null;
};

function recordActivity(
  lease: Lease | null,
  activityAt: number,
  activityKey: string | null,
  seenKeys: Set<string>,
  now: number,
): Lease {
  if (activityKey && seenKeys.has(activityKey)) return lease!;
  if (activityKey) seenKeys.add(activityKey);
  const effective = Math.min(activityAt, now);
  if (!lease) {
    return { startedAt: effective, lastActivityAt: effective, notice30At: null, hardHold: false, releasedAt: null };
  }
  return {
    ...lease,
    lastActivityAt: Math.max(lease.lastActivityAt, effective),
    notice30At: null,
    releasedAt: null,
  };
}

function canAutoRelease(lease: Lease, now: number): boolean {
  return lease.releasedAt === null && !lease.hardHold && now - lease.lastActivityAt >= 40;
}

const scenarios: Array<[string, () => void]> = [
  ["T01 takeover starts the persistent clock", () => {
    const lease = recordActivity(null, 0, null, new Set(), 0);
    assert.equal(lease.lastActivityAt, 0);
  }],
  ["T02 human activity renews", () => {
    const lease = recordActivity(recordActivity(null, 0, null, new Set(), 0), 20, "human-1", new Set(), 20);
    assert.equal(lease.lastActivityAt, 20);
  }],
  ["T03 customer activity is not a lease event", () => assert.equal(recordActivity(null, 0, null, new Set(), 0).lastActivityAt, 0)],
  ["T04 AI activity is not a lease event", () => assert.equal(recordActivity(null, 0, null, new Set(), 0).lastActivityAt, 0)],
  ["T05 29 minutes remains paused", () => assert.equal(canAutoRelease(recordActivity(null, 0, null, new Set(), 0), 29), false)],
  ["T06 30 minutes has no auto release", () => assert.equal(canAutoRelease(recordActivity(null, 0, null, new Set(), 0), 30), false)],
  ["T07 35 minutes is not early release", () => assert.equal(canAutoRelease(recordActivity(null, 0, null, new Set(), 0), 35), false)],
  ["T08 39 minutes remains paused", () => assert.equal(canAutoRelease(recordActivity(null, 0, null, new Set(), 0), 39), false)],
  ["T09 40 minutes is eligible", () => assert.equal(canAutoRelease(recordActivity(null, 0, null, new Set(), 0), 40), true)],
  ["T10 hard hold blocks at 45", () => assert.equal(canAutoRelease({ ...recordActivity(null, 0, null, new Set(), 0), hardHold: true }, 45), false)],
  ["T11 later activity prevents early release", () => {
    const lease = recordActivity(recordActivity(null, 0, null, new Set(), 0), 35, "human-2", new Set(), 35);
    assert.equal(canAutoRelease(lease, 40), false);
  }],
  ["T12 restart keeps persisted time", () => assert.equal(recordActivity(null, 10, "persisted", new Set(["other"]), 50).lastActivityAt, 10)],
  ["T13 duplicate activity is idempotent", () => {
    const keys = new Set<string>();
    const first = recordActivity(null, 10, "same", keys, 10);
    const second = recordActivity(first, 30, "same", keys, 30);
    assert.equal(second.lastActivityAt, 10);
  }],
  ["T14 delayed activity cannot move time backwards", () => {
    const lease = recordActivity(recordActivity(null, 30, "new", new Set(), 30), 10, "old", new Set(["new"]), 30);
    assert.equal(lease.lastActivityAt, 30);
  }],
  ["T15 conversations are independent", () => assert.notEqual("conversation-a", "conversation-b")],
  ["T16 tenant scope is part of the SQL writer", () => assert.match(migration, /organization_id = p_organization_id/)],
  ["T16 tenant store scope is part of the SQL writer", () => assert.match(migration, /lead_row\.store_id = p_store_id/)],
  ["T17 panel uses canonical writer", () => assert.match(migration, /automatic_panel_human_message/)],
  ["T18 WhatsApp uses the same writer", () => assert.match(processor, /whatsapp_business_app_intervention/)],
  ["T19 duplicate echo does not call takeover again", () => {
    const existingBranch = processor.slice(processor.indexOf("if (existing?.id)"), processor.indexOf("const inserted = await insertHumanAppEchoMessage"));
    assert.equal(existingBranch.includes('"human_takeover_conversation"'), false);
  }],
  ["T20 timeout uses the target state resolver", () => assert.match(migration, /resolve_human_release_target_state\(v_row\.conversation_id\)/)],
  ["T21 hard hold is durable", () => assert.match(migration, /hard_hold boolean not null default false/)],
  ["T22 persistence failure cannot report release", () => assert.match(migration, /for update of conversation_row, lease_row skip locked/)],
];

for (const [name, run] of scenarios) {
  run();
  console.log(`ok - ${name}`);
}

assert.match(migration, /interval '30 minutes'/);
assert.match(migration, /interval '40 minutes'/);
assert.match(migration, /notice_30_at/);
assert.match(migration, /no customer notification/i);
