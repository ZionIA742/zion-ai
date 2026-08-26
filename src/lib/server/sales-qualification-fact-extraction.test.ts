import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDeterministicQualificationCandidates,
  extractStructuredQualificationCandidates,
  isBareQualificationReply,
  mergeQualificationFactCandidates,
  validateQualificationFactCandidate,
} from "./sales-qualification-fact-extraction.js";

class FakeOpenAi {
  private readonly outputText: string;

  constructor(outputText: string) {
    this.outputText = outputText;
  }

  responses = {
    create: async () => ({
      output_text: this.outputText,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    }),
  };
}

function serializeCandidates(message: string) {
  return extractDeterministicQualificationCandidates(message).map((candidate) => ({
    factKey: candidate.factKey,
    valueJson: candidate.valueJson,
    assertionLevel: candidate.assertionLevel,
    sourceType: candidate.sourceType,
    evidenceText: candidate.evidenceText,
  }));
}

test("deterministic extraction confirms dimension area and technical visit", () => {
  assert.deepEqual(
    serializeCandidates("quero uma visita tecnica para um espaco 3x4"),
    [
      {
        factKey: "space_text",
        valueJson: "3x4",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3x4",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 12,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3x4",
      },
      {
        factKey: "technical_visit_interest",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "quero uma visita tecnica",
      },
    ],
  );
});

test("deterministic extraction confirms decimal dimension areas with dot and comma", () => {
  assert.deepEqual(
    serializeCandidates("meu espaco e 3.5x4").slice(0, 2),
    [
      {
        factKey: "space_text",
        valueJson: "3.5x4",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3.5x4",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 14,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3.5x4",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("meu espaco e 3,5x4").slice(0, 2),
    [
      {
        factKey: "space_text",
        valueJson: "3,5x4",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3,5x4",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 14,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3,5x4",
      },
    ],
  );
});

test("deterministic extraction confirms explicit area in m2 and m²", () => {
  assert.deepEqual(
    serializeCandidates("tenho 12 m2"),
    [
      {
        factKey: "space_text",
        valueJson: "12 m2",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "12 m2",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 12,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "12 m2",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("tenho 12 m²"),
    [
      {
        factKey: "space_text",
        valueJson: "12 m²",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "12 m²",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 12,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "12 m²",
      },
    ],
  );
});

test("accented boolean matching preserves false and true evidence safely", () => {
  assert.deepEqual(
    serializeCandidates("não quero instalação"),
    [
      {
        factKey: "installation_interest",
        valueJson: false,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "não quero instalação",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("quero instalação"),
    [
      {
        factKey: "installation_interest",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "quero instalação",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("não quero visita técnica"),
    [
      {
        factKey: "technical_visit_interest",
        valueJson: false,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "não quero visita técnica",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("quero uma visita técnica"),
    [
      {
        factKey: "technical_visit_interest",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "quero uma visita técnica",
      },
    ],
  );
});

test("payment interest only confirms explicit positive payment intent", () => {
  assert.deepEqual(
    serializeCandidates("quero pagar no Pix"),
    [
      {
        factKey: "payment_interest",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "quero pagar no Pix",
      },
    ],
  );
  assert.deepEqual(
    serializeCandidates("quero parcelar"),
    [
      {
        factKey: "payment_interest",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "quero parcelar",
      },
    ],
  );
  assert.deepEqual(serializeCandidates("não quero Pix"), []);
});

test("deterministic extraction does not persist pure questions or bare replies", () => {
  assert.deepEqual(serializeCandidates("vocês fazem instalação?"), []);
  assert.deepEqual(serializeCandidates("como funciona a visita técnica?"), []);
  assert.deepEqual(serializeCandidates("vocês parcelam?"), []);
  assert.equal(isBareQualificationReply("sim"), true);
  assert.equal(isBareQualificationReply("não"), true);
  assert.equal(
    validateQualificationFactCandidate({
      candidate: {
        factKey: "technical_visit_interest",
        valueKind: "boolean",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "sim",
      },
      anchorMessage: "sim",
    }),
    null,
  );
});

test("validation rejects evidence that is not grounded in the anchor message", () => {
  assert.equal(
    validateQualificationFactCandidate({
      candidate: {
        factKey: "space_text",
        valueKind: "text",
        valueJson: "Sorocaba",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "Sorocaba",
      },
      anchorMessage: "fica em Campinas",
    }),
    null,
  );
  assert.equal(
    validateQualificationFactCandidate({
      candidate: {
        factKey: "installation_interest",
        valueKind: "boolean",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "não quero instalação",
      },
      anchorMessage: "não quero instalação",
    }),
    null,
  );
});

test("validation rejects typed extra or incompatible fields from structured output", async () => {
  const result = await extractStructuredQualificationCandidates({
    openai: new FakeOpenAi(
      JSON.stringify({
        candidates: [
          {
            fact_key: "requested_area_m2",
            assertion_level: "confirmed",
            value_kind: "number",
            text_value: "12",
            number_value: 12,
            boolean_value: null,
            evidence_text: "12 m2",
          },
          {
            fact_key: "installation_interest",
            assertion_level: "confirmed",
            value_kind: "boolean",
            text_value: null,
            number_value: 1,
            boolean_value: true,
            evidence_text: "quero instalação",
          },
        ],
      }),
    ),
    model: "gpt-4.1-mini",
    anchorMessage: "tenho 12 m2 e quero instalação",
  });

  assert.deepEqual(result.candidates, []);
});

test("merge keeps one confirmed canonical candidate when deterministic and AI agree on area", () => {
  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [
      {
        factKey: "requested_area_m2",
        valueKind: "number",
        valueJson: 12,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3x4",
      },
    ],
    aiCandidates: [
      {
        factKey: "requested_area_m2",
        valueKind: "number",
        valueJson: 12,
        assertionLevel: "inferred",
        sourceType: "system_inference",
        evidenceText: "3x4",
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, []);
  assert.deepEqual(merged.mergedCandidates, [
    {
      factKey: "requested_area_m2",
      valueKind: "number",
      valueJson: 12,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: "3x4",
    },
  ]);
});

test("merge discards only the conflicting fact key and keeps the rest", () => {
  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [
      {
        factKey: "space_text",
        valueKind: "text",
        valueJson: "3x4",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "3x4",
      },
      {
        factKey: "technical_visit_interest",
        valueKind: "boolean",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "visita tecnica",
      },
    ],
    aiCandidates: [
      {
        factKey: "space_text",
        valueKind: "text",
        valueJson: "4x5",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "4x5",
      },
      {
        factKey: "technical_visit_interest",
        valueKind: "boolean",
        valueJson: true,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "visita tecnica",
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, ["space_text"]);
  assert.deepEqual(
    merged.mergedCandidates.map((candidate) => candidate.factKey),
    ["technical_visit_interest"],
  );
});
