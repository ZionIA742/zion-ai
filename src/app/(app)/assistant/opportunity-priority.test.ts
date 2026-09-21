import { strict as assert } from "node:assert";
import {
  getAssistantOpportunityPresentation,
  resolveAssistantCommercialOpportunityId,
  type AssistantOpportunityMessage,
  type AssistantOpportunityPriorityRow,
} from "./opportunity-priority";

type TestCase = {
  name: string;
  run: () => void;
};

function createMessage(overrides: Partial<AssistantOpportunityMessage> = {}): AssistantOpportunityMessage {
  return {
    related_lead_id: "lead-a",
    related_conversation_id: "conversation-a",
    metadata: null,
    ...overrides,
  };
}

function createPriorityRow(
  commercialOpportunityId: string,
  priorityBand: string,
): AssistantOpportunityPriorityRow {
  return {
    commercial_opportunity_id: commercialOpportunityId,
    priority_band: priorityBand,
    priority_rank: priorityBand === "urgent" ? 1 : 10,
    reason_codes: ["canonical-reader-output"],
  };
}

const tests: TestCase[] = [
  {
    name: "explicit metadata opportunity uses canonical priority and exact CRM context",
    run: () => {
      const result = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {
            commercial_opportunity_id: "opp-a",
          },
        }),
        priorityByOpportunity: {
          "opp-a": createPriorityRow("opp-a", "high"),
        },
      });

      assert.equal(result.commercialOpportunityId, "opp-a");
      assert.equal(result.priority?.priority_band, "high");
      assert.equal(
        result.crmHref,
        "/crm/lead/lead-a?conversationId=conversation-a&opportunityId=opp-a",
      );
    },
  },
  {
    name: "summary explicit opportunity is used when metadata opportunity is absent",
    run: () => {
      const result = resolveAssistantCommercialOpportunityId({
        customer_context_summary: {
          commercialOpportunityId: "opp-b",
        },
      });

      assert.deepEqual(result, {
        commercialOpportunityId: "opp-b",
        isAmbiguous: false,
        conflictReason: null,
      });
    },
  },
  {
    name: "conflicting explicit opportunity ids are ambiguous and produce no priority or CRM link",
    run: () => {
      const result = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {
            commercial_opportunity_id: "opp-a",
            customer_context_summary: {
              commercialOpportunityId: "opp-b",
            },
          },
        }),
        priorityByOpportunity: {
          "opp-a": createPriorityRow("opp-a", "high"),
          "opp-b": createPriorityRow("opp-b", "urgent"),
        },
      });

      assert.equal(result.commercialOpportunityId, null);
      assert.equal(result.isAmbiguous, true);
      assert.equal(result.priority, null);
      assert.equal(result.crmHref, null);
    },
  },
  {
    name: "lead and conversation without explicit opportunity do not choose latest or first",
    run: () => {
      const result = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {},
        }),
        priorityByOpportunity: {
          "first-opp": createPriorityRow("first-opp", "high"),
          "latest-opp": createPriorityRow("latest-opp", "urgent"),
        },
      });

      assert.equal(result.commercialOpportunityId, null);
      assert.equal(result.priority, null);
      assert.equal(result.crmHref, null);
    },
  },
  {
    name: "same lead and conversation keep independent opportunity priority and links",
    run: () => {
      const priorityByOpportunity = {
        "opp-a": createPriorityRow("opp-a", "high"),
        "opp-b": createPriorityRow("opp-b", "urgent"),
      };
      const resultA = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {
            commercial_opportunity_id: "opp-a",
          },
        }),
        priorityByOpportunity,
      });
      const resultB = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {
            commercial_opportunity_id: "opp-b",
          },
        }),
        priorityByOpportunity,
      });

      assert.equal(resultA.priority?.priority_band, "high");
      assert.equal(resultB.priority?.priority_band, "urgent");
      assert.equal(resultA.crmHref?.endsWith("opportunityId=opp-a"), true);
      assert.equal(resultB.crmHref?.endsWith("opportunityId=opp-b"), true);
    },
  },
  {
    name: "terminal opportunity absent from priority reader keeps CRM link without active priority",
    run: () => {
      const result = getAssistantOpportunityPresentation({
        message: createMessage({
          metadata: {
            commercial_opportunity_id: "opp-terminal",
          },
        }),
        priorityByOpportunity: {},
      });

      assert.equal(result.commercialOpportunityId, "opp-terminal");
      assert.equal(result.priority, null);
      assert.equal(
        result.crmHref,
        "/crm/lead/lead-a?conversationId=conversation-a&opportunityId=opp-terminal",
      );
    },
  },
  {
    name: "priority RPC failure represented by an empty map keeps thread context usable",
    run: () => {
      const result = getAssistantOpportunityPresentation({
        message: createMessage({
          related_lead_id: "lead-store-a",
          related_conversation_id: "conversation-store-a",
          metadata: {
            commercial_opportunity_id: "opp-store-a",
          },
        }),
        priorityByOpportunity: {},
      });

      assert.equal(result.priority, null);
      assert.equal(
        result.crmHref,
        "/crm/lead/lead-store-a?conversationId=conversation-store-a&opportunityId=opp-store-a",
      );
    },
  },
];

function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`TOTAL ${passed}`);
}

main();
