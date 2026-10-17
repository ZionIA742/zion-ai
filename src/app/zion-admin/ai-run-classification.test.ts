import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  classifyAiRunEvidenceScope,
  classifyAiRunEvent,
  shouldShowAiRunCause,
} from "./ai-run-classification";

test("recognizes a failed status without inventing a technical cause", () => {
  const result = classifyAiRunEvent({ status: "failed", error: "Falha operacional na execução da IA." });

  assert.equal(result.observedSituation, "failure_recorded");
  assert.equal(result.cause, "not_identified");
  assert.equal(result.situationLabel, "Falha registrada.");
  assert.equal(result.causeLabel, "Causa não identificada.");
  assert.equal(result.situationLabel.includes("timeout"), false);
  assert.equal(result.situationLabel.includes("token"), false);
  assert.equal(result.situationLabel.includes("provedor"), false);
  assert.equal(result.situationLabel.includes("conexão"), false);
});

test("does not expose or echo raw error data", () => {
  const secret = "Bearer secret-token prompt=private payload=customer@example.test";
  const result = classifyAiRunEvent({ status: "failed", error: secret });

  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
  assert.equal(JSON.stringify(result).includes("customer@example.test"), false);
});

test("handles unknown, missing, and incompatible status evidence", () => {
  assert.equal(classifyAiRunEvent({ status: "paused", error: null }).observedSituation, "status_unrecognized");
  assert.equal(classifyAiRunEvent({ status: null, error: null }).observedSituation, "status_missing");
  assert.equal(
    classifyAiRunEvent({ status: "succeeded", error: "Falha operacional na execução da IA." }).observedSituation,
    "status_error_incompatible",
  );
});

test("only hides the visual cause field for a clean completion", () => {
  assert.equal(
    shouldShowAiRunCause(classifyAiRunEvent({ status: "succeeded", error: null })),
    false,
  );
  assert.equal(
    shouldShowAiRunCause(classifyAiRunEvent({ status: "failed", error: "Falha operacional na execução da IA." })),
    true,
  );
  const incompatible = classifyAiRunEvent({ status: "succeeded", error: "Falha operacional na execução da IA." });
  assert.equal(incompatible.observedSituation, "status_error_incompatible");
  assert.equal(shouldShowAiRunCause(incompatible), true);
});

test("optional fields are not required for a safe classification", () => {
  const result = classifyAiRunEvent({ status: "failed", error: undefined });

  assert.equal(result.observedSituation, "failure_recorded");
  assert.equal(result.cause, "not_identified");
});

test("availability limits the scope of claims", () => {
  assert.deepEqual(classifyAiRunEvidenceScope("available"), {
    availability: "available",
    isComplete: true,
    statement: "Situação observada na fonte disponível; o recorte é completo.",
  });
  assert.equal(classifyAiRunEvidenceScope("partial").isComplete, false);
  assert.match(classifyAiRunEvidenceScope("partial").statement, /parcial/);
  assert.equal(classifyAiRunEvidenceScope("unavailable").isComplete, false);
  assert.match(classifyAiRunEvidenceScope("unavailable").statement, /indisponível/);
  assert.equal(classifyAiRunEvidenceScope(undefined).availability, "unavailable");
});
