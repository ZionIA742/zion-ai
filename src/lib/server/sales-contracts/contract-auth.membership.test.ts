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

console.log("PASS contract-auth active membership regression");