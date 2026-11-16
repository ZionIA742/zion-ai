export type AppointmentCreateDraft = {
  title: string;
  appointmentType: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  customerName: string;
  customerPhone: string;
  addressText: string;
  notes: string;
  leadId: string;
  conversationId: string;
  commercialOpportunityId: string;
};

export type AppointmentCreateOperation = { fingerprint: string; key: string };

export type AppointmentCreateRequest = {
  attemptId: number;
  dialogGeneration: number;
  fingerprint: string;
  operationKey: string;
  userId: string;
  sessionGeneration: number;
};

export type AppointmentCreateRecoveryState = "pending" | "uncertain";

export type PersistedAppointmentCreateOperation = {
  version: 1;
  operationKey: string;
  fingerprint: string;
  organizationId: string;
  storeId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  state: AppointmentCreateRecoveryState;
  draft: AppointmentCreateDraft;
};

export interface AppointmentCreateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const APPOINTMENT_CREATE_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const APPOINTMENT_CREATE_STORAGE_PREFIX = "zion:schedule:appointment-create:v1:";

export function retainAppointmentCreateOperation(
  current: AppointmentCreateOperation | null,
  fingerprint: string,
  createKey: () => string,
): AppointmentCreateOperation {
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: createKey() };
}

export function isCurrentAppointmentCreateRequest(
  request: AppointmentCreateRequest,
  currentAttemptId: number,
  currentDialogGeneration: number,
): boolean {
  return request.attemptId === currentAttemptId && request.dialogGeneration === currentDialogGeneration;
}

export function isSameAppointmentCreateRequest(
  left: AppointmentCreateRequest | null | undefined,
  right: AppointmentCreateRequest | null | undefined,
): boolean {
  return Boolean(
    left && right &&
      left.attemptId === right.attemptId &&
      left.dialogGeneration === right.dialogGeneration &&
      left.fingerprint === right.fingerprint &&
      left.operationKey === right.operationKey &&
      left.userId === right.userId &&
      left.sessionGeneration === right.sessionGeneration,
  );
}

export function shouldPreserveActiveAppointmentCreateRecovery(
  responseRequest: AppointmentCreateRequest,
  activeRequest: AppointmentCreateRequest | null | undefined,
): boolean {
  return Boolean(
    activeRequest &&
      !isSameAppointmentCreateRequest(responseRequest, activeRequest) &&
      responseRequest.operationKey === activeRequest.operationKey &&
      responseRequest.fingerprint === activeRequest.fingerprint &&
      responseRequest.userId === activeRequest.userId &&
      responseRequest.sessionGeneration === activeRequest.sessionGeneration,
  );
}

export function appointmentCreateStorageKey(userId: string, organizationId: string, storeId: string): string {
  return `${APPOINTMENT_CREATE_STORAGE_PREFIX}${userId}:${organizationId}:${storeId}`;
}

export type AppointmentCreateStorageStatus = "available" | "unavailable" | "corrupt";

export type AppointmentCreateSessionIdentity = {
  userId: string | null;
  organizationId: string | null;
  storeId: string | null;
};

export type AppointmentCreateSessionFence = AppointmentCreateSessionIdentity & {
  generation: number;
  mounted: boolean;
};

export function isSameAppointmentCreateSessionIdentity(
  left: AppointmentCreateSessionIdentity,
  right: AppointmentCreateSessionIdentity,
): boolean {
  return left.userId === right.userId &&
    left.organizationId === right.organizationId &&
    left.storeId === right.storeId;
}

export function createAppointmentCreateSessionFence(
  identity: AppointmentCreateSessionIdentity = {
    userId: null,
    organizationId: null,
    storeId: null,
  },
): AppointmentCreateSessionFence {
  return { ...identity, generation: 0, mounted: true };
}

export function advanceAppointmentCreateSessionFence(
  fence: AppointmentCreateSessionFence,
  identity: AppointmentCreateSessionIdentity,
): AppointmentCreateSessionFence {
  if (
    fence.userId === identity.userId &&
    fence.organizationId === identity.organizationId &&
    fence.storeId === identity.storeId
  ) return fence;
  fence.userId = identity.userId;
  fence.organizationId = identity.organizationId;
  fence.storeId = identity.storeId;
  fence.generation += 1;
  return fence;
}

export function captureAppointmentCreateSessionFence(
  fence: AppointmentCreateSessionFence,
): AppointmentCreateSessionFence {
  return { ...fence };
}

export function invalidateAppointmentCreateSessionFence(
  fence: AppointmentCreateSessionFence,
): void {
  fence.generation += 1;
  fence.mounted = false;
}

export function isCurrentAppointmentCreateSessionFence(
  fence: AppointmentCreateSessionFence,
  snapshot: AppointmentCreateSessionFence,
): boolean {
  return Boolean(
    fence.mounted &&
      snapshot.mounted &&
      fence.generation === snapshot.generation &&
      fence.userId === snapshot.userId &&
      fence.organizationId === snapshot.organizationId &&
      fence.storeId === snapshot.storeId,
  );
}

export function isCurrentAppointmentCreateAuthRead(
  fence: AppointmentCreateSessionFence,
  snapshot: AppointmentCreateSessionFence,
  authUserId: string | null,
  sessionUserId: string | null,
  scope: Pick<AppointmentCreateSessionIdentity, "organizationId" | "storeId">,
): boolean {
  return Boolean(
    authUserId &&
      authUserId === sessionUserId &&
      fence.mounted &&
      fence.organizationId === scope.organizationId &&
      fence.storeId === scope.storeId &&
      isCurrentAppointmentCreateSessionFence(fence, snapshot),
  );
}

export function isCurrentAppointmentCreateRequestAtSession(
  request: AppointmentCreateRequest,
  currentAttemptId: number,
  currentDialogGeneration: number,
  fence: AppointmentCreateSessionFence,
  sessionSnapshot: AppointmentCreateSessionFence,
): boolean {
  return isCurrentAppointmentCreateRequest(
    request,
    currentAttemptId,
    currentDialogGeneration,
  ) && isCurrentAppointmentCreateSessionFence(fence, sessionSnapshot);
}

export function isCurrentAppointmentCreateRecoveryScope(
  record: Pick<PersistedAppointmentCreateOperation, "userId" | "organizationId" | "storeId">,
  scope: AppointmentCreateSessionIdentity,
  fence: AppointmentCreateSessionFence,
  sessionSnapshot: AppointmentCreateSessionFence,
): boolean {
  return isCurrentAppointmentCreateSessionFence(fence, sessionSnapshot) &&
    record.userId === scope.userId &&
    record.organizationId === scope.organizationId &&
    record.storeId === scope.storeId;
}

function isDraft(value: unknown): value is AppointmentCreateDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return [
    "title", "appointmentType", "status", "scheduledStart", "scheduledEnd",
    "customerName", "customerPhone", "addressText", "notes", "leadId",
    "conversationId", "commercialOpportunityId",
  ].every((key) => typeof draft[key] === "string");
}

function isPersistedOperation(value: unknown): value is PersistedAppointmentCreateOperation {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 && typeof record.operationKey === "string" && record.operationKey.trim().length > 0 &&
    typeof record.fingerprint === "string" && typeof record.organizationId === "string" &&
    typeof record.storeId === "string" && typeof record.userId === "string" &&
    typeof record.createdAt === "number" && typeof record.expiresAt === "number" &&
    (record.state === "pending" || record.state === "uncertain") && isDraft(record.draft)
  );
}

export function readAppointmentCreateRecoveries(
  storage: AppointmentCreateStorage | null,
  scope: { userId: string; organizationId: string; storeId: string },
  now = Date.now(),
): PersistedAppointmentCreateOperation[] {
  if (!storage || !scope.userId || !scope.organizationId || !scope.storeId) return [];
  try {
    const raw = storage.getItem(appointmentCreateStorageKey(scope.userId, scope.organizationId, scope.storeId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedOperation).filter((record) =>
      record.userId === scope.userId && record.organizationId === scope.organizationId &&
      record.storeId === scope.storeId && record.expiresAt > now
    ).sort((left, right) => right.createdAt - left.createdAt);
  } catch {
    return [];
  }
}

export function persistAppointmentCreateRecovery(
  storage: AppointmentCreateStorage | null,
  record: PersistedAppointmentCreateOperation,
): boolean {
  if (!storage) return false;
  try {
    const key = appointmentCreateStorageKey(record.userId, record.organizationId, record.storeId);
    const existing = readAppointmentCreateRecoveries(storage, record, record.createdAt);
    const next = [record, ...existing.filter((item) => item.operationKey !== record.operationKey)];
    storage.setItem(key, JSON.stringify(next));
    return readAppointmentCreateRecoveries(storage, record, Date.now()).some(
      (item) => item.operationKey === record.operationKey && item.fingerprint === record.fingerprint,
    );
  } catch {
    // sessionStorage is best effort; the server-side operation key remains authoritative.
    return false;
  }
}

export function inspectAppointmentCreateStorage(
  storage: AppointmentCreateStorage | null,
  scope: { userId: string; organizationId: string; storeId: string },
): AppointmentCreateStorageStatus {
  if (!storage) return "unavailable";
  try {
    const raw = storage.getItem(appointmentCreateStorageKey(scope.userId, scope.organizationId, scope.storeId));
    if (raw === null) return "available";
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isPersistedOperation) ? "available" : "corrupt";
  } catch {
    return "corrupt";
  }
}

export function removeAppointmentCreateRecovery(
  storage: AppointmentCreateStorage | null,
  scope: { userId: string; organizationId: string; storeId: string },
  operationKey: string,
): void {
  if (!storage) return;
  try {
    const key = appointmentCreateStorageKey(scope.userId, scope.organizationId, scope.storeId);
    const next = readAppointmentCreateRecoveries(storage, scope).filter((record) => record.operationKey !== operationKey);
    if (next.length > 0) storage.setItem(key, JSON.stringify(next));
    else storage.removeItem(key);
  } catch {
    // Ignore storage failures; no remote mutation is performed here.
  }
}

export function isUnknownAppointmentCreateFailure(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const status = typeof candidate?.status === "number" ? candidate.status : null;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  return ["08000", "08001", "08003", "08006", "53300", "57014", "57P01"].includes(code) ||
    (status !== null && status >= 500) ||
    /fetch|network|timeout|timed out|connection|aborted|abort|TECHNICAL_VISIT_CREATE_UNAVAILABLE/i.test(message);
}

export const UNKNOWN_APPOINTMENT_CREATE_MESSAGE =
  "Resultado do agendamento desconhecido. A tentativa foi preservada para retry seguro com a mesma operation_key; revise o formulario e tente novamente, ou descarte a tentativa para iniciar um novo agendamento.";

export const APPOINTMENT_CREATE_STORAGE_UNAVAILABLE_MESSAGE =
  "O armazenamento seguro desta sessao esta indisponivel ou corrompido. Nenhuma requisicao foi enviada; feche e reabra o painel ou corrija o armazenamento do navegador antes de tentar novamente.";

export const APPOINTMENT_CREATE_AUTH_UNAVAILABLE_MESSAGE =
  "Nao foi possivel confirmar a sessao atual. Nenhuma requisicao foi enviada; confirme seu login e tente novamente.";
