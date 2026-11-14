import { strict as assert } from "node:assert";
import { extractSafeAiRunEvidence } from "./zion-admin-ai-run-evidence";

export function runZionAdminAiRunEvidenceTests() {
  let passed = 0;

  function check(name: string, condition: () => void) {
    condition();
    passed++;
    console.log("PASS: " + name);
  }

  check("assistant explicit marker", () => {
    const result = extractSafeAiRunEvidence({
      input: { type: "assistant_chat" },
    });
    assert.equal(result.origin, "assistant_ai");
    assert.equal(result.execution_type, "assistant_chat");
  });

  check("unknown origin without marker", () => {
    assert.equal(extractSafeAiRunEvidence({}).origin, "unknown");
  });

  check("followup marker is not presumed sales", () => {
    assert.equal(
      extractSafeAiRunEvidence({
        input: { type: "followup_opportunity" },
      }).origin,
      "unknown",
    );
  });

  check("near-match marker is rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({
        input: { type: "assistant_chat " },
      }).origin,
      "unknown",
    );
  });

  check("allowed provider and model", () => {
    const result = extractSafeAiRunEvidence({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    assert.equal(result.provider, "openai");
    assert.equal(result.model, "gpt-4o-mini");
  });

  check("unrecognized provider rejected", () => {
    const result = extractSafeAiRunEvidence({
      provider: "openai_secret_value",
      model: "gpt-4o-mini",
    });
    assert.equal(result.provider, null);
    assert.equal(result.model, null);
  });

  check("unrecognized model rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({
        provider: "openai",
        model: "gpt-unknown-secret",
      }).model,
      null,
    );
  });

  check("approved status preserved", () => {
    assert.equal(
      extractSafeAiRunEvidence({ status: "failed" }).status,
      "failed",
    );
  });

  check("arbitrary status rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({ status: "client_private_data" }).status,
      null,
    );
  });

  check("safe latency preserved", () => {
    assert.equal(
      extractSafeAiRunEvidence({ latency_ms: 1234 }).latency_ms,
      1234,
    );
  });

  check("negative latency rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({ latency_ms: -1 }).latency_ms,
      null,
    );
  });

  check("fractional latency rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({ latency_ms: 2.5 }).latency_ms,
      null,
    );
  });

  check("excessive latency rejected", () => {
    assert.equal(
      extractSafeAiRunEvidence({ latency_ms: 86_400_001 }).latency_ms,
      null,
    );
  });

  check("private fields never copied", () => {
    const result = extractSafeAiRunEvidence({
      input: {
        type: "assistant_chat",
        last_human_message_preview: "PRIVATE_CUSTOMER_TEXT",
      },
      output: "PRIVATE_OUTPUT",
      error: "PRIVATE_ERROR",
      token: "PRIVATE_TOKEN",
      customer_name: "PRIVATE_NAME",
    });
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes("PRIVATE_"), false);
    assert.equal("input" in result, false);
    assert.equal("output" in result, false);
    assert.equal("error" in result, false);
    assert.equal("token" in result, false);
  });

  check("missing row stays safe", () => {
    const result = extractSafeAiRunEvidence(null);
    assert.equal(result.origin, "unknown");
    assert.equal(result.model, null);
  });

  check("error text does not establish cause", () => {
    const result = extractSafeAiRunEvidence({
      error: "NETWORK_TIMEOUT_PRIVATE_TEXT",
    });
    assert.equal(result.origin, "unknown");
    assert.equal("cause" in result, false);
    assert.equal("error" in result, false);
  });

  return passed;
}

const count = runZionAdminAiRunEvidenceTests();
console.log("PASS: " + count + "/16 TESTES DE EVIDENCIA");
