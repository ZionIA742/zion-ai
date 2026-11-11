import { strict as assert } from "node:assert";
import { getSafeInternalLoginRedirect } from "./auth-safe-redirect";

assert.equal(
  getSafeInternalLoginRedirect("/whatsapp-number-change?token=original-token"),
  "/whatsapp-number-change?token=original-token",
  "number-change token survives as an internal redirect",
);
assert.equal(
  getSafeInternalLoginRedirect("/crm/lead/lead-1"),
  "/crm/lead/lead-1",
  "conventional internal login destinations remain supported",
);
assert.equal(
  getSafeInternalLoginRedirect("/whatsapp-number-change"),
  null,
  "number-change redirect without token is rejected",
);
for (const value of [
  "https://evil.example/steal",
  "//evil.example/steal",
  "/\\\\evil.example/steal",
  "/whatsapp-number-change?token=%E0%A4%A",
]) {
  assert.equal(getSafeInternalLoginRedirect(value), null, `unsafe redirect rejected: ${value}`);
}

console.log("auth-safe-redirect: 7 tests passed");
