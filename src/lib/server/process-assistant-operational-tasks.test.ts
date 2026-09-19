import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  recoverStaleProcessingQueueRows,
  routeIncomingCustomerReplyToOperationalTask,
} from "./process-assistant-operational-tasks";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const sourcePath = join(
  process.cwd(),
  "src/lib/server/process-assistant-operational-tasks.ts",
);

function readSource() {
  return readFileSync(sourcePath, "utf8");
}

function getSubscriptionGuardSource(source: string) {
  const start = source.indexOf("async function processLockedQueueRowWithSubscriptionGuard(");
  assert.notEqual(start, -1);

  const end = source.indexOf("async function routeIncomingCustomerReplyToOperationalTask(", start);
  assert.equal(end > start, true);

  return source.slice(start, end);
}

const ids = {
  organizationId: "org-1",
  storeId: "store-1",
  taskId: "task-1",
  conversationId: "conversation-1",
  leadId: "lead-1",
  opportunityId: "opportunity-1",
};

function createAppointmentCreateTask(overrides: Record<string, any> = {}) {
  return {
    id: ids.taskId,
    organization_id: ids.organizationId,
    store_id: ids.storeId,
    thread_id: "thread-1",
    task_type: "appointment_create_with_customer",
    status: "waiting_customer_response",
    title: "Criar visita",
    description: null,
    related_lead_id: ids.leadId,
    related_conversation_id: ids.conversationId,
    related_appointment_id: null,
    commercial_opportunity_id: ids.opportunityId,
    customer_name: "Ana",
    customer_phone: "+5511999999999",
    target_date: null,
    target_time: null,
    target_start_at: "2026-09-21T13:00:00.000Z",
    target_end_at: "2026-09-21T14:00:00.000Z",
    timezone_name: "America/Sao_Paulo",
    task_payload: {
      appointment_type: "technical_visit",
      title: "Visita tecnica",
      operation_key: "operation-key-1",
      ...(overrides.task_payload || {}),
    },
    ...overrides,
  };
}

function createMockSupabase(options: Record<string, any> = {}) {
  const state = {
    task: createAppointmentCreateTask(options.task || {}),
    handoffs: options.handoffs || [],
    queues: [] as any[],
    appointment: options.appointment || null,
    serviceSettings: options.serviceSettings || { offers_installation: true, offers_technical_visit: true },
    availabilityAvailable: options.availabilityAvailable !== false,
    availabilityByStart: options.availabilityByStart || {},
    insertMessageFailures: [...(options.insertMessageFailures || [])],
    notificationFailures: [...(options.notificationFailures || [])],
    contextFailures: [...(options.contextFailures || [])],
    atomicFailures: [...(options.atomicFailures || [])],
    skipAtomicMarker: Boolean(options.skipAtomicMarker),
    calls: {
      rpc: [] as any[],
      writer: 0,
      legacyWriter: 0,
      atomicWriter: 0,
      availability: 0,
      projection: 0,
      insertMessage: 0,
      notification: 0,
      handoffUpdates: 0,
    },
  };

  function matches(row: any, filters: Record<string, any>) {
    return Object.entries(filters).every(([key, value]) => row?.[key] === value);
  }

  class Builder {
    table: string;
    filters: Record<string, any> = {};
    inFilters: Record<string, any[]> = {};
    updatePayload: any = null;
    insertPayload: any = null;
    wantsRows = false;
    limitCount: number | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select() {
      this.wantsRows = true;
      return this;
    }

    eq(key: string, value: any) {
      this.filters[key] = value;
      return this;
    }

    in(key: string, value: any[]) {
      this.inFilters[key] = value;
      return this;
    }

    limit(value: number) {
      this.limitCount = value;
      return this;
    }

    order() {
      return this;
    }

    lte() {
      return this;
    }

    lt() {
      return this;
    }

    update(payload: any) {
      this.updatePayload = payload;
      return this;
    }

    insert(payload: any) {
      this.insertPayload = payload;
      return this;
    }

    maybeSingle() {
      return this.execute().then((result: any) => ({
        data: Array.isArray(result.data) ? result.data[0] || null : result.data,
        error: result.error || null,
      }));
    }

    then(resolve: any, reject: any) {
      return this.execute().then(resolve, reject);
    }

    execute() {
      if (this.insertPayload && this.table === "store_assistant_operational_task_queue") {
        const row = {
          id: `queue-${state.queues.length + 1}`,
          ...this.insertPayload,
        };
        state.queues.push(row);
        return Promise.resolve({ data: [row], error: null });
      }

      if (this.updatePayload) {
        if (this.table === "store_assistant_operational_task_queue") {
          const row = state.queues.find((item) => matches(item, this.filters));
          if (row) Object.assign(row, this.updatePayload);
          return Promise.resolve({ data: this.wantsRows && row ? [row] : null, error: null });
        }

        if (this.table === "store_assistant_operational_tasks") {
          const handoff = state.handoffs.find((item: any) => item.id === this.filters.id);
          if (handoff) {
            state.calls.handoffUpdates += 1;
            Object.assign(handoff, this.updatePayload);
            return Promise.resolve({ data: null, error: null });
          }
          Object.assign(state.task, this.updatePayload);
          return Promise.resolve({ data: null, error: null });
        }

        if (this.table === "store_assistant_context_state") {
          const fail = state.contextFailures.shift();
          return Promise.resolve({
            data: null,
            error: fail ? { message: "context failed" } : null,
          });
        }
      }

      if (this.table === "subscriptions") {
        return Promise.resolve({ data: [{ id: "sub-1", organization_id: ids.organizationId, status: "active" }], error: null });
      }

      if (this.table === "store_assistant_operational_tasks") {
        if (this.filters.task_type === "commercial_visit_request") {
          let rows = state.handoffs.filter((row: any) => matches(row, this.filters));
          for (const [key, values] of Object.entries(this.inFilters)) {
            rows = rows.filter((row: any) => values.includes(row[key]));
          }
          return Promise.resolve({ data: this.limitCount ? rows.slice(0, this.limitCount) : rows, error: null });
        }
        if (this.filters.id) {
          return Promise.resolve({ data: matches(state.task, this.filters) ? state.task : null, error: null });
        }
        if (
          this.filters.organization_id === ids.organizationId &&
          this.filters.store_id === ids.storeId &&
          this.filters.related_conversation_id === ids.conversationId &&
          this.filters.status === "waiting_customer_response"
        ) {
          return Promise.resolve({ data: [state.task], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }

      if (this.table === "store_assistant_operational_task_queue") {
        const rows = state.queues.filter((row) => matches(row, this.filters));
        return Promise.resolve({ data: this.limitCount ? rows.slice(0, this.limitCount) : rows, error: null });
      }

      if (this.table === "store_operation_settings") {
        return Promise.resolve({ data: state.serviceSettings, error: null });
      }

      if (this.table === "commercial_opportunities") {
        return Promise.resolve({
          data: {
            id: ids.opportunityId,
            organization_id: ids.organizationId,
            store_id: ids.storeId,
            origin_lead_id: ids.leadId,
            primary_conversation_id: ids.conversationId,
          },
          error: null,
        });
      }

      if (this.table === "store_appointments") {
        return Promise.resolve({ data: state.appointment, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }
  }

  const supabase = {
    state,
    from(table: string) {
      return new Builder(table);
    },
    async rpc(fn: string, params: Record<string, any>) {
      state.calls.rpc.push({ fn, params });
      if (fn === "check_store_appointment_availability_by_system") {
        state.calls.availability += 1;
        const available = Object.prototype.hasOwnProperty.call(state.availabilityByStart, params.p_start_at)
          ? state.availabilityByStart[params.p_start_at]
          : state.availabilityAvailable;
        return { data: { available, reason_code: available ? null : "global_capacity_exceeded" }, error: null };
      }
      if (fn === "create_store_appointment_with_commercial_context") {
        state.calls.legacyWriter += 1;
        return { data: null, error: { message: "legacy writer should not be called by create worker" } };
      }
      if (fn === "create_assistant_appointment_by_task_atomic") {
        state.calls.writer += 1;
        state.calls.atomicWriter += 1;
        const fail = state.atomicFailures.shift();
        if (fail) {
          return { data: null, error: { message: typeof fail === "string" ? fail : "atomic failed" } };
        }
        state.appointment = {
          id: "appointment-1",
          organization_id: params.p_organization_id,
          store_id: params.p_store_id,
          lead_id: params.p_expected_lead_id,
          conversation_id: params.p_expected_conversation_id,
          commercial_opportunity_id: params.p_expected_commercial_opportunity_id,
          title: state.task.title,
          appointment_type: params.p_expected_appointment_type,
          status: "scheduled",
          scheduled_start: params.p_expected_start_at,
          scheduled_end: params.p_expected_end_at,
          customer_name: state.task.customer_name,
          customer_phone: state.task.customer_phone,
          address_text: null,
          notes: "Criado pela assistente apos confirmacao do cliente.",
        };
        state.task.related_appointment_id = state.appointment.id;
        if (!state.skipAtomicMarker) {
          state.task.task_payload = {
            ...(state.task.task_payload || {}),
            appointment_id: state.appointment.id,
            appointment_write_succeeded: true,
            agenda_updated: true,
            appointment_created_at: "2026-09-21T12:00:00.000Z",
            atomic_appointment_write_completed: true,
          };
        }
        return { data: state.appointment, error: null };
      }
      if (fn === "advance_commercial_opportunity_to_visit_stage_by_system") {
        state.calls.projection += 1;
        return {
          data: {
            commercial_opportunity_id: params.p_commercial_opportunity_id,
            appointment_id: params.p_appointment_id,
            stage: "visita_tecnica",
            lifecycle_cycle: 1,
            lifecycle_event_id: null,
            event_type: null,
            reason_code: null,
            stage_changed: true,
            outcome: "advanced_to_visita_tecnica",
            stage_changed_at: null,
            updated_at: null,
          },
          error: null,
        };
      }
      if (fn === "insert_message") {
        state.calls.insertMessage += 1;
        const fail = state.insertMessageFailures.shift();
        return fail
          ? { data: null, error: { message: "insert failed" } }
          : { data: { id: `customer-confirmation-${state.calls.insertMessage}` }, error: null };
      }
      if (fn === "assistant_enqueue_internal_notification") {
        state.calls.notification += 1;
        const fail = state.notificationFailures.shift();
        return fail
          ? { data: null, error: { message: "notification failed" } }
          : { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };

  return supabase;
}

async function runCustomerReply(supabase: any, message: string, messageId: string) {
  return routeIncomingCustomerReplyToOperationalTask({
    supabase,
    organizationId: ids.organizationId,
    storeId: ids.storeId,
    conversationId: ids.conversationId,
    messageId,
    customerMessage: message,
    workerName: "test-worker",
  });
}

const tests: TestCase[] = [
  {
    name: "worker checks canonical subscription before processing queue item",
    run: () => {
      const source = readSource();
      const guard = getSubscriptionGuardSource(source);

      assert.equal(source.includes('from("subscriptions")'), true);
      assert.equal(source.includes("loadCanonicalOrganizationSubscription("), true);
      assert.equal(source.includes("processLockedQueueRowWithSubscriptionGuard({"), true);
      assert.equal(guard.includes('reason: "organization_subscription_suspended"'), true);
      assert.match(
        guard,
        /const\s+result\s*=\s*await\s+processQueueItem\s*\(\s*\{\s*supabase:\s*args\.supabase,\s*queue:\s*args\.queue,\s*workerId:\s*args\.workerId,\s*\}\s*\)/,
      );
    },
  },
  {
    name: "suspended organizations are failed closed before privileged processing",
    run: () => {
      const source = readSource();
      const guard = getSubscriptionGuardSource(source);

      const subscriptionLoad = guard.indexOf("loadCanonicalOrganizationSubscription(");
      const suspendedCheck = guard.indexOf('if (subscriptionStatus === "suspended")');
      const queueFailureUpdate = guard.indexOf('status: "failed"', suspendedCheck);
      const suspendedReason = guard.indexOf(
        'reason: "organization_subscription_suspended"',
        queueFailureUpdate,
      );
      const safeReturn = guard.indexOf("return {", suspendedReason);
      const processIndex = guard.indexOf("const result = await processQueueItem({");

      assert.notEqual(subscriptionLoad, -1);
      assert.notEqual(suspendedCheck, -1);
      assert.notEqual(queueFailureUpdate, -1);
      assert.notEqual(suspendedReason, -1);
      assert.notEqual(safeReturn, -1);
      assert.notEqual(processIndex, -1);
      assert.equal(subscriptionLoad < suspendedCheck, true);
      assert.equal(suspendedCheck < processIndex, true);
      assert.equal(queueFailureUpdate < processIndex, true);
      assert.equal(suspendedReason < processIndex, true);
      assert.equal(safeReturn < processIndex, true);
    },
  },
  {
    name: "customer reply router fails closed when two waiting tasks match",
    run: async () => {
      const calls: string[] = [];
      const supabase = {
        from(table: string) {
          calls.push(table);
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            limit: () => Promise.resolve({
              data: table === "store_assistant_operational_tasks"
                ? [{ id: "task-1" }, { id: "task-2" }]
                : [],
              error: null,
            }),
          };
          return builder;
        },
      };

      const result = await routeIncomingCustomerReplyToOperationalTask({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        customerMessage: "sim",
      });

      assert.equal(result.handled, true);
      if (!result.handled) throw new Error("router did not handle the ambiguous match");
      assert.equal(result.ok, false);
      assert.equal(result.reason, "multiple_waiting_operational_tasks");
      assert.deepEqual(calls, ["store_assistant_operational_tasks"]);
    },
  },
  {
    name: "failed queue replay reuses the existing message row without insert",
    run: async () => {
      let insertCount = 0;
      const supabase = {
        from(table: string) {
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            limit: () => Promise.resolve({
              data: table === "store_assistant_operational_tasks"
                ? [{ id: "task-1" }]
                : [{ id: "queue-1", status: "failed", task_id: "task-1" }],
              error: null,
            }),
            insert: () => {
              insertCount += 1;
              return builder;
            },
          };
          return builder;
        },
      };

      const result = await routeIncomingCustomerReplyToOperationalTask({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        customerMessage: "sim",
      });

      assert.equal(result.handled, true);
      if (!result.handled) throw new Error("failed queue replay was not handled");
      assert.equal(result.ok, false);
      assert.equal(result.reason, "failed_customer_reply_requires_reconciliation");
      assert.equal(insertCount, 0);
    },
  },
  {
    name: "stale processing queue is failed closed for manual reconciliation",
    run: async () => {
      const updates: Array<Record<string, unknown>> = [];
      const supabase = {
        from(table: string) {
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            lt: () => builder,
            limit: () => builder,
            update: (payload: Record<string, unknown>) => {
              updates.push(payload);
              return builder;
            },
            then: (resolve: (value: unknown) => unknown) => resolve(
              updates.length
                ? { data: null, error: null }
                : {
                    data: [{ id: "queue-stale", locked_at: "2026-09-18T09:00:00.000Z" }],
                    error: null,
                  },
            ),
          };
          return builder;
        },
      };

      const result = await recoverStaleProcessingQueueRows({
        supabase,
        organizationId: "org-1",
        storeId: "store-1",
        now: new Date("2026-09-18T10:00:00.000Z"),
      });

      assert.equal(result[0]?.reason, "stale_processing_manual_reconciliation");
      assert.equal(updates[0]?.status, "failed");
      assert.match(String(updates[0]?.error_text), /Reconcilia/);
      assert.equal(updates[0]?.locked_at, null);
    },
  },
  {
    name: "confirmed create uses atomic writer once before downstream",
    run: async () => {
      const supabase = createMockSupabase({ insertMessageFailures: [true] });

      await runCustomerReply(supabase, "sim", "message-1");
      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.atomicWriter, 1);
      assert.equal(supabase.state.calls.legacyWriter, 0);
      const atomicCall = supabase.state.calls.rpc.find((call: any) => call.fn === "create_assistant_appointment_by_task_atomic");
      assert.equal(atomicCall.params.p_task_id, ids.taskId);
      assert.equal(atomicCall.params.p_organization_id, ids.organizationId);
      assert.equal(atomicCall.params.p_store_id, ids.storeId);
      assert.equal(atomicCall.params.p_expected_operation_key, "operation-key-1");
      assert.equal(atomicCall.params.p_expected_lead_id, ids.leadId);
      assert.equal(atomicCall.params.p_expected_conversation_id, ids.conversationId);
      assert.equal(atomicCall.params.p_expected_commercial_opportunity_id, ids.opportunityId);
      assert.equal(atomicCall.params.p_expected_appointment_type, "technical_visit");
      assert.equal(atomicCall.params.p_expected_start_at, "2026-09-21T13:00:00.000Z");
      assert.equal(atomicCall.params.p_expected_end_at, "2026-09-21T14:00:00.000Z");
      assert.equal(supabase.state.task.task_payload.appointment_write_succeeded, true);
      assert.equal(supabase.state.task.task_payload.atomic_appointment_write_completed, true);
      assert.equal(supabase.state.task.task_payload.customer_confirmation_message_sent, undefined);

      await runCustomerReply(supabase, "sim", "message-2");

      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.insertMessage, 2);
      assert.equal(supabase.state.task.status, "resolved");
      assert.equal(supabase.state.task.task_payload.customer_confirmation_message_sent, true);
    },
  },
  {
    name: "atomic create result without task atomic marker fails closed without legacy writer",
    run: async () => {
      const supabase = createMockSupabase({ skipAtomicMarker: true });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.atomicWriter, 1);
      assert.equal(supabase.state.calls.legacyWriter, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.calls.insertMessage, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "create retry after projection marker skips projection and writer",
    run: async () => {
      const supabase = createMockSupabase({ notificationFailures: [true] });

      await runCustomerReply(supabase, "sim", "message-1");
      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.projection, 1);
      assert.equal(supabase.state.task.task_payload.commercial_projection_completed, true);

      await runCustomerReply(supabase, "sim", "message-2");

      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.projection, 1);
      assert.equal(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "create retry after notification failure does not resend customer confirmation",
    run: async () => {
      const supabase = createMockSupabase({
        task: {
          commercial_opportunity_id: null,
          task_payload: { appointment_type: "installation", operation_key: "operation-key-1", customer_message_sent: true, customer_message_id: "initial-message" },
        },
        notificationFailures: [true],
      });

      await runCustomerReply(supabase, "sim", "message-1");
      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.insertMessage, 1);
      assert.equal(supabase.state.task.task_payload.customer_message_sent, true);
      assert.equal(supabase.state.task.task_payload.customer_confirmation_message_sent, true);

      await runCustomerReply(supabase, "sim", "message-2");

      assert.equal(supabase.state.calls.writer, 1);
      assert.equal(supabase.state.calls.insertMessage, 1);
      assert.equal(supabase.state.task.task_payload.customer_message_id, "initial-message");
      assert.equal(supabase.state.task.task_payload.customer_confirmation_message_id, "customer-confirmation-1");
    },
  },
  {
    name: "create retry after handoff resolution does not resolve handoff again",
    run: async () => {
      const supabase = createMockSupabase({
        handoffs: [{
          id: "handoff-1",
          organization_id: ids.organizationId,
          store_id: ids.storeId,
          task_type: "commercial_visit_request",
          related_lead_id: ids.leadId,
          related_conversation_id: ids.conversationId,
          commercial_opportunity_id: ids.opportunityId,
          status: "open",
          task_payload: {},
        }],
        contextFailures: [true],
      });

      await runCustomerReply(supabase, "sim", "message-1");
      assert.equal(supabase.state.calls.handoffUpdates, 1);
      assert.equal(supabase.state.task.task_payload.commercial_visit_request_resolved, true);

      await runCustomerReply(supabase, "sim", "message-2");

      assert.equal(supabase.state.calls.handoffUpdates, 1);
      assert.equal(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "post-write retry accepts persisted appointment with equivalent instant and different timestamp format",
    run: async () => {
      const appointment = {
        id: "appointment-1",
        organization_id: ids.organizationId,
        store_id: ids.storeId,
        lead_id: ids.leadId,
        conversation_id: ids.conversationId,
        commercial_opportunity_id: ids.opportunityId,
        title: "Visita tecnica",
        appointment_type: "technical_visit",
        status: "scheduled",
        scheduled_start: "2026-09-21 13:00:00+00",
        scheduled_end: "2026-09-21 14:00:00+00",
        customer_name: "Ana",
        customer_phone: "+5511999999999",
        address_text: null,
        notes: null,
      };
      const supabase = createMockSupabase({
        appointment,
        availabilityAvailable: false,
        serviceSettings: { offers_installation: false, offers_technical_visit: false },
        task: {
          related_appointment_id: "appointment-1",
          task_payload: {
            appointment_type: "technical_visit",
            appointment_id: "appointment-1",
            appointment_write_succeeded: true,
            agenda_updated: true,
            atomic_appointment_write_completed: true,
            commercial_projection_completed: true,
          },
        },
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.availability, 0);
      assert.equal(supabase.state.calls.writer, 0);
      assert.equal(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "post-write retry fails closed when persisted appointment instant differs",
    run: async () => {
      const appointment = {
        id: "appointment-1",
        organization_id: ids.organizationId,
        store_id: ids.storeId,
        lead_id: ids.leadId,
        conversation_id: ids.conversationId,
        commercial_opportunity_id: ids.opportunityId,
        title: "Visita tecnica",
        appointment_type: "technical_visit",
        status: "scheduled",
        scheduled_start: "2026-09-21T13:01:00.000Z",
        scheduled_end: "2026-09-21T14:00:00.000Z",
        customer_name: "Ana",
        customer_phone: "+5511999999999",
        address_text: null,
        notes: null,
      };
      const supabase = createMockSupabase({
        appointment,
        task: {
          related_appointment_id: "appointment-1",
          task_payload: {
            appointment_type: "technical_visit",
            appointment_id: "appointment-1",
            appointment_write_succeeded: true,
            agenda_updated: true,
            atomic_appointment_write_completed: true,
            commercial_projection_completed: true,
          },
        },
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.availability, 0);
      assert.equal(supabase.state.calls.writer, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.calls.insertMessage, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "post-write retry fails closed when persisted appointment timestamp is invalid",
    run: async () => {
      const appointment = {
        id: "appointment-1",
        organization_id: ids.organizationId,
        store_id: ids.storeId,
        lead_id: ids.leadId,
        conversation_id: ids.conversationId,
        commercial_opportunity_id: ids.opportunityId,
        title: "Visita tecnica",
        appointment_type: "technical_visit",
        status: "scheduled",
        scheduled_start: "not-a-timestamp",
        scheduled_end: "2026-09-21T14:00:00.000Z",
        customer_name: "Ana",
        customer_phone: "+5511999999999",
        address_text: null,
        notes: null,
      };
      const supabase = createMockSupabase({
        appointment,
        task: {
          related_appointment_id: "appointment-1",
          task_payload: {
            appointment_type: "technical_visit",
            appointment_id: "appointment-1",
            appointment_write_succeeded: true,
            agenda_updated: true,
            atomic_appointment_write_completed: true,
            commercial_projection_completed: true,
          },
        },
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.availability, 0);
      assert.equal(supabase.state.calls.writer, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.calls.insertMessage, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "atomic unavailable failure stops downstream effects",
    run: async () => {
      const supabase = createMockSupabase({
        atomicFailures: ["ZION_ASSISTANT_CREATE_APPOINTMENT_UNAVAILABLE:global_capacity_exceeded"],
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.atomicWriter, 1);
      assert.equal(supabase.state.calls.legacyWriter, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.calls.insertMessage, 0);
      assert.equal(supabase.state.calls.notification, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "atomic identity or operation-key mismatch stops downstream effects",
    run: async () => {
      const supabase = createMockSupabase({
        atomicFailures: ["ZION_ASSISTANT_CREATE_OPERATION_KEY_MISMATCH"],
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.atomicWriter, 1);
      assert.equal(supabase.state.calls.legacyWriter, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.calls.insertMessage, 0);
      assert.equal(supabase.state.calls.notification, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "disabled Settings before write fail closed with zero appointment",
    run: async () => {
      const supabase = createMockSupabase({
        serviceSettings: { offers_installation: false, offers_technical_visit: false },
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.writer, 0);
      assert.notEqual(supabase.state.task.status, "resolved");
    },
  },
  {
    name: "ambiguous and rejected create replies do not call writer",
    run: async () => {
      const ambiguous = createMockSupabase();
      await runCustomerReply(ambiguous, "talvez", "message-1");
      assert.equal(ambiguous.state.calls.writer, 0);
      assert.equal(ambiguous.state.task.task_payload.last_customer_reply_decision_type, "ambiguous");

      const rejected = createMockSupabase();
      await runCustomerReply(rejected, "nao posso nesse horario", "message-1");
      assert.equal(rejected.state.calls.writer, 0);
      assert.equal(rejected.state.task.task_payload.last_customer_reply_decision_type, "rejected");
      assert.equal(rejected.state.task.task_payload.safe_alternative_finder_available, false);
    },
  },
  {
    name: "installation create uses atomic writer and skips projection",
    run: async () => {
      const supabase = createMockSupabase({
        task: {
          commercial_opportunity_id: null,
          task_payload: { appointment_type: "installation", operation_key: "operation-key-1" },
        },
      });

      await runCustomerReply(supabase, "sim", "message-1");

      assert.equal(supabase.state.calls.atomicWriter, 1);
      assert.equal(supabase.state.calls.legacyWriter, 0);
      assert.equal(supabase.state.calls.projection, 0);
      assert.equal(supabase.state.task.status, "resolved");
      assert.equal(supabase.state.task.task_payload.commercial_projection_completed, "not_applicable");
    },
  },
  {
    name: "suggested other time creates only when parsed and available",
    run: async () => {
      const available = createMockSupabase({
        availabilityByStart: {
          "2026-09-21T18:00:00.000Z": true,
        },
      });

      await runCustomerReply(available, "prefiro as 15h", "message-1");

      assert.equal(available.state.calls.writer, 1);
      assert.equal(available.state.appointment.scheduled_start, "2026-09-21T18:00:00.000Z");
      assert.equal(available.state.task.target_start_at, "2026-09-21T18:00:00.000Z");

      const unavailable = createMockSupabase({
        availabilityByStart: {
          "2026-09-21T18:00:00.000Z": false,
        },
      });

      await runCustomerReply(unavailable, "prefiro as 15h", "message-1");

      assert.equal(unavailable.state.calls.writer, 0);
      assert.equal(unavailable.state.task.task_payload.suggested_time_available, false);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`process-assistant-operational-tasks: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
