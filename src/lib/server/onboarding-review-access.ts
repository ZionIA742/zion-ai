import type { AccessResolution } from "@/lib/account-access-resolution";

type OnboardingReviewResolution = Pick<
  AccessResolution,
  "sessionUserId" | "organizationId" | "storeId"
>;

type OnboardingReviewEnvironment = Readonly<
  Record<string, string | undefined>
>;

function normalized(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function isOnboardingReviewAuthorized(
  resolution: OnboardingReviewResolution,
  environment: OnboardingReviewEnvironment = process.env,
): boolean {
  if (environment.P19A_ONBOARDING_REVIEW_ENABLED !== "true") {
    return false;
  }

  const expectedUserId = normalized(environment.P19A_ONBOARDING_REVIEW_USER_ID);
  const expectedOrganizationId = normalized(
    environment.P19A_ONBOARDING_REVIEW_ORGANIZATION_ID,
  );
  const expectedStoreId = normalized(environment.P19A_ONBOARDING_REVIEW_STORE_ID);
  const sessionUserId = normalized(resolution.sessionUserId);
  const organizationId = normalized(resolution.organizationId);
  const storeId = normalized(resolution.storeId);

  if (
    !expectedUserId ||
    !expectedOrganizationId ||
    !expectedStoreId ||
    !sessionUserId ||
    !organizationId ||
    !storeId
  ) {
    return false;
  }

  return (
    sessionUserId === expectedUserId &&
    organizationId === expectedOrganizationId &&
    storeId === expectedStoreId
  );
}
