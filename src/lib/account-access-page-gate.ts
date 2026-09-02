import type { AccessResolution } from "./account-access-resolution";

export type AccountAccessPageSurface = "store_app" | "onboarding";

export type AccountAccessPageGateDecision =
  | {
      action: "render";
      destination: null;
    }
  | {
      action: "redirect";
      destination: string;
    };

type AccountAccessPageGateOptions = {
  allowCompletedOnboardingReview?: boolean;
};

function redirect(
  destination: string,
): AccountAccessPageGateDecision {
  return {
    action: "redirect",
    destination,
  };
}

function render(): AccountAccessPageGateDecision {
  return {
    action: "render",
    destination: null,
  };
}

export function resolveAccountAccessPageGate(
  resolution: AccessResolution,
  surface: AccountAccessPageSurface,
  options: AccountAccessPageGateOptions = {},
): AccountAccessPageGateDecision {
  if (surface === "store_app") {
    switch (resolution.status) {
      case "store_ready_active":
        return render();
      case "store_ready_onboarding_required":
        return redirect("/onboarding");
      case "store_first_access_required":
        return redirect("/auth/reset-password");
      case "store_password_login_required":
        return redirect("/login");
      case "anonymous":
        return redirect("/login");
      case "access_resolution_unavailable":
        return redirect("/account/access-unavailable");
      default:
        return redirect("/account/access-blocked");
    }
  }

  switch (resolution.status) {
    case "store_ready_onboarding_required":
      return render();
    case "store_ready_active":
      if (options.allowCompletedOnboardingReview) {
        return render();
      }
      return redirect("/crm");
    case "store_first_access_required":
      return redirect("/auth/reset-password");
    case "store_password_login_required":
      return redirect("/login");
    case "anonymous":
      return redirect("/login");
    case "access_resolution_unavailable":
      return redirect("/account/access-unavailable");
    default:
      return redirect("/account/access-blocked");
  }
}
