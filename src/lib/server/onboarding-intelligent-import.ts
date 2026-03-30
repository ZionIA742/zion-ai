import {
  extractTextFromFile,
  type ExtractedImageAsset,
} from "./onboarding-file-extractors";
import {
  normalizeMultipleExtractedFiles,
  type NormalizedImportItem,
} from "./onboarding-import-normalizers";
import {
  dedupNormalizedItems,
  type DedupedImportItem,
} from "./onboarding-import-dedup";

export type ImportableFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

export type IntelligentImportParams = {
  organizationId: string;
  storeId: string;
  files: ImportableFile[];
};

export type IntelligentImportResult =
  | {
      ok: true;
      summary: {
        totalFiles: number;
        extractedFiles: number;
        normalizedItems: number;
        dedupedItems: number;
        duplicateItems: number;
        extractedImages: number;
      };
      extractedPreview: Array<{
        fileName: string;
        mimeType: string;
        extension: string;
        textPreview: string;
      }>;
      extractedImagePreview: Array<{
        sourceFileName: string;
        fileName: string;
        source: ExtractedImageAsset["source"];
        mimeType: string;
        dataUrl: string;
      }>;
      normalizedPreview: NormalizedImportItem[];
      dedupedPreview: DedupedImportItem[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

function buildPreview(text: string, max = 300) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
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

function buildFileItemAlias(fileName: string, index: number) {
  return `${fileName} • item ${index + 1}`;
}

function attachPerItemAliases(
  items: NormalizedImportItem[],
  extractedImages: Array<{
    sourceFileName: string;
    fileName: string;
    source: ExtractedImageAsset["source"];
    mimeType: string;
    dataUrl: string;
  }>
) {
  const groupedItems = new Map<string, NormalizedImportItem[]>();
  for (const item of items) {
    const key = item.metadata?.original_source_file_name || item.sourceFileName;
    const current = groupedItems.get(key) || [];
    current.push(item);
    groupedItems.set(key, current);
  }

  const groupedImages = new Map<string, typeof extractedImages>();
  for (const image of extractedImages) {
    const key = image.sourceFileName;
    const current = groupedImages.get(key) || [];
    current.push(image);
    groupedImages.set(key, current);
  }

  const normalizedPreview: NormalizedImportItem[] = [];
  const imagePreview: typeof extractedImages = [];

  for (const [sourceFileName, fileItems] of groupedItems.entries()) {
    const fileImages = groupedImages.get(sourceFileName) || [];
    if (fileItems.length <= 1) {
      normalizedPreview.push(...fileItems);
      imagePreview.push(...fileImages);
      continue;
    }

    fileItems.forEach((item, index) => {
      const alias = buildFileItemAlias(sourceFileName, index);
      normalizedPreview.push({
        ...item,
        sourceFileName: alias,
        metadata: {
          ...item.metadata,
          original_source_file_name: sourceFileName,
          source_file_name: sourceFileName,
          item_index: String(index),
        },
      });

      const assignedImage = fileImages[index];
      if (assignedImage) {
        imagePreview.push({
          ...assignedImage,
          sourceFileName: alias,
        });
      }
    });
  }

  return { normalizedPreview, imagePreview };
}

export async function runOnboardingIntelligentImport(
  params: IntelligentImportParams
): Promise<IntelligentImportResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();
    const files = Array.isArray(params.files) ? params.files : [];

    if (!organizationId) {
      return {
        ok: false,
        error: "MISSING_ORGANIZATION_ID",
        message: "organizationId é obrigatório.",
      };
    }

    if (!storeId) {
      return {
        ok: false,
        error: "MISSING_STORE_ID",
        message: "storeId é obrigatório.",
      };
    }

    if (!files.length) {
      return {
        ok: false,
        error: "NO_FILES",
        message: "Nenhum arquivo foi enviado para importação.",
      };
    }

    const extractedFiles = await Promise.all(
      files.map((file) =>
        extractTextFromFile({
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: file.buffer,
        })
      )
    );

    const normalizedItems = normalizeMultipleExtractedFiles(extractedFiles);
    const extractedImagePreviewRaw = extractedFiles.flatMap((file) =>
      (file.extractedImages ?? []).map((image) => ({
        sourceFileName: file.fileName,
        fileName: image.fileName,
        source: image.source,
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
      }))
    );

    const aliased = attachPerItemAliases(normalizedItems, extractedImagePreviewRaw);
    const dedupedItems = dedupNormalizedItems(aliased.normalizedPreview).filter((item) => {
      const normalizedTitle = normalizeLoose(item.title);
      return normalizedTitle && !normalizedTitle.startsWith("descricao detalhada") && !normalizedTitle.startsWith("catalogo de teste");
    });

    const duplicateItems = dedupedItems.filter((item) => item.isDuplicate).length;

    return {
      ok: true,
      summary: {
        totalFiles: files.length,
        extractedFiles: extractedFiles.length,
        normalizedItems: aliased.normalizedPreview.length,
        dedupedItems: dedupedItems.length,
        duplicateItems,
        extractedImages: aliased.imagePreview.length,
      },
      extractedPreview: extractedFiles.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        extension: file.extension,
        textPreview: buildPreview(file.text),
      })),
      extractedImagePreview: aliased.imagePreview,
      normalizedPreview: aliased.normalizedPreview,
      dedupedPreview: dedupedItems,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "ONBOARDING_INTELLIGENT_IMPORT_FAILED",
      message:
        error?.message ||
        "Erro interno ao processar importação inteligente do onboarding.",
    };
  }
}
