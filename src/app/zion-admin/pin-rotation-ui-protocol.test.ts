import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const { isListedSecretId, parsePreparedRotation, matchesAuthorizedRotation, isConfirmedPinRotation } = await import(
  new URL("./pin-rotation-ui-protocol.ts", import.meta.url).href
) as typeof import("./pin-rotation-ui-protocol");

const rotationId = "ab123456-4321-41ab-9def-123456789abc";
const operationId = "cd123456-4321-41ab-9def-123456789abc";
const valid = { ok: true, status: "prepared", rotationId, operationId, expiresInSeconds: 300 };
let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }

test("only canonical UUID secret ID may be selected", () => {
  assert.equal(isListedSecretId(rotationId), true);
  for (const bad of ["", "123", "1'.or", null, undefined, 7]) assert.equal(isListedSecretId(bad), false);
});
test("prepared response requires explicit success and matching status", () => {
  assert.deepEqual(parsePreparedRotation(true, valid), { rotationId, operationId, expiresInSeconds: 300 });
  assert.equal(parsePreparedRotation(false, valid), null);
  assert.equal(parsePreparedRotation(true, { ...valid, status: "unknown" }), null);
});
test("invalid or missing operation and rotation IDs fail closed", () => {
  for (const changes of [{ operationId: "xx" }, { rotationId: 0 }, { operationId: null }, { rotationId: null }]) {
    assert.equal(parsePreparedRotation(true, { ...valid, ...changes }), null);
  }
});
test("expiration never exceeds 300 seconds", () => {
  for (const expiration of [-1, 0, 301, 300.5, Number.NaN, "300"]) {
    assert.equal(parsePreparedRotation(true, { ...valid, expiresInSeconds: expiration }), null);
  }
});
test("reject malformed response bodies without throwing", () => {
  for (const input of [null, [], "ok", 0, true, { ok: true }]) {
    assert.equal(parsePreparedRotation(true, input), null);
  }
});
test("authorization must bind both exact operation IDs", () => {
  const authorized = { ok: true, status: "authorized", rotationId, operationId };
  assert.equal(matchesAuthorizedRotation(true, authorized, { rotationId, operationId }), true);
  assert.equal(matchesAuthorizedRotation(true, { ...authorized, operationId: rotationId }, { rotationId, operationId }), false);
  assert.equal(matchesAuthorizedRotation(false, authorized, { rotationId, operationId }), false);
});
test("only remote-completed response marks rotation confirmed", () => {
  assert.equal(isConfirmedPinRotation(true, { ok: true, status: "completed" }), true);
  for (const status of ["remote_uncertain", "remote_rejected", "authorization_rejected", "manual_reconciliation_required"]) {
    assert.equal(isConfirmedPinRotation(false, { ok: false, status }), false);
  }
  assert.equal(isConfirmedPinRotation(false, { ok: true, status: "completed" }), false);
});
test("untrusted server shape cannot be confirmed", () => {
  for (const value of [null, [], false, "completed", { ok: true }, { status: "completed" }]) {
    assert.equal(isConfirmedPinRotation(true, value), false);
  }
});
const dir = fileURLToPath(new URL(".", import.meta.url));
const controls = readFileSync(join(dir, "ZionAdminPinRotationControls.tsx"), "utf8");
const dashboard = readFileSync(join(dir, "ZionAdminDashboardClient.tsx"), "utf8");
const page = readFileSync(join(dir, "page.tsx"), "utf8");
test("two server flags and admin capability are all required", () => {
  assert.match(controls, /canAccess && rotationEnabled && executionEnabled/);
  assert.match(page, /ZION_ADMIN_WHATSAPP_PIN_ROTATION_ENABLED/);
  assert.match(page, /ZION_ADMIN_WHATSAPP_PIN_ROTATION_EXECUTION_ENABLED/);
});
test("separate user confirmation for prepare authorize execute", () => {
  assert.match(controls, /window\.confirm\(confirmation\)/);
  assert.match(controls, /action === "prepare"/);
  assert.match(controls, /action === "authorize"/);
  assert.match(controls, /action === "execute"/);
  assert.match(controls, /"Autorizar troca"/);
  assert.match(controls, /"Executar troca na Meta"/);
});
test("no PIN value, credential or raw phone in JSON payload", () => {
  const start = controls.indexOf("body: JSON.stringify({");
  assert.ok(start > 0);
  const request = controls.slice(start, controls.indexOf("}),", start));
  for (const forbidden of ["phoneNumberId", "accessToken", "newPin", "sessionBindingHash"]) {
    assert.equal(request.includes(forbidden), false, forbidden);
  }
  assert.match(controls, /credentials: "include"/);
});
test("unconfirmed Meta execution requires manual reconciliation without retry", () => {
  assert.match(controls, /setPhase\("reconciliation"\)/);
  assert.match(controls, /phase === "reconciliation"\) return/);
  assert.equal(controls.includes("localStorage"), true); // only prohibition comment
  assert.equal(controls.includes("localStorage.setItem"), false);
});
test("old reveal history and recovery stay in original card", () => {
  assert.match(dashboard, /<ZionAdminPinRotationControls/);
  assert.match(dashboard, /Histórico de PINs/);
  assert.match(dashboard, /Revelar PIN/);
  assert.match(dashboard, /function WhatsappPinRecoverySection/);
  assert.match(dashboard, /metaExecutionEnabled=\{whatsappPinRecoveryMetaEnabled\}/);
});
console.log(`TOTAL ${passed} tests PASS`);
