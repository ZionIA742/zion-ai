"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type CatalogItemMetadata = {
  categoria?: string | null;
  source_file_name?: string | null;
  clean_description?: string | null;
  destination?: string | null;
  categoryHint?: string | null;
  price?: string | null;
  dimensions?: string | null;
  depth?: string | null;
  capacity?: string | null;
  material?: string | null;
  shape?: string | null;
  brand?: string | null;
  sku?: string | null;
  weight?: string | null;
  dosage?: string | null;
  color?: string | null;
  usage?: string | null;
  notes?: string | null;
  indication?: string | null;
  composition?: string | null;
  embalagem?: string | null;
  packaging?: string | null;
  model?: string | null;
  size?: string | null;
  compatibility?: string | null;
  function?: string | null;
  environment?: string | null;
  diferencial?: string | null;
  application?: string | null;
  feature?: string | null;
  [key: string]: any;
};

type CatalogItemRow = {
  id: string;
  organization_id: string;
  store_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  metadata: CatalogItemMetadata | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CatalogItemPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
  created_at?: string | null;
};

type EditCatalogForm = {
  name: string;
  sku: string;
  description: string;
  price: string;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: string;
  brand: string;
  line: string;
  unit_label: string;
  size_details: string;
  width_cm: string;
  height_cm: string;
  length_cm: string;
  weight_kg: string;
  application: string;
  technical_notes: string;
};

type CharacteristicRow = {
  label: string;
  value: string;
};

const STORAGE_BUCKET = "store-catalog-photos";
const MAX_CATALOG_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function normalizeCategory(category: string | null | undefined) {
  if (category === "acessorios") return "acessorios";
  if (category === "quimicos") return "quimicos";
  return "outros";
}

function categoryLabel(category: string) {
  if (category === "acessorios") return "Acessórios";
  if (category === "quimicos") return "Produtos químicos";
  return "Outros itens";
}

function formatMoney(cents: number | null | undefined) {
  if (typeof cents !== "number") return "Sem preço";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function toPriceInput(cents: number | null | undefined) {
  if (typeof cents !== "number") return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function priceInputToCents(value: string) {
  const normalized = value
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "")
    .trim();

  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * 100);
}

function parseLooseNumber(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let normalized = raw.replace(/\s+/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.replace(new RegExp(`\${thousandSeparator}`, "g"), "");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if ((normalized.match(/\./g) || []).length > 1) {
    const lastDotIndex = normalized.lastIndexOf(".");
    normalized =
      normalized.slice(0, lastDotIndex).replace(/\./g, "") +
      "." +
      normalized.slice(lastDotIndex + 1);
  }

  normalized = normalized.replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "." || normalized === "-" || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLooseNumber(value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  return cleanLooseText(String(value));
}

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function cleanLooseText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLoose(value: string | null | undefined) {
  return cleanLooseText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkDescriptionLine(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;

  const blockedExact = new Set([
    "campo",
    "valor",
    "descricao detalhada",
    "descrição detalhada",
    "nome do item",
    "categoria",
    "preco",
    "preço",
    "marca",
    "peso",
    "cor",
    "funcao",
    "função",
    "material",
    "dosagem",
    "aplicacao",
    "aplicação",
    "compatibilidade",
    "modelo",
    "tamanho",
    "embalagem",
    "composicao",
    "composição",
    "indicacao",
    "indicação",
    "ambiente indicado",
    "diferencial",
    "uso",
    "observacao",
    "observação",
    "capacidade",
    "medidas",
    "profundidade",
    "largura",
    "comprimento",
    "formato",
  ]);

  if (blockedExact.has(normalized)) return true;

  return (
    normalized.startsWith("arquivo de teste") ||
    normalized.startsWith("categoria esperada") ||
    normalized.startsWith("objetivo validar") ||
    normalized.startsWith("salvar em configuracoes") ||
    normalized.startsWith("salvar em configurações")
  );
}

function characteristicValue(raw: unknown) {
  const value = cleanLooseText(
    typeof raw === "string" || typeof raw === "number" ? String(raw) : ""
  );
  return value || "";
}

function pushCharacteristic(rows: CharacteristicRow[], label: string, value: unknown) {
  const safeValue = characteristicValue(value);
  if (!safeValue) return;
  if (rows.some((row) => row.label === label && row.value === safeValue)) return;
  rows.push({ label, value: safeValue });
}

function buildCatalogCharacteristics(item: CatalogItemRow, category: string): CharacteristicRow[] {
  const metadata = item.metadata || {};
  const rows: CharacteristicRow[] = [];

  const dimensionsParts = [
    metadata.width_cm ? `L ${formatLooseNumber(metadata.width_cm)} cm` : "",
    metadata.height_cm ? `A ${formatLooseNumber(metadata.height_cm)} cm` : "",
    metadata.length_cm ? `C ${formatLooseNumber(metadata.length_cm)} cm` : "",
  ].filter(Boolean);

  pushCharacteristic(rows, "Nome", item.name);
  if (typeof item.price_cents === "number") pushCharacteristic(rows, "Preço", formatMoney(item.price_cents));
  pushCharacteristic(rows, "SKU", item.sku || metadata.sku);
  pushCharacteristic(rows, "Marca", metadata.brand);
  pushCharacteristic(rows, "Linha / modelo", metadata.line || metadata.model);
  pushCharacteristic(rows, "Unidade", metadata.unit_label);
  pushCharacteristic(rows, "Tamanho / variação", metadata.size_details || metadata.size || metadata.dimensions);
  pushCharacteristic(rows, "Largura (cm)", metadata.width_cm);
  pushCharacteristic(rows, "Altura (cm)", metadata.height_cm);
  pushCharacteristic(rows, "Comprimento (cm)", metadata.length_cm);
  pushCharacteristic(rows, "Peso (kg)", metadata.weight_kg || metadata.weight);

  if (category === "quimicos") {
    pushCharacteristic(rows, "Aplicação", metadata.application || metadata.usage);
    pushCharacteristic(rows, "Observações técnicas", metadata.technical_notes || metadata.indication || metadata.notes);
    pushCharacteristic(rows, "Composição", metadata.composition);
    pushCharacteristic(rows, "Embalagem", metadata.embalagem || metadata.packaging);
    pushCharacteristic(rows, "Cor", metadata.color);
    pushCharacteristic(rows, "Dosagem", metadata.dosage);
    pushCharacteristic(rows, "Concentração", metadata.concentration || metadata.capacity);
  } else if (category === "acessorios") {
    pushCharacteristic(rows, "Material", metadata.material);
    pushCharacteristic(rows, "Compatibilidade", metadata.compatibility || metadata.usage);
    pushCharacteristic(rows, "Função", metadata.function);
    pushCharacteristic(rows, "Aplicação", metadata.application);
    pushCharacteristic(rows, "Observações técnicas", metadata.technical_notes || metadata.notes);
    pushCharacteristic(rows, "Cor", metadata.color);
  } else {
    pushCharacteristic(rows, "Material", metadata.material);
    pushCharacteristic(rows, "Aplicação", metadata.application || metadata.usage);
    pushCharacteristic(rows, "Observações técnicas", metadata.technical_notes || metadata.notes);
    pushCharacteristic(rows, "Diferencial", metadata.diferencial || metadata.feature);
    pushCharacteristic(rows, "Ambiente indicado", metadata.environment);
    pushCharacteristic(rows, "Cor", metadata.color);
  }

  if (dimensionsParts.length > 0) {
    pushCharacteristic(rows, "Medidas resumidas", dimensionsParts.join(" • "));
  }

  return rows;
}

function buildComplementaryDescription(item: CatalogItemRow, characteristics: CharacteristicRow[]) {
  const metadata = item.metadata || {};
  const sourceText = cleanLooseText(String(metadata.clean_description || item.description || ""));
  if (!sourceText) return "";

  const characteristicValues = characteristics
    .map((row) => normalizeLoose(row.value))
    .filter(Boolean);

  const lines = sourceText
    .split(/\n+/)
    .map((line) => cleanLooseText(line))
    .filter(Boolean)
    .filter((line) => !isJunkDescriptionLine(line))
    .filter((line) => {
      const normalized = normalizeLoose(line);
      if (!normalized) return false;
      if (characteristicValues.includes(normalized)) return false;
      return !characteristicValues.some(
        (value) => value.length >= 10 && normalized === value
      );
    });

  const unique: string[] = [];
  for (const line of lines) {
    if (!unique.some((existing) => normalizeLoose(existing) === normalizeLoose(line))) {
      unique.push(line);
    }
  }

  return unique.join("\n").trim();
}

function buildEditForm(item: CatalogItemRow): EditCatalogForm {
  const metadata = item.metadata || {};
  return {
    name: item.name || "",
    sku: item.sku || "",
    description: item.description || "",
    price: toPriceInput(item.price_cents),
    is_active: item.is_active,
    track_stock: item.track_stock,
    stock_quantity: item.stock_quantity == null ? "" : String(item.stock_quantity),
    brand: cleanLooseText(metadata.brand),
    line: cleanLooseText(metadata.line || metadata.model),
    unit_label: cleanLooseText(metadata.unit_label),
    size_details: cleanLooseText(metadata.size_details || metadata.size || metadata.dimensions),
    width_cm: formatLooseNumber(metadata.width_cm),
    height_cm: formatLooseNumber(metadata.height_cm),
    length_cm: formatLooseNumber(metadata.length_cm),
    weight_kg: formatLooseNumber(metadata.weight_kg || metadata.weight),
    application: cleanLooseText(metadata.application || metadata.usage),
    technical_notes: cleanLooseText(metadata.technical_notes || metadata.notes || metadata.indication),
  };
}

function DetailChip({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700">
      {value}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

function CharacteristicsTable({
  title,
  rows,
}: {
  title: string;
  rows: CharacteristicRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <SectionCard title={title}>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={`grid gap-1 px-3 py-2 text-sm sm:grid-cols-[150px_minmax(0,1fr)] ${
              index % 2 === 0 ? "bg-gray-50" : "bg-white"
            } ${index > 0 ? "border-t border-gray-200" : ""}`}
          >
            <div className="font-medium text-gray-600">{row.label}</div>
            <div className="break-words text-gray-900">{row.value}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default function CatalogCategoryPage() {
  const params = useParams<{ categoria?: string }>();
  const category = normalizeCategory(
    Array.isArray(params?.categoria) ? params?.categoria[0] : params?.categoria
  );

  const { organizationId, activeStoreId } = useStoreContext();

  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [photosByItemId, setPhotosByItemId] = useState<Record<string, CatalogItemPhotoRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditCatalogForm | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [selectedCatalogFilesByItemId, setSelectedCatalogFilesByItemId] = useState<Record<string, File[]>>({});
  const [uploadingPhotosItemId, setUploadingPhotosItemId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function fetchData() {
    if (!organizationId || !activeStoreId) {
      setItems([]);
      setPhotosByItemId({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const { data: rows, error } = await supabase
        .from("store_catalog_items")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const filtered = ((rows || []) as CatalogItemRow[]).filter(
        (item) => normalizeCategory(item.metadata?.categoria) === category
      );

      setItems(filtered);

      if (filtered.length === 0) {
        setPhotosByItemId({});
        return;
      }

      const itemIds = filtered.map((item) => item.id);
      const { data: photoRows, error: photosError } = await supabase
        .from("store_catalog_item_photos")
        .select("*")
        .in("catalog_item_id", itemIds)
        .order("sort_order", { ascending: true });

      if (photosError) throw photosError;

      const grouped: Record<string, CatalogItemPhotoRow[]> = {};
      for (const photo of (photoRows || []) as CatalogItemPhotoRow[]) {
        if (!grouped[photo.catalog_item_id]) grouped[photo.catalog_item_id] = [];
        grouped[photo.catalog_item_id].push(photo);
      }

      setPhotosByItemId(grouped);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar itens do catálogo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
  }, [organizationId, activeStoreId, category]);

  function startEditing(item: CatalogItemRow) {
    setEditingItemId(item.id);
    setEditForm(buildEditForm(item));
    setErrorText(null);
    setSuccessText(null);
  }

  function cancelEditing() {
    setEditingItemId(null);
    setEditForm(null);
  }

  function handleCatalogFilesChange(itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files || []);
    const currentCount = (photosByItemId[itemId] || []).length;

    if (currentCount + fileList.length > MAX_CATALOG_PHOTOS) {
      setErrorText(`Esse item pode ter no máximo ${MAX_CATALOG_PHOTOS} fotos no total.`);
      event.target.value = "";
      return;
    }

    const oversized = fileList.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      setErrorText(`A imagem "${oversized.name}" ultrapassa o limite de 50 MB.`);
      event.target.value = "";
      return;
    }

    const invalidType = fileList.find((file) => !file.type.startsWith("image/"));
    if (invalidType) {
      setErrorText(`O arquivo "${invalidType.name}" não é uma imagem válida.`);
      event.target.value = "";
      return;
    }

    setErrorText(null);
    setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: fileList }));
  }

  async function uploadCatalogFiles(itemId: string, files: File[]) {
    if (!organizationId || !activeStoreId) throw new Error("Loja ativa não encontrada.");

    const existingPhotos = photosByItemId[itemId] || [];
    let nextSortOrder = existingPhotos.length;

    for (const file of files) {
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${organizationId}/${activeStoreId}/${itemId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from("store_catalog_item_photos").insert({
        catalog_item_id: itemId,
        storage_path: storagePath,
        file_name: file.name,
        file_size_bytes: file.size,
        sort_order: nextSortOrder,
      });

      if (metadataError) throw metadataError;
      nextSortOrder += 1;
    }
  }

  async function handleUploadNewPhotos(itemId: string) {
    const files = selectedCatalogFilesByItemId[itemId] || [];
    if (files.length === 0) {
      setErrorText("Selecione uma ou mais fotos para adicionar.");
      return;
    }

    setErrorText(null);
    setSuccessText(null);
    setUploadingPhotosItemId(itemId);

    try {
      await uploadCatalogFiles(itemId, files);
      setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: [] }));
      const input = fileInputRefs.current[itemId];
      if (input) input.value = "";
      setSuccessText("Fotos adicionadas com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao adicionar fotos do item.");
    } finally {
      setUploadingPhotosItemId(null);
    }
  }

  async function handleDeletePhoto(photo: CatalogItemPhotoRow) {
    setErrorText(null);
    setSuccessText(null);
    setDeletingPhotoId(photo.id);

    try {
      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([photo.storage_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from("store_catalog_item_photos")
        .delete()
        .eq("id", photo.id);

      if (dbError) throw dbError;

      setSuccessText("Foto excluída com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir foto.");
    } finally {
      setDeletingPhotoId(null);
    }
  }

  async function handleSaveItem(itemId: string) {
    if (!editForm || !organizationId || !activeStoreId) return;

    setSavingItemId(itemId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const currentItem = items.find((item) => item.id === itemId);
      if (!currentItem) throw new Error("Não foi possível localizar o item para salvar.");

      const parsedStockQuantity = editForm.track_stock && editForm.stock_quantity.trim()
        ? Number(editForm.stock_quantity.replace(/[^\d-]/g, ""))
        : null;

      if (editForm.track_stock && editForm.stock_quantity.trim() && !Number.isFinite(parsedStockQuantity)) {
        throw new Error("A quantidade em estoque precisa ser um número válido.");
      }

      const nextMetadata = {
        ...(currentItem.metadata || {}),
        categoria: normalizeCategory(currentItem.metadata?.categoria || category),
        sku: editForm.sku.trim() || null,
        brand: editForm.brand.trim() || null,
        line: editForm.line.trim() || null,
        model: editForm.line.trim() || null,
        unit_label: editForm.unit_label.trim() || null,
        size_details: editForm.size_details.trim() || null,
        size: editForm.size_details.trim() || null,
        dimensions: editForm.size_details.trim() || null,
        width_cm: parseLooseNumber(editForm.width_cm),
        height_cm: parseLooseNumber(editForm.height_cm),
        length_cm: parseLooseNumber(editForm.length_cm),
        weight_kg: parseLooseNumber(editForm.weight_kg),
        weight: editForm.weight_kg.trim() || null,
        application: editForm.application.trim() || null,
        usage: editForm.application.trim() || null,
        technical_notes: editForm.technical_notes.trim() || null,
        notes: editForm.technical_notes.trim() || null,
      };

      const payload = {
        name: editForm.name.trim(),
        sku: editForm.sku.trim() || null,
        description: editForm.description.trim() || null,
        price_cents: priceInputToCents(editForm.price),
        is_active: editForm.is_active,
        track_stock: editForm.track_stock,
        stock_quantity: parsedStockQuantity,
        metadata: nextMetadata,
      };

      const { error: updateError } = await supabase
        .from("store_catalog_items")
        .update(payload)
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (updateError) throw updateError;

      const { data: refreshedItem, error: refreshedError } = await supabase
        .from("store_catalog_items")
        .select("*")
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .maybeSingle();

      if (refreshedError) throw refreshedError;
      if (!refreshedItem) {
        throw new Error("O item foi salvo, mas não pôde ser recarregado. Verifique as permissões de leitura dessa tabela.");
      }

      const pendingFiles = selectedCatalogFilesByItemId[itemId] || [];
      if (pendingFiles.length > 0) {
        await uploadCatalogFiles(itemId, pendingFiles);
        setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: [] }));
        const input = fileInputRefs.current[itemId];
        if (input) input.value = "";
      }

      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? (refreshedItem as CatalogItemRow) : item))
      );

      setSuccessText("Item salvo com sucesso.");
      setEditingItemId(null);
      setEditForm(null);
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar item.");
    } finally {
      setSavingItemId(null);
    }
  }

async function handleDeleteItem(itemId: string) {
    if (!organizationId || !activeStoreId) return;

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir este item? Essa ação também apaga as fotos dele."
    );
    if (!confirmed) return;

    setDeletingItemId(itemId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const itemPhotos = photosByItemId[itemId] || [];
      const storagePaths = itemPhotos.map((photo) => photo.storage_path).filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(storagePaths);
        if (storageError) throw storageError;
      }

      if (itemPhotos.length > 0) {
        const { error: photoDeleteError } = await supabase
          .from("store_catalog_item_photos")
          .delete()
          .eq("catalog_item_id", itemId);

        if (photoDeleteError) throw photoDeleteError;
      }

      const { error: itemDeleteError } = await supabase
        .from("store_catalog_items")
        .delete()
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (itemDeleteError) throw itemDeleteError;

      setSuccessText("Item excluído com sucesso.");
      setItems((prev) => prev.filter((item) => item.id !== itemId));
      setPhotosByItemId((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });

      if (editingItemId === itemId) {
        setEditingItemId(null);
        setEditForm(null);
      }
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir item.");
    } finally {
      setDeletingItemId(null);
    }
  }

  const pageTitle = useMemo(() => categoryLabel(category), [category]);

  const filteredItems = useMemo(() => {
    const safeSearch = searchTerm
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();

    if (!safeSearch) return items;

    return items.filter((item) => {
      const haystack = [item.name, item.sku || "", item.metadata?.brand || ""]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      return haystack.includes(safeSearch);
    });
  }, [items, searchTerm]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-[-0.02em] text-black">
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Visualize e edite os itens desta categoria sem ficar preso na rota errada.
          </p>
          <p className="mt-1 text-xs text-gray-500">Total de itens: {items.length}</p>
        </div>

        <Link
          href="/configuracoes"
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
        >
          Voltar para configurações
        </Link>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">Buscar {pageTitle.toLowerCase()}</div>
            <div className="text-xs text-gray-500">Procure por nome, SKU ou marca.</div>
          </div>
          <div className="w-full md:max-w-md">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7"></circle>
                <path d="m20 20-3.5-3.5"></path>
              </svg>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={`Buscar ${pageTitle.toLowerCase()}...`}
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
        </div>
        {searchTerm.trim() ? (
          <div className="mt-2 text-xs text-gray-500">
            {filteredItems.length} resultado(s) encontrado(s) para "{searchTerm.trim()}".
          </div>
        ) : null}
      </div>

      {errorText ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {errorText}
        </div>
      ) : null}

      {successText ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          {successText}
        </div>
      ) : null}

      {!hasValidStoreContext ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          Nenhuma loja ativa encontrada.
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
          Carregando itens...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
          Nenhum item cadastrado nesta categoria.
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
          Nenhum item encontrado para a busca "{searchTerm}".
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const itemPhotos = photosByItemId[item.id] || [];
            const isEditing = editingItemId === item.id;
            const characteristics = buildCatalogCharacteristics(item, category);
            const complementaryDescription = buildComplementaryDescription(
              item,
              characteristics
            );

            return (
              <section
                key={item.id}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
              >
                <div className="border-b border-gray-200 px-3 py-3 sm:px-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-lg font-black leading-tight text-black">
                        {item.name}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        {item.sku ? `SKU: ${item.sku}` : "Sem SKU"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <DetailChip value={formatMoney(item.price_cents)} />
                      <DetailChip value={item.is_active ? "Ativo" : "Inativo"} />
                      <DetailChip
                        value={
                          item.track_stock
                            ? `Estoque: ${item.stock_quantity ?? 0}`
                            : "Sem estoque"
                        }
                      />
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 px-3 py-3 sm:px-4">
                  {isEditing && editForm ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Nome
                          </label>
                          <input
                            value={editForm.name}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, name: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            SKU
                          </label>
                          <input
                            value={editForm.sku}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, sku: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Marca
                          </label>
                          <input
                            value={editForm.brand}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, brand: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Linha / modelo
                          </label>
                          <input
                            value={editForm.line}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, line: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Unidade
                          </label>
                          <input
                            value={editForm.unit_label}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, unit_label: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Tamanho / variação
                          </label>
                          <input
                            value={editForm.size_details}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, size_details: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Largura (cm)
                          </label>
                          <input
                            value={editForm.width_cm}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, width_cm: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Altura (cm)
                          </label>
                          <input
                            value={editForm.height_cm}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, height_cm: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Comprimento (cm)
                          </label>
                          <input
                            value={editForm.length_cm}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, length_cm: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Peso (kg)
                          </label>
                          <input
                            value={editForm.weight_kg}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, weight_kg: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Preço
                          </label>
                          <input
                            value={editForm.price}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, price: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                            placeholder="129,90"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Quantidade em estoque
                          </label>
                          <input
                            value={editForm.stock_quantity}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, stock_quantity: event.target.value }
                                  : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                            placeholder="0"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-4 pt-6 text-sm text-gray-800 lg:col-span-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editForm.is_active}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current
                                    ? { ...current, is_active: event.target.checked }
                                    : current
                                )
                              }
                            />
                            Item ativo
                          </label>

                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editForm.track_stock}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current
                                    ? { ...current, track_stock: event.target.checked }
                                    : current
                                )
                              }
                            />
                            Controlar estoque
                          </label>
                        </div>

                        <div className="lg:col-span-2">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Aplicação / uso recomendado
                          </label>
                          <textarea
                            value={editForm.application}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, application: event.target.value }
                                  : current
                              )
                            }
                            rows={3}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div className="lg:col-span-2">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Observações técnicas
                          </label>
                          <textarea
                            value={editForm.technical_notes}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, technical_notes: event.target.value }
                                  : current
                              )
                            }
                            rows={3}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div className="lg:col-span-2">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Descrição
                          </label>
                          <textarea
                            value={editForm.description}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current
                                  ? { ...current, description: event.target.value }
                                  : current
                              )
                            }
                            rows={5}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveItem(item.id)}
                          disabled={savingItemId === item.id}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingItemId === item.id ? "Salvando..." : "Salvar"}
                        </button>

                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          disabled={deletingItemId === item.id}
                          className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingItemId === item.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <CharacteristicsTable
                    title={category === "quimicos" ? "Características do produto" : "Características do item"}
                    rows={characteristics}
                  />

                  {complementaryDescription ? (
                    <SectionCard title="Descrição complementar">
                      <div className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                        {complementaryDescription}
                      </div>
                    </SectionCard>
                  ) : null}

                  <SectionCard title="Fotos do item">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <input
                            ref={(element) => {
                              fileInputRefs.current[item.id] = element;
                            }}
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(event) => handleCatalogFilesChange(item.id, event)}
                            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                          />
                          <p className="mt-2 text-xs text-gray-500">
                            Até {MAX_CATALOG_PHOTOS} imagens, máximo de 50 MB por arquivo.
                          </p>
                        </div>

                        {(selectedCatalogFilesByItemId[item.id] || []).length > 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            {(selectedCatalogFilesByItemId[item.id] || []).map((file) => (
                              <div
                                key={`${file.name}-${file.size}`}
                                className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-2 last:border-b-0"
                              >
                                <span className="truncate font-medium text-gray-900">
                                  {file.name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {formatFileSize(file.size)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => void handleUploadNewPhotos(item.id)}
                          disabled={uploadingPhotosItemId === item.id}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingPhotosItemId === item.id
                            ? "Adicionando fotos..."
                            : "Adicionar fotos"}
                        </button>

                        {itemPhotos.length === 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                            Nenhuma foto cadastrada para este item.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {itemPhotos.map((photo) => {
                              const isDeletingPhoto = deletingPhotoId === photo.id;

                              return (
                                <div
                                  key={photo.id}
                                  className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                                >
                                  <img
                                    src={getPublicImageUrl(photo.storage_path)}
                                    alt={photo.file_name || item.name}
                                    className="block h-24 w-full object-cover"
                                  />
                                  <div className="space-y-2 p-2.5">
                                    <div className="truncate text-[11px] text-gray-600">
                                      {photo.file_name || "Foto"}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeletePhoto(photo)}
                                      disabled={isDeletingPhoto}
                                      className="w-full rounded-lg border border-red-200 bg-white px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {isDeletingPhoto ? "Excluindo..." : "Excluir foto"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : itemPhotos.length === 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                        Nenhuma foto cadastrada para este item.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                        {itemPhotos.map((photo) => (
                          <div
                            key={photo.id}
                            className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                          >
                            <img
                              src={getPublicImageUrl(photo.storage_path)}
                              alt={photo.file_name || item.name}
                              className="block h-16 w-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
