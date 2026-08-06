import { strict as assert } from "node:assert";
import { join } from "node:path";
import Module from "node:module";
import {
  buildCrmLeadConversationHref,
  resolveLeadConversationOpportunityContext,
  type LeadConversationContextRow,
  type LeadOpportunityContextRow,
} from "./lead-conversation-opportunity-context";

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    const nextRequest = join(projectSrcPath, request.slice(2));
    return originalResolveFilename.call(this, nextRequest, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

type TestCase = {
  name: string;
  run: () => void;
};

function createConversation(
  overrides: Partial<LeadConversationContextRow> = {},
): LeadConversationContextRow {
  return {
    id: "conversation-1",
    organizationId: "org-1",
    leadId: "lead-1",
    createdAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

function createOpportunity(
  overrides: Partial<LeadOpportunityContextRow> = {},
): LeadOpportunityContextRow {
  return {
    id: "opportunity-1",
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conversation-1",
    stage: "orcamento",
    stageChangedAt: "2026-08-06T12:00:00.000Z",
    createdAt: "2026-08-06T11:00:00.000Z",
    updatedAt: "2026-08-06T12:30:00.000Z",
    ...overrides,
  };
}

const tests: TestCase[] = [
  {
    name: "board href opens the existing lead screen with conversation and opportunity context",
    run: () => {
      assert.equal(
        buildCrmLeadConversationHref({
          leadId: "lead-1",
          conversationId: "conversation-1",
          opportunityId: "opportunity-1",
        }),
        "/crm/lead/lead-1?conversationId=conversation-1&opportunityId=opportunity-1",
      );
    },
  },
  {
    name: "requested opportunity stays selected even when another completed opportunity shares the same conversation",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        requestedConversationId: "conversation-1",
        requestedOpportunityId: "opportunity-active",
        conversations: [createConversation({ id: "conversation-1" })],
        opportunities: [
          createOpportunity({
            id: "opportunity-completed",
            stage: "concluido_sem_mais_acoes",
          }),
          createOpportunity({
            id: "opportunity-active",
            stage: "negociacao",
          }),
        ],
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.conversation?.id, "conversation-1");
      assert.equal(result.selectedOpportunity?.id, "opportunity-active");
      assert.equal(result.requiresOpportunitySelection, false);
    },
  },
  {
    name: "same conversation can serve two opportunities without hiding the conversation history",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        requestedConversationId: "conversation-1",
        conversations: [createConversation({ id: "conversation-1" })],
        opportunities: [
          createOpportunity({ id: "opportunity-1", conversationId: "conversation-1" }),
          createOpportunity({
            id: "opportunity-2",
            conversationId: "conversation-1",
            stage: "negociacao",
          }),
        ],
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.conversation?.id, "conversation-1");
      assert.equal(result.opportunities.length, 2);
      assert.equal(result.selectedOpportunity, null);
      assert.equal(result.requiresOpportunitySelection, true);
    },
  },
  {
    name: "without opportunity id the inbox flow auto-selects the single active opportunity only",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        conversations: [createConversation({ id: "conversation-1" })],
        opportunities: [
          createOpportunity({
            id: "opportunity-completed",
            stage: "concluido_sem_mais_acoes",
          }),
          createOpportunity({
            id: "opportunity-active",
            stage: "negociacao",
          }),
        ],
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.conversation?.id, "conversation-1");
      assert.equal(result.selectedOpportunity?.id, "opportunity-active");
      assert.equal(result.requiresOpportunitySelection, false);
    },
  },
  {
    name: "board flow without conversation id stays in safe state and does not approximate a conversation",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        requestedOpportunityId: "opportunity-1",
        conversations: [createConversation({ id: "conversation-latest" })],
        opportunities: [createOpportunity({ id: "opportunity-1" })],
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.conversation, null);
      assert.equal(result.selectedOpportunity?.id, "opportunity-1");
      assert.equal(result.requiresOpportunitySelection, false);
    },
  },
  {
    name: "foreign conversation is rejected instead of being accepted by approximation",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        requestedConversationId: "conversation-foreign",
        conversations: [createConversation({ id: "conversation-1" })],
        opportunities: [createOpportunity()],
      });

      assert.deepEqual(result, {
        ok: false,
        error: "conversation_scope_rejected",
      });
    },
  },
  {
    name: "foreign opportunity from another lead store or organization is rejected",
    run: () => {
      const result = resolveLeadConversationOpportunityContext({
        organizationId: "org-1",
        storeId: "store-1",
        leadId: "lead-1",
        requestedOpportunityId: "opportunity-foreign",
        conversations: [createConversation()],
        opportunities: [
          createOpportunity({
            id: "opportunity-foreign",
            organizationId: "org-2",
          }),
        ],
      });

      assert.deepEqual(result, {
        ok: false,
        error: "opportunity_scope_rejected",
      });
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
