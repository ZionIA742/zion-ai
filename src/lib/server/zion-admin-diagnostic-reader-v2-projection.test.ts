import { strict as assert } from "node:assert";
import {
  projectSafeDiagnosticReaderV2Evidence as project,
} from "./zion-admin-diagnostic-reader-v2-projection";

export function runDiagnosticReaderV2ProjectionTests(): number {
  let passed = 0;

  function check(name: string, action: () => void) {
    action();
    passed++;
    console.log("PASS: " + name);
  }

  check("assistant with validated metadata", () => {
    const row = project({
      registered_component: "assistant_ai",
      evidence_origin: "assistant_ai",
      evidence_execution_type: "assistant_chat",
      evidence_provider: "openai",
      evidence_model: "gpt-4o-mini",
      evidence_run_status: "failed",
      evidence_latency_ms: 1234,
    });
    assert.equal(row.evidence_origin, "assistant_ai");
    assert.equal(row.evidence_model, "gpt-4o-mini");
    assert.equal(row.evidence_run_status, "failed");
    assert.equal(row.evidence_latency_ms, 1234);
  });

  check("historical sales classification is not proof", () => {
    const row = project({
      registered_component: "sales_ai",
      evidence_origin: "unknown",
    });
    assert.equal(row.registered_component, "sales_ai");
    assert.equal(row.evidence_origin, "unknown");
    assert.equal(row.evidence_execution_type, null);
  });

  check("unknown execution remains unknown", () => {
    const row = project({
      registered_component: "ai_origin_unknown",
    });
    assert.equal(row.evidence_origin, "unknown");
  });

  check("origin alone cannot establish assistant", () => {
    const row = project({
      registered_component: "ai_origin_unknown",
      evidence_origin: "assistant_ai",
      evidence_execution_type: "assistant_chat",
    });
    assert.equal(row.evidence_origin, "unknown");
  });

  check("assistant requires exact execution type", () => {
    const row = project({
      registered_component: "assistant_ai",
      evidence_origin: "assistant_ai",
      evidence_execution_type: "assistant_chat ",
    });
    assert.equal(row.evidence_origin, "unknown");
  });

  check("unknown component is rejected safely", () => {
    const row = project({
      registered_component: "PRIVATE_COMPONENT",
    });
    assert.equal(row.registered_component, "unknown");
  });

  check("invalid provider cannot escape", () => {
    const row = project({
      evidence_provider: "PRIVATE_PROVIDER",
      evidence_model: "gpt-4o-mini",
    });
    assert.equal(row.evidence_provider, null);
    assert.equal(row.evidence_model, null);
  });

  check("model requires allowed provider and model", () => {
    assert.equal(project({
      evidence_provider: "openai",
      evidence_model: "PRIVATE_MODEL",
    }).evidence_model, null);

    assert.equal(project({
      evidence_provider: "other",
      evidence_model: "gpt-4o-mini",
    }).evidence_model, null);
  });

  check("unknown status is rejected", () => {
    assert.equal(project({
      evidence_run_status: "PRIVATE_STATUS",
    }).evidence_run_status, null);
  });

  check("latency boundaries are enforced", () => {
    assert.equal(project({
      evidence_latency_ms: 0,
    }).evidence_latency_ms, 0);

    assert.equal(project({
      evidence_latency_ms: 86400000,
    }).evidence_latency_ms, 86400000);

    for (const invalid of [-1, 1.5, 86400001, "123"]) {
      assert.equal(project({
        evidence_latency_ms: invalid,
      }).evidence_latency_ms, null);
    }
  });

  check("raw content and extra fields are never copied", () => {
    const row = project({
      registered_component: "assistant_ai",
      evidence_origin: "assistant_ai",
      evidence_execution_type: "assistant_chat",
      customer_message: "PRIVATE_CUSTOMER_TEXT",
      sanitized_evidence: {
        raw_error: "PRIVATE_ERROR",
      },
      input: "PRIVATE_INPUT",
      output: "PRIVATE_OUTPUT",
      token: "PRIVATE_TOKEN",
    });

    assert.equal(JSON.stringify(row).includes("PRIVATE_"), false);
    assert.equal(Object.keys(row).length, 7);
    assert.equal("sanitized_evidence" in row, false);
  });

  check("null and invalid input fail closed", () => {
    for (const source of [null, 1, [], "text"]) {
      const row = project(source);
      assert.equal(row.registered_component, "unknown");
      assert.equal(row.evidence_origin, "unknown");
      assert.equal(row.evidence_provider, null);
    }
  });

  return passed;
}
