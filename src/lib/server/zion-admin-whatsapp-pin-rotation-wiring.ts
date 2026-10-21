/**
 * ZION-ADM 1.8-C2D: server-only wiring of the already audited rotation modules.
 *
 * Not an HTTP endpoint. This module is OFF by default. The browser must never
 * provide Meta tokens, the current PIN, encryption materials or operation binding.
 * The caller must use a server-side service_role client, and later must enforce
 * current session/capability/origin/consent BEFORE invoking this function.
 *
 * Keep the old WhatsApp recovery code entirely separate from voluntary rotation.
 */
import {
  decryptWhatsappTwoStepPin,
  encryptWhatsappTwoStepPin,
  generateWhatsappTwoStepPin,
} from "./whatsapp-two-step-pin-crypto";
import { setMetaWhatsappTwoStepVerificationPin } from "./meta-whatsapp-pin-rotation";
import {
  resolveTrustedWhatsappPinRotationBinding,
  type RotationBindingRpc,
} from "./zion-admin-whatsapp-pin-rotation-binding";
import {
  executeAuthorizedWhatsappPinRotation,
  type AuthorizedRotation,
  type PinRotationExecutionDeps,
  type RotationExecutionOutcome,
  type RotationExecutionRpc,
} from "./zion-admin-whatsapp-pin-rotation-execution";

export const WHATSAPP_PIN_ROTATION_EXECUTION_FLAG =
  "ZION_ADMIN_WHATSAPP_PIN_ROTATION_EXECUTION_ENABLED" as const;

type ServerRotationDb = RotationBindingRpc & RotationExecutionRpc;

type TrustedRotationPrimitives = {
  resolveBinding: typeof resolveTrustedWhatsappPinRotationBinding;
  decryptPin: typeof decryptWhatsappTwoStepPin;
  generatePin: typeof generateWhatsappTwoStepPin;
  encryptPin: typeof encryptWhatsappTwoStepPin;
  setMetaPin: typeof setMetaWhatsappTwoStepVerificationPin;
  execute: typeof executeAuthorizedWhatsappPinRotation;
};

const productionPrimitives: TrustedRotationPrimitives = {
  resolveBinding: resolveTrustedWhatsappPinRotationBinding,
  decryptPin: decryptWhatsappTwoStepPin,
  generatePin: generateWhatsappTwoStepPin,
  encryptPin: encryptWhatsappTwoStepPin,
  setMetaPin: setMetaWhatsappTwoStepVerificationPin,
  execute: executeAuthorizedWhatsappPinRotation,
};

export type TrustedRotationServerInput = {
  /** Privileged, server-created Supabase client. Not a browser user client. */
  db: ServerRotationDb;
  /** Only a server-side configuration, never supplied by browser JSON. */
  graphApiVersion?: () => string | undefined;
};

/** Dependency injection exists for offline unit tests, not browser/HTTP use. */
export type TrustedRotationWiringOverrides = Partial<TrustedRotationPrimitives> & {
  executionEnabled?: () => boolean;
};

/**
 * Build the concrete dependencies required by the existing execution engine.
 * This function itself does not make any DB or Meta requests.
 */
export function createTrustedWhatsappPinRotationExecutionDeps(
  input: TrustedRotationServerInput,
  overrides: TrustedRotationWiringOverrides = {},
): PinRotationExecutionDeps {
  const primitives = { ...productionPrimitives, ...overrides };
  const graphApiVersion = input.graphApiVersion ??
    (() => process.env.WHATSAPP_GRAPH_API_VERSION);

  return {
    db: input.db,
    loadTrustedBinding: (operation) => primitives.resolveBinding(operation, {
      db: input.db,
      graphApiVersion,
      decryptPin: primitives.decryptPin,
    }),
    generateSecurePin: () => primitives.generatePin(),
    encryptPin: (pin) => primitives.encryptPin(pin),
    setMetaPin: (args) => primitives.setMetaPin(args),
  };
}

/**
 * Disabled by default, with NO public execution route in this stage.
 * A future route must validate session, capability, consent and origin, using
 * the same-session HMAC already required by the preparation SQL.
 */
export async function executeTrustedWhatsappPinRotationWhenEnabled(
  operation: AuthorizedRotation,
  input: TrustedRotationServerInput,
  overrides: TrustedRotationWiringOverrides = {},
): Promise<RotationExecutionOutcome> {
  const enabled = overrides.executionEnabled ??
    (() => process.env[WHATSAPP_PIN_ROTATION_EXECUTION_FLAG] === "true");
  if (!enabled()) {
    return {
      ok: false,
      rotationId: typeof operation?.rotationId === "string" ? operation.rotationId : "",
      state: "preflight_denied",
    };
  }
  const primitives = { ...productionPrimitives, ...overrides };
  return primitives.execute(operation, createTrustedWhatsappPinRotationExecutionDeps(input, overrides));
}
