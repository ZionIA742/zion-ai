import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(__dirname, "route.ts"), "utf8");
const events = readFileSync(
  join(process.cwd(), "src/lib/server/sales-quotes/quote-events.ts"),
  "utf8",
);
const messages = readFileSync(
  join(process.cwd(), "src/lib/server/assistant/document-review-messages.ts"),
  "utf8",
);

assert.match(route, /inserted\.deduped/);
assert.match(route, /O evento de geracao foi deduplicado/);
assert.match(route, /lookup\.original_filename/);
assert.match(route, /await reconcileQuoteGenerationSideEffects\(/);
assert.match(events, /error\.code === "23505"/);
assert.match(events, /conversation_events_quote_pdf_generation_uidx/);
assert.match(messages, /error\.code === "23505"/);
assert.match(messages, /store_assistant_messages_quote_pdf_document_review_uidx/);
assert.match(messages, /findExistingDocumentReviewMessage\(/);
assert.match(messages, /deduped: true/);

console.log("PDF side-effect reconciliation idempotency contracts passed");
