/** UI-only parser for administrative PIN rotation responses: never exposes secrets. */
export type PinRotationPublicOperation = {
  rotationId: string;
  operationId: string;
  expiresInSeconds: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function isListedSecretId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parsePreparedRotation(responseOk: boolean, payload: unknown): PinRotationPublicOperation | null {
  const value = safeRecord(payload);
  if (!responseOk || !value || value.ok !== true || value.status !== "prepared" ||
      !isListedSecretId(value.rotationId) || !isListedSecretId(value.operationId) ||
      typeof value.expiresInSeconds !== "number" || !Number.isInteger(value.expiresInSeconds) ||
      value.expiresInSeconds < 1 || value.expiresInSeconds > 300) return null;
  return { rotationId: value.rotationId, operationId: value.operationId, expiresInSeconds: value.expiresInSeconds };
}

export function matchesAuthorizedRotation(
  responseOk: boolean,
  payload: unknown,
  expected: { rotationId: string; operationId: string },
): boolean {
  const value = safeRecord(payload);
  return Boolean(responseOk && value && value.ok === true && value.status === "authorized" &&
    value.rotationId === expected.rotationId && value.operationId === expected.operationId);
}

export function isConfirmedPinRotation(responseOk: boolean, payload: unknown): boolean {
  const value = safeRecord(payload);
  // Anything except explicit confirmation requires manual reconciliation and NO replay.
  return Boolean(responseOk && value && value.ok === true && value.status === "completed");
}
