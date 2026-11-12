import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

const { Client } = await import("pg").catch(() => ({ Client: null }));
const PROJECT_REF = "bcrvbdyfxdarmftwsgxk";
const ORGANIZATION_ID = "b02252ce-0e73-4371-9e23-f1009e7b1698";
const STORE_ID = "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b";
const AUTH_ENV = "P19A_CONCURRENCY_RUN";
const URL_ENV = "P19A_CONCURRENCY_DATABASE_URL";
const PASSWORD_ENV = "P19A_CONCURRENCY_DATABASE_PASSWORD";
const MANIFEST_ENV = "P19A_CONCURRENCY_MANIFEST_PATH";
const AUTH_VALUE = "CONFIRM_LOCAL_ONLY";
const TIMEOUT_MS = 8000;
const MANIFEST_VERSION = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function fail(code, error) {
  const suffix = error && error.code ? " code=" + String(error.code) : "";
  console.error("P19A runner blocked: " + code + suffix);
  process.exitCode = 2;
}

function assertUuid(value, label) {
  if (!UUID_RE.test(String(value || ""))) throw new Error(label + "_invalid");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(value)) throw new Error("catalog_identifier_invalid");
  return '"' + value.replaceAll('"', '""') + '"';
}

function getManifestPath(value, runId) {
  const fallback = join(tmpdir(), "p19a-quote-preparation-manifest-" + (runId || "recovery") + ".json");
  const resolved = value || process.env[MANIFEST_ENV] || fallback;
  const validName = /^p19a-quote-preparation-manifest-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
  if (!isAbsolute(resolved) || !validName.test(basename(resolved))) {
    throw new Error("manifest_path_must_be_absolute_and_uuid_named");
  }
  return resolved;
}

async function writeManifest(path, manifest) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await fs.open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  } finally {
    await handle.close();
  }
}

async function readManifest(path) {
  const manifest = JSON.parse(await fs.readFile(path, "utf8"));
  if (
    manifest?.manifestVersion !== MANIFEST_VERSION ||
    manifest?.projectRef !== PROJECT_REF ||
    manifest?.organizationId !== ORGANIZATION_ID ||
    manifest?.storeId !== STORE_ID ||
    !UUID_RE.test(manifest?.runId || "") ||
    manifest?.marker !== "p19a-concurrency-" + manifest.runId
  ) {
    throw new Error("manifest_identity_invalid");
  }
  assertUuid(manifest.customerId, "customerId");
  assertUuid(manifest.opportunityId, "opportunityId");
  return manifest;
}

function connectionOptions(applicationName) {
  if (!Client) throw new Error("pg_dependency_missing");
  const url = process.env[URL_ENV] || "";
  const password = process.env[PASSWORD_ENV] || "";
  if (!url || !password) throw new Error("database_credentials_required_at_runtime");
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith(".pooler.supabase.com")) {
    throw new Error("database_host_must_be_supabase_session_pooler");
  }
  if (parsed.username !== "postgres." + PROJECT_REF) {
    throw new Error("database_user_must_target_fixed_project");
  }
  parsed.password = "";
  return {
    connectionString: parsed.toString(),
    password,
    application_name: applicationName,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: TIMEOUT_MS,
    statement_timeout: TIMEOUT_MS,
    query_timeout: TIMEOUT_MS,
  };
}

async function openClient(applicationName) {
  const client = new Client(connectionOptions(applicationName));
  await client.connect();
  return client;
}

async function begin(client, readOnly) {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = " + TIMEOUT_MS);
  await client.query("SET LOCAL lock_timeout = '4s'");
  await client.query("SET LOCAL request.jwt.claim.role = 'service_role'");
  if (readOnly) await client.query("SET TRANSACTION READ ONLY");
}

async function rollbackAndEnd(client, criticalCode) {
  if (!client) return;
  let failure = null;
  try { await client.query("ROLLBACK"); } catch (error) { failure = error; }
  try { await client.end(); } catch (error) { failure ||= error; }
  if (failure) throw new Error(criticalCode || "ROLLBACK_CRITICAL");
}

async function assertProjectStoreAndRpc(client) {
  const current = await client.query("select current_user as current_user");
  if (String(current.rows[0]?.current_user || "").includes("service_role")) {
    throw new Error("database_session_user_must_not_be_service_role");
  }
  const store = await client.query(
    "select 1 from public.stores where id = $1::uuid and organization_id = $2::uuid",
    [STORE_ID, ORGANIZATION_ID],
  );
  if (store.rowCount !== 1) throw new Error("zion_store_organization_mismatch");
  const rpc = await client.query(
    "select to_regprocedure('public.register_quote_preparation_operation_by_system(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,text,text)') as procedure",
  );
  if (!rpc.rows[0]?.procedure) throw new Error("register_rpc_not_installed");
}

async function assertNoCollisions(client, fixture) {
  const identityChecks = [
    ["customers", "id", fixture.customerId],
    ["commercial_opportunities", "id", fixture.opportunityId],
    ["leads", "id", fixture.leadId],
    ["conversations", "id", fixture.conversationId],
    ["messages", "id", fixture.messageId],
    ["commercial_opportunity_profile_versions", "id", fixture.profileVersionId],
  ];
  for (const [table, column, value] of identityChecks) {
    const result = await client.query(
      "select " + quoteIdent(column) + " from public." + quoteIdent(table) +
      " where " + quoteIdent(column) + " = $1::uuid limit 1",
      [value],
    );
    if (result.rowCount) throw new Error("synthetic_uuid_collision_" + table + "_" + column);
  }
  const operation = await client.query(
    "select id from public.p19a_quote_preparation_operations where organization_id = $1::uuid and store_id = $2::uuid and operation_key = $3::text limit 1",
    [fixture.organizationId, fixture.storeId, fixture.operationKey],
  );
  if (operation.rowCount) throw new Error("synthetic_operation_key_collision");
}

async function assertZeroOperations(client, fixture) {
  const result = await client.query(
    "select (select count(*) from public.p19a_quote_preparation_operations where organization_id = $1::uuid and store_id = $2::uuid and commercial_opportunity_id = $3::uuid) as opportunity_count, (select count(*) from public.p19a_quote_preparation_operations where organization_id = $1::uuid and store_id = $2::uuid and operation_key = $4::text) as key_count",
    [fixture.organizationId, fixture.storeId, fixture.opportunityId, fixture.operationKey],
  );
  if (
    Number(result.rows[0]?.opportunity_count) !== 0 ||
    Number(result.rows[0]?.key_count) !== 0
  ) {
    throw new Error("P19A_OPERATION_RESIDUE");
  }
}

function newFixture() {
  const runId = randomUUID();
  const marker = "p19a-concurrency-" + runId;
  return {
    runId,
    marker,
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    customerId: randomUUID(),
    opportunityId: randomUUID(),
    leadId: randomUUID(),
    conversationId: randomUUID(),
    messageId: randomUUID(),
    profileVersionId: randomUUID(),
    operationKey: "p19a-concurrency-" + runId,
    fingerprint: sha256(marker),
    fixtureCommitted: false,
  };
}

function manifestFor(fixture) {
  return {
    manifestVersion: MANIFEST_VERSION,
    projectRef: PROJECT_REF,
    runId: fixture.runId,
    marker: fixture.marker,
    organizationId: fixture.organizationId,
    storeId: fixture.storeId,
    customerId: fixture.customerId,
    opportunityId: fixture.opportunityId,
    operationKey: fixture.operationKey,
    fingerprint: fixture.fingerprint,
  };
}

async function createFixture(fixture) {
  const client = await openClient("p19a-concurrency-fixture-" + fixture.runId);
  try {
    await assertProjectStoreAndRpc(client);
    await begin(client, false);
    await assertNoCollisions(client, fixture);
    await client.query(
      "insert into public.customers (id, organization_id, display_name) values ($1::uuid, $2::uuid, $3::text)",
      [fixture.customerId, fixture.organizationId, fixture.marker],
    );
    await client.query(
      "insert into public.commercial_opportunities (id, organization_id, store_id, customer_id, origin_lead_id, primary_conversation_id, stage) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, null, null, 'novo_lead')",
      [fixture.opportunityId, fixture.organizationId, fixture.storeId, fixture.customerId],
    );
    await client.query("COMMIT");
    fixture.fixtureCommitted = true;
  } catch (error) {
    try {
      await rollbackAndEnd(client);
    } catch (rollbackError) {
      const critical = new Error("FIXTURE_ROLLBACK_CRITICAL");
      critical.cause = rollbackError;
      throw critical;
    }
    throw error;
  }
  await client.end();
}

function rpcParams(fixture) {
  return [
    fixture.organizationId,
    fixture.storeId,
    fixture.leadId,
    fixture.conversationId,
    fixture.opportunityId,
    fixture.messageId,
    fixture.profileVersionId,
    1,
    fixture.operationKey,
    fixture.fingerprint,
  ];
}

async function waitForLock(observer, backendPid, applicationName) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await observer.query(
      "select pid, application_name, state, query, wait_event_type from pg_stat_activity where pid = $1 and application_name = $2 and state = 'active' and query ilike '%register_quote_preparation_operation_by_system%' and wait_event_type = 'Lock'",
      [backendPid, applicationName],
    );
    if (result.rowCount === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("rpc_lock_wait_not_observed");
}

async function runRollbackConcurrency(fixture) {
  let a = null;
  let b = null;
  let observer = null;
  let bCall = Promise.resolve({ ok: false, error: null });
  try {
    a = await openClient("p19a-concurrency-a-" + fixture.runId);
    b = await openClient("p19a-concurrency-b-" + fixture.runId);
    observer = await openClient("p19a-concurrency-observer-" + fixture.runId);
    await begin(a, false);
    await begin(b, false);
    const locked = await a.query(
      "select id from public.commercial_opportunities where id = $1::uuid and organization_id = $2::uuid and store_id = $3::uuid for update",
      [fixture.opportunityId, fixture.organizationId, fixture.storeId],
    );
    if (locked.rowCount !== 1) throw new Error("fixture_opportunity_lock_not_acquired");
    const bApplication = "p19a-concurrency-b-" + fixture.runId;
    const bPidResult = await b.query("select pg_backend_pid() as pid");
    const bPid = Number(bPidResult.rows[0]?.pid);
    bCall = b.query(
      "select * from public.register_quote_preparation_operation_by_system($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::integer,$9::text,$10::text)",
      rpcParams(fixture),
    ).then(
      (value) => ({ ok: true, value, error: null }),
      (error) => ({ ok: false, value: null, error }),
    );
    await waitForLock(observer, bPid, bApplication);
    await a.query("ROLLBACK");
    const bOutcome = await bCall;
    if (
      bOutcome.ok ||
      !bOutcome.error ||
      !String(bOutcome.error.message).includes("P19A_QUOTE_PREP_LEAD_NOT_FOUND")
    ) {
      throw new Error("unexpected_rpc_outcome");
    }
    await b.query("ROLLBACK");
    await assertZeroOperations(observer, fixture);
    console.log("rollback_lock_scenario=PASS outcome=P19A_QUOTE_PREP_LEAD_NOT_FOUND");
  } finally {
    const closed = await Promise.allSettled([
      a ? rollbackAndEnd(a, "ROLLBACK_CRITICAL") : Promise.resolve(),
      Promise.all([
        bCall,
        b ? rollbackAndEnd(b, "ROLLBACK_CRITICAL") : Promise.resolve(),
      ]),
      observer ? rollbackAndEnd(observer, "OBSERVER_CLOSE_CRITICAL") : Promise.resolve(),
    ]);
    const failure = closed.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}

async function foreignKeysReferencing(client, parentTable) {
  const result = await client.query(
    "select child.relname as child_table, parent.relname as parent_table, con.conname as constraint_name, con.confdeltype as delete_action, array_agg(child_att.attname order by child_pos.n) as child_columns, array_agg(parent_att.attname order by parent_pos.n) as parent_columns from pg_constraint con join pg_class child on child.oid = con.conrelid join pg_namespace child_ns on child_ns.oid = child.relnamespace join pg_class parent on parent.oid = con.confrelid join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace cross join lateral unnest(con.conkey) with ordinality as child_pos(attnum, n) join lateral unnest(con.confkey) with ordinality as parent_pos(attnum, n) on parent_pos.n = child_pos.n join pg_attribute child_att on child_att.attrelid = child.oid and child_att.attnum = child_pos.attnum join pg_attribute parent_att on parent_att.attrelid = parent.oid and parent_att.attnum = parent_pos.attnum where con.contype = 'f' and child_ns.nspname = 'public' and parent_ns.nspname = 'public' and parent.relname = $1 group by child.relname, parent.relname, con.conname, con.confdeltype",
    [parentTable],
  );
  return result.rows;
}

async function assertNoUnexpectedDependents(client, parentTable, parentId, fixture) {
  const edges = await foreignKeysReferencing(client, parentTable);
  for (const edge of edges) {
    if (edge.child_columns.length !== edge.parent_columns.length) {
      throw new Error("CLEANUP_CRITICAL_fk_shape_" + parentTable);
    }
    const join = edge.child_columns.map((column, index) =>
      "c." + quoteIdent(column) + " = p." + quoteIdent(edge.parent_columns[index]),
    ).join(" and ");
    const result = await client.query(
      "select to_jsonb(c)->>'id' as child_id, c.ctid::text as row_locator from public." + quoteIdent(edge.child_table) +
      " c join public." + quoteIdent(edge.parent_table) + " p on " + join +
      " where p.id = $1::uuid for update of c",
      [parentId],
    );
    if (!result.rowCount) continue;
    const expected = parentTable === "customers" &&
      edge.child_table === "commercial_opportunities" &&
      result.rowCount === 1 &&
      result.rows[0].child_id === fixture.opportunityId;
    if (expected) continue;
    throw new Error("CLEANUP_CRITICAL_unexpected_dependency_" + parentTable + "_" + edge.child_table);
  }
}

async function verifyExactFixtureRows(client, fixture) {
  const customer = await client.query(
    "select id, organization_id, display_name from public.customers where id = $1::uuid for update",
    [fixture.customerId],
  );
  const opportunity = await client.query(
    "select id, organization_id, store_id, customer_id, origin_lead_id, primary_conversation_id from public.commercial_opportunities where id = $1::uuid for update",
    [fixture.opportunityId],
  );
  if (customer.rowCount !== 1 || opportunity.rowCount !== 1) {
    throw new Error("CLEANUP_CRITICAL_fixture_row_missing_or_duplicated");
  }
  const c = customer.rows[0];
  const o = opportunity.rows[0];
  if (
    c.organization_id !== fixture.organizationId ||
    c.display_name !== fixture.marker ||
    o.organization_id !== fixture.organizationId ||
    o.store_id !== fixture.storeId ||
    o.customer_id !== fixture.customerId ||
    o.origin_lead_id !== null ||
    o.primary_conversation_id !== null
  ) {
    throw new Error("CLEANUP_CRITICAL_fixture_identity_mismatch");
  }
}

async function cleanupFixture(fixture) {
  if (!fixture.fixtureCommitted) return;
  const client = await openClient("p19a-concurrency-cleanup-" + fixture.runId);
  try {
    await begin(client, false);
    await verifyExactFixtureRows(client, fixture);
    await assertNoUnexpectedDependents(client, "commercial_opportunities", fixture.opportunityId, fixture);
    await assertNoUnexpectedDependents(client, "customers", fixture.customerId, fixture);
    await client.query(
      "delete from public.commercial_opportunities where id = $1::uuid and organization_id = $2::uuid and store_id = $3::uuid and customer_id = $4::uuid",
      [fixture.opportunityId, fixture.organizationId, fixture.storeId, fixture.customerId],
    );
    await client.query(
      "delete from public.customers where id = $1::uuid and organization_id = $2::uuid and display_name = $3::text",
      [fixture.customerId, fixture.organizationId, fixture.marker],
    );
    const zero = await client.query(
      "select (select count(*) from public.customers where id = $1::uuid) as customers, (select count(*) from public.commercial_opportunities where id = $2::uuid) as opportunities",
      [fixture.customerId, fixture.opportunityId],
    );
    if (zero.rows[0].customers !== "0" || zero.rows[0].opportunities !== "0") {
      throw new Error("CLEANUP_CRITICAL_zero_residue_not_proven");
    }
    await client.query("COMMIT");
    fixture.fixtureCommitted = false;
    await assertZeroOperations(client, fixture);
    console.log("cleanup=PASS rows=2");
  } catch (error) {
    try { await rollbackAndEnd(client); } catch (rollbackError) {
      const critical = new Error("CLEANUP_CRITICAL");
      critical.cause = rollbackError;
      throw critical;
    }
    const critical = new Error(
      String(error.message || "").startsWith("CLEANUP_CRITICAL") ? error.message : "CLEANUP_CRITICAL",
    );
    critical.cause = error;
    throw critical;
  }
  await client.end();
}

async function recoveryReadOnly(path) {
  const manifest = await readManifest(path);
  const client = await openClient("p19a-concurrency-recovery-" + manifest.runId);
  try {
    await begin(client, true);
    const rows = await client.query(
      "select (select count(*) from public.customers where id = $1::uuid) as customers, (select count(*) from public.commercial_opportunities where id = $2::uuid) as opportunities",
      [manifest.customerId, manifest.opportunityId],
    );
    console.log("cleanup_read_only customers=" + rows.rows[0].customers + " opportunities=" + rows.rows[0].opportunities);
  } finally {
    await rollbackAndEnd(client, "RECOVERY_CLOSE_CRITICAL");
  }
}

async function main() {
  if (process.argv[2] === "--cleanup") {
    await recoveryReadOnly(getManifestPath(process.argv[3], null));
    return;
  }
  if (process.argv[2] !== "--rollback-a" || process.argv.length !== 3) {
    throw new Error("usage_requires_rollback_a_or_cleanup");
  }
  if (process.env[AUTH_ENV] !== AUTH_VALUE) throw new Error("AUTHORIZATION_REQUIRED");
  const fixture = newFixture();
  const path = getManifestPath(null, fixture.runId);
  await writeManifest(path, manifestFor(fixture));
  try {
    await createFixture(fixture);
    await runRollbackConcurrency(fixture);
  } finally {
    if (fixture.fixtureCommitted) {
      await cleanupFixture(fixture);
      await fs.unlink(path);
    }
  }
}

try {
  await main();
} catch (error) {
  fail(error?.message || "RUNNER_FAILED", error);
}
