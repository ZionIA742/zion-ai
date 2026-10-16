import { strict as assert } from "node:assert";
import {
  createSalesAiErrorDiagnostic,
  formatSalesAiProcessingError,
} from "./sales-ai-error-diagnostics";

const diagnostic = createSalesAiErrorDiagnostic(
  "write_commercial_message_intent_resolution_by_system",
  {
    code: "23505",
    constraint: "commercial_message_intent_resolution_operation_key_key",
    message: "phone=+5511999999999 secret=do-not-persist",
    details: "raw payload",
  },
);

assert.deepEqual(diagnostic, {
  authority: "write_commercial_message_intent_resolution_by_system",
  sqlstate: "23505",
  constraint: "commercial_message_intent_resolution_operation_key_key",
  reason: null,
});

const safeText = formatSalesAiProcessingError(
  "SALES_AI_REPLY_SET_MATERIALIZATION_FAILED",
  createSalesAiErrorDiagnostic("materialize_sales_ai_reply_set_by_system", {
    code: "not-a-sqlstate",
    constraint: "token:secret",
    message: "customer@example.com password=secret",
  }),
);

assert.equal(
  safeText,
  "SALES_AI_REPLY_SET_MATERIALIZATION_FAILED;authority=materialize_sales_ai_reply_set_by_system;sqlstate=unknown;constraint=unknown;reason=unknown",
);
assert.equal(safeText.includes("customer@example.com"), false);
assert.equal(safeText.includes("password"), false);
assert.equal(safeText.includes("secret"), false);

const customPostgresReason = createSalesAiErrorDiagnostic(
  "write_commercial_message_intent_resolution_by_system",
  { code: "P0001", message: "P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED" },
);
assert.equal(customPostgresReason.reason, "P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED");
assert.equal(
  formatSalesAiProcessingError("WRITE_CANONICAL_INTENT_RESOLUTION_FAILED", customPostgresReason),
  "WRITE_CANONICAL_INTENT_RESOLUTION_FAILED;authority=write_commercial_message_intent_resolution_by_system;sqlstate=P0001;constraint=unknown;reason=P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED",
);

for (const message of [
  "P19A_I8_EXTERNAL_OPPORTUNITY_REQUIRED details=free-text",
  "P9_QUOTE_FAILED customer@example.com",
  "P9_QUOTE_FAILED phone=5511999999999",
  "P9_QUOTE_FAILED ",
]) {
  assert.equal(
    createSalesAiErrorDiagnostic("materialize_sales_ai_reply_set_by_system", { message }).reason,
    null,
    message,
  );
}

console.log("sales-ai-error-diagnostics: 3 tests passed");
