import { strict as assert } from "node:assert";
import { buildDashboardPeriod } from "./dashboard-time";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "uses Sao Paulo civil day independently from UTC runtime day",
    run: () => {
      const period = buildDashboardPeriod(
        new Date("2026-09-08T03:30:00.000Z"),
        "America/Sao_Paulo"
      );

      assert.equal(period.timeZone, "America/Sao_Paulo");
      assert.equal(period.todayDateKey, "2026-09-08");
      assert.equal(period.todayStart, "2026-09-08T03:00:00.000Z");
      assert.equal(period.todayEnd, "2026-09-09T02:59:59.999Z");
      assert.equal(period.weekStart, "2026-09-02T03:00:00.000Z");
      assert.equal(period.monthStart, "2026-09-01T03:00:00.000Z");
      assert.equal(period.monthEnd, "2026-10-01T02:59:59.999Z");
      assert.equal(period.next30DaysEnd, "2026-10-09T02:59:59.999Z");
    },
  },
  {
    name: "uses configured Tokyo timezone without hidden Sao Paulo hardcode",
    run: () => {
      const period = buildDashboardPeriod(
        new Date("2026-09-08T03:30:00.000Z"),
        "Asia/Tokyo"
      );

      assert.equal(period.timeZone, "Asia/Tokyo");
      assert.equal(period.todayDateKey, "2026-09-08");
      assert.equal(period.todayStart, "2026-09-07T15:00:00.000Z");
      assert.equal(period.todayEnd, "2026-09-08T14:59:59.999Z");
      assert.equal(period.weekStart, "2026-09-01T15:00:00.000Z");
      assert.equal(period.monthStart, "2026-08-31T15:00:00.000Z");
      assert.equal(period.monthEnd, "2026-09-30T14:59:59.999Z");
      assert.equal(period.next30DaysEnd, "2026-10-08T14:59:59.999Z");
    },
  },
  {
    name: "falls back to Sao Paulo for empty or invalid timezone",
    run: () => {
      for (const value of ["", "Invalid/Timezone"]) {
        const period = buildDashboardPeriod(
          new Date("2026-09-08T03:30:00.000Z"),
          value
        );

        assert.equal(period.timeZone, "America/Sao_Paulo");
        assert.equal(period.todayDateKey, "2026-09-08");
        assert.equal(period.todayStart, "2026-09-08T03:00:00.000Z");
      }
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`dashboard-time: ${tests.length} tests passed`);
