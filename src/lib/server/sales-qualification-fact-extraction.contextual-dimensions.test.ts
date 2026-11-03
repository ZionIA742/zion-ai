import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDeterministicQualificationCandidates,
  validateQualificationFactCandidate,
  mergeQualificationFactCandidates,
} from "./sales-qualification-fact-extraction";

function evaluate(message: string, aiValue: string, evidence: string) {
  const deterministicCandidates =
    extractDeterministicQualificationCandidates(message)
      .map((candidate) =>
        validateQualificationFactCandidate({
          candidate,
          anchorMessage: message,
        }),
      )
      .filter((candidate) => candidate !== null);

  const aiCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: aiValue,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: evidence,
    },
  });

  assert.ok(aiCandidate, "O candidato deve passar pela validacao");

  return mergeQualificationFactCandidates({
    deterministicCandidates,
    aiCandidates: [aiCandidate],
  });
}

function validatedDeterministicCandidates(message: string) {
  return extractDeterministicQualificationCandidates(message)
    .map((candidate) =>
      validateQualificationFactCandidate({ candidate, anchorMessage: message }),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}

test("descricao contextual do terreno preserva a medida original", () => {
  const message =
    "Só para deixar registrado: o espaço disponível no meu terreno é de 6 por 3 metros. Essas são as medidas do espaço onde quero instalar a piscina, não as medidas da piscina.";

  const description =
    "o espaço disponível no meu terreno é de 6 por 3 metros";

  const result = evaluate(message, description, description);

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

test("mensagem contextual completa preserva a medida do terreno", () => {
  const message =
    "Só para deixar registrado: o espaço disponível no meu terreno é de 6 por 3 metros. Essas são as medidas do espaço onde quero instalar a piscina, não as medidas da piscina.";

  const result = evaluate(message, message, message);

  assert.equal(result.discardedFactKeys.includes("space_text"), false);
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "space_text")
      ?.valueJson,
    "6 por 3 metros",
  );
});

test("descricao apenas de produto nao ganha autoridade de espaco", () => {
  const message =
    "Meu terreno tem 6 por 3 metros e o modelo da piscina tem 6 por 3 metros";

  const productDescription =
    "o modelo da piscina tem 6 por 3 metros";

  assert.equal(
    validateQualificationFactCandidate({
      anchorMessage: message,
      candidate: {
        factKey: "space_text",
        valueKind: "text",
        valueJson: productDescription,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: productDescription,
      },
    }),
    null,
  );
});

test("descricao com medidas do terreno e do produto nao e colapsada", () => {
  const message =
    "Meu terreno tem 6 por 3 metros e a piscina tem 2,8 por 7,5 metros";

  const aiCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: message,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: message,
    },
  });
  assert.equal(aiCandidate, null);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedDeterministicCandidates(message),
    aiCandidates: [],
  });

  assert.deepEqual(result.discardedFactKeys, []);
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "space_text")?.valueJson,
    "6 por 3 metros",
  );
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "requested_area_m2")
      ?.valueJson,
    18,
  );
});

test("descricao ampla com piscina antes do terreno preserva o terreno", () => {
  const message =
    "A piscina mede 2,8 por 7,5 metros e meu terreno mede 6 por 3 metros";
  const aiCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: message,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: message,
    },
  });
  assert.equal(aiCandidate, null);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: validatedDeterministicCandidates(message),
    aiCandidates: [],
  });
  assert.equal(result.mergedCandidates.find((c) => c.factKey === "space_text")?.valueJson, "6 por 3 metros");
  assert.equal(result.mergedCandidates.find((c) => c.factKey === "requested_area_m2")?.valueJson, 18);
});

test("dimensoes realmente diferentes continuam em conflito", () => {
  const message =
    "Meu terreno tem 6 por 3 metros e outro espaco tem 8 por 4 metros";

  const result = evaluate(
    message,
    "outro espaco tem 8 por 4 metros",
    "outro espaco tem 8 por 4 metros",
  );

  assert.equal(result.discardedFactKeys.includes("space_text"), true);
});

test("mencao anterior a piscina nao elimina medida do terreno", () => {
  const message =
    "Quero uma piscina, e o espaço do meu terreno é de 6 por 3 metros.";

  const result = evaluate(message, message, message);

  assert.equal(result.discardedFactKeys.includes("space_text"), false);
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "space_text")?.valueJson,
    "6 por 3 metros",
  );
});

test("piscina como objetivo da instalacao preserva medida do espaco", () => {
  const message =
    "Meu espaço para instalar uma piscina é de 6 por 3 metros.";

  const result = evaluate(message, message, message);

  assert.equal(result.discardedFactKeys.includes("space_text"), false);
  assert.equal(
    result.mergedCandidates.find((c) => c.factKey === "requested_area_m2")
      ?.valueJson,
    18,
  );
});

test("modelo da piscina nao assume medidas do terreno", () => {
  const message =
    "O modelo da piscina para meu terreno é de 6 por 3 metros.";

  assert.equal(
    validateQualificationFactCandidate({
      anchorMessage: message,
      candidate: {
        factKey: "space_text",
        valueKind: "text",
        valueJson: message,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: message,
      },
    }),
    null,
  );
});

test("piscina de seis por tres nao prova medida do espaco", () => {
  const message =
    "Meu espaço para instalar uma piscina de 6 por 3 metros.";

  assert.equal(
    validateQualificationFactCandidate({
      anchorMessage: message,
      candidate: {
        factKey: "space_text",
        valueKind: "text",
        valueJson: message,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: message,
      },
    }),
    null,
  );
});

test("area explicita do produto nao vira area do terreno", () => {
  const message = "A piscina tem 12 m2 de area.";
  assert.deepEqual(extractDeterministicQualificationCandidates(message), []);
  assert.equal(
    validateQualificationFactCandidate({
      anchorMessage: message,
      candidate: {
        factKey: "requested_area_m2",
        valueKind: "number",
        valueJson: 12,
        assertionLevel: "confirmed",
        sourceType: "incoming_customer_message",
        evidenceText: "12 m2",
      },
    }),
    null,
  );
});

test("area explicita do terreno continua confirmada", () => {
  const message = "Tenho 12 m2 disponiveis para instalar a piscina.";
  const candidates = extractDeterministicQualificationCandidates(message);
  assert.equal(candidates.some((candidate) => candidate.factKey === "requested_area_m2" && candidate.valueJson === 12), true);

  const accentedArea = extractDeterministicQualificationCandidates("Tenho 12 m² disponíveis para instalar uma piscina.");
  assert.equal(accentedArea.some((candidate) => candidate.factKey === "requested_area_m2" && candidate.valueJson === 12), true);

  const terrain = extractDeterministicQualificationCandidates("Tenho um terreno de 6 por 3 metros.");
  assert.equal(terrain.some((candidate) => candidate.factKey === "space_text" && candidate.valueJson === "6 por 3 metros"), true);
  assert.equal(terrain.some((candidate) => candidate.factKey === "requested_area_m2" && candidate.valueJson === 18), true);
});

test("produto com verbo tenho nao ganha autoridade de espaco", () => {
  for (const message of [
    "Tenho uma piscina de 2,8 por 7,5 metros.",
    "Tenho um modelo de piscina de 6 por 3 metros.",
    "Possuo uma piscina de 12 m2.",
  ]) {
    const candidates = extractDeterministicQualificationCandidates(message);
    assert.equal(candidates.some((candidate) => candidate.factKey === "space_text"), false, message);
    assert.equal(candidates.some((candidate) => candidate.factKey === "requested_area_m2"), false, message);
  }

  const mixedMessage = "Tenho uma piscina de 21 m2 e meu terreno tem 18 m2.";
  const mixedCandidates = extractDeterministicQualificationCandidates(mixedMessage);
  assert.equal(mixedCandidates.some((candidate) => candidate.factKey === "requested_area_m2" && candidate.valueJson === 18), true);
  assert.equal(mixedCandidates.some((candidate) => candidate.factKey === "requested_area_m2" && candidate.valueJson === 21), false);
});

test("ocorrencia identica do produto nao e autorizada pela ocorrencia do terreno", () => {
  const message = "Meu terreno mede 6 por 3 metros e o modelo da piscina mede 6 por 3 metros.";
  const terrainCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: "6 por 3 metros",
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: "Meu terreno mede 6 por 3 metros",
    },
  });
  assert.ok(terrainCandidate);

  const candidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: "6 por 3 metros",
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: "6 por 3 metros",
    },
  });
  assert.equal(candidate, null);

  const productCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: "6 por 3 metros",
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: "o modelo da piscina mede 6 por 3 metros",
    },
  });
  assert.equal(productCandidate, null);
});

test("areas com m2 e m2 no ciclo completo preservam o espaco", () => {
  for (const [message, value] of [
    ["Tenho 12 m² disponíveis para instalar uma piscina.", 12],
    ["Meu espaço tem 20 m².", 20],
  ] as const) {
    const result = evaluate(message, `${value} m²`, `${value} m²`);
    assert.deepEqual(result.discardedFactKeys, []);
    assert.equal(
      result.mergedCandidates.find((candidate) => candidate.factKey === "requested_area_m2")?.valueJson,
      value,
    );
  }
});

test("evidencia ampla nao autoriza valor dimensional do produto", () => {
  const message = "Meu terreno mede 6 por 3 metros e a piscina mede 2,8 por 7,5 metros.";
  const productCandidate = validateQualificationFactCandidate({
    anchorMessage: message,
    candidate: {
      factKey: "space_text",
      valueKind: "text",
      valueJson: "2,8 por 7,5 metros",
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: message,
    },
  });
  assert.equal(productCandidate, null);

  const result = mergeQualificationFactCandidates({
    deterministicCandidates: extractDeterministicQualificationCandidates(message)
      .map((candidate) => validateQualificationFactCandidate({ candidate, anchorMessage: message }))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null),
    aiCandidates: [],
  });
  assert.equal(result.mergedCandidates.find((candidate) => candidate.factKey === "space_text")?.valueJson, "6 por 3 metros");
  assert.equal(result.mergedCandidates.find((candidate) => candidate.factKey === "requested_area_m2")?.valueJson, 18);

  const areaMessage = "A piscina tem 21 m2 e meu terreno tem 18 m2.";
  const productAreaCandidate = validateQualificationFactCandidate({
    anchorMessage: areaMessage,
    candidate: {
      factKey: "requested_area_m2",
      valueKind: "number",
      valueJson: 21,
      assertionLevel: "confirmed",
      sourceType: "incoming_customer_message",
      evidenceText: areaMessage,
    },
  });
  assert.equal(productAreaCandidate, null);

  const areaResult = mergeQualificationFactCandidates({
    deterministicCandidates: extractDeterministicQualificationCandidates(areaMessage)
      .map((candidate) => validateQualificationFactCandidate({ candidate, anchorMessage: areaMessage }))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null),
    aiCandidates: [],
  });
  assert.equal(areaResult.mergedCandidates.find((candidate) => candidate.factKey === "requested_area_m2")?.valueJson, 18);
});

test("areas distintas do mesmo espaco nao escolhem arbitrariamente uma area", () => {
  const message = "Meu terreno tem 12 m2 e outro espaço tem 18 m2.";
  const deterministicCandidates = extractDeterministicQualificationCandidates(message)
    .map((candidate) => validateQualificationFactCandidate({ candidate, anchorMessage: message }))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const result = mergeQualificationFactCandidates({ deterministicCandidates, aiCandidates: [] });

  assert.equal(result.discardedFactKeys.includes("requested_area_m2"), true);
  assert.equal(result.mergedCandidates.some((candidate) => candidate.factKey === "requested_area_m2"), false);
});
