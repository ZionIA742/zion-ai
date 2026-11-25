import assert from "node:assert/strict";
import test from "node:test";
import {
  validateExplicitHumanResponseCommitment,
  recordHumanResponseCommitmentBySystem,
} from "./human-response-commitments";

const base = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  conversationSessionId: null,
  sourceMessageId: "00000000-0000-4000-8000-000000000004",
  responsibleUserId: "00000000-0000-4000-8000-000000000005",
  dueAt: "2099-01-01T12:00:00.000Z",
  operationKey: "commitment:test:1",
  sourceKind: "panel" as const,
  explicitConfirmation: true,
};

test("RED/GREEN: compromisso implícito é rejeitado e explícito é validado", () => {
  assert.throws(() => validateExplicitHumanResponseCommitment({ ...base, explicitConfirmation: false as never }), /explicit_confirmation/);
  assert.deepEqual(validateExplicitHumanResponseCommitment(base), base);
});

test("datas de instalação, visita e next_resume_at não entram no contrato", () => {
  assert.equal(Object.hasOwn(base, "nextResumeAt"), false);
  assert.equal(Object.hasOwn(base, "installationAt"), false);
  assert.equal(Object.hasOwn(base, "technicalVisitAt"), false);
});

test("writer usa somente o RPC canônico e exige confirmação explícita", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: "commitment-1", error: null }; } } as never;
  const result = await recordHumanResponseCommitmentBySystem(supabase, base);
  assert.equal(result, "commitment-1");
  assert.equal(calls[0]?.name, "record_human_response_commitment_by_system");
  assert.equal(calls[0]?.args.p_explicit_confirmation, true);
  assert.equal(calls[0]?.args.p_source_message_id, base.sourceMessageId);
});
