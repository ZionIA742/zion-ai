import assert from "node:assert/strict";
import test from "node:test";
import { resolvePaymentProofDecision } from "./payment-proof-decision";

test("payment decisions accept only standalone SIM/NAO", () => {
  assert.equal(resolvePaymentProofDecision("SIM"), "yes");
  assert.equal(resolvePaymentProofDecision("não"), "no");
  assert.equal(resolvePaymentProofDecision("sim, pode confirmar"), null);
});
