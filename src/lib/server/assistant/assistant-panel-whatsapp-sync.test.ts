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
          const existing = notifications.find((item) => item.source_event_key === key);
          return { data: existing || null, error: null };
        }

        if (table === "store_assistant_notification_queue") {
          const internal = options.internalNotification;
          const context = filters.context as Row | undefined;
          const matches =
            internal &&
            internal.organization_id === filters.organization_id &&
            internal.store_id === filters.store_id &&
            internal.notification_type === filters.notification_type &&
            (internal.context as Row | undefined)?.event_key === context?.event_key;
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
      then(resolve: (value: unknown) => unknown) {
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
  const { syncAssistantPanelMessageToResponsibleWhatsapp } = await modulePromise;
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

  process.stdout.write("ok - panel WhatsApp sync is scoped, labeled, and idempotent\n");
})().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
