import assert from "node:assert/strict";
import test from "node:test";
import { buildPdfFileName } from "./contract-storage";

test("todo PDF novo de contrato comeca por contrato", () => {
  assert.match(buildPdfFileName("248", "contract-1", "abc123"), /^contrato-/);
  assert.match(buildPdfFileName("Contrato 248", "contract-1", "abc123"), /^contrato-/);
  assert.match(buildPdfFileName(null, "contract-1", "abc123"), /^contrato-/);
});

console.log("contract-storage: PASS");
