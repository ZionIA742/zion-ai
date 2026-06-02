import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

const STORAGE_BUCKET = "zion-store-files";
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_STATUS_TRANSITIONS_FOR_APPROVAL = new Set([
  "uploaded",
  "analyzed",
  "awaiting_review",
  "approved",
  "active",
]);
const TERMINAL_VERSION_STATUSES = new Set(["archived", "failed"]);
const ALLOWED_TEMPLATE_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
  created_at?: string | null;
};

type StoreContractTemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string | null;
  active_version_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateVersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  raw_extracted_text: string | null;
  analysis_summary: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

function cleanText(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getFileExtension(fileName: string) {
  const normalized = String(fileName || "").trim();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot < 0) return "";
  return normalized.slice(lastDot + 1).toLowerCase();
}

function normalizeTemplateMimeType(fileName: string, mimeType: string | null | undefined) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (ALLOWED_TEMPLATE_MIME_TYPES.has(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const extension = getFileExtension(fileName);
  if (extension === "pdf") return "application/pdf";
  if (extension === "doc") return "application/msword";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return normalizedMimeType;
}

function sanitizeFilePart(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildStoredTemplateFileName(fileName: string, versionNumber: number) {
  const normalized = String(fileName || "").trim();
  const extension = getFileExtension(normalized);
  const baseNameRaw = extension ? normalized.slice(0, -(extension.length + 1)) : normalized;
  const baseName = sanitizeFilePart(baseNameRaw) || "contrato-base";
  const safeExtension = sanitizeFilePart(extension) || "bin";
  return `${baseName}-v${String(versionNumber).padStart(4, "0")}.${safeExtension}`;
}

function buildTemplateStoragePath(args: {
  organizationId: string;
  storeId: string;
  templateId: string;
  versionNumber: number;
  originalFileName: string;
}) {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);
  const fileName = buildStoredTemplateFileName(args.originalFileName, args.versionNumber);

  return [
    args.organizationId,
    args.storeId,
    "contract-templates",
    args.templateId,
    `${timestamp}-v${String(args.versionNumber).padStart(4, "0")}-${random}`,
    fileName,
  ].join("/");
}

function uniqueOrganizationIds(rows: MembershipRow[]) {
  return Array.from(
    new Set(rows.map((row) => String(row.organization_id || "").trim()).filter(Boolean))
  );
}

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

export class StoreContractTemplateAccessError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function buildStoreContractTemplateErrorResponse(error: unknown) {
  if (error instanceof StoreContractTemplateAccessError) {
    return Response.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Erro interno ao processar contrato base da loja.",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}

async function authenticateTemplateRequest() {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    throw new StoreContractTemplateAccessError(
      401,
      "UNAUTHENTICATED",
      "Usuario nao autenticado."
    );
  }

  const supabase = createServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw new StoreContractTemplateAccessError(
      500,
      "LOAD_MEMBERSHIPS_FAILED",
      membershipError.message
    );
  }

  const organizationIds = uniqueOrganizationIds((memberships ?? []) as MembershipRow[]);
  if (organizationIds.length === 0) {
    throw new StoreContractTemplateAccessError(
      403,
      "NO_ORGANIZATION_ACCESS",
      "Usuario sem acesso a organizacoes."
    );
  }

  return {
    user,
    userId: user.id,
    supabase,
    organizationIds,
  };
}

async function loadAuthorizedStore(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationIds: string[];
  storeId: string;
  organizationId?: string | null;
}) {
  const storeId = String(args.storeId || "").trim();
  const requestedOrganizationId = String(args.organizationId || "").trim();

  if (!storeId) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_STORE_ID",
      "Store ID nao informado."
    );
  }

  const { data, error } = await args.supabase
    .from("stores")
    .select("id, organization_id, name, created_at")
    .eq("id", storeId)
    .in("organization_id", args.organizationIds)
    .maybeSingle();

  if (error) {
    throw new StoreContractTemplateAccessError(500, "LOAD_STORE_FAILED", error.message);
  }

  if (!data) {
    throw new StoreContractTemplateAccessError(
      403,
      "STORE_FORBIDDEN",
      "Loja nao encontrada ou fora do escopo do usuario."
    );
  }

  if (requestedOrganizationId && requestedOrganizationId !== data.organization_id) {
    throw new StoreContractTemplateAccessError(
      403,
      "ORGANIZATION_STORE_MISMATCH",
      "A organizacao informada nao corresponde a loja selecionada."
    );
  }

  return data as StoreRow;
}

async function resolveAuthorizedStoreTemplateScope(args: {
  storeId: string;
  organizationId?: string | null;
}) {
  const auth = await authenticateTemplateRequest();
  const store = await loadAuthorizedStore({
    supabase: auth.supabase,
    organizationIds: auth.organizationIds,
    storeId: args.storeId,
    organizationId: args.organizationId,
  });

  return {
    ...auth,
    store,
    organizationId: store.organization_id,
  };
}

async function loadStoreContractTemplate(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_contract_templates")
    .select("id, organization_id, store_id, status, active_version_id, created_at, updated_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar store_contract_templates: ${error.message}`);
  }

  return (data ?? null) as StoreContractTemplateRow | null;
}

async function createStoreContractTemplate(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
}) {
  const now = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("store_contract_templates")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      status: "draft",
      active_version_id: null,
      created_at: now,
      updated_at: now,
    })
    .select("id, organization_id, store_id, status, active_version_id, created_at, updated_at")
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message || "Falha ao criar store_contract_templates.");
  }

  return data as StoreContractTemplateRow;
}

async function ensureStoreContractTemplate(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
}) {
  const existing = await loadStoreContractTemplate(args);
  if (existing?.id) return existing;
  return createStoreContractTemplate(args);
}

async function loadTemplateVersions(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
  templateId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_contract_template_versions")
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("template_id", args.templateId)
    .order("version_number", { ascending: false });

  if (error) {
    throw new Error(`Falha ao carregar versoes do contrato base: ${error.message}`);
  }

  return (data || []) as StoreContractTemplateVersionRow[];
}

async function getNextTemplateVersionNumber(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  templateId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_contract_template_versions")
    .select("version_number")
    .eq("template_id", args.templateId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .order("version_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao calcular nova versao do contrato base: ${error.message}`);
  }

  const current = Array.isArray(data) && data[0]?.version_number ? Number(data[0].version_number) : 0;
  return Math.max(1, current + 1);
}

async function loadTemplateVersionById(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  versionId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_contract_template_versions")
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .eq("id", args.versionId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar versao do contrato base: ${error.message}`);
  }

  return (data ?? null) as StoreContractTemplateVersionRow | null;
}

function buildTemplateSummary(template: StoreContractTemplateRow | null, versions: StoreContractTemplateVersionRow[]) {
  if (!template) {
    return {
      template: null,
      activeVersion: null,
      versions: [],
    };
  }

  const activeVersion =
    versions.find((version) => version.id === template.active_version_id) || null;

  return {
    template,
    activeVersion,
    versions,
  };
}

export async function listStoreContractTemplate(args: {
  storeId: string;
  organizationId?: string | null;
}) {
  const scope = await resolveAuthorizedStoreTemplateScope(args);
  const template = await loadStoreContractTemplate({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });

  const versions = template?.id
    ? await loadTemplateVersions({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        templateId: template.id,
      })
    : [];

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(template, versions),
  };
}

export async function uploadStoreContractTemplateVersion(args: {
  storeId: string;
  organizationId?: string | null;
  file: File;
}) {
  const scope = await resolveAuthorizedStoreTemplateScope(args);
  const file = args.file;

  if (!(file instanceof File)) {
    throw new StoreContractTemplateAccessError(
      400,
      "FILE_REQUIRED",
      "Selecione um arquivo valido do contrato base."
    );
  }

  if (file.size <= 0) {
    throw new StoreContractTemplateAccessError(
      400,
      "EMPTY_FILE",
      "O arquivo enviado esta vazio."
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new StoreContractTemplateAccessError(
      400,
      "FILE_TOO_LARGE",
      "O contrato base deve ter no maximo 15 MB."
    );
  }

  const normalizedMimeType = normalizeTemplateMimeType(file.name, file.type);
  if (!ALLOWED_TEMPLATE_MIME_TYPES.has(normalizedMimeType)) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_FILE_TYPE",
      "Envie um arquivo PDF, DOC ou DOCX do contrato base."
    );
  }

  const template = await ensureStoreContractTemplate({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });
  const versionNumber = await getNextTemplateVersionNumber({
    supabase: scope.supabase,
    templateId: template.id,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });
  const storagePath = buildTemplateStoragePath({
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateId: template.id,
    versionNumber,
    originalFileName: file.name,
  });
  const originalFilename = buildStoredTemplateFileName(file.name, versionNumber);
  const uploadBody = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await scope.supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, uploadBody, {
      upsert: false,
      contentType: normalizedMimeType,
    });

  if (uploadError) {
    throw new Error(`Falha ao salvar contrato base no storage: ${uploadError.message}`);
  }

  const { data: storeFile, error: storeFileError } = await scope.supabase
    .from("store_files")
    .insert({
      organization_id: scope.organizationId,
      store_id: scope.store.id,
      file_kind: "store_contract_template_source",
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: normalizedMimeType,
      size_bytes: uploadBody.byteLength,
      uploaded_by: scope.userId,
    })
    .select("id")
    .maybeSingle();

  if (storeFileError || !storeFile?.id) {
    await scope.supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(
      storeFileError?.message || "Falha ao registrar contrato base em store_files."
    );
  }

  const now = new Date().toISOString();
  const { data: version, error: versionError } = await scope.supabase
    .from("store_contract_template_versions")
    .insert({
      template_id: template.id,
      organization_id: scope.organizationId,
      store_id: scope.store.id,
      version_number: versionNumber,
      status: "uploaded",
      store_file_id: storeFile.id,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: normalizedMimeType,
      size_bytes: uploadBody.byteLength,
      metadata: {
        source: "api_store_contract_templates_upload",
        uploaded_by_user_id: scope.userId,
        uploaded_original_filename: file.name,
      },
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .maybeSingle();

  if (versionError || !version?.id) {
    await scope.supabase.from("store_files").delete().eq("id", storeFile.id);
    await scope.supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(
      versionError?.message || "Falha ao registrar versao do contrato base."
    );
  }

  await scope.supabase
    .from("store_contract_templates")
    .update({
      updated_at: now,
      status: cleanText(template.active_version_id) ? "active" : "draft",
    })
    .eq("id", template.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id);

  const versions = await loadTemplateVersions({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateId: template.id,
  });

  const refreshedTemplate =
    (await loadStoreContractTemplate({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    })) || template;

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions),
    uploadedVersion: version as StoreContractTemplateVersionRow,
  };
}

export async function approveStoreContractTemplateVersion(args: {
  versionId: string;
  storeId: string;
  organizationId?: string | null;
}) {
  const scope = await resolveAuthorizedStoreTemplateScope(args);
  const versionId = String(args.versionId || "").trim();

  if (!versionId) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_TEMPLATE_VERSION_ID",
      "Version ID nao informado."
    );
  }

  const version = await loadTemplateVersionById({
    supabase: scope.supabase,
    versionId,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });

  if (!version?.id) {
    throw new StoreContractTemplateAccessError(
      404,
      "TEMPLATE_VERSION_NOT_FOUND",
      "Versao do contrato base nao encontrada nessa loja."
    );
  }

  const template = await loadStoreContractTemplate({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });

  if (!template?.id || template.id !== version.template_id) {
    throw new StoreContractTemplateAccessError(
      404,
      "TEMPLATE_NOT_FOUND",
      "Template do contrato base nao encontrado nessa loja."
    );
  }

  const normalizedStatus = String(version.status || "").trim().toLowerCase();
  if (TERMINAL_VERSION_STATUSES.has(normalizedStatus) || normalizedStatus === "rejected") {
    throw new StoreContractTemplateAccessError(
      409,
      "TEMPLATE_VERSION_NOT_APPROVABLE",
      "Esta versao do contrato base nao pode ser aprovada no status atual."
    );
  }

  if (!ALLOWED_STATUS_TRANSITIONS_FOR_APPROVAL.has(normalizedStatus)) {
    throw new StoreContractTemplateAccessError(
      409,
      "TEMPLATE_VERSION_NOT_APPROVABLE",
      "Apenas versoes uploaded, analyzed ou awaiting_review podem ser ativadas."
    );
  }

  const now = new Date().toISOString();

  await scope.supabase
    .from("store_contract_template_versions")
    .update({
      status: "archived",
      updated_at: now,
    })
    .eq("template_id", template.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .eq("status", "active")
    .neq("id", version.id);

  const { data: updatedVersion, error: versionError } = await scope.supabase
    .from("store_contract_template_versions")
    .update({
      status: "active",
      approved_at: now,
      approved_by: scope.userId,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("id", version.id)
    .eq("template_id", template.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .maybeSingle();

  if (versionError || !updatedVersion?.id) {
    throw new Error(versionError?.message || "Falha ao ativar a versao do contrato base.");
  }

  const { error: templateError } = await scope.supabase
    .from("store_contract_templates")
    .update({
      active_version_id: updatedVersion.id,
      status: "active",
      updated_at: now,
    })
    .eq("id", template.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id);

  if (templateError) {
    throw new Error(templateError.message || "Falha ao atualizar template ativo.");
  }

  const refreshedTemplate = await loadStoreContractTemplate({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });
  const versions = await loadTemplateVersions({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateId: template.id,
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions),
    approvedVersion: updatedVersion as StoreContractTemplateVersionRow,
  };
}

export async function rejectStoreContractTemplateVersion(args: {
  versionId: string;
  storeId: string;
  organizationId?: string | null;
  rejectionReason?: string | null;
}) {
  const scope = await resolveAuthorizedStoreTemplateScope(args);
  const versionId = String(args.versionId || "").trim();

  if (!versionId) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_TEMPLATE_VERSION_ID",
      "Version ID nao informado."
    );
  }

  const version = await loadTemplateVersionById({
    supabase: scope.supabase,
    versionId,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });

  if (!version?.id) {
    throw new StoreContractTemplateAccessError(
      404,
      "TEMPLATE_VERSION_NOT_FOUND",
      "Versao do contrato base nao encontrada nessa loja."
    );
  }

  if (String(version.status || "").trim().toLowerCase() === "active") {
    throw new StoreContractTemplateAccessError(
      409,
      "ACTIVE_TEMPLATE_VERSION_CANNOT_BE_REJECTED",
      "A versao ativa do contrato base nao pode ser rejeitada."
    );
  }

  const now = new Date().toISOString();
  const { data: updatedVersion, error } = await scope.supabase
    .from("store_contract_template_versions")
    .update({
      status: "rejected",
      rejected_at: now,
      rejected_by: scope.userId,
      rejection_reason: cleanText(args.rejectionReason),
      updated_at: now,
    })
    .eq("id", version.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .maybeSingle();

  if (error || !updatedVersion?.id) {
    throw new Error(error?.message || "Falha ao rejeitar versao do contrato base.");
  }

  const template = await loadStoreContractTemplate({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });
  const versions = template?.id
    ? await loadTemplateVersions({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        templateId: template.id,
      })
    : [];

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(template, versions),
    rejectedVersion: updatedVersion as StoreContractTemplateVersionRow,
  };
}
