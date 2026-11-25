import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const route = readFileSync(
  join(process.cwd(), "src/app/api/sales-quotes/create/route-handler.ts"),
  "utf8",
);

const boundary = readFileSync(
  join(process.cwd(), "src/lib/server/sales-quotes/quote-creation-boundary.ts"),
  "utf8",
);

function creationMetadata() {
  const match = route.match(
    /const quoteMetadata = \{([\s\S]*?)\n\s{4}\};/,
  );

  assert.ok(match, "Metadata de criacao nao encontrado");
  return match[1];
}

test("origem humana e definida no servidor", () => {
  const metadata = creationMetadata();

  assert.match(
    metadata,
    /creation_actor_kind:\s*"user"/,
  );

  assert.match(
    metadata,
    /creation_actor_user_id:\s*scope\.user\.id/,
  );

  assert.match(
    metadata,
    /created_via:\s*"api_sales_quotes_create"/,
  );
});

test("identidade humana nao deriva de campos enviados pelo cliente", () => {
  const metadata = creationMetadata();

  assert.equal(
    /creation_actor_(kind|user_id):\s*(body|request|safeBody)\b/.test(metadata),
    false,
  );

  assert.match(
    route,
    /createSalesQuoteByUser\(\{[\s\S]*?userId:\s*scope\.user\.id/,
  );
});

test("metadata acompanha o registro enviado ao banco", () => {
  assert.match(
    route,
    /const quoteInsert = \{[\s\S]*?metadata:\s*quoteMetadata/,
  );

  assert.match(
    route,
    /createSalesQuoteByUser\(\{[\s\S]*?quote:\s*quoteInsert/,
  );

  assert.match(
    route,
    /\.insert\(canonicalRequest\.quote\)/,
  );
});

test("idempotencia consulta o existente antes de reservar numero", () => {
  const replayLookup = route.lastIndexOf(
    "const existingQuote = await loadExistingQuoteByCreationIdempotencyKey(",
    route.indexOf("const numberReservation = await reserveQuoteNumber("),
  );

  const reservation = route.indexOf(
    "const numberReservation = await reserveQuoteNumber(",
  );

  assert.ok(replayLookup >= 0);
  assert.ok(reservation > replayLookup);

  assert.match(route, /resolveExistingQuoteReplay\(/);
  assert.match(route, /isUniqueViolation\(quoteError\)/);
});

test("criacao pelo sistema preserva exigencia de oportunidade", () => {
  assert.match(
    boundary,
    /actor\.kind === "system"[\s\S]*?QUOTE_CREATION_OPPORTUNITY_REQUIRED/,
  );

  assert.match(
    boundary,
    /export function createSalesQuoteByUser/,
  );

  assert.match(
    boundary,
    /export function createSalesQuoteBySystem/,
  );
});
