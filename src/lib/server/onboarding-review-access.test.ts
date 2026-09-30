import { strict as assert } from "node:assert";
import { isOnboardingReviewAuthorized } from "./onboarding-review-access";

const resolution = {
  sessionUserId: "user-1",
  organizationId: "org-1",
  storeId: "store-1",
};

const validEnvironment = {
  P19A_ONBOARDING_REVIEW_ENABLED: "true",
  P19A_ONBOARDING_REVIEW_USER_ID: "user-1",
  P19A_ONBOARDING_REVIEW_ORGANIZATION_ID: "org-1",
  P19A_ONBOARDING_REVIEW_STORE_ID: "store-1",
};

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "missing flag fails closed",
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(resolution, {
          ...validEnvironment,
          P19A_ONBOARDING_REVIEW_ENABLED: undefined,
        }),
        false,
      );
    },
  },
  {
    name: "false flag fails closed",
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(resolution, {
          ...validEnvironment,
          P19A_ONBOARDING_REVIEW_ENABLED: "false",
        }),
        false,
      );
    },
  },
  ...(
    [
      ["P19A_ONBOARDING_REVIEW_USER_ID", "user-2"],
      ["P19A_ONBOARDING_REVIEW_ORGANIZATION_ID", "org-2"],
      ["P19A_ONBOARDING_REVIEW_STORE_ID", "store-2"],
    ] as const
  ).map(([key, value]) => ({
    name: `${key} mismatch fails closed`,
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(resolution, {
          ...validEnvironment,
          [key]: value,
        }),
        false,
      );
    },
  })),
  ...(
    [
      "P19A_ONBOARDING_REVIEW_ENABLED",
      "P19A_ONBOARDING_REVIEW_USER_ID",
      "P19A_ONBOARDING_REVIEW_ORGANIZATION_ID",
      "P19A_ONBOARDING_REVIEW_STORE_ID",
    ] as const
  ).map((key) => ({
    name: `${key} empty fails closed`,
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(resolution, {
          ...validEnvironment,
          [key]: "",
        }),
        false,
      );
    },
  })),
  {
    name: "all exact server-side criteria authorize review",
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(resolution, validEnvironment),
        true,
      );
    },
  },
  {
    name: "missing resolution identity fails closed",
    run: () => {
      assert.equal(
        isOnboardingReviewAuthorized(
          { ...resolution, storeId: null },
          validEnvironment,
        ),
        false,
      );
    },
  },
];

let passed = 0;
for (const test of tests) {
  test.run();
  passed += 1;
}

console.log(`onboarding-review-access: ${passed}/${tests.length} tests passed`);
