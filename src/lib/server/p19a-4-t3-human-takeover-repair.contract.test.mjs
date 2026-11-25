import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const repair = readFileSync(join(root, "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.sql"), "utf8");
const processor = readFileSync(join(root, "src/lib/server/whatsapp-inbox-processor.ts"), "utf8");
const aiFence = readFileSync(join(root, "src/lib/server/generate-and-save-ai-sales-reply.ts"), "utf8");

test("4-T3 is additive and preserves P0 and existing transition authorities", () => {
  assert.match(repair, /create table if not exists public\.conversation_human_takeover_leases/);
  assert.match(repair, /create table if not exists public\.conversation_human_takeover_activity_events/);
  assert.match(repair, /create function public\.ensure_human_takeover_lease_by_system/);
  assert.match(repair, /create function public\.record_human_takeover_activity_by_system/);
  assert.match(repair, /create function public\.release_human_takeover_lease_by_system/);
  assert.match(repair, /do \$takeover_patch\$/);
  assert.doesNotMatch(repair, /create or replace function public\.(process_stale_human_conversations|human_takeover_conversation|human_release_conversation_to_ai|resolve_human_release_target_state)/);
  assert.doesNotMatch(repair, /40 minutes|hybrid_human_timeout_auto_release/);
});

test("4-T3 preserves inert P0 and restricts its ACL", () => {
  assert.match(repair, /strpos\(v_p0, 'begin return 0; end;'\) = 0/);
  assert.match(repair, /strpos\(v_p0, 'transition_conversation_state'\) <> 0/);
  assert.match(repair, /strpos\(v_p0, 'insert '\) <> 0/);
  assert.match(repair, /strpos\(v_p0, 'update '\) <> 0/);
  assert.match(repair, /revoke all on function public\.process_stale_human_conversations\(\) from public, anon, authenticated/);
  assert.match(repair, /grant execute on function public\.process_stale_human_conversations\(\) to service_role/);
});

test("4-T3 preserves tenant scope, idempotency, hard hold, and lock order", () => {
  assert.match(repair, /lead_row\.organization_id = p_organization_id/);
  assert.match(repair, /lead_row\.store_id = p_store_id/);
  assert.match(repair, /v_lease\.store_id is distinct from v_store_id/);
  assert.match(repair, /on conflict do nothing/);
  assert.match(repair, /greatest\(/);
  assert.match(repair, /when v_lease\.released_at is not null then v_activity_at/);
  assert.match(repair, /when v_lease\.released_at is not null then[\s\S]*else v_lease\.takeover_started_at/);
  assert.doesNotMatch(repair, /set organization_id = excluded\.organization_id/);
  assert.doesNotMatch(repair, /set store_id = excluded\.store_id/);
  assert.match(repair, /human takeover lease scope mismatch/);
  assert.match(repair, /v_lease\.hard_hold is true/);
  assert.match(repair, /for update of conversation_row/);
  assert.match(repair, /from public\.conversation_human_takeover_leases lease_row/);
});

test("4-T3 installs ensure only when absent and fails closed on an incompatible existing contract", () => {
  assert.match(repair, /P19A_4_T3_TARGET_TABLE_ALREADY_EXISTS/);
  assert.match(repair, /to_regprocedure\('public\.ensure_human_takeover_lease_by_system\(uuid\)'\) is not null/);
  assert.match(repair, /P19A_4_T3_EXISTING_ENSURE_INCOMPATIBLE/);
  assert.match(repair, /P19A_4_T3_ENSURE_ALREADY_EXISTS/);
  assert.match(repair, /security definer[\s\S]*set search_path = pg_catalog, pg_temp, public/);
  assert.match(repair, /alter function public\.ensure_human_takeover_lease_by_system\(uuid\) owner to postgres/);
  assert.match(repair, /revoke all on function public\.ensure_human_takeover_lease_by_system\(uuid\) from public, anon, authenticated/);
  assert.match(repair, /grant execute on function public\.ensure_human_takeover_lease_by_system\(uuid\) to service_role/);
});

test("4-T3 patches only the proven insert_message takeover marker and preserves its guards", () => {
  assert.match(repair, /P19A_4_T3_INSERT_MESSAGE_MARKER_MISSING/);
  assert.match(repair, /P19A_4_T3_INSERT_MESSAGE_ACTIVITY_ALREADY_PRESENT/);
  assert.match(repair, /P19A_4_T3_INSERT_MESSAGE_TAKEOVER_ALREADY_PRESENT/);
  assert.match(repair, /private_acquire_sales_contract_conversation_xact_lock/);
  assert.match(repair, /ensure_commercial_conversation_session_context/);
  assert.match(repair, /p_metadata ->> 'human_activity_key'/);
  assert.match(repair, /p_metadata ->> 'human_activity_at'/);
  assert.match(repair, /source[\s\S]*meta_whatsapp_webhook[\s\S]*origin[\s\S]*whatsapp_business_app[\s\S]*event_kind[\s\S]*message_echo/);
  assert.match(repair, /source[\s\S]*panel[\s\S]*outbound_origin[\s\S]*crm_manual_text/);
  assert.match(repair, /record_human_takeover_activity_by_system/);
  assert.match(repair, /automatic_panel_human_message/);
  assert.doesNotMatch(repair, /returns public\.messages/);
});

test("4-T3 connects the real takeover wrapper to ensure after the existing transition", () => {
  assert.match(repair, /v_return_marker text := \$marker\$return;\$marker\$/);
  assert.match(repair, /P19A_4_T3_TAKEOVER_PATCH_MARKER_MISSING_OR_ALREADY_PRESENT/);
  assert.match(repair, /perform public\.ensure_human_takeover_lease_by_system\(p_conversation_id\);[\s\S]*return;/);
  assert.match(repair, /transition_conversation_state_by_user/);
  assert.match(repair, /transition_conversation_state_internal/);
});

test("4-T3-K connects both authorized human-release returns after transition", () => {
  assert.match(repair, /do \$release_patch\$/);
  assert.match(repair, /P19A_4_T3_RELEASE_PATCH_MARKER_MISSING_OR_ALREADY_PRESENT/);
  assert.match(repair, /perform public\.release_human_takeover_lease_by_system\(p_conversation_id, p_reason\);[\s\S]*return;/);
  assert.match(repair, /human_release_conversation_to_ai\(uuid,text,text\)'::regprocedure/);
  assert.match(repair, /pg_catalog\.pg_proc%rowtype/);
  assert.match(repair, /prosecdef/);
  assert.match(repair, /search_path=pg_catalog, pg_temp/);
  const releasePatch = repair.slice(repair.indexOf("do $release_patch$"), repair.indexOf("$release_patch$;"));
  assert.equal((releasePatch.match(/perform public\.release_human_takeover_lease_by_system\(p_conversation_id, p_reason\);/g) || []).length, 1);
  assert.equal((releasePatch.match(/v_marker text := \$marker\$return;\$marker\$/g) || []).length, 1);
});

test("4-T3-K preserves release atomicity, hard hold, idempotency, and no timeout release", () => {
  const patchStart = repair.indexOf("do $release_patch$");
  const patchEnd = repair.indexOf("$release_patch$;", patchStart);
  const patch = repair.slice(patchStart, patchEnd);
  assert.match(patch, /replace\(v_definition, v_marker, v_replacement\)/);
  assert.match(repair, /legacy takeover release cannot cross active hard hold or scope/);
  assert.match(repair, /where conversation_id = p_conversation_id[\s\S]*organization_id = v_conversation\.organization_id[\s\S]*store_id = v_store_id/);
  assert.match(repair, /released_at is null[\s\S]*then pg_catalog\.clock_timestamp\(\)/);
  const p0 = repair.slice(repair.indexOf("v_p0 text"), repair.indexOf("v_insert_message text"));
  assert.doesNotMatch(p0, /human_release_conversation_to_ai|40 minutes|hybrid_human_timeout_auto_release/);
});

test("4-T3-N.2 removes direct service_role release while preserving the authenticated wrapper", () => {
  assert.match(repair, /revoke execute on function public\.release_human_takeover_lease_by_system\(uuid, text\) from service_role/);
  assert.match(repair, /has_function_privilege\('service_role', 'public\.release_human_takeover_lease_by_system\(uuid,text\)', 'EXECUTE'\) then/);
  assert.match(repair, /human_release_conversation_to_ai\(uuid,text,text\)'::regprocedure/);
  assert.match(repair, /transition_conversation_state_by_user/);
  assert.doesNotMatch(repair, /grant execute on function public\.release_human_takeover_lease_by_system\(uuid, text\) to service_role/);
});

test("4-T3 preflight does not require post-install takeover or ACL state", () => {
  const preflight = repair.slice(repair.indexOf("do $preflight$"), repair.indexOf("$preflight$;"));
  assert.doesNotMatch(preflight, /strpos\(v_takeover, 'ensure_human_takeover_lease_by_system'\) = 0/);
  assert.doesNotMatch(preflight, /has_function_privilege\(/);
  assert.match(preflight, /TARGET_TABLE_ALREADY_EXISTS/);
});

test("4-T3 matches existing processor and AI fence contracts", () => {
  assert.match(processor, /human_takeover_conversation/);
  assert.match(processor, /whatsapp_business_app_intervention/);
  assert.match(processor, /human_activity_key/);
  assert.match(processor, /human_activity_at/);
  assert.match(repair, /ensure_human_takeover_lease_by_system\(uuid\)/);
  assert.match(repair, /takeover_started_at = case/);
  assert.match(repair, /v_ensure, 'takeover_started_at = case'/);
  assert.match(repair, /v_ensure, 'released_at is not null'/);
  assert.match(repair, /insert_message\(uuid,text,text,text,text,text,text,jsonb\)/);
  assert.match(repair, /record_human_takeover_activity_by_system/);
  assert.match(aiFence, /conversation_human_takeover_leases/);
  assert.match(aiFence, /hard_hold/);
});

test("4-T3 covers the real message_echo to AI-blocking chain", () => {
  const echoStart = processor.indexOf("async function processHumanAppEcho");
  const echoEnd = processor.indexOf("async function ", echoStart + 1);
  const echoFlow = processor.slice(echoStart, echoEnd === -1 ? undefined : echoEnd);
  assert.match(echoFlow, /event_kind.*message_echo|message_echo/);
  assert.match(echoFlow, /insertHumanAppEchoMessage/);
  assert.match(echoFlow, /human_takeover_conversation/);
  assert.match(repair, /record_human_takeover_activity_by_system/);
  assert.match(repair, /human_takeover_conversation/);
  assert.match(aiFence, /conversation_human_takeover_leases/);
  assert.match(aiFence, /released_at/);
  assert.match(aiFence, /hard_hold/);
});

test("4-T3 assigns takeover authority once per source", () => {
  const patchStart = repair.indexOf("do $insert_message_patch$");
  const patchEnd = repair.indexOf("$insert_message_patch$;", patchStart);
  const patch = repair.slice(patchStart, patchEnd);
  const replacementStart = patch.indexOf("v_replacement text :=");
  const replacementEnd = patch.indexOf("begin", replacementStart);
  const replacement = patch.slice(replacementStart, replacementEnd);
  assert.match(patch, /message_echo/);
  assert.match(patch, /automatic_panel_human_message/);
  assert.equal((replacement.match(/human_takeover_conversation/g) || []).length, 1);
  assert.match(processor, /message_echo/);
  assert.match(processor, /human_takeover_conversation/);
});

test("4-T3 regression: released takeover starts a new temporal version", () => {
  assert.match(repair, /takeover_started_at = case[\s\S]*when v_lease\.released_at is not null then v_activity_at/);
  assert.match(repair, /last_human_activity_at = case[\s\S]*when v_lease\.released_at is not null then v_activity_at/);
  assert.match(repair, /else greatest\(v_lease\.last_human_activity_at, v_activity_at\)/);
});

test("4-T3 regression: tenant inconsistency fails closed before lease update", () => {
  const writerStart = repair.indexOf("create function public.record_human_takeover_activity_by_system");
  const writerEnd = repair.indexOf("$function$;", writerStart);
  const writer = repair.slice(writerStart, writerEnd);
  assert.match(writer, /v_lease\.organization_id is distinct from p_organization_id/);
  assert.match(writer, /v_lease\.store_id is distinct from p_store_id/);
  assert.match(writer, /raise exception using errcode = '42501'/);
  assert.doesNotMatch(writer, /set organization_id = excluded/);
  assert.doesNotMatch(writer, /set store_id = excluded/);
});

test("4-T3 remote SQL is never invoked by the local contract test", () => {
  assert.doesNotMatch(repair, /supabase\.rpc|fetch\(|axios|curl|psql/i);
});

test("4-T3-M.2 separates comparable read-only snapshots from the transactional rehearsal", () => {
  const before = readFileSync(join(root, "supabase/repairs/20261124120000_p19a_4_t3_m2_snapshot_before.sql"), "utf8");
  const after = readFileSync(join(root, "supabase/repairs/20261124120001_p19a_4_t3_m2_snapshot_after.sql"), "utf8");
  const rehearsal = readFileSync(join(root, "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.transactional-rehearsal.sql"), "utf8");
  const comparable = (sql) => sql.slice(sql.indexOf("with targets"))
    .replace(/'A'::text as snapshot_phase/g, "'PHASE'::text as snapshot_phase")
    .replace(/'C'::text as snapshot_phase/g, "'PHASE'::text as snapshot_phase");
  assert.equal(comparable(before), comparable(after));
  assert.match(before, /definition_md5/);
  assert.match(before, /acl/);
  assert.match(after, /snapshot_phase/);
  assert.doesNotMatch(before, /\b(create|insert|update|delete|grant|alter|drop)\s+/i);
  assert.doesNotMatch(after, /\b(create|insert|update|delete|grant|alter|drop)\s+/i);
  assert.doesNotMatch(rehearsal, /p19a_4_t3_j1_baseline_(objects|existing_functions)/);
  assert.doesNotMatch(rehearsal, /create\s+temp\s+table|pg_temp\.p19a_4_t3/i);
  assert.match(rehearsal, /'public\.human_release_conversation_to_ai\(uuid,text,text\)'/);
  assert.match(rehearsal, /human_release_conversation_to_ai\(uuid,text,text\)'::regprocedure/);
  assert.match(rehearsal, /search_path=pg_catalog, pg_temp/);
  assert.match(rehearsal, /search_path=public, pg_temp/);
  assert.match(rehearsal, /has_function_privilege\('authenticated', v_proc\.oid, 'EXECUTE'\)\n     or pg_catalog\.strpos/);
  assert.equal((rehearsal.match(/^\s*begin;\s*$/gmi) || []).length, 1);
  assert.equal((rehearsal.match(/^\s*rollback;\s*$/gmi) || []).length, 1);
  assert.doesNotMatch(rehearsal, /^\s*commit;/gmi);
});

test("4-T3-L.3 keeps the rehearsal repair textually identical to the original repair", () => {
  const rehearsal = readFileSync(join(root, "supabase/repairs/20261123230000_p19a_4_t3_human_takeover_contract_repair.transactional-rehearsal.sql"), "utf8");
  const originalBegin = repair.indexOf("begin;");
  const originalCommit = repair.lastIndexOf("commit;");
  const rehearsalBegin = rehearsal.indexOf("begin;");
  const rehearsalRepairEnd = rehearsal.indexOf("-- Pos-condicoes do ensaio");
  assert.notEqual(originalBegin, -1);
  assert.notEqual(originalCommit, -1);
  assert.notEqual(rehearsalBegin, -1);
  assert.notEqual(rehearsalRepairEnd, -1);
  const originalInternal = repair.slice(originalBegin + "begin;".length, originalCommit);
  const rehearsalInternal = rehearsal.slice(rehearsalBegin + "begin;".length, rehearsalRepairEnd);
  assert.equal(rehearsalInternal, originalInternal);
});
