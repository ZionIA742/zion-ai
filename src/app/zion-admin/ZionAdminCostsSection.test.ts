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

assert.equal(source.includes("Custos fixos"), true);
assert.equal(source.includes("Despesas variáveis manuais"), true);
assert.equal(source.includes("add_variable"), true);
assert.equal(source.includes("edit_variable"), true);
assert.equal(source.includes("cancel_variable"), true);
assert.equal(source.includes("operationKey"), true);
assert.equal(source.includes("expectedUpdatedAt"), true);
assert.equal(source.includes("data.variableExpenses===null"), true);
assert.equal(source.includes("Nenhuma despesa manual encontrada"), true);
assert.equal(source.includes("O lançamento continuará disponível no histórico"), true);
assert.equal(source.includes("Não entram automaticamente no total consolidado"), true);
assert.equal(source.includes("IA variável"), true);

// Os blocos ficam simultaneamente acessíveis, com empilhamento responsivo.
assert.equal(source.includes('role="tablist"'), false);
assert.equal(source.includes("activeTab"), false);
assert.equal(source.includes('className="grid gap-3 lg:grid-cols-2"'), true);
assert.equal(source.includes('p-3 lg:col-span-2'), true);
assert.equal(source.indexOf("Despesas fixas") < source.indexOf("Despesas variáveis manuais"), true);
assert.equal(source.indexOf("Despesas variáveis manuais") < source.indexOf("Uso da IA por tipo"), true);

console.log("zion-admin-costs-ui: consolidated total and availability tests passed");
