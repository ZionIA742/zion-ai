import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";
import type { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import type { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

type ZionAdminAccessResult = Awaited<ReturnType<typeof resolveZionAdminApiAccess>>;

type StoreRow = {
  id: string;
  organization_id: string | null;
  name: string | null;
};

type SubscriptionRow = {
  id: string;
  organization_id: string | null;
  status: string | null;
};

type SubscriptionMutationAction = "suspend" | "reactivate";

export type StoreSubscriptionStateHandlerDeps = {
  resolveAccess: typeof resolveZionAdminApiAccess;
  createServiceSupabase: typeof createServiceSupabaseClient;
};

function normalizeAction(value: unknown): SubscriptionMutationAction | null {
  return value === "suspend" || value === "reactivate" ? value : null;
}

function normalizeStatus(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function loadCanonicalSubscription(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  organizationId: string,
) {
  const { data, error } = await serviceSupabase
    .from("subscriptions")
    .select("id, organization_id, status")
    .eq("organization_id", organizationId)
    .limit(2);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as SubscriptionRow[];

  if (rows.length !== 1 || !rows[0]?.id || !rows[0]?.organization_id) {
    return null;
  }

  return rows[0];
}

async function disableStoreExternalIntegrations(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  organizationId: string,
  storeId: string,
) {
  const { error } = await serviceSupabase
    .from("external_integrations")
    .update({
      is_active: false,
    })
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .select("id");

  if (error) {
    throw error;
  }
}

async function updateSubscriptionStatus(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  subscriptionId: string,
  organizationId: string,
  nextStatus: "active" | "suspended",
) {
  const { data, error } = await serviceSupabase
    .from("subscriptions")
    .update({
      status: nextStatus,
    })
    .eq("id", subscriptionId)
    .eq("organization_id", organizationId)
    .select("id, organization_id, status")
    .maybeSingle<SubscriptionRow>();

  if (error) {
    throw error;
  }

  if (!data?.id || !data.organization_id) {
    throw new Error("Subscription target not found during update.");
  }

  return data;
}

export async function handleStoreSubscriptionStateMutation(
  request: Request,
  deps: StoreSubscriptionStateHandlerDeps,
): Promise<Response> {
  try {
    const access = (await deps.resolveAccess()) as ZionAdminAccessResult;

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    const body = await request.json().catch(() => null);
    const storeId = String(body?.storeId || "").trim();
    const action = normalizeAction(body?.action);

    if (!storeId) {
      return createZionAdminApiJsonResponse(
        {
          error: "Store ID obrigatorio.",
        },
        400,
      );
    }

    if (!action) {
      return createZionAdminApiJsonResponse(
        {
          error: "Acao invalida.",
        },
        400,
      );
    }

    const serviceSupabase = deps.createServiceSupabase();
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    if (!store?.id || !store.organization_id) {
      return createZionAdminApiJsonResponse(
        {
          error: "Loja alvo nao encontrada.",
        },
        404,
      );
    }

    const subscription = await loadCanonicalSubscription(
      serviceSupabase,
      store.organization_id,
    );

    if (!subscription?.id) {
      return createZionAdminApiJsonResponse(
        {
          error: "Subscription canonica inexistente ou ambigua para a loja.",
        },
        409,
      );
    }

    const currentStatus = normalizeStatus(subscription.status);

    if (action === "suspend") {
      if (currentStatus !== "active") {
        return createZionAdminApiJsonResponse(
          {
            error: "Somente lojas com subscription active podem ser desativadas nesta etapa.",
          },
          409,
        );
      }

      await disableStoreExternalIntegrations(
        serviceSupabase,
        store.organization_id,
        store.id,
      );

      const updatedSubscription = await updateSubscriptionStatus(
        serviceSupabase,
        subscription.id,
        store.organization_id,
        "suspended",
      );

      return createZionAdminApiJsonResponse(
        {
          ok: true,
          storeId: store.id,
          organizationId: store.organization_id,
          subscriptionId: updatedSubscription.id,
          action,
          previousStatus: subscription.status,
          subscriptionStatus: updatedSubscription.status,
        },
        200,
      );
    }

    if (currentStatus !== "suspended") {
      return createZionAdminApiJsonResponse(
        {
          error: "Somente lojas suspensas podem ser reativadas nesta etapa.",
        },
        409,
      );
    }

    const updatedSubscription = await updateSubscriptionStatus(
      serviceSupabase,
      subscription.id,
      store.organization_id,
      "active",
    );

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        storeId: store.id,
        organizationId: store.organization_id,
        subscriptionId: updatedSubscription.id,
        action,
        previousStatus: subscription.status,
        subscriptionStatus: updatedSubscription.status,
      },
      200,
    );
  } catch (error) {
    console.error("[zion-admin][stores][subscription-state] unexpected error", error);
    return createZionAdminApiJsonResponse(
      {
        error: "Falha interna ao atualizar o estado da loja.",
      },
      500,
    );
  }
}
