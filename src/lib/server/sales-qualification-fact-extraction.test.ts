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

test("natural pilot phrasing survives deterministic extraction and validation", () => {
  const message =
    "Tenho um espaço de 8 por 4 metros, aqui em Suzano. Tenho interesse em fazer uma visita técnica. Meu orçamento é de uns 25 mil reais e gostaria de saber se dá para parcelar. Quero decidir isso junto com minha esposa, de preferência ainda este mês. Prefiro uma piscina azul e minha maior preocupação é o custo da manutenção.";

  const validated = extractDeterministicQualificationCandidates(message)
    .map((candidate) =>
      validateQualificationFactCandidate({
        candidate,
        anchorMessage: message,
      }),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);

  assert.deepEqual(
    validated.map((candidate) => ({
      factKey: candidate.factKey,
      valueJson: candidate.valueJson,
      evidenceText: candidate.evidenceText,
    })),
    [
      {
        factKey: "space_text",
        valueJson: "8 por 4 metros",
        evidenceText: "8 por 4 metros",
      },
      {
        factKey: "requested_area_m2",
        valueJson: 32,
        evidenceText: "8 por 4 metros",
      },
      {
        factKey: "preferred_period_text",
        valueJson: "de preferência ainda este mês",
        evidenceText: "de preferência ainda este mês",
      },
      {
        factKey: "payment_interest",
        valueJson: true,
        evidenceText: "gostaria de saber se dá para parcelar",
      },
      {
        factKey: "technical_visit_interest",
        valueJson: true,
        evidenceText: "Tenho interesse em fazer uma visita técnica",
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

test("structured extraction separates decision context from preferred period", async () => {
  const message =
    "Quero decidir isso junto com minha esposa, de preferência ainda este mês.";

  const result = await extractStructuredQualificationCandidates({
    openai: new FakeOpenAi(
      JSON.stringify({
        candidates: [
          {
            fact_key: "decision_context",
            assertion_level: "confirmed",
            value_kind: "text",
            text_value: "decidir isso junto com minha esposa, de preferência ainda este mês",
            number_value: null,
            boolean_value: null,
            evidence_text:
              "decidir isso junto com minha esposa, de preferência ainda este mês",
          },
          {
            fact_key: "preferred_period_text",
            assertion_level: "confirmed",
            value_kind: "text",
            text_value: "de preferência ainda este mês",
            number_value: null,
            boolean_value: null,
            evidence_text: "de preferência ainda este mês",
          },
        ],
      }),
    ),
    model: "test-model",
    anchorMessage: message,
  });

  const validated = result.candidates
    .map((candidate) =>
      validateQualificationFactCandidate({
        candidate,
        anchorMessage: message,
      }),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);

  assert.deepEqual(
    validated.map((candidate) => ({
      factKey: candidate.factKey,
      valueJson: candidate.valueJson,
    })),
    [
      {
        factKey: "decision_context",
        valueJson: "decidir isso junto com minha esposa",
      },
      {
        factKey: "preferred_period_text",
        valueJson: "de preferência ainda este mês",
      },
    ],
  );
});

test("structured extraction rejects period-only decision context", async () => {
  const message = "De preferência ainda este mês.";

  const result = await extractStructuredQualificationCandidates({
    openai: new FakeOpenAi(
      JSON.stringify({
        candidates: [
          {
            fact_key: "decision_context",
            assertion_level: "confirmed",
            value_kind: "text",
            text_value: "de preferência ainda este mês",
            number_value: null,
            boolean_value: null,
            evidence_text: "de preferência ainda este mês",
          },
        ],
      }),
    ),
    model: "test-model",
    anchorMessage: message,
  });

  assert.deepEqual(result.candidates, []);
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

test("merge treats equivalent preferred period wording as the same canonical value", () => {
  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [
      {
        factKey: "preferred_period_text",
        valueKind: "text",
        valueJson: "de preferência ainda este mês",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "de preferência ainda este mês",
      },
    ],
    aiCandidates: [
      {
        factKey: "preferred_period_text",
        valueKind: "text",
        valueJson: "ainda este mês",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "ainda este mês",
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, []);
  assert.deepEqual(merged.mergedCandidates, [
    {
      factKey: "preferred_period_text",
      valueKind: "text",
      valueJson: "de preferência ainda este mês",
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: "de preferência ainda este mês",
    },
  ]);
});

test("merge still discards genuinely conflicting preferred periods", () => {
  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [
      {
        factKey: "preferred_period_text",
        valueKind: "text",
        valueJson: "este mês",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "este mês",
      },
    ],
    aiCandidates: [
      {
        factKey: "preferred_period_text",
        valueKind: "text",
        valueJson: "próximo mês",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "próximo mês",
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, ["preferred_period_text"]);
  assert.deepEqual(merged.mergedCandidates, []);
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
test("structured extraction accepts canonical customer address from explicit address message", async () => {
  const message =
    "Quero agendar uma visita técnica. O endereço é Rua General Francisco Glicério, 130, Suzano - SP.";

  const result = await extractStructuredQualificationCandidates({
    openai: new FakeOpenAi(
      JSON.stringify({
        candidates: [
          {
            fact_key: "customer_address_text",
            assertion_level: "confirmed",
            value_kind: "text",
            text_value: "Rua General Francisco Glicério, 130, Suzano - SP",
            number_value: null,
            boolean_value: null,
            evidence_text: "Rua General Francisco Glicério, 130, Suzano - SP",
          },
        ],
      }),
    ),
    model: "test-model",
    anchorMessage: message,
  });

  const validated = result.candidates
    .map((candidate) =>
      validateQualificationFactCandidate({
        candidate,
        anchorMessage: message,
      }),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);

  assert.deepEqual(
    validated.map((candidate) => ({
      factKey: candidate.factKey,
      valueJson: candidate.valueJson,
      assertionLevel: candidate.assertionLevel,
    })),
    [
      {
        factKey: "customer_address_text",
        valueJson: "Rua General Francisco Glicério, 130, Suzano - SP",
        assertionLevel: "confirmed",
      },
    ],
  );
});

test("merge suppresses location_text when it duplicates the canonical customer address", () => {
  const address = "Rua General Francisco Glicério, 130, Suzano - SP";

  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [],
    aiCandidates: [
      {
        factKey: "location_text",
        valueKind: "text",
        valueJson: address,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: address,
      },
      {
        factKey: "customer_address_text",
        valueKind: "text",
        valueJson: address,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: address,
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, []);
  assert.deepEqual(
    merged.mergedCandidates.map((candidate) => ({
      factKey: candidate.factKey,
      valueJson: candidate.valueJson,
    })),
    [
      {
        factKey: "customer_address_text",
        valueJson: address,
      },
    ],
  );
});

test("merge preserves independent general location alongside canonical customer address", () => {
  const merged = mergeQualificationFactCandidates({
    deterministicCandidates: [],
    aiCandidates: [
      {
        factKey: "location_text",
        valueKind: "text",
        valueJson: "Suzano",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "Suzano",
      },
      {
        factKey: "customer_address_text",
        valueKind: "text",
        valueJson: "Rua General Francisco Glicério, 130, Suzano - SP",
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "Rua General Francisco Glicério, 130, Suzano - SP",
      },
    ],
  });

  assert.deepEqual(merged.discardedFactKeys, []);
  assert.deepEqual(
    merged.mergedCandidates.map((candidate) => ({
      factKey: candidate.factKey,
      valueJson: candidate.valueJson,
    })),
    [
      {
        factKey: "location_text",
        valueJson: "Suzano",
      },
      {
        factKey: "customer_address_text",
        valueJson: "Rua General Francisco Glicério, 130, Suzano - SP",
      },
    ],
  );
});