import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type CommercialTask = {
  id: string;
  commercial_opportunity_id: string | null;
  task_type: string;
  status: string | null;
};

type Appointment = {
  id: string;
  commercial_opportunity_id: string | null;
  status: string | null;
};

type LeadDetailsResponse = {
  ok: true;
  selectedOpportunityId: string | null;
  requiresOpportunitySelection: boolean;
  commercialTasks: CommercialTask[];
  appointments: Appointment[];
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function activeTasksForOpportunity(tasks: CommercialTask[], opportunityId: string | null) {
  const openStatuses = new Set([
    "open",
    "waiting_user_choice",
    "waiting_customer_response",
    "ready_to_execute",
    "in_progress",
  ]);

  if (!opportunityId) return [];

  return tasks.filter(
    (task) =>
      task.commercial_opportunity_id === opportunityId &&
      openStatuses.has(String(task.status || "").trim()),
  );
}

function appointmentsForOpportunity(appointments: Appointment[], opportunityId: string | null) {
  if (!opportunityId) return [];

  return appointments.filter(
    (appointment) => appointment.commercial_opportunity_id === opportunityId,
  );
}

function taskIds(tasks: CommercialTask[]) {
  return tasks.map((task) => task.id);
}

function appointmentIds(appointments: Appointment[]) {
  return appointments.map((appointment) => appointment.id);
}

class LeadDetailsHarness {
  readonly leadId = "lead-a";
  readonly pending = new Map<string, Deferred<LeadDetailsResponse>>();
  readonly calls: string[] = [];

  requestedOpportunityId: string | null = "opp-a";
  commercialTasks: CommercialTask[] = [
    {
      id: "TA1",
      commercial_opportunity_id: "opp-a",
      task_type: "commercial_visit_request",
      status: "open",
    },
  ];
  appointments: Appointment[] = [
    {
      id: "AA1",
      commercial_opportunity_id: "opp-a",
      status: "scheduled",
    },
  ];
  leadDetailsScopeRef: string | null = null;

  get leadDetailsScopeKey() {
    return `${this.leadId}::${this.requestedOpportunityId || ""}`;
  }

  applySelectedOpportunity(opportunityId: string) {
    this.commercialTasks = [];
    this.appointments = [];
    this.requestedOpportunityId = opportunityId;
  }

  async fetchLeadConversationAndMessages() {
    const scopedLeadDetailsKey = this.leadDetailsScopeKey;
    this.leadDetailsScopeRef = scopedLeadDetailsKey;
    const opportunityId = this.requestedOpportunityId || "";
    const deferred = createDeferred<LeadDetailsResponse>();

    this.calls.push(opportunityId || "no-opportunity");
    this.pending.set(opportunityId || "no-opportunity", deferred);

    const result = await deferred.promise;

    if (this.leadDetailsScopeRef !== scopedLeadDetailsKey) {
      return;
    }

    this.commercialTasks = Array.isArray(result.commercialTasks)
      ? result.commercialTasks
      : [];
    this.appointments = Array.isArray(result.appointments) ? result.appointments : [];
  }
}

const pagePath = join(process.cwd(), "src/app/(app)/crm/lead/[id]/page.tsx");
const source = readFileSync(pagePath, "utf8");

assert.equal(
  source.includes("leadDetailsScopeRef.current !== scopedLeadDetailsKey"),
  true,
  "lead details fetch must ignore stale responses after opportunity changes",
);
assert.equal(
  source.includes("setCommercialTasks([]);"),
  true,
  "opportunity changes must clear previous commercial task snapshots",
);
assert.equal(
  source.includes("setAppointments([]);"),
  true,
  "opportunity changes must clear previous appointment snapshots",
);

const allTasks: CommercialTask[] = [
  {
    id: "TA1",
    commercial_opportunity_id: "opp-a",
    task_type: "commercial_visit_request",
    status: "open",
  },
  {
    id: "TA2",
    commercial_opportunity_id: "opp-a",
    task_type: "commercial_quote_request",
    status: "resolved",
  },
  {
    id: "TB1",
    commercial_opportunity_id: "opp-b",
    task_type: "commercial_quote_request",
    status: "open",
  },
];
const allAppointments: Appointment[] = [
  { id: "AA1", commercial_opportunity_id: "opp-a", status: "scheduled" },
  { id: "AB1", commercial_opportunity_id: "opp-b", status: "scheduled" },
];

assert.deepEqual(
  activeTasksForOpportunity(allTasks, "opp-a").map((task) => task.id),
  ["TA1"],
  "opportunity A must show only active task TA1",
);
assert.deepEqual(
  activeTasksForOpportunity(allTasks, "opp-b").map((task) => task.id),
  ["TB1"],
  "opportunity B must show only active task TB1",
);
assert.deepEqual(activeTasksForOpportunity(allTasks, null), []);
assert.deepEqual(
  appointmentsForOpportunity(allAppointments, "opp-a").map((appointment) => appointment.id),
  ["AA1"],
  "opportunity A must show only appointment AA1",
);
assert.deepEqual(
  appointmentsForOpportunity(allAppointments, "opp-b").map((appointment) => appointment.id),
  ["AB1"],
  "opportunity B must show only appointment AB1",
);
assert.deepEqual(appointmentsForOpportunity(allAppointments, null), []);

const harness = new LeadDetailsHarness();
const pendingA = harness.fetchLeadConversationAndMessages();

harness.applySelectedOpportunity("opp-b");
assert.deepEqual(harness.commercialTasks, []);
assert.deepEqual(harness.appointments, []);

const pendingB = harness.fetchLeadConversationAndMessages();
assert.deepEqual(harness.calls, ["opp-a", "opp-b"]);

harness.pending.get("opp-b")?.resolve({
  ok: true,
  selectedOpportunityId: "opp-b",
  requiresOpportunitySelection: false,
  commercialTasks: activeTasksForOpportunity(allTasks, "opp-b"),
  appointments: appointmentsForOpportunity(allAppointments, "opp-b"),
});
await pendingB;

assert.deepEqual(
  taskIds(harness.commercialTasks),
  ["TB1"],
);
assert.deepEqual(
  appointmentIds(harness.appointments),
  ["AB1"],
);

harness.pending.get("opp-a")?.resolve({
  ok: true,
  selectedOpportunityId: "opp-a",
  requiresOpportunitySelection: false,
  commercialTasks: activeTasksForOpportunity(allTasks, "opp-a"),
  appointments: appointmentsForOpportunity(allAppointments, "opp-a"),
});
await pendingA;

assert.deepEqual(
  taskIds(harness.commercialTasks),
  ["TB1"],
  "stale tasks from opportunity A must not replace opportunity B",
);
assert.deepEqual(
  appointmentIds(harness.appointments),
  ["AB1"],
  "stale appointments from opportunity A must not replace opportunity B",
);

console.log("ok - lead detail tasks and appointments runtime opportunity isolation contract");
