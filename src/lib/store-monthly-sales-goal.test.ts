import { strict as assert } from "node:assert";
import {
  buildMonthlySalesGoalState,
  normalizeMonthlySalesGoalInput,
  normalizeStoreMonthlySalesGoalRow,
} from "./store-monthly-sales-goal";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "disabled goal clears amount",
    run: () => {
      assert.deepEqual(
        normalizeMonthlySalesGoalInput({ enabled: false, amountCents: 12345 }),
        { enabled: false, amountCents: null },
      );
    },
  },
  {
    name: "enabled goal requires positive cents",
    run: () => {
      assert.throws(
        () => normalizeMonthlySalesGoalInput({ enabled: true, amountCents: 0 }),
        /MONTHLY_SALES_GOAL_AMOUNT_REQUIRED/,
      );
    },
  },
  {
    name: "invalid canonical row fails closed to disabled state",
    run: () => {
      assert.deepEqual(
        normalizeStoreMonthlySalesGoalRow({
          organization_id: "org",
          store_id: "store",
          monthly_goal_enabled: true,
          monthly_goal_amount_cents: null,
        }),
        { enabled: false, amountCents: null },
      );
    },
  },
  {
    name: "progress is derived from canonical goal and current revenue",
    run: () => {
      assert.deepEqual(
        buildMonthlySalesGoalState({
          row: {
            organization_id: "org",
            store_id: "store",
            monthly_goal_enabled: true,
            monthly_goal_amount_cents: 100000,
          },
          currentRevenueCents: 37500,
        }),
        {
          enabled: true,
          amountCents: 100000,
          configured: true,
          revenueKnown: true,
          progressPercent: 38,
          remainingCents: 62500,
        },
      );
    },
  },
  {
    name: "unknown revenue does not derive fictitious progress",
    run: () => {
      assert.deepEqual(
        buildMonthlySalesGoalState({
          row: {
            organization_id: "org",
            store_id: "store",
            monthly_goal_enabled: true,
            monthly_goal_amount_cents: 100000,
          },
          currentRevenueCents: null,
        }),
        {
          enabled: true,
          amountCents: 100000,
          configured: true,
          revenueKnown: false,
          progressPercent: null,
          remainingCents: null,
        },
      );
    },
  },
  {
    name: "absent canonical row is not configured",
    run: () => {
      assert.deepEqual(
        buildMonthlySalesGoalState({
          row: null,
          currentRevenueCents: null,
        }),
        {
          enabled: false,
          amountCents: null,
          configured: false,
          revenueKnown: false,
          progressPercent: null,
          remainingCents: null,
        },
      );
    },
  },
  {
    name: "explicitly disabled canonical goal is configured",
    run: () => {
      assert.deepEqual(
        buildMonthlySalesGoalState({
          row: {
            organization_id: "org",
            store_id: "store",
            monthly_goal_enabled: false,
            monthly_goal_amount_cents: null,
          },
          currentRevenueCents: null,
        }),
        {
          enabled: false,
          amountCents: null,
          configured: true,
          revenueKnown: false,
          progressPercent: null,
          remainingCents: null,
        },
      );
    },
  },
  {
    name: "malformed disabled canonical row is not configured",
    run: () => {
      assert.deepEqual(
        buildMonthlySalesGoalState({
          row: {
            organization_id: "org",
            store_id: "store",
            monthly_goal_enabled: false,
            monthly_goal_amount_cents: 12345,
          },
          currentRevenueCents: null,
        }),
        {
          enabled: false,
          amountCents: null,
          configured: false,
          revenueKnown: false,
          progressPercent: null,
          remainingCents: null,
        },
      );
    },
  },
];

for (const test of tests) {
  test.run();
}

console.log(`store-monthly-sales-goal: ${tests.length} tests passed`);
