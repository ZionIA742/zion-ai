import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  drainResponsibleOperationalApprovalNotifications,
  isAutomaticReportInternalNotification,
  isResponsibleOperationalApprovalAutoDrainCandidate,
  loadResponsibleOperationalApprovalCandidates,
} from "./responsible-external-notifications-drainer";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type InternalNotification = Parameters<typeof isAutomaticReportInternalNotification>[0];
type OutboxCandidate = Parameters<typeof isResponsibleOperationalApprovalAutoDrainCandidate>[0];
type DrainDependencies = Parameters<typeof drainResponsibleOperationalApprovalNotifications>[1];

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "external-1",
    organization_id: "org-1",
    store_id: "store-1",
    channel: "whatsapp_responsible",
    notification_type: "important_alert",
    status: "materialized",
    context: {
      source: "assistant_operational_task_worker",
      reason: "customer_suggested_available_time_requires_approval",
      classification: "suggested_other_time",
      suggested_available: true,
    },
    attempts: 0,
    external_message_id: null,
    sent_at: null,
    error_text: null,
    created_at: "2026-09-30T18:00:00.000Z",
    ...overrides,
  };
}

function reportCandidate(overrides: Record<string, unknown> = {}) {
  return candidate({
    notification_type: "morning_report",
    status: "materialized",
    context: {
      source: "assistant_automatic_reports",
      report_type: "morning_report",
      local_date: "2026-10-22",
      target_iso: "2026-10-22T11:00:00.000Z",
      event_key: "assistant-automatic-report:org-1:store-1:2026-10-22:morning_report",
    },
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

function successfulDeps(rows: any[], calls: string[]) {
  return {
    supabase: {},
    materialize: async () => {
      calls.push("materialize");
      return {
        ok: true as const,
        scanned: rows.length,
        created: rows.length,
        skipped: 0,
        skippedReasons: {},
      };
    },
    loadCandidates: async () => {
      calls.push("load");
      return rows;
    },
    prepare: async (args: any) => {
      calls.push(`prepare:${args.notificationId}`);
      return {
        ok: true as const,
        updated: true as const,
        notificationId: args.notificationId,
        status: "ready_to_send",
      };
    },
    cancel: async (args: any) => {
      calls.push(`cancel:${args.notificationId}`);
      return {
        ok: true as const,
        updated: true as const,
        notificationId: args.notificationId,
        status: "cancelled",
      };
    },
    send: async (args: any) => {
      calls.push(`send:${args.notificationId}`);
      return {
        ok: true as const,
        sent: true as const,
        notificationId: args.notificationId,
        externalMessageId: "wamid.test",
      };
    },
  };
}

type FakeOutboxQuery = {
  select: () => FakeOutboxQuery;
  eq: (field: string, value: string) => FakeOutboxQuery;
  in: (field: string, values: readonly string[]) => FakeOutboxQuery;
  is: () => FakeOutboxQuery;
  order: () => FakeOutboxQuery;
  limit: (limit: number) => Promise<{ data: OutboxCandidate[]; error: null }>;
};

function outboxReader(rows: OutboxCandidate[], queryLog: Array<{ notificationTypes: string[]; limit: number }>) {
  return {
    from: () => {
      const state: { organizationId?: string; storeId?: string; notificationTypes?: string[]; limit?: number } = {};
      const query: FakeOutboxQuery = {
        select: () => query,
        eq: (field: string, value: string) => {
          if (field === "organization_id") state.organizationId = value;
          if (field === "store_id") state.storeId = value;
          if (field === "notification_type") state.notificationTypes = [value];
          return query;
        },
        in: (field: string, values: readonly string[]) => {
          if (field === "notification_type") state.notificationTypes = [...values];
          return query;
        },
        is: () => query,
        order: () => query,
        limit: async (limit: number) => {
          state.limit = limit;
          queryLog.push({ notificationTypes: state.notificationTypes || [], limit });
          return {
            data: rows
              .filter((row) => row.organization_id === state.organizationId && row.store_id === state.storeId)
              .filter((row) => state.notificationTypes?.includes(row.notification_type || ""))
              .filter((row) => row.external_message_id === null && row.sent_at === null)
              .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
              .slice(0, limit),
            error: null,
          };
        },
      };
      return query;
    },
  };
}

const tests: TestCase[] = [
  {
    name: "whatsapp process-all cron drains operational approvals without replacing P9 followups",
    run: () => {
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "src/app/api/cron/whatsapp-process-all/route.ts",
        ),
        "utf8",
      );

      assert.match(
        source,
        /drainResponsibleOperationalApprovalNotifications/,
      );
      assert.match(
        source,
        /WHATSAPP_CRON_RESPONSIBLE_OPERATIONAL_APPROVAL_LIMIT/,
      );
      assert.match(
        source,
        /responsibleOperationalApprovals:\s*responsibleOperationalApprovalResult/,
      );

      const inboxIndex = source.indexOf("processWhatsappInbox({");
      const p9Index = source.indexOf("processPostTechnicalVisitFollowups({");
      const approvalIndex = source.indexOf(
        "drainResponsibleOperationalApprovalNotifications({",
      );
      const pendingIndex = source.indexOf(
        "processWhatsappPendingMessages({",
      );

      assert.ok(inboxIndex >= 0);
      assert.ok(p9Index > inboxIndex);
      assert.ok(approvalIndex > p9Index);
      assert.ok(pendingIndex > approvalIndex);
      assert.match(source, /resumeEligiblePersistedResponsibleWhatsappEvents/);
      assert.match(source, /responsibleAssistantRecovery/);
      assert.doesNotMatch(source, /recoverStaleResponsibleWhatsappEvents/);
    },
  },
  {
    name: "candidate query reserves a bounded report page before scanning important alerts",
    run: () => {
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "src/lib/server/assistant/responsible-external-notifications-drainer.ts",
        ),
        "utf8",
      );

      const loaderStart = source.indexOf(
        "async function loadResponsibleOperationalApprovalCandidates",
      );
      const loaderEnd = source.indexOf(
        "function incrementReason",
        loaderStart,
      );

      assert.ok(loaderStart >= 0);
      assert.ok(loaderEnd > loaderStart);

      const loaderBlock = source.slice(loaderStart, loaderEnd);
      assert.match(loaderBlock, /\.in\("notification_type", AUTOMATIC_REPORT_TYPES\)/);
      assert.match(loaderBlock, /\.eq\("notification_type", "important_alert"\)/);
      assert.match(loaderBlock, /const remainingLimit = Math\.max\(0, args\.limit - reports\.length\)/);
      assert.match(loaderBlock, /\.limit\(remainingLimit\)/);
      assert.match(source, /isResponsibleOperationalApprovalAutoDrainCandidate/);
      assert.match(source, /isAutomaticReportCandidate/);
    },
  },
  {
    name: "twenty old important alerts cannot occupy the report reservation indefinitely",
    run: async () => {
      const report = reportCandidate({
        id: "recent-report",
        created_at: "2026-10-26T10:58:00.000Z",
        context: {
          report_source: "assistant_automatic_reports",
          report_type: "morning_report",
          local_date: "2026-10-26",
          target_iso: "2026-10-26T11:00:00.000Z",
          event_key: "assistant-automatic-report:org-1:store-1:2026-10-26:morning_report",
        },
      });
      const oldAlerts = Array.from({ length: 20 }, (_, index) => candidate({
        id: `old-alert-${index}`,
        created_at: `2026-06-09T00:${String(index).padStart(2, "0")}:00.000Z`,
        context: { source: "historic_important_alert" },
      }));
      const queryLog: Array<{ notificationTypes: string[]; limit: number }> = [];
      const rows = await loadResponsibleOperationalApprovalCandidates({
        supabase: outboxReader([...oldAlerts, report], queryLog),
        organizationId: "org-1",
        storeId: "store-1",
        limit: 20,
      });
      assert.equal(rows.length, 20);
      assert.equal(rows[0].id, "recent-report");
      assert.deepEqual(queryLog, [
        { notificationTypes: ["morning_report", "evening_report"], limit: 20 },
        { notificationTypes: ["important_alert"], limit: 19 },
      ]);

      const calls: string[] = [];
      const result = await drainResponsibleOperationalApprovalNotifications(
        { organizationId: "org-1", storeId: "store-1", now: new Date("2026-10-26T12:00:00.000Z") },
        successfulDeps(rows, calls) as DrainDependencies,
      );
      assert.equal(result.eligible, 1);
      assert.equal(result.prepared, 1);
      assert.equal(result.sent, 1);
      assert.equal(result.skippedReasons.not_operational_approval_allowlist, 19);
      assert.deepEqual(calls.slice(0, 4), ["materialize", "load", "prepare:recent-report", "send:recent-report"]);
    },
  },
  {
    name: "candidate loader keeps organization and store isolation and excludes already delivered rows",
    run: async () => {
      const selected = await loadResponsibleOperationalApprovalCandidates({
        supabase: outboxReader([
          reportCandidate({ id: "same-scope", created_at: "2026-10-26T10:58:00.000Z" }),
          reportCandidate({ id: "other-org", organization_id: "org-2", created_at: "2026-10-26T10:57:00.000Z" }),
          reportCandidate({ id: "other-store", store_id: "store-2", created_at: "2026-10-26T10:56:00.000Z" }),
          reportCandidate({ id: "already-sent", external_message_id: "wamid.sent", created_at: "2026-10-26T10:55:00.000Z" }),
        ], []),
        organizationId: "org-1",
        storeId: "store-1",
        limit: 20,
      });
      assert.deepEqual(selected.map((row) => row.id), ["same-scope"]);
    },
  },
  {
    name: "allowlist requires exact operational approval provenance",
    run: () => {
      assert.equal(
        isResponsibleOperationalApprovalAutoDrainCandidate(candidate() as any),
        true,
      );

      assert.equal(
        isResponsibleOperationalApprovalAutoDrainCandidate(
          candidate({
            context: {
              source: "post_technical_visit_followup",
              reason: "customer_suggested_available_time_requires_approval",
              classification: "suggested_other_time",
              suggested_available: true,
            },
          }) as any,
        ),
        false,
      );
    },
  },
  {
    name: "allowlist accepts only canonical automatic report provenance",
    run: () => {
      assert.equal(
        isResponsibleOperationalApprovalAutoDrainCandidate(reportCandidate() as any),
        true,
      );
      assert.equal(
        isResponsibleOperationalApprovalAutoDrainCandidate(
          reportCandidate({ context: { source: "assistant_automatic_reports", report_type: "evening_report" } }) as any,
        ),
        false,
      );
    },
  },
  {
    name: "canonical report_source accepts pending morning and evening reports",
    run: async () => {
      for (const reportType of ["morning_report", "evening_report"] as const) {
        const context = {
          report_source: "assistant_automatic_reports",
          report_type: reportType,
          local_date: "2026-10-23",
          target_iso: "2026-10-23T11:00:00.000Z",
          event_key: `assistant-automatic-report:org-1:store-1:2026-10-23:${reportType}`,
        };
        assert.equal(
          isAutomaticReportInternalNotification({
            id: "notification-1",
            organization_id: "org-1",
            store_id: "store-1",
            notification_type: reportType,
            priority: "normal",
            status: "pending",
            title: "Relatório",
            body: "Resumo",
            context,
            related_lead_id: null,
            related_conversation_id: null,
            related_appointment_id: null,
            created_at: "2026-10-23T10:58:00.000Z",
          } as InternalNotification),
          true,
        );
        const calls: string[] = [];
        const result = await drainResponsibleOperationalApprovalNotifications(
          { organizationId: "org-1", storeId: "store-1", now: new Date("2026-10-23T11:30:00.000Z") },
          successfulDeps([reportCandidate({ notification_type: reportType, context, created_at: "2026-10-23T10:58:00.000Z" })], calls) as DrainDependencies,
        );
        assert.equal(result.sent, 1);
        assert.deepEqual(calls, ["materialize", "load", "prepare:external-1", "send:external-1"]);
      }
    },
  },
  {
    name: "legacy source remains accepted while unknown source and types remain rejected",
    run: () => {
      assert.equal(isAutomaticReportInternalNotification({
        id: "notification-1",
        organization_id: "org-1",
        store_id: "store-1",
        notification_type: "morning_report",
        priority: "normal",
        status: "pending",
        title: "Relatório",
        body: "Resumo",
        context: reportCandidate().context,
        related_lead_id: null,
        related_conversation_id: null,
        related_appointment_id: null,
        created_at: "2026-10-23T10:58:00.000Z",
      } as InternalNotification), true);
      assert.equal(isResponsibleOperationalApprovalAutoDrainCandidate(reportCandidate({ context: { report_source: "unknown", report_type: "morning_report", local_date: "2026-10-23", target_iso: "2026-10-23T11:00:00.000Z", event_key: "key" } }) as OutboxCandidate), false);
      assert.equal(isResponsibleOperationalApprovalAutoDrainCandidate(reportCandidate({ notification_type: "other_report", context: { report_source: "assistant_automatic_reports", report_type: "other_report", local_date: "2026-10-23", target_iso: "2026-10-23T11:00:00.000Z", event_key: "key" } }) as OutboxCandidate), false);
    },
  },
  {
    name: "materialized approval is prepared before send",
    run: async () => {
      const calls: string[] = [];
      const result =
        await drainResponsibleOperationalApprovalNotifications(
          {
            organizationId: "org-1",
            storeId: "store-1",
          },
          successfulDeps([candidate()], calls) as any,
        );

      assert.deepEqual(calls, [
        "materialize",
        "load",
        "prepare:external-1",
        "send:external-1",
      ]);
      assert.equal(result.prepared, 1);
      assert.equal(result.sent, 1);
    },
  },
  {
    name: "ready_to_send resumes without preparing again",
    run: async () => {
      const calls: string[] = [];
      const result =
        await drainResponsibleOperationalApprovalNotifications(
          {
            organizationId: "org-1",
            storeId: "store-1",
          },
          successfulDeps(
            [candidate({ status: "ready_to_send" })],
            calls,
          ) as any,
        );

      assert.deepEqual(calls, [
        "materialize",
        "load",
        "send:external-1",
      ]);
      assert.equal(result.prepared, 0);
      assert.equal(result.sent, 1);
    },
  },
  {
    name: "failed delivery is retried below automatic attempt limit",
    run: async () => {
      const calls: string[] = [];
      const result =
        await drainResponsibleOperationalApprovalNotifications(
          {
            organizationId: "org-1",
            storeId: "store-1",
          },
          successfulDeps(
            [candidate({ status: "failed", attempts: 2 })],
            calls,
          ) as any,
        );

      assert.deepEqual(calls, [
        "materialize",
        "load",
        "prepare:external-1",
        "send:external-1",
      ]);
      assert.equal(result.sent, 1);
    },
  },
  {
    name: "automatic retry stops after three attempts",
    run: async () => {
      const calls: string[] = [];
      const result =
        await drainResponsibleOperationalApprovalNotifications(
          {
            organizationId: "org-1",
            storeId: "store-1",
          },
          successfulDeps(
            [candidate({ status: "failed", attempts: 3 })],
            calls,
          ) as any,
        );

      assert.deepEqual(calls, [
        "materialize",
        "load",
      ]);
      assert.equal(result.sent, 0);
      assert.equal(result.skipped, 1);
      assert.equal(
        result.skippedReasons.automatic_attempt_limit_reached,
        1,
      );
    },
  },
  {
    name: "uncertain transport is surfaced and not counted as ordinary failure",
    run: async () => {
      const calls: string[] = [];
      const deps = successfulDeps([candidate()], calls);

      deps.send = async (args: any) => {
        calls.push(`send:${args.notificationId}`);
        return {
          ok: false as const,
          sent: false as const,
          reason: "send_uncertain",
          notificationId: args.notificationId,
        };
      };

      const result =
        await drainResponsibleOperationalApprovalNotifications(
          {
            organizationId: "org-1",
            storeId: "store-1",
          },
          deps as any,
        );

      assert.equal(result.uncertain, 1);
      assert.equal(result.failed, 0);
    },
  },
  {
    name: "old automatic reports are cancelled instead of sent after a later window opens",
    run: async () => {
      const calls: string[] = [];
      const deps = successfulDeps([reportCandidate({ created_at: "2026-10-20T10:00:00.000Z" })], calls);
      deps.cancel = async (args: any) => {
        calls.push(`cancel:${args.notificationId}`);
        return { ok: true as const, updated: true as const, notificationId: args.notificationId, status: "cancelled" };
      };
      const result = await drainResponsibleOperationalApprovalNotifications(
        { organizationId: "org-1", storeId: "store-1", now: new Date("2026-10-22T11:00:00.000Z") },
        deps as any,
      );
      assert.deepEqual(calls, ["materialize", "load", "cancel:external-1"]);
      assert.equal(result.sent, 0);
      assert.equal(result.skippedReasons.automatic_report_expired, 1);
    },
  },
  {
    name: "failed automatic reports blocked by deterministic policy failures are not recovered automatically",
    run: async () => {
      const calls: string[] = [];
      const result = await drainResponsibleOperationalApprovalNotifications(
        { organizationId: "org-1", storeId: "store-1", now: new Date("2026-10-26T12:00:00.000Z") },
        successfulDeps([
          reportCandidate({
            status: "failed",
            attempts: 2,
            created_at: "2026-10-26T10:58:00.000Z",
            context: {
              report_source: "assistant_automatic_reports",
              report_type: "morning_report",
              local_date: "2026-10-26",
              target_iso: "2026-10-26T11:00:00.000Z",
              event_key: "assistant-automatic-report:org-1:store-1:2026-10-26:morning_report",
            },
            error_text: "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED",
          }),
        ], calls) as DrainDependencies,
      );
      assert.deepEqual(calls, ["materialize", "load"]);
      assert.equal(result.sent, 0);
      assert.equal(result.prepared, 0);
      assert.equal(result.skippedReasons.automatic_report_policy_failure_not_retried, 1);
    },
  },
  {
    name: "stale processing is recovered through the canonical unlock path",
    run: () => {
      const source = fs.readFileSync(
        path.join(
          process.cwd(),
          "src/lib/server/assistant/responsible-external-notifications-drainer.ts",
        ),
        "utf8",
      );
      assert.match(source, /unlockStuckResponsibleExternalNotificationProcessing/);
      assert.match(source, /status.*processing/);
      assert.match(source, /recovery\.status === "uncertain"/);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
    console.log(`ok - ${test.name}`);
  }

  console.log(
    `responsible operational approval drainer: ${passed}/${tests.length} tests passed`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
