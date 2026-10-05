import assert from "node:assert/strict";
import test from "node:test";
import { classifyWhatsappConnectionScenario } from "./whatsapp-connection-scenario-router";

test("no binding routes to standard first connection", () => {
  assert.equal(classifyWhatsappConnectionScenario().scenario, "standard_first_connection");
});

test("active Zion binding routes away from first connection", () => {
  assert.equal(
    classifyWhatsappConnectionScenario({ hasActiveZionBinding: true }).scenario,
    "existing_zion_binding",
  );
});

test("existing change request routes to number change", () => {
  assert.equal(
    classifyWhatsappConnectionScenario({ hasExistingChangeRequest: true }).scenario,
    "zion_number_change_required",
  );
});

test("only explicit Meta evidence selects special scenarios", () => {
  assert.equal(
    classifyWhatsappConnectionScenario({ metaBusinessAppDetected: true }).scenario,
    "business_app_meta_flow",
  );
  assert.equal(
    classifyWhatsappConnectionScenario({ metaPersonalWhatsappDetected: true }).scenario,
    "personal_whatsapp_guidance_required",
  );
  assert.equal(
    classifyWhatsappConnectionScenario({ metaExternalBspDetected: true }).scenario,
    "external_bsp_migration_required",
  );
});

test("unknown, recoverable, and explicit error evidence remain distinct", () => {
  assert.equal(
    classifyWhatsappConnectionScenario({ metaErrorCode: "E_UNKNOWN" }).scenario,
    "unknown_meta_state",
  );
  assert.equal(
    classifyWhatsappConnectionScenario({ metaErrorMessage: "temporary timeout" }).scenario,
    "recoverable_error",
  );
  assert.equal(
    classifyWhatsappConnectionScenario({ metaErrorMessage: "business app coexistence" }).scenario,
    "business_app_meta_flow",
  );
  assert.equal(
    classifyWhatsappConnectionScenario({ metaErrorCode: "PERMISSION_DENIED" }).scenario,
    "blocking_error",
  );
});
