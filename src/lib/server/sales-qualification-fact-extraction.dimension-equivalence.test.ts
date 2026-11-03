import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDeterministicQualificationCandidates,
  validateQualificationFactCandidate,
  mergeQualificationFactCandidates,
} from "./sales-qualification-fact-extraction";

function validatedCandidates(message: string) {
  return extractDeterministicQualificationCandidates(message)
    .map((candidate) =>
      validateQualificationFactCandidate({
        candidate,
        anchorMessage: message,
      }),
    )
    .filter((candidate) => candidate !== null);
}

function aiSpaceCandidate(
  message: string,
  value: string,
  evidence: string,
) {
  return validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: value,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: evidence,
    },
  });
}

test("equivalent dimensional text preserves the original customer value", () => {
  const message =
    "Tenho um espaço de 6 por 3 metros para instalar uma piscina";

  const aiCandidate = aiSpaceCandidate(
    message,
    "6 por 3",
    "6 por 3 metros",
  );

  assert.ok(aiCandidate);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedCandidates(message),
    aiCandidates: [aiCandidate],
  });

  assert.deepEqual(result.discardedFactKeys, []);

  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "space_text")
      ?.valueJson,
    "6 por 3 metros",
  );

  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "requested_area_m2")
      ?.valueJson,
    18,
  );
});

test("x and multiplication sign are equivalent for dimensions", () => {
  const variants = [
    ["6 x 3 m", "6 x 3"],
    ["6 × 3 metros", "6 × 3"],
  ];

  for (const [evidence, shorter] of variants) {
    const message = `Meu espaço mede ${evidence}`;
    const aiCandidate = aiSpaceCandidate(
      message,
      shorter,
      evidence,
    );

    assert.ok(aiCandidate);

    const result = mergeQualificationFactCandidates({
      deterministicCandidates: validatedCandidates(message),
      aiCandidates: [aiCandidate],
    });

    assert.equal(
      result.discardedFactKeys.includes("space_text"),
      false,
    );
  }
});

test("different dimensions retain fail-closed collision", () => {
  const message =
    "Tenho um espaço de 6 por 3 metros e outro de 8 por 4 metros";

  const aiCandidate = aiSpaceCandidate(
    message,
    "8 por 4 metros",
    "8 por 4 metros",
  );

  assert.ok(aiCandidate);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedCandidates(message),
    aiCandidates: [aiCandidate],
  });

  assert.equal(result.discardedFactKeys.includes("space_text"), true);
  assert.equal(
    result.mergedCandidates.some((c) => c.factKey === "space_text"),
    false,
  );
});

test("product dimensions cannot silently replace space dimensions", () => {
  const message =
    "Meu espaço tem 6 por 3 metros, mas o modelo da piscina mede 2,8 por 7,5 metros";

  const aiCandidate = aiSpaceCandidate(
    message,
    "2,8 por 7,5 metros",
    "2,8 por 7,5 metros",
  );

  assert.equal(aiCandidate, null);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedCandidates(message),
    aiCandidates: [],
  });

  assert.deepEqual(result.discardedFactKeys, []);
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "space_text")?.valueJson,
    "6 por 3 metros",
  );
});

test("dimensions in reversed order are not silently equated", () => {
  const message =
    "Tenho espaços de 6 por 3 metros e 3 por 6 metros";

  const aiCandidate = aiSpaceCandidate(
    message,
    "3 por 6 metros",
    "3 por 6 metros",
  );

  assert.ok(aiCandidate);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedCandidates(message),
    aiCandidates: [aiCandidate],
  });

  assert.equal(result.discardedFactKeys.includes("space_text"), true);
});
