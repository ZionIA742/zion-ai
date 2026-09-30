import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerStateFromCityOperationKey,
  normalizeMunicipalityLookupName,
  resolveCustomerStateCodeFromCity,
} from "./customer-geography-resolution.js";

function createSupabase(args: {
  rows?: Array<Record<string, unknown>>;
  error?: { message: string } | null;
}) {
  const calls: Array<{ table: string; normalizedName: unknown; limit: number }> = [];

  return {
    calls,
    from(table: string) {
      assert.equal(table, "brazilian_municipalities");
      const state = { normalizedName: undefined as unknown, limit: 0 };
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          assert.equal(column, "normalized_name");
          state.normalizedName = value;
          return this;
        },
        limit(value: number) {
          state.limit = value;
          calls.push({ table, ...state });
          return Promise.resolve({ data: args.rows ?? [], error: args.error ?? null });
        },
      };
    },
  };
}

const suzano = {
  ibge_code: 3552502,
  name: "Suzano",
  normalized_name: "suzano",
  state_code: "SP",
};

test("municipality normalization is deterministic and accent-insensitive", () => {
  assert.equal(normalizeMunicipalityLookupName(" Suzano "), "suzano");
  assert.equal(normalizeMunicipalityLookupName("São João del Rei"), "sao joao del rei");
  assert.equal(normalizeMunicipalityLookupName("Pingo-d'Água"), "pingo d agua");
  assert.equal(
    normalizeMunicipalityLookupName("Olho d'Água das Flores"),
    "olho d agua das flores",
  );
});

test("unique municipality resolves its canonical UF", async () => {
  const supabase = createSupabase({ rows: [suzano] });
  const result = await resolveCustomerStateCodeFromCity({
    supabase,
    cityValue: "Suzano",
  });

  assert.equal(result.status, "unique");
  assert.equal(result.stateCode, "SP");
  assert.equal(result.municipality?.ibgeCode, 3552502);
  assert.deepEqual(supabase.calls, [
    { table: "brazilian_municipalities", normalizedName: "suzano", limit: 2 },
  ]);
});

test("ambiguous municipality does not choose a UF", async () => {
  const supabase = createSupabase({
    rows: [
      { ibge_code: 2500734, name: "Amparo", normalized_name: "amparo", state_code: "PB" },
      { ibge_code: 3501905, name: "Amparo", normalized_name: "amparo", state_code: "SP" },
    ],
  });
  const result = await resolveCustomerStateCodeFromCity({
    supabase,
    cityValue: "Amparo",
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.stateCode, null);
});

test("not found and lookup errors fail closed", async () => {
  const notFound = await resolveCustomerStateCodeFromCity({
    supabase: createSupabase({ rows: [] }),
    cityValue: "Cidade inexistente",
  });
  assert.equal(notFound.status, "not_found");

  const failed = await resolveCustomerStateCodeFromCity({
    supabase: createSupabase({ error: { message: "lookup failed" } }),
    cityValue: "Suzano",
  });
  assert.equal(failed.status, "lookup_failed");
});

test("malformed municipality rows fail closed", async () => {
  const result = await resolveCustomerStateCodeFromCity({
    supabase: createSupabase({ rows: [{ ...suzano, state_code: "S" }] }),
    cityValue: "Suzano",
  });
  assert.equal(result.status, "lookup_failed");
});

test("city event produces a stable bounded operation key", () => {
  const cityEventId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    buildCustomerStateFromCityOperationKey(cityEventId),
    `p9_qfact_customer_state_from_city_v1:${cityEventId}:customer_state_code`,
  );
  assert.equal(buildCustomerStateFromCityOperationKey(""), null);
  assert.equal(buildCustomerStateFromCityOperationKey("abc"), null);
  assert.equal(buildCustomerStateFromCityOperationKey("event_123"), null);
});
