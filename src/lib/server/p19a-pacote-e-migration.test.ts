import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260904110000_p19a_commercial_gates_and_monthly_goal.sql",
  ),
  "utf8",
);

const manualCheck = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "tests",
    "20260904111000_p19a_commercial_gates_and_monthly_goal_manual_checks.sql",
  ),
  "utf8",
);

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "package E migration does not redefine legacy quote progress",
    run: () => {
      assert.equal(
        migration.includes(
          "create or replace function public.p9_resolve_quote_progress_internal",
        ),
        false,
      );
      assert.equal(
        migration.includes("create or replace function public.p9_resolve_definitive_quote_progress_internal"),
        true,
      );
    },
  },
  {
    name: "quote kind readiness covers preliminary policy and definitive visit gate",
    run: () => {
      assert.equal(
        migration.includes("create or replace function public.read_quote_kind_send_readiness_scoped"),
        true,
      );
      assert.equal(migration.includes("legacy_quote_kind_send"), true);
      assert.equal(migration.includes("preliminary_quote_before_technical_visit"), true);
      assert.equal(migration.includes("definitive_quote_requires_completed_technical_visit"), true);
    },
  },
  {
    name: "payment ledger has no vague correction event and reversal can go negative before blocking",
    run: () => {
      assert.equal(migration.includes("event_type in ('confirmation', 'reversal')"), true);
      assert.equal(migration.includes("'correction'"), false);
      assert.equal(migration.includes("v_next_amount := coalesce(v_next_amount, v_delta);"), true);
      assert.equal(migration.includes("PAYMENT_REVERSAL_EXCEEDS_CONFIRMED_AMOUNT"), true);
    },
  },
  {
    name: "payment ledger is tenant-scoped serialized and append-only",
    run: () => {
      assert.equal(
        /constraint\s+commercial_opportunity_payment_events_scope_operation_uidx\s+unique\s*\(\s*organization_id\s*,\s*store_id\s*,\s*commercial_opportunity_id\s*,\s*lifecycle_cycle\s*,\s*operation_key\s*\)/i.test(
          migration,
        ),
        true,
      );
      assert.equal(
        migration.includes("commercial_opportunity_payment_events_opportunity_fkey"),
        true,
      );
      assert.equal(
        migration.includes("commercial_opportunity_payment_events_append_only"),
        true,
      );
      assert.equal(
        migration.includes("ZION_PAYMENT_EVENTS_APPEND_ONLY"),
        true,
      );
      assert.equal(
        migration.includes("for update of opportunity_row"),
        true,
      );
      assert.equal(
        migration.includes("PAYMENT_REVERSAL_TARGET_REQUIRED"),
        true,
      );
      assert.equal(
        migration.includes("PAYMENT_REVERSAL_TARGET_INVALID"),
        true,
      );
      assert.equal(
        migration.includes("PAYMENT_REVERSAL_EXCEEDS_TARGET_AMOUNT"),
        true,
      );
      assert.equal(
        migration.includes("from public.memberships membership"),
        true,
      );
      assert.equal(
        migration.includes("membership.is_active is true"),
        true,
      );
      assert.equal(
        migration.includes("public.organization_memberships membership"),
        false,
      );
    },
  },
  {
    name: "payment behavioral runner covers settlement lifecycle",
    run: () => {
      for (const requiredText of [
        "Payment ledger behavioral checks.",
        "PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_AMOUNT",
        "payment_partially_confirmed",
        "payment_obligation_satisfied_by_human",
        "PAYMENT_OPERATION_KEY_REUSED",
        "PAYMENT_REVERSAL_TARGET_REQUIRED",
        "PAYMENT_REVERSAL_EXCEEDS_TARGET_AMOUNT",
        "ZION_PAYMENT_EVENTS_APPEND_ONLY",
        "payment current projection does not match append-only ledgers",
        "settlement actor_user_id is not auth.uid()",
      ]) {
        assert.equal(manualCheck.includes(requiredText), true, requiredText);
      }
    },
  },
  {
    name: "manual check covers requested quote, technical visit, payment, and monthly goal matrices",
    run: () => {
      for (const requiredText of [
        // Quote / visita / pagamento continuam cobertos.
        "legacy quote_kind null",
        "preliminary_quote_before_visit_allowed",
        "PAYMENT_REVERSAL_EXCEEDS_TARGET_AMOUNT",
        "correction is rejected",

        // Meta mensal ? runner comportamental real.
        "Monthly goal behavioral checks.",
        "FAIL: expected absent monthly goal row",
        "disabled monthly goal must normalize amount to NULL",
        "enabled monthly goal did not preserve exact cents",
        "enabled zero monthly goal was accepted",
        "enabled negative monthly goal was accepted",
        "NULL monthly_goal_enabled was accepted",
        "monthly goal RLS leaked another tenant",
        "mismatched store/organization scope was accepted",
        "authenticated must not mutate monthly goals directly",
        "service_role cannot impersonate human goal writer",
        "store_monthly_sales_goals_store_scope_fkey",
        "rollback;",
      ]) {
        assert.equal(manualCheck.includes(requiredText), true, requiredText);
      }
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`p19a-pacote-e-migration: ${tests.length} tests passed`);
