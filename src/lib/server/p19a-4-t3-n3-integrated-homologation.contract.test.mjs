import assert from "node:assert/strict";
import test from "node:test";
import { buildIntegratedRehearsal } from "../../../scripts/prepare-p19a-4-t3-n3-integrated-rehearsal.mjs";

const rehearsal = buildIntegratedRehearsal();

test("N.3 composes one transaction in repair then fences order", () => {
  assert.equal((rehearsal.match(/^begin;$/gim) || []).length, 1);
  assert.equal((rehearsal.match(/^rollback;$/gim) || []).length, 1);
  assert.equal((rehearsal.match(/^commit;$/gim) || []).length, 0);
  assert.ok(rehearsal.indexOf("$preflight$") < rehearsal.indexOf("$worker_patch$"));
  assert.ok(rehearsal.indexOf("$worker_patch$") < rehearsal.indexOf("$send_patch$"));
  assert.ok(rehearsal.indexOf("N2 fences depend") < rehearsal.indexOf("$worker_patch$"));
  assert.ok(rehearsal.indexOf("$send_patch$") < rehearsal.indexOf("N3_INTEGRATED_POSTCONDITION_FAILED"));
});

test("N.3 integrated postconditions preserve P0, panel authorization and tenant fences", () => {
  assert.match(rehearsal, /return0/);
  assert.match(rehearsal, /v_release_acl/);
  assert.match(rehearsal, /v_human_release_service_acl/);
  assert.match(rehearsal, /v_panel_acl/);
  assert.match(rehearsal, /v_panel_service_acl/);
  assert.match(rehearsal, /hard_hold/);
  assert.match(rehearsal, /released_at/);
  assert.match(rehearsal, /auth\.uid\(\)/);
  assert.match(rehearsal, /P19A_4_T3_N3_INTEGRATED_POSTCONDITION_FAILED/);
});
