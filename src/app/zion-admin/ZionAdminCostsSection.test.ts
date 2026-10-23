import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { formatCostMetric } from "@/lib/server/zion-admin-costs";

const source = readFileSync("src/app/zion-admin/ZionAdminCostsSection.tsx", "utf8");
const costUsd = (value: number | null, availability: "available" | "partial" | "unavailable", completeness: "complete" | "incomplete" | "no_runs") => formatCostMetric(value, availability, completeness, (known) => `$${known.toFixed(4)}`);
const costNumber = (value: number | null, availability: "available" | "partial" | "unavailable", completeness: "complete" | "incomplete" | "no_runs") => formatCostMetric(value, availability, completeness, (known) => String(known));

assert.equal(costUsd(0, "available", "complete"), "$0.0000");
assert.equal(costUsd(1.25, "available", "complete"), "$1.2500");
assert.equal(costUsd(0.75, "available", "complete"), "$0.7500");
assert.equal(costUsd(null, "available", "incomplete"), "Incompleto");
assert.equal(costUsd(0, "available", "no_runs"), "Sem execuções");
assert.equal(costUsd(0, "partial", "complete"), "Parcial");
assert.equal(costUsd(0, "unavailable", "complete"), "Indisponível");
assert.equal(costUsd(0, "available", undefined as never), "Incompleto");
assert.equal(costNumber(0, "available", "complete"), "0");
assert.equal(costNumber(null, "available", "incomplete"), "Incompleto");

assert.equal(source.includes("Consumo total em USD"), true);
assert.equal(source.includes("data.totals.aiCostUsd"), true);
assert.equal(source.includes("Custo individual em USD"), true);
assert.equal(source.includes("data.dataAvailability?.aiRuns"), true);
assert.equal(source.includes("data.totals.costCompleteness"), true);
assert.equal(source.includes("data.totals.tokenCompleteness"), true);
assert.equal(source.includes("data.dataAvailability?.messagesSales"), true);
assert.equal(source.includes("data.dataAvailability?.messagesAssistant"), true);
assert.equal(source.includes("Geração de imagem"), true);
assert.equal(source.includes("Catálogo visual"), true);
assert.equal(source.includes("Não classificado"), true);
assert.equal(source.includes("Mensagens IA vendedora"), false);
assert.equal(source.includes("Mensagens IA assistente"), false);
assert.equal(source.includes("Consumo em dólares"), false);

console.log("zion-admin-costs-ui: consolidated total and availability tests passed");
