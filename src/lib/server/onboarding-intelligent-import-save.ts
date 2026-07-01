import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  type IntelligentImportGlobalReviewConfirmation,
  type IntelligentImportSelectedMediaAssociationMode,
  type IntelligentImportSelectedMediaRef,
  type IntelligentImportSelectedMediaSourceKind,
  type IntelligentImportReviewedDestination,
  type IntelligentImportReviewedPoolPayload,
  type IntelligentImportReviewedSaveItem,
  type IntelligentImportSaveApprovedConflict,
  type IntelligentImportSaveApprovedImportFilePlan,
  type IntelligentImportSaveApprovedNormalizedPayload,
  type IntelligentImportSaveApprovedPhotoPlan,
  type IntelligentImportSaveApprovedPhotoSaveResult,
  type IntelligentImportSaveApprovedRequest,
  type IntelligentImportSaveApprovedResponse,
  type IntelligentImportSaveApprovedResultItem,
  type IntelligentImportStructuredReviewSnapshot,
  type IntelligentImportStructuredReviewSnapshotEntry,
} from "@/lib/onboarding-intelligent-import-save-contract";
import {
  normalizeImportDedupSku,
  normalizeImportDedupText,
} from "@/lib/onboarding-import-dedup-identity";

type MembershipRow = {
  organization_id: string;
};

type AuthorizedStoreRow = {
  id: string;
  name: string;
  organization_id: string;
};

type ExistingCatalogItemRow = {
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string | null;
  sku: string | null;
};

type ExistingPoolRow = {
  id: string;
  name: string | null;
};

type ImportedFileRow = {
  id: string;
  original_file_name: string | null;
  status: string | null;
};

type StagedMediaAssetRow = {
  association_strength: string | null;
  expires_at?: string | null;
  id: string;
  import_batch_id: string | null;
  import_file_id: string | null;
  metadata?: Record<string, unknown> | null;
  normalized_mime_type?: string | null;
  original_mime_type?: string | null;
  file_name?: string | null;
  requires_user_confirmation: boolean | null;
  sheet_scoped_key: string | null;
  size_bytes?: number | null;
  source_file_name: string | null;
  source_kind: string | null;
  source_location_key: string | null;
  status: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  worksheet_row_number: number | null;
};

type SaveValidationContext = {
  existingCatalogItems: ExistingCatalogItemRow[];
  existingPoolRows: ExistingPoolRow[];
  request: IntelligentImportSaveApprovedRequest;
};

type ImportFileValidationResult = {
  invalidImportedFileIds: string[];
  receivedImportedFileIds: string[];
  validatedFiles: ImportedFileRow[];
  validatedFilesById: Map<string, ImportedFileRow>;
  validatedFilesByName: Map<string, ImportedFileRow[]>;
  warnings: string[];
};

type StagedMediaValidationResult = {
  expiredAssetsById: Map<string, StagedMediaAssetRow>;
  invalidExpiryAssetsById: Map<string, StagedMediaAssetRow>;
  receivedStagingAssetIds: string[];
  validatedAssets: StagedMediaAssetRow[];
  validatedAssetsById: Map<string, StagedMediaAssetRow>;
  warnings: string[];
};

type PhotoPlanMatchMode = "clientItemId" | "fallback";

type PhotoPlanClassification =
  | "planned"
  | "blocked"
  | "unlinked";

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export class IntelligentImportSaveAccessError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function uniqueOrganizationIds(rows: MembershipRow[]) {
  return Array.from(
    new Set(rows.map((row) => String(row.organization_id || "").trim()).filter(Boolean))
  );
}

async function authenticateIntelligentImportSaveRequest() {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    throw new IntelligentImportSaveAccessError(401, "UNAUTHENTICATED", "Usuario nao autenticado.");
  }

  const { data: memberships, error: membershipError } = await sessionSupabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw new IntelligentImportSaveAccessError(
      500,
      "LOAD_MEMBERSHIPS_FAILED",
      membershipError.message
    );
  }

  const organizationIds = uniqueOrganizationIds((memberships ?? []) as MembershipRow[]);
  if (organizationIds.length === 0) {
    throw new IntelligentImportSaveAccessError(
      403,
      "NO_ORGANIZATION_ACCESS",
      "Usuario sem acesso a organizacoes."
    );
  }

  return {
    organizationIds,
    sessionSupabase,
    user,
  };
}

async function loadAuthorizedStore(args: {
  organizationIds: string[];
  requestOrganizationId: string;
  requestStoreId: string;
  supabase: any;
}) {
  const requestStoreId = String(args.requestStoreId || "").trim();
  const requestOrganizationId = String(args.requestOrganizationId || "").trim();

  if (!requestOrganizationId) {
    throw new IntelligentImportSaveAccessError(
      400,
      "INVALID_ORGANIZATION_ID",
      "organizationId obrigatorio."
    );
  }

  if (!requestStoreId) {
    throw new IntelligentImportSaveAccessError(400, "INVALID_STORE_ID", "storeId obrigatorio.");
  }

  const { data: store, error: storeError } = await args.supabase
    .from("stores")
    .select("id, organization_id, name")
    .eq("id", requestStoreId)
    .in("organization_id", args.organizationIds)
    .maybeSingle();

  if (storeError) {
    throw new IntelligentImportSaveAccessError(500, "LOAD_STORE_FAILED", storeError.message);
  }

  if (!store) {
    throw new IntelligentImportSaveAccessError(
      403,
      "STORE_FORBIDDEN",
      "Loja nao encontrada ou fora do escopo do usuario."
    );
  }

  if (String(store.organization_id || "").trim() !== requestOrganizationId) {
    throw new IntelligentImportSaveAccessError(
      403,
      "ORGANIZATION_STORE_MISMATCH",
      "A organizacao informada nao corresponde a loja selecionada."
    );
  }

  return store as AuthorizedStoreRow;
}

function normalizeDestination(value: string | null | undefined): IntelligentImportReviewedDestination | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "pool") return "pool";
  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";
  if (normalized === "outros") return "outros";
  return null;
}

function normalizeDescription(value: string | null | undefined) {
  const cleaned = String(value || "").replace(/\r/g, "").trim();
  return cleaned ? cleaned.slice(0, 4000) : null;
}

function normalizeLoose(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFileLikeName(value: string | null | undefined) {
  return normalizeLoose(String(value || "").replace(/\.[^.]+$/g, "").trim());
}

function matchesSourceFileNameTolerantly(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeFileLikeName(left);
  const normalizedRight = normalizeFileLikeName(right);
  if (!normalizedLeft || !normalizedRight) return true;
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function sanitizePhotoFileName(fileName: string | null | undefined) {
  return String(fileName || "foto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120) || "foto";
}

function getPhotoFileExtension(fileName: string | null | undefined, mimeType: string | null | undefined) {
  const byName = String(fileName || "").trim().split(".").pop()?.toLowerCase();
  if (byName) return byName;
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  if (normalizedMimeType.includes("png")) return "png";
  if (normalizedMimeType.includes("webp")) return "webp";
  if (normalizedMimeType.includes("gif")) return "gif";
  if (normalizedMimeType.includes("bmp")) return "bmp";
  return "jpg";
}

function buildFinalPoolPhotoPath(args: {
  organizationId: string;
  storeId: string;
  poolId: string;
  sortOrder: number;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  return `${args.organizationId}/${args.storeId}/${args.poolId}/${Date.now()}-${args.sortOrder}.${getPhotoFileExtension(
    args.fileName,
    args.mimeType
  )}`;
}

function buildFinalCatalogPhotoPath(args: {
  organizationId: string;
  storeId: string;
  catalogItemId: string;
  sortOrder: number;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  return `${args.organizationId}/${args.storeId}/${args.catalogItemId}/${Date.now()}-${args.sortOrder}.${getPhotoFileExtension(
    args.fileName,
    args.mimeType
  )}`;
}

function normalizeMetadata(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

type NormalizedStructuredReviewSnapshot = {
  entries: IntelligentImportStructuredReviewSnapshotEntry[];
  kind: "structured_review_v1";
  revisionVersion: number | null;
};

type StructuredReviewAuditValidation = {
  globalReviewConfirmation: IntelligentImportGlobalReviewConfirmation;
  persistedImportFileIds: string[];
  snapshot: NormalizedStructuredReviewSnapshot;
  summary: IntelligentImportGlobalReviewConfirmation["summary"];
};

type ImportFileAuditPersistenceResult = {
  attempted: boolean;
  error?: string | null;
  persisted: boolean;
  skippedReason?: string | null;
  updatedImportFileIds: string[];
  validateOnly: boolean;
};

function computeStableReviewHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildStructuredReviewFinalFingerprint(item: IntelligentImportReviewedSaveItem) {
  const serialized = JSON.stringify({
    clientItemId: String(item.clientItemId || "").trim(),
    description: String(item.description || "").trim(),
    destination: item.destination,
    isActive: Boolean(item.isActive),
    name: String(item.name || "").trim(),
    poolPayload: item.poolPayload
      ? {
          depth_m: item.poolPayload.depth_m ?? null,
          length_m: item.poolPayload.length_m ?? null,
          material: item.poolPayload.material ?? null,
          max_capacity_l: item.poolPayload.max_capacity_l ?? null,
          price: item.poolPayload.price ?? null,
          shape: item.poolPayload.shape ?? null,
          weight_kg: item.poolPayload.weight_kg ?? null,
          width_m: item.poolPayload.width_m ?? null,
        }
      : null,
    priceCents: item.priceCents ?? null,
    reviewRequired: Boolean(item.reviewRequired),
    sku: String(item.sku || "").trim(),
    stockQuantity: Number(item.stockQuantity || 0),
    trackStock: Boolean(item.trackStock),
  });
  return `structured-final-v1:${computeStableReviewHash(serialized)}`;
}

function buildStructuredReviewSnapshotSignature(
  entries: IntelligentImportStructuredReviewSnapshotEntry[]
) {
  const serialized = entries
    .slice()
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey))
    .map((entry) => [
      entry.candidateKey,
      entry.state,
      entry.finalCategory,
      entry.reviewRequired ? "1" : "0",
      entry.humanReviewConfirmed ? "1" : "0",
      entry.finalFingerprint,
    ]);
  return `structured-review-v1:${computeStableReviewHash(JSON.stringify(serialized))}:${serialized.length}`;
}

function normalizeGlobalReviewConfirmation(
  value: unknown
): IntelligentImportGlobalReviewConfirmation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.confirmed !== true) return null;

  const confirmedAt = String(candidate.confirmedAt || "").trim();
  const confirmedAtMs = parseIsoTimestamp(confirmedAt);
  if (!confirmedAt || confirmedAtMs == null) return null;

  const rawSummary =
    candidate.summary && typeof candidate.summary === "object" && !Array.isArray(candidate.summary)
      ? (candidate.summary as Record<string, unknown>)
      : null;
  if (!rawSummary) return null;

  const toCount = (input: unknown) => {
    const value = Number(input);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.max(0, Math.round(value));
  };

  const reviewStateSignature = String(candidate.reviewStateSignature || "").trim() || null;
  const rawRevisionVersion = Number(candidate.revisionVersion);
  const revisionVersion = Number.isFinite(rawRevisionVersion) ? Math.round(rawRevisionVersion) : null;

  return {
    confirmed: true,
    confirmedAt: new Date(confirmedAtMs).toISOString(),
    reviewStateSignature,
    revisionVersion,
    summary: {
      deselectedCount: toCount(rawSummary.deselectedCount),
      foundCount: toCount(rawSummary.foundCount),
      ignoredCount: toCount(rawSummary.ignoredCount),
      selectedCount: toCount(rawSummary.selectedCount),
    },
  };
}

function normalizeStructuredReviewSnapshot(
  value: unknown
): NormalizedStructuredReviewSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "structured_review_v1") return null;
  if (!Array.isArray(candidate.entries)) return null;
  const rawRevisionVersion = Number(candidate.revisionVersion);
  const revisionVersion = Number.isFinite(rawRevisionVersion) ? Math.round(rawRevisionVersion) : null;
  const entries: IntelligentImportStructuredReviewSnapshotEntry[] = [];
  const seenCandidateKeys = new Set<string>();

  for (const rawEntry of candidate.entries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;
    const entry = rawEntry as Record<string, unknown>;
    const candidateKey = String(entry.candidateKey || "").trim();
    const finalCategory = String(entry.finalCategory || "").trim() as IntelligentImportReviewedDestination;
    const finalFingerprint = String(entry.finalFingerprint || "").trim();
    const state = String(entry.state || "").trim();
    if (!candidateKey || !finalFingerprint) return null;
    if (!["selected", "deselected", "ignored"].includes(state)) return null;
    if (!["pool", "quimicos", "acessorios", "outros"].includes(finalCategory)) return null;
    if (seenCandidateKeys.has(candidateKey)) return null;
    seenCandidateKeys.add(candidateKey);
    entries.push({
      candidateKey,
      finalCategory,
      finalFingerprint,
      humanReviewConfirmed: Boolean(entry.humanReviewConfirmed),
      reviewRequired: Boolean(entry.reviewRequired),
      state: state as IntelligentImportStructuredReviewSnapshotEntry["state"],
    });
  }

  if (entries.length === 0) return null;
  return {
    entries,
    kind: "structured_review_v1",
    revisionVersion,
  };
}

function parseIsoTimestamp(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getExpiryState(
  value: string | null | undefined,
  now: number
): { kind: "absent" | "future" | "past" | "invalid"; parsedAtMs: number | null } {
  if (value == null) {
    return {
      kind: "absent",
      parsedAtMs: null,
    };
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return {
      kind: "invalid",
      parsedAtMs: null,
    };
  }

  const parsedAtMs = parseIsoTimestamp(normalized);
  if (parsedAtMs == null) {
    return {
      kind: "invalid",
      parsedAtMs: null,
    };
  }

  return {
    kind: parsedAtMs > now ? "future" : "past",
    parsedAtMs,
  };
}

function splitStoragePath(storagePath: string) {
  const normalized = String(storagePath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return {
      directory: "",
      fileName: "",
      normalizedPath: "",
    };
  }

  const segments = normalized.split("/");
  const fileName = segments.pop() || "";
  return {
    directory: segments.join("/"),
    fileName,
    normalizedPath: normalized,
  };
}

async function checkStorageObjectExists(args: {
  storageBucket: string;
  storagePath: string;
  supabase: any;
}): Promise<
  | { kind: "exists" }
  | { kind: "missing" }
  | { kind: "unknown_error"; message: string }
> {
  const pathParts = splitStoragePath(args.storagePath);
  if (!args.storageBucket || !pathParts.fileName || !pathParts.normalizedPath) {
    return {
      kind: "unknown_error",
      message: "Bucket ou path do asset staged e invalido para reconciliacao de cleanup.",
    };
  }

  const { data, error } = await args.supabase.storage.from(args.storageBucket).list(pathParts.directory, {
    limit: 100,
    search: pathParts.fileName,
  });

  if (error) {
    return {
      kind: "unknown_error",
      message: error.message,
    };
  }

  const matched = Array.isArray(data)
    ? data.some((entry: { name?: string | null } | null | undefined) => {
        const entryName = String(entry?.name || "").trim();
        const candidatePath = pathParts.directory ? `${pathParts.directory}/${entryName}` : entryName;
        return entryName === pathParts.fileName && candidatePath === pathParts.normalizedPath;
      })
    : false;

  return matched ? { kind: "exists" } : { kind: "missing" };
}

function parseFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveExistingCatalogCategory(metadata: Record<string, unknown> | null | undefined) {
  const object = normalizeMetadata(metadata);
  const candidates = [
    object.reviewed_category,
    object.categoria,
    object.category,
    object.destination,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDestination(String(candidate || ""));
    if (normalized && normalized !== "pool") return normalized;
  }

  return null;
}

function buildDuplicateConflict(
  type: IntelligentImportSaveApprovedConflict["type"],
  existingId: string,
  existingName: string
): IntelligentImportSaveApprovedConflict {
  return {
    existingId,
    existingName,
    type,
  };
}

function buildCatalogNormalizedPayload(args: {
  category: "quimicos" | "acessorios" | "outros";
  item: IntelligentImportReviewedSaveItem;
}): Extract<IntelligentImportSaveApprovedNormalizedPayload, { type: "catalog_item" }> {
  return {
    category: args.category,
    currency: "BRL",
    description: normalizeDescription(args.item.description),
    destination: args.category,
    is_active: Boolean(args.item.isActive),
    metadata: normalizeMetadata(args.item.metadata),
    name: String(args.item.name || "").trim(),
    price_cents:
      typeof args.item.priceCents === "number" && Number.isFinite(args.item.priceCents)
        ? Math.round(args.item.priceCents)
        : null,
    sku: String(args.item.sku || "").trim() || null,
    stock_quantity: Math.max(0, Math.round(parseFiniteNumber(args.item.stockQuantity) ?? 0)),
    track_stock: Boolean(args.item.trackStock),
    type: "catalog_item",
  };
}

function buildPoolNormalizedPayload(args: {
  item: IntelligentImportReviewedSaveItem;
  poolPayload: IntelligentImportReviewedPoolPayload;
}): Extract<IntelligentImportSaveApprovedNormalizedPayload, { type: "pool" }> {
  const metadata = normalizeMetadata(args.item.metadata);
  const fallbackPriceCandidates = [
    args.poolPayload.price,
    metadata.reviewed_price,
    metadata.price,
    metadata.preco,
  ];
  const resolvedPrice =
    fallbackPriceCandidates
      .map((value) => parseFiniteNumber(value))
      .find((value) => value != null) ?? null;

  return {
    depth_m: parseFiniteNumber(args.poolPayload.depth_m),
    description: normalizeDescription(args.item.description),
    destination: "pool",
    is_active: Boolean(args.item.isActive),
    length_m: parseFiniteNumber(args.poolPayload.length_m),
    material: String(args.poolPayload.material || "").trim() || null,
    max_capacity_l: parseFiniteNumber(args.poolPayload.max_capacity_l),
    name: String(args.item.name || "").trim(),
    price: resolvedPrice,
    shape: String(args.poolPayload.shape || "").trim() || null,
    stock_quantity: Math.max(0, Math.round(parseFiniteNumber(args.item.stockQuantity) ?? 0)),
    track_stock: Boolean(args.item.trackStock),
    type: "pool",
    weight_kg: parseFiniteNumber(args.poolPayload.weight_kg),
    width_m: parseFiniteNumber(args.poolPayload.width_m),
  };
}

function hasExplicitHumanReviewConfirmation(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return false;
  const candidates = [
    metadata.review_confirmed_by_user,
    metadata.human_review_confirmed,
    metadata.review_confirmation_state,
  ];

  return candidates.some((value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "sim" || normalized === "yes" || normalized === "confirmed";
  });
}

function validateStructuredReviewAudit(args: {
  importFileValidation: ImportFileValidationResult;
  request: IntelligentImportSaveApprovedRequest;
}): { ok: true; value: StructuredReviewAuditValidation } | { message: string; ok: false } {
  const globalReviewConfirmation = normalizeGlobalReviewConfirmation(
    args.request.reviewAudit?.globalReviewConfirmation
  );
  if (!globalReviewConfirmation) {
    return {
      message: "global_review_confirmation_required",
      ok: false,
    };
  }

  const snapshot = normalizeStructuredReviewSnapshot(args.request.reviewAudit?.structuredReviewSnapshot);
  if (!snapshot) {
    return {
      message: "structured_review_snapshot_required",
      ok: false,
    };
  }

  if (
    snapshot.revisionVersion != null &&
    globalReviewConfirmation.revisionVersion != null &&
    snapshot.revisionVersion !== globalReviewConfirmation.revisionVersion
  ) {
    return {
      message: "RevisionVersion divergente entre a confirmacao global e o snapshot da revisao.",
      ok: false,
    };
  }

  const summary = snapshot.entries.reduce(
    (acc, entry) => {
      acc.foundCount += 1;
      if (entry.state === "selected") acc.selectedCount += 1;
      else if (entry.state === "ignored") acc.ignoredCount += 1;
      else acc.deselectedCount += 1;
      return acc;
    },
    {
      deselectedCount: 0,
      foundCount: 0,
      ignoredCount: 0,
      selectedCount: 0,
    } satisfies IntelligentImportGlobalReviewConfirmation["summary"]
  );

  if (
    summary.selectedCount !== globalReviewConfirmation.summary.selectedCount ||
    summary.deselectedCount !== globalReviewConfirmation.summary.deselectedCount ||
    summary.ignoredCount !== globalReviewConfirmation.summary.ignoredCount ||
    summary.foundCount !== globalReviewConfirmation.summary.foundCount
  ) {
    return {
      message: "Resumo da confirmacao global nao corresponde ao snapshot canonico recalculado no backend.",
      ok: false,
    };
  }

  const recalculatedSignature = buildStructuredReviewSnapshotSignature(snapshot.entries);
  if (recalculatedSignature !== globalReviewConfirmation.reviewStateSignature) {
    return {
      message: "Assinatura da confirmacao global diverge do snapshot canonico recalculado no backend.",
      ok: false,
    };
  }

  const persistedImportFileIds = args.importFileValidation.validatedFiles
    .map((row) => String(row.id || "").trim())
    .filter(Boolean);
  if (persistedImportFileIds.length === 0) {
    return {
      message: "Nenhum importedFileId valido foi recebido para auditar esta revisao estruturada.",
      ok: false,
    };
  }

  const selectedSnapshotEntries = snapshot.entries.filter((entry) => entry.state === "selected");
  if (selectedSnapshotEntries.length !== args.request.items.length) {
    return {
      message: "Quantidade de itens selecionados no snapshot nao corresponde ao payload final enviado.",
      ok: false,
    };
  }

  const requestItemByClientItemId = new Map<string, IntelligentImportReviewedSaveItem>();
  for (const item of args.request.items) {
    const clientItemId = String(item.clientItemId || "").trim();
    if (!clientItemId || requestItemByClientItemId.has(clientItemId)) {
      return {
        message: "Payload final possui clientItemId ausente ou duplicado para a revisao estruturada.",
        ok: false,
      };
    }
    requestItemByClientItemId.set(clientItemId, item);
  }

  for (const snapshotEntry of selectedSnapshotEntries) {
    const selectedItem = requestItemByClientItemId.get(snapshotEntry.candidateKey);
    if (!selectedItem) {
      return {
        message: `Item selecionado ${snapshotEntry.candidateKey} do snapshot nao foi enviado no payload final.`,
        ok: false,
      };
    }
    if (normalizeDestination(selectedItem.destination) !== snapshotEntry.finalCategory) {
      return {
        message: `Categoria final divergente para o item ${snapshotEntry.candidateKey}.`,
        ok: false,
      };
    }
    if (Boolean(selectedItem.reviewRequired) !== snapshotEntry.reviewRequired) {
      return {
        message: `Indicador reviewRequired divergente para o item ${snapshotEntry.candidateKey}.`,
        ok: false,
      };
    }
    if (hasExplicitHumanReviewConfirmation(selectedItem.metadata) !== snapshotEntry.humanReviewConfirmed) {
      return {
        message: `Confirmacao individual divergente para o item ${snapshotEntry.candidateKey}.`,
        ok: false,
      };
    }
    if (buildStructuredReviewFinalFingerprint(selectedItem) !== snapshotEntry.finalFingerprint) {
      return {
        message: `Fingerprint final divergente para o item ${snapshotEntry.candidateKey}.`,
        ok: false,
      };
    }
  }

  return {
    ok: true,
    value: {
      globalReviewConfirmation,
      persistedImportFileIds,
      snapshot,
      summary,
    },
  };
}

function validateReviewedImportedItem(
  item: IntelligentImportReviewedSaveItem,
  inputIndex: number,
  context: SaveValidationContext
): IntelligentImportSaveApprovedResultItem {
  const reasons: string[] = [];
  const destination = normalizeDestination(item.destination);
  const reviewConfirmedByUser = hasExplicitHumanReviewConfirmation(item.metadata);

  if (!item.selected) reasons.push("Item nao marcado como selecionado/aprovado.");
  if (item.reviewState !== "approved") reasons.push("Item nao esta em estado approved.");
  if (item.duplicateBlocked) reasons.push("Item marcado como duplicado/bloqueado na origem.");
  if (item.reviewRequired && !reviewConfirmedByUser) {
    reasons.push("Item ainda exige revisao antes do salvamento.");
  }
  if (!destination) reasons.push("Destino/categoria invalido.");

  const safeName = String(item.name || "").trim();
  if (!safeName) reasons.push("Nome do item obrigatorio.");

  const baseResult: IntelligentImportSaveApprovedResultItem = {
    clientItemId: String(item.clientItemId || `item-${inputIndex}`),
    destination: destination || "outros",
    inputIndex,
    normalizedPayload: null,
    reasons,
    status: "invalid",
  };

  if (!destination) {
    return baseResult;
  }

  if (destination === "pool") {
    if (!item.poolPayload) {
      reasons.push("Payload de piscina ausente.");
      return baseResult;
    }

    const normalizedPayload = buildPoolNormalizedPayload({
      item,
      poolPayload: item.poolPayload,
    });

    if (!normalizedPayload.name) reasons.push("Nome da piscina obrigatorio.");
    if (normalizedPayload.price != null && normalizedPayload.price < 0) {
      reasons.push("Preco invalido para piscina.");
    }
    if (normalizedPayload.width_m == null || normalizedPayload.length_m == null || normalizedPayload.depth_m == null) {
      reasons.push("Piscina sem medidas obrigatorias.");
    }

    const normalizedPoolName = normalizeImportDedupText(normalizedPayload.name);
    const existingPool = context.existingPoolRows.find(
      (row) => normalizeImportDedupText(row.name) === normalizedPoolName
    );

    if (existingPool) {
      return {
        ...baseResult,
        conflict: buildDuplicateConflict(
          "pool_name",
          existingPool.id,
          String(existingPool.name || normalizedPayload.name)
        ),
        normalizedPayload,
        reasons: ["Ja existe uma piscina com esse nome nesta loja."],
        status: "blocked_duplicate",
      };
    }

    if (reasons.length > 0) {
      return {
        ...baseResult,
        normalizedPayload,
      };
    }

    return {
      ...baseResult,
      normalizedPayload,
      reasons: [],
      status: "valid",
    };
  }

  const normalizedPayload = buildCatalogNormalizedPayload({
    category: destination,
    item,
  });
  const normalizedSku = normalizeImportDedupSku(normalizedPayload.sku);
  if (normalizedPayload.price_cents != null && normalizedPayload.price_cents < 0) {
    reasons.push("Preco invalido para item de catalogo.");
  }

  if (normalizedSku) {
    const existingBySku = context.existingCatalogItems.find(
      (row) => normalizeImportDedupSku(row.sku) === normalizedSku
    );
    if (existingBySku) {
      return {
        ...baseResult,
        conflict: buildDuplicateConflict(
          "sku",
          existingBySku.id,
          String(existingBySku.name || normalizedPayload.name)
        ),
        normalizedPayload,
        reasons: ["SKU ja existe no catalogo da loja."],
        status: "blocked_duplicate",
      };
    }
  }

  const normalizedName = normalizeImportDedupText(normalizedPayload.name);
  if (normalizedName) {
    const existingByName = context.existingCatalogItems.find((row) => {
      if (normalizeImportDedupText(row.name) !== normalizedName) return false;
      const rowCategory = resolveExistingCatalogCategory(row.metadata);
      return !rowCategory || rowCategory === destination;
    });

    if (existingByName) {
      return {
        ...baseResult,
        conflict: buildDuplicateConflict(
          "name",
          existingByName.id,
          String(existingByName.name || normalizedPayload.name)
        ),
        normalizedPayload,
        reasons: ["Ja existe um item com esse nome nesta loja."],
        status: "blocked_duplicate",
      };
    }
  }

  if (reasons.length > 0) {
    return {
      ...baseResult,
      normalizedPayload,
    };
  }

  return {
    ...baseResult,
    normalizedPayload,
    reasons: [],
    status: "valid",
  };
}

async function loadDuplicateReferenceData(args: {
  organizationId: string;
  storeId: string;
  supabase: any;
}) {
  const [catalogResult, poolsResult] = await Promise.all([
    args.supabase
      .from("store_catalog_items")
      .select("id, name, sku, metadata")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId),
    args.supabase
      .from("pools")
      .select("id, name")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId),
  ]);

  if (catalogResult.error) {
    throw new IntelligentImportSaveAccessError(
      500,
      "LOAD_EXISTING_CATALOG_FAILED",
      catalogResult.error.message
    );
  }

  if (poolsResult.error) {
    throw new IntelligentImportSaveAccessError(
      500,
      "LOAD_EXISTING_POOLS_FAILED",
      poolsResult.error.message
    );
  }

  return {
    existingCatalogItems: (catalogResult.data ?? []) as ExistingCatalogItemRow[],
    existingPoolRows: (poolsResult.data ?? []) as ExistingPoolRow[],
  };
}

function buildResponseMessage(response: IntelligentImportSaveApprovedResponse) {
  const invalidImportFiles = response.importFileLinkPlan?.invalidImportedFileIds.length ?? 0;
  const blockedMediaRefs = response.photoPlan?.blockedMediaRefs.length ?? 0;
  const mediaWarnings = response.photoPlan?.warnings.length ?? 0;

  if (response.validateOnly) {
    if (response.ok) {
      return `${response.summary.valid} item(ns) validos para salvar. PhotoPlan: ${response.photoPlan?.plannedFinalPhotos.length ?? 0} foto(s) planejavel(is), ${blockedMediaRefs} bloqueada(s), ${mediaWarnings} warning(s).`;
    }

    return `Validacao encontrou ${response.summary.invalid} item(ns) invalidos, ${response.summary.blockedDuplicate} duplicado(s) bloqueados, ${invalidImportFiles} importedFileId(s) invalido(s) e ${blockedMediaRefs} mediaRef(s) bloqueado(s).`;
  }

  if (response.ok) {
    const photoPlanNote =
      response.photoPlan && response.photoPlan.receivedMediaRefs.length > 0
        ? response.photoSaveResult
          ? ` Promocao de fotos: ${response.photoSaveResult.promotedPhotos.length} promovida(s), ${response.photoSaveResult.failedPhotos.length} falha(s).`
          : " PhotoPlan calculado, sem promocao de fotos finais nesta execucao."
        : "";
    return `${response.summary.saved} item(ns) salvos com sucesso.${photoPlanNote}`;
  }

  return `Salvamento bloqueado: ${response.summary.invalid} invalido(s), ${response.summary.blockedDuplicate} duplicado(s), ${invalidImportFiles} importedFileId(s) invalido(s) e ${blockedMediaRefs} mediaRef(s) bloqueado(s).`;
}

function extractSourceFileName(item: IntelligentImportReviewedSaveItem) {
  const metadata = normalizeMetadata(item.metadata);
  const candidates = [
    item.sourceFileName,
    metadata.source_file_name,
    metadata.source_file_name_original,
    metadata.original_source_file_name,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }

  return null;
}

function extractSourceLocationKey(item: IntelligentImportReviewedSaveItem) {
  const metadata = normalizeMetadata(item.metadata);
  const candidates = [
    metadata.source_location_key,
    metadata.source_sheet_scoped_key && metadata.source_file_name
      ? `${metadata.source_file_name}::${metadata.source_sheet_scoped_key}`
      : null,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }

  return null;
}

function extractSheetScopedKey(item: IntelligentImportReviewedSaveItem) {
  const metadata = normalizeMetadata(item.metadata);
  const candidates = [metadata.source_sheet_scoped_key, metadata.sheet_scoped_key];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }

  return null;
}

function extractWorksheetRowNumber(item: IntelligentImportReviewedSaveItem) {
  const metadata = normalizeMetadata(item.metadata);
  const candidates = [
    metadata.source_worksheet_row_number,
    metadata.worksheet_row_number,
    metadata.source_row_number,
  ];

  for (const candidate of candidates) {
    const parsed = parseFiniteNumber(candidate);
    if (parsed != null && parsed > 0) return Math.floor(parsed);
  }

  return null;
}

function extractWorksheetRowNumberFromRefLike(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const match =
    normalized.match(/(?:^|::|[\s_-])row::?(\d{1,6})(?:$|::|[\s_-])/i) ||
    normalized.match(/(?:^|::|[\s_-])linha::?(\d{1,6})(?:$|::|[\s_-])/i) ||
    normalized.match(/\brow\s*(\d{1,6})\b/i) ||
    normalized.match(/\blinha\s*(\d{1,6})\b/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeSourceKind(value: unknown): IntelligentImportSelectedMediaSourceKind {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "xlsx_row_image") return "xlsx_row_image";
  if (normalized === "docx_media") return "docx_media";
  if (normalized === "pptx_media") return "pptx_media";
  if (normalized === "pdf_page_render") return "pdf_page_render";
  if (normalized === "image_file") return "image_file";
  return "unknown";
}

function normalizeAssociationMode(value: unknown): IntelligentImportSelectedMediaAssociationMode {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strong_auto") return "strong_auto";
  if (normalized === "weak_confirmed") return "weak_confirmed";
  if (normalized === "manual_upload") return "manual_upload";
  if (normalized === "visual_evidence") return "visual_evidence";
  if (normalized === "none") return "none";
  return "unknown";
}

function buildNormalizedMediaRef(ref: IntelligentImportSelectedMediaRef) {
  return {
    associationMode: normalizeAssociationMode(ref.associationMode),
    clientItemId: String(ref.clientItemId || "").trim(),
    confirmedByUser: Boolean(ref.confirmedByUser),
    fileName: String(ref.fileName || "").trim() || null,
    importBatchId: String(ref.importBatchId || "").trim() || null,
    importFileId: String(ref.importFileId || "").trim() || null,
    mediaRefId: String(ref.mediaRefId || "").trim(),
    mimeType: String(ref.mimeType || "").trim() || null,
    notes: Array.isArray(ref.notes)
      ? ref.notes.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    pageNumber: parseFiniteNumber(ref.pageNumber),
    sheetScopedKey: String(ref.sheetScopedKey || "").trim() || null,
    sizeBytes: parseFiniteNumber(ref.sizeBytes),
    sourceFileName: String(ref.sourceFileName || "").trim() || null,
    sourceImageId: String(ref.sourceImageId || "").trim() || null,
    sourceKind: normalizeSourceKind(ref.sourceKind),
    sourceLocationKey: String(ref.sourceLocationKey || "").trim() || null,
    stagingAssetId: String(ref.stagingAssetId || "").trim() || null,
    stagingStorageRef: String(ref.stagingStorageRef || "").trim() || null,
    warnings: Array.isArray(ref.warnings)
      ? ref.warnings.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    worksheetRowNumber: parseFiniteNumber(ref.worksheetRowNumber),
  };
}

function buildComparedFields(args: {
  item: IntelligentImportReviewedSaveItem | undefined;
  normalizedRef: ReturnType<typeof buildNormalizedMediaRef>;
  stagedAsset?: StagedMediaAssetRow;
}) {
  const itemSourceFileName = args.item ? extractSourceFileName(args.item) : null;
  const itemSourceLocationKey = args.item ? extractSourceLocationKey(args.item) : null;
  const itemSheetScopedKey = args.item ? extractSheetScopedKey(args.item) : null;
  const itemWorksheetRowNumber = args.item ? extractWorksheetRowNumber(args.item) : null;
  const refWorksheetRowNumber =
    args.normalizedRef.worksheetRowNumber ??
    extractWorksheetRowNumberFromRefLike(args.normalizedRef.sourceLocationKey) ??
    extractWorksheetRowNumberFromRefLike(args.normalizedRef.clientItemId);

  return {
    itemClientItemId: args.item?.clientItemId || null,
    itemSheetScopedKey,
    itemSourceFileName,
    itemSourceLocationKey,
    itemWorksheetRowNumber,
    refClientItemId: args.normalizedRef.clientItemId,
    refImportBatchId: args.normalizedRef.importBatchId,
    refImportFileId: args.normalizedRef.importFileId,
    refSheetScopedKey: args.normalizedRef.sheetScopedKey,
    refSourceFileName: args.normalizedRef.sourceFileName,
    refSourceLocationKey: args.normalizedRef.sourceLocationKey,
    refWorksheetRowNumber,
    stagedAssociationStrength: args.stagedAsset?.association_strength ?? null,
    stagedImportBatchId: args.stagedAsset?.import_batch_id ?? null,
    stagedImportFileId: args.stagedAsset?.import_file_id ?? null,
    stagedSheetScopedKey: args.stagedAsset?.sheet_scoped_key ?? null,
    stagedSourceFileName: args.stagedAsset?.source_file_name ?? null,
    stagedSourceKind: args.stagedAsset?.source_kind ?? null,
    stagedSourceLocationKey: args.stagedAsset?.source_location_key ?? null,
    stagedStorageBucket: args.stagedAsset?.storage_bucket ?? null,
    stagedStoragePath: args.stagedAsset?.storage_path ?? null,
    stagedWorksheetRowNumber: args.stagedAsset?.worksheet_row_number ?? null,
  } satisfies Record<string, unknown>;
}

function findFallbackPhotoPlanTarget(args: {
  items: IntelligentImportReviewedSaveItem[];
  normalizedRef: ReturnType<typeof buildNormalizedMediaRef>;
  resultItems: IntelligentImportSaveApprovedResultItem[];
}) {
  const refWorksheetRowNumber =
    args.normalizedRef.worksheetRowNumber ??
    extractWorksheetRowNumberFromRefLike(args.normalizedRef.sourceLocationKey) ??
    extractWorksheetRowNumberFromRefLike(args.normalizedRef.clientItemId);

  const scored = args.items
    .map((item, index) => {
      const resultItem = args.resultItems[index];
      const itemSourceFileName = extractSourceFileName(item);
      const itemSourceLocationKey = extractSourceLocationKey(item);
      const itemSheetScopedKey = extractSheetScopedKey(item);
      const itemWorksheetRowNumber = extractWorksheetRowNumber(item);
      let score = 0;

      if (
        args.normalizedRef.sourceLocationKey &&
        itemSourceLocationKey &&
        normalizeLoose(args.normalizedRef.sourceLocationKey) === normalizeLoose(itemSourceLocationKey)
      ) {
        score += 500;
      }
      if (
        args.normalizedRef.sheetScopedKey &&
        itemSheetScopedKey &&
        normalizeLoose(args.normalizedRef.sheetScopedKey) === normalizeLoose(itemSheetScopedKey)
      ) {
        score += 300;
      }
      if (
        refWorksheetRowNumber != null &&
        itemWorksheetRowNumber != null &&
        Math.floor(refWorksheetRowNumber) === Math.floor(itemWorksheetRowNumber)
      ) {
        score += 250;
      }
      if (matchesSourceFileNameTolerantly(args.normalizedRef.sourceFileName, itemSourceFileName)) {
        score += 50;
      }

      return {
        item,
        resultItem,
        score,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

function classifyPhotoPlanMediaRef(args: {
  item: IntelligentImportReviewedSaveItem | undefined;
  resultItem: IntelligentImportSaveApprovedResultItem | undefined;
  mediaRef: IntelligentImportSelectedMediaRef;
  matchMode: PhotoPlanMatchMode;
  stagedMediaValidation: StagedMediaValidationResult;
}): {
  classification: PhotoPlanClassification;
  planned?: IntelligentImportSaveApprovedPhotoPlan["plannedFinalPhotos"][number];
  blocked?: IntelligentImportSaveApprovedPhotoPlan["blockedMediaRefs"][number];
  unlinked?: IntelligentImportSaveApprovedPhotoPlan["unlinkedMediaRefs"][number];
  warnings: string[];
} {
  const normalizedRef = buildNormalizedMediaRef(args.mediaRef);
  const warnings = [...normalizedRef.notes, ...normalizedRef.warnings];
  const stagedAsset = normalizedRef.stagingAssetId
    ? args.stagedMediaValidation.validatedAssetsById.get(normalizedRef.stagingAssetId)
    : undefined;
  const expiredStagedAsset = normalizedRef.stagingAssetId
    ? args.stagedMediaValidation.expiredAssetsById.get(normalizedRef.stagingAssetId)
    : undefined;
  const invalidExpiryStagedAsset = normalizedRef.stagingAssetId
    ? args.stagedMediaValidation.invalidExpiryAssetsById.get(normalizedRef.stagingAssetId)
    : undefined;
  const compared = buildComparedFields({
    item: args.item,
    normalizedRef,
    stagedAsset: stagedAsset ?? expiredStagedAsset ?? invalidExpiryStagedAsset,
  });

  if (!normalizedRef.mediaRefId || !normalizedRef.clientItemId) {
    return {
      classification: "unlinked",
      unlinked: {
        clientItemId: normalizedRef.clientItemId || "(missing-client-item-id)",
        mediaRefId: normalizedRef.mediaRefId || "(missing-media-ref-id)",
        reason: "mediaRef sem mediaRefId/clientItemId valido.",
        sourceKind: normalizedRef.sourceKind,
      },
      warnings,
    };
  }

  if (!args.item || !args.resultItem) {
    return {
      classification: "unlinked",
      unlinked: {
        clientItemId: normalizedRef.clientItemId,
        mediaRefId: normalizedRef.mediaRefId,
        reason: "mediaRef aponta para clientItemId que nao existe neste request.",
        sourceKind: normalizedRef.sourceKind,
      },
      warnings,
    };
  }

  if (args.resultItem.status !== "valid" && args.resultItem.status !== "saved") {
    return {
      classification: "blocked",
      blocked: {
        associationMode: normalizedRef.associationMode,
        clientItemId: normalizedRef.clientItemId,
        compared,
        mediaRefId: normalizedRef.mediaRefId,
        reason: "Item de destino nao esta valido/salvo; photoPlan nao pode ser aplicado.",
        sourceKind: normalizedRef.sourceKind,
        warnings,
      },
      warnings,
    };
  }

  if (normalizedRef.associationMode === "none") {
    return {
      classification: "unlinked",
      unlinked: {
        clientItemId: normalizedRef.clientItemId,
        mediaRefId: normalizedRef.mediaRefId,
        reason: "Item marcado explicitamente sem foto final neste bloco.",
        sourceKind: normalizedRef.sourceKind,
      },
      warnings,
    };
  }

  if (normalizedRef.associationMode === "strong_auto") {
    if (normalizedRef.sourceKind !== "xlsx_row_image") {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "strong_auto so e planejavel para XLSX/XLSM com imagem por linha.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }

    if (!normalizedRef.sourceFileName || (!normalizedRef.sourceLocationKey && !normalizedRef.sheetScopedKey)) {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "strong_auto exige stagingAssetId valido neste bloco.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: null,
          warnings,
        },
        warnings,
      };
    }

    if (!stagedAsset) {
      if (invalidExpiryStagedAsset) {
        return {
          classification: "blocked",
          blocked: {
            associationMode: normalizedRef.associationMode,
            clientItemId: normalizedRef.clientItemId,
            compared,
            mediaRefId: normalizedRef.mediaRefId,
            reason:
              "A midia temporaria selecionada precisa ser reenviada ou reimportada antes do salvamento.",
            sourceKind: normalizedRef.sourceKind,
            stagingAssetId: normalizedRef.stagingAssetId,
            warnings,
          },
          warnings,
        };
      }

      if (expiredStagedAsset) {
        return {
          classification: "blocked",
          blocked: {
            associationMode: normalizedRef.associationMode,
            clientItemId: normalizedRef.clientItemId,
            compared,
            mediaRefId: normalizedRef.mediaRefId,
            reason:
              "A midia temporaria selecionada expirou e precisa ser reenviada ou reimportada antes do salvamento.",
            sourceKind: normalizedRef.sourceKind,
            stagingAssetId: normalizedRef.stagingAssetId,
            warnings,
          },
          warnings,
        };
      }

      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "stagingAssetId nao pertence a esta loja/organizacao ou nao esta staged.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }

    const stagedSourceKind = normalizeSourceKind(stagedAsset.source_kind);
    const stagedAssociationStrength = normalizeAssociationMode(stagedAsset.association_strength);
    const safeStorageBucket = String(stagedAsset.storage_bucket || "").trim().toLowerCase();
    const safeStoragePath = String(stagedAsset.storage_path || "").trim();
    const safeStoragePathLower = safeStoragePath.toLowerCase();

    if (
      stagedSourceKind !== "xlsx_row_image" ||
      stagedAssociationStrength !== "strong_auto" ||
      stagedAsset.requires_user_confirmation
    ) {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "stagingAssetId nao representa um asset strong_auto valido de XLSX/XLSM.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }

    if (
      safeStorageBucket !== "store-import-files" ||
      !safeStoragePath.includes("/media/") ||
      safeStoragePathLower.includes("pool-photos") ||
      safeStoragePathLower.includes("store-catalog-photos")
    ) {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "stagingAssetId nao atende aos requisitos de storage seguro deste bloco.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }

    if (args.matchMode === "fallback") {
      const itemSourceFileName = extractSourceFileName(args.item);
      const itemSourceLocationKey = extractSourceLocationKey(args.item);
      const itemSheetScopedKey = extractSheetScopedKey(args.item);
      const itemWorksheetRowNumber = extractWorksheetRowNumber(args.item);
      const refWorksheetRowNumber =
        normalizedRef.worksheetRowNumber ??
        extractWorksheetRowNumberFromRefLike(normalizedRef.sourceLocationKey) ??
        extractWorksheetRowNumberFromRefLike(normalizedRef.clientItemId);
      const matchesAtLeastOneStrongCoordinate =
        Boolean(
          normalizedRef.sourceLocationKey &&
            itemSourceLocationKey &&
            normalizeLoose(normalizedRef.sourceLocationKey) === normalizeLoose(itemSourceLocationKey)
        ) ||
        Boolean(
          normalizedRef.sheetScopedKey &&
            itemSheetScopedKey &&
            normalizeLoose(normalizedRef.sheetScopedKey) === normalizeLoose(itemSheetScopedKey)
        ) ||
        Boolean(
          refWorksheetRowNumber != null &&
            itemWorksheetRowNumber != null &&
            Math.floor(refWorksheetRowNumber) === Math.floor(itemWorksheetRowNumber)
        ) ||
        matchesSourceFileNameTolerantly(normalizedRef.sourceFileName, itemSourceFileName);

      if (!matchesAtLeastOneStrongCoordinate) {
        return {
          classification: "blocked",
          blocked: {
            associationMode: normalizedRef.associationMode,
            clientItemId: normalizedRef.clientItemId,
            compared,
            mediaRefId: normalizedRef.mediaRefId,
            reason: "MediaRef nao combina com a origem do item (sourceFileName/sourceLocationKey/sheetScopedKey/row).",
            sourceKind: normalizedRef.sourceKind,
            stagingAssetId: normalizedRef.stagingAssetId,
            warnings,
          },
          warnings,
        };
      }
    } else {
      const complementaryChecks = [
        normalizedRef.importBatchId && stagedAsset.import_batch_id
          ? normalizeLoose(normalizedRef.importBatchId) === normalizeLoose(stagedAsset.import_batch_id)
          : true,
        normalizedRef.importFileId && stagedAsset.import_file_id
          ? normalizeLoose(normalizedRef.importFileId) === normalizeLoose(stagedAsset.import_file_id)
          : true,
        normalizedRef.sourceFileName && stagedAsset.source_file_name
          ? matchesSourceFileNameTolerantly(normalizedRef.sourceFileName, stagedAsset.source_file_name)
          : true,
      ];
      if (complementaryChecks.some((entry) => entry === false)) {
        warnings.push(
          "clientItemId bateu, mas alguns campos complementares de origem nao coincidiram; asset strong_auto foi aceito assim mesmo neste bloco."
        );
      }
    }
  } else if (normalizedRef.associationMode === "weak_confirmed") {
    if (!normalizedRef.confirmedByUser) {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "weak_confirmed exige confirmedByUser=true.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }
  } else if (normalizedRef.associationMode === "manual_upload") {
    if (normalizedRef.sourceKind !== "image_file") {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "manual_upload so e planejavel para image_file.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }

    if (!normalizedRef.confirmedByUser) {
      return {
        classification: "blocked",
        blocked: {
          associationMode: normalizedRef.associationMode,
          clientItemId: normalizedRef.clientItemId,
          compared,
          mediaRefId: normalizedRef.mediaRefId,
          reason: "manual_upload exige confirmedByUser=true.",
          sourceKind: normalizedRef.sourceKind,
          stagingAssetId: normalizedRef.stagingAssetId,
          warnings,
        },
        warnings,
      };
    }
  } else if (normalizedRef.associationMode === "visual_evidence") {
    return {
      classification: "blocked",
      blocked: {
        associationMode: normalizedRef.associationMode,
        clientItemId: normalizedRef.clientItemId,
        compared,
        mediaRefId: normalizedRef.mediaRefId,
        reason: "Pagina renderizada/evidencia visual nunca vira foto final automatica neste bloco.",
        sourceKind: normalizedRef.sourceKind,
        stagingAssetId: normalizedRef.stagingAssetId,
        warnings,
      },
      warnings,
    };
  } else {
    warnings.push("AssociationMode/sourceKind nao reconhecidos com seguranca.");
    return {
      classification: "blocked",
      blocked: {
        associationMode: normalizedRef.associationMode,
        clientItemId: normalizedRef.clientItemId,
        compared,
        mediaRefId: normalizedRef.mediaRefId,
        reason: "MediaRef com associationMode/sourceKind desconhecidos.",
        sourceKind: normalizedRef.sourceKind,
        stagingAssetId: normalizedRef.stagingAssetId,
        warnings,
      },
      warnings,
    };
  }

  return {
    classification: "planned",
    planned: {
      associationMode: normalizedRef.associationMode,
      clientItemId: normalizedRef.clientItemId,
      destination: args.resultItem.destination,
      inputIndex: args.resultItem.inputIndex,
      matchMode: args.matchMode,
      mediaRefId: normalizedRef.mediaRefId,
      stagingAssetId: normalizedRef.stagingAssetId,
      sourceFileName: normalizedRef.sourceFileName,
      sourceImageId: normalizedRef.sourceImageId,
      sourceKind: normalizedRef.sourceKind,
      sourceLocationKey: normalizedRef.sourceLocationKey,
    },
    warnings,
  };
}

function buildPhotoPlan(args: {
  items: IntelligentImportSaveApprovedResultItem[];
  requestItems: IntelligentImportReviewedSaveItem[];
  selectedMediaRefs: IntelligentImportSelectedMediaRef[];
  stagedMediaValidation: StagedMediaValidationResult;
}) {
  const warnings: string[] = [...args.stagedMediaValidation.warnings];
  const receivedMediaRefs: IntelligentImportSaveApprovedPhotoPlan["receivedMediaRefs"] = [];
  const plannedFinalPhotos: IntelligentImportSaveApprovedPhotoPlan["plannedFinalPhotos"] = [];
  const blockedMediaRefs: IntelligentImportSaveApprovedPhotoPlan["blockedMediaRefs"] = [];
  const unlinkedMediaRefs: IntelligentImportSaveApprovedPhotoPlan["unlinkedMediaRefs"] = [];

  if (args.selectedMediaRefs.length === 0) {
    warnings.push("Nenhuma midia selecionada/planejada para foto final neste request.");
  }

  const itemByClientId = new Map(args.requestItems.map((item) => [String(item.clientItemId || "").trim(), item]));
  const resultByClientId = new Map(args.items.map((item) => [String(item.clientItemId || "").trim(), item]));
  let acceptedByClientItemId = 0;
  let acceptedByFallback = 0;
  const blockedByReason = new Map<string, number>();

  for (const mediaRef of args.selectedMediaRefs) {
    const normalizedRef = buildNormalizedMediaRef(mediaRef);
    receivedMediaRefs.push({
      associationMode: normalizedRef.associationMode,
      clientItemId: normalizedRef.clientItemId,
      confirmedByUser: normalizedRef.confirmedByUser,
      fileName: normalizedRef.fileName,
      mediaRefId: normalizedRef.mediaRefId,
      stagingAssetId: normalizedRef.stagingAssetId,
      sourceFileName: normalizedRef.sourceFileName,
      sourceImageId: normalizedRef.sourceImageId,
      sourceKind: normalizedRef.sourceKind,
      sourceLocationKey: normalizedRef.sourceLocationKey,
    });

    const directItem = itemByClientId.get(normalizedRef.clientItemId);
    const directResultItem = resultByClientId.get(normalizedRef.clientItemId);
    const fallbackTarget =
      !directItem || !directResultItem
        ? findFallbackPhotoPlanTarget({
            items: args.requestItems,
            normalizedRef,
            resultItems: args.items,
          })
        : null;
    const matchMode: PhotoPlanMatchMode =
      directItem && directResultItem ? "clientItemId" : fallbackTarget ? "fallback" : "clientItemId";

    const classified = classifyPhotoPlanMediaRef({
      item: directItem || fallbackTarget?.item,
      resultItem: directResultItem || fallbackTarget?.resultItem,
      matchMode,
      mediaRef,
      stagedMediaValidation: args.stagedMediaValidation,
    });
    warnings.push(...classified.warnings);

    if (classified.classification === "planned" && classified.planned) {
      plannedFinalPhotos.push(classified.planned);
      if (matchMode === "clientItemId") acceptedByClientItemId += 1;
      else acceptedByFallback += 1;
    } else if (classified.classification === "blocked" && classified.blocked) {
      blockedMediaRefs.push(classified.blocked);
      blockedByReason.set(
        classified.blocked.reason,
        (blockedByReason.get(classified.blocked.reason) ?? 0) + 1
      );
    } else if (classified.unlinked) {
      unlinkedMediaRefs.push(classified.unlinked);
    }
  }

  const dedupedWarnings = Array.from(new Set(warnings.filter(Boolean)));
  return {
    debug: {
      acceptedByClientItemId,
      acceptedByFallback,
      blockedByReason: Object.fromEntries(blockedByReason.entries()),
      blockedSamples: blockedMediaRefs.slice(0, 5).map((entry) => ({
        clientItemId: entry.clientItemId,
        compared: entry.compared ?? {},
        mediaRefId: entry.mediaRefId,
        reason: entry.reason,
        stagingAssetId: entry.stagingAssetId ?? null,
      })),
      plannedSamples: plannedFinalPhotos.slice(0, 5).map((entry) => ({
        clientItemId: entry.clientItemId,
        destination: entry.destination,
        matchMode: entry.matchMode ?? "clientItemId",
        mediaRefId: entry.mediaRefId,
        stagingAssetId: entry.stagingAssetId ?? null,
      })),
    },
    blockedMediaRefs,
    plannedFinalPhotos,
    receivedMediaRefs,
    unlinkedMediaRefs,
    warnings: dedupedWarnings,
    wouldCreateCatalogItemPhotos: plannedFinalPhotos.filter((entry) => entry.destination !== "pool").length,
    wouldCreatePoolPhotos: plannedFinalPhotos.filter((entry) => entry.destination === "pool").length,
    wouldUploadFinalPhotoObjects: plannedFinalPhotos.length,
  } satisfies IntelligentImportSaveApprovedPhotoPlan;
}

async function validateStagedMediaAssets(args: {
  organizationId: string;
  storeId: string;
  selectedMediaRefs: IntelligentImportSelectedMediaRef[];
  supabase: any;
}) {
  const receivedStagingAssetIds = Array.from(
    new Set(
      args.selectedMediaRefs
        .map((ref) => String(ref.stagingAssetId || "").trim())
        .filter(Boolean)
    )
  );
  const warnings: string[] = [];

  if (receivedStagingAssetIds.length === 0) {
    warnings.push("Nenhum stagingAssetId foi enviado neste request.");
    return {
      expiredAssetsById: new Map<string, StagedMediaAssetRow>(),
      invalidExpiryAssetsById: new Map<string, StagedMediaAssetRow>(),
      receivedStagingAssetIds,
      validatedAssets: [],
      validatedAssetsById: new Map<string, StagedMediaAssetRow>(),
      warnings,
    } satisfies StagedMediaValidationResult;
  }

  const { data, error } = await args.supabase
    .from("store_import_media_assets")
    .select(
      "id, import_batch_id, import_file_id, source_file_name, source_kind, source_location_key, sheet_scoped_key, worksheet_row_number, association_strength, requires_user_confirmation, status, storage_bucket, storage_path, metadata, file_name, size_bytes, normalized_mime_type, original_mime_type, expires_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("status", "staged")
    .in("id", receivedStagingAssetIds);

  if (error) {
    throw new IntelligentImportSaveAccessError(
      500,
      "LOAD_STAGED_MEDIA_ASSETS_FAILED",
      error.message
    );
  }

  const now = Date.now();
  const expiredAssets: StagedMediaAssetRow[] = [];
  const invalidExpiryAssets: StagedMediaAssetRow[] = [];
  const validatedAssets: StagedMediaAssetRow[] = [];

  for (const row of ((data ?? []) as StagedMediaAssetRow[])) {
    const expiryState = getExpiryState(row.expires_at, now);
    if (expiryState.kind === "past") {
      expiredAssets.push(row);
      continue;
    }
    if (expiryState.kind === "invalid") {
      invalidExpiryAssets.push(row);
      continue;
    }
    validatedAssets.push(row);
  }

  const validatedAssetsById = new Map(validatedAssets.map((row) => [String(row.id || "").trim(), row]));
  const expiredAssetsById = new Map(expiredAssets.map((row) => [String(row.id || "").trim(), row]));
  const invalidExpiryAssetsById = new Map(
    invalidExpiryAssets.map((row) => [String(row.id || "").trim(), row])
  );
  const missingIds = receivedStagingAssetIds.filter(
    (id) =>
      !validatedAssetsById.has(id) &&
      !expiredAssetsById.has(id) &&
      !invalidExpiryAssetsById.has(id)
  );

  if (missingIds.length > 0) {
    warnings.push(
      `${missingIds.length} stagingAssetId(s) nao pertencem a esta loja/organizacao ou nao estao staged.`
    );
  }
  if (expiredAssets.length > 0) {
    warnings.push(
      `${expiredAssets.length} stagingAssetId(s) expiraram e exigem reenvio ou reimportacao antes do salvamento.`
    );
  }
  if (invalidExpiryAssets.length > 0) {
    warnings.push(
      `${invalidExpiryAssets.length} stagingAssetId(s) possuem expiracao invalida e exigem reenvio ou reimportacao antes do salvamento.`
    );
  }

  return {
    expiredAssetsById,
    invalidExpiryAssetsById,
    receivedStagingAssetIds,
    validatedAssets,
    validatedAssetsById,
    warnings,
  } satisfies StagedMediaValidationResult;
}

async function validateImportedFiles(args: {
  importedFileIds: string[];
  organizationId: string;
  storeId: string;
  supabase: any;
}) {
  const receivedImportedFileIds = Array.from(
    new Set(args.importedFileIds.map((value) => String(value || "").trim()).filter(Boolean))
  );
  const warnings: string[] = [];

  if (receivedImportedFileIds.length === 0) {
    warnings.push(
      "Nenhum arquivo bruto persistido recebido; vinculos de importacao nao seriam criados neste dry-run."
    );
    return {
      invalidImportedFileIds: [],
      receivedImportedFileIds,
      validatedFiles: [],
      validatedFilesById: new Map<string, ImportedFileRow>(),
      validatedFilesByName: new Map<string, ImportedFileRow[]>(),
      warnings,
    } satisfies ImportFileValidationResult;
  }

  const { data, error } = await args.supabase
    .from("store_import_files")
    .select("id, original_file_name, status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("id", receivedImportedFileIds);

  if (error) {
    throw new IntelligentImportSaveAccessError(
      500,
      "LOAD_IMPORT_FILES_FAILED",
      error.message
    );
  }

  const validatedFiles = ((data ?? []) as ImportedFileRow[]).filter((row) => {
    const normalizedStatus = String(row.status || "").trim().toLowerCase();
    return !normalizedStatus || normalizedStatus === "active" || normalizedStatus === "staged";
  });
  const validatedFilesById = new Map(validatedFiles.map((row) => [String(row.id || "").trim(), row]));
  const invalidImportedFileIds = receivedImportedFileIds.filter((id) => !validatedFilesById.has(id));
  const validatedFilesByName = new Map<string, ImportedFileRow[]>();

  for (const row of validatedFiles) {
    const key = normalizeLoose(row.original_file_name);
    if (!key) continue;
    const current = validatedFilesByName.get(key) ?? [];
    current.push(row);
    validatedFilesByName.set(key, current);
  }

  if (invalidImportedFileIds.length > 0) {
    warnings.push(
      `${invalidImportedFileIds.length} importedFileId(s) nao pertencem a esta loja/organizacao ou nao estao ativos/staged.`
    );
  }

  return {
    invalidImportedFileIds,
    receivedImportedFileIds,
    validatedFiles,
    validatedFilesById,
    validatedFilesByName,
    warnings,
  } satisfies ImportFileValidationResult;
}

function buildImportFileLinkPlan(args: {
  importFileValidation: ImportFileValidationResult;
  items: IntelligentImportSaveApprovedResultItem[];
  requestItems: IntelligentImportReviewedSaveItem[];
}) {
  const warnings = [...args.importFileValidation.warnings];
  const linkableItems: IntelligentImportSaveApprovedImportFilePlan["linkableItems"] = [];
  const unlinkedItems: IntelligentImportSaveApprovedImportFilePlan["unlinkedItems"] = [];

  for (const item of args.items) {
    const requestItem = args.requestItems[item.inputIndex];
    const sourceFileName = requestItem ? extractSourceFileName(requestItem) : null;

    if (item.status !== "valid" && item.status !== "saved") {
      unlinkedItems.push({
        clientItemId: item.clientItemId,
        inputIndex: item.inputIndex,
        reason: "Item nao elegivel para vinculo porque nao esta valido/salvo.",
        sourceFileName,
      });
      continue;
    }

    if (args.importFileValidation.validatedFiles.length === 0) {
      unlinkedItems.push({
        clientItemId: item.clientItemId,
        inputIndex: item.inputIndex,
        reason: "Nenhum arquivo bruto validado foi recebido neste request.",
        sourceFileName,
      });
      continue;
    }

    if (!sourceFileName) {
      unlinkedItems.push({
        clientItemId: item.clientItemId,
        inputIndex: item.inputIndex,
        reason: "Item sem sourceFileName/source_file_name para vincular.",
        sourceFileName,
      });
      continue;
    }

    const matches = args.importFileValidation.validatedFilesByName.get(normalizeLoose(sourceFileName)) ?? [];
    if (matches.length === 1) {
      linkableItems.push({
        clientItemId: item.clientItemId,
        destination: item.destination,
        importFileId: matches[0].id,
        inputIndex: item.inputIndex,
        sourceFileName,
      });
      continue;
    }

    unlinkedItems.push({
      clientItemId: item.clientItemId,
      inputIndex: item.inputIndex,
      reason:
        matches.length === 0
          ? "Nenhum store_import_file validado combina com o arquivo de origem."
          : "Mais de um store_import_file validado combina com o arquivo de origem; vinculo automatico ficou ambiguo.",
      sourceFileName,
    });
  }

  if (args.importFileValidation.receivedImportedFileIds.length === 0) {
    warnings.push(
      "Nenhum importedFileId foi enviado; o save novo nao preserva vinculos de importacao automaticamente neste estagio."
    );
  }

  return {
    importedFileIdsReceived: args.importFileValidation.receivedImportedFileIds,
    importFilesValidated: args.importFileValidation.validatedFiles.map((file) => ({
      id: file.id,
      originalFileName: String(file.original_file_name || "").trim(),
      status: file.status,
    })),
    importFilesMissing: args.importFileValidation.receivedImportedFileIds.filter(
      (id) => !args.importFileValidation.validatedFilesById.has(id)
    ),
    invalidImportedFileIds: args.importFileValidation.invalidImportedFileIds,
    linkableItems,
    unlinkedItems,
    warnings,
    wouldCreateImportFileItemLinks: linkableItems.length,
  } satisfies IntelligentImportSaveApprovedImportFilePlan;
}

function buildInternalDuplicateKeys(item: IntelligentImportSaveApprovedResultItem) {
  const payload = item.normalizedPayload;
  if (!payload) return [] as string[];

  if (payload.type === "pool") {
    const normalizedName = normalizeImportDedupText(payload.name);
    return normalizedName ? [`pool_name::${normalizedName}`] : [];
  }

  const keys: string[] = [];
  const normalizedSku = normalizeImportDedupSku(payload.sku);
  if (normalizedSku) {
    keys.push(`catalog_sku::${normalizedSku}`);
  }

  const normalizedName = normalizeImportDedupText(payload.name);
  if (normalizedName) {
    keys.push(`catalog_name::${payload.destination}::${normalizedName}`);
  }

  return keys;
}

async function persistImportFileReviewAudit(args: {
  globalReviewConfirmation: IntelligentImportGlobalReviewConfirmation;
  importFileIds: string[];
  supabase: any;
  validateOnly: boolean;
}): Promise<ImportFileAuditPersistenceResult> {
  const uniqueImportFileIds = Array.from(
    new Set(args.importFileIds.map((value) => String(value || "").trim()).filter(Boolean))
  );
  if (uniqueImportFileIds.length === 0) {
    return {
      attempted: false,
      persisted: false,
      skippedReason: "no_import_file_ids_to_audit",
      updatedImportFileIds: [],
      validateOnly: args.validateOnly,
    };
  }

  const { data, error } = await args.supabase
    .from("store_import_files")
    .select("id, import_summary")
    .in("id", uniqueImportFileIds);
  if (error) {
    return {
      attempted: true,
      error: error.message,
      persisted: false,
      updatedImportFileIds: [],
      validateOnly: args.validateOnly,
    };
  }

  const rows = (data ?? []) as Array<{ id: string; import_summary?: Record<string, unknown> | null }>;
  for (const row of rows) {
    const importSummary = normalizeMetadata(row.import_summary);
    const reviewAudit = normalizeMetadata(importSummary.review_audit as Record<string, unknown> | null | undefined);
    const latestGlobalConfirmation = {
      confirmedAt: args.globalReviewConfirmation.confirmedAt,
      importedFileIds: uniqueImportFileIds,
      operation: "save_real_precondition" as const,
      persistedAt: new Date().toISOString(),
      reviewStateSignature: args.globalReviewConfirmation.reviewStateSignature ?? null,
      revisionVersion: args.globalReviewConfirmation.revisionVersion ?? null,
      summary: args.globalReviewConfirmation.summary,
      validateOnly: args.validateOnly,
    };
    const nextImportSummary = {
      ...importSummary,
      review_audit: {
        ...reviewAudit,
        latest_global_confirmation: latestGlobalConfirmation,
      },
    };
    const { error: updateError } = await args.supabase
      .from("store_import_files")
      .update({
        import_summary: nextImportSummary,
      })
      .eq("id", row.id);
    if (updateError) {
      return {
        attempted: true,
        error: updateError.message,
        persisted: false,
        updatedImportFileIds: rows
          .map((entry) => String(entry.id || "").trim())
          .filter((entryId) => entryId && entryId !== String(row.id || "").trim()),
        validateOnly: args.validateOnly,
      };
    }
  }

  return {
    attempted: true,
    persisted: true,
    updatedImportFileIds: rows.map((row) => String(row.id || "").trim()).filter(Boolean),
    validateOnly: args.validateOnly,
  };
}

function applyInternalDuplicateProtection(items: IntelligentImportSaveApprovedResultItem[]) {
  const seenByKey = new Map<string, IntelligentImportSaveApprovedResultItem>();

  return items.map((item) => {
    if (item.status !== "valid" || !item.normalizedPayload) {
      return item;
    }

    const duplicateOf = buildInternalDuplicateKeys(item)
      .map((key) => seenByKey.get(key))
      .find(Boolean);

    if (duplicateOf) {
      return {
        ...item,
        conflict: {
          existingId: duplicateOf.clientItemId,
          existingName: duplicateOf.normalizedPayload?.name || duplicateOf.clientItemId,
          type: "internal_duplicate",
        },
        reasons: ["Item duplicado dentro do mesmo payload/request."],
        status: "blocked_duplicate",
      } satisfies IntelligentImportSaveApprovedResultItem;
    }

    for (const key of buildInternalDuplicateKeys(item)) {
      seenByKey.set(key, item);
    }

    return item;
  });
}

async function insertValidatedItem(args: {
  organizationId: string;
  storeId: string;
  supabase: any;
  validationItem: IntelligentImportSaveApprovedResultItem;
}) {
  const normalizedPayload = args.validationItem.normalizedPayload;
  if (!normalizedPayload) {
    throw new Error("Payload normalizado ausente para persistencia.");
  }

  if (normalizedPayload.type === "pool") {
    const { data, error } = await args.supabase
      .from("pools")
      .insert({
        organization_id: args.organizationId,
        store_id: args.storeId,
        name: normalizedPayload.name,
        width_m: normalizedPayload.width_m,
        length_m: normalizedPayload.length_m,
        depth_m: normalizedPayload.depth_m,
        shape: normalizedPayload.shape,
        material: normalizedPayload.material,
        max_capacity_l: normalizedPayload.max_capacity_l ?? 0,
        weight_kg: normalizedPayload.weight_kg,
        price: normalizedPayload.price,
        description: normalizedPayload.description,
        is_active: normalizedPayload.is_active,
        track_stock: normalizedPayload.track_stock,
        stock_quantity: normalizedPayload.stock_quantity,
      })
      .select("id")
      .single();

    if (error) throw error;
    return String(data.id || "");
  }

  const { data, error } = await args.supabase
    .from("store_catalog_items")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      sku: normalizedPayload.sku,
      name: normalizedPayload.name,
      description: normalizedPayload.description,
      price_cents: normalizedPayload.price_cents,
      currency: normalizedPayload.currency,
      is_active: normalizedPayload.is_active,
      track_stock: normalizedPayload.track_stock,
      stock_quantity: normalizedPayload.stock_quantity,
      metadata: normalizedPayload.metadata,
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id || "");
}

async function createImportFileLinks(args: {
  items: IntelligentImportSaveApprovedResultItem[];
  organizationId: string;
  storeId: string;
  supabase: any;
  plan: IntelligentImportSaveApprovedImportFilePlan;
}) {
  const seenKeys = new Set<string>();

  for (const entry of args.plan.linkableItems) {
    const savedItem = args.items.find(
      (item) => item.clientItemId === entry.clientItemId && item.inputIndex === entry.inputIndex
    );
    if (!savedItem?.persistedId) {
      throw new Error(`PersistedId ausente para criar vinculo do item ${entry.clientItemId}.`);
    }

    const destinationType = entry.destination === "pool" ? "pool" : "catalog_item";
    const destinationTable = entry.destination === "pool" ? "pools" : "store_catalog_items";
    const dedupeKey = [
      entry.importFileId,
      destinationType,
      destinationTable,
      savedItem.persistedId,
    ].join("::");

    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const { data: existingLink, error: existingLinkError } = await args.supabase
      .from("store_import_file_items")
      .select("import_file_id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("import_file_id", entry.importFileId)
      .eq("destination_type", destinationType)
      .eq("destination_table", destinationTable)
      .eq("destination_item_id", savedItem.persistedId)
      .maybeSingle();

    if (existingLinkError) throw existingLinkError;
    if (existingLink) continue;

    const { error } = await args.supabase.from("store_import_file_items").insert({
      import_file_id: entry.importFileId,
      organization_id: args.organizationId,
      store_id: args.storeId,
      destination_type: destinationType,
      destination_table: destinationTable,
      destination_item_id: savedItem.persistedId,
    });

    if (error) throw error;
  }
}

async function promotePlannedImportPhotos(args: {
  organizationId: string;
  photoPlan: IntelligentImportSaveApprovedPhotoPlan;
  savedItems: IntelligentImportSaveApprovedResultItem[];
  stagedMediaValidation: StagedMediaValidationResult;
  storeId: string;
  supabase: any;
}) {
  const promotedPhotos: IntelligentImportSaveApprovedPhotoSaveResult["promotedPhotos"] = [];
  const failedPhotos: IntelligentImportSaveApprovedPhotoSaveResult["failedPhotos"] = [];
  const warnings: string[] = [];
  let createdPoolPhotos = 0;
  let createdCatalogItemPhotos = 0;
  let uploadedFinalPhotoObjects = 0;
  let promotedStagingAssets = 0;
  const processedStagingAssetIds = new Set<string>();

  for (const planned of args.photoPlan.plannedFinalPhotos) {
    const savedItem = args.savedItems.find(
      (entry) =>
        entry.clientItemId === planned.clientItemId &&
        entry.inputIndex === planned.inputIndex &&
        entry.persistedId
    );
    const stagingAssetId = String(planned.stagingAssetId || "").trim() || null;
    const stagedAsset = stagingAssetId
      ? args.stagedMediaValidation.validatedAssetsById.get(stagingAssetId)
      : undefined;

    if (!savedItem?.persistedId) {
      warnings.push(
        `Foto planejada para ${planned.clientItemId} foi ignorada porque o item nao teve persistedId real.`
      );
      continue;
    }

    if (!stagingAssetId || !stagedAsset) {
      warnings.push(
        `Foto planejada para ${planned.clientItemId} foi ignorada porque o stagingAssetId validado nao foi encontrado.`
      );
      continue;
    }

    if (processedStagingAssetIds.has(stagingAssetId)) {
      warnings.push(`stagingAssetId ${stagingAssetId} ja foi promovido neste save; duplicata ignorada.`);
      continue;
    }

    const assetMetadata = normalizeMetadata(stagedAsset.metadata);
    if (String(stagedAsset.status || "").trim().toLowerCase() === "promoted") {
      warnings.push(`stagingAssetId ${stagingAssetId} ja estava promoted; promocao pulada.`);
      continue;
    }
    if (assetMetadata.finalPhotoRowId && assetMetadata.finalBucket && assetMetadata.finalPath) {
      warnings.push(`stagingAssetId ${stagingAssetId} ja possui metadata final registrada; promocao pulada.`);
      continue;
    }

    const mimeType =
      String(stagedAsset.normalized_mime_type || stagedAsset.original_mime_type || "").trim() ||
      "image/jpeg";
    const cleanupStorageBucket = String(stagedAsset.storage_bucket || "").trim();
    const sourceStoragePath = String(stagedAsset.storage_path || "").trim();
    let finalBucket: "pool-photos" | "store-catalog-photos";
    let finalPath = "";
    let finalPhotoRowId = "";

    try {
      const { data: downloadData, error: downloadError } = await args.supabase.storage
        .from("store-import-files")
        .download(sourceStoragePath);
      if (downloadError || !downloadData) {
        throw new Error(downloadError?.message || "Falha ao baixar objeto staged para promocao.");
      }

      finalBucket = planned.destination === "pool" ? "pool-photos" : "store-catalog-photos";
      finalPath =
        planned.destination === "pool"
          ? buildFinalPoolPhotoPath({
              fileName: stagedAsset.file_name,
              mimeType,
              organizationId: args.organizationId,
              poolId: savedItem.persistedId,
              sortOrder: 0,
              storeId: args.storeId,
            })
          : buildFinalCatalogPhotoPath({
              catalogItemId: savedItem.persistedId,
              fileName: stagedAsset.file_name,
              mimeType,
              organizationId: args.organizationId,
              sortOrder: 0,
              storeId: args.storeId,
            });

      const { error: uploadError } = await args.supabase.storage
        .from(finalBucket)
        .upload(finalPath, downloadData, {
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      uploadedFinalPhotoObjects += 1;

      if (planned.destination === "pool") {
        const { data: photoRow, error: insertPhotoError } = await args.supabase
          .from("pool_photos")
          .insert({
            file_name: sanitizePhotoFileName(stagedAsset.file_name),
            file_size_bytes:
              typeof stagedAsset.size_bytes === "number" && Number.isFinite(stagedAsset.size_bytes)
                ? stagedAsset.size_bytes
                : null,
            organization_id: args.organizationId,
            pool_id: savedItem.persistedId,
            sort_order: 0,
            storage_path: finalPath,
            store_id: args.storeId,
          })
          .select("id")
          .single();

        if (insertPhotoError) {
          const { error: cleanupError } = await args.supabase.storage.from(finalBucket).remove([finalPath]);
          if (cleanupError) {
            warnings.push(
              `Falha ao limpar upload final orfao ${finalBucket}/${finalPath}: ${cleanupError.message}`
            );
          }
          throw new Error(insertPhotoError.message);
        }

        finalPhotoRowId = String(photoRow.id || "");
        createdPoolPhotos += 1;
      } else {
        const { data: photoRow, error: insertPhotoError } = await args.supabase
          .from("store_catalog_item_photos")
          .insert({
            catalog_item_id: savedItem.persistedId,
            file_name: sanitizePhotoFileName(stagedAsset.file_name),
            file_size_bytes:
              typeof stagedAsset.size_bytes === "number" && Number.isFinite(stagedAsset.size_bytes)
                ? stagedAsset.size_bytes
                : null,
            sort_order: 0,
            storage_path: finalPath,
          })
          .select("id")
          .single();

        if (insertPhotoError) {
          const { error: cleanupError } = await args.supabase.storage.from(finalBucket).remove([finalPath]);
          if (cleanupError) {
            warnings.push(
              `Falha ao limpar upload final orfao ${finalBucket}/${finalPath}: ${cleanupError.message}`
            );
          }
          throw new Error(insertPhotoError.message);
        }

        finalPhotoRowId = String(photoRow.id || "");
        createdCatalogItemPhotos += 1;
      }

      const mergedMetadata = {
        ...assetMetadata,
        destination: planned.destination,
        destinationId: savedItem.persistedId,
        finalBucket,
        finalPath,
        finalPhotoRowId,
        promotedAt: new Date().toISOString(),
      };

      const { error: updateAssetError } = await args.supabase
        .from("store_import_media_assets")
        .update({
          metadata: mergedMetadata,
          status: "promoted",
        })
        .eq("id", stagingAssetId)
        .eq("organization_id", args.organizationId)
        .eq("store_id", args.storeId)
        .eq("status", "staged");
      if (updateAssetError) {
        warnings.push(
          `Foto final criada para ${planned.clientItemId}, mas o asset staged ${stagingAssetId} nao foi marcado como promoted: ${updateAssetError.message}`
        );
      } else {
        promotedStagingAssets += 1;

        if (cleanupStorageBucket && sourceStoragePath) {
          const cleanupAttemptedAt = new Date().toISOString();
          const cleanupAttemptMetadata = {
            bucket: cleanupStorageBucket,
            error: null,
            outcome: "attempting",
            path: sourceStoragePath,
            removedAt: null,
            attemptedAt: cleanupAttemptedAt,
          };
          const cleanupAttemptMergedMetadata = {
            ...mergedMetadata,
            stagedCleanup: cleanupAttemptMetadata,
          };

          const { error: cleanupAttemptMetadataError } = await args.supabase
            .from("store_import_media_assets")
            .update({
              metadata: cleanupAttemptMergedMetadata,
            })
            .eq("id", stagingAssetId)
            .eq("organization_id", args.organizationId)
            .eq("store_id", args.storeId)
            .eq("status", "promoted");

          if (cleanupAttemptMetadataError) {
            warnings.push(
              `Foto final salva para ${planned.clientItemId}, mas a auditoria inicial de cleanup do staged ${stagingAssetId} falhou e a limpeza temporaria ficou pendente: ${cleanupAttemptMetadataError.message}`
            );
          } else {
            const objectExistence = await checkStorageObjectExists({
              storageBucket: cleanupStorageBucket,
              storagePath: sourceStoragePath,
              supabase: args.supabase,
            });

            if (objectExistence.kind === "unknown_error") {
              const pendingCleanupMetadata = {
                ...cleanupAttemptMergedMetadata,
                stagedCleanup: {
                  ...cleanupAttemptMetadata,
                  error: objectExistence.message,
                  outcome: "pending_error",
                },
              };
              const { error: pendingCleanupMetadataError } = await args.supabase
                .from("store_import_media_assets")
                .update({
                  metadata: pendingCleanupMetadata,
                })
                .eq("id", stagingAssetId)
                .eq("organization_id", args.organizationId)
                .eq("store_id", args.storeId)
                .eq("status", "promoted");
              if (pendingCleanupMetadataError) {
                warnings.push(
                  `Foto final salva para ${planned.clientItemId}, mas a auditoria da limpeza temporaria ${stagingAssetId} precisa ser reconciliada: ${pendingCleanupMetadataError.message}`
                );
              }
              warnings.push(
                `Foto final salva para ${planned.clientItemId}, mas a limpeza do arquivo temporario ${stagingAssetId} ficou pendente.`
              );
            } else {
              let cleanupOutcome: "removed" | "already_missing" | "pending_error" =
                objectExistence.kind === "missing" ? "already_missing" : "removed";
              let cleanupErrorMessage: string | null = null;
              let cleanupRemovedAt: string | null =
                objectExistence.kind === "missing" ? cleanupAttemptedAt : null;

              if (objectExistence.kind === "exists") {
                const { error: cleanupError } = await args.supabase.storage
                  .from(cleanupStorageBucket)
                  .remove([sourceStoragePath]);
                if (cleanupError) {
                  cleanupOutcome = "pending_error";
                  cleanupErrorMessage = cleanupError.message;
                } else {
                  cleanupRemovedAt = new Date().toISOString();
                }
              }

              const cleanupResultMetadata = {
                ...cleanupAttemptMergedMetadata,
                stagedCleanup: {
                  ...cleanupAttemptMetadata,
                  error: cleanupErrorMessage,
                  outcome: cleanupOutcome,
                  removedAt: cleanupRemovedAt,
                },
              };

              const { error: cleanupMetadataError } = await args.supabase
                .from("store_import_media_assets")
                .update({
                  metadata: cleanupResultMetadata,
                })
                .eq("id", stagingAssetId)
                .eq("organization_id", args.organizationId)
                .eq("store_id", args.storeId)
                .eq("status", "promoted");

              if (cleanupMetadataError) {
                warnings.push(
                  `Foto final salva para ${planned.clientItemId}, mas a auditoria da limpeza temporaria ${stagingAssetId} precisa ser reconciliada: ${cleanupMetadataError.message}`
                );
              }

              if (cleanupOutcome === "pending_error") {
                warnings.push(
                  `Foto final salva para ${planned.clientItemId}, mas a limpeza do arquivo temporario ${stagingAssetId} ficou pendente.`
                );
              }
            }
          }
        }
      }

      processedStagingAssetIds.add(stagingAssetId);
      promotedPhotos.push({
        clientItemId: planned.clientItemId,
        destination: planned.destination,
        finalBucket,
        finalPath,
        finalPhotoRowId,
        mediaRefId: planned.mediaRefId,
        promotedStagingAssetId: stagingAssetId,
      });
    } catch (error) {
      failedPhotos.push({
        clientItemId: planned.clientItemId,
        destination: planned.destination,
        error: error instanceof Error ? error.message : String(error),
        mediaRefId: planned.mediaRefId,
        stagingAssetId,
      });

      const mergedMetadata = {
        ...assetMetadata,
        lastPromotionAttemptAt: new Date().toISOString(),
        lastPromotionError: error instanceof Error ? error.message : String(error),
      };

      const { error: updateAssetError } = await args.supabase
        .from("store_import_media_assets")
        .update({
          metadata: mergedMetadata,
        })
        .eq("id", stagingAssetId || "__missing__")
        .eq("organization_id", args.organizationId)
        .eq("store_id", args.storeId);
      if (updateAssetError && stagingAssetId) {
        warnings.push(
          `Falha ao registrar erro de promocao no stagingAssetId ${stagingAssetId}: ${updateAssetError.message}`
        );
      }
    }
  }

  return {
    createdCatalogItemPhotos,
    createdPoolPhotos,
    failedPhotos,
    promotedPhotos,
    promotedStagingAssets,
    uploadedFinalPhotoObjects,
    warnings,
  } satisfies IntelligentImportSaveApprovedPhotoSaveResult;
}

export async function saveApprovedIntelligentImportItems(
  request: IntelligentImportSaveApprovedRequest
): Promise<IntelligentImportSaveApprovedResponse> {
  const auth = await authenticateIntelligentImportSaveRequest();
  const store = await loadAuthorizedStore({
    organizationIds: auth.organizationIds,
    requestOrganizationId: request.organizationId,
    requestStoreId: request.storeId,
    supabase: auth.sessionSupabase,
  });
  const supabase = createServiceSupabaseClient();

  if (!Array.isArray(request.items)) {
    throw new IntelligentImportSaveAccessError(400, "INVALID_ITEMS", "items deve ser um array.");
  }

  const importFileValidation = await validateImportedFiles({
    importedFileIds: Array.isArray(request.importedFileIds) ? request.importedFileIds : [],
    organizationId: store.organization_id,
    storeId: store.id,
    supabase,
  });
  if (importFileValidation.receivedImportedFileIds.length === 0) {
    const response: IntelligentImportSaveApprovedResponse = {
      items: [],
      message: "imported_file_ids_required_for_approved_intelligent_import",
      ok: false,
      reviewAudit: {
        globalReviewConfirmation:
          normalizeGlobalReviewConfirmation(request.reviewAudit?.globalReviewConfirmation),
        importFileAudit: {
          attempted: false,
          persisted: false,
          skippedReason: "imported_file_ids_required_for_approved_intelligent_import",
          updatedImportFileIds: [],
          validateOnly: Boolean(request.validateOnly),
        },
        structuredReviewSnapshot:
          normalizeStructuredReviewSnapshot(request.reviewAudit?.structuredReviewSnapshot),
      },
      summary: {
        blockedDuplicate: 0,
        invalid: 0,
        saved: 0,
        total: 0,
        valid: 0,
      },
      validateOnly: Boolean(request.validateOnly),
    };
    return response;
  }
  const stagedMediaValidation = await validateStagedMediaAssets({
    organizationId: store.organization_id,
    selectedMediaRefs: Array.isArray(request.selectedMediaRefs) ? request.selectedMediaRefs : [],
    storeId: store.id,
    supabase,
  });
  const structuredReviewAuditValidation = validateStructuredReviewAudit({
    importFileValidation,
    request,
  });
  if (!structuredReviewAuditValidation.ok) {
    const response: IntelligentImportSaveApprovedResponse = {
      items: [],
      message: structuredReviewAuditValidation.message,
      ok: false,
      reviewAudit: {
        globalReviewConfirmation:
          normalizeGlobalReviewConfirmation(request.reviewAudit?.globalReviewConfirmation),
        importFileAudit: {
          attempted: false,
          persisted: false,
          skippedReason: "global_review_validation_failed",
          updatedImportFileIds: [],
          validateOnly: Boolean(request.validateOnly),
        },
        structuredReviewSnapshot:
          normalizeStructuredReviewSnapshot(request.reviewAudit?.structuredReviewSnapshot),
      },
      summary: {
        blockedDuplicate: 0,
        invalid: 0,
        saved: 0,
        total: 0,
        valid: 0,
      },
      validateOnly: Boolean(request.validateOnly),
    };
    return response;
  }
  const structuredReviewAudit = structuredReviewAuditValidation.value;
  const globalReviewConfirmation = structuredReviewAudit.globalReviewConfirmation;

  const existingReferences = await loadDuplicateReferenceData({
    organizationId: store.organization_id,
    storeId: store.id,
    supabase,
  });

  const validationContext: SaveValidationContext = {
    existingCatalogItems: existingReferences.existingCatalogItems,
    existingPoolRows: existingReferences.existingPoolRows,
    request,
  };

  const validatedItems = applyInternalDuplicateProtection(
    request.items.map((item, index) => validateReviewedImportedItem(item, index, validationContext))
  );
  const importFileLinkPlan = buildImportFileLinkPlan({
    importFileValidation,
    items: validatedItems,
    requestItems: request.items,
  });
  const photoPlan = buildPhotoPlan({
    items: validatedItems,
    requestItems: request.items,
    selectedMediaRefs: Array.isArray(request.selectedMediaRefs) ? request.selectedMediaRefs : [],
    stagedMediaValidation,
  });

  const summary = {
    blockedDuplicate: validatedItems.filter((item) => item.status === "blocked_duplicate").length,
    invalid: validatedItems.filter((item) => item.status === "invalid").length,
    saved: 0,
    total: validatedItems.length,
    valid: validatedItems.filter((item) => item.status === "valid").length,
  };

  const hasBlockingIssues =
    summary.invalid > 0 ||
    summary.blockedDuplicate > 0 ||
    importFileValidation.invalidImportedFileIds.length > 0 ||
    photoPlan.blockedMediaRefs.length > 0;
  const validateOnly = Boolean(request.validateOnly);
  const debugParser = Boolean(request.context?.debugParser);

  if (!validateOnly && debugParser) {
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message:
        "Salvamento real bloqueado porque debugParser=true. Use apenas a validacao sem gravar neste modo.",
      ok: false,
      photoPlan,
      reviewAudit: {
        globalReviewConfirmation,
        importFileAudit: {
          attempted: false,
          persisted: false,
          skippedReason: "debug_parser_no_persist",
          updatedImportFileIds: [],
          validateOnly: false,
        },
        structuredReviewSnapshot: structuredReviewAudit?.snapshot ?? null,
      },
      summary,
      validateOnly: false,
    };
    return response;
  }

  if (validateOnly) {
    const importFileAudit = {
      attempted: false,
      persisted: false,
      skippedReason: "validate_only_no_persist",
      updatedImportFileIds: [],
      validateOnly: true,
    } satisfies ImportFileAuditPersistenceResult;
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message: "",
      ok: !hasBlockingIssues,
      photoPlan,
      reviewAudit: {
        globalReviewConfirmation,
        importFileAudit,
        structuredReviewSnapshot: structuredReviewAudit?.snapshot ?? null,
      },
      summary,
      validateOnly: true,
    };
    response.message = buildResponseMessage(response);
    return response;
  }

  if (hasBlockingIssues) {
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message: "",
      ok: false,
      photoPlan,
      reviewAudit: {
        globalReviewConfirmation,
        importFileAudit: {
          attempted: false,
          persisted: false,
          skippedReason: "blocking_issues_no_persist",
          updatedImportFileIds: [],
          validateOnly: false,
        },
        structuredReviewSnapshot: structuredReviewAudit?.snapshot ?? null,
      },
      summary,
      validateOnly: false,
    };
    response.message = buildResponseMessage(response);
    return response;
  }

  const importFileAudit = await persistImportFileReviewAudit({
    globalReviewConfirmation: structuredReviewAudit.globalReviewConfirmation,
    importFileIds: structuredReviewAudit.persistedImportFileIds,
    supabase,
    validateOnly: false,
  });
  if (importFileAudit.attempted && !importFileAudit.persisted) {
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message:
        importFileAudit.error ||
        "A auditoria do checkpoint global falhou antes do save real em store_import_files.",
      ok: false,
      photoPlan,
      reviewAudit: {
        globalReviewConfirmation,
        importFileAudit,
        structuredReviewSnapshot: structuredReviewAudit?.snapshot ?? null,
      },
      summary,
      validateOnly: false,
    };
    return response;
  }

  const savedItems: IntelligentImportSaveApprovedResultItem[] = [];
  for (const validationItem of validatedItems) {
    const persistedId = await insertValidatedItem({
      organizationId: store.organization_id,
      storeId: store.id,
      supabase,
      validationItem,
    });

    savedItems.push({
      ...validationItem,
      persistedId,
      status: "saved",
    });
  }

  await createImportFileLinks({
    items: savedItems,
    organizationId: store.organization_id,
    storeId: store.id,
    supabase,
    plan: importFileLinkPlan,
  });
  const photoSaveResult =
    photoPlan.plannedFinalPhotos.length > 0
      ? await promotePlannedImportPhotos({
          organizationId: store.organization_id,
          photoPlan,
          savedItems,
          stagedMediaValidation,
          storeId: store.id,
          supabase,
        })
      : undefined;

  const response: IntelligentImportSaveApprovedResponse = {
    importFileLinkPlan,
    items: savedItems,
    message: "",
    ok: true,
    photoPlan: {
      ...photoPlan,
      warnings:
        photoPlan.receivedMediaRefs.length > 0
          ? Array.from(
              new Set([
                ...photoPlan.warnings,
                ...(photoSaveResult?.warnings ?? []),
              ])
            )
          : photoPlan.warnings,
    },
    photoSaveResult,
    reviewAudit: {
      globalReviewConfirmation,
      importFileAudit,
      structuredReviewSnapshot: structuredReviewAudit?.snapshot ?? null,
    },
    summary: {
      ...summary,
      saved: savedItems.length,
      valid: savedItems.length,
    },
    validateOnly: false,
  };
  response.message = buildResponseMessage(response);
  return response;
}
