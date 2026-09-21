import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => void;
};

const pagePath = join(process.cwd(), "src/app/(app)/inbox/page.tsx");

function readPageSource() {
  return readFileSync(pagePath, "utf8");
}

function countOccurrences(source: string, needle: string) {
  return source.split(needle).length - 1;
}

function legacyListRpcName() {
  return ["panel", "list", "followup", "candidates", "scoped"].join("_");
}

function legacyEnqueueRpcName() {
  return ["panel", "enqueue", "followup", "scoped"].join("_");
}

function getFollowupCandidateRowBlock(source: string) {
  const start = source.indexOf("type FollowupCandidateRow = {");
  assert.equal(start > -1, true, "FollowupCandidateRow not found");
  const end = source.indexOf("};", start);
  assert.equal(end > start, true, "FollowupCandidateRow end not found");
  return source.slice(start, end);
}

function getLoadFollowupCandidatesBlock(source: string) {
  const start = source.indexOf("  const loadFollowupCandidates = useCallback(async () => {");
  assert.equal(start > -1, true, "loadFollowupCandidates not found");
  const end = source.indexOf("  const loadCommercialHandoffIndicators = useCallback(", start);
  assert.equal(end > start, true, "loadFollowupCandidates end not found");
  return source.slice(start, end);
}

function getTriggerManualFollowupBlock(source: string) {
  const start = source.indexOf("  async function triggerManualFollowup(candidate: FollowupCandidateRow");
  assert.equal(start > -1, true, "triggerManualFollowup not found");
  const end = source.indexOf("  function toggleSection", start);
  assert.equal(end > start, true, "triggerManualFollowup end not found");
  return source.slice(start, end);
}

function getFormatBlockedReasonBlock(source: string) {
  const start = source.indexOf("function formatBlockedReason(value: string | null)");
  assert.equal(start > -1, true, "formatBlockedReason not found");
  const end = source.indexOf("function formatSuggestedAction", start);
  assert.equal(end > start, true, "formatBlockedReason end not found");
  return source.slice(start, end);
}

function getFollowupRowsRenderBlock(source: string) {
  const start = source.indexOf("                visibleFollowupRows.map((row) => {");
  assert.equal(start > -1, true, "follow-up render map not found");
  const end = source.indexOf("        ) : null}", start);
  assert.equal(end > start, true, "follow-up render map end not found");
  return source.slice(start, end);
}

const tests: TestCase[] = [
  {
    name: "follow-up candidate row preserves canonical opportunity identity",
    run: () => {
      const block = getFollowupCandidateRowBlock(readPageSource());

      assert.equal(block.includes("commercial_opportunity_id: string;"), true);
      assert.equal(block.includes("commercial_opportunity_id?: string;"), false);
      assert.equal(block.includes("conversation_status: string | null;"), true);
      assert.equal(block.includes("opportunity_stage: string | null;"), true);
    },
  },
  {
    name: "follow-up reader uses canonical v4 RPC once with pagination and no artificial offer visit loop",
    run: () => {
      const source = readPageSource();
      const block = getLoadFollowupCandidatesBlock(source);

      assert.equal(block.includes('"panel_list_followup_opportunity_candidates_scoped_v4"'), true);
      assert.equal(block.includes('const followupTypes = ["offer", "visit"] as const;'), false);
      assert.equal(block.includes("for (const followupType of followupTypes)"), false);
      assert.equal(block.includes("p_followup_type"), false);
      assert.equal(block.includes("p_min_hours_since_customer: 24"), true);
      assert.equal(block.includes("p_limit: pageSize"), true);
      assert.equal(block.includes("p_offset: offset"), true);
      assert.equal(block.includes("offset += pageSize"), true);
      assert.equal(source.includes(legacyListRpcName()), false);
    },
  },
  {
    name: "follow-up card renders canonical opportunity stage instead of conversation status",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("row.opportunity_stage || \"etapa não informada\""), true);
      assert.equal(source.includes("row.conversation_status || \"status não informado\""), false);
      assert.equal(source.includes("conversation_status: string | null;"), true);
      assert.equal(source.includes("opportunity_stage: string | null;"), true);
    },
  },
  {
    name: "follow-up totals come from v2 totals instead of loaded row count",
    run: () => {
      const source = readPageSource();
      const block = getLoadFollowupCandidatesBlock(source);

      assert.equal(block.includes("setFollowupTotals(totals)"), true);
      assert.equal(block.includes("totals.all = expectedTotal"), true);
      assert.equal(block.includes("totals.ready = Number(firstRow.ready_count || 0)"), true);
      assert.equal(block.includes("totals.waiting = Number(firstRow.waiting_count || 0)"), true);
      assert.equal(block.includes("totals.blocked = Number(firstRow.blocked_count || 0)"), true);
      assert.equal(source.includes('["all", "Todos", followupFilterCounts.all'), true);
      assert.equal(source.includes('["ready", "Prontos agora", followupFilterCounts.ready'), true);
      assert.equal(source.includes('["waiting", "Aguardando", followupFilterCounts.waiting'), true);
      assert.equal(source.includes('["blocked", "Bloqueados", followupFilterCounts.blocked'), true);
      assert.equal(source.includes('["all", "Todos", followupRows.length'), false);
    },
  },
  {
    name: "follow-up buckets use canonical operational_state when available",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("operational_state?: string | null;"), true);
      assert.equal(source.includes('if (operationalState === "ready" || operationalState === "waiting" || operationalState === "blocked")'), true);
      assert.equal(source.includes("return operationalState;"), true);
    },
  },
  {
    name: "message reader paginates instead of treating limit 100 as a total",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes('supabase.rpc("panel_list_inbox"'), true);
      assert.equal(source.includes("const inboxPageSize = 100;"), true);
      assert.equal(source.includes("let inboxOffset = 0;"), true);
      assert.equal(source.includes("p_offset: inboxOffset"), true);
      assert.equal(source.includes("inboxOffset += inboxPageSize;"), true);
      assert.equal(source.includes("pageRows.length < inboxPageSize"), true);
    },
  },
  {
    name: "manual enqueue sends opportunity and conversation to canonical RPC",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());

      assert.equal(block.includes('"panel_enqueue_followup_opportunity_scoped"'), true);
      assert.equal(block.includes("p_store_id: activeStoreId"), true);
      assert.equal(block.includes("p_commercial_opportunity_id: candidate.commercial_opportunity_id"), true);
      assert.equal(block.includes("p_conversation_id: candidate.conversation_id"), true);
      assert.equal(block.includes("p_followup_type: followupType"), true);
      assert.equal(block.includes('selectedFollowupType?: "offer" | "visit"'), true);
      assert.equal(block.includes("const followupType = selectedFollowupType ?? getFollowupWriterType(candidate);"), true);
      assert.equal(block.includes("setFollowupTypeChooserOpportunityId(candidate.commercial_opportunity_id)"), true);
      assert.equal(block.includes(legacyEnqueueRpcName()), false);
    },
  },
  {
    name: "manual enqueue fail-closes before writer without store or canonical ids",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());
      const storeGuardIndex = block.indexOf("if (!activeStoreId)");
      const identityGuardIndex = block.indexOf("if (!candidate.commercial_opportunity_id || !candidate.conversation_id)");
      const writerIndex = block.indexOf('"panel_enqueue_followup_opportunity_scoped"');

      assert.equal(storeGuardIndex > -1, true);
      assert.equal(identityGuardIndex > -1, true);
      assert.equal(storeGuardIndex < writerIndex, true);
      assert.equal(identityGuardIndex < writerIndex, true);
    },
  },
  {
    name: "manual enqueue creates one operation key and future default cadence payload",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());

      assert.equal(block.includes("const cadenceIntervalMinutes = 1440;"), true);
      assert.equal(countOccurrences(block, "const operationKey ="), 1);
      assert.equal(block.includes("`inbox-manual:${crypto.randomUUID()}`"), true);
      assert.equal(countOccurrences(block, "const nextActionAt ="), 1);
      assert.equal(
        block.includes("new Date(Date.now() + cadenceIntervalMinutes * 60 * 1000).toISOString()"),
        true
      );
      assert.equal(block.includes("p_operation_key: operationKey"), true);
      assert.equal(block.includes("p_cadence_interval_minutes: cadenceIntervalMinutes"), true);
      assert.equal(block.includes("p_next_action_at: nextActionAt"), true);
    },
  },
  {
    name: "ok false is handled before success text",
    run: () => {
      const block = getTriggerManualFollowupBlock(readPageSource());
      const okFalseIndex = block.indexOf("if (!result.ok)");
      const successTextIndex = block.lastIndexOf("setFollowupStatusText(");

      assert.equal(okFalseIndex > -1, true);
      assert.equal(successTextIndex > okFalseIndex, true);
    },
  },
  {
    name: "pending and row identity are opportunity based",
    run: () => {
      const source = readPageSource();
      const renderBlock = getFollowupRowsRenderBlock(source);

      assert.equal(source.includes("triggeringConversationId"), false);
      assert.equal(source.includes("setTriggeringConversationId"), false);
      assert.equal(renderBlock.includes("triggeringOpportunityId === row.commercial_opportunity_id"), true);
      assert.equal(
        renderBlock.includes(
          'key={`${row.commercial_opportunity_id}:${row.followup_type || row.suggested_action || "followup"}:${row.followup_id || "candidate"}`}'
        ),
        true
      );
      assert.equal(renderBlock.includes("key={row.conversation_id}"), false);
    },
  },
  {
    name: "follow-up badge is neutral without canonical active type",
    run: () => {
      const source = readPageSource();
      const renderBlock = getFollowupRowsRenderBlock(source);

      assert.equal(source.includes("function getFollowupActionValue(row: FollowupCandidateRow)"), true);
      assert.equal(source.includes('if (followupType === "offer") return "followup_offer";'), true);
      assert.equal(source.includes('if (followupType === "visit") return "followup_visit";'), true);
      assert.equal(source.includes('return value || "Follow-up";'), true);
      assert.equal(renderBlock.includes("const actionValue = getFollowupActionValue(row);"), true);
      assert.equal(renderBlock.includes("formatSuggestedAction(actionValue)"), true);
    },
  },
  {
    name: "follow-up search filters loaded canonical rows by name or phone after bucket filter",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes('const [followupSearchText, setFollowupSearchText] = useState("");'), true);
      assert.equal(source.includes('placeholder="Buscar por nome ou telefone"'), true);
      assert.equal(source.includes("const query = followupSearchText.trim().toLowerCase();"), true);
      assert.equal(source.includes("normalizePhoneSearch(row.lead_phone)"), true);
      assert.equal(source.includes("name.includes(query)"), true);
      assert.equal(source.includes("phoneDigits.includes(queryDigits)"), true);
      assert.equal(source.indexOf("const bucketRows =") > -1, true);
      assert.equal(source.includes("followupSearchActive ?"), true);
    },
  },
  {
    name: "follow-up RPC errors preserve the previous snapshot instead of forcing false zero",
    run: () => {
      const block = getLoadFollowupCandidatesBlock(readPageSource());

      assert.equal(block.includes("setFollowupErrorText(`Erro ao atualizar follow-ups: ${error.message}`);"), true);
      assert.equal(block.includes("setFollowupRows([])"), false);
      assert.equal(block.includes("setFollowupTotals(EMPTY_FOLLOWUP_TOTALS)"), false);
      assert.equal(block.includes("setFollowupHasLoadedSuccessfully(true)"), true);
    },
  },
  {
    name: "follow-up chooser asks for Proposta or Visita before untyped writer call",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("followupTypeChooserOpportunityId"), true);
      assert.equal(source.includes("Qual tipo de follow-up deseja iniciar?"), true);
      assert.equal(source.includes('triggerManualFollowup(row, "offer")'), true);
      assert.equal(source.includes('triggerManualFollowup(row, "visit")'), true);
      assert.equal(source.includes("isChoosingFollowupType && !blocked"), true);
    },
  },
  {
    name: "message open link preserves the exact conversation id",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("buildCrmLeadConversationHref"), true);
      assert.equal(source.includes("const conversationHref ="), true);
      assert.equal(source.includes("conversationId: row.conversation_id"), true);
      assert.equal(source.includes("href={conversationHref}"), true);
    },
  },
  {
    name: "follow-up open link preserves conversation and opportunity ids",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("const followupConversationHref ="), true);
      assert.equal(source.includes("conversationId: row.conversation_id"), true);
      assert.equal(source.includes("opportunityId: row.commercial_opportunity_id"), true);
      assert.equal(source.includes("href={followupConversationHref}"), true);
    },
  },
  {
    name: "outgoing filter is labeled as store response",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("Loja respondeu por último"), true);
      assert.equal(source.includes("ZION respondeu por último"), false);
      assert.equal(source.includes("storeLastMessageCount"), true);
    },
  },
  {
    name: "priority reader replaces local follow-up priority ordering",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("panel_list_commercial_opportunity_priority_scoped"), true);
      assert.equal(source.includes("function followupPriority"), false);
      assert.equal(source.includes("priorityByOpportunity"), true);
      assert.equal(source.includes("sortFollowupRowsByCanonicalPriority(followupRows, priorityByOpportunity)"), true);
    },
  },
  {
    name: "active follow-up blocked reason renders friendly label and keeps action disabled",
    run: () => {
      const source = readPageSource();
      const formatBlock = getFormatBlockedReasonBlock(source);
      const renderBlock = getFollowupRowsRenderBlock(source);
      const activeReasonIndex = formatBlock.indexOf('if (normalized === "followup_ja_ativo") return "Follow-up já ativo";');
      const fallbackIndex = formatBlock.indexOf('return value ? "Bloqueio não classificado" : "-";');

      assert.equal(activeReasonIndex > -1, true);
      assert.equal(fallbackIndex > -1, true);
      assert.equal(activeReasonIndex < fallbackIndex, true);
      assert.equal(renderBlock.includes("const blocked = !!row.blocked_reason;"), true);
      assert.equal(source.includes("disabled={blocked || isTriggering}"), true);
      assert.equal(source.includes("blocked ? formatBlockedReason(row.blocked_reason) : \"Liberado para contato\""), true);
    },
  },
  {
    name: "unknown blocked reason is not rendered as raw backend code",
    run: () => {
      const source = readPageSource();
      const formatBlock = getFormatBlockedReasonBlock(source);

      assert.equal(formatBlock.includes('return value ? "Bloqueio não classificado" : "-";'), true);
    },
  },
  {
    name: "inbox route uses complete directions origin and destination",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes("read_store_general_address_settings_scoped"), true);
      assert.equal(source.includes("buildGoogleMapsDirectionsUrl"), true);
      assert.equal(source.includes("origin: storeRouteOriginAddress"), true);
      assert.equal(source.includes("destination: handoffIndicator?.routeAddressText"), true);
    },
  },
  {
    name: "no bulk follow-up affordance or enqueue loop is present",
    run: () => {
      const source = readPageSource().toLowerCase();

      assert.equal(source.includes("follow-up para todos"), false);
      assert.equal(source.includes("bulk"), false);
      assert.equal(source.includes("select all"), false);
      assert.equal(source.includes("select-all"), false);
      assert.equal(source.includes(".map((row) => triggermanualfollowup"), false);
      assert.equal(source.includes(".foreach((row) => triggermanualfollowup"), false);
    },
  },
  {
    name: "legacy follow-up RPC names are absent from active page source",
    run: () => {
      const source = readPageSource();

      assert.equal(source.includes(legacyListRpcName()), false);
      assert.equal(source.includes(legacyEnqueueRpcName()), false);
    },
  },
];

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} inbox follow-up page tests passed`);
