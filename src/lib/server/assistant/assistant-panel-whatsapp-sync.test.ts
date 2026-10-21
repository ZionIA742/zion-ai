import { strict as assert } from "node:assert";

type Row = Record<string, unknown>;
type FakeOptions = {
  rpcError?: Row;
  internalNotification?: Row | null;
  rpcResults?: Array<{ data: unknown; error: Row | null }>;
  sharedNotifications?: Row[];
  externalInsertDuplicate?: boolean;
};
type FakeBuilder = {
  select(): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  gte(column: string, value: unknown): FakeBuilder;
  in(column: string, value: unknown): FakeBuilder;
  contains(column: string, value: unknown): FakeBuilder;
  order(): FakeBuilder;
  limit(): FakeBuilder;
  maybeSingle(): Promise<{ data: Row | null; error: null }>;
  insert(payload: Row): FakeBuilder;
  then(resolve: (value: unknown) => unknown): Promise<unknown>;
};

function createFakeSupabase(options: FakeOptions = {}) {
  const calls: Array<{ name: string; args?: Row }> = [];
  const notifications: Row[] = options.sharedNotifications || [];

  function builder(table: string) {
    const filters: Row = {};
    const api = {} as FakeBuilder;
    Object.assign(api, {
      select() {
        return api;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return api;
      },
      gte(column: string, value: unknown) {
        filters[`${column}__gte`] = value;
        return api;
      },
      in(column: string, value: unknown) {
        filters[column] = value;
        return api;
      },
      contains(column: string, value: unknown) {
        filters[column] = value;
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        if (table === "store_assistant_messages") {
          const isAssistant = Array.isArray(filters.sender_role);
          return {
            data: isAssistant
              ? {
                  id: "assistant-message-1",
                  organization_id: "org-1",
                  store_id: "store-1",
                  thread_id: "thread-1",
                  sender_role: "assistant",
                  direction: "outgoing",
                  content: "Resposta pronta.",
                  metadata: { source_external_message_id: "panel:human-message-1" },
                }
              : {
                  id: "human-message-1",
                  organization_id: "org-1",
                  store_id: "store-1",
                  thread_id: "thread-1",
                  sender_role: "store_responsible",
                  direction: "incoming",
                  content: "Preciso de ajuda.",
                  metadata: { origin: "panel", channel: "panel" },
                },
            error: null,
          };
        }

        if (table === "store_responsible_external_notifications") {
          const key = String(filters.source_event_key || "");
          const existing = filters.id
            ? notifications.find((item) => item.id === filters.id)
            : notifications.find((item) => item.source_event_key === key);
          return { data: existing || null, error: null };
        }

        if (table === "store_assistant_notification_queue") {
          const internal = options.internalNotification;
          const minimumCreatedAt = String(filters.created_at__gte || "");
          const createdAt = String(internal?.created_at || "");
          const isAfterActivation = !minimumCreatedAt || createdAt >= minimumCreatedAt;
          const context = filters.context as Row | undefined;
          const matches =
            internal &&
            isAfterActivation &&
            internal.organization_id === filters.organization_id &&
            internal.store_id === filters.store_id &&
            internal.notification_type === filters.notification_type &&
            (!context || (internal.context as Row | undefined)?.event_key === context.event_key) &&
            (!filters.id || internal.id === filters.id) &&
            (!filters.status || internal.status === filters.status);
          return { data: matches ? internal : null, error: null };
        }

        return { data: null, error: null };
      },
      insert(payload: Row) {
        const existing = notifications.find(
          (item) => item.source_event_key === payload.source_event_key,
        );
        if (existing && options.externalInsertDuplicate) {
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: null,
                  error: { code: "23505", message: "duplicate external ledger" },
                }),
              };
            },
          };
        }
        notifications.push({
          ...payload,
          id: `external-${notifications.length + 1}`,
          external_message_id: null,
          error_text: null,
        });
        return {
          select() {
            return {
              maybeSingle: async () => ({
                data: notifications[notifications.length - 1],
                error: null,
              }),
            };
          },
        };
      },
      update(payload: Row) {
        if (table === "store_assistant_notification_queue" && options.internalNotification) {
          Object.assign(options.internalNotification, payload);
        }
        return api;
      },
      then(resolve: (value: unknown) => unknown) {
        if (table === "store_assistant_notification_queue") {
          const minimumCreatedAt = String(filters.created_at__gte || "");
          const createdAt = String(options.internalNotification?.created_at || "");
          const isAfterActivation = !minimumCreatedAt || createdAt >= minimumCreatedAt;
          return Promise.resolve({
            data: options.internalNotification && isAfterActivation ? [options.internalNotification] : [],
            error: null,
          }).then(resolve);
        }
        if (table === "store_responsibles") {
          return Promise.resolve({
            data: [
              {
                id: "responsible-1",
                name: "Responsável",
                role: "owner",
                whatsapp_number: "5511999999999",
              },
            ],
            error: null,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    });
    return api;
  }

  return {
    calls,
    notifications,
    from(table: string) {
      return builder(table);
    },
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      const nextResult = options.rpcResults?.shift();
      if (nextResult) return nextResult;
      return options.rpcError
        ? { data: null, error: options.rpcError }
        : { data: { id: "internal-1" }, error: null };
    },
  };
}

const modulePromise = import("./assistant-panel-whatsapp-sync");

void (async () => {
  const {
    syncAssistantPanelMessageToResponsibleWhatsapp,
    recoverPendingAssistantPanelSyncNotifications,
  } = await modulePromise;
  const supabase = createFakeSupabase();
  const sent: Array<{ notificationId: string; input: string }> = [];

  const first = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
      textPrefix: "Você pelo painel: ",
    },
    {
      supabase: supabase as never,
      send: async (input) => {
        sent.push({ notificationId: input.notificationId, input: "called" });
        const row = supabase.notifications[0];
        row.status = "sent";
        row.external_message_id = "wamid-panel-1";
        return {
          ok: true,
          sent: true,
          notificationId: input.notificationId,
          externalMessageId: "wamid-panel-1",
        };
      },
    },
  );

  assert.equal(first.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(supabase.notifications[0]?.rendered_message, "Você pelo painel: Preciso de ajuda.");
  assert.equal(supabase.notifications[0]?.source_event_key, "assistant-panel-whatsapp:human:human-message-1");

  const replay = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
      textPrefix: "Você pelo painel: ",
    },
    { supabase: supabase as never, send: async () => { throw new Error("duplicate send"); } },
  );

  assert.equal(replay.status, "already_sent");
  assert.equal(sent.length, 1);

  const readyNotification = createFakeSupabase({
    sharedNotifications: [
      {
        id: "external-ready-1",
        organization_id: "org-1",
        store_id: "store-1",
        responsible_id: "responsible-1",
        status: "ready_to_send",
        rendered_message: "Você pelo painel: Preciso de ajuda.",
        source_event_key: "assistant-panel-whatsapp:human:human-message-1",
        external_message_id: null,
        error_text: null,
      },
    ],
  });
  let recoveredReadyCount = 0;
  const recoveredReady = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: readyNotification as never,
      send: async (input) => {
        recoveredReadyCount += 1;
        readyNotification.notifications[0].status = "sent";
        readyNotification.notifications[0].external_message_id = "wamid-recovered-1";
        return {
          ok: true,
          sent: true,
          notificationId: input.notificationId,
          externalMessageId: "wamid-recovered-1",
        };
      },
    },
  );
  assert.equal(recoveredReady.status, "sent");
  assert.equal(recoveredReady.notificationId, "external-ready-1");
  assert.equal(recoveredReadyCount, 1);

  const processingNotification = createFakeSupabase({
    sharedNotifications: [
      {
        id: "external-processing-1",
        status: "processing",
        source_event_key: "assistant-panel-whatsapp:human:human-message-1",
        external_message_id: null,
      },
    ],
  });
  let processingSendCount = 0;
  const processing = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: processingNotification as never,
      send: async () => {
        processingSendCount += 1;
        throw new Error("processing notification must not be retried");
      },
    },
  );
  assert.equal(processing.status, "already_processing");
  assert.equal(processingSendCount, 0);

  const failedNotification = {
    id: "external-failed-1",
    status: "failed",
    attempts: 1,
    source_event_key: "assistant-panel-whatsapp:human:human-message-1",
    external_message_id: null,
    error_text: "temporary failure",
  };
  const failedRecoverySupabase = createFakeSupabase({
    sharedNotifications: [failedNotification],
  });
  let failedPrepareCount = 0;
  let failedRecoverySendCount = 0;
  const failedRecovery = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: failedRecoverySupabase as never,
      prepare: async ({ notificationId }) => {
        failedPrepareCount += 1;
        assert.equal(notificationId, "external-failed-1");
        failedNotification.status = "ready_to_send";
        return {
          ok: true as const,
          updated: true as const,
          notificationId,
          status: "ready_to_send",
        };
      },
      send: async (input) => {
        failedRecoverySendCount += 1;
        failedNotification.status = "sent";
        failedNotification.external_message_id = "wamid-failed-recovery-1";
        return {
          ok: true,
          sent: true,
          notificationId: input.notificationId,
          externalMessageId: "wamid-failed-recovery-1",
        };
      },
    },
  );
  assert.equal(failedRecovery.status, "sent");
  assert.equal(failedPrepareCount, 1);
  assert.equal(failedRecoverySendCount, 1);

  const exhaustedNotification = createFakeSupabase({
    sharedNotifications: [
      {
        ...failedNotification,
        id: "external-failed-exhausted-1",
        status: "failed",
        attempts: 3,
        external_message_id: null,
      },
    ],
  });
  let exhaustedPrepareCount = 0;
  const exhausted = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: exhaustedNotification as never,
      prepare: async () => {
        exhaustedPrepareCount += 1;
        throw new Error("attempt limit must prevent preparation");
      },
      send: async () => {
        throw new Error("attempt limit must prevent send");
      },
    },
  );
  assert.equal(exhausted.status, "already_processing");
  assert.equal(exhausted.reason, "automatic_attempt_limit_reached");
  assert.equal(exhaustedPrepareCount, 0);

  const permanentTemplateNotification = {
    id: "external-failed-template-1",
    status: "failed",
    attempts: 1,
    source_event_key: "assistant-panel-whatsapp:human:human-message-1",
    external_message_id: null,
    error_text: "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED",
  };
  const permanentTemplateSupabase = createFakeSupabase({
    sharedNotifications: [permanentTemplateNotification],
  });
  let permanentPrepareCount = 0;
  let permanentSendCount = 0;
  const permanentTemplate = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: permanentTemplateSupabase as never,
      prepare: async () => {
        permanentPrepareCount += 1;
        throw new Error("permanent template failure must not be prepared");
      },
      send: async () => {
        permanentSendCount += 1;
        throw new Error("permanent template failure must not be sent");
      },
    },
  );
  assert.equal(permanentTemplate.status, "failed");
  assert.equal(permanentTemplate.reason, "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED");
  assert.equal(permanentPrepareCount, 0);
  assert.equal(permanentSendCount, 0);

  const permanentTemplateInternal = {
    id: "internal-template-failed-1",
    organization_id: "org-1",
    store_id: "store-1",
    notification_type: "assistant_panel_sync",
    status: "pending",
    created_at: "2026-10-21T10:02:00.000Z",
    processed_at: null,
    context: {
      source: "assistant_panel_whatsapp_sync",
      event_key: "assistant-panel-whatsapp:human:human-message-1",
      message_kind: "human",
    },
  };
  const permanentTemplateRecoverySupabase = createFakeSupabase({
    internalNotification: permanentTemplateInternal,
    sharedNotifications: [permanentTemplateNotification],
  });
  let permanentRecoverySendCount = 0;
  const permanentTemplateRecovery = await recoverPendingAssistantPanelSyncNotifications({
    organizationId: "org-1",
    storeId: "store-1",
    activationAt: "2026-10-21T10:00:00.000Z",
    supabase: permanentTemplateRecoverySupabase as never,
    send: async () => {
      permanentRecoverySendCount += 1;
      throw new Error("permanent template failure must not be retried");
    },
  });
  assert.equal(permanentTemplateRecovery.scanned, 1);
  assert.equal(permanentTemplateRecovery.failed, 1);
  assert.equal(permanentRecoverySendCount, 0);
  assert.equal(permanentTemplateInternal.status, "failed");
  assert.equal(permanentTemplateInternal.error_text, "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED");
  assert.ok(permanentTemplateInternal.processed_at);

  const assistantSupabase = createFakeSupabase();
  const uncertain = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "assistant",
      textPrefix: "Assistente pelo painel: ",
    },
    {
      supabase: assistantSupabase as never,
      send: async (input) => ({
        ok: false,
        sent: false,
        notificationId: input.notificationId,
        reason: "send_uncertain",
      }),
    },
  );

  assert.equal(uncertain.status, "uncertain");
  assert.equal(assistantSupabase.notifications[0]?.rendered_message, "Assistente pelo painel: Resposta pronta.");

  const concurrentSupabase = createFakeSupabase({
    rpcError: {
      code: "23505",
      message: "duplicate key value violates constraint uq_store_assistant_notification_panel_sync_event",
    },
    internalNotification: {
      id: "internal-race-1",
      organization_id: "org-1",
      store_id: "store-1",
      notification_type: "assistant_panel_sync",
      context: { event_key: "assistant-panel-whatsapp:human:human-message-1" },
    },
  });
  const concurrentSent: string[] = [];
  const concurrent = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: concurrentSupabase as never,
      send: async (input) => {
        concurrentSent.push(input.notificationId);
        concurrentSupabase.notifications[0].status = "sent";
        concurrentSupabase.notifications[0].external_message_id = "wamid-race-1";
        return {
          ok: true,
          sent: true,
          notificationId: input.notificationId,
          externalMessageId: "wamid-race-1",
        };
      },
    },
  );
  assert.equal(concurrent.ok, true);
  assert.equal(concurrent.notificationId, "external-1");
  assert.equal(concurrentSupabase.calls[0]?.name, "assistant_enqueue_internal_notification");
  assert.equal(concurrentSent.length, 1);

  const sharedNotifications: Row[] = [];
  const concurrentAttempts = createFakeSupabase({
    rpcResults: [
      { data: { id: "internal-concurrent-1" }, error: null },
      {
        data: null,
        error: {
          code: "23505",
          message: "duplicate key value violates constraint uq_store_assistant_notification_panel_sync_event",
        },
      },
    ],
    internalNotification: {
      id: "internal-concurrent-1",
      organization_id: "org-1",
      store_id: "store-1",
      notification_type: "assistant_panel_sync",
      context: { event_key: "assistant-panel-whatsapp:human:human-message-1" },
    },
    sharedNotifications,
    externalInsertDuplicate: true,
  });
  const claimedExternalIds = new Set<string>();
  const concurrentResults = await Promise.all(
    [1, 2].map(() =>
      syncAssistantPanelMessageToResponsibleWhatsapp(
        {
          organizationId: "org-1",
          storeId: "store-1",
          messageId: "human-message-1",
          kind: "human",
        },
        {
          supabase: concurrentAttempts as never,
          send: async (input) => {
            if (claimedExternalIds.has(input.notificationId)) {
              return {
                ok: false,
                sent: false,
                notificationId: input.notificationId,
                reason: "already_sent",
              };
            }
            claimedExternalIds.add(input.notificationId);
            const row = sharedNotifications[0];
            row.status = "sent";
            row.external_message_id = "wamid-concurrent-1";
            return {
              ok: true,
              sent: true,
              notificationId: input.notificationId,
              externalMessageId: "wamid-concurrent-1",
            };
          },
        },
      ),
    ),
  );
  assert.equal(sharedNotifications.length, 1);
  assert.equal(claimedExternalIds.size, 1);
  assert.equal(concurrentResults.filter((result) => result.ok).length, 1);

  const missingConcurrent = createFakeSupabase({
    rpcError: {
      code: "23505",
      message: "duplicate key value violates constraint uq_store_assistant_notification_panel_sync_event",
    },
  });
  let missingSendCount = 0;
  const missing = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    {
      supabase: missingConcurrent as never,
      send: async () => {
        missingSendCount += 1;
        throw new Error("send must not run");
      },
    },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "failed");
  assert.match(String(missing.reason), /Ledger interno do painel/);
  assert.equal(missingSendCount, 0);

  const unrelatedConflict = createFakeSupabase({
    rpcError: {
      code: "23505",
      message: "duplicate key value violates constraint unrelated_constraint",
    },
  });
  const unrelated = await syncAssistantPanelMessageToResponsibleWhatsapp(
    {
      organizationId: "org-1",
      storeId: "store-1",
      messageId: "human-message-1",
      kind: "human",
    },
    { supabase: unrelatedConflict as never, send: async () => { throw new Error("send must not run"); } },
  );
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.status, "failed");
  assert.match(String(unrelated.reason), /Falha ao criar ledger interno/);

  const pendingInternal = {
    id: "internal-pending-1",
    organization_id: "org-1",
    store_id: "store-1",
    notification_type: "assistant_panel_sync",
    status: "pending",
    created_at: "2026-10-21T10:01:00.000Z",
    processed_at: null,
    context: {
      source: "assistant_panel_whatsapp_sync",
      event_key: "assistant-panel-whatsapp:human:human-message-1",
      message_kind: "human",
    },
  };
  const recoveredInternal = createFakeSupabase({
    internalNotification: pendingInternal,
  });
  let pendingRecoverySendCount = 0;
  const pendingRecovery = await recoverPendingAssistantPanelSyncNotifications(
    {
      organizationId: "org-1",
      storeId: "store-1",
      limit: 10,
      supabase: recoveredInternal as never,
      activationAt: "2026-10-21T10:00:00.000Z",
      send: async (input) => {
        pendingRecoverySendCount += 1;
        recoveredInternal.notifications[0].status = "sent";
        recoveredInternal.notifications[0].external_message_id = "wamid-pending-recovery-1";
        return {
          ok: true,
          sent: true,
          notificationId: input.notificationId,
          externalMessageId: "wamid-pending-recovery-1",
        };
      },
    },
  );
  assert.equal(pendingRecovery.scanned, 1);
  assert.equal(pendingRecovery.sent, 1);
  assert.equal(pendingRecoverySendCount, 1);
  assert.equal(pendingInternal.status, "sent");
  assert.ok(pendingInternal.processed_at);

  const divergentInternal = {
    ...pendingInternal,
    id: "internal-divergent-1",
    status: "pending",
    processed_at: null,
  };
  const divergentExternal = {
    id: "external-divergent-1",
    source_event_key: "assistant-panel-whatsapp:human:human-message-1",
    status: "failed",
    external_message_id: null,
    error_text: "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED",
  };
  const divergentSupabase = createFakeSupabase({
    internalNotification: divergentInternal,
    sharedNotifications: [divergentExternal],
  });
  const divergentRecovery = await recoverPendingAssistantPanelSyncNotifications({
    organizationId: "org-1",
    storeId: "store-1",
    activationAt: "2026-10-21T10:00:00.000Z",
    supabase: divergentSupabase as never,
    send: async (input) => ({
      ok: true,
      sent: true,
      notificationId: input.notificationId,
      externalMessageId: "wamid-misleading-success",
    }),
  });
  assert.equal(divergentRecovery.sent, 0);
  assert.equal(divergentRecovery.failed, 1);
  assert.equal(divergentInternal.status, "failed");
  assert.ok(divergentInternal.processed_at);

  const historicalInternal = {
    ...pendingInternal,
    id: "internal-historical-1",
    status: "pending",
    created_at: "2026-10-20T23:59:59.000Z",
    processed_at: null,
  };
  const historicalSupabase = createFakeSupabase({
    internalNotification: historicalInternal,
  });
  let historicalSendCount = 0;
  const historicalRecovery = await recoverPendingAssistantPanelSyncNotifications({
    organizationId: "org-1",
    storeId: "store-1",
    activationAt: "2026-10-21T10:00:00.000Z",
    supabase: historicalSupabase as never,
    send: async () => {
      historicalSendCount += 1;
      throw new Error("historical notification must not be sent");
    },
  });
  assert.equal(historicalRecovery.scanned, 0);
  assert.equal(historicalSendCount, 0);

  const unconfiguredSupabase = createFakeSupabase({
    internalNotification: pendingInternal,
  });
  const unconfiguredRecovery = await recoverPendingAssistantPanelSyncNotifications({
    organizationId: "org-1",
    storeId: "store-1",
    supabase: unconfiguredSupabase as never,
    send: async () => {
      throw new Error("activation marker is required");
    },
  });
  assert.equal(unconfiguredRecovery.scanned, 0);

  process.stdout.write("ok - panel WhatsApp sync is scoped, labeled, and idempotent\n");
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
