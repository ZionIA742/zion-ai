import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/lib/server/sales-contracts/contract-auth.ts"),
  "utf8",
);

const start = source.indexOf("export async function authenticateContractRequest()");
const end = source.indexOf("async function loadAuthorizedStore", start);

assert.notEqual(start, -1, "authenticateContractRequest not found");
assert.notEqual(end, -1, "authenticateContractRequest end not found");

const block = source.slice(start, end);

assert.equal(
  block.includes('.from("memberships")'),
  true,
  "contract auth must read memberships",
);

assert.equal(
  block.includes('.eq("user_id", user.id)'),
  true,
  "contract auth must scope membership to authenticated user",
);

assert.equal(
  block.includes('.eq("is_active", true)'),
  true,
  "contract auth must reject inactive memberships",
);

const quoteResolverStart = source.indexOf(
  "export async function resolveAuthorizedQuoteForContract(",
);
const quoteResolverEnd = source.indexOf(
  "export async function resolveAuthorizedExistingContract",
  quoteResolverStart,
);

assert.notEqual(
  quoteResolverStart,
  -1,
  "resolveAuthorizedQuoteForContract not found",
);
assert.notEqual(
  quoteResolverEnd,
  -1,
  "resolveAuthorizedQuoteForContract end not found",
);

const quoteResolverBlock = source.slice(quoteResolverStart, quoteResolverEnd);

assert.equal(
  quoteResolverBlock.includes("quoteVersionId: string"),
  true,
  "quote resolver must receive explicit quoteVersionId",
);

assert.equal(
  quoteResolverBlock.includes("safeQuoteVersionId"),
  true,
  "quote resolver must normalize quoteVersionId into safeQuoteVersionId",
);

assert.equal(
  quoteResolverBlock.includes('.from("sales_quote_versions")'),
  true,
  "quote resolver must query sales_quote_versions",
);

assert.equal(
  quoteResolverBlock.includes('.eq("id", safeQuoteVersionId)'),
  true,
  "quote resolver must select the explicitly requested quote version",
);

assert.equal(
  quoteResolverBlock.includes('.eq("quote_id", quote.id)'),
  true,
  "quote resolver must scope quote version by quote id",
);

assert.equal(
  quoteResolverBlock.includes('.eq("organization_id", quote.organization_id)'),
  true,
  "quote resolver must scope quote version by organization id",
);

assert.equal(
  quoteResolverBlock.includes('.eq("store_id", quote.store_id)'),
  true,
  "quote resolver must scope quote version by store id",
);

assert.equal(
  quoteResolverBlock.includes(
    "const currentVersionId = String(quote.current_version_id",
  ),
  false,
  "quote resolver must not derive version authority from quote.current_version_id",
);

assert.equal(
  quoteResolverBlock.includes('.eq("id", currentVersionId)'),
  false,
  "quote resolver must not query quote version by currentVersionId",
);

assert.equal(
  quoteResolverBlock.includes("userId: auth.user.id"),
  true,
  "quote resolver must keep returning the authenticated user id",
);

console.log("PASS contract-auth active membership regression");
