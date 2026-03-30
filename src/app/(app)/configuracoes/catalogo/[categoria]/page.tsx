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
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
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

function titleCaseLabel(value: string) {
  const cleaned = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const forced: Record<string, string> = { sku: "SKU" };

  return cleaned
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (forced[lower]) return forced[lower];
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
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
    "nome comercial",
    "categoria",
    "arquivo de origem",
    "objetivo",
    "informacao",
    "informação",
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
    normalized.startsWith("salvar em configurações") ||
    normalized.startsWith("imagem ilustrativa de alta qualidade para teste") ||
    normalized.startsWith("validar classificacao") ||
    normalized.startsWith("validar classificação") ||
    normalized.startsWith("leitura de imagem") ||
    normalized.startsWith("salvamento automatico") ||
    normalized.startsWith("salvamento automático")
  );
}

function characteristicValue(raw: unknown) {
  const value = cleanLooseText(typeof raw === "string" || typeof raw === "number" ? String(raw) : "");
  if (!value) return "";
  return value;
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

  pushCharacteristic(rows, "Nome", item.name);
  pushCharacteristic(rows, "Categoria", categoryLabel(category));
  if (typeof item.price_cents === "number") pushCharacteristic(rows, "Preço", formatMoney(item.price_cents));
  pushCharacteristic(rows, "SKU", item.sku || metadata.sku);

  if (category === "quimicos") {
    pushCharacteristic(rows, "Marca", metadata.brand);
    pushCharacteristic(rows, "Peso", metadata.weight);
    pushCharacteristic(rows, "Formato", metadata.shape);
    pushCharacteristic(rows, "Cor", metadata.color);
    pushCharacteristic(rows, "Dosagem", metadata.dosage);
    pushCharacteristic(rows, "Concentração", metadata.concentration || metadata.capacity);
    pushCharacteristic(rows, "Aplicação", metadata.application || metadata.usage);
    pushCharacteristic(rows, "Indicação", metadata.indication || metadata.notes);
    pushCharacteristic(rows, "Composição", metadata.composition);
    pushCharacteristic(rows, "Embalagem", metadata.embalagem || metadata.packaging);
  } else if (category === "acessorios") {
    pushCharacteristic(rows, "Marca", metadata.brand);
    pushCharacteristic(rows, "Material", metadata.material);
    pushCharacteristic(rows, "Cor", metadata.color);
    pushCharacteristic(rows, "Compatibilidade", metadata.compatibility || metadata.usage);
    pushCharacteristic(rows, "Função", metadata.function || metadata.notes);
    pushCharacteristic(rows, "Aplicação", metadata.application);
    pushCharacteristic(rows, "Modelo", metadata.model);
    pushCharacteristic(rows, "Tamanho", metadata.size || metadata.dimensions);
  } else {
    pushCharacteristic(rows, "Marca", metadata.brand);
    pushCharacteristic(rows, "Material", metadata.material);
    pushCharacteristic(rows, "Cor", metadata.color);
    pushCharacteristic(rows, "Aplicação", metadata.application || metadata.usage);
    pushCharacteristic(rows, "Diferencial", metadata.diferencial || metadata.feature || metadata.notes);
    pushCharacteristic(rows, "Ambiente indicado", metadata.environment);
    pushCharacteristic(rows, "Modelo", metadata.model);
    pushCharacteristic(rows, "Tamanho", metadata.size || metadata.dimensions);
  }

  pushCharacteristic(rows, "Arquivo de origem", metadata.source_file_name);
  return rows;
}

function buildComplementaryDescription(item: CatalogItemRow, characteristics: CharacteristicRow[]) {
  const metadata = item.metadata || {};
  const sourceText = cleanLooseText(String(metadata.clean_description || item.description || ""));
  if (!sourceText) return "";

  const characteristicValues = characteristics.map((row) => normalizeLoose(row.value)).filter(Boolean);
  const lines = sourceText
    .split(/\n+/)
    .map((line) => cleanLooseText(line))
    .filter(Boolean)
    .filter((line) => !isJunkDescriptionLine(line))
    .filter((line) => {
      const normalized = normalizeLoose(line);
      if (!normalized) return false;
      if (characteristicValues.includes(normalized)) return false;
      return !characteristicValues.some((value) => value.length >= 10 && normalized === value);
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
  return {
    name: item.name || "",
    sku: item.sku || "",
    description: item.description || "",
    price: toPriceInput(item.price_cents),
    is_active: item.is_active,
    track_stock: item.track_stock,
    stock_quantity: item.stock_quantity == null ? "" : String(item.stock_quantity),
  };
}

function DetailChip({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10">
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
    <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
      <h3 className="mb-3 text-xl font-bold text-gray-900">{title}</h3>
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
      <div className="overflow-hidden rounded-2xl ring-1 ring-black/5">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={`grid gap-2 px-4 py-3 text-sm sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start ${
              index % 2 === 0 ? "bg-gray-50" : "bg-white"
            } ${index > 0 ? "border-t border-gray-200" : ""}`}
          >
            <div className="font-semibold text-gray-700">{row.label}</div>
            <div className="text-gray-900 break-words">{row.value}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default function CatalogCategoryPage() {
  const params = useParams<{ categoria?: string }>();
  const category = normalizeCategory(Array.isArray(params?.categoria) ? params?.categoria[0] : params?.categoria);
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

    if (fileList.length > MAX_CATALOG_PHOTOS) {
      setErrorText(`Você pode selecionar no máximo ${MAX_CATALOG_PHOTOS} fotos por item.`);
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
    setSelectedCatalogFilesByItemId((prev) => ({
      ...prev,
      [itemId]: fileList,
    }));
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
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([photo.storage_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase.from("store_catalog_item_photos").delete().eq("id", photo.id);
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
      const payload = {
        name: editForm.name.trim(),
        sku: editForm.sku.trim() || null,
        description: editForm.description.trim() || null,
        price_cents: priceInputToCents(editForm.price),
        is_active: editForm.is_active,
        track_stock: editForm.track_stock,
        stock_quantity:
          editForm.track_stock && editForm.stock_quantity.trim() ? Number(editForm.stock_quantity) : null,
      };

      const { error } = await supabase
        .from("store_catalog_items")
        .update(payload)
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (error) throw error;

      const pendingFiles = selectedCatalogFilesByItemId[itemId] || [];
      if (pendingFiles.length > 0) {
        await uploadCatalogFiles(itemId, pendingFiles);
        setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: [] }));
        const input = fileInputRefs.current[itemId];
        if (input) input.value = "";
      }

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

    const confirmed = window.confirm("Tem certeza que deseja excluir este item? Essa ação também apaga as fotos dele.");
    if (!confirmed) return;

    setDeletingItemId(itemId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const itemPhotos = photosByItemId[itemId] || [];
      const storagePaths = itemPhotos.map((photo) => photo.storage_path).filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
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
      setSuccessText("Item excluído com sucesso.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir item.");
    } finally {
      setDeletingItemId(null);
    }
  }

  const pageTitle = useMemo(() => categoryLabel(category), [category]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[42px] font-black tracking-[-0.03em] text-black">{pageTitle}</h1>
          <p className="mt-2 text-lg text-gray-700">Visualize e edite todos os itens cadastrados desta categoria.</p>
        </div>
        <Link
          href="/configuracoes"
          className="rounded-2xl bg-white px-6 py-3 text-base font-semibold text-gray-900 ring-1 ring-black/10 transition hover:bg-gray-50"
        >
          Voltar para configurações
        </Link>
      </div>

      {errorText ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{errorText}</div>
      ) : null}
      {successText ? (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">{successText}</div>
      ) : null}

      {loading ? (
        <div className="rounded-[28px] bg-white p-10 text-sm text-gray-600 ring-1 ring-black/5">Carregando itens...</div>
      ) : items.length === 0 ? (
        <div className="rounded-[28px] bg-white p-10 text-sm text-gray-600 ring-1 ring-black/5">Nenhum item cadastrado nesta categoria.</div>
      ) : (
        <div className="space-y-5">
          {items.map((item) => {
            const itemPhotos = photosByItemId[item.id] || [];
            const isEditing = editingItemId === item.id;
            const characteristics = buildCatalogCharacteristics(item, category);
            const complementaryDescription = buildComplementaryDescription(item, characteristics);
            const characteristicsTitle = category === "quimicos" ? "Características do produto" : "Características do item";

            return (
              <section key={item.id} className="overflow-hidden rounded-[28px] bg-white ring-1 ring-black/5">
                <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <h2 className="max-w-4xl text-[22px] font-black leading-tight tracking-[-0.02em] text-black">
                        {item.name}
                      </h2>
                      <p className="mt-2 text-base text-gray-600">{item.sku ? `SKU: ${item.sku}` : "Sem código do produto"}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      <DetailChip value={formatMoney(item.price_cents)} />
                      <DetailChip value={item.is_active ? "Ativo" : "Inativo"} />
                      <DetailChip value={item.track_stock ? `Estoque: ${item.stock_quantity ?? 0}` : "Sem controle de estoque"} />
                      <DetailChip value={item.is_active && (!item.track_stock || (item.stock_quantity ?? 0) > 0) ? "Disponível para oferta" : "Indisponível"} />
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        className="rounded-2xl bg-white px-5 py-3 text-base font-semibold text-gray-900 ring-1 ring-black/10 transition hover:bg-gray-50"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
                  {isEditing && editForm ? (
                    <div className="rounded-[24px] bg-gray-50 p-4 ring-1 ring-black/5">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</label>
                          <input
                            value={editForm.name}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, name: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">SKU</label>
                          <input
                            value={editForm.sku}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, sku: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</label>
                          <input
                            value={editForm.price}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, price: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                            placeholder="129,90"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantidade em estoque</label>
                          <input
                            value={editForm.stock_quantity}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, stock_quantity: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                            placeholder="0"
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição</label>
                          <textarea
                            value={editForm.description}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, description: event.target.value } : current))}
                            rows={6}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-800">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editForm.is_active}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, is_active: event.target.checked } : current))}
                          />
                          Item ativo
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editForm.track_stock}
                            onChange={(event) => setEditForm((current) => (current ? { ...current, track_stock: event.target.checked } : current))}
                          />
                          Controlar estoque
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSaveItem(item.id)}
                          disabled={savingItemId === item.id}
                          className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingItemId === item.id ? "Salvando..." : "Salvar"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          disabled={deletingItemId === item.id}
                          className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingItemId === item.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <CharacteristicsTable title={characteristicsTitle} rows={characteristics} />

                  {complementaryDescription ? (
                    <SectionCard title="Descrição complementar">
                      <div className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">{complementaryDescription}</div>
                    </SectionCard>
                  ) : null}

                  <SectionCard title="Fotos do item">
                    {isEditing ? (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                          <input
                            ref={(element) => {
                              fileInputRefs.current[item.id] = element;
                            }}
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(event) => handleCatalogFilesChange(item.id, event)}
                            className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                          />
                          <p className="mt-2 text-xs text-gray-500">Até {MAX_CATALOG_PHOTOS} imagens, máximo de 50 MB por arquivo.</p>
                        </div>

                        {(selectedCatalogFilesByItemId[item.id] || []).length > 0 ? (
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                            {(selectedCatalogFilesByItemId[item.id] || []).map((file) => (
                              <div key={`${file.name}-${file.size}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-2 last:border-b-0">
                                <span className="truncate font-medium text-gray-900">{file.name}</span>
                                <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => void handleUploadNewPhotos(item.id)}
                          disabled={uploadingPhotosItemId === item.id}
                          className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingPhotosItemId === item.id ? "Adicionando fotos..." : "Adicionar fotos"}
                        </button>

                        {itemPhotos.length === 0 ? (
                          <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">Nenhuma foto cadastrada para este item.</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {itemPhotos.map((photo) => {
                              const isDeletingPhoto = deletingPhotoId === photo.id;
                              return (
                                <div key={photo.id} className="overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5">
                                  <img src={getPublicImageUrl(photo.storage_path)} alt={photo.file_name || item.name} className="block h-28 w-full object-cover" />
                                  <div className="space-y-2 p-3">
                                    <div className="truncate text-xs text-gray-600">{photo.file_name || "Foto"}</div>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeletePhoto(photo)}
                                      disabled={isDeletingPhoto}
                                      className="w-full rounded-xl bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                      <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">Nenhuma foto cadastrada para este item.</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                        {itemPhotos.map((photo) => (
                          <div key={photo.id} className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5">
                            <img src={getPublicImageUrl(photo.storage_path)} alt={photo.file_name || item.name} className="block h-20 w-full object-cover" />
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
