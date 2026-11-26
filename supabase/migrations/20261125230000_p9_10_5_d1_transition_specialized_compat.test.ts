import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261125230000_p9_10_5_d1_transition_specialized_compat.sql",
  ),
  "utf8",
);

assert.match(migration, /ZION_NEGOTIATION_SPECIALIZED_WRITER_REQUIRED/);
assert.match(migration, /record_human_stage_decision_evidence_internal/);
assert.match(migration, /membership_row\.is_active is true/);
assert.match(migration, /security definer/);
assert.match(migration, /grant execute on function public\.transition_commercial_opportunity_stage_by_user/);
assert.match(migration, /P9_10_5_D1_TRANSITION_COMPAT_POSTCONDITION_FAILED/);

const casInternalName = "apply_commercial_qualification_fact_internal_if_current";
const casUserName = "write_commercial_qualification_fact_by_user_if_current";
assert.ok(casInternalName.length <= 63);
assert.ok(casUserName.length <= 63);

console.log("p9-10-5-d1-transition-compat: PASS");
