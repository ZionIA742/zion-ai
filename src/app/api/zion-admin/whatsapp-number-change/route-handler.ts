import {
  buildWhatsappNumberChangeLink,
  createConfiguredWhatsappNumberChangeEmailTransport,
  createWhatsappNumberChangeToken,
  hashWhatsappNumberChangeToken,
  WHATSAPP_NUMBER_CHANGE_LINK_TTL_MS,
  WHATSAPP_NUMBER_CHANGE_PROVIDER,
  type WhatsappNumberChangeEmailTransport,
} from "@/lib/server/whatsapp-number-change-link";
import { type ZionAdminApiAccessResult } from "@/lib/server/zion-admin-api-access";

type ServiceClient = {
  from(table: string): {
    select(columns: string): ServiceQuery;
    insert(values: Record<string, unknown>): Promise<{ error: unknown | null }>;
  };
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string | null } | null }>;
  auth: { admin: { getUserById(id: string): Promise<{ data: { user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null }; error: unknown | null }> } };
};

type ServiceQuery = PromiseLike<{ data: unknown; error: unknown | null }> & {
  eq(column: string, value: unknown): ServiceQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown | null }>;
};

type OwnerMembership = { id: string; user_id: string; role?: string | null; is_active?: boolean | null };

export type WhatsappNumberChangeRouteDeps = {
  resolveAccess: () => Promise<ZionAdminApiAccessResult>;
  createServiceSupabase: () => ServiceClient;
  now: () => Date;
  createToken: () => string;
  sendEmail: WhatsappNumberChangeEmailTransport;
  baseUrl: () => string | null;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeErrorCode(error: unknown) {
  const message = error && typeof error === "object" && "message" in error
    ? text((error as { message?: unknown }).message)
    : "";
  return message.startsWith("ZION_") ? message.split(/\s|:/, 1)[0] : "WHATSAPP_NUMBER_CHANGE_FAILED";
}

async function readBody(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readStoreOwner(client: ServiceClient, storeId: string) {
  const storeResult = await client.from("stores").select("id, organization_id, name").eq("id", storeId).maybeSingle();
  if (storeResult.error || !storeResult.data) throw new Error("WHATSAPP_NUMBER_CHANGE_STORE_NOT_FOUND");
  const store = storeResult.data as { id: string; organization_id: string; name?: string | null };
  const membershipResult = await client
    .from("memberships")
    .select("id, user_id, role, is_active")
    .eq("organization_id", store.organization_id)
    .eq("role", "owner");
  if (membershipResult.error) throw new Error("WHATSAPP_NUMBER_CHANGE_OWNER_LOOKUP_FAILED");
  const owners = ((membershipResult.data ?? []) as OwnerMembership[]).filter((row) => row.is_active !== false);
  if (owners.length !== 1 || !text(owners[0]?.user_id)) throw new Error("WHATSAPP_NUMBER_CHANGE_OWNER_AMBIGUOUS");
  const owner = owners[0];
  const internalAdmin = await client.from("zion_internal_admins").select("user_id").eq("user_id", owner.user_id).maybeSingle();
  if (internalAdmin.error) throw new Error("WHATSAPP_NUMBER_CHANGE_OWNER_LOOKUP_FAILED");
  if (internalAdmin.data) throw new Error("WHATSAPP_NUMBER_CHANGE_INTERNAL_OWNER");
  const auth = await client.auth.admin.getUserById(owner.user_id);
  if (auth.error || !auth.data.user || !text(auth.data.user.email)) throw new Error("WHATSAPP_NUMBER_CHANGE_OWNER_EMAIL_UNAVAILABLE");
  return { store, owner, email: text(auth.data.user.email).toLowerCase() };
}

async function createLink(body: Record<string, unknown>, access: Extract<ZionAdminApiAccessResult, { ok: true }>, deps: WhatsappNumberChangeRouteDeps) {
  const storeId = text(body.storeId);
  if (!storeId) return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_STORE_REQUIRED" }, 400);
  const client = deps.createServiceSupabase();
  const { store, owner, email } = await readStoreOwner(client, storeId);
  const baseUrl = deps.baseUrl();
  if (!baseUrl) return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_BASE_URL_UNAVAILABLE" }, 503);
  const token = deps.createToken();
  const expiresAt = new Date(deps.now().getTime() + WHATSAPP_NUMBER_CHANGE_LINK_TTL_MS);
  const created = await client.rpc("create_whatsapp_number_change_link_by_system", {
    p_organization_id: store.organization_id,
    p_store_id: store.id,
    p_provider: WHATSAPP_NUMBER_CHANGE_PROVIDER,
    p_token_hash: hashWhatsappNumberChangeToken(token),
    p_created_by_user_id: access.sessionUserId,
    p_responsible_user_id: owner.user_id,
    p_expires_at: expiresAt.toISOString(),
  });
  if (created.error) throw new Error(safeErrorCode(created.error));
  const link = buildWhatsappNumberChangeLink(baseUrl, token);
  const delivered = await deps.sendEmail.send({
    recipient: email,
    storeName: text(store.name) || "sua loja",
    link,
    expiresAt: expiresAt.toISOString(),
  });
  if (!delivered.delivered) {
    await client.rpc("revoke_whatsapp_number_change_link_by_system", {
      p_link_id: Array.isArray(created.data) ? (created.data[0] as { link_id?: string })?.link_id : (created.data as { link_id?: string } | null)?.link_id,
      p_organization_id: store.organization_id,
      p_store_id: store.id,
      p_provider: WHATSAPP_NUMBER_CHANGE_PROVIDER,
    });
    return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_EMAIL_TRANSPORT_UNAVAILABLE" }, 503);
  }
  const row = Array.isArray(created.data) ? created.data[0] : created.data;
  return response({ ok: true, status: "issued", storeId: store.id, storeName: store.name, emailMasked: `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}`, expiresAt: (row as { expires_at?: string } | null)?.expires_at ?? expiresAt.toISOString() }, 201);
}

async function revokeLink(body: Record<string, unknown>, access: Extract<ZionAdminApiAccessResult, { ok: true }>, deps: WhatsappNumberChangeRouteDeps) {
  const storeId = text(body.storeId);
  const linkId = text(body.linkId);
  if (!storeId || !linkId) return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_LINK_REQUIRED" }, 400);
  const client = deps.createServiceSupabase();
  const storeResult = await client.from("stores").select("id, organization_id").eq("id", storeId).maybeSingle();
  const store = storeResult.data as { id?: string; organization_id?: string } | null;
  if (storeResult.error || store?.id !== storeId || !store.organization_id) return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_STORE_NOT_FOUND" }, 404);
  const revoked = await client.rpc("revoke_whatsapp_number_change_link_by_system", {
    p_link_id: linkId,
    p_organization_id: store.organization_id,
    p_store_id: storeId,
    p_provider: WHATSAPP_NUMBER_CHANGE_PROVIDER,
  });
  if (revoked.error) return response({ ok: false, error: safeErrorCode(revoked.error) }, 409);
  return response({ ok: true, status: "revoked", actorUserId: access.sessionUserId });
}

export function createWhatsappNumberChangeRouteHandler(overrides: Partial<WhatsappNumberChangeRouteDeps> = {}) {
  const deps: WhatsappNumberChangeRouteDeps = {
    resolveAccess: async () => ({ ok: false } as ZionAdminApiAccessResult),
    createServiceSupabase: () => { throw new Error("service client unavailable"); },
    now: () => new Date(),
    createToken: createWhatsappNumberChangeToken,
    sendEmail: createConfiguredWhatsappNumberChangeEmailTransport(),
    baseUrl: () => process.env.NEXT_PUBLIC_SITE_URL?.trim() || null,
    ...overrides,
  };
  return async function POST(request: Request) {
    const access = await deps.resolveAccess();
    if (!access.ok) return response({ ok: false, error: "ZION_ADMIN_ACCESS_DENIED" }, 403);
    try {
      const body = await readBody(request);
      if (!body) return response({ ok: false, error: "INVALID_JSON" }, 400);
      const action = text(body.action || "create");
      if (action === "create") return await createLink(body, access, deps);
      if (action === "revoke") return await revokeLink(body, access, deps);
      return response({ ok: false, error: "WHATSAPP_NUMBER_CHANGE_ACTION_INVALID" }, 400);
    } catch (error) {
      const code = error instanceof Error ? error.message : "WHATSAPP_NUMBER_CHANGE_FAILED";
      const status = code.includes("NOT_FOUND") ? 404 : code.includes("AMBIGUOUS") || code.includes("INTERNAL") ? 409 : 503;
      return response({ ok: false, error: code }, status);
    }
  };
}
