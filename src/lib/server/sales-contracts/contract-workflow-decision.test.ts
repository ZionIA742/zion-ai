import { strict as assert } from "node:assert";
import { evaluateContractWorkflowDecision } from "./contract-workflow-decision";

const baseQuote = {
  id: "quote-1",
  status: "sent",
  lead_id: "lead-1",
  conversation_id: "conversation-1",
  store_id: "store-1",
  organization_id: "org-1",
  current_version_id: "version-1",
};

const human = evaluateContractWorkflowDecision({
  quote: baseQuote,
  trigger: "human_explicit_request",
  hasHumanConfirmation: true,
  storeSettings: { requiresTechnicalVisitBeforeContract: true },
  appointments: [],
});

assert.equal(human.allowed, true);
assert.equal(human.reasonCode, "HUMAN_EXPLICIT_REQUEST_ALLOWED");

const nonHuman = evaluateContractWorkflowDecision({
  quote: baseQuote,
  trigger: "customer_requested_contract",
  storeSettings: { requiresTechnicalVisitBeforeContract: true },
  appointments: [],
});

assert.equal(nonHuman.allowed, false);
assert.equal(nonHuman.reasonCode, "TECHNICAL_VISIT_REQUIRED_BEFORE_CONTRACT");

process.stdout.write("ok - contract workflow authority preserves human freedom and non-human gates\n");
