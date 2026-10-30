import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/zion-admin/ZionAdminCostsSection.tsx"),
  "utf8"
);

test("viewing costs does not trigger an irreversible monthly close", () => {
  assert.doesNotMatch(source, /action:\s*"close"/);
  assert.doesNotMatch(source, /closeAttempted/);
  assert.doesNotMatch(source, /First visit after month end triggers close/);
});

test("historical close information remains available for display", () => {
  assert.match(source, /closeCandidates/);
  assert.match(source, /historicalClosures/);
  assert.match(source, /Fechamentos e histórico/);
});