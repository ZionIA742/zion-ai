import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pagePath = "src/app/(app)/configuracoes/page.tsx";
const source = readFileSync(pagePath, "utf8");

function count(value: string): number {
  return source.split(value).length - 1;
}

test("Cards 7-10 importam builders e hydrators canonicos", () => {
  for (const symbol of [
    "buildPoolReplacementExecutionPolicy",
    "buildDeliveryExecutionPolicy",
    "buildPickupExecutionPolicy",
    "buildTechnicalServicesExecutionPolicy",
    "poolReplacementPolicyToDraftPatch",
    "deliveryPolicyToDraftPatch",
    "pickupPolicyToDraftPatch",
    "technicalServicesPolicyToDraftPatch",
  ]) {
    assert.ok(source.includes(symbol), `faltando ${symbol}`);
  }
});

test("Cards 7-10 usam markers canonicos de configured_at", () => {
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.pool_replacement_configured_at",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.delivery_configured_at",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.pickup_configured_at",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.technical_services_configured_at",
    ),
  );
});

test("Cards 7-10 leem policies da mesma row scoped canonica", () => {
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.pool_replacement_policy ?? null",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.delivery_policy ?? null",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.pickup_policy ?? null",
    ),
  );
  assert.ok(
    source.includes(
      "operationExecutionPolicies?.technical_services_policy ?? null",
    ),
  );

  assert.ok(
    source.includes(
      '"read_store_operation_execution_policies_scoped"',
    ),
  );
});

test("reader scoped hidrata saved e draft dos Cards 7-10", () => {
  for (const patch of [
    "poolReplacementPatch",
    "deliveryPatch",
    "pickupPatch",
    "technicalServicesPatch",
  ]) {
    assert.ok(
      count(`...${patch}`) >= 2,
      `${patch} deve hidratar saved e draft`,
    );
  }
});

test("Card 7 possui writer dedicado e payload canonico", () => {
  assert.equal(
    count(
      '"upsert_store_operation_pool_replacement_configuration_scoped"',
    ),
    1,
  );

  assert.ok(
    source.includes("p_enabled: enabled"),
  );
  assert.ok(
    source.includes("p_policy: policy"),
  );
  assert.ok(
    source.includes(
      "buildPoolReplacementExecutionPolicy(",
    ),
  );
});

test("Card 8 possui writer dedicado e payload canonico", () => {
  assert.equal(
    count(
      '"upsert_store_operation_delivery_configuration_scoped"',
    ),
    1,
  );

  assert.ok(
    source.includes("buildDeliveryExecutionPolicy("),
  );
  assert.ok(
    source.includes(
      "deliveryPolicyToDraftPatch(",
    ),
  );
});

test("Card 9 possui writer dedicado e payload canonico", () => {
  assert.equal(
    count(
      '"upsert_store_operation_pickup_configuration_scoped"',
    ),
    1,
  );

  assert.ok(
    source.includes("buildPickupExecutionPolicy("),
  );
  assert.ok(
    source.includes(
      "pickupPolicyToDraftPatch(",
    ),
  );
});

test("Card 10 possui writer dedicado e payload canonico", () => {
  assert.equal(
    count(
      '"upsert_store_operation_technical_services_configuration_scoped"',
    ),
    1,
  );

  assert.ok(
    source.includes(
      "buildTechnicalServicesExecutionPolicy(",
    ),
  );
  assert.ok(
    source.includes(
      "technicalServicesPolicyToDraftPatch(",
    ),
  );
});

test("Cards 7-10 nao usam mais o bridge local antigo", () => {
  for (const oldCall of [
    'saveOperationExperienceCard("pool_replacement")',
    'saveOperationExperienceCard("delivery")',
    'saveOperationExperienceCard("pickup")',
    'saveOperationExperienceCard("technical_services")',
  ]) {
    assert.equal(
      count(oldCall),
      0,
      `bridge antigo ainda presente: ${oldCall}`,
    );
  }
});

test("status visual dos Cards 7-10 depende da authority canonica", () => {
  assert.ok(
    source.includes(
      'tone={poolReplacementCardIsComplete ? "blue" : "yellow"}',
    ),
  );
  assert.ok(
    source.includes(
      'tone={deliveryCardIsComplete ? "blue" : "yellow"}',
    ),
  );
  assert.ok(
    source.includes(
      'tone={pickupCardIsComplete ? "blue" : "yellow"}',
    ),
  );
  assert.ok(
    source.includes(
      'tone={technicalServicesCardIsComplete ? "blue" : "yellow"}',
    ),
  );

  assert.ok(
    source.includes(
      'status={poolReplacementCardIsComplete ? "Completo" : "Precisa de atenção"}',
    ),
  );
  assert.ok(
    source.includes(
      'status={deliveryCardIsComplete ? "Completo" : "Precisa de atenção"}',
    ),
  );
  assert.ok(
    source.includes(
      'status={pickupCardIsComplete ? "Completo" : "Precisa de atenção"}',
    ),
  );
  assert.ok(
    source.includes(
      'status={technicalServicesCardIsComplete ? "Completo" : "Precisa de atenção"}',
    ),
  );
});

test("cada save usa row retornada pelo writer antes de atualizar UI", () => {
  const required = [
    "savedRow.pool_replacement_policy",
    "savedRow.delivery_policy",
    "savedRow.pickup_policy",
    "savedRow.technical_services_policy",
  ];

  for (const value of required) {
    assert.ok(
      source.includes(value),
      `faltando rehidratacao por ${value}`,
    );
  }

  assert.ok(
    count("setOperationExecutionPolicies(savedRow);") >= 6,
    "writer deve atualizar row canonica retornada",
  );
});

test("Cards 7-10 fecham somente dentro do caminho de sucesso", () => {
  for (const writer of [
    "savePoolReplacementConfigurationCard",
    "saveDeliveryConfigurationCard",
    "savePickupConfigurationCard",
    "saveTechnicalServicesConfigurationCard",
  ]) {
    const start = source.indexOf(`const ${writer} =`);
    assert.ok(start >= 0, `writer nao encontrado: ${writer}`);

    const rpcIndex = source.indexOf("await supabase.rpc(", start);
    const errorIndex = source.indexOf("if (error) throw error;", rpcIndex);
    const savedRowIndex = source.indexOf("const savedRow =", errorIndex);
    const closeIndex = source.indexOf(
      "setOperationEditTarget(null);",
      savedRowIndex,
    );

    assert.ok(rpcIndex > start, `${writer}: RPC ausente`);
    assert.ok(
      errorIndex > rpcIndex,
      `${writer}: erro precisa ser tratado depois do RPC`,
    );
    assert.ok(
      savedRowIndex > errorIndex,
      `${writer}: row canonica precisa vir depois do sucesso`,
    );
    assert.ok(
      closeIndex > savedRowIndex,
      `${writer}: card fechou antes de confirmar row salva`,
    );
  }
});