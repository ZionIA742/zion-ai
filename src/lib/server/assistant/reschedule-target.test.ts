import { strict as assert } from "node:assert";
import { getRescheduleTargetTextSegment, parseRescheduleTargetFromText } from "./reschedule-target";

type TestCase = {
  name: string;
  run: () => void;
};

const now = new Date("2026-08-14T12:00:00-03:00");

const tests: TestCase[] = [
  {
    name: "target segment keeps the requested new window instead of the current appointment window",
    run: () => {
      const text =
        'Remarque o compromisso "Teste E2E visita tecnica 3", do cliente Nome 1, agendado para 14/08/2026 das 13:00 as 14:00, para 14/08/2026 das 15:00 as 16:00.';

      assert.equal(
        getRescheduleTargetTextSegment(text),
        "14/08/2026 das 15:00 as 16:00.",
      );
    },
  },
  {
    name: "parser resolves the requested reschedule payload from the target segment",
    run: () => {
      const parsed = parseRescheduleTargetFromText({
        text:
          'Remarque o compromisso "Teste E2E visita tecnica 3", do cliente Nome 1, agendado para 14/08/2026 das 13:00 as 14:00, para 14/08/2026 das 15:00 as 16:00.',
        now,
        settings: {
          timezone_name: "America/Sao_Paulo",
          operating_days: null,
          operating_hours: null,
        },
      });

      assert.equal(parsed.ok, true);

      if (!parsed.ok) {
        throw new Error("expected reschedule target parsing to succeed");
      }

      assert.equal(parsed.timeRange.startTime, "15:00");
      assert.equal(parsed.timeRange.endTime, "16:00");
      assert.equal(parsed.payload.scheduled_start, "2026-08-14T18:00:00.000Z");
      assert.equal(parsed.payload.scheduled_end, "2026-08-14T19:00:00.000Z");
    },
  },
];

async function run() {
  for (const test of tests) {
    test.run();
  }

  console.log(`reschedule-target: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
