import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadCanonicalActivePrimaryStoreResponsible,
  normalizeResponsibleWhatsappDestination,
} from "./store-responsibles";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createStoreResponsiblesSupabase(args: {
  data: unknown[] | (() => unknown[]);
  error?: { message: string } | null;
}) {
  const filters: Array<{ column: string; value: unknown }> = [];

  const builder = {
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return builder;
    },
    then(
      onFulfilled?:
        | ((value: { data: unknown[]; error: { message: string } | null }) => unknown)
        | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) {
      return Promise.resolve({
        data: typeof args.data === "function" ? args.data() : args.data,
        error: args.error ?? null,
      }).then(onFulfilled ?? undefined, onRejected ?? undefined);
    },
  };

  return {
    filters,
    client: {
      from(table: string) {
        assert.equal(table, "store_responsibles");
        return {
          select(columns: string) {
            assert.equal(columns, "id, name, role, whatsapp_number");
            return builder;
          },
        };
      },
    },
  };
}

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260824123000_p19a_store_responsibles_canonical_primary.sql",
);
const helperPath = join(process.cwd(), "src/lib/server/store-responsibles.ts");
const notificationPath = join(
  process.cwd(),
  "src/lib/server/assistant/responsible-external-notifications.ts",
);

function readMigrationSource() {
  return readFileSync(migrationPath, "utf8");
}

function readHelperSource() {
  return readFileSync(helperPath, "utf8");
}

function readNotificationSource() {
  return readFileSync(notificationPath, "utf8");
}

function getFunctionBlock(source: string, startPattern: string, endPattern: string) {
  const start = source.indexOf(startPattern);
  assert.equal(start > -1, true, `Pattern not found: ${startPattern}`);
  const end = source.indexOf(endPattern, start);
  assert.equal(end > start, true, `Pattern not found: ${endPattern}`);
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "canonical reader returns exactly one active primary responsible",
    run: async () => {
      const supabase = createStoreResponsiblesSupabase({
        data: [
          {
            id: "responsible-1",
            name: "  Maria  ",
            role: " owner ",
            whatsapp_number: "(11) 99999-0000",
          },
        ],
      });

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      assert.deepEqual(supabase.filters, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "is_primary", value: true },
        { column: "is_active", value: true },
      ]);
      assert.equal(result.ok, true);
      if (!result.ok) {
        throw new Error("expected canonical responsible");
      }
      assert.equal(result.responsible.id, "responsible-1");
      assert.equal(result.responsible.name, "Maria");
      assert.equal(result.responsible.role, "owner");
      assert.equal(result.responsible.whatsappNumber, "5511999990000");
    },
  },
  {
    name: "canonical reader fails closed when no active primary exists",
    run: async () => {
      const supabase = createStoreResponsiblesSupabase({ data: [] });

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      assert.deepEqual(result, {
        ok: false,
        reason: "responsible_primary_not_configured",
      });
    },
  },
  {
    name: "canonical reader fails closed when multiple active primaries exist",
    run: async () => {
      const supabase = createStoreResponsiblesSupabase({
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
      });

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      assert.deepEqual(result, {
        ok: false,
        reason: "responsible_primary_state_invalid",
      });
    },
  },
  {
    name: "canonical reader rejects invalid whatsapp destination",
    run: async () => {
      const supabase = createStoreResponsiblesSupabase({
        data: [
          {
            id: "responsible-1",
            name: "Maria",
            role: "owner",
            whatsapp_number: "123",
          },
        ],
      });

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      assert.deepEqual(result, {
        ok: false,
        reason: "responsible_primary_invalid_destination",
      });
    },
  },
  {
    name: "whatsapp normalization keeps brazilian destination canonical",
    run: () => {
      assert.equal(normalizeResponsibleWhatsappDestination("11999990000"), "5511999990000");
      assert.equal(
        normalizeResponsibleWhatsappDestination("+55 (11) 99999-0000"),
        "5511999990000",
      );
      assert.equal(normalizeResponsibleWhatsappDestination("123"), null);
    },
  },
  {
    name: "canonical reader observes a responsible phone change without stale cache",
    run: async () => {
      let currentRows: unknown[] = [
        {
          id: "responsible-1",
          name: "Maria",
          role: "owner",
          whatsapp_number: "5511999990000",
        },
      ];
      const supabase = createStoreResponsiblesSupabase({
        data: () => currentRows,
      });

      const before = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(before.ok, true);
      if (!before.ok) throw new Error("expected initial responsible");
      assert.equal(before.responsible.whatsappNumber, "5511999990000");

      currentRows = [
        {
          id: "responsible-1",
          name: "Maria",
          role: "owner",
          whatsapp_number: "5511888880000",
        },
      ];

      const after = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(after.ok, true);
      if (!after.ok) throw new Error("expected updated responsible");
      assert.equal(after.responsible.whatsappNumber, "5511888880000");
      assert.notEqual(after.responsible.whatsappNumber, before.responsible.whatsappNumber);
    },
  },
  {
    name: "canonical reader observes a primary responsible change",
    run: async () => {
      let currentRows: unknown[] = [
        {
          id: "responsible-old",
          name: "Maria",
          role: "owner",
          whatsapp_number: "5511999990000",
        },
      ];
      const supabase = createStoreResponsiblesSupabase({
        data: () => currentRows,
      });

      await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      currentRows = [
        {
          id: "responsible-new",
          name: "Joao",
          role: "owner",
          whatsapp_number: "5511888880000",
        },
      ];

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected new primary responsible");
      assert.equal(result.responsible.id, "responsible-new");
      assert.notEqual(result.responsible.id, "responsible-old");
      assert.notEqual(result.responsible.whatsappNumber, "5511999990000");
    },
  },
  {
    name: "canonical reader rejects a responsible from another tenant or store",
    run: async () => {
      const supabase = createStoreResponsiblesSupabase({
        data: [],
      });

      const result = await loadCanonicalActivePrimaryStoreResponsible({
        supabase: supabase.client as never,
        organizationId: "org-1",
        storeId: "store-1",
      });

      assert.deepEqual(result, {
        ok: false,
        reason: "responsible_primary_not_configured",
      });
      assert.deepEqual(supabase.filters, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "is_primary", value: true },
        { column: "is_active", value: true },
      ]);
    },
  },
  {
    name: "canonical reader keeps replay behavior outside the dynamic identity lookup",
    run: () => {
      const source = readHelperSource();
      assert.equal(source.includes('cache: "no-store"'), true);
      assert.equal(source.includes(".from(\"store_responsibles\")"), true);
      assert.equal(source.includes('.eq("is_primary", true)'), true);
      assert.equal(source.includes('.eq("is_active", true)'), true);
    },
  },
  {
    name: "migration backfills primary only for singleton stores and keeps zero-row stores untouched",
    run: () => {
      const source = readMigrationSource();

      assert.equal(source.includes("having count(*) = 1"), true);
      assert.equal(
        source.includes("update public.store_responsibles set is_primary = true;"),
        false,
      );
      assert.equal(
        source.includes("store_responsibles_one_active_primary_per_store_uidx"),
        true,
      );
      assert.equal(
        source.includes("where is_primary is true and is_active is true"),
        true,
      );
    },
  },
  {
    name: "migration reinforces tenant coherence and fail-closed writer behavior",
    run: () => {
      const source = readMigrationSource();
      const writerBlock = getFunctionBlock(
        source,
        "create or replace function public.upsert_store_primary_responsible_scoped(",
        "alter function public.upsert_store_primary_responsible_scoped(uuid, uuid, text, text) owner to postgres;",
      );

      assert.equal(
        writerBlock.includes("foreign key (store_id, organization_id)"),
        false,
      );
      assert.equal(
        source.includes("foreign key (store_id, organization_id)"),
        true,
      );
      assert.equal(
        writerBlock.includes("where store_row.id = p_store_id"),
        true,
      );
      assert.equal(
        writerBlock.includes("and store_row.organization_id = p_organization_id"),
        true,
      );
      assert.equal(writerBlock.includes("for update;"), true);
      assert.equal(writerBlock.includes("if v_active_primary_count > 1 then"), true);
      assert.equal(writerBlock.includes("if v_store_responsible_count > 1 then"), true);
      assert.equal(writerBlock.includes("if v_active_primary_count = 1 then"), true);
      assert.equal(writerBlock.includes("update public.store_responsibles"), true);
      assert.equal(writerBlock.includes("insert into public.store_responsibles"), true);
      assert.equal(writerBlock.includes("order by"), false);
      assert.equal(writerBlock.includes("limit 1"), false);
    },
  },
  {
    name: "migration adds transactional responsible writer that reuses canonical authority and legacy mirror in one database function",
    run: () => {
      const source = readMigrationSource();
      const wrapperBlock = getFunctionBlock(
        source,
        "create or replace function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(",
        "alter function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) owner to postgres;",
      );

      assert.equal(
        wrapperBlock.includes("security definer"),
        true,
      );
      assert.equal(
        wrapperBlock.includes("set search_path = pg_catalog, public, pg_temp"),
        true,
      );
      assert.equal(
        wrapperBlock.includes("set row_security = off"),
        true,
      );
      assert.equal(
        wrapperBlock.includes("public.upsert_store_primary_responsible_scoped("),
        true,
      );
      assert.equal(
        wrapperBlock.includes("public.onboarding_upsert_answer_scoped("),
        true,
      );
      assert.equal(
        wrapperBlock.includes("p_question_key => 'responsible_name'"),
        true,
      );
      assert.equal(
        wrapperBlock.includes("p_question_key => 'responsible_whatsapp'"),
        true,
      );
      assert.equal(
        source.includes(
          "grant execute on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) to authenticated;",
        ),
        true,
      );
      assert.equal(
        source.includes(
          "grant execute on function public.upsert_store_primary_responsible_with_legacy_mirror_scoped(uuid, uuid, text, text) to service_role;",
        ),
        true,
      );
    },
  },
  {
    name: "notification consumer uses canonical reader and no legacy owner-created-at fallback",
    run: () => {
      const source = readNotificationSource();
      const helperBlock = getFunctionBlock(
        source,
        "export async function loadPrimaryResponsibleForExternalNotifications(",
        "export function shouldEnqueueResponsibleExternalNotification(",
      );

      assert.equal(
        helperBlock.includes("loadCanonicalActivePrimaryStoreResponsible({"),
        true,
      );
      assert.equal(helperBlock.includes('.order("created_at"'), false);
      assert.equal(helperBlock.includes("candidates[0]"), false);
      assert.equal(helperBlock.includes("normalizeText(row.role) === \"owner\""), false);
      assert.equal(
        source.includes("return { created: false as const, skippedReason: responsible.reason };"),
        true,
      );
    },
  },
  {
    name: "helper source reads only active primary scope without latest or fallback selection",
    run: () => {
      const source = readHelperSource();
      const helperStart = source.indexOf(
        "export async function loadCanonicalActivePrimaryStoreResponsible(",
      );
      assert.equal(helperStart > -1, true);
      const helperBlock = source.slice(helperStart);

      assert.equal(helperBlock.includes('.eq("is_primary", true)'), true);
      assert.equal(helperBlock.includes('.eq("is_active", true)'), true);
      assert.equal(helperBlock.includes('.order("created_at"'), false);
      assert.equal(helperBlock.includes("maybeSingle"), false);
      assert.equal(helperBlock.includes("limit(1)"), false);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`store-responsibles: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
