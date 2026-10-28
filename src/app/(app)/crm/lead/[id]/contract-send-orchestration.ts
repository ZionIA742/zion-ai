export type ManualPrepareStageResult<TPrepared> = {
  handled: boolean;
  prepared: TPrepared | null;
};

export type ManualPrepareFlowResult<TContract, TPrepared> =
  | { outcome: "blocked"; contract: TContract | null; prepared: null }
  | { outcome: "not_handled"; contract: TContract; prepared: null }
  | { outcome: "prepared"; contract: TContract; prepared: TPrepared };

export async function prepareManualContractSendFlow<TContract, TPrepared>(args: {
  contract: TContract | null;
  createOrRecover: () => Promise<TContract | null>;
  prepare: (contract: TContract) => Promise<ManualPrepareStageResult<TPrepared>>;
}): Promise<ManualPrepareFlowResult<TContract, TPrepared>> {
  const contract = args.contract || (await args.createOrRecover());
  if (!contract) {
    return { outcome: "blocked", contract: null, prepared: null };
  }

  const prepared = await args.prepare(contract);
  if (!prepared.handled) {
    return { outcome: "not_handled", contract, prepared: null };
  }
  if (!prepared.prepared) {
    return { outcome: "blocked", contract, prepared: null };
  }

  return { outcome: "prepared", contract, prepared: prepared.prepared };
}

export type ManualConfirmationFlowResult =
  | { outcome: "cancelled" }
  | { outcome: "approval_failed" }
  | { outcome: "send_failed" }
  | { outcome: "sent_requested" };

export async function confirmManualContractSendFlow<TPrepared>(args: {
  prepared: TPrepared;
  confirmHuman: () => boolean | Promise<boolean>;
  approve: (prepared: TPrepared) => Promise<boolean>;
  send: (prepared: TPrepared) => Promise<boolean>;
}): Promise<ManualConfirmationFlowResult> {
  if (!(await args.confirmHuman())) {
    return { outcome: "cancelled" };
  }

  if (!(await args.approve(args.prepared))) {
    return { outcome: "approval_failed" };
  }

  if (!(await args.send(args.prepared))) {
    return { outcome: "send_failed" };
  }

  return { outcome: "sent_requested" };
}
