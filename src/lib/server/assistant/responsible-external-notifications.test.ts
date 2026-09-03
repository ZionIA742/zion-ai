import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & { _resolveFilename: ResolveFilenameHook };
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      join(projectSrcPath, request.slice(2)),
      parent,
      isMain,
      options,
    );
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const modulePromise = import("./responsible-external-notifications");

function createMandatoryNotification() {
  return {
    id: "internal-1",
    organization_id: "org-1",
    store_id: "store-1",
    notification_type: "important_alert",
    priority: "high",
    status: "queued",
    title: "Orcamento aguardando revisao",
    body: "Revise antes do envio.",
    context: {
      needs_human_action: true,
      document_type: "quote",
      reason: "pending_review",
      document_id: "11111111-1111-4111-8111-111111111111",
      document_number: "ORC-001",
      document_status: "pending_review",
      event_key: "quote:pending-review:1",
    },
    related_lead_id: null,
    related_conversation_id: null,
    related_appointment_id: null,
    created_at: "2026-09-03T12:00:00.000Z",
  };
}

function createSupabaseRecorder() {
  const insertCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];
  let onboardingPreferenceWasRead = false;

  return {
    insertCalls,
    get onboardingPreferenceWasRead() {
      return onboardingPreferenceWasRead;
    },
    client: {
      from(table: string) {
        return {
          select() {
            const filters: Array<{ column: string; value: unknown }> = [];
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return builder;
              },
              order() {
                return builder;
              },
              limit() {
                return builder;
              },
              maybeSingle: async () => {
                if (table === "store_onboarding_answers") {
                  onboardingPreferenceWasRead = true;
                  return { data: { answer: false }, error: null };
                }

                if (table === "store_responsible_external_notifications") {
                  return { data: null, error: null };
                }

                return { data: null, error: null };
              },
              then(
                onFulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null,
                onRejected?: ((reason: unknown) => unknown) | null,
              ) {
                if (table === "store_responsibles") {
                  return Promise.resolve({
                    data: [
                      {
                        id: "responsible-1",
                        name: "Maria",
                        role: "owner",
                        whatsapp_number: "11999999999",
                      },
                    ],
                    error: null,
                  }).then(onFulfilled ?? undefined, onRejected ?? undefined);
                }

                return Promise.resolve({ data: [], error: null }).then(
                  onFulfilled ?? undefined,
                  onRejected ?? undefined,
                );
              },
            };

            return builder;
          },
          insert(payload: Record<string, unknown>) {
            insertCalls.push({ table, payload });
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: { id: "external-1" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      },
    },
  };
}

const tests: TestCase[] = [
  {
    name: "mandatory human escalation ignores legacy notify responsible opt-out",
    run: async () => {
      const {
        enqueueResponsibleExternalNotificationFromAssistantNotification,
      } = await modulePromise;
      const supabase = createSupabaseRecorder();

      const result = await enqueueResponsibleExternalNotificationFromAssistantNotification({
        supabase: supabase.client as never,
        internalNotification: createMandatoryNotification(),
      });

      assert.equal(result.created, true);
      assert.equal(supabase.onboardingPreferenceWasRead, false);
      assert.equal(supabase.insertCalls.length, 1);
      assert.equal(
        supabase.insertCalls[0]?.payload.related_document_status,
        "pending_review",
      );
    },
  },
  {
    name: "informational notifications are not universalized as mandatory escalations",
    run: async () => {
      const { shouldEnqueueResponsibleExternalNotification } = await modulePromise;
      const result = shouldEnqueueResponsibleExternalNotification({
        ...createMandatoryNotification(),
        context: {
          needs_human_action: false,
          document_type: "quote",
          reason: "pending_review",
        },
      });

      assert.equal(result.eligible, false);
      assert.equal(result.reason, "needs_human_action_false");
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`ok - ${test.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${test.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
