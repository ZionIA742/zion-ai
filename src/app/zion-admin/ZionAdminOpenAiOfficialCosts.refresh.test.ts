import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/zion-admin/ZionAdminOpenAiOfficialCosts.tsx"),
  "utf8"
);

test("refresh button only reloads the existing official read API", () => {
  assert.match(source, /Atualizar dados/);
  assert.match(source, /onClick=\{\(\) => setRevision\(value => value \+ 1\)\}/);
  assert.match(source, /disabled=\{!hasClosedDay \|\| loading\}/);
  assert.match(source, /\/api\/zion-admin\/costs\/openai-official/);
  assert.match(source, /method:\s*"GET"/);
  assert.doesNotMatch(source, /openai-(manual-run|first-run)/);
});

test("refresh invalidates prior results and restarts the read effect", () => {
  assert.match(source, /result\?\.month === month && result\.revision === revision/);
  assert.match(source, /\[month,\s*from,\s*to,\s*hasClosedDay,\s*revision\]/);
  assert.match(source, /setResult\(\{\s*month,\s*revision,\s*report:\s*payload/);
  assert.match(source, /setResult\(\{\s*month,\s*revision,\s*report:\s*null/);
});