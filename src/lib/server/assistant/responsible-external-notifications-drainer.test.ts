import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  drainResponsibleOperationalApprovalNotifications,
  isResponsibleOperationalApprovalAutoDrainCandidate,
} from "./responsible-external-notifications-drainer";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

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
    created_at: "2026-09-30T18:00:00.000Z",
    ...overrides,
  };
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
