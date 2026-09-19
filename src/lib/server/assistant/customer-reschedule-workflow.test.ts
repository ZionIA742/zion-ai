import { strict as assert } from "node:assert";
import { resolveCustomerRescheduleWorkflow } from "./customer-reschedule-workflow";

const baseArgs = {
  supabase: {},
  organizationId: "org-1",
  storeId: "store-1",
  threadId: "thread-1",
  lastHumanMessage: "consulte a remarcação",
  openAppointments: [],
  recentMessages: [],
  now: new Date("2026-09-18T12:00:00.000Z"),
  deps: {
    sendAiMessageToCustomerConversation: async () => ({ ok: true as const, messageId: "message-1" }),
    createAssistantOperationalTask: async () => ({ ok: true as const, taskId: "task-1" }),
    updateAssistantOperationalTaskAfterCustomerContact: async () => ({ ok: true as const }),
    upsertAssistantContextState: async () => ({ ok: true }),
    resolveScheduleAction: (text: string) => text.startsWith("create:") ? "create" : null,
    sortOpenScheduleAppointments: (items: any[]) => items,
    resolveTargetAppointmentIndex: () => ({ type: "none" as const }),
    buildAppointmentAmbiguityReply: () => "ambiguous",
    formatAppointmentType: () => "visita técnica",
    buildScheduleAppointmentReferenceLabel: () => "visita",
    buildCustomerRescheduleMessage: () => "mensagem",
  },
};

async function main() {
  for (const activeStatus of ["cancelled", "resolved", "failed", "expired"]) {
    const result = await resolveCustomerRescheduleWorkflow({
      ...baseArgs,
      assistantContextState: {
        active_topic: "appointment_reschedule",
        active_intent: "reschedule",
        active_status: activeStatus,
        context_payload: { requested_date: "2026-09-19" },
      } as any,
    });

    assert.equal(result.type, "not_applicable", `terminal status reactivated: ${activeStatus}`);
  }

  const activeResult = await resolveCustomerRescheduleWorkflow({
    ...baseArgs,
    assistantContextState: {
      active_topic: "appointment_reschedule",
      active_intent: "reschedule",
      active_status: "active",
      context_payload: { requested_date: "2026-09-19" },
    } as any,
  });
  assert.equal(activeResult.type, "needs_target");

  const createResult = await resolveCustomerRescheduleWorkflow({
    ...baseArgs,
    lastHumanMessage: "create: agende visita técnica",
    assistantContextState: {
      active_topic: "appointment_reschedule",
      active_intent: "reschedule",
      active_status: "cancelled",
      context_payload: { requested_date: "2026-09-19" },
    } as any,
  });
  assert.equal(createResult.type, "not_applicable");

  const appointment = {
    id: "appointment-1",
    title: "Visita tecnica",
    appointment_type: "technical_visit",
    status: "scheduled",
    scheduled_start: "2026-09-18T12:00:00.000Z",
    scheduled_end: "2026-09-18T13:00:00.000Z",
    customer_name: "Joao",
    customer_phone: null,
    address_text: null,
    notes: null,
    lead_id: "lead-1",
    conversation_id: "conversation-1",
  } as any;

  for (const outboundOk of [true, false]) {
    const events: string[] = [];
    const creates: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const contexts: Array<Record<string, unknown>> = [];
    const deps = {
      ...baseArgs.deps,
      resolveScheduleAction: () => "reschedule",
      sortOpenScheduleAppointments: (items: any[]) => items,
      resolveTargetAppointmentIndex: () => ({ type: "unique" as const, index: 0 }),
      sendAiMessageToCustomerConversation: async () => {
        events.push("outbound");
        return outboundOk
          ? { ok: true as const, messageId: "message-1" }
          : { ok: false as const, error: "outbound failed" };
      },
      createAssistantOperationalTask: async (task: Record<string, unknown>) => {
        creates.push(task);
        return { ok: true as const, taskId: "task-1" };
      },
      updateAssistantOperationalTaskAfterCustomerContact: async (update: Record<string, unknown>) => {
        events.push("finalize");
        updates.push(update);
        return { ok: true as const };
      },
      upsertAssistantContextState: async (context: Record<string, unknown>) => {
        events.push("context");
        contexts.push(context);
        return { ok: true };
      },
    };

    const result = await resolveCustomerRescheduleWorkflow({
      ...baseArgs,
      lastHumanMessage: "remarque para 19/09/2026 as 10:00",
      openAppointments: [appointment],
      assistantContextState: null,
      deps,
    });

    assert.equal(creates.length, 1, `task recreated on outbound ${outboundOk}`);
    assert.equal(updates.length, 1, `task finalized more than once on outbound ${outboundOk}`);
    assert.equal(events.join(","), outboundOk ? "outbound,finalize,context" : "outbound,finalize");
    assert.equal(updates[0]?.taskId, "task-1");
    assert.equal(updates[0]?.status, outboundOk ? "waiting_customer_response" : "open");
    assert.equal((updates[0]?.taskPayload as Record<string, unknown>)?.customer_message_sent, outboundOk);
    assert.equal(
      (updates[0]?.taskPayload as Record<string, unknown>)?.customer_message_error,
      outboundOk ? undefined : "outbound failed",
    );
    assert.equal(result.type, outboundOk ? "message_sent" : "send_failed");
  }

  const contextFailureEvents: string[] = [];
  const contextFailureResult = await resolveCustomerRescheduleWorkflow({
    ...baseArgs,
    lastHumanMessage: "remarque para 19/09/2026 as 10:00",
    openAppointments: [appointment],
    assistantContextState: null,
    deps: {
      ...baseArgs.deps,
      resolveScheduleAction: () => "reschedule",
      sortOpenScheduleAppointments: (items: any[]) => items,
      resolveTargetAppointmentIndex: () => ({ type: "unique" as const, index: 0 }),
      createAssistantOperationalTask: async () => ({ ok: true as const, taskId: "task-1" }),
      sendAiMessageToCustomerConversation: async () => {
        contextFailureEvents.push("outbound");
        return { ok: true as const, messageId: "message-1" };
      },
      updateAssistantOperationalTaskAfterCustomerContact: async () => {
        contextFailureEvents.push("finalize");
        return { ok: true as const };
      },
      upsertAssistantContextState: async () => {
        contextFailureEvents.push("context");
        return { ok: false, error: "context failed" };
      },
    },
  });

  assert.equal(contextFailureResult.type, "send_failed");
  assert.match(String(contextFailureResult.error), /context failed/);
  assert.equal(contextFailureEvents.join(","), "outbound,finalize,context");

  console.log("customer-reschedule-workflow: 9 tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
