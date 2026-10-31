import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const helper = readFileSync(
  new URL("../../../../../lib/server/sales-contracts/contract-text-correction-version.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../../../../../supabase/migrations/20261030190000_p9_sent_contract_text_correction_version.sql", import.meta.url),
  "utf8",
);

assert.match(route, /readHistoricalContractText/);
assert.match(route, /currentVersion\.status !== "sent"/);
assert.match(route, /scope\.contract\.current_version_id !== currentVersion\.id/);
assert.match(route, /p9:contract-text-correction/);
assert.match(route, /expectedHistoricalTextSha256/);
assert.match(route, /create_sales_contract_text_correction_version_by_system/);
assert.match(route, /storeContractPdfFile/);
assert.match(route, /replayed === true/);
assert.match(route, /diagnosticCode/);
assert.match(route, /correlationId/);
assert.doesNotMatch(route, /send.*whatsapp|approve.*contract/i);

assert.match(helper, /buildContractTextDraftPdf/);
assert.match(helper, /text_representation: "manual_contract_corrected_text_utf8_exact"/);
assert.match(helper, /text_correction/);
assert.match(helper, /correctedTextSha256/);
assert.match(helper, /pdfSha256/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_sales_contract_text_correction_version_by_system/);
assert.match(migration, /p_expected_sent_version_id uuid/);
assert.match(migration, /v_previous\.status IS DISTINCT FROM 'sent'/);
assert.match(migration, /v_contract\.status IS DISTINCT FROM 'sent_to_customer'/);
assert.match(migration, /UPDATE public\.sales_contracts/);
assert.match(migration, /status = 'pending_review'/);
assert.match(migration, /replayed/);

console.log("P9 contrato manual enviado -> correcao textual historica: contrato de rota PASS");
