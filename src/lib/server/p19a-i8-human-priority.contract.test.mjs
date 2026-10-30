import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20261029200000_p19a_i8_human_response_supersedes_ai.sql",
  ),
  "utf8",
);

function humanSupersedesAi(args) {
  const sameScope =
    args.human.organizationId === args.anchor.organizationId &&
    args.human.storeId === args.anchor.storeId &&
    args.human.conversationId === args.anchor.conversationId;
  const validHumanOutbound =
    args.human.sender === "human" &&
    args.human.direction === "outgoing" &&
    args.human.deletedAt == null &&
    [
      "crm_manual_text",
      "crm_manual_image",
      "crm_manual_document",
      "sales_contract_send",
      "sales_quote_send",
    ].includes(args.human.outboundOrigin);
  const createdAfterAnchor = args.human.createdAt > args.anchor.createdAt;
  const providerConfirmedAfterAnchor =
    args.human.outboundDeliveryState === "sent" &&
    args.human.externalMessageId != null &&
    args.human.providerAcceptedAt != null &&
    args.human.providerAcceptedAt > args.anchor.createdAt;

  return (
    sameScope &&
    validHumanOutbound &&
    (createdAfterAnchor || providerConfirmedAfterAnchor)
  );
}

const anchor = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  createdAt: "2026-10-29T17:41:00-03:00",
};

function human(overrides = {}) {
  return {
    organizationId: anchor.organizationId,
    storeId: anchor.storeId,
    conversationId: anchor.conversationId,
    sender: "human",
    direction: "outgoing",
    deletedAt: null,
    outboundOrigin: "sales_contract_send",
    createdAt: "2026-10-29T17:33:00-03:00",
    outboundDeliveryState: "sent",
    externalMessageId: "wamid-human-1",
    providerAcceptedAt: "2026-10-29T17:47:00-03:00",
    ...overrides,
  };
}

function extractDdlBlock(tag) {
  const match = migration.match(
    new RegExp(`EXECUTE \\$${tag}\\$(.*?)\\$${tag}\\$`, "s"),
  );
  assert.ok(match?.[1], `Bloco SQL ${tag} nao encontrado`);
  return match[1];
}

test("I8 human response supersedes the AI before materialization", () => {
  const materialize = extractDdlBlock("materialize_ddl");

  assert.match(materialize, /human_row\.organization_id = p_organization_id/);
  assert.match(materialize, /human_row\.store_id = p_store_id/);
  assert.match(materialize, /human_row\.conversation_id = p_conversation_id/);
  assert.match(materialize, /human_row\.sender = 'human'/);
  assert.match(materialize, /human_row\.direction = 'outgoing'/);
  assert.match(materialize, /human_row\.deleted_at is null/);
  assert.match(materialize, /human_row\.created_at > v_anchor\.created_at/);
  assert.match(materialize, /human_row\.outbound_delivery_state = 'sent'/);
  assert.match(materialize, /human_row\.external_message_id is not null/);
  assert.match(materialize, /human_row\.outbound_provider_accepted_at > v_anchor\.created_at/);
  assert.match(materialize, /raise exception using[\s\S]*P19A_I8_RESPONSE_SUPERSEDED_BY_HUMAN/);
});

test("I8 blocks the pending AI after provider-confirmed human contract delivery", () => {
  assert.equal(
    humanSupersedesAi({ anchor, human: human() }),
    true,
  );
});

test("I8 does not treat an older unconfirmed human message as later service", () => {
  assert.equal(
    humanSupersedesAi({
      anchor,
      human: human({
        createdAt: "2026-10-29T17:33:00-03:00",
        outboundDeliveryState: "pending",
        externalMessageId: null,
        providerAcceptedAt: null,
      }),
    }),
    false,
  );
});

test("I8 blocks materialization and sending after an actually later human reply", () => {
  assert.equal(
    humanSupersedesAi({
      anchor,
      human: human({
        createdAt: "2026-10-29T17:46:00-03:00",
        outboundDeliveryState: "pending",
        externalMessageId: null,
        providerAcceptedAt: null,
      }),
    }),
    true,
  );
});

test("I8 ignores human messages from another organization, store, or conversation", () => {
  for (const override of [
    { organizationId: "org-2" },
    { storeId: "store-2" },
    { conversationId: "conversation-2" },
  ]) {
    assert.equal(
      humanSupersedesAi({ anchor, human: human(override) }),
      false,
    );
  }
});

test("I8 human priority also blocks an already pending AI external send", () => {
  const gate = extractDdlBlock("gate_ddl");

  assert.match(gate, /human_row\.organization_id = p_organization_id/);
  assert.match(gate, /human_row\.store_id = p_store_id/);
  assert.match(gate, /human_row\.conversation_id = v_message\.conversation_id/);
  assert.match(gate, /human_row\.sender = 'human'/);
  assert.match(gate, /human_row\.direction = 'outgoing'/);
  assert.match(gate, /human_row\.created_at > v_source_message\.created_at/);
  assert.match(gate, /human_row\.outbound_delivery_state = 'sent'/);
  assert.match(gate, /human_row\.external_message_id is not null/);
  assert.match(gate, /human_row\.outbound_provider_accepted_at[\s\S]*> v_source_message\.created_at/);
  assert.match(gate, /v_block_reason := 'superseded_by_human_response'/);
});

test("I8 installs complete function definitions without textual substitution", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.materialize_sales_ai_reply_set_by_system/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.validate_or_cancel_whatsapp_external_send_by_system/);
  assert.match(migration, /EXECUTE \$materialize_ddl\$/);
  assert.match(migration, /EXECUTE \$gate_ddl\$/);
  assert.doesNotMatch(migration, /regexp_matches/);
  assert.doesNotMatch(migration, /v_after[\s\S]*replace\(/);
  assert.doesNotMatch(migration, /v_find\s*:=/);
  assert.match(migration, /P19A_I8_HUMAN_PRIORITY_PRODUCTION_DRIFT/);
  assert.match(migration, /P19A_I8_HUMAN_PRIORITY_SECURITY_CONTRACT_MISMATCH/);
});

test("I8 correction stays inside the AI response and external-send gates", () => {
  assert.match(migration, /materialize_sales_ai_reply_set_by_system/);
  assert.match(migration, /validate_or_cancel_whatsapp_external_send_by_system/);
  assert.doesNotMatch(migration, /sales_contracts\s+set/i);
  assert.doesNotMatch(migration, /sales_contract_versions\s+set/i);
});
