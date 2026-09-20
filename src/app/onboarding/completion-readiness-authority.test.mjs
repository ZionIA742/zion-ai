import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase/migrations");

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .filter((name) => name.includes("p19a_onboarding_completion"))
  .sort();

const source = migrationFiles
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

const latestMigration = readFileSync(
  join(
    migrationsDir,
    "20260919210000_p19a_onboarding_completion_readiness_authority.sql",
  ),
  "utf8",
);

assert.equal(
  source.includes("read_store_onboarding_completion_readiness_scoped"),
  true,
  "canonical onboarding completion readiness reader must exist",
);

assert.equal(
  source.includes("resolve_store_onboarding_completion_readiness_internal"),
  true,
  "canonical onboarding completion readiness internal resolver must exist",
);

const resolverStart = latestMigration.indexOf(
  "create or replace function public.resolve_store_onboarding_completion_readiness_internal(",
);
const readerStart = latestMigration.indexOf(
  "create or replace function public.read_store_onboarding_completion_readiness_scoped(",
);
const completionStart = latestMigration.indexOf(
  "create or replace function public.onboarding_complete_store_onboarding_scoped(",
);

assert.equal(resolverStart >= 0, true);
assert.equal(readerStart > resolverStart, true);
assert.equal(completionStart > readerStart, true);

const resolverBlock = latestMigration.slice(resolverStart, readerStart);
const readerBlock = latestMigration.slice(readerStart, completionStart);
const completionBlock = latestMigration.slice(completionStart);

for (const authority of [
  'from public.stores',
  'from public.store_strategy_settings',
  'from public.store_responsibles',
  'from public.external_integrations',
]) {
  assert.equal(
    resolverBlock.includes(authority),
    true,
    `resolver must consume canonical authority: ${authority}`,
  );
}

for (const reason of [
  "P19A_ONBOARDING_NOT_READY:STORE_NAME",
  "P19A_ONBOARDING_NOT_READY:STRATEGY_SETTINGS",
  "P19A_ONBOARDING_NOT_READY:STORE_DESCRIPTION",
  "P19A_ONBOARDING_NOT_READY:CITY",
  "P19A_ONBOARDING_NOT_READY:STATE",
  "P19A_ONBOARDING_NOT_READY:STORE_SERVICES",
  "P19A_ONBOARDING_NOT_READY:PRIMARY_RESPONSIBLE",
  "P19A_ONBOARDING_NOT_READY:RESPONSIBLE_NAME",
  "P19A_ONBOARDING_NOT_READY:RESPONSIBLE_WHATSAPP",
  "P19A_ONBOARDING_NOT_READY:WHATSAPP_COMMERCIAL",
]) {
  assert.equal(
    resolverBlock.includes(reason),
    true,
    `resolver must preserve canonical reason: ${reason}`,
  );
}

assert.equal(
  readerBlock.includes(
    "public.resolve_store_onboarding_completion_readiness_internal(",
  ),
  true,
  "readiness reader must delegate to the canonical internal resolver",
);

assert.equal(
  completionBlock.includes(
    "public.resolve_store_onboarding_completion_readiness_internal(",
  ),
  true,
  "completion writer must delegate to the canonical internal resolver",
);

for (const duplicatedAuthority of [
  "from public.store_strategy_settings",
  "from public.store_responsibles",
  "from public.external_integrations",
]) {
  assert.equal(
    completionBlock.includes(duplicatedAuthority),
    false,
    `completion writer must not duplicate readiness authority: ${duplicatedAuthority}`,
  );
}

assert.equal(
  resolverBlock.includes("return null;"),
  true,
  "resolver must return NULL only when canonical readiness passes",
);

assert.equal(
  completionBlock.includes("if v_readiness_reason is not null then"),
  true,
  "completion writer must fail closed on canonical readiness reason",
);

const allCompletionMigrationSource = migrationFiles
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

const lastReaderStart = allCompletionMigrationSource.lastIndexOf(
  "create or replace function public.read_store_onboarding_completion_readiness_scoped(",
);

assert.equal(
  lastReaderStart >= 0,
  true,
  "latest canonical readiness reader definition must exist",
);

const afterLastReader = allCompletionMigrationSource.slice(lastReaderStart);
const nextFunctionOffset = afterLastReader.indexOf(
  "create or replace function ",
  "create or replace function ".length,
);

const latestReaderBlock =
  nextFunctionOffset >= 0
    ? afterLastReader.slice(0, nextFunctionOffset)
    : afterLastReader;

assert.equal(
  latestReaderBlock.includes("from public.store_onboarding"),
  true,
  "readiness reader must inspect canonical onboarding completion state",
);

assert.equal(
  latestReaderBlock.includes("status = 'completed'") ||
    latestReaderBlock.includes("= 'completed'"),
  true,
  "completed onboarding replay must remain ready in the canonical reader",
);
console.log("onboarding completion readiness authority: 1 test passed");