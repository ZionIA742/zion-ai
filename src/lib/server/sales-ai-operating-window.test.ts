import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSalesAiOperatingWindowPromptBlock,
  resolveSalesAiOperatingWindow,
  type StoreScheduleHolidayBlockForSalesAiWindow,
  type StoreScheduleSettingsForSalesAiWindow,
} from "./sales-ai-operating-window";

type TestCase = {
  name: string;
  run: () => void;
};

function baseSchedule(
  overrides?: Partial<StoreScheduleSettingsForSalesAiWindow>,
): StoreScheduleSettingsForSalesAiWindow {
  return {
    operating_days: ["segunda", "terca", "quarta", "quinta", "sexta"],
    operating_hours: {
      segunda: { start: "08:00", end: "18:00" },
      terca: { start: "08:00", end: "18:00" },
      quarta: { start: "08:00", end: "18:00" },
      quinta: { start: "08:00", end: "18:00" },
      sexta: { start: "08:00", end: "18:00" },
    },
    timezone_name: "America/Sao_Paulo",
    attends_holidays: false,
    human_schedule_configured_at: "2026-09-10T10:00:00.000Z",
    ai_after_hours_configured_at: "2026-09-10T10:05:00.000Z",
    holiday_mode: null,
    holiday_open_time: null,
    holiday_close_time: null,
    holiday_notes: null,
    ai_after_hours_enabled: false,
    ai_after_hours_mode: null,
    ai_after_hours_start: null,
    ai_after_hours_end: null,
    ai_attends_holidays: false,
    ...overrides,
  };
}

function holidayBlock(
  startIso: string,
  endIso: string,
  title = "Feriado",
): StoreScheduleHolidayBlockForSalesAiWindow {
  return {
    id: "holiday-1",
    title,
    block_type: "holiday",
    start_at: startIso,
    end_at: endIso,
  };
}

const tests: TestCase[] = [
  {
    name: "human open allows normal sales AI even when after-hours policy is disabled",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "HUMAN_OPEN");
      assert.equal(result.humanAvailableNow, true);
      assert.equal(result.aiAllowedNow, true);
    },
  },
  {
    name: "closed store with after-hours disabled blocks sales AI and returns next human opening",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-02T01:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanUnavailableReason, "outside_human_operating_hours");
      assert.equal(result.nextHumanOpenPeriod?.localDate, "2026-09-02");
      assert.equal(result.nextHumanOpenPeriod?.startTime, "08:00");
    },
  },
  {
    name: "closed store with all closed hours enabled allows sales AI",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "all_closed_hours",
        }),
        now: new Date("2026-09-02T01:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_ALLOWED_AFTER_HOURS");
      assert.equal(result.aiAllowedNow, true);
    },
  },
  {
    name: "specific after-hours window allows inside the range and blocks outside it",
    run: () => {
      const settings = baseSchedule({
        ai_after_hours_enabled: true,
        ai_after_hours_mode: "specific_window",
        ai_after_hours_start: "18:00",
        ai_after_hours_end: "23:00",
      });

      const inside = resolveSalesAiOperatingWindow({
        settings,
        now: new Date("2026-09-02T00:00:00.000Z"),
      });
      const outside = resolveSalesAiOperatingWindow({
        settings,
        now: new Date("2026-09-02T05:00:00.000Z"),
      });

      assert.equal(inside.decision, "AI_ALLOWED_AFTER_HOURS");
      assert.equal(outside.decision, "AI_NOT_ALLOWED_NOW");
    },
  },
  {
    name: "holiday block with AI holidays disabled blocks even when after-hours is enabled",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "all_closed_hours",
          ai_attends_holidays: false,
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanUnavailableReason, "holiday_block");
      assert.equal(result.isHolidayBlocked, true);
    },
  },
  {
    name: "holiday block with AI holidays enabled allows according to the after-hours policy",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "all_closed_hours",
          ai_attends_holidays: true,
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_ALLOWED_AFTER_HOURS");
      assert.equal(result.isHolidayBlocked, true);
    },
  },
  {
    name: "holiday mode closed makes the human team unavailable",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: "closed",
          attends_holidays: false,
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanAvailableNow, false);
      assert.equal(result.humanUnavailableReason, "holiday_block");
    },
  },
  {
    name: "holiday mode normal uses the normal operating hours",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: "normal",
          attends_holidays: true,
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "HUMAN_OPEN");
      assert.equal(result.humanAvailableNow, true);
      assert.equal(result.isHolidayBlocked, true);
    },
  },
  {
    name: "holiday mode special uses the special holiday window",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: "special",
          holiday_open_time: "10:00:00",
          holiday_close_time: "12:00:00",
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T14:00:00.000Z"),
      });

      assert.equal(result.decision, "HUMAN_OPEN");
      assert.equal(result.humanAvailableNow, true);
      assert.equal(result.nextHumanOpenPeriod?.startTime, "11:00");
    },
  },
  {
    name: "holiday mode special outside the special window stays closed",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: "special",
          holiday_open_time: "10:00:00",
          holiday_close_time: "12:00:00",
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T12:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanAvailableNow, false);
      assert.equal(result.humanUnavailableReason, "outside_human_operating_hours");
    },
  },
  {
    name: "holiday mode case by case fails closed",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: "case_by_case",
          holiday_notes: "Confirmar manualmente com a equipe.",
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanAvailableNow, false);
      assert.equal(result.humanUnavailableReason, "holiday_block");
    },
  },
  {
    name: "holiday mode null preserves legacy attends holidays compatibility",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          holiday_mode: null,
          attends_holidays: true,
        }),
        holidayBlocks: [
          holidayBlock("2026-09-01T03:00:00.000Z", "2026-09-02T03:00:00.000Z"),
        ],
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "HUMAN_OPEN");
      assert.equal(result.humanAvailableNow, true);
      assert.equal(result.isHolidayBlocked, true);
    },
  },
  {
    name: "ai after-hours configured timestamp missing does not allow technical defaults or flags",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_configured_at: null,
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "all_closed_hours",
        }),
        now: new Date("2026-09-02T01:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.policy.aiAfterHoursEnabled, false);
    },
  },
  {
    name: "explicitly configured disabled after-hours policy blocks AI outside human hours",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_configured_at: "2026-09-10T10:05:00.000Z",
          ai_after_hours_enabled: false,
        }),
        now: new Date("2026-09-02T01:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.policy.aiAfterHoursEnabled, false);
    },
  },
  {
    name: "store timezone is respected for the same instant",
    run: () => {
      const tokyo = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          timezone_name: "Asia/Tokyo",
        }),
        now: new Date("2026-09-01T20:30:00.000Z"),
      });
      const saoPaulo = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-01T20:30:00.000Z"),
      });

      assert.equal(tokyo.localNow, "2026-09-02 05:30");
      assert.equal(tokyo.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(saoPaulo.localNow, "2026-09-01 17:30");
      assert.equal(saoPaulo.decision, "HUMAN_OPEN");
    },
  },
  {
    name: "next human open period handles same day tomorrow weekend and consecutive holidays",
    run: () => {
      const sameDay = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-02T10:00:00.000Z"),
      });
      const tomorrow = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-02T23:00:00.000Z"),
      });
      const weekend = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        now: new Date("2026-09-05T00:00:00.000Z"),
      });
      const consecutiveHoliday = resolveSalesAiOperatingWindow({
        settings: baseSchedule(),
        holidayBlocks: [
          holidayBlock("2026-09-07T03:00:00.000Z", "2026-09-08T03:00:00.000Z", "Feriado 1"),
          holidayBlock("2026-09-08T03:00:00.000Z", "2026-09-09T03:00:00.000Z", "Feriado 2"),
        ],
        now: new Date("2026-09-05T00:00:00.000Z"),
      });

      assert.equal(sameDay.nextHumanOpenPeriod?.localDate, "2026-09-02");
      assert.equal(sameDay.nextHumanOpenPeriod?.startTime, "08:00");
      assert.equal(tomorrow.nextHumanOpenPeriod?.localDate, "2026-09-03");
      assert.equal(weekend.nextHumanOpenPeriod?.localDate, "2026-09-07");
      assert.equal(consecutiveHoliday.nextHumanOpenPeriod?.localDate, "2026-09-09");
    },
  },
  {
    name: "missing schedule settings fail closed",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: null,
        now: new Date("2026-09-01T15:00:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.humanUnavailableReason, "schedule_settings_missing");
      assert.equal(result.nextHumanOpenPeriod, null);
    },
  },
  {
    name: "after-hours prompt block tells the AI to defer human-dependent commitments to the next real period",
    run: () => {
      const context = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "all_closed_hours",
        }),
        now: new Date("2026-09-02T01:00:00.000Z"),
      });
      const block = buildSalesAiOperatingWindowPromptBlock(context);

      assert.equal(context.decision, "AI_ALLOWED_AFTER_HOURS");
      assert.equal(block.includes("a equipe humana esta fora do horario agora"), true);
      assert.equal(block.includes("nao invente aprovacao"), true);
      assert.equal(block.includes("quarta-feira 2026-09-02 as 08:00"), true);
    },
  },
  {
    name: "next AI allowed period is distinct from next human period for a specific after-hours policy",
    run: () => {
      const result = resolveSalesAiOperatingWindow({
        settings: baseSchedule({
          ai_after_hours_enabled: true,
          ai_after_hours_mode: "specific_window",
          ai_after_hours_start: "18:00",
          ai_after_hours_end: "23:00",
        }),
        now: new Date("2026-09-02T02:30:00.000Z"),
      });

      assert.equal(result.decision, "AI_NOT_ALLOWED_NOW");
      assert.equal(result.nextAiAllowedPeriod?.localDate, "2026-09-02");
      assert.equal(result.nextAiAllowedPeriod?.startTime, "08:00");
      assert.equal(result.nextHumanOpenPeriod?.startTime, "08:00");
    },
  },
  {
    name: "canonical writer migration validates disabled all-hours specific-window tenant and grants",
    run: () => {
      const source = readFileSync(
        join(
          process.cwd(),
          "supabase/migrations/20260903120000_p19a_sales_ai_after_hours_policy.sql",
        ),
        "utf8",
      );

      assert.equal(
        source.includes(
          "create or replace function public.upsert_store_schedule_ai_after_hours_policy_scoped(",
        ),
        true,
      );
      assert.equal(source.includes("ai_after_hours_enabled = coalesce(p_ai_after_hours_enabled, false)"), true);
      assert.equal(source.includes("v_mode = 'all_closed_hours'"), true);
      assert.equal(source.includes("v_mode = 'specific_window'"), true);
      assert.equal(source.includes("specific_window requires valid distinct start and end times"), true);
      assert.equal(source.includes("where store_row.id = p_store_id"), true);
      assert.equal(source.includes("and store_row.organization_id = p_organization_id"), true);
      assert.equal(source.includes("where schedule_row.organization_id = p_organization_id"), true);
      assert.equal(source.includes("and schedule_row.store_id = p_store_id"), true);
      assert.equal(source.includes("grant execute on function public.upsert_store_schedule_ai_after_hours_policy_scoped"), true);
    },
  },
  {
    name: "authority reader selects explicit card and holiday fields",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/sales-ai-operating-window.ts"),
        "utf8",
      );

      for (const field of [
        "human_schedule_configured_at",
        "ai_after_hours_configured_at",
        "agenda_capacity_configured_at",
        "holiday_mode",
        "holiday_open_time",
        "holiday_close_time",
        "holiday_notes",
        "daily_limit_mode",
        "daily_limit",
        "appointment_buffer_enabled",
        "appointment_buffer_minutes",
      ]) {
        assert.equal(source.includes(`\"${field}\"`), true, field);
      }
    },
  },
];

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${test.name}`);
    throw error;
  }
}

console.log(`sales-ai-operating-window: ${passed}/${tests.length} tests passed`);
