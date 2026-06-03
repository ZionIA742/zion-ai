import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { extractContractTextFromStoredFile } from "./contract-text-analysis";
import { extractSuggestedContractRules } from "./contract-rule-extraction";

const STORAGE_BUCKET = "zion-store-files";
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_STATUS_TRANSITIONS_FOR_APPROVAL = new Set([
  "uploaded",
  "analyzed",
  "awaiting_review",
  "approved",
  "active",
]);
const ALLOWED_STATUS_TRANSITIONS_FOR_ANALYSIS = new Set([
  "uploaded",
  "analyzing",
  "analyzed",
  "awaiting_review",
  "approved",
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

type StoreContractTemplateExtractedRuleRow = {
  id: string;
  template_version_id: string;
  organization_id: string;
  store_id: string;
  rule_key: string;
  rule_group: string;
  label: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  source_excerpt: string | null;
  confidence: number | null;
  review_status: string | null;
  sort_order: number | null;
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

async function loadTemplateExtractedRules(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  organizationId: string;
  storeId: string;
  templateVersionIds: string[];
}) {
  if (args.templateVersionIds.length === 0) {
    return [] as StoreContractTemplateExtractedRuleRow[];
  }

  const { data, error } = await args.supabase
    .from("store_contract_template_extracted_rules")
    .select(
      "id, template_version_id, organization_id, store_id, rule_key, rule_group, label, value_text, value_json, source_excerpt, confidence, review_status, sort_order, created_at, updated_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("template_version_id", args.templateVersionIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao carregar regras extraidas do contrato base: ${error.message}`);
  }

  return (data || []) as StoreContractTemplateExtractedRuleRow[];
}

async function loadTemplateExtractedRuleById(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  ruleId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_contract_template_extracted_rules")
    .select(
      "id, template_version_id, organization_id, store_id, rule_key, rule_group, label, value_text, value_json, source_excerpt, confidence, review_status, sort_order, created_at, updated_at"
    )
    .eq("id", args.ruleId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar regra extraida do contrato base: ${error.message}`);
  }

  return (data ?? null) as StoreContractTemplateExtractedRuleRow | null;
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

async function updateTemplateVersionStatus(args: {
  supabase: ReturnType<typeof createServiceSupabaseClient>;
  versionId: string;
  organizationId: string;
  storeId: string;
  status: string;
  rawExtractedText?: string | null;
  analysisSummary?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status: args.status,
    updated_at: now,
  };

  if (args.rawExtractedText !== undefined) {
    payload.raw_extracted_text = args.rawExtractedText;
  }

  if (args.analysisSummary !== undefined) {
    payload.analysis_summary = args.analysisSummary;
  }

  if (args.metadata !== undefined) {
    payload.metadata = args.metadata;
  }

  const { data, error } = await args.supabase
    .from("store_contract_template_versions")
    .update(payload)
    .eq("id", args.versionId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .select(
      "id, template_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, raw_extracted_text, analysis_summary, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, metadata, created_at, updated_at"
    )
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message || "Falha ao atualizar a versao do contrato base.");
  }

  return data as StoreContractTemplateVersionRow;
}

function buildTemplateSummary(
  template: StoreContractTemplateRow | null,
  versions: StoreContractTemplateVersionRow[],
  extractedRules: StoreContractTemplateExtractedRuleRow[]
) {
  if (!template) {
    return {
      template: null,
      activeVersion: null,
      versions: [],
      extractedRules: [],
    };
  }

  const activeVersion =
    versions.find((version) => version.id === template.active_version_id) || null;

  return {
    template,
    activeVersion,
    versions,
    extractedRules,
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
  const extractedRules =
    versions.length > 0
      ? await loadTemplateExtractedRules({
          supabase: scope.supabase,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
          templateVersionIds: versions.map((version) => version.id),
        })
      : [];

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(template, versions, extractedRules),
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
  const extractedRules = await loadTemplateExtractedRules({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateVersionIds: versions.map((item) => item.id),
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions, extractedRules),
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
  const extractedRules = await loadTemplateExtractedRules({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateVersionIds: versions.map((item) => item.id),
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions, extractedRules),
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
  const extractedRules =
    versions.length > 0
      ? await loadTemplateExtractedRules({
          supabase: scope.supabase,
          organizationId: scope.organizationId,
          storeId: scope.store.id,
          templateVersionIds: versions.map((item) => item.id),
        })
      : [];

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(template, versions, extractedRules),
    rejectedVersion: updatedVersion as StoreContractTemplateVersionRow,
  };
}

export async function analyzeStoreContractTemplateVersion(args: {
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
  const hasExtractedText = Boolean(cleanText(version.raw_extracted_text));
  const isActiveWithoutExtractedText = normalizedStatus === "active" && !hasExtractedText;

  if (normalizedStatus === "active" && !isActiveWithoutExtractedText) {
    throw new StoreContractTemplateAccessError(
      409,
      "ACTIVE_TEMPLATE_VERSION_CANNOT_BE_ANALYZED",
      "A versao ativa nao pode ser reanalisada por esta tela."
    );
  }

  if (normalizedStatus === "rejected" || normalizedStatus === "archived") {
    throw new StoreContractTemplateAccessError(
      409,
      "TEMPLATE_VERSION_NOT_ANALYZABLE",
      "Essa versao nao pode ser analisada no status atual."
    );
  }

  if (
    !ALLOWED_STATUS_TRANSITIONS_FOR_ANALYSIS.has(normalizedStatus) &&
    !isActiveWithoutExtractedText
  ) {
    throw new StoreContractTemplateAccessError(
      409,
      "TEMPLATE_VERSION_NOT_ANALYZABLE",
      "Essa versao nao pode ser analisada no status atual."
    );
  }

  const analyzingVersion = isActiveWithoutExtractedText
    ? (version as StoreContractTemplateVersionRow)
    : await updateTemplateVersionStatus({
        supabase: scope.supabase,
        versionId: version.id,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        status: "analyzing",
        metadata: {
          ...(version.metadata || {}),
          analysis_started_at: new Date().toISOString(),
          analysis_started_by_user_id: scope.userId,
        },
      });

  try {
    const fileName =
      cleanText(analyzingVersion.original_filename) ||
      `contrato-base-v${String(analyzingVersion.version_number || 0).padStart(4, "0")}.pdf`;
    const mimeType = cleanText(analyzingVersion.mime_type) || "application/octet-stream";
    const bucket = cleanText(analyzingVersion.storage_bucket);
    const storagePath = cleanText(analyzingVersion.storage_path);

    if (!bucket || !storagePath) {
      throw new Error("O arquivo privado dessa versao nao esta disponivel para leitura.");
    }

    const { data: fileData, error: downloadError } = await scope.supabase.storage
      .from(bucket)
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(
        downloadError?.message || "Nao foi possivel baixar o arquivo privado do contrato base."
      );
    }

    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    const extracted = await extractContractTextFromStoredFile({
      fileName,
      mimeType,
      buffer: fileBuffer,
    });

    if (!cleanText(extracted.text)) {
      throw new Error(
        "Nao foi possivel ler esse arquivo. Tente outro PDF ou DOCX com texto selecionavel."
      );
    }

    await updateTemplateVersionStatus({
      supabase: scope.supabase,
      versionId: version.id,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      status: isActiveWithoutExtractedText ? "active" : "awaiting_review",
      rawExtractedText: extracted.text,
      analysisSummary: extracted.summary,
      metadata: {
        ...(analyzingVersion.metadata || {}),
        analysis_completed_at: new Date().toISOString(),
        analysis_completed_by_user_id: scope.userId,
      },
    });
  } catch (error) {
    await updateTemplateVersionStatus({
      supabase: scope.supabase,
      versionId: version.id,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      status: isActiveWithoutExtractedText ? "active" : "failed",
      analysisSummary:
        error instanceof Error
          ? error.message
          : "Nao foi possivel ler esse arquivo nesta etapa.",
      metadata: {
        ...(analyzingVersion.metadata || {}),
        analysis_failed_at: new Date().toISOString(),
        analysis_failed_by_user_id: scope.userId,
      },
    });

    throw error;
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
  const extractedRules = await loadTemplateExtractedRules({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateVersionIds: versions.map((item) => item.id),
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions, extractedRules),
    analyzedVersion:
      versions.find((item) => item.id === version.id) || null,
  };
}

export async function extractStoreContractTemplateRules(args: {
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

  const rawText = cleanText(version.raw_extracted_text);
  if (!rawText) {
    throw new StoreContractTemplateAccessError(
      409,
      "TEMPLATE_TEXT_NOT_AVAILABLE",
      "Leia o contrato antes de buscar regras."
    );
  }

  const extractedRules = extractSuggestedContractRules(rawText);

  await scope.supabase
    .from("store_contract_template_extracted_rules")
    .delete()
    .eq("template_version_id", version.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id);

  if (extractedRules.length > 0) {
    const now = new Date().toISOString();
    const { error: insertError } = await scope.supabase
      .from("store_contract_template_extracted_rules")
      .insert(
        extractedRules.map((rule) => ({
          template_version_id: version.id,
          organization_id: scope.organizationId,
          store_id: scope.store.id,
          rule_key: rule.ruleKey,
          rule_group: rule.ruleGroup,
          label: rule.label,
          value_text: rule.valueText,
          value_json: {},
          source_excerpt: rule.sourceExcerpt,
          confidence: rule.confidence,
          review_status: "pending",
          sort_order: rule.sortOrder,
          created_at: now,
          updated_at: now,
        }))
      );

    if (insertError) {
      throw new Error(insertError.message || "Falha ao salvar regras do contrato base.");
    }
  }

  await updateTemplateVersionStatus({
    supabase: scope.supabase,
    versionId: version.id,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    status: String(version.status || "").trim().toLowerCase() === "active" ? "active" : String(version.status || "").trim().toLowerCase() || "awaiting_review",
    analysisSummary:
      extractedRules.length > 0
        ? `${extractedRules.length} regra(s) sugerida(s) para revisao humana.`
        : "Nenhuma regra confiavel foi encontrada no contrato.",
    metadata: {
      ...(version.metadata || {}),
      rules_extracted_at: new Date().toISOString(),
      rules_extracted_by_user_id: scope.userId,
      rules_extracted_count: extractedRules.length,
    },
  });

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
  const refreshedRules = await loadTemplateExtractedRules({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateVersionIds: versions.map((item) => item.id),
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(refreshedTemplate, versions, refreshedRules),
    extractedRuleCount: extractedRules.length,
  };
}

export async function reviewStoreContractTemplateRule(args: {
  ruleId: string;
  storeId: string;
  organizationId?: string | null;
  reviewStatus: "approved" | "rejected" | "edited";
  valueText?: string | null;
  label?: string | null;
}) {
  const scope = await resolveAuthorizedStoreTemplateScope(args);
  const ruleId = String(args.ruleId || "").trim();

  if (!ruleId) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_RULE_ID",
      "Rule ID nao informado."
    );
  }

  if (!["approved", "rejected", "edited"].includes(args.reviewStatus)) {
    throw new StoreContractTemplateAccessError(
      400,
      "INVALID_RULE_REVIEW_STATUS",
      "Status de revisao invalido."
    );
  }

  const rule = await loadTemplateExtractedRuleById({
    supabase: scope.supabase,
    ruleId,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
  });

  if (!rule?.id) {
    throw new StoreContractTemplateAccessError(
      404,
      "RULE_NOT_FOUND",
      "Regra do contrato nao encontrada nessa loja."
    );
  }

  const nextValueText = cleanText(args.valueText);
  const nextLabel = cleanText(args.label);
  const now = new Date().toISOString();

  const { data: updatedRule, error: updateError } = await scope.supabase
    .from("store_contract_template_extracted_rules")
    .update({
      review_status: args.reviewStatus,
      value_text: nextValueText ?? rule.value_text,
      label: nextLabel ?? rule.label,
      updated_at: now,
    })
    .eq("id", rule.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id)
    .select(
      "id, template_version_id, organization_id, store_id, rule_key, rule_group, label, value_text, value_json, source_excerpt, confidence, review_status, sort_order, created_at, updated_at"
    )
    .maybeSingle();

  if (updateError || !updatedRule?.id) {
    throw new Error(updateError?.message || "Falha ao atualizar revisao da regra.");
  }

  const version = await loadTemplateVersionById({
    supabase: scope.supabase,
    versionId: rule.template_version_id,
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

  const versions = await loadTemplateVersions({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateId: template.id,
  });
  const refreshedRules = await loadTemplateExtractedRules({
    supabase: scope.supabase,
    organizationId: scope.organizationId,
    storeId: scope.store.id,
    templateVersionIds: versions.map((item) => item.id),
  });

  return {
    store: scope.store,
    organizationId: scope.organizationId,
    ...buildTemplateSummary(template, versions, refreshedRules),
    reviewedRule: updatedRule as StoreContractTemplateExtractedRuleRow,
  };
}
