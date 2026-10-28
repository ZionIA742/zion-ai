import { strict as assert } from "node:assert";
import {
  confirmManualContractSendFlow,
  prepareManualContractSendFlow,
} from "./contract-send-orchestration";

const prepared = {
  contractVersionId: "version-current",
  pdfSha256: "a".repeat(64),
};

async function run() {
  const calls: string[] = [];
  const args: string[] = [];
  const contract = { id: "contract-manual" };

  const preparation = await prepareManualContractSendFlow({
    contract: null,
    createOrRecover: async () => {
      calls.push("create");
      return contract;
    },
    prepare: async (created) => {
      calls.push("prepare");
      args.push(created.id);
      return { handled: true, prepared };
    },
  });

  assert.deepEqual(preparation, {
    outcome: "prepared",
    contract,
    prepared,
  });

  const confirmation = await confirmManualContractSendFlow({
    prepared,
    confirmHuman: () => {
      calls.push("confirm");
      return true;
    },
    approve: async (value) => {
      calls.push("approve");
      args.push(value.contractVersionId);
      return true;
    },
    send: async (value) => {
      calls.push("send");
      args.push(value.contractVersionId);
      return true;
    },
  });

  assert.deepEqual(confirmation, { outcome: "sent_requested" });
  assert.deepEqual(calls, ["create", "prepare", "confirm", "approve", "send"]);
  assert.deepEqual(args, ["contract-manual", "version-current", "version-current"]);

  const cancelledCalls: string[] = [];
  const cancelled = await confirmManualContractSendFlow({
    prepared,
    confirmHuman: () => {
      cancelledCalls.push("confirm");
      return false;
    },
    approve: async () => {
      cancelledCalls.push("approve");
      return true;
    },
    send: async () => {
      cancelledCalls.push("send");
      return true;
    },
  });
  assert.deepEqual(cancelled, { outcome: "cancelled" });
  assert.deepEqual(cancelledCalls, ["confirm"]);

  const approvalFailedCalls: string[] = [];
  const approvalFailed = await confirmManualContractSendFlow({
    prepared,
    confirmHuman: () => true,
    approve: async () => {
      approvalFailedCalls.push("approve");
      return false;
    },
    send: async () => {
      approvalFailedCalls.push("send");
      return true;
    },
  });
  assert.deepEqual(approvalFailed, { outcome: "approval_failed" });
  assert.deepEqual(approvalFailedCalls, ["approve"]);

  const uncertainCalls: string[] = [];
  const uncertain = await confirmManualContractSendFlow({
    prepared,
    confirmHuman: () => true,
    approve: async () => {
      uncertainCalls.push("approve");
      return true;
    },
    send: async () => {
      uncertainCalls.push("send");
      return false;
    },
  });
  assert.deepEqual(uncertain, { outcome: "send_failed" });
  assert.deepEqual(uncertainCalls, ["approve", "send"]);

  const replay = await prepareManualContractSendFlow({
    contract,
    createOrRecover: async () => {
      throw new Error("must reuse existing contract");
    },
    prepare: async (existing) => {
      assert.equal(existing, contract);
      return { handled: true, prepared };
    },
  });
  assert.equal(replay.outcome, "prepared");

  const derived = await prepareManualContractSendFlow({
    contract,
    createOrRecover: async () => contract,
    prepare: async () => ({ handled: false, prepared: null }),
  });
  assert.deepEqual(derived, { outcome: "not_handled", contract, prepared: null });
}

run().then(
  () => console.log("P9 manual contract orchestration execution tests PASS"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
