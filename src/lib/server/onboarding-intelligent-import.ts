import {
  extractTextFromFile,
  type ExtractedImageAsset,
  type ExtractedFileDiagnostics,
  type XlsxImageExtractionDiagnostics,
} from "./onboarding-file-extractors";
import {
  normalizeMultipleExtractedFiles,
  normalizeMultipleExtractedFilesDetailed,
  type NormalizedImportDebug,
  type NormalizedImportItem,
} from "./onboarding-import-normalizers";
import {
  dedupNormalizedItems,
  type DedupedImportItem,
} from "./onboarding-import-dedup";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import type { IntelligentImportStagedMediaAsset } from "@/lib/onboarding-intelligent-import-save-contract";

export type ImportableFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type IntelligentImportParams = {
  organizationId: string;
  storeId: string;
  files: ImportableFile[];
  debugParser?: boolean;
  uploadedBy?: string | null;
  persistRawFiles?: boolean;
  source?: string;
};

export type IntelligentImportPersistedFile = {
  id: string;
  importBatchId?: string | null;
  originalFileName: string;
  storageBucket: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string | null;
  status: string | null;
};

export type IntelligentImportParserDebug = {
  enabled: boolean;
  extraction: Array<{
    fileName: string;
    mimeType?: string;
    charCount: number;
    approxLineCount: number;
    usefulLinesPreview: string[];
    looksLikeContinuousText: boolean;
  }>;
  normalization: NormalizedImportDebug;
  dedupe: {
    inputCount: number;
    outputCount: number;
    duplicateCount: number;
    duplicates: Array<{
      title: string;
      dedupKey: string;
      duplicateOf?: string;
    }>;
  };
  filter: {
    inputCount: number;
    outputCount: number;
    filteredOut: Array<{
      title: string;
      type: string;
      confidence: number;
      reason: string;
    }>;
  };
};

export type IntelligentImportImageDiagnostics = {
  totalExtractedImagesRaw: number;
  totalAliasedImages: number;
  files: Array<{
    fileName: string;
    extension: string;
    extractedImages: number;
    xlsxImageDiagnostics?: XlsxImageExtractionDiagnostics;
  }>;
};

type IntelligentImportSummary = {
  totalFiles: number;
  extractedFiles: number;
  normalizedItems: number;
  dedupedItems: number;
  duplicateItems: number;
  extractedImages: number;
};

type IntelligentImportPreviewImage = {
  sourceFileName: string;
  originalSourceFileName?: string;
  fileName: string;
  source: ExtractedImageAsset["source"];
  mimeType: string;
  dataUrl: string;
  sheetName?: string;
  rowIndex?: number;
  columnIndex?: number;
  anchorCell?: string;
  drawingName?: string;
  imageRelationshipId?: string;
  imageOrder?: number;
  worksheetRowNumber?: number;
  sheetScopedKey?: string;
};

export type IntelligentImportResult =
  | {
      ok: true;
      importedFileIds: string[];
      importedFiles: IntelligentImportPersistedFile[];
      mediaStagingWarnings: string[];
      rawFilePersistenceWarnings: string[];
      stagedMediaAssetIds: string[];
      stagedMediaAssets: IntelligentImportStagedMediaAsset[];
      summary: IntelligentImportSummary;
      extractedPreview: Array<{
        fileName: string;
        mimeType: string;
        extension: string;
        textPreview: string;
      }>;
      extractedImagePreview: IntelligentImportPreviewImage[];
      imageDiagnostics: IntelligentImportImageDiagnostics;
      normalizedPreview: NormalizedImportItem[];
      dedupedPreview: DedupedImportItem[];
      parserDebug?: IntelligentImportParserDebug;
    }
  | {
      ok: false;
      error: string;
      message: string;
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

const DEBUG_INTELLIGENT_IMPORT =
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_INTELLIGENT_IMPORT === "1" ||
  process.env.NEXT_PUBLIC_DEBUG_INTELLIGENT_IMPORT === "1";

function debugIntelligentImport(...args: unknown[]) {
  if (!DEBUG_INTELLIGENT_IMPORT) return;
  console.log("[ZION][intelligent-import][server]", ...args);
}

function buildPreview(text: string, max = 300) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function sanitizeImportRawFileName(fileName: string) {
  return String(fileName || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-120) || "arquivo";
}

function getMimeExtension(mimeType: string | null | undefined) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "image/svg+xml") return "svg";
  return null;
}

function getMediaFileExtension(fileName: string, mimeType: string | null | undefined) {
  const fromName = getFileExtension(fileName);
  if (fromName) return fromName;
  return getMimeExtension(mimeType) || "bin";
}

function buildImportedMediaStoragePath(args: {
  organizationId: string;
  storeId: string;
  importBatchId: string;
  stagingAssetId: string;
  fileName: string;
}) {
  const safeName = sanitizeImportRawFileName(args.fileName);
  return `${args.organizationId}/${args.storeId}/${args.importBatchId}/media/${args.stagingAssetId}-${safeName}`;
}

function buildImageSourceLocationKey(args: {
  sourceFileName: string;
  sheetScopedKey?: string | null;
  sheetName?: string | null;
  worksheetRowNumber?: number | null;
}) {
  const sourceFileName = String(args.sourceFileName || "").trim();
  const sheetScopedKey = String(args.sheetScopedKey || "").trim();
  if (sourceFileName && sheetScopedKey) {
    return `${sourceFileName}::${sheetScopedKey}`;
  }
  const sheetName = normalizeLoose(String(args.sheetName || ""));
  const worksheetRowNumber =
    typeof args.worksheetRowNumber === "number" && Number.isFinite(args.worksheetRowNumber) && args.worksheetRowNumber > 0
      ? Math.floor(args.worksheetRowNumber)
      : null;
  if (sourceFileName && sheetName && worksheetRowNumber != null) {
    return `${sourceFileName}::${sheetName}::row::${worksheetRowNumber}`;
  }
  return "";
}

function dataUrlToBuffer(dataUrl: string) {
  const normalized = String(dataUrl || "").trim();
  const commaIndex = normalized.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("dataUrl invalido para staging de midia.");
  }
  return Buffer.from(normalized.slice(commaIndex + 1), "base64");
}

async function persistStagedXlsxMediaAssets(args: {
  extractedImagePreview: IntelligentImportPreviewImage[];
  importedFiles: IntelligentImportPersistedFile[];
  organizationId: string;
  storeId: string;
  uploadedBy?: string | null;
}) {
  const mediaStagingWarnings: string[] = [];
  const stagedMediaAssets: IntelligentImportStagedMediaAsset[] = [];
  const seenStagingKeys = new Set<string>();
  const importedXlsxFiles = args.importedFiles.filter((file) => {
    const extension = getFileExtension(file.originalFileName);
    return extension === "xlsx" || extension === "xlsm";
  });
  const importedFileByName = new Map(
    importedXlsxFiles.map((file) => [normalizeLoose(file.originalFileName), file])
  );

  if (args.extractedImagePreview.length === 0 || importedXlsxFiles.length === 0) {
    return {
      mediaStagingWarnings,
      stagedMediaAssetIds: [] as string[],
      stagedMediaAssets,
    };
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch (error) {
    return {
      mediaStagingWarnings: [
        `Persistencia de staging de midia indisponivel neste ambiente: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      stagedMediaAssetIds: [] as string[],
      stagedMediaAssets,
    };
  }

  for (const image of args.extractedImagePreview) {
    const sourceKind = String(image.source || "").trim().toLowerCase();
    if (sourceKind !== "xlsx") continue;

    const sourceFileName = String(image.originalSourceFileName || image.sourceFileName || "").trim();
    const importedFile = importedFileByName.get(normalizeLoose(sourceFileName));
    if (!importedFile?.id || !importedFile.importBatchId) {
      mediaStagingWarnings.push(
        `Imagem XLSX ${image.fileName || "(sem nome)"} nao encontrou importFile/importBatch correspondente para staging.`
      );
      continue;
    }

    const worksheetRowNumber =
      typeof image.worksheetRowNumber === "number" && Number.isFinite(image.worksheetRowNumber) && image.worksheetRowNumber > 0
        ? Math.floor(image.worksheetRowNumber)
        : null;
    const sheetScopedKey = String(image.sheetScopedKey || "").trim() || null;
    const sourceLocationKey =
      buildImageSourceLocationKey({
        sourceFileName,
        sheetName: image.sheetName,
        sheetScopedKey,
        worksheetRowNumber,
      }) || null;
    const sourceImageId = [
      normalizeLoose(sourceFileName),
      normalizeLoose(String(sheetScopedKey || sourceLocationKey || image.anchorCell || "")),
      normalizeLoose(String(image.imageRelationshipId || image.fileName || "")),
    ]
      .filter(Boolean)
      .join("::");

    if (!sourceFileName || (!sheetScopedKey && !sourceLocationKey) || worksheetRowNumber == null) {
      mediaStagingWarnings.push(
        `Imagem XLSX ${image.fileName || "(sem nome)"} ficou fora do staging por faltar sourceFileName/sheetScopedKey/worksheetRowNumber fortes.`
      );
      continue;
    }

    const stagingAssetId = crypto.randomUUID();
    const fileExtension = getMediaFileExtension(image.fileName, image.mimeType);
    const stagedFileNameBase = String(image.fileName || `xlsx-row-image.${fileExtension}`).trim();
    const stagedFileName = stagedFileNameBase.includes(".")
      ? stagedFileNameBase
      : `${stagedFileNameBase}.${fileExtension}`;

    try {
      const buffer = dataUrlToBuffer(image.dataUrl);
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
      const dedupeKey = [
        importedFile.importBatchId,
        normalizeLoose(sourceImageId || ""),
        normalizeLoose(sourceLocationKey || ""),
        normalizeLoose(sheetScopedKey || ""),
        String(worksheetRowNumber || ""),
        checksum,
      ].join("::");

      if (seenStagingKeys.has(dedupeKey)) {
        continue;
      }
      seenStagingKeys.add(dedupeKey);

      const storagePath = buildImportedMediaStoragePath({
        organizationId: args.organizationId,
        storeId: args.storeId,
        importBatchId: importedFile.importBatchId,
        stagingAssetId,
        fileName: stagedFileName,
      });
      const { error: uploadError } = await supabase.storage
        .from("store-import-files")
        .upload(storagePath, buffer, {
          upsert: false,
          contentType: image.mimeType || "application/octet-stream",
        });

      if (uploadError) {
        mediaStagingWarnings.push(
          `Falha ao subir staging de imagem XLSX ${stagedFileName}: ${uploadError.message}`
        );
        continue;
      }

      const insertPayload = {
        id: stagingAssetId,
        association_strength: "strong_auto",
        checksum,
        created_by: args.uploadedBy || null,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        file_name: stagedFileName,
        height: null,
        import_batch_id: importedFile.importBatchId,
        import_file_id: importedFile.id,
        metadata: {
          anchorCell: image.anchorCell || null,
          columnIndex: typeof image.columnIndex === "number" ? image.columnIndex : null,
          drawingName: image.drawingName || null,
          imageOrder: typeof image.imageOrder === "number" ? image.imageOrder : null,
          imageRelationshipId: image.imageRelationshipId || null,
          rowIndex: typeof image.rowIndex === "number" ? image.rowIndex : null,
          source: "xlsx",
          sourceFileName,
          sheetName: image.sheetName || null,
        },
        normalized_mime_type: image.mimeType || null,
        organization_id: args.organizationId,
        original_mime_type: image.mimeType || null,
        page_number: null,
        requires_user_confirmation: false,
        sheet_scoped_key: sheetScopedKey,
        size_bytes: buffer.length,
        source_file_name: sourceFileName,
        source_image_id: sourceImageId || null,
        source_kind: "xlsx_row_image",
        source_location_key: sourceLocationKey,
        status: "staged",
        storage_bucket: "store-import-files",
        storage_path: storagePath,
        store_id: args.storeId,
        width: null,
        worksheet_row_number: worksheetRowNumber,
      };

      const { data: createdRow, error: insertError } = await supabase
        .from("store_import_media_assets")
        .insert(insertPayload)
        .select(
          "id, import_batch_id, import_file_id, source_file_name, source_kind, source_location_key, sheet_scoped_key, worksheet_row_number, file_name, size_bytes, normalized_mime_type, storage_bucket, storage_path, association_strength, requires_user_confirmation"
        )
        .single();

      if (insertError) {
        const { error: rollbackError } = await supabase.storage
          .from("store-import-files")
          .remove([storagePath]);
        if (rollbackError) {
          mediaStagingWarnings.push(
            `Falha ao compensar storage do staging ${stagedFileName}: ${rollbackError.message}`
          );
        }
        mediaStagingWarnings.push(
          `Falha ao registrar staging de imagem XLSX ${stagedFileName}: ${insertError.message}`
        );
        continue;
      }

      stagedMediaAssets.push({
        associationStrength: "strong_auto",
        fileName: String((createdRow as any).file_name || stagedFileName),
        id: String(createdRow.id || stagingAssetId),
        importBatchId: String((createdRow as any).import_batch_id || importedFile.importBatchId || "").trim() || null,
        importFileId: String((createdRow as any).import_file_id || importedFile.id || "").trim() || null,
        mimeType: ((createdRow as any).normalized_mime_type as string | null) ?? image.mimeType ?? null,
        requiresUserConfirmation: Boolean((createdRow as any).requires_user_confirmation),
        sheetScopedKey: String((createdRow as any).sheet_scoped_key || "").trim() || null,
        sizeBytes: Number((createdRow as any).size_bytes || buffer.length),
        sourceFileName: String((createdRow as any).source_file_name || sourceFileName || "").trim() || null,
        sourceKind: "xlsx_row_image",
        sourceLocationKey: String((createdRow as any).source_location_key || sourceLocationKey || "").trim() || null,
        stagingStorageRef: `store-import-files/${String((createdRow as any).storage_path || storagePath)}`,
        storageBucket: String((createdRow as any).storage_bucket || "store-import-files"),
        storagePath: String((createdRow as any).storage_path || storagePath),
        worksheetRowNumber:
          typeof (createdRow as any).worksheet_row_number === "number"
            ? Math.floor((createdRow as any).worksheet_row_number)
            : worksheetRowNumber,
      });
    } catch (error) {
      mediaStagingWarnings.push(
        `Falha inesperada ao persistir staging de imagem XLSX ${image.fileName || "(sem nome)"}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    mediaStagingWarnings: Array.from(new Set(mediaStagingWarnings)),
    stagedMediaAssetIds: stagedMediaAssets.map((asset) => asset.id),
    stagedMediaAssets,
  };
}

function getFileExtension(fileName: string) {
  const normalized = String(fileName || "").trim();
  const extension = normalized.includes(".") ? normalized.split(".").pop() : "";
  return String(extension || "").trim().toLowerCase() || null;
}

function buildImportedRawFileStoragePath(args: {
  organizationId: string;
  storeId: string;
  importBatchId: string;
  fileName: string;
}) {
  const safeName = sanitizeImportRawFileName(args.fileName);
  return `${args.organizationId}/${args.storeId}/${args.importBatchId}/${crypto.randomUUID()}-${safeName}`;
}

async function persistImportedRawFiles(args: {
  files: ImportableFile[];
  organizationId: string;
  storeId: string;
  uploadedBy?: string | null;
  importSummary: IntelligentImportSummary;
  source?: string;
}) {
  const warnings: string[] = [];
  const importedFiles: IntelligentImportPersistedFile[] = [];
  const importedFileIds: string[] = [];
  const importBatchId = crypto.randomUUID();
  let supabase: ReturnType<typeof createServiceSupabaseClient>;

  try {
    supabase = createServiceSupabaseClient();
  } catch (error) {
    return {
      importedFileIds,
      importedFiles,
      rawFilePersistenceWarnings: [
        `Persistencia de arquivo bruto indisponivel neste ambiente: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  for (const file of args.files) {
    const storagePath = buildImportedRawFileStoragePath({
      organizationId: args.organizationId,
      storeId: args.storeId,
      importBatchId,
      fileName: file.fileName,
    });

    try {
      const { error: uploadError } = await supabase.storage
        .from("store-import-files")
        .upload(storagePath, file.buffer, {
          upsert: false,
          contentType: file.mimeType || "application/octet-stream",
        });

      if (uploadError) {
        warnings.push(`Falha ao persistir arquivo bruto ${file.fileName}: ${uploadError.message}`);
        continue;
      }

      const insertPayload = {
        organization_id: args.organizationId,
        store_id: args.storeId,
        uploaded_by: args.uploadedBy || null,
        source: args.source || "onboarding_intelligent_import",
        original_file_name: file.fileName,
        mime_type: file.mimeType || null,
        extension: getFileExtension(file.fileName),
        size_bytes: file.buffer.length,
        storage_bucket: "store-import-files",
        storage_path: storagePath,
        import_summary: args.importSummary,
        status: "active",
        import_batch_id: importBatchId,
        file_hash: null,
      };

      let createdRow: any = null;
      let insertError: any = null;

      const fullInsert = await supabase
        .from("store_import_files")
        .insert(insertPayload)
        .select("id, original_file_name, storage_bucket, storage_path, size_bytes, mime_type, status")
        .single();

      createdRow = fullInsert.data;
      insertError = fullInsert.error;

      if (insertError) {
        const fallbackInsert = await supabase
          .from("store_import_files")
          .insert({
            organization_id: args.organizationId,
            store_id: args.storeId,
            source: args.source || "onboarding_intelligent_import",
            original_file_name: file.fileName,
            mime_type: file.mimeType || null,
            extension: getFileExtension(file.fileName),
            size_bytes: file.buffer.length,
            storage_bucket: "store-import-files",
            storage_path: storagePath,
            import_summary: args.importSummary,
            status: "active",
          })
          .select("id, original_file_name, storage_bucket, storage_path, size_bytes, mime_type, status")
          .single();

        createdRow = fallbackInsert.data;
        insertError = fallbackInsert.error;
      }

      if (insertError) {
        const { error: rollbackError } = await supabase.storage
          .from("store-import-files")
          .remove([storagePath]);
        if (rollbackError) {
          warnings.push(
            `Falha ao compensar storage do arquivo bruto ${file.fileName}: ${rollbackError.message}`
          );
        }
        warnings.push(`Falha ao registrar metadata do arquivo bruto ${file.fileName}: ${insertError.message}`);
        continue;
      }

      importedFileIds.push(String(createdRow.id || ""));
      importedFiles.push({
        id: String(createdRow.id || ""),
        importBatchId,
        originalFileName: String(createdRow.original_file_name || file.fileName),
        storageBucket: String((createdRow as any).storage_bucket || "store-import-files"),
        storagePath: String(createdRow.storage_path || storagePath),
        sizeBytes: Number((createdRow as any).size_bytes || file.buffer.length),
        mimeType: ((createdRow as any).mime_type as string | null) ?? file.mimeType ?? null,
        status: ((createdRow as any).status as string | null) ?? "active",
      });
    } catch (error) {
      warnings.push(
        `Falha inesperada ao persistir arquivo bruto ${file.fileName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    importedFileIds,
    importedFiles,
    rawFilePersistenceWarnings: warnings,
  };
}

function normalizeLoose(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItemSheetName(item: NormalizedImportItem) {
  const metadataCandidates = [
    item.metadata?.source_sheet_name,
    item.metadata?.sheet_name,
    item.metadata?.sheetName,
    item.metadata?.planilha,
    item.metadata?.sheet,
    item.metadata?.sourceCategory,
    item.metadata?.source_category,
    item.metadata?.categoria,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (metadataCandidates.length > 0) {
    return metadataCandidates[0];
  }

  const rawText = String(item.rawText || "");
  const match =
    rawText.match(/(?:^|\n)planilha\s*:\s*([^\n|]+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*([^=|\n]+)/i) ||
    rawText.match(/(?:^|\n)sheet\s*:\s*([^\n|]+)/i) ||
    rawText.match(/(?:^|\n)aba\s*:\s*([^\n|]+)/i);

  return match?.[1]?.trim() || "";
}

function extractItemWorksheetRowNumber(item: NormalizedImportItem) {
  const metadataCandidates = [
    item.metadata?.source_worksheet_row_number,
    item.metadata?.worksheet_row_number,
    item.metadata?.worksheetRowNumber,
    item.metadata?.source_row_number,
    item.metadata?.row_number,
    item.metadata?.sheet_row_number,
  ]
    .map((value) => Number(String(value ?? "").replace(/[^\d-]/g, "")))
    .find((value) => Number.isFinite(value) && value > 0);

  if (metadataCandidates != null) return metadataCandidates;

  const rawText = String(item.rawText || "");
  const match =
    rawText.match(/(?:^|\n)linha da planilha\s*:\s*(\d+)/i) ||
    rawText.match(/===\s*item\s*\d+\s*\|\s*planilha\s*:\s*[^|\n=]+\|\s*linha\s*:\s*(\d+)/i) ||
    rawText.match(/(?:^|\n)worksheet row number\s*:\s*(\d+)/i);

  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSheetScopedKey(sheetName: string, worksheetRowNumber: number | null | undefined) {
  const normalizedSheetName = normalizeLoose(sheetName);
  if (!normalizedSheetName || !Number.isFinite(worksheetRowNumber as number) || Number(worksheetRowNumber) <= 0) {
    return "";
  }
  return `${normalizedSheetName}::row::${Number(worksheetRowNumber)}`;
}

function enrichItemWithImportCoordinates(item: NormalizedImportItem) {
  const sourceSheetName = extractItemSheetName(item);
  const worksheetRowNumber = extractItemWorksheetRowNumber(item);
  const sheetScopedKey = buildSheetScopedKey(sourceSheetName, worksheetRowNumber);
  const originalSourceFileName = String(item.sourceFileName || "").trim();

  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      source_file_name_original:
        String(item.metadata?.source_file_name_original || item.metadata?.original_source_file_name || "").trim() ||
        originalSourceFileName,
      source_sheet_name:
        String(item.metadata?.source_sheet_name || item.metadata?.sheet_name || item.metadata?.sheetName || "").trim() ||
        sourceSheetName ||
        "",
      source_worksheet_row_number: worksheetRowNumber != null ? String(worksheetRowNumber) : "",
      source_sheet_scoped_key: sheetScopedKey || "",
    },
  };
}

function scoreImageAgainstItem(
  item: ReturnType<typeof enrichItemWithImportCoordinates>,
  image: IntelligentImportPreviewImage,
  fallbackImageIndex: number
) {
  let score = 0;

  const itemOriginalFile = normalizeLoose(String(item.metadata?.source_file_name_original || item.sourceFileName || ""));
  const imageOriginalFile = normalizeLoose(image.originalSourceFileName || image.sourceFileName || "");
  if (itemOriginalFile && imageOriginalFile && itemOriginalFile === imageOriginalFile) score += 400;

  const itemSheet = normalizeLoose(String(item.metadata?.source_sheet_name || ""));
  const imageSheet = normalizeLoose(image.sheetName || "");
  if (itemSheet && imageSheet) {
    if (itemSheet === imageSheet) score += 250;
    else score -= 600;
  }

  const itemRow = Number(String(item.metadata?.source_worksheet_row_number || "").replace(/[^\d-]/g, ""));
  const imageRow = typeof image.worksheetRowNumber === "number" ? image.worksheetRowNumber : null;
  if (Number.isFinite(itemRow) && itemRow > 0 && imageRow != null) {
    const distance = Math.abs(itemRow - imageRow);
    if (distance === 0) score += 900;
    else if (distance === 1) score += 240;
    else if (distance === 2) score += 120;
    else if (distance === 3) score += 40;
    else score -= Math.min(distance * 30, 300);
  }

  const itemSheetScopedKey = normalizeLoose(String(item.metadata?.source_sheet_scoped_key || ""));
  const imageSheetScopedKey = normalizeLoose(image.sheetScopedKey || "");
  if (itemSheetScopedKey && imageSheetScopedKey) {
    if (itemSheetScopedKey === imageSheetScopedKey) score += 1000;
    else score -= 120;
  }

  const itemOrder = extractItemStableAssignmentOrder(item, fallbackImageIndex);
  const imageOrder = typeof image.worksheetRowNumber === "number"
    ? image.worksheetRowNumber
    : (typeof image.rowIndex === "number" ? image.rowIndex + 1 : null);
  if (imageOrder != null) {
    const distance = Math.abs(itemOrder - imageOrder);
    if (distance === 0) score += 120;
    else if (distance <= 2) score += 40;
  }

  score -= fallbackImageIndex * 0.01;
  return score;
}

function buildFileItemAlias(fileName: string, index: number, sheetName?: string) {
  const normalizedSheetName = String(sheetName || "").trim();
  if (normalizedSheetName) {
    return `${fileName} • ${normalizedSheetName} • item ${index + 1}`;
  }
  return `${fileName} • item ${index + 1}`;
}

function isGenericTitle(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;

  const blockedStarts = [
    "descricao detalhada",
    "descrição detalhada",
    "catalogo de teste",
    "catálogo de teste",
    "arquivo de teste",
    "nome do item",
    "item importado",
    "regra comercial",
  ];

  return blockedStarts.some(
    (item) => normalized === normalizeLoose(item) || normalized.startsWith(normalizeLoose(item))
  );
}

function extractNumericSuffix(value: string) {
  const match = String(value || "").match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractItemStableAssignmentOrder(item: NormalizedImportItem, fallbackIndex: number) {
  const skuCandidate = [
    item.metadata?.sku,
    item.metadata?.SKU,
    item.metadata?.codigo,
    item.metadata?.["código"],
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  const numericFromSku = skuCandidate ? extractNumericSuffix(skuCandidate) : null;
  if (numericFromSku != null) return numericFromSku;

  const numericFromTitle = extractNumericSuffix(String(item.title || ""));
  if (numericFromTitle != null) return numericFromTitle;

  const numericFromRawText = extractNumericSuffix(String(item.rawText || ""));
  if (numericFromRawText != null) return numericFromRawText;

  return 100000 + fallbackIndex;
}

function sortImagesForStableAssignment(images: IntelligentImportPreviewImage[]) {
  return [...images].sort((a, b) => {
    const sourceA = normalizeLoose(a.sourceFileName || "");
    const sourceB = normalizeLoose(b.sourceFileName || "");
    if (sourceA !== sourceB) return sourceA.localeCompare(sourceB);

    const sourceTypeA = a.source === "xlsx" ? 0 : 1;
    const sourceTypeB = b.source === "xlsx" ? 0 : 1;
    if (sourceTypeA !== sourceTypeB) return sourceTypeA - sourceTypeB;

    const sheetA = normalizeLoose(a.sheetName || "");
    const sheetB = normalizeLoose(b.sheetName || "");
    if (sheetA !== sheetB) return sheetA.localeCompare(sheetB, undefined, { numeric: true });

    const rowA = typeof a.rowIndex === "number" ? a.rowIndex : Number.MAX_SAFE_INTEGER;
    const rowB = typeof b.rowIndex === "number" ? b.rowIndex : Number.MAX_SAFE_INTEGER;
    if (rowA !== rowB) return rowA - rowB;

    const colA = typeof a.columnIndex === "number" ? a.columnIndex : Number.MAX_SAFE_INTEGER;
    const colB = typeof b.columnIndex === "number" ? b.columnIndex : Number.MAX_SAFE_INTEGER;
    if (colA !== colB) return colA - colB;

    const orderA = typeof a.imageOrder === "number" ? a.imageOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.imageOrder === "number" ? b.imageOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;

    return String(a.fileName || "").localeCompare(String(b.fileName || ""), undefined, {
      numeric: true,
    });
  });
}

function attachPerItemAliases(
  items: NormalizedImportItem[],
  extractedImages: IntelligentImportPreviewImage[]
) {
  const normalizedPreview = items.map((item) => enrichItemWithImportCoordinates(item));

  const imagePreview: IntelligentImportPreviewImage[] = extractedImages.map((image) => ({
    ...image,
    sourceFileName: String(image.originalSourceFileName || image.sourceFileName || "").trim(),
    originalSourceFileName: String(
      image.originalSourceFileName || image.sourceFileName || ""
    ).trim(),
  }));

  debugIntelligentImport("attachPerItemAliases:result", {
    normalizedCount: normalizedPreview.length,
    imagePreviewCount: imagePreview.length,
    mode: "preserve_original_image_coordinates",
  });

  return {
    normalizedPreview,
    imagePreview,
  };
}

function filterUsefulItems(items: DedupedImportItem[]) {
  return items.filter((item) => {
    const genericTitle = isGenericTitle(item.title);
    const lowConfidenceUnknown = item.type === "unknown" && item.confidence < 0.55;

    if (genericTitle || lowConfidenceUnknown) {
      debugIntelligentImport("filterUsefulItems:discarded", {
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        dedupKey: item.dedupKey,
        reason: genericTitle ? "generic_title" : "low_confidence_unknown",
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      });
      return false;
    }

    return true;
  });
}

function buildImageDiagnostics(
  extractedFiles: Array<{
    fileName: string;
    extension: string;
    extractedImages?: ExtractedImageAsset[];
    diagnostics?: ExtractedFileDiagnostics;
  }>,
  extractedImagePreviewRaw: IntelligentImportPreviewImage[],
  aliasedImagePreview: IntelligentImportPreviewImage[]
): IntelligentImportImageDiagnostics {
  return {
    totalExtractedImagesRaw: extractedImagePreviewRaw.length,
    totalAliasedImages: aliasedImagePreview.length,
    files: extractedFiles.map((file) => ({
      fileName: file.fileName,
      extension: file.extension,
      extractedImages: Array.isArray(file.extractedImages) ? file.extractedImages.length : 0,
      xlsxImageDiagnostics: file.diagnostics?.xlsxImageDiagnostics,
    })),
  };
}

export async function runOnboardingIntelligentImport(
  params: IntelligentImportParams
): Promise<IntelligentImportResult> {
  const { files, debugParser = false } = params;

  try {
    if (!files.length) {
      return {
        ok: false,
        error: "NO_FILES",
        message: "Nenhum arquivo foi enviado para a importação inteligente.",
      };
    }

    debugIntelligentImport("start", {
      totalFiles: files.length,
      files: files.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
      })),
    });

    const extractedFiles = await Promise.all(
      files.map((file) =>
        extractTextFromFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: file.buffer,
        })
      )
    );

    debugIntelligentImport("after-extract", {
      extractedFiles: extractedFiles.length,
      extracted: extractedFiles.map((file) => ({
        fileName: file.fileName,
        extension: file.extension,
        textLength: String(file.text || "").length,
        extractedImages: Array.isArray(file.extractedImages) ? file.extractedImages.length : 0,
        diagnostics: file.diagnostics,
      })),
    });

    const normalizedResult = debugParser
      ? normalizeMultipleExtractedFilesDetailed(extractedFiles)
      : {
          items: normalizeMultipleExtractedFiles(extractedFiles),
          debug: null,
        };
    const normalizedItems = normalizedResult.items;

    debugIntelligentImport("after-normalize", {
      normalizedCount: normalizedItems.length,
      normalizedItems: normalizedItems.map((item) => ({
        title: item.title,
        type: item.type,
        sourceFileName: item.sourceFileName,
        confidence: item.confidence,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

    const extractedImagePreviewRaw: IntelligentImportPreviewImage[] = extractedFiles.flatMap((file) =>
      (file.extractedImages ?? []).map((image) => ({
        sourceFileName: file.fileName,
        originalSourceFileName: file.fileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        drawingName: image.drawingName,
        imageRelationshipId: image.imageRelationshipId,
        imageOrder: image.imageOrder,
        worksheetRowNumber: image.worksheetRowNumber,
        sheetScopedKey: image.sheetScopedKey,
      }))
    );

    debugIntelligentImport("after-image-collect", {
      extractedImagesRawCount: extractedImagePreviewRaw.length,
      extractedImagesRaw: extractedImagePreviewRaw.map((image) => ({
        sourceFileName: image.sourceFileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        imageOrder: image.imageOrder,
      })),
    });

    const aliased = attachPerItemAliases(normalizedItems, extractedImagePreviewRaw);
    const imageDiagnostics = buildImageDiagnostics(
      extractedFiles,
      extractedImagePreviewRaw,
      aliased.imagePreview
    );

    debugIntelligentImport("after-alias", {
      normalizedCount: aliased.normalizedPreview.length,
      imagePreviewCount: aliased.imagePreview.length,
      imagePreview: aliased.imagePreview.map((image) => ({
        sourceFileName: image.sourceFileName,
        fileName: image.fileName,
        source: image.source,
        sheetName: image.sheetName,
        rowIndex: image.rowIndex,
        columnIndex: image.columnIndex,
        anchorCell: image.anchorCell,
        imageOrder: image.imageOrder,
      })),
      imageDiagnostics,
    });

    const dedupedBeforeFilter = dedupNormalizedItems(aliased.normalizedPreview);

    debugIntelligentImport("after-dedup-before-filter", {
      total: dedupedBeforeFilter.length,
      duplicates: dedupedBeforeFilter.filter((item) => item.isDuplicate).length,
      items: dedupedBeforeFilter.map((item) => ({
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        duplicateOf: item.duplicateOf,
        dedupKey: item.dedupKey,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

    const dedupedItems = filterUsefulItems(dedupedBeforeFilter);
    const duplicateItems = dedupedItems.filter((item) => item.isDuplicate).length;
    const filteredOutItems = dedupedBeforeFilter.filter((item) => !dedupedItems.includes(item));

    debugIntelligentImport("after-filter-final", {
      finalCount: dedupedItems.length,
      duplicateItems,
      finalItems: dedupedItems.map((item) => ({
        title: item.title,
        sourceFileName: item.sourceFileName,
        type: item.type,
        confidence: item.confidence,
        isDuplicate: item.isDuplicate,
        duplicateOf: item.duplicateOf,
        dedupKey: item.dedupKey,
        sku:
          item.metadata?.sku ||
          item.metadata?.SKU ||
          item.metadata?.codigo ||
          item.metadata?.["código"] ||
          "",
      })),
    });

    const summary = {
      totalFiles: files.length,
      extractedFiles: extractedFiles.length,
      normalizedItems: aliased.normalizedPreview.length,
      dedupedItems: dedupedItems.length,
      duplicateItems,
      extractedImages: aliased.imagePreview.length,
    };

    const persistedRawFiles =
      params.persistRawFiles === false
        ? {
            importedFileIds: [] as string[],
            importedFiles: [] as IntelligentImportPersistedFile[],
            rawFilePersistenceWarnings: [] as string[],
          }
        : await persistImportedRawFiles({
            files,
            organizationId: params.organizationId,
            storeId: params.storeId,
            uploadedBy: params.uploadedBy,
            importSummary: summary,
            source: params.source,
          });
    const stagedMediaPersistence = await persistStagedXlsxMediaAssets({
      extractedImagePreview: aliased.imagePreview,
      importedFiles: persistedRawFiles.importedFiles,
      organizationId: params.organizationId,
      storeId: params.storeId,
      uploadedBy: params.uploadedBy,
    });

    return {
      ok: true,
      importedFileIds: persistedRawFiles.importedFileIds,
      importedFiles: persistedRawFiles.importedFiles,
      mediaStagingWarnings: stagedMediaPersistence.mediaStagingWarnings,
      rawFilePersistenceWarnings: persistedRawFiles.rawFilePersistenceWarnings,
      stagedMediaAssetIds: stagedMediaPersistence.stagedMediaAssetIds,
      stagedMediaAssets: stagedMediaPersistence.stagedMediaAssets,
      summary,
      extractedPreview: extractedFiles.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extension: file.extension,
        textPreview: buildPreview(file.text),
      })),
      extractedImagePreview: aliased.imagePreview,
      imageDiagnostics,
      normalizedPreview: aliased.normalizedPreview,
      dedupedPreview: dedupedItems,
      parserDebug:
        debugParser && normalizedResult.debug
          ? {
              enabled: true,
              extraction: extractedFiles.map((file) => ({
                fileName: file.fileName,
                mimeType: file.mimeType,
                charCount: String(file.text || "").length,
                approxLineCount: String(file.text || "")
                  .split(/\r?\n/)
                  .map((line) => String(line || "").trim())
                  .filter(Boolean).length,
                usefulLinesPreview: String(file.text || "")
                  .split(/\r?\n/)
                  .map((line) => String(line || "").trim())
                  .filter(Boolean)
                  .slice(0, 6),
                looksLikeContinuousText: normalizedResult.debug.files.some(
                  (debugFile) =>
                    debugFile.fileName === file.fileName && debugFile.parser.looksLikeContinuousText
                ),
              })),
              normalization: normalizedResult.debug,
              dedupe: {
                inputCount: aliased.normalizedPreview.length,
                outputCount: dedupedBeforeFilter.length,
                duplicateCount: dedupedBeforeFilter.filter((item) => item.isDuplicate).length,
                duplicates: dedupedBeforeFilter
                  .filter((item) => item.isDuplicate)
                  .slice(0, 50)
                  .map((item) => ({
                    title: item.title,
                    dedupKey: item.dedupKey,
                    duplicateOf: item.duplicateOf,
                  })),
              },
              filter: {
                inputCount: dedupedBeforeFilter.length,
                outputCount: dedupedItems.length,
                filteredOut: filteredOutItems.slice(0, 50).map((item) => ({
                  title: item.title,
                  type: item.type,
                  confidence: item.confidence,
                  reason:
                    isGenericTitle(item.title)
                      ? "generic_title"
                      : item.type === "unknown" && item.confidence < 0.55
                        ? "low_confidence_unknown"
                        : "filtered_out",
                })),
              },
            }
          : undefined,
    };
  } catch (error: any) {
    debugIntelligentImport("error", {
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
      stack: error?.stack || null,
    });

    return {
      ok: false,
      error: "ONBOARDING_INTELLIGENT_IMPORT_FAILED",
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
    };
  }
}
