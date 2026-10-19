import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  compareOperationalStores,
  getOperationalSummary,
} from "./operational-summary";

const available = {
  ai: { queue: "available", diagnostics: "available" },
  commercial: { queue: "available", diagnostics: "available" },
};

test("confirmed source observations preserve real zero and positive values", () => {
  const zero = getOperationalSummary({ dataAvailability: available });
  const positive = getOperationalSummary({
    pendingAiRuns: 2,
    pendingSalesActions: 3,
    dataAvailability: available,
  });

  assert.equal(zero.observedTotal, 0);
  assert.equal(positive.observedTotal, 5);
  assert.equal(positive.hasPotentialPending, true);
  assert.equal(positive.displayTotal, "Parcial");
});

test("unknown WhatsApp/configuration availability prevents a definitive aggregate", () => {
  const summary = getOperationalSummary({
    pendingAiRuns: 0,
    pendingSalesActions: 0,
    pendingWhatsappEvents: 0,
    dataAvailability: available,
  });

  assert.equal(summary.confirmedTotal, null);
  assert.equal(summary.availability, "partial");
  assert.equal(summary.displayTotal, "Parcial");
  assert.equal(summary.hasPotentialPending, true);
  assert.match(summary.details, /não é definitivo/);
});

test("partial or unavailable sources preserve observed details without numeric aggregate", () => {
  const summary = getOperationalSummary({
    aiRunQueueErrors: 4,
    pendingSalesActions: 7,
    dataAvailability: {
      ai: { queue: "partial", diagnostics: "available" },
      commercial: { queue: "unavailable", diagnostics: "unavailable" },
    },
  });

  assert.equal(summary.confirmedTotal, null);
  assert.equal(summary.displayTotal, "Parcial");
  assert.match(summary.details, /Fila de IA parcial/);
  assert.doesNotMatch(summary.details, /7 ação comercial pendente/);
});

test("sorting compares counts only when both stores are confirmed", () => {
  const partialLarge = {
    id: "b",
    name: "Beta",
    pendingAiRuns: 99,
    dataAvailability: { ai: { queue: "partial" }, commercial: available.commercial },
  };
  const confirmedSmall = {
    id: "a",
    name: "Alfa",
    pendingAiRuns: 1,
    dataAvailability: available,
  };

  assert.equal(compareOperationalStores(partialLarge, confirmedSmall) > 0, true);
  assert.equal(compareOperationalStores(confirmedSmall, partialLarge) < 0, true);
});

test("sorting is deterministic for ties and never removes stores", () => {
  const stores = [
    { id: "2", name: "Loja", pendingAiRuns: 1, dataAvailability: available },
    { id: "1", name: "Loja", pendingAiRuns: 1, dataAvailability: available },
    { id: "3", name: "Outra", dataAvailability: available },
  ];

  const sorted = [...stores].sort(compareOperationalStores);
  assert.deepEqual(sorted.map((store) => store.id), ["1", "2", "3"]);
  assert.equal(sorted.length, stores.length);
});
