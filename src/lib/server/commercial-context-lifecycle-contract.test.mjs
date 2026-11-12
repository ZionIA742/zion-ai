import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";

const migration = (name) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const candidateFromEnv = process.env.I8_CANDIDATE_SQL?.trim() || null;
const candidateOptionIndex = process.argv.indexOf("--candidate");
const candidatePath = candidateFromEnv ||
  (candidateOptionIndex >= 0 ? process.argv[candidateOptionIndex + 1] : null);

if (candidateOptionIndex >= 0 && !candidatePath) {
  throw new Error("--candidate requires a SQL file path");
}

function readCandidate(path) {
  const source = readFileSync(
    isAbsolute(path) ? path : resolve(process.cwd(), path),
    "utf8",
  );
  const revision2Marker = source.indexOf("DO $i8_not_ready$");
  if (revision2Marker < 0) return source;
  const protectedStart = source.indexOf("/*", revision2Marker);
  const protectedEnd = source.lastIndexOf("*/");
  assert.ok(protectedStart >= 0, "Revision 2 candidate must contain a protected SQL section");
  assert.ok(protectedEnd > protectedStart, "Revision 2 candidate must close its protected SQL section");
  return source.slice(protectedStart + 2, protectedEnd);
}

const candidateSource = candidatePath ? readCandidate(candidatePath) : null;

const insertMessageSource = migration(
  "20260729110000_sales_contract_customer_acceptance_atomic.sql",
);
const contextWriterSource = migration(
  "20260728143000_commercial_message_session_context_writer.sql",
);
const contextFoundationSource = migration(
  "20260720173000_commercial_session_context_links_foundation.sql",
);
const salesAiMaterializerSource = migration(
  "20261009120000_p19a_sales_ai_reply_set_materialization.sql",
);
const quoteSendGateSource = migration(
  "20260923132000_p9_sales_quote_send_pre_provider_linearization.sql",
);
const reopenSource = migration(
  "20260828190000_p9_commercial_opportunity_reopen_system_writer.sql",
);
const controlledStageSource = migration(
  "20260810125500_commercial_opportunity_controlled_stage_writers.sql",
);
const salesAiReplySource = readFileSync(
  join(process.cwd(), "src", "lib", "server", "generate-ai-sales-reply.ts"),
  "utf8",
);

function functionBody(source, functionName) {
  const declaration = new RegExp(
    `\\bfunction\\s+public\\.${functionName}\\b`,
    "i",
  );
  const declarationMatch = declaration.exec(source);
  const start = declarationMatch?.index ?? -1;
  assert.notEqual(start, -1, `${functionName} must exist in the selected SQL source`);
  const relativeBodyStart = source.slice(start).search(/\bas\s+\$function\$/i);
  const bodyStart = relativeBodyStart >= 0 ? start + relativeBodyStart : -1;
  const delimiter = bodyStart >= 0 ? "$function$;" : "$$;";
  const end = source.indexOf(delimiter, bodyStart >= 0 ? bodyStart : start);
  assert.notEqual(end, -1, `${functionName} must have a complete SQL body`);
  return source.slice(start, end);
}

function selectedFunctionSource(baselineSource, functionName) {
  if (!candidateSource) return baselineSource;
  const declaration = new RegExp(
    `\\bfunction\\s+public\\.${functionName}\\b`,
    "i",
  );
  return declaration.test(candidateSource) ? candidateSource : baselineSource;
}

function selectedFunctionBody(baselineSource, functionName) {
  return functionBody(
    selectedFunctionSource(baselineSource, functionName),
    functionName,
  );
}

function positionInOrder(source, fragments, label) {
  const positions = fragments.map((fragment) => source.indexOf(fragment));
  assert.ok(
    positions.every((position) => position >= 0),
    `${label}: every lock marker must exist (${positions.join(", ")})`,
  );
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `${label}: expected ${fragments[index - 1]} before ${fragments[index]}`,
    );
  }
}

function assertSourceMatches(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

test("reopening records the previous cycle and advances the opportunity", () => {
  const body = functionBody(
    reopenSource,
    "apply_commercial_opportunity_reopen_internal",
  );
  assertSourceMatches(body, /lifecycle_cycle/, "reopen must address lifecycle_cycle");
  assertSourceMatches(body, /lifecycle_cycle\s*\+\s*1/, "reopen must advance lifecycle_cycle");
  assertSourceMatches(body, /reopened/, "reopen must record the reopened event");
});

test("post-sale reopening does not advance lifecycle_cycle", () => {
  const body = functionBody(
    controlledStageSource,
    "reopen_commercial_opportunity_for_post_sale_by_user",
  );
  assert.doesNotMatch(body, /lifecycle_cycle\s*=\s*lifecycle_cycle\s*\+\s*1/);
});

test("insert_message delegates context discovery before taking the conversation lock", () => {
  const body = selectedFunctionBody(insertMessageSource, "insert_message");
  positionInOrder(
    body,
    [
      "ensure_commercial_conversation_session_context",
      "private_acquire_sales_contract_conversation_xact_lock",
    ],
    "insert_message commercial lock handoff",
  );
});

test("ensure validates the opportunity lifecycle before returning existing_captured", () => {
  const body = selectedFunctionBody(
    contextWriterSource,
    "ensure_commercial_conversation_session_context",
  );
  assertSourceMatches(body, /existing_captured/, "ensure must preserve existing_captured");
  assertSourceMatches(body, /lifecycle_cycle/i, "ensure must validate lifecycle_cycle");
  assertSourceMatches(body, /unlinked_at/, "ensure must reject unlinked context");
  assertSourceMatches(body, /commercial_opportunities[\s\S]*FOR UPDATE/i, "ensure must lock the opportunity while validating it");
  if (candidateSource) {
    assertSourceMatches(
      body,
      /i8_001_current_context_matches_cycle/,
      "Revision 2 must delegate cycle validation to the canonical helper",
    );
  }
});

test("legacy NULL links are explicitly limited to the first opportunity cycle", () => {
  const body = selectedFunctionBody(
    contextWriterSource,
    "ensure_commercial_conversation_session_context",
  );
  const source = candidateSource ? candidateSource : body;
  assertSourceMatches(source, /lifecycle_cycle\s+is\s+null/i, "ensure must recognize legacy NULL lifecycle links");
  assertSourceMatches(source, /lifecycle_cycle\s*=\s*1/, "legacy NULL lifecycle links must be limited to cycle 1");
});

test("replacement validates the current cycle and remains idempotent", () => {
  const body = selectedFunctionBody(
    contextFoundationSource,
    "replace_commercial_session_context_link",
  );
  assertSourceMatches(body, /lifecycle_cycle/, "replacement must validate lifecycle_cycle");
  assertSourceMatches(body, /idempotency/i, "replacement must remain idempotent");
  assertSourceMatches(body, /replaces_link_id/, "replacement must preserve historical linkage");
  assert.doesNotMatch(
    body,
    /update\s+public\.commercial_session_context_links[\s\S]*?\bset\b[\s\S]{0,500}\blifecycle_cycle\s*=/i,
  );
});

test("replacement requires an unequivocal current opportunity and reopen evidence", () => {
  const body = selectedFunctionBody(
    contextFoundationSource,
    "replace_commercial_session_context_link",
  );
  assertSourceMatches(body, /commercial_opportunities[\s\S]*FOR UPDATE/i, "replacement must validate the current opportunity");
  if (candidateSource) {
    const ensureBody = selectedFunctionBody(
      contextWriterSource,
      "ensure_commercial_conversation_session_context",
    );
    assertSourceMatches(ensureBody, /reopened/, "Revision 2 ensure must require reopen evidence");
  } else {
    assertSourceMatches(body, /reopened/, "replacement must require reopen evidence");
  }
  assertSourceMatches(body, /lifecycle_cycle/, "replacement must use the current lifecycle cycle");
});

test("the Sales AI materializer validates the final active link before materializing", () => {
  const body = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assertSourceMatches(body, /commercial_session_context_links/, "materializer must inspect the context link");
  if (!candidateSource) {
    assertSourceMatches(body, /lifecycle_cycle/i, "materializer must validate lifecycle_cycle");
  }
  assertSourceMatches(body, /unlinked_at/, "materializer must reject unlinked context");
  if (candidateSource) {
    assertSourceMatches(
      body,
      /i8_001_current_context_matches_cycle/,
      "Revision 2 materializer must validate the current cycle through the helper",
    );
  }
  if (candidateSource) {
    const opportunityPosition = body.indexOf("commercial_opportunities");
    const conversationLockPosition = body.indexOf(
      "private_acquire_sales_contract_conversation_xact_lock",
    );
    const lockedAnchorPosition = body.indexOf("for share", conversationLockPosition);
    assert.ok(
      opportunityPosition >= 0 &&
        conversationLockPosition > opportunityPosition &&
        lockedAnchorPosition > conversationLockPosition,
      "Revision 2 materializer must lock opportunity, then conversation, then anchor",
    );
  } else {
    positionInOrder(
      body,
      [
        "commercial_opportunities",
        "private_acquire_sales_contract_conversation_xact_lock",
        "messages",
      ],
      "Sales AI materializer lock order",
    );
  }
});

test("Revision 4 materializer establishes NULL-opportunity context before the private conversation lock", () => {
  if (!candidateSource) return;
  const body = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assertSourceMatches(
    body,
    /if\s+p_commercial_opportunity_id\s+is\s+null\s+then[\s\S]*?ensure_commercial_conversation_session_context/i,
    "NULL opportunity must establish context before entering the materializer conversation critical section",
  );
  positionInOrder(
    body,
    [
      "ensure_commercial_conversation_session_context",
      "private_acquire_sales_contract_conversation_xact_lock",
    ],
    "NULL opportunity materializer lock order",
  );
});

test("the quote send gate preserves operation, quote, version, conversation, message order", () => {
  const body = functionBody(
    quoteSendGateSource,
    "validate_or_cancel_whatsapp_external_send_v2_by_system",
  );
  const positions = [
    body.indexOf("pg_catalog.pg_advisory_xact_lock("),
    body.indexOf("from public.sales_quotes quote_row"),
    body.indexOf("from public.sales_quote_versions version_row"),
    body.indexOf("perform public.private_acquire_sales_contract_conversation_xact_lock"),
    body.lastIndexOf("from public.messages message_row"),
  ];
  assert.ok(
    positions.every((position) => position >= 0),
    `sales_quote_send gate lock markers must exist (${positions.join(", ")})`,
  );
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `sales_quote_send gate lock order is invalid (${positions.join(", ")})`,
    );
  }
  assert.ok(
    body.includes("v_outbound_origin is distinct from 'sales_quote_send'"),
    "sales_quote_send gate must remain scoped to the quote-send operation",
  );
});

test("CMIR reopen_same_intent requires a valid replacement before recovering context", () => {
  assertSourceMatches(
    salesAiReplySource,
    /decisionKind\s*===\s*"reopen_same_intent"[\s\S]*resolvedOpportunityId\s*=\s*arrivalOpportunityId/,
    "reopen_same_intent must resolve the arrival opportunity, not invent another one",
  );
  assertSourceMatches(
    salesAiReplySource,
    /ai_reopen_same_intent/,
    "reopen_same_intent must retain its canonical reason code",
  );

  const reopenBody = functionBody(
    reopenSource,
    "apply_commercial_opportunity_reopen_internal",
  );
  assertSourceMatches(reopenBody, /lifecycle_cycle\s*=\s*(?:opportunity_row\.)?lifecycle_cycle\s*\+\s*1/,
    "same-opportunity reopen must advance the lifecycle cycle");
  assertSourceMatches(reopenBody, /reopened/, "reopen must provide canonical evidence");

  const replacementBody = selectedFunctionBody(
    contextFoundationSource,
    "replace_commercial_session_context_link",
  );
  assertSourceMatches(replacementBody, /replaces_link_id/,
    "replacement must retain the previous link as history");
  assertSourceMatches(replacementBody, /idempotency/i,
    "replacement must be idempotent");
  assertSourceMatches(replacementBody, /only active commercial session context link can be replaced/,
    "replacement must reject an already inactive historical link");
});

test("CMIR replacement preserves the arrival snapshot and uses the current link for materialization", () => {
  assertSourceMatches(
    salesAiReplySource,
    /commercial_message_intent_resolution_current[\s\S]*commercial_message_intent_resolution_events/,
    "CMIR must prove the current resolution from the canonical event chain",
  );
  assertSourceMatches(
    salesAiReplySource,
    /anchorMessageId[\s\S]*currentEventId[\s\S]*resolvedOpportunityId/,
    "CMIR must bind the replacement to the original anchor without rewriting its snapshot",
  );

  const snapshotCheck = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "tests",
      "20260721160000_messages_replacement_context_new_message_capture_check.sql",
    ),
    "utf8",
  );
  assertSourceMatches(snapshotCheck, /replacement|replaced|new message/i,
    "replacement must have a snapshot regression check");

  const materializerBody = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assertSourceMatches(materializerBody, /commercial_session_context_links/,
    "materializer must inspect the current commercial link");
  if (!candidateSource) {
    assertSourceMatches(materializerBody, /lifecycle_cycle/i,
      "materializer must compare the current link cycle");
  }
  if (candidateSource) {
    assertSourceMatches(
      materializerBody,
      /i8_001_current_context_matches_cycle/,
      "Revision 2 materializer must use the current-cycle helper",
    );
  }
  assert.doesNotMatch(
    materializerBody,
    /v_anchor\.commercial_session_context_link_id\s+is\s+null[\s\S]*context_row\.id\s*=\s*v_anchor\.commercial_session_context_link_id/,
    "an old arrival snapshot cannot be the sole authority for the replacement link",
  );
});

test("needs_clarification preserves an unresolved context and cannot authorize external sending", () => {
  assertSourceMatches(
    salesAiReplySource,
    /decisionKind\s*===\s*"needs_clarification"/,
    "needs_clarification must remain an explicit decision",
  );

  if (candidateSource) {
    const cmirBody = selectedFunctionBody(
      contextFoundationSource,
      "write_commercial_message_intent_resolution_internal",
    );
    assertSourceMatches(cmirBody, /reopen_same_intent/, "CMIR must preserve reopen_same_intent");
    assertSourceMatches(cmirBody, /replace_commercial_session_context_link/, "CMIR must perform canonical replacement");
    assertSourceMatches(cmirBody, /commercial_opportunity_lifecycle_events/, "CMIR must use canonical lifecycle evidence");
  }
  assertSourceMatches(
    salesAiReplySource,
    /let resolvedOpportunityId:\s*string \| null\s*=\s*null/,
    "needs_clarification must start without a resolved opportunity",
  );
  assertSourceMatches(
    salesAiReplySource,
    /let relatedOpportunityId:\s*string \| null\s*=\s*null/,
    "needs_clarification must start without a related opportunity",
  );
  assertSourceMatches(
    salesAiReplySource,
    /ai_needs_clarification/,
    "needs_clarification must retain its canonical reason code",
  );

  const materializerBody = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assertSourceMatches(materializerBody, /v_send_external/,
    "external authorization must be evaluated independently");
  assertSourceMatches(materializerBody, /P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED/,
    "external sending must require a resolved opportunity");
});

test("message snapshots have existing regression runners for immutable and pending context", () => {
  for (const name of [
    "20260721120000_messages_commercial_context_snapshot_manual_checks.sql",
    "20260721140000_messages_pending_context_snapshot_check.sql",
    "20260721143000_messages_captured_context_snapshot_check.sql",
    "20260721150000_messages_closed_context_snapshot_preservation_check.sql",
    "20260721153000_messages_replaced_context_snapshot_preservation_check.sql",
    "20260721160000_messages_replacement_context_new_message_capture_check.sql",
    "20260721163000_messages_commercial_context_snapshot_immutability_check.sql",
  ]) {
    const source = readFileSync(
      join(process.cwd(), "supabase", "tests", name),
      "utf8",
    );
    assert.ok(source.length > 0, `${name} must remain available`);
  }
});

test("needs_clarification and CMIR remain represented by existing regression checks", () => {
  const profileChecks = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "tests",
      "20260901140500_p9_commercial_opportunity_profile_canonical_writer_manual_checks.sql",
    ),
    "utf8",
  );
  const cmirChecks = readFileSync(
    join(
      process.cwd(),
      "src",
      "lib",
      "server",
      "process-ai-run-queue.test.ts",
    ),
    "utf8",
  );
  assert.match(profileChecks, /needs_clarification/);
  assert.match(cmirChecks, /CMIR|commercial_message_intent/i);
});

test("Revision 2 candidate contains the helper and all seven coordinated functions", () => {
  if (!candidateSource) return;
  for (const functionName of [
    "close_commercial_session_context_link",
    "ensure_commercial_conversation_session_context",
    "insert_message",
    "link_commercial_session_context",
    "materialize_sales_ai_reply_set_by_system",
    "replace_commercial_session_context_link",
    "write_commercial_message_intent_resolution_internal",
  ]) {
    assert.match(
      candidateSource,
      new RegExp(`\\bfunction\\s+public\\.${functionName}\\b`, "i"),
      `${functionName} must be present in the protected candidate section`,
    );
  }
  assert.match(
    candidateSource,
    /\bfunction\s+public\.i8_001_current_context_matches_cycle\b/i,
    "the lifecycle helper must be present in the protected candidate section",
  );
});

test("Revision 4 fails closed when a pending snapshot has no CMIR proof", () => {
  if (!candidateSource) return;
  const helper = functionBody(candidateSource, "i8_001_current_context_matches_cycle");
  const materializer = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assert.match(helper, /select\s+coalesce\s*\(/i, "current-context proof must coalesce SQL NULL to false");
  assert.match(helper, /\),\s*false\s*\)/i, "current-context proof must return false for indeterminate evidence");
  assert.match(materializer, /commercial_context_capture_state\s*=\s*'pending_context'/i, "pending snapshots must be handled explicitly");
  assert.match(materializer, /v_context_proven\s*:=\s*\([\s\S]*?\)\s+is\s+true/i, "a NULL link comparison must not become authorization");
  assert.match(materializer, /if\s+v_context_proven\s+is\s+not\s+true[\s\S]*?commercial_message_intent_resolution_current/i, "pending context must require canonical CMIR proof before external authorization");
});

test("Revision 4 accepts a current link only when canonical CMIR proves the replacement", () => {
  if (!candidateSource) return;
  const materializer = selectedFunctionBody(
    salesAiMaterializerSource,
    "materialize_sales_ai_reply_set_by_system",
  );
  assert.match(materializer, /cmir_current\.anchor_message_id\s*=\s*p_anchor_message_id/i);
  assert.match(materializer, /cmir_event\.resolved_opportunity_id\s*=\s*p_commercial_opportunity_id/i);
  assert.match(materializer, /pending_context_linked|arrival_context_replaced|reopen_cycle_context_replaced/i);
  assert.match(materializer, /P19A_I8_CURRENT_CYCLE_CONTEXT_REQUIRED/i);
});

const CONCURRENCY_ENABLED = process.env.I8_CONCURRENCY_TESTS_ENABLED === "true";
const CONCURRENCY_ACKNOWLEDGED = process.env.I8_CONCURRENCY_EXTERNAL_EFFECTS_ACKNOWLEDGED === "true";
const CONCURRENCY_DATABASE_URL = process.env.I8_CONCURRENCY_DATABASE_URL || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_CONCURRENCY_IDS = [
  "I8_CONCURRENCY_ORGANIZATION_ID",
  "I8_CONCURRENCY_STORE_ID",
  "I8_CONCURRENCY_CONVERSATION_ID",
  "I8_CONCURRENCY_LEAD_ID",
  "I8_CONCURRENCY_ANCHOR_MESSAGE_ID",
  "I8_CONCURRENCY_OPPORTUNITY_ID",
];
const CONCURRENCY_LIFECYCLE_CYCLE = Number.parseInt(
  process.env.I8_CONCURRENCY_LIFECYCLE_CYCLE || "",
  10,
);

function concurrencySkipReason(extra = "") {
  if (!CONCURRENCY_ENABLED) return "disabled: set I8_CONCURRENCY_TESTS_ENABLED=true after explicit authorization";
  if (!CONCURRENCY_ACKNOWLEDGED) return "blocked: acknowledge that ROLLBACK cannot undo external trigger effects";
  if (!CONCURRENCY_DATABASE_URL) return "blocked: I8_CONCURRENCY_DATABASE_URL is required";
  const invalid = REQUIRED_CONCURRENCY_IDS.find((name) => !UUID.test(process.env[name] || ""));
  if (invalid) return `blocked: approved UUID required in ${invalid}`;
  if (!Number.isInteger(CONCURRENCY_LIFECYCLE_CYCLE) || CONCURRENCY_LIFECYCLE_CYCLE < 1) {
    return "blocked: approved positive I8_CONCURRENCY_LIFECYCLE_CYCLE is required";
  }
  if (process.env.I8_CONCURRENCY_EXTERNAL_SEND_AUTHORIZED === "true") {
    return "blocked: external sending authorization is forbidden for these tests";
  }
  return extra;
}

function assertNoExternalSendAuthorization(sql, label) {
  assert.doesNotMatch(
    String(sql || ""),
    /(?:send_external|p_send_external|external_send)[^\n]{0,80}(?:true|1)/i,
    `${label} must not authorize external sending`,
  );
}

async function validateConcurrencyFixture(client, params) {
  const result = await client.query(
    `select
       (select count(*)::integer from public.conversations
         where id = $3 and organization_id = $1 and store_id = $2 and lead_id = $4) as conversation_count,
       (select count(*)::integer from public.leads
         where id = $4 and organization_id = $1 and store_id = $2) as lead_count,
       (select count(*)::integer from public.commercial_opportunities
         where id = $6 and organization_id = $1 and store_id = $2) as opportunity_count,
       (select lifecycle_cycle from public.commercial_opportunities
         where id = $6 and organization_id = $1 and store_id = $2) as opportunity_cycle,
       (select count(*)::integer from public.messages
         where id = $5 and organization_id = $1 and store_id = $2 and conversation_id = $3) as anchor_count,
       (select count(*)::integer from public.ai_runs
         where organization_id = $1 and store_id = $2 and conversation_id = $3) as conversation_ai_run_count,
       (select count(*)::integer from public.messages
         where organization_id = $1 and store_id = $2 and conversation_id = $3
           and coalesce(metadata ->> 'send_external', 'false') = 'true'
           and coalesce(outbound_delivery_state, '') in ('pending', 'processing', 'uncertain')) as pending_external_count`,
    params,
  );
  const row = result.rows[0] || {};
  assert.equal(row.conversation_count, 1, "approved conversation scope must resolve exactly once");
  assert.equal(row.lead_count, 1, "approved lead scope must resolve exactly once");
  assert.equal(row.opportunity_count, 1, "approved opportunity scope must resolve exactly once");
  assert.equal(Number(row.opportunity_cycle), CONCURRENCY_LIFECYCLE_CYCLE, "opportunity lifecycle cycle does not match approval");
  assert.equal(row.anchor_count, 1, "approved anchor message must belong to the selected conversation");
  assert.equal(row.conversation_ai_run_count, 0, "selected conversation must have no concurrent ai_run");
  assert.equal(row.pending_external_count, 0, "selected conversation must have no pending external delivery");
  if (process.env.I8_CONCURRENCY_REQUIRE_REOPENED_CYCLE === "true") {
    assert.ok(CONCURRENCY_LIFECYCLE_CYCLE > 1, "reopen-required scenarios cannot run with lifecycle_cycle 1");
  }
}

async function openConcurrencyClients() {
  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    throw new Error("I8_CONCURRENCY_DRIVER_UNAVAILABLE: install the approved pg client before enabling these tests");
  }
  const first = new Client({ connectionString: CONCURRENCY_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  const second = new Client({ connectionString: CONCURRENCY_DATABASE_URL, connectionTimeoutMillis: 5_000 });
  await Promise.all([first.connect(), second.connect()]);
  return [first, second];
}

async function captureIntegritySnapshot(client, params) {
  const result = await client.query(
    `select
       (select count(*)::integer
          from public.p19a_sales_ai_reply_sets
         where organization_id = $1 and store_id = $2
           and conversation_id = $3 and anchor_message_id = $5) as reply_set_count,
       (select count(distinct request_fingerprint)::integer
          from public.p19a_sales_ai_reply_sets
         where organization_id = $1 and store_id = $2
           and conversation_id = $3 and anchor_message_id = $5) as reply_fingerprint_count,
       (select count(*)::integer
          from public.messages
         where organization_id = $1 and store_id = $2
           and conversation_id = $3
           and metadata ->> 'p19a_response_set_anchor_message_id' = $5::text) as response_message_count,
       (select count(*)::integer
          from public.messages
         where organization_id = $1 and store_id = $2
           and conversation_id = $3
           and metadata ->> 'send_external' = 'true'
           and coalesce(outbound_delivery_state, '') in ('pending', 'processing', 'uncertain')) as external_pending_count,
       (select count(*)::integer
          from public.conversation_sessions session_row
          join public.commercial_session_context_links link_row
            on link_row.conversation_session_id = session_row.id
           and link_row.organization_id = session_row.organization_id
           and link_row.store_id = session_row.store_id
         where session_row.organization_id = $1 and session_row.store_id = $2
           and session_row.conversation_id = $3
           and link_row.status = 'active' and link_row.unlinked_at is null) as active_link_count,
       (select count(*)::integer
          from public.commercial_opportunities
         where id = $6 and organization_id = $1 and store_id = $2) as opportunity_count,
       (select lifecycle_cycle
          from public.commercial_opportunities
         where id = $6 and organization_id = $1 and store_id = $2) as opportunity_cycle,
       (select count(*)::integer
          from public.commercial_opportunity_lifecycle_events event_row
         where event_row.organization_id = $1 and event_row.store_id = $2
           and event_row.commercial_opportunity_id = $6
           and event_row.lifecycle_cycle = (
             select lifecycle_cycle from public.commercial_opportunities
              where id = $6 and organization_id = $1 and store_id = $2
           )) as matching_cycle_event_count,
       (select conversation_session_id::text from public.messages where id = $5
          and organization_id = $1 and store_id = $2 and conversation_id = $3) as anchor_session_id,
       (select commercial_session_context_link_id::text from public.messages where id = $5
          and organization_id = $1 and store_id = $2 and conversation_id = $3) as anchor_link_id
    `,
    params,
  );
  return result.rows[0];
}

function assertIntegritySnapshot(before, after, label) {
  assert.ok(after.reply_set_count <= before.reply_set_count + 1, `${label}: reply set count duplicated`);
  assert.ok(after.reply_fingerprint_count <= after.reply_set_count, `${label}: reply fingerprints are not unique`);
  assert.ok(after.response_message_count <= before.response_message_count + 1, `${label}: response messages duplicated`);
  assert.ok(after.external_pending_count <= before.external_pending_count, `${label}: unexpected external message pending`);
  assert.equal(after.opportunity_count, before.opportunity_count, `${label}: opportunity scope changed`);
  assert.equal(after.opportunity_cycle, before.opportunity_cycle, `${label}: opportunity cycle changed`);
  assert.ok(after.active_link_count <= 1, `${label}: more than one active context link`);
  assert.ok(
    after.matching_cycle_event_count >= before.matching_cycle_event_count,
    `${label}: current opportunity cycle lost lifecycle evidence`,
  );
  assert.equal(after.anchor_session_id, before.anchor_session_id, `${label}: arrival snapshot session changed`);
  assert.equal(after.anchor_link_id, before.anchor_link_id, `${label}: arrival snapshot link changed`);
}

async function runConcurrentTransactions(firstSql, secondSql, params, options = {}) {
  const [first, second] = await openConcurrencyClients();
  const setup = "begin; set local statement_timeout = '5000ms'; set local lock_timeout = '2000ms';";
  const finish = async (client) => { try { await client.query("rollback"); } finally { await client.end(); } };
  try {
    await Promise.all([first.query(setup), second.query(setup)]);
    await Promise.all([
      validateConcurrencyFixture(first, params),
      validateConcurrencyFixture(second, params),
    ]);
    const before = await Promise.all([
      captureIntegritySnapshot(first, params),
      captureIntegritySnapshot(second, params),
    ]);
    const settled = await Promise.allSettled([
      first.query(firstSql, params),
      second.query(secondSql, params),
    ]);
    const failures = settled.filter((item) => item.status === "rejected").map((item) => item.reason);
    const codes = failures.map((error) => String(error?.code || "TIMEOUT_OR_UNKNOWN"));
    const prohibited = ["40P01", "55P03", "23505", "57014", "TIMEOUT_OR_UNKNOWN"];
    assert.equal(
      codes.some((code) => prohibited.includes(code)),
      false,
      `concurrent PostgreSQL failure: ${codes.join(", ")}`,
    );
    assert.deepEqual(codes, [], `unexpected concurrent PostgreSQL failure: ${codes.join(", ")}`);
    let repeatedSecond = null;
    if (options.repeatSecondSql) {
      repeatedSecond = await second.query(options.repeatSecondSql, params);
    }
    const after = await Promise.all([
      captureIntegritySnapshot(first, params),
      captureIntegritySnapshot(second, params),
    ]);
    assertIntegritySnapshot(before[0], after[0], "first transaction");
    assertIntegritySnapshot(before[1], after[1], "second transaction");
    return { results: settled.map((item) => item.value), before, after, repeatedSecond };
  } finally {
    await Promise.allSettled([finish(first), finish(second)]);
  }
}

test("real PostgreSQL test: concurrent insert_message versus Sales AI materialization must not deadlock", {
  skip: concurrencySkipReason(),
}, async () => {
  const ids = REQUIRED_CONCURRENCY_IDS.map((name) => process.env[name]);
  const [organizationId, storeId, conversationId, leadId, anchorMessageId, opportunityId] = ids;
  const insertSql = "select (public.insert_message($3::uuid, 'customer', 'incoming', 'text', 'I8 controlled inbound', null, null, jsonb_build_object('i8_concurrency_test', true))).id";
  const materializeSql = "select * from public.materialize_sales_ai_reply_set_by_system($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'I8 controlled reply', 'text', false, '[]'::jsonb, null, jsonb_build_object('i8_concurrency_test', true))";
  const run = await runConcurrentTransactions(
    insertSql,
    materializeSql,
    [organizationId, storeId, conversationId, leadId, anchorMessageId, opportunityId],
    { repeatSecondSql: process.env.I8_CONCURRENCY_REPEAT_AUTHORIZED === "true" ? materializeSql : null },
  );
  const [insertResult, materializeResult] = run.results;
  assert.equal(insertResult.rowCount, 1);
  assert.equal(materializeResult.rowCount, 1);
  if (run.repeatedSecond) {
    assert.equal(run.repeatedSecond.rowCount, 1, "authorized repetition must remain idempotent");
    assert.equal(run.repeatedSecond.rows[0]?.replayed, true, "authorized repetition must report replayed");
  }
});

test("real PostgreSQL test: concurrent CMIR, inbound, quote and follow-up paths must preserve lifecycle and idempotency", {
  skip: concurrencySkipReason(process.env.I8_CONCURRENCY_CMIR_SQL && process.env.I8_CONCURRENCY_COMMERCIAL_SQL ? "" : "blocked: approved I8_CONCURRENCY_CMIR_SQL and I8_CONCURRENCY_COMMERCIAL_SQL are required"),
}, async () => {
  const params = REQUIRED_CONCURRENCY_IDS.map((name) => process.env[name]);
  assertNoExternalSendAuthorization(process.env.I8_CONCURRENCY_CMIR_SQL, "CMIR SQL");
  assertNoExternalSendAuthorization(process.env.I8_CONCURRENCY_COMMERCIAL_SQL, "commercial SQL");
  const run = await runConcurrentTransactions(process.env.I8_CONCURRENCY_CMIR_SQL, process.env.I8_CONCURRENCY_COMMERCIAL_SQL, params);
  const [cmir, commercial] = run.results;
  assert.ok(cmir.rowCount !== null && commercial.rowCount !== null, "both approved operations must return a PostgreSQL result");
});

test("real PostgreSQL test: invalid context persists inbound message but materializes no commercial response or WhatsApp send", {
  skip: concurrencySkipReason(),
}, async () => {
  const [organizationId, storeId, conversationId, leadId, anchorMessageId, opportunityId] = REQUIRED_CONCURRENCY_IDS.map((name) => process.env[name]);
  const invalidOpportunityId = "00000000-0000-4000-8000-000000000001";
  const inbound = "select (public.insert_message($3::uuid, 'customer', 'incoming', 'text', 'I8 invalid-context inbound', null, null, jsonb_build_object('i8_concurrency_test', true))).id";
  const materialize = "select * from public.materialize_sales_ai_reply_set_by_system($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, 'I8 forbidden reply', 'text', false, '[]'::jsonb, null, jsonb_build_object('i8_concurrency_test', true))";
  const run = await runConcurrentTransactions(inbound, materialize, [organizationId, storeId, conversationId, leadId, anchorMessageId, invalidOpportunityId]);
  const [inboundResult, materializeResult] = run.results;
  assert.equal(inboundResult.rowCount, 1);
  assert.equal(materializeResult.rowCount, 0, "invalid context must not materialize an outbound reply");
  assert.equal(opportunityId, process.env.I8_CONCURRENCY_OPPORTUNITY_ID);
  assert.equal(run.after[1].reply_set_count, run.before[1].reply_set_count, "invalid context created a reply set");
  assert.equal(run.after[1].response_message_count, run.before[1].response_message_count, "invalid context created a response message");
  assert.equal(run.after[1].external_pending_count, run.before[1].external_pending_count, "invalid context queued external delivery");
});

console.log("i8-001 Parte B: static regression contract suite loaded");
