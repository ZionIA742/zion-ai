import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STORE_READINESS_REASON_CODES,
  normalizeStoreReadinessCapability,
  resolveStoreReadiness,
} from "./store-readiness";

type TableResponse =
  | {
      data?: unknown[];
      single?: unknown | null;
      error?: { message: string } | null;
    }
  | undefined;

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createReadOnlySupabase(tables: Record<string, TableResponse>) {
  const operations: Array<{
    kind: string;
    table?: string;
    columns?: string;
    options?: Record<string, unknown> | undefined;
    column?: string;
    value?: unknown;
    count?: number;
  }> = [];

  function createListResult(table: string) {
    const entry = tables[table];
    return {
      data: Array.isArray(entry?.data) ? entry?.data : [],
      error: entry?.error ?? null,
    };
  }

  function createSingleResult(table: string) {
    const entry = tables[table];
    return {
      data:
        entry && Object.prototype.hasOwnProperty.call(entry, "single")
          ? entry.single ?? null
          : null,
      error: entry?.error ?? null,
    };
  }

  function createBuilder(table: string, columns: string, options?: Record<string, unknown>) {
    const builder = {
      eq(column: string, value: unknown) {
        operations.push({ kind: "eq", table, column, value });
        return builder;
      },
      limit(count: number) {
        operations.push({ kind: "limit", table, count });
        return builder;
      },
      maybeSingle() {
        operations.push({ kind: "maybeSingle", table });
        return Promise.resolve(createSingleResult(table));
      },
      then(
        onFulfilled?:
          | ((value: { data: unknown[]; error: { message: string } | null }) => unknown)
          | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) {
        return Promise.resolve(createListResult(table)).then(
          onFulfilled ?? undefined,
          onRejected ?? undefined,
        );
      },
    };

    operations.push({ kind: "select", table, columns, options });
    return builder;
  }

  return {
    operations,
    client: {
      from(table: string) {
        operations.push({ kind: "from", table });
        return {
          select(columns: string, options?: Record<string, unknown>) {
            return createBuilder(table, columns, options);
          },
          insert() {
            throw new Error(`unexpected insert on ${table}`);
          },
          update() {
            throw new Error(`unexpected update on ${table}`);
          },
          upsert() {
            throw new Error(`unexpected upsert on ${table}`);
          },
          delete() {
            throw new Error(`unexpected delete on ${table}`);
          },
        };
      },
      rpc(name: string) {
        throw new Error(`unexpected rpc ${name}`);
      },
    },
  };
}

function createBaseTables(overrides?: Partial<Record<string, TableResponse>>) {
  return {
    store_onboarding: {
      single: { status: "completed" },
    },
    store_responsibles: {
      data: [
        {
          id: "responsible-1",
          name: "Maria",
          role: "owner",
          whatsapp_number: "5511999990000",
        },
      ],
    },
    store_schedule_settings: {
      single: {
        timezone_name: "America/Sao_Paulo",
        operating_days: ["monday", "tuesday"],
        operating_hours: {
          monday: { start: "08:00", end: "18:00" },
          tuesday: { start: "08:00", end: "18:00" },
        },
        allow_same_time_appointments: false,
        same_time_capacity: null,
      },
    },
    pools: {
      data: [{ id: "pool-1" }],
    },
    store_catalog_items: {
      data: [],
    },
    store_quote_settings: {
      single: {
        id: "quote-settings-1",
        organization_id: "org-1",
        store_id: "store-1",
        quote_pdf_enabled: true,
        ai_can_generate_quote: true,
        ai_can_send_quote_to_customer: true,
        requires_human_approval_before_send: true,
        quote_number_prefix: "ORC",
        next_quote_number: 1,
      },
    },
    ...overrides,
  };
}

async function resolveWithTables(overrides?: Partial<Record<string, TableResponse>>) {
  const supabase = createReadOnlySupabase(createBaseTables(overrides));
  const result = await resolveStoreReadiness({
    supabase: supabase.client as never,
    organizationId: "org-1",
    storeId: "store-1",
  });

  return {
    result,
    operations: supabase.operations,
  };
}

const tests: TestCase[] = [
  {
    name: "onboarding completed resolves ready",
    run: async () => {
      const { result } = await resolveWithTables();
      assert.equal(result.capabilitiesByKey.onboarding_minimum.state, "ready");
      assert.equal(result.capabilitiesByKey.onboarding_minimum.blocksAccess, false);
      assert.deepEqual(result.capabilitiesByKey.onboarding_minimum.reasonCodes, []);
    },
  },
  {
    name: "onboarding not_started resolves not_configured and blocks access",
    run: async () => {
      const { result } = await resolveWithTables({
        store_onboarding: { single: { status: "not_started" } },
      });

      assert.equal(
        result.capabilitiesByKey.onboarding_minimum.state,
        "not_configured",
      );
      assert.equal(result.capabilitiesByKey.onboarding_minimum.blocksAccess, true);
      assert.deepEqual(result.capabilitiesByKey.onboarding_minimum.reasonCodes, [
        STORE_READINESS_REASON_CODES.ONBOARDING_MINIMUM_INCOMPLETE,
      ]);
    },
  },
  {
    name: "onboarding in_progress resolves not_configured and blocks access",
    run: async () => {
      const { result } = await resolveWithTables({
        store_onboarding: { single: { status: "in_progress" } },
      });

      assert.equal(
        result.capabilitiesByKey.onboarding_minimum.state,
        "not_configured",
      );
      assert.equal(result.capabilitiesByKey.onboarding_minimum.blocksAccess, true);
      assert.deepEqual(result.capabilitiesByKey.onboarding_minimum.reasonCodes, [
        STORE_READINESS_REASON_CODES.ONBOARDING_MINIMUM_INCOMPLETE,
      ]);
    },
  },
  {
    name: "onboarding missing status resolves not_configured and blocks access",
    run: async () => {
      const { result } = await resolveWithTables({
        store_onboarding: { single: null },
      });

      assert.equal(
        result.capabilitiesByKey.onboarding_minimum.state,
        "not_configured",
      );
      assert.equal(result.capabilitiesByKey.onboarding_minimum.blocksAccess, true);
      assert.deepEqual(result.capabilitiesByKey.onboarding_minimum.reasonCodes, [
        STORE_READINESS_REASON_CODES.ONBOARDING_STATUS_MISSING,
      ]);
    },
  },
  {
    name: "single valid responsible resolves ready",
    run: async () => {
      const { result } = await resolveWithTables();
      assert.equal(result.capabilitiesByKey.responsible_operational.state, "ready");
    },
  },
  {
    name: "missing responsible resolves not_configured",
    run: async () => {
      const { result } = await resolveWithTables({
        store_responsibles: { data: [] },
      });

      assert.equal(
        result.capabilitiesByKey.responsible_operational.state,
        "not_configured",
      );
      assert.deepEqual(result.capabilitiesByKey.responsible_operational.reasonCodes, [
        STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_MISSING,
      ]);
    },
  },
  {
    name: "ambiguous responsible resolves blocked",
    run: async () => {
      const { result } = await resolveWithTables({
        store_responsibles: {
          data: [
            {
              id: "responsible-1",
              name: "Maria",
              role: "owner",
              whatsapp_number: "5511999990000",
            },
            {
              id: "responsible-2",
              name: "Joao",
              role: "owner",
              whatsapp_number: "5511888880000",
            },
          ],
        },
      });

      assert.equal(result.capabilitiesByKey.responsible_operational.state, "blocked");
      assert.deepEqual(result.capabilitiesByKey.responsible_operational.reasonCodes, [
        STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_AMBIGUOUS,
      ]);
    },
  },
  {
    name: "responsible with invalid destination resolves blocked",
    run: async () => {
      const { result } = await resolveWithTables({
        store_responsibles: {
          data: [
            {
              id: "responsible-1",
              name: "Maria",
              role: "owner",
              whatsapp_number: "123",
            },
          ],
        },
      });

      assert.equal(result.capabilitiesByKey.responsible_operational.state, "blocked");
      assert.deepEqual(result.capabilitiesByKey.responsible_operational.reasonCodes, [
        STORE_READINESS_REASON_CODES.PRIMARY_RESPONSIBLE_INVALID_DESTINATION,
      ]);
    },
  },
  {
    name: "valid agenda resolves ready",
    run: async () => {
      const { result } = await resolveWithTables();
      assert.equal(result.capabilitiesByKey.agenda.state, "ready");
    },
  },
  {
    name: "missing agenda resolves not_configured",
    run: async () => {
      const { result } = await resolveWithTables({
        store_schedule_settings: { single: null },
      });

      assert.equal(result.capabilitiesByKey.agenda.state, "not_configured");
      assert.deepEqual(result.capabilitiesByKey.agenda.reasonCodes, [
        STORE_READINESS_REASON_CODES.SCHEDULE_SETTINGS_MISSING,
      ]);
    },
  },
  {
    name: "semantically invalid agenda resolves blocked",
    run: async () => {
      const { result } = await resolveWithTables({
        store_schedule_settings: {
          single: {
            timezone_name: "America/Sao_Paulo",
            operating_days: ["monday"],
            operating_hours: {
              monday: { start: "18:00", end: "08:00" },
            },
            allow_same_time_appointments: false,
            same_time_capacity: null,
          },
        },
      });

      assert.equal(result.capabilitiesByKey.agenda.state, "blocked");
      assert.deepEqual(result.capabilitiesByKey.agenda.reasonCodes, [
        STORE_READINESS_REASON_CODES.SCHEDULE_DAY_WINDOW_INVALID,
      ]);
    },
  },
  {
    name: "usable catalog resolves ready",
    run: async () => {
      const { result } = await resolveWithTables({
        pools: { data: [] },
        store_catalog_items: { data: [{ id: "catalog-item-1" }] },
      });

      assert.equal(result.capabilitiesByKey.catalog.state, "ready");
    },
  },
  {
    name: "empty catalog resolves not_configured",
    run: async () => {
      const { result } = await resolveWithTables({
        pools: { data: [] },
        store_catalog_items: { data: [] },
      });

      assert.equal(result.capabilitiesByKey.catalog.state, "not_configured");
      assert.deepEqual(result.capabilitiesByKey.catalog.reasonCodes, [
        STORE_READINESS_REASON_CODES.CATALOG_EMPTY,
      ]);
    },
  },
  {
    name: "quote settings ready resolves ready",
    run: async () => {
      const { result } = await resolveWithTables();
      assert.equal(result.capabilitiesByKey.quote.state, "ready");
    },
  },
  {
    name: "missing quote settings resolves not_configured",
    run: async () => {
      const { result } = await resolveWithTables({
        store_quote_settings: { single: null },
      });

      assert.equal(result.capabilitiesByKey.quote.state, "not_configured");
      assert.deepEqual(result.capabilitiesByKey.quote.reasonCodes, [
        STORE_READINESS_REASON_CODES.QUOTE_SETTINGS_MISSING,
      ]);
    },
  },
  {
    name: "quote pdf deliberately disabled resolves blocked",
    run: async () => {
      const { result } = await resolveWithTables({
        store_quote_settings: {
          single: {
            id: "quote-settings-1",
            organization_id: "org-1",
            store_id: "store-1",
            quote_pdf_enabled: false,
            ai_can_generate_quote: true,
            ai_can_send_quote_to_customer: true,
            requires_human_approval_before_send: true,
            quote_number_prefix: "ORC",
            next_quote_number: 1,
          },
        },
      });

      assert.equal(result.capabilitiesByKey.quote.state, "blocked");
      assert.deepEqual(result.capabilitiesByKey.quote.reasonCodes, [
        STORE_READINESS_REASON_CODES.QUOTE_PDF_DISABLED_BY_POLICY,
      ]);
    },
  },
  {
    name: "legacy quote generation flag false does not block quote readiness",
    run: async () => {
      const { result } = await resolveWithTables({
        store_quote_settings: {
          single: {
            id: "quote-settings-1",
            organization_id: "org-1",
            store_id: "store-1",
            quote_pdf_enabled: true,
            ai_can_generate_quote: false,
            ai_can_send_quote_to_customer: true,
            requires_human_approval_before_send: true,
            quote_number_prefix: "ORC",
            next_quote_number: 1,
          },
        },
      });

      assert.equal(result.capabilitiesByKey.quote.state, "ready");
      assert.deepEqual(result.capabilitiesByKey.quote.reasonCodes, []);
      assert.equal(result.capabilitiesByKey.quote.blocksCapability, false);
      assert.equal(result.capabilitiesByKey.quote.blocksPilotGo, false);
    },
  },
  {
    name: "legacy quote send flag false does not block quote readiness",
    run: async () => {
      const { result } = await resolveWithTables({
        store_quote_settings: {
          single: {
            id: "quote-settings-1",
            organization_id: "org-1",
            store_id: "store-1",
            quote_pdf_enabled: true,
            ai_can_generate_quote: true,
            ai_can_send_quote_to_customer: false,
            requires_human_approval_before_send: true,
            quote_number_prefix: "ORC",
            next_quote_number: 1,
          },
        },
      });

      assert.equal(result.capabilitiesByKey.quote.state, "ready");
      assert.deepEqual(result.capabilitiesByKey.quote.reasonCodes, []);
      assert.equal(result.capabilitiesByKey.quote.blocksCapability, false);
      assert.equal(result.capabilitiesByKey.quote.blocksPilotGo, false);
    },
  },
  {
    name: "human approval requirement alone does not block quote readiness",
    run: async () => {
      const { result } = await resolveWithTables({
        store_quote_settings: {
          single: {
            id: "quote-settings-1",
            organization_id: "org-1",
            store_id: "store-1",
            quote_pdf_enabled: true,
            ai_can_generate_quote: true,
            ai_can_send_quote_to_customer: true,
            requires_human_approval_before_send: true,
            quote_number_prefix: "ORC",
            next_quote_number: 1,
          },
        },
      });

      assert.equal(result.capabilitiesByKey.quote.state, "ready");
      assert.equal(result.capabilitiesByKey.quote.blocksCapability, false);
      assert.equal(result.capabilitiesByKey.quote.blocksPilotGo, false);
    },
  },
  {
    name: "not_applicable never blocks capability or pilot go",
    run: () => {
      const capability = normalizeStoreReadinessCapability({
        capabilityKey: "quote",
        state: "not_applicable",
        reasonCodes: [],
        missingFields: [],
        blocksAccess: true,
        blocksCapability: true,
        blocksPilotGo: true,
      });

      assert.equal(capability.blocksAccess, false);
      assert.equal(capability.blocksCapability, false);
      assert.equal(capability.blocksPilotGo, false);
    },
  },
  {
    name: "resolver stays read only and never persists readiness",
    run: async () => {
      const { operations } = await resolveWithTables();
      const persistedOperations = operations.filter((entry) =>
        ["insert", "update", "upsert", "delete", "rpc"].includes(entry.kind),
      );

      assert.deepEqual(persistedOperations, []);
      assert.equal(
        operations.some(
          (entry) => entry.kind === "from" && entry.table === "store_readiness",
        ),
        false,
      );
    },
  },
  {
    name: "resolver is not wired into access gates",
    run: () => {
      const protectedFiles = [
        "src/lib/server/account-access-resolver.ts",
        "src/app/api/account/ensure-setup/route-handler.ts",
        "src/components/OnboardingGuard.tsx",
      ];

      for (const relativePath of protectedFiles) {
        const source = readFileSync(join(process.cwd(), relativePath), "utf8");
        assert.equal(
          source.includes("store-readiness"),
          false,
          `${relativePath} must not import or reference store-readiness yet`,
        );
      }
    },
  },
];

async function main() {
  for (const current of tests) {
    await current.run();
  }

  console.log(`store-readiness: ${tests.length} tests passed`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
