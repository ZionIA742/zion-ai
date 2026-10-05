import {
  decryptWhatsappTwoStepPin,
  type EncryptedWhatsappTwoStepPin,
} from "./whatsapp-two-step-pin-crypto";

export const WHATSAPP_TWO_STEP_PIN_PROVIDER = "whatsapp" as const;

export type WhatsappTwoStepPinSupabaseLike = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
};

export type WhatsappTwoStepPinMetadata = {
  managed_pin: boolean;
  status: "pending" | "active" | "invalidated" | null;
  key_version: number | null;
  created_at: string | null;
  last_revealed_at: string | null;
  last_rotated_at: string | null;
};

function requiredText(value: string, code: string): string {
  const text = value.trim();
  if (!text) throw new WhatsappTwoStepPinSecretError(code, 400);
  return text;
}

function rpcRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rpcError(code: string, error: { message?: string | null } | null) {
  if (error) throw new WhatsappTwoStepPinSecretError(code, 503);
}

export class WhatsappTwoStepPinSecretError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, httpStatus = 409) {
    super(code);
    this.name = "WhatsappTwoStepPinSecretError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export async function createPendingWhatsappTwoStepPinSecret(args: {
  supabase: WhatsappTwoStepPinSupabaseLike;
  organizationId: string;
  storeId: string;
  phoneNumberId: string;
  material: EncryptedWhatsappTwoStepPin;
}) {
  const organizationId = requiredText(
    args.organizationId,
    "WHATSAPP_PIN_ORGANIZATION_REQUIRED",
  );
  const storeId = requiredText(args.storeId, "WHATSAPP_PIN_STORE_REQUIRED");
  const phoneNumberId = requiredText(
    args.phoneNumberId,
    "WHATSAPP_PIN_PHONE_REQUIRED",
  );
  const { data, error } = await args.supabase.rpc(
    "create_whatsapp_phone_security_secret_pending_by_system",
    {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_provider: WHATSAPP_TWO_STEP_PIN_PROVIDER,
      p_phone_number_id: phoneNumberId,
      p_ciphertext: args.material.ciphertext,
      p_iv: args.material.iv,
      p_auth_tag: args.material.authTag,
      p_key_version: args.material.keyVersion,
    },
  );
  rpcError("WHATSAPP_PIN_PENDING_WRITE_FAILED", error);
  const row = rpcRow(data);
  if (!row?.secret_id || typeof row.status !== "string") {
    throw new WhatsappTwoStepPinSecretError("WHATSAPP_PIN_PENDING_WRITE_INVALID");
  }
  return { secretId: row.secret_id as string, status: row.status as string };
}

export async function activateWhatsappTwoStepPinSecret(args: {
  supabase: WhatsappTwoStepPinSupabaseLike;
  organizationId: string;
  storeId: string;
  phoneNumberId: string;
  externalIntegrationId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "activate_whatsapp_phone_security_secret_by_system",
    {
      p_organization_id: requiredText(args.organizationId, "WHATSAPP_PIN_ORGANIZATION_REQUIRED"),
      p_store_id: requiredText(args.storeId, "WHATSAPP_PIN_STORE_REQUIRED"),
      p_provider: WHATSAPP_TWO_STEP_PIN_PROVIDER,
      p_phone_number_id: requiredText(args.phoneNumberId, "WHATSAPP_PIN_PHONE_REQUIRED"),
      p_external_integration_id: requiredText(args.externalIntegrationId, "WHATSAPP_PIN_INTEGRATION_REQUIRED"),
    },
  );
  rpcError("WHATSAPP_PIN_ACTIVATE_FAILED", error);
  const row = rpcRow(data);
  if (!row?.secret_id || row.status !== "active") {
    throw new WhatsappTwoStepPinSecretError("WHATSAPP_PIN_ACTIVATE_INVALID");
  }
  return { secretId: row.secret_id as string, status: "active" as const };
}

export async function invalidateWhatsappTwoStepPinSecret(args: {
  supabase: WhatsappTwoStepPinSupabaseLike;
  organizationId: string;
  storeId: string;
  secretId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "invalidate_whatsapp_phone_security_secret_by_system",
    {
      p_organization_id: requiredText(args.organizationId, "WHATSAPP_PIN_ORGANIZATION_REQUIRED"),
      p_store_id: requiredText(args.storeId, "WHATSAPP_PIN_STORE_REQUIRED"),
      p_secret_id: requiredText(args.secretId, "WHATSAPP_PIN_SECRET_REQUIRED"),
    },
  );
  rpcError("WHATSAPP_PIN_INVALIDATE_FAILED", error);
  const row = rpcRow(data);
  if (!row?.secret_id || row.status !== "invalidated") {
    throw new WhatsappTwoStepPinSecretError("WHATSAPP_PIN_INVALIDATE_INVALID");
  }
  return { secretId: row.secret_id as string, status: "invalidated" as const };
}

export async function readWhatsappTwoStepPinMetadata(args: {
  supabase: WhatsappTwoStepPinSupabaseLike;
  organizationId: string;
  storeId: string;
  phoneNumberId: string;
}): Promise<WhatsappTwoStepPinMetadata> {
  const { data, error } = await args.supabase.rpc(
    "read_whatsapp_phone_security_secret_metadata_by_system",
    {
      p_organization_id: requiredText(args.organizationId, "WHATSAPP_PIN_ORGANIZATION_REQUIRED"),
      p_store_id: requiredText(args.storeId, "WHATSAPP_PIN_STORE_REQUIRED"),
      p_provider: WHATSAPP_TWO_STEP_PIN_PROVIDER,
      p_phone_number_id: requiredText(args.phoneNumberId, "WHATSAPP_PIN_PHONE_REQUIRED"),
    },
  );
  rpcError("WHATSAPP_PIN_METADATA_READ_FAILED", error);
  const row = rpcRow(data);
  if (!row || typeof row.managed_pin !== "boolean") {
    throw new WhatsappTwoStepPinSecretError("WHATSAPP_PIN_METADATA_READ_INVALID");
  }
  return {
    managed_pin: row.managed_pin,
    status: typeof row.status === "string" ? (row.status as WhatsappTwoStepPinMetadata["status"]) : null,
    key_version: typeof row.key_version === "number" ? row.key_version : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    last_revealed_at: typeof row.last_revealed_at === "string" ? row.last_revealed_at : null,
    last_rotated_at: typeof row.last_rotated_at === "string" ? row.last_rotated_at : null,
  };
}

export async function revealWhatsappTwoStepPinServerSide(args: {
  supabase: WhatsappTwoStepPinSupabaseLike;
  organizationId: string;
  storeId: string;
  phoneNumberId: string;
}): Promise<string> {
  const { data, error } = await args.supabase.rpc(
    "read_whatsapp_phone_security_secret_material_by_system",
    {
      p_organization_id: requiredText(args.organizationId, "WHATSAPP_PIN_ORGANIZATION_REQUIRED"),
      p_store_id: requiredText(args.storeId, "WHATSAPP_PIN_STORE_REQUIRED"),
      p_provider: WHATSAPP_TWO_STEP_PIN_PROVIDER,
      p_phone_number_id: requiredText(args.phoneNumberId, "WHATSAPP_PIN_PHONE_REQUIRED"),
    },
  );
  rpcError("WHATSAPP_PIN_REVEAL_FAILED", error);
  const row = rpcRow(data);
  if (
    !row?.secret_id ||
    typeof row.ciphertext !== "string" ||
    typeof row.iv !== "string" ||
    typeof row.auth_tag !== "string" ||
    typeof row.key_version !== "number"
  ) {
    throw new WhatsappTwoStepPinSecretError("WHATSAPP_PIN_REVEAL_INVALID");
  }

  return decryptWhatsappTwoStepPin({
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version as 1,
  });
}
