import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  combineOverviewAvailability,
  formatAvailableOverviewValue,
  getOverviewDiagnosticsAvailability,
  getOverviewAvailabilityLabel,
  getOverviewOperationalAvailability,
  getOverviewQueueAvailability,
  getPendingDetailsAvailabilityNotices,
  normalizeOverviewDataAvailability,
} from "./overview-availability";

const format = (value: unknown) => `valor:${String(value)}`;

test("available preserves confirmed zero and positive values", () => {
  assert.equal(formatAvailableOverviewValue(0, "available", format), "valor:0");
  assert.equal(formatAvailableOverviewValue(12, "available", format), "valor:12");
});

test("unavailable and partial never render numeric values", () => {
  assert.equal(formatAvailableOverviewValue(0, "unavailable", format), "Indisponível");
  assert.equal(formatAvailableOverviewValue(0, "partial", format), "Parcial");
});

test("missing or invalid availability fails closed", () => {
  assert.equal(normalizeOverviewDataAvailability(undefined), "unavailable");
  assert.equal(normalizeOverviewDataAvailability("unknown"), "unavailable");
  assert.equal(getOverviewAvailabilityLabel(undefined), "Fonte indisponível; contagem não confirmada.");
});

test("independent sources preserve partial aggregate state", () => {
  assert.equal(combineOverviewAvailability("available", "available"), "available");
  assert.equal(combineOverviewAvailability("unavailable", "unavailable"), "unavailable");
  assert.equal(combineOverviewAvailability("available", "unavailable"), "partial");
  assert.equal(combineOverviewAvailability("partial", "available"), "partial");
});

test("queue-derived error counts use queue availability, not diagnostics", () => {
  const ai = { queue: "unavailable", diagnostics: "available" };
  const commercial = { queue: "unavailable", diagnostics: "available" };

  assert.equal(getOverviewQueueAvailability(ai), "unavailable");
  assert.equal(getOverviewDiagnosticsAvailability(ai), "available");
  assert.equal(getOverviewQueueAvailability(commercial), "unavailable");
  assert.equal(getOverviewDiagnosticsAvailability(commercial), "available");
  assert.notEqual(
    formatAvailableOverviewValue(0, getOverviewQueueAvailability(ai), format),
    "valor:0",
  );
  assert.equal(formatAvailableOverviewValue(2, getOverviewDiagnosticsAvailability(ai), format), "valor:2");
});

test("unavailable AI runs never render failed runs as confirmed zero", () => {
  assert.notEqual(
    formatAvailableOverviewValue(0, "unavailable", format),
    "valor:0",
  );
  assert.equal(
    formatAvailableOverviewValue(0, "available", format),
    "valor:0",
  );
});

test("operational summary availability is partial for mixed sources and preserves zero when all are available", () => {
  assert.equal(
    getOverviewOperationalAvailability({
      ai: { queue: "available", diagnostics: "available" },
      commercial: { queue: "unavailable", diagnostics: "available" },
    }),
    "partial",
  );
  assert.equal(
    getOverviewOperationalAvailability({
      ai: { queue: "available", diagnostics: "available" },
      commercial: { queue: "available", diagnostics: "available" },
    }),
    "available",
  );
  assert.equal(
    getOverviewOperationalAvailability({
      ai: { queue: "unavailable", diagnostics: "unavailable" },
      commercial: { queue: "unavailable", diagnostics: "unavailable" },
      hasOtherAreaEvidence: true,
    }),
    "partial",
  );
});

test("details use diagnostics availability independently from queue counts", () => {
  assert.deepEqual(
    getPendingDetailsAvailabilityNotices({
      ai: { queue: "available", diagnostics: "unavailable" },
      commercial: { queue: "unavailable", diagnostics: "available" },
    }),
    [
      "Detalhes da fila de IA indisponíveis; não é possível confirmar a ausência de pendências de IA.",
    ],
  );

  assert.deepEqual(
    getPendingDetailsAvailabilityNotices({
      ai: { queue: "unavailable", diagnostics: "available" },
      commercial: { queue: "available", diagnostics: "partial" },
    }),
    ["Detalhes comerciais parciais; o conjunto carregado pode estar incompleto."],
  );
});

test("available empty details do not imply that the corresponding queues have no pending items", () => {
  const ai = { queue: "unavailable", diagnostics: "available" };
  const commercial = { queue: "unavailable", diagnostics: "available" };

  assert.deepEqual(getPendingDetailsAvailabilityNotices({ ai, commercial }), []);
  assert.equal(getOverviewQueueAvailability(ai), "unavailable");
  assert.equal(getOverviewQueueAvailability(commercial), "unavailable");
});

test("missing detail contracts fail closed without inventing WhatsApp or configuration availability", () => {
  assert.deepEqual(
    getPendingDetailsAvailabilityNotices({ ai: undefined, commercial: undefined }),
    [
      "Detalhes da fila de IA indisponíveis; não é possível confirmar a ausência de pendências de IA.",
      "Detalhes comerciais indisponíveis; não é possível confirmar a ausência de pendências comerciais.",
    ],
  );
});
