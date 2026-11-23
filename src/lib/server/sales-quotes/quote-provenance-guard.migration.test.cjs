"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../../..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const sql = read(
  "supabase/migrations/20261123223000_zion_sales_quote_creation_provenance_guard.sql"
);

const createRoute = read(
  "src/app/api/sales-quotes/create/route.ts"
);

const quoteAuth = read(
  "src/lib/server/sales-quotes/quote-auth.ts"
);

const writer = read(
  "supabase/migrations/20260921233000_p9_sales_quote_apply_change_preserve_item_lineage.sql"
);

const applyRoute = read(
  "src/app/api/sales-quotes/[quoteId]/apply-change/route.ts"
);

test("migration possui transacao e preflight", () => {
  assert.match(sql, /^\s*begin;/mi);
  assert.match(sql, /set local lock_timeout/i);
  assert.match(sql, /set local statement_timeout/i);
  assert.match(sql, /to_regclass\('public\.sales_quotes'\)/i);
  assert.match(sql, /ZION_QUOTE_PROVENANCE_METADATA_CONTRACT_INVALID/);
  assert.match(sql, /\bcommit;\s*$/i);
});

test("trigger protege INSERT e UPDATE de sales_quotes", () => {
  assert.match(
    sql,
    /create trigger zion_sales_quote_creation_provenance_guard/i
  );

  assert.match(
    sql,
    /before insert or update\s+on public\.sales_quotes/i
  );

  assert.match(sql, /if tg_op = 'UPDATE' then/i);
  assert.match(sql, /return new;/i);
});

test("UPDATE preserva cada campo de procedencia", () => {
  for (const key of [
    "creation_actor_kind",
    "creation_actor_user_id",
    "created_via",
  ]) {
    const expression = new RegExp(
      "old\\.metadata\\s*->\\s*'" + key +
      "'\\s+is distinct from\\s+new\\.metadata\\s*->\\s*'" +
      key + "'",
      "i"
    );

    assert.match(sql, expression);
  }

  assert.match(
    sql,
    /ZION_QUOTE_CREATION_PROVENANCE_IMMUTABLE/
  );
});

test("INSERT com ator exige papel privilegiado", () => {
  assert.match(sql, /security invoker/i);
  assert.match(sql, /current_user <> 'service_role'/i);
  assert.match(sql, /session_user = 'postgres'/i);
  assert.match(
    sql,
    /ZION_QUOTE_CREATION_PROVENANCE_INSERT_FORBIDDEN/
  );

  assert.doesNotMatch(
    sql,
    /request\.jwt\.claim\.role|auth\.jwt\(\)/i
  );
});

test("procedencia humana exige valores completos", () => {
  assert.match(
    sql,
    /v_metadata\s*->>\s*'creation_actor_kind'\s+is distinct from 'user'/i
  );

  assert.match(
    sql,
    /v_metadata\s*->>\s*'created_via'\s+is distinct from 'api_sales_quotes_create'/i
  );

  assert.match(
    sql,
    /jsonb_typeof\(\s*v_metadata\s*->\s*'creation_actor_user_id'\s*\)\s+is distinct from 'string'/i
  );

  assert.match(
    sql,
    /ZION_QUOTE_CREATION_PROVENANCE_INVALID/
  );
});

test("orçamentos antigos nao recebem origem artificial", () => {
  assert.match(sql, /if v_has_actor_provenance then/i);

  assert.match(
    sql,
    /v_metadata\s*\?\s*'creation_actor_kind'/i
  );

  assert.match(
    sql,
    /v_metadata\s*\?\s*'creation_actor_user_id'/i
  );

  assert.doesNotMatch(
    sql,
    /^\s*(?:update|insert\s+into|delete\s+from)\s+public\.sales_quotes\b/mi
  );

  assert.doesNotMatch(
    sql,
    /\bset\s+metadata\s*=/i
  );
});

test("writer existente permanece coberto pelo trigger", () => {
  assert.match(
    writer,
    /update public\.sales_quotes quote_row/i
  );

  assert.match(
    writer,
    /metadata\s*=\s*coalesce\(p_metadata,\s*'\{\}'::jsonb\)/i
  );

  assert.match(
    applyRoute,
    /p_metadata:\s*args\.updatedQuote\.metadata/i
  );

  assert.match(
    applyRoute,
    /\.update\(quoteUpdatePayload\)/i
  );

  assert.match(
    sql,
    /before insert or update\s+on public\.sales_quotes/i
  );
});

test("rota humana persiste identidade da sessao", () => {
  assert.match(
    createRoute,
    /creation_actor_kind:\s*"user"/
  );

  assert.match(
    createRoute,
    /creation_actor_user_id:\s*scope\.user\.id/
  );

  assert.match(
    createRoute,
    /createSalesQuoteByUser\(\{[\s\S]*?userId:\s*scope\.user\.id/
  );

  assert.match(
    quoteAuth,
    /const supabase = createServiceSupabaseClient\(\)/
  );

  assert.match(
    quoteAuth,
    /auth\.getUser\(\)/
  );
});

test("migration nao modifica CRM, IA ou versoes", () => {
  assert.doesNotMatch(
    sql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\./i
  );

  assert.doesNotMatch(
    sql,
    /\b(?:alter|drop)\s+table\s+public\./i
  );

  assert.doesNotMatch(
    sql,
    /public\.sales_quote_versions|public\.commercial_opportunities/i
  );

  assert.match(
    sql,
    /zion_sales_quote_creation_provenance_guard_trg/
  );
});
