import { strict as assert } from "node:assert";
import test from "node:test";
import {
  isCurrentAppointmentCreateRequest,
  isCurrentAppointmentCreateRequestAtSession,
  isCurrentAppointmentCreateRecoveryScope,
  isCurrentAppointmentCreateAuthRead,
  advanceAppointmentCreateSessionFence,
  captureAppointmentCreateSessionFence,
  createAppointmentCreateSessionFence,
  invalidateAppointmentCreateSessionFence,
  isCurrentAppointmentCreateSessionFence,
  isSameAppointmentCreateRequest,
  isUnknownAppointmentCreateFailure,
  appointmentCreateStorageKey,
  inspectAppointmentCreateStorage,
  persistAppointmentCreateRecovery,
  readAppointmentCreateRecoveries,
  removeAppointmentCreateRecovery,
  retainAppointmentCreateOperation,
  shouldPreserveActiveAppointmentCreateRecovery,
  type AppointmentCreateStorage,
  type PersistedAppointmentCreateOperation,
  UNKNOWN_APPOINTMENT_CREATE_MESSAGE,
  type AppointmentCreateRequest,
} from "./appointment-create-operation";

const fingerprintA = "common:tenant-a:2026-11-20T12:00:00Z";
const fingerprintB = "common:tenant-a:2026-11-20T13:00:00Z";
const draft = {
  title: "Compromisso",
  appointmentType: "meeting",
  status: "scheduled",
  scheduledStart: "2026-11-20T09:00",
  scheduledEnd: "2026-11-20T10:00",
  customerName: "Cliente",
  customerPhone: "11999999999",
  addressText: "Rua A",
  notes: "Nota",
  leadId: "lead-a",
  conversationId: "conversation-a",
  commercialOpportunityId: "",
};

function memoryStorage(): AppointmentCreateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function request(overrides: Partial<AppointmentCreateRequest> = {}): AppointmentCreateRequest {
  return {
    attemptId: 1,
    dialogGeneration: 1,
    fingerprint: fingerprintA,
    operationKey: "panel:schedule:operation-a",
    userId: "user-a",
    sessionGeneration: 1,
    ...overrides,
  };
}

test("discards a stale getUser(A) result after login B", async () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  let resolveUser!: (userId: string) => void;
  const pendingUser = new Promise<string>((resolve) => { resolveUser = resolve; });
  const readFence = captureAppointmentCreateSessionFence(fence);

  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });
  resolveUser("user-a");
  await pendingUser;

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, readFence), false);
  assert.equal(fence.userId, "user-b");
});

test("rejects getUser(A) when the independently read session is already B", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const snapshot = captureAppointmentCreateSessionFence(fence);

  assert.equal(
    isCurrentAppointmentCreateAuthRead(
      fence,
      snapshot,
      "user-a",
      "user-b",
      { organizationId: "org-a", storeId: "store-a" },
    ),
    false,
  );
});

test("conversation await invalidates the captured tenant and store scope", async () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const beforeConversation = captureAppointmentCreateSessionFence(fence);
  await Promise.resolve();
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-a", organizationId: "org-b", storeId: "store-b",
  });

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, beforeConversation), false);
});

test("load completion cannot mutate a newer request after the session fence changes", async () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const completionFence = captureAppointmentCreateSessionFence(fence);
  await Promise.resolve();
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, completionFence), false);
});

test("stale catch cannot be promoted to the current attempt", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const requestA = request({ sessionGeneration: fence.generation });
  const fenceA = captureAppointmentCreateSessionFence(fence);
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });

  assert.equal(
    isCurrentAppointmentCreateRequestAtSession(requestA, 1, 1, fence, fenceA),
    false,
  );
});

test("A to B to A does not revive the first session generation", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const firstA = captureAppointmentCreateSessionFence(fence);
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, firstA), false);
  assert.equal(fence.userId, "user-a");
  assert.equal(fence.generation, firstA.generation + 2);
});

test("fencing immediately before send rejects a session change", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const sendFence = captureAppointmentCreateSessionFence(fence);
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, sendFence), false);
});

test("catch de tentativa antiga nao pode alterar a sessao atual", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const requestA = request({ sessionGeneration: fence.generation });
  const fenceA = captureAppointmentCreateSessionFence(fence);

  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-b", storeId: "store-b",
  });

  assert.equal(
    isCurrentAppointmentCreateRequestAtSession(requestA, 1, 1, fence, fenceA),
    false,
  );
});

test("troca de tenant ou loja invalida request mesmo com o mesmo usuario", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const requestA = request({ sessionGeneration: fence.generation });
  const fenceA = captureAppointmentCreateSessionFence(fence);

  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-a", organizationId: "org-b", storeId: "store-b",
  });

  assert.equal(
    isCurrentAppointmentCreateRequestAtSession(requestA, 1, 1, fence, fenceA),
    false,
  );
});

test("restauracao A->B->A nao aceita callback antigo da primeira sessao", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const firstRead = captureAppointmentCreateSessionFence(fence);
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  });
  advanceAppointmentCreateSessionFence(fence, {
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });

  assert.equal(isCurrentAppointmentCreateSessionFence(fence, firstRead), false);
  assert.equal(
    isCurrentAppointmentCreateRecoveryScope(
      { userId: "user-a", organizationId: "org-a", storeId: "store-a" },
      { userId: "user-a", organizationId: "org-a", storeId: "store-a" },
      fence,
      firstRead,
    ),
    false,
  );
});

test("descarte so e valido para o escopo e fence atuais", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const snapshot = captureAppointmentCreateSessionFence(fence);
  assert.equal(
    isCurrentAppointmentCreateRecoveryScope(
      { userId: "user-a", organizationId: "org-a", storeId: "store-a" },
      { userId: "user-a", organizationId: "org-a", storeId: "store-a" },
      fence,
      snapshot,
    ),
    true,
  );
  assert.equal(
    isCurrentAppointmentCreateRecoveryScope(
      { userId: "user-a", organizationId: "org-a", storeId: "store-a" },
      { userId: "user-b", organizationId: "org-a", storeId: "store-a" },
      fence,
      snapshot,
    ),
    false,
  );
});

test("unmount invalidates pending authentication callbacks", () => {
  const fence = createAppointmentCreateSessionFence({
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  });
  const snapshot = captureAppointmentCreateSessionFence(fence);
  invalidateAppointmentCreateSessionFence(fence);
  assert.equal(isCurrentAppointmentCreateSessionFence(fence, snapshot), false);
});

test("preserves the same operation key after close and reopen for common appointments", () => {
  const first = retainAppointmentCreateOperation(null, fingerprintA, () => "key-a");
  const reopened = retainAppointmentCreateOperation(first, fingerprintA, () => "key-b");

  assert.deepEqual(reopened, first);
});

test("preserves the same operation key after a lost technical-visit response", () => {
  const first = retainAppointmentCreateOperation(null, fingerprintA.replace("common", "technical"), () => "key-a");
  const retry = retainAppointmentCreateOperation(first, first.fingerprint, () => "key-b");

  assert.equal(retry.key, "key-a");
});

test("creates a new key when the payload changes or a new appointment is legitimate", () => {
  const first = retainAppointmentCreateOperation(null, fingerprintA, () => "key-a");
  const changed = retainAppointmentCreateOperation(first, fingerprintB, () => "key-b");
  const newAppointment = retainAppointmentCreateOperation(null, fingerprintA, () => "key-c");

  assert.equal(changed.key, "key-b");
  assert.equal(newAppointment.key, "key-c");
});

test("rejects late responses from a closed dialog and accepts the current retry", () => {
  const oldRequest = request({ attemptId: 1, dialogGeneration: 1 });
  const currentRetry = request({ attemptId: 2, dialogGeneration: 3 });

  assert.equal(isCurrentAppointmentCreateRequest(oldRequest, 2, 3), false);
  assert.equal(isCurrentAppointmentCreateRequest(currentRetry, 2, 3), true);
  assert.equal(isSameAppointmentCreateRequest(oldRequest, currentRetry), false);
  assert.equal(shouldPreserveActiveAppointmentCreateRecovery(oldRequest, currentRetry), true);
  assert.equal(
    shouldPreserveActiveAppointmentCreateRecovery(
      oldRequest,
      { ...currentRetry, userId: "user-b" },
    ),
    false,
  );
  assert.equal(
    shouldPreserveActiveAppointmentCreateRecovery(
      request({ attemptId: 1, dialogGeneration: 1 }),
      request({ attemptId: 2, dialogGeneration: 1, operationKey: "operation-b" }),
    ),
    false,
  );
});

test("classifies network and timeout failures as recoverable unknown outcomes", () => {
  assert.equal(isUnknownAppointmentCreateFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isUnknownAppointmentCreateFailure({ code: "57014", message: "statement timeout" }), true);
  assert.equal(UNKNOWN_APPOINTMENT_CREATE_MESSAGE.includes("mesma operation_key"), true);
  assert.equal(isUnknownAppointmentCreateFailure({ code: "23514", message: "validation failed" }), false);
});

test("persists before request and restores only the exact authenticated tenant scope", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const record: PersistedAppointmentCreateOperation = {
    version: 1,
    operationKey: "panel:schedule:operation-a",
    fingerprint: fingerprintA,
    organizationId: "org-a",
    storeId: "store-a",
    userId: "user-a",
    createdAt: now,
    expiresAt: now + 5000,
    state: "pending",
    draft,
  };

  assert.equal(persistAppointmentCreateRecovery(storage, record), true);
  assert.equal(storage.getItem(appointmentCreateStorageKey("user-a", "org-a", "store-a")) !== null, true);
  assert.equal(readAppointmentCreateRecoveries(storage, { userId: "user-a", organizationId: "org-a", storeId: "store-a" }, now + 2000).length, 1);
  assert.equal(readAppointmentCreateRecoveries(storage, { userId: "user-b", organizationId: "org-a", storeId: "store-a" }, now + 2000).length, 0);
  assert.equal(readAppointmentCreateRecoveries(storage, { userId: "user-a", organizationId: "org-b", storeId: "store-a" }, now + 2000).length, 0);
});

test("detects unavailable and corrupted storage without treating it as safe", () => {
  const unavailable: AppointmentCreateStorage | null = null;
  const storage = memoryStorage();
  const scope = { userId: "user-a", organizationId: "org-a", storeId: "store-a" };

  assert.equal(inspectAppointmentCreateStorage(unavailable, scope), "unavailable");
  storage.setItem(appointmentCreateStorageKey(scope.userId, scope.organizationId, scope.storeId), "not-json");
  assert.equal(inspectAppointmentCreateStorage(storage, scope), "corrupt");
  assert.equal(persistAppointmentCreateRecovery(unavailable, {
    version: 1,
    operationKey: "key-unavailable",
    fingerprint: fingerprintA,
    ...scope,
    createdAt: 1000,
    expiresAt: 5000,
    state: "pending",
    draft,
  }), false);
});

test("keeps same-key recovery isolated when the authenticated user changes", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const recordA: PersistedAppointmentCreateOperation = {
    version: 1,
    operationKey: "shared-looking-key",
    fingerprint: fingerprintA,
    organizationId: "org-a",
    storeId: "store-a",
    userId: "user-a",
    createdAt: now,
    expiresAt: now + 5000,
    state: "uncertain",
    draft,
  };

  persistAppointmentCreateRecovery(storage, recordA);
  assert.equal(readAppointmentCreateRecoveries(storage, {
    userId: "user-b", organizationId: "org-a", storeId: "store-a",
  }, now).length, 0);
  assert.equal(readAppointmentCreateRecoveries(storage, {
    userId: "user-a", organizationId: "org-a", storeId: "store-a",
  }, now).length, 1);
  assert.equal(
    shouldPreserveActiveAppointmentCreateRecovery(
      request({ userId: "user-a", operationKey: recordA.operationKey }),
      request({ userId: "user-b", operationKey: recordA.operationKey }),
    ),
    false,
  );
});

test("keeps old uncertain operations separate and expires/removes recovery records", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const base: PersistedAppointmentCreateOperation = {
    version: 1,
    operationKey: "key-a",
    fingerprint: fingerprintA,
    organizationId: "org-a",
    storeId: "store-a",
    userId: "user-a",
    createdAt: now,
    expiresAt: now + 5000,
    state: "uncertain",
    draft,
  };
  const next = { ...base, operationKey: "key-b", fingerprint: fingerprintB, createdAt: now + 1000 };

  persistAppointmentCreateRecovery(storage, base);
  persistAppointmentCreateRecovery(storage, next);
  assert.deepEqual(
    readAppointmentCreateRecoveries(storage, { userId: "user-a", organizationId: "org-a", storeId: "store-a" }, now + 2000).map((item) => item.operationKey),
    ["key-b", "key-a"],
  );
  assert.equal(readAppointmentCreateRecoveries(storage, { userId: "user-a", organizationId: "org-a", storeId: "store-a" }, now + 5000).length, 0);
  removeAppointmentCreateRecovery(storage, { userId: "user-a", organizationId: "org-a", storeId: "store-a" }, "key-b");
  assert.equal(readAppointmentCreateRecoveries(storage, { userId: "user-a", organizationId: "org-a", storeId: "store-a" }, now + 2000).length, 1);
});

process.stdout.write("appointment-create-operation tests passed\n");
