import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  type IntelligentImportReviewedDestination,
  type IntelligentImportReviewedPoolPayload,
  type IntelligentImportReviewedSaveItem,
  type IntelligentImportSaveApprovedConflict,
  type IntelligentImportSaveApprovedImportFilePlan,
  type IntelligentImportSaveApprovedNormalizedPayload,
  type IntelligentImportSaveApprovedRequest,
  type IntelligentImportSaveApprovedResponse,
  type IntelligentImportSaveApprovedResultItem,
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

function normalizeMetadata(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
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

function validateReviewedImportedItem(
  item: IntelligentImportReviewedSaveItem,
  inputIndex: number,
  context: SaveValidationContext
): IntelligentImportSaveApprovedResultItem {
  const reasons: string[] = [];
  const destination = normalizeDestination(item.destination);

  if (!item.selected) reasons.push("Item nao marcado como selecionado/aprovado.");
  if (item.reviewState !== "approved") reasons.push("Item nao esta em estado approved.");
  if (item.duplicateBlocked) reasons.push("Item marcado como duplicado/bloqueado na origem.");
  if (item.reviewRequired) reasons.push("Item ainda exige revisao antes do salvamento.");
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
    if (normalizedPayload.price == null || normalizedPayload.price < 0) {
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
  if (!normalizedSku) reasons.push("SKU obrigatorio para item de catalogo.");
  if (normalizedPayload.price_cents == null || normalizedPayload.price_cents < 0) {
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

  if (response.validateOnly) {
    if (response.ok) {
      return `${response.summary.valid} item(ns) validos para salvar.`;
    }

    return `Validacao encontrou ${response.summary.invalid} item(ns) invalidos, ${response.summary.blockedDuplicate} duplicado(s) bloqueados e ${invalidImportFiles} importedFileId(s) invalido(s).`;
  }

  if (response.ok) {
    return `${response.summary.saved} item(ns) salvos com sucesso.`;
  }

  return `Salvamento bloqueado: ${response.summary.invalid} invalido(s), ${response.summary.blockedDuplicate} duplicado(s) e ${invalidImportFiles} importedFileId(s) invalido(s).`;
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
    importFileValidation.invalidImportedFileIds.length > 0;
  const validateOnly = Boolean(request.validateOnly);
  const debugParser = Boolean(request.context?.debugParser);

  if (!validateOnly && debugParser) {
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message:
        "Salvamento real bloqueado porque debugParser=true. Use apenas a validacao sem gravar neste modo.",
      ok: false,
      summary,
      validateOnly: false,
    };
    return response;
  }

  if (validateOnly || hasBlockingIssues) {
    const response: IntelligentImportSaveApprovedResponse = {
      importFileLinkPlan,
      items: validatedItems,
      message: "",
      ok: !hasBlockingIssues,
      summary,
      validateOnly,
    };
    response.message = buildResponseMessage(response);
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

  const response: IntelligentImportSaveApprovedResponse = {
    importFileLinkPlan,
    items: savedItems,
    message: "",
    ok: true,
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
