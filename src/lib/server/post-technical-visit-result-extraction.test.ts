import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPostTechnicalVisitResult,
} from "./post-technical-visit-result-extraction";

class FakeOpenAi {
  constructor(private readonly output: unknown) {}

  responses = {
    create: async (args: unknown) => {
      this.lastArgs = args;
      if (this.output instanceof Error) throw this.output;
      if (typeof this.output === "string") {
        return { output_text: this.output };
      }

      return { output_text: JSON.stringify(this.output) };
    },
  };

  lastArgs: unknown = null;
}

async function extract(args: {
  message: string;
  output: unknown;
}) {
  return extractPostTechnicalVisitResult({
    openai: new FakeOpenAi(args.output),
    model: "test-model",
    responsibleMessage: args.message,
  });
}

test("extracts viable result with literal evidence", async () => {
  const result = await extract({
    message: "Fui lá e está tudo certo, é viável.",
    output: {
      result_kind: "viable",
      evidence_text: "é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Fui lá",
    },
  });

  assert.deepEqual(result.extraction, {
    resultKind: "viable",
    evidenceText: "é viável",
    adjustmentSummary: null,
    uncertaintyReason: null,
    occurrence: "occurred",
    occurrenceEvidenceText: "Fui lá",
  });
  assert.equal(result.failureReason, null);
});

test("preserves viable with adjustments and its explicit adjustment", async () => {
  const result = await extract({
    message: "Na visita vimos que é viável, mas precisa reforçar a base antes.",
    output: {
      result_kind: "viable_with_adjustments",
      evidence_text: "é viável, mas precisa reforçar a base antes",
      adjustment_summary: "reforçar a base antes",
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });

  assert.equal(result.extraction.resultKind, "viable_with_adjustments");
  assert.equal(result.extraction.adjustmentSummary, "reforçar a base antes");
});

test("extracts explicit infeasible and pending results", async () => {
  const infeasible = await extract({
    message: "Na visita vimos que não dá para instalar nesse local, tecnicamente inviável.",
    output: {
      result_kind: "infeasible",
      evidence_text: "tecnicamente inviável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });
  const pending = await extract({
    message: "Ainda preciso conferir a medida e te retorno.",
    output: {
      result_kind: "pending",
      evidence_text: "Ainda preciso conferir a medida e te retorno",
      adjustment_summary: null,
      uncertainty_reason: "depende da conferência da medida",
      occurrence: "unclear",
      occurrence_evidence_text: null,
    },
  });

  assert.equal(infeasible.extraction.resultKind, "infeasible");
  assert.equal(pending.extraction.resultKind, "pending");
});

test("ambiguous, commercial, absence and cancellation text stays null", async () => {
  for (const message of [
    "Ok",
    "Falei com ele.",
    "Ele pediu desconto.",
    "O cliente não apareceu.",
    "A loja precisou cancelar a visita.",
  ]) {
    const result = await extract({
      message,
      output: {
        result_kind: null,
        evidence_text: null,
        adjustment_summary: null,
        uncertainty_reason: "fato técnico insuficiente",
        occurrence: "unclear",
        occurrence_evidence_text: null,
      },
    });

    assert.equal(result.extraction.resultKind, null, message);
    assert.equal(result.extraction.evidenceText, null, message);
  }
});

test("rejects viable when the message explicitly requires a technical adjustment", async () => {
  const result = await extract({
    message: "Na visita vimos que é viável, mas precisa reforçar a base.",
    output: {
      result_kind: "viable",
      evidence_text: "é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });

  assert.equal(result.extraction.resultKind, null);
  assert.equal(result.failureReason, "viable_result_conflicts_with_explicit_adjustment");
});

test("does not treat a non-technical confirmation request as a technical adjustment", async () => {
  const result = await extract({
    message: "Na visita vimos que é viável, mas precisa confirmar o desconto com o cliente.",
    output: {
      result_kind: "viable",
      evidence_text: "é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });

  assert.equal(result.extraction.resultKind, "viable");
  assert.equal(result.failureReason, null);
});

test("rejects model classifications for commercial or operational-only messages", async () => {
  const cases = [
    {
      message: "Ele pediu desconto.",
      result_kind: "pending",
      evidence_text: "Ele pediu desconto.",
    },
    {
      message: "O cliente não apareceu.",
      result_kind: "infeasible",
      evidence_text: "O cliente não apareceu.",
    },
    {
      message: "A loja precisou cancelar a visita.",
      result_kind: "pending",
      evidence_text: "A loja precisou cancelar a visita.",
    },
  ] as const;

  for (const testCase of cases) {
    const result = await extract({
      message: testCase.message,
      output: {
        result_kind: testCase.result_kind,
        evidence_text: testCase.evidence_text,
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "unclear",
        occurrence_evidence_text: null,
      },
    });

    assert.equal(result.extraction.resultKind, null, testCase.message);
    assert.equal(result.failureReason, "non_technical_message_cannot_produce_visit_result");
  }
});

test("preserves an independent technical fact beside a discount request", async () => {
  const result = await extract({
    message: "O cliente pediu desconto, mas na visita vimos que tecnicamente o local é viável.",
    output: {
      result_kind: "viable",
      evidence_text: "tecnicamente o local é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "na visita vimos",
    },
  });

  assert.equal(result.extraction.resultKind, "viable");
  assert.equal(result.failureReason, null);
});

test("rejects operational messages whose only technical-looking word is local", async () => {
  const cases = [
    {
      message: "O cliente não apareceu no local.",
      result_kind: "infeasible",
      evidence_text: "O cliente não apareceu no local.",
    },
    {
      message: "A loja cancelou a visita no local.",
      result_kind: "pending",
      evidence_text: "A loja cancelou a visita no local.",
    },
  ] as const;

  for (const testCase of cases) {
    const result = await extract({
      message: testCase.message,
      output: {
        result_kind: testCase.result_kind,
        evidence_text: testCase.evidence_text,
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "unclear",
        occurrence_evidence_text: null,
      },
    });

    assert.equal(result.extraction.resultKind, null, testCase.message);
    assert.equal(result.failureReason, "non_technical_message_cannot_produce_visit_result");
  }
});

test("accepts viable when the message explicitly rules out adjustments", async () => {
  const result = await extract({
    message: "Na visita vimos que é viável e não precisa de nenhum ajuste.",
    output: {
      result_kind: "viable",
      evidence_text: "é viável e não precisa de nenhum ajuste",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });

  assert.equal(result.extraction.resultKind, "viable");
  assert.equal(result.failureReason, null);
});

test("stage instruction cannot create a stage decision", async () => {
  const result = await extract({
    message: "Coloca em negociação. Na visita vimos que a estrutura suporta a instalação sem ajustes.",
    output: {
      result_kind: "viable",
      evidence_text: "a estrutura suporta a instalação sem ajustes",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Na visita vimos",
    },
  });

  assert.deepEqual(result.extraction, {
    resultKind: "viable",
    evidenceText: "a estrutura suporta a instalação sem ajustes",
    adjustmentSummary: null,
    uncertaintyReason: null,
    occurrence: "occurred",
    occurrenceEvidenceText: "Na visita vimos",
  });
  assert.equal("stage" in result.extraction, false);
});

test("invalid JSON and thrown model errors fail closed", async () => {
  const malformed = await extract({
    message: "Está tudo certo, é viável.",
    output: "não é json",
  });
  const thrown = await extract({
    message: "Está tudo certo, é viável.",
    output: new Error("provider unavailable"),
  });

  assert.equal(malformed.extraction.resultKind, null);
  assert.equal(malformed.failureReason, "invalid_structured_extraction");
  assert.equal(thrown.extraction.resultKind, null);
  assert.equal(thrown.failureReason, "provider unavailable");
});

test("rejects evidence and adjustment text that are not literal substrings", async () => {
  const evidence = await extract({
    message: "Está tudo certo, é viável.",
    output: {
      result_kind: "viable",
      evidence_text: "o local é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
    },
  });
  const adjustment = await extract({
    message: "É viável, mas precisa reforçar a base antes.",
    output: {
      result_kind: "viable_with_adjustments",
      evidence_text: "É viável, mas precisa reforçar a base antes",
      adjustment_summary: "trocar toda a estrutura",
      uncertainty_reason: null,
    },
  });

  assert.equal(evidence.extraction.resultKind, null);
  assert.equal(evidence.failureReason, "invalid_structured_extraction");
  assert.equal(adjustment.extraction.resultKind, null);
  assert.equal(adjustment.failureReason, "invalid_structured_extraction");
});

test("rejects stage-like fields from an invalid structured output", async () => {
  const result = await extract({
    message: "A estrutura suporta a instalação.",
    output: {
      result_kind: "viable",
      evidence_text: "A estrutura suporta a instalação",
      adjustment_summary: null,
      uncertainty_reason: null,
      stage: "negociacao",
    },
  });

  assert.equal(result.extraction.resultKind, null);
  assert.equal(result.failureReason, "invalid_structured_extraction");
});

test("extracts occurrence independently for technical results and pending visits", async () => {
  const cases = [
    {
      message: "Fui lá e está tudo certo, é viável.",
      output: {
        result_kind: "viable",
        evidence_text: "é viável",
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "occurred",
        occurrence_evidence_text: "Fui lá",
      },
      resultKind: "viable",
      occurrence: "occurred",
    },
    {
      message: "Na visita vimos que precisa reforçar a base.",
      output: {
        result_kind: "viable_with_adjustments",
        evidence_text: "precisa reforçar a base",
        adjustment_summary: "reforçar a base",
        uncertainty_reason: null,
        occurrence: "occurred",
        occurrence_evidence_text: "Na visita vimos",
      },
      resultKind: "viable_with_adjustments",
      occurrence: "occurred",
    },
    {
      message: "Medi o local, mas ainda preciso confirmar uma medida.",
      output: {
        result_kind: "pending",
        evidence_text: "ainda preciso confirmar uma medida",
        adjustment_summary: null,
        uncertainty_reason: "depende da confirmação",
        occurrence: "occurred",
        occurrence_evidence_text: "Medi o local",
      },
      resultKind: "pending",
      occurrence: "occurred",
    },
    {
      message: "Ainda preciso confirmar uma medida.",
      output: {
        result_kind: "pending",
        evidence_text: "Ainda preciso confirmar uma medida",
        adjustment_summary: null,
        uncertainty_reason: "depende da confirmação",
        occurrence: "unclear",
        occurrence_evidence_text: null,
      },
      resultKind: "pending",
      occurrence: "unclear",
    },
  ] as const;

  for (const testCase of cases) {
    const result = await extract({
      message: testCase.message,
      output: testCase.output,
    });

    assert.equal(result.extraction.resultKind, testCase.resultKind);
    assert.equal(result.extraction.occurrence, testCase.occurrence);
    assert.equal(result.failureReason, null);
  }
});

test("rejects technical results when occurrence evidence is only the result claim", async () => {
  const viable = await extract({
    message: "É viável.",
    output: {
      result_kind: "viable",
      evidence_text: "É viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "É viável",
    },
  });
  const infeasible = await extract({
    message: "Tecnicamente é inviável.",
    output: {
      result_kind: "infeasible",
      evidence_text: "Tecnicamente é inviável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "Tecnicamente é inviável",
    },
  });

  assert.equal(viable.extraction.resultKind, null);
  assert.notEqual(viable.failureReason, null);
  assert.equal(infeasible.extraction.resultKind, null);
  assert.notEqual(infeasible.failureReason, null);
});

test("rejects occurred evidence when the selected visit phrase is immediately negated", async () => {
  const cases = [
    ["Não fui lá.", "fui lá"],
    ["Nunca fui lá.", "fui lá"],
    ["Não fomos ao local.", "fomos ao local"],
    ["Não medi o local.", "medi o local"],
    ["Não fui lá.", "Não fui lá"],
    ["Nunca fui lá.", "Nunca fui lá"],
    ["Não fomos ao local.", "Não fomos ao local"],
    ["Não medi o local.", "Não medi o local"],
    ["Nem fomos ao local.", "Nem fomos ao local"],
    ["Não medimos o local.", "Não medimos o local"],
  ] as const;

  for (const [message, occurrenceEvidenceText] of cases) {
    const result = await extract({
      message,
      output: {
        result_kind: null,
        evidence_text: null,
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "occurred",
        occurrence_evidence_text: occurrenceEvidenceText,
      },
    });

    assert.equal(result.extraction.resultKind, null, message);
    assert.equal(result.extraction.occurrence, "unclear", message);
    assert.notEqual(result.failureReason, null, message);
  }
});

test("preserves affirmative occurred evidence with the same narrow phrases", async () => {
  const cases = [
    ["Fui lá e está tudo certo.", "Fui lá"],
    ["Ontem fui lá e medi tudo.", "fui lá"],
    ["Fomos ao local e verificamos a estrutura.", "Fomos ao local"],
    ["Medi o local, mas ainda preciso confirmar uma medida.", "Medi o local"],
    [
      "Não consegui falar com o cliente, mas fui lá e medi o local.",
      "fui lá",
    ],
  ] as const;

  for (const [message, occurrenceEvidenceText] of cases) {
    const result = await extract({
      message,
      output: {
        result_kind: null,
        evidence_text: null,
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "occurred",
        occurrence_evidence_text: occurrenceEvidenceText,
      },
    });

    assert.equal(result.extraction.resultKind, null, message);
    assert.equal(result.extraction.occurrence, "occurred", message);
    assert.equal(result.extraction.occurrenceEvidenceText, occurrenceEvidenceText, message);
    assert.equal(result.failureReason, null, message);
  }
});

test("rejects non-occurrence evidence that only repeats commercial content", async () => {
  const result = await extract({
    message: "Ele pediu desconto.",
    output: {
      result_kind: null,
      evidence_text: null,
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "did_not_occur",
      occurrence_evidence_text: "Ele pediu desconto",
    },
  });

  assert.equal(result.extraction.resultKind, null);
  assert.equal(result.extraction.occurrence, "unclear");
  assert.notEqual(result.failureReason, null);
});

test("requires occurrence fields instead of inferring them from a result", async () => {
  const result = await extract({
    message: "É viável.",
    output: {
      result_kind: "viable",
      evidence_text: "É viável",
      adjustment_summary: null,
      uncertainty_reason: null,
    },
  });

  assert.equal(result.extraction.resultKind, null);
  assert.equal(result.failureReason, "invalid_structured_extraction");
});

test("extracts did_not_occur only without a technical result", async () => {
  for (const message of [
    "O cliente não apareceu.",
    "Não consegui ir.",
    "A loja cancelou e não fomos ao local.",
  ]) {
    const result = await extract({
      message,
      output: {
        result_kind: null,
        evidence_text: null,
        adjustment_summary: null,
        uncertainty_reason: null,
        occurrence: "did_not_occur",
        occurrence_evidence_text: message,
      },
    });

    assert.equal(result.extraction.resultKind, null, message);
    assert.equal(result.extraction.occurrence, "did_not_occur", message);
    assert.equal(result.extraction.occurrenceEvidenceText, message, message);
    assert.equal(result.failureReason, null, message);
  }
});

test("keeps commercial-only text occurrence unclear", async () => {
  const result = await extract({
    message: "Ele pediu desconto.",
    output: {
      result_kind: null,
      evidence_text: null,
      adjustment_summary: null,
      uncertainty_reason: "sem fato técnico",
      occurrence: "unclear",
      occurrence_evidence_text: null,
    },
  });

  assert.equal(result.extraction.resultKind, null);
  assert.equal(result.extraction.occurrence, "unclear");
  assert.equal(result.failureReason, null);
});

test("rejects impossible occurrence and result combinations", async () => {
  const didNotOccurWithResult = await extract({
    message: "A visita foi cancelada antes de acontecer.",
    output: {
      result_kind: "infeasible",
      evidence_text: "tecnicamente inviável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "did_not_occur",
      occurrence_evidence_text: "foi cancelada antes de acontecer",
    },
  });
  const unclearWithConclusiveResult = await extract({
    message: "É viável.",
    output: {
      result_kind: "viable",
      evidence_text: "É viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "unclear",
      occurrence_evidence_text: null,
    },
  });

  assert.equal(didNotOccurWithResult.extraction.resultKind, null);
  assert.notEqual(didNotOccurWithResult.failureReason, null);
  assert.equal(unclearWithConclusiveResult.extraction.resultKind, null);
  assert.notEqual(unclearWithConclusiveResult.failureReason, null);
});

test("rejects invalid occurrence evidence", async () => {
  const nonLiteralEvidence = await extract({
    message: "Fui lá e está tudo certo, é viável.",
    output: {
      result_kind: "viable",
      evidence_text: "é viável",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "occurred",
      occurrence_evidence_text: "a visita aconteceu",
    },
  });
  const evidenceForUnclear = await extract({
    message: "Ainda preciso confirmar uma medida.",
    output: {
      result_kind: "pending",
      evidence_text: "Ainda preciso confirmar uma medida",
      adjustment_summary: null,
      uncertainty_reason: null,
      occurrence: "unclear",
      occurrence_evidence_text: "preciso confirmar",
    },
  });

  assert.equal(nonLiteralEvidence.extraction.resultKind, null);
  assert.notEqual(nonLiteralEvidence.failureReason, null);
  assert.equal(evidenceForUnclear.extraction.resultKind, null);
  assert.notEqual(evidenceForUnclear.failureReason, null);
});
