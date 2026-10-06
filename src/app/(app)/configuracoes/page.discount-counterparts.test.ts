import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/app/(app)/configuracoes/page.tsx", "utf8");
const closedSummarySource = source.slice(
  source.indexOf("const discountItems = useMemo"),
  source.indexOf("const channelsOverviewMetrics = useMemo"),
);

test("discount counterparts UI uses human conditional questions and canonical labels", () => {
  assert.match(source, /A IA pode pedir alguma condição em troca de uma condição comercial melhor/);
  assert.match(source, /Quais formas de pagamento a IA pode pedir como contrapartida/);
  assert.match(source, /A IA pode pedir uma entrada maior em troca de uma condição melhor/);
  assert.match(source, /A IA pode pedir menos parcelas em troca de uma condição melhor/);
  assert.match(source, /DISCOUNT_COUNTERPART_PAYMENT_OPTIONS/);
  assert.doesNotMatch(source, /label: method \}\)\}/);
});

test("disabled root condition hides child editor and saves disabled policy", () => {
  assert.match(source, /discountCounterpartDraft\.enabled \? <></);
  assert.match(source, /p_enabled: normalized\.value\.enabled/);
  assert.match(source, /enabled: false/);
});

test("higher entry validation is tied to canonical payment settings and invalid legacy rows are signaled", () => {
  assert.match(source, /validateHigherDownPaymentAgainstPaymentSettings/);
  assert.match(source, /paymentSettings/);
  assert.match(source, /entrada precisa ser ajustada/);
  assert.match(source, /A contrapartida deve ter menos parcelas que o limite normal da loja/);
});

test("objective baselines render only their own input and none keeps the type choice", () => {
  assert.match(source, /counterpartDownPaymentBaseline\.kind === "percent"/);
  assert.match(source, /counterpartDownPaymentBaseline\.kind === "fixed"/);
  assert.match(source, /counterpartDownPaymentBaseline\.kind === "none" \? <ChoiceButtonGroup/);
  assert.match(source, /Entrada normal da loja:/);
  assert.match(source, /counterpartDownPaymentBaseline\.value \/ 100/);
  assert.match(source, /case_by_case/);
  assert.match(source, /counterpartDownPaymentBaseline\.kind !== "invalid"/);
});

test("saved draft values remain the source of the rendered minimum input and save lifecycle is unchanged", () => {
  assert.match(source, /discountCounterpartDraft\.higherDownPaymentMinimumPercent/);
  assert.match(source, /discountCounterpartDraft\.higherDownPaymentMinimumAmount/);
  assert.match(source, /setDiscountCounterpartDraft\(\(current\) =>/);
  assert.match(source, /onClick=\{\(\) => void handleDiscountEditSave\(\)\}/);
  assert.match(source, /handleDiscountEditCancel\(\)/);
});

test("counterpart subsection uses the main discount lifecycle", () => {
  assert.doesNotMatch(source, /isDiscountCounterpartEditing/);
  assert.doesNotMatch(source, /handleDiscountCounterpartSave/);
  assert.match(source, /persistDiscountCounterpartPolicy/);
  assert.match(source, /await persistDiscountCounterpartPolicy\(\)/);
  assert.match(source, /setDiscountCounterpartDraft\(\s*createStoreDiscountCounterpartPolicyInputFromSources/);
  assert.match(source, /title="Descontos e aprovação"[\s\S]*Contrapartidas de negociação/);
});

test("closed discount summary is compact and includes one counterpart line", () => {
  assert.match(closedSummarySource, /label: "Desconto inicial"/);
  assert.match(closedSummarySource, /label: "Limite normal"/);
  assert.match(closedSummarySource, /label: "Autonomia da IA"/);
  assert.match(closedSummarySource, /label: "Venda de valor alto"/);
  assert.match(closedSummarySource, /label: "Contrapartidas"/);
  assert.match(closedSummarySource, /entrada ≥/);
  assert.match(closedSummarySource, /até \$\{discountCounterpartPolicy\.fewer_installments_max_count\}x/);
  assert.doesNotMatch(closedSummarySource, /label: "Status"/);
  assert.doesNotMatch(closedSummarySource, /label: "Métodos"/);
  assert.doesNotMatch(closedSummarySource, /label: "Regra para vendas de valor alto"/);
  assert.doesNotMatch(closedSummarySource, /label: "Aprovação em venda de valor alto"/);
  assert.doesNotMatch(closedSummarySource, /allowed_payment_methods\?\.join/);
});
