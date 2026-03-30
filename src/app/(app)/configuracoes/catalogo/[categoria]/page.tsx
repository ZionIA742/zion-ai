
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

function cleanDescription(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/categoria esperada no sistema:[^\n]+/gi, "")
    .replace(/arquivo de teste[^\n]*/gi, "")
    .replace(/objetivo validar[^\n]*/gi, "")
    .replace(/salvar em configura[cç][oõ]es[^\n]*/gi, "")
    .replace(/imagem ilustrativa de alta qualidade para teste/gi, "")
    .replace(/campo valor/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function detailValue(label: string, item: CatalogItemRow) {
  const metadata = item.metadata || {};
  const map: Record<string, string | null | undefined> = {
    "Arquivo de origem": metadata.source_file_name,
    "Capacidade": metadata.capacity,
    "Medidas": metadata.dimensions,
    "Profundidade": metadata.depth,
    "Material": metadata.material,
    "Formato": metadata.shape,
    "Marca": metadata.brand,
    "Peso": metadata.weight,
    "Dosagem": metadata.dosage,
    "Cor": metadata.color,
    "Uso": metadata.usage,
    "Observação": metadata.notes,
  };
  return map[label] || "";
}

function buildDescription(item: CatalogItemRow) {
  const metadata = item.metadata || {};
  return cleanDescription(String(metadata.clean_description || item.description || ""));
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
        stock_quantity: editForm.track_stock && editForm.stock_quantity.trim() ? Number(editForm.stock_quantity) : null,
      };

      const { data, error } = await supabase
        .from("store_catalog_items")
        .update(payload)
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .select("*")
        .single();

      if (error) throw error;

      setItems((prev) => prev.map((item) => (item.id === itemId ? { ...(item), ...(data as CatalogItemRow) } : item)));
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

      const { error: photosError } = await supabase
        .from("store_catalog_item_photos")
        .delete()
        .eq("catalog_item_id", itemId);

      if (photosError) throw photosError;

      const { error: itemError } = await supabase
        .from("store_catalog_items")
        .delete()
        .eq("id", itemId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (itemError) throw itemError;

      setItems((prev) => prev.filter((item) => item.id !== itemId));
      setPhotosByItemId((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setEditingItemId((prev) => (prev === itemId ? null : prev));
      setEditForm((prev) => (editingItemId === itemId ? null : prev));
      setSuccessText("Item excluído com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir item.");
    } finally {
      setDeletingItemId(null);
    }
  }

  function handleCatalogFilesChange(itemId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files || []);
    if (fileList.length === 0) return;

    if (fileList.length > MAX_CATALOG_PHOTOS) {
      setErrorText(`Você pode selecionar no máximo ${MAX_CATALOG_PHOTOS} imagens por vez.`);
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

    setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: fileList }));
    setErrorText(null);
  }

  async function uploadCatalogFiles(itemId: string, files: File[]) {
    if (!hasValidStoreContext || !organizationId || !activeStoreId) throw new Error("Loja ativa não encontrada.");

    const existingPhotos = photosByItemId[itemId] || [];
    let nextSortOrder = existingPhotos.length;

    for (const file of files) {
      const extension = file.name.split(".").pop() || "jpg";
      const storagePath = `${organizationId}/${activeStoreId}/${itemId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
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

  async function handleUploadNewCatalogPhotos(itemId: string) {
    const files = selectedCatalogFilesByItemId[itemId] || [];
    if (files.length === 0) {
      setErrorText("Selecione uma ou mais fotos para adicionar.");
      return;
    }

    setUploadingPhotosItemId(itemId);
    setErrorText(null);
    setSuccessText(null);

    try {
      await uploadCatalogFiles(itemId, files);
      setSelectedCatalogFilesByItemId((prev) => ({ ...prev, [itemId]: [] }));
      setSuccessText("Fotos adicionadas com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao adicionar fotos do item.");
    } finally {
      setUploadingPhotosItemId(null);
    }
  }

  async function handleDeleteCatalogPhoto(photo: CatalogItemPhotoRow) {
    setDeletingPhotoId(photo.id);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([photo.storage_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from("store_catalog_item_photos")
        .delete()
        .eq("id", photo.id);

      if (dbError) throw dbError;

      setPhotosByItemId((prev) => ({
        ...prev,
        [photo.catalog_item_id]: (prev[photo.catalog_item_id] || []).filter((row) => row.id !== photo.id),
      }));
      setSuccessText("Foto excluída com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir foto.");
    } finally {
      setDeletingPhotoId(null);
    }
  }

  const heading = useMemo(() => categoryLabel(category), [category]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[42px] font-bold tracking-tight text-gray-950">{heading}</h1>
          <p className="mt-2 max-w-2xl text-lg leading-8 text-gray-700">
            Visualize e edite todos os itens cadastrados desta categoria.
          </p>
        </div>

        <Link
          href="/configuracoes"
          className="inline-flex items-center justify-center rounded-[20px] bg-white px-6 py-4 text-lg font-semibold text-gray-900 ring-1 ring-black/10"
        >
          Voltar para configurações
        </Link>
      </div>

      {errorText ? (
        <div className="rounded-[24px] bg-red-50 p-5 text-red-800 ring-1 ring-red-200">{errorText}</div>
      ) : null}

      {successText ? (
        <div className="rounded-[24px] bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">{successText}</div>
      ) : null}

      {loading ? (
        <div className="rounded-[24px] bg-white p-6 ring-1 ring-black/5">Carregando itens...</div>
      ) : items.length === 0 ? (
        <div className="rounded-[24px] bg-white p-6 ring-1 ring-black/5">Nenhum item cadastrado nesta categoria.</div>
      ) : (
        <div className="space-y-8">
          {items.map((item) => {
            const itemPhotos = photosByItemId[item.id] || [];
            const isEditing = editingItemId === item.id && editForm;
            const isSaving = savingItemId === item.id;
            const isDeleting = deletingItemId === item.id;
            const selectedCatalogFiles = selectedCatalogFilesByItemId[item.id] || [];
            const metadata = item.metadata || {};
            const description = buildDescription(item);
            const extraFields = [
              ["Capacidade", detailValue("Capacidade", item)],
              ["Medidas", detailValue("Medidas", item)],
              ["Profundidade", detailValue("Profundidade", item)],
              ["Material", detailValue("Material", item)],
              ["Formato", detailValue("Formato", item)],
              ["Marca", detailValue("Marca", item)],
              ["Peso", detailValue("Peso", item)],
              ["Dosagem", detailValue("Dosagem", item)],
              ["Cor", detailValue("Cor", item)],
              ["Uso", detailValue("Uso", item)],
              ["Observação", detailValue("Observação", item)],
            ].filter(([, value]) => Boolean(value));

            return (
              <section key={item.id} className="overflow-hidden rounded-[28px] bg-white ring-1 ring-black/5">
                <div className="border-b border-black/5 p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-2xl">
                      <h2 className="text-[30px] font-bold leading-tight text-gray-950">{item.name}</h2>
                      <p className="mt-2 text-xl text-gray-600">{item.sku ? `SKU ${item.sku}` : "Sem código do produto"}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <DetailChip value={formatMoney(item.price_cents)} />
                      <DetailChip value={item.is_active ? "Ativo" : "Inativo"} />
                      <DetailChip value={item.track_stock ? "Controla estoque" : "Sem controle de estoque"} />
                      <DetailChip value={item.is_active ? "Disponível para oferta" : "Indisponível"} />
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                          className="inline-flex rounded-full bg-white px-6 py-3 text-lg font-semibold text-gray-900 ring-1 ring-black/10"
                        >
                          Editar
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-6 p-6">
                  {isEditing && editForm ? (
                    <div className="space-y-4 rounded-[24px] bg-gray-50 p-5 ring-1 ring-black/5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <input
                          value={editForm.name}
                          onChange={(event) => setEditForm((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
                          placeholder="Nome do item"
                        />
                        <input
                          value={editForm.sku}
                          onChange={(event) => setEditForm((prev) => (prev ? { ...prev, sku: event.target.value } : prev))}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
                          placeholder="SKU"
                        />
                        <input
                          value={editForm.price}
                          onChange={(event) => setEditForm((prev) => (prev ? { ...prev, price: event.target.value } : prev))}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
                          placeholder="Preço"
                        />
                        <input
                          value={editForm.stock_quantity}
                          onChange={(event) => setEditForm((prev) => (prev ? { ...prev, stock_quantity: event.target.value } : prev))}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
                          placeholder="Quantidade em estoque"
                        />
                      </div>

                      <textarea
                        value={editForm.description}
                        onChange={(event) => setEditForm((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                        className="min-h-[160px] w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base outline-none focus:border-black"
                        placeholder="Descrição"
                      />

                      <div className="flex flex-wrap gap-4">
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={editForm.is_active}
                            onChange={(event) => setEditForm((prev) => (prev ? { ...prev, is_active: event.target.checked } : prev))}
                          />
                          Item ativo
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={editForm.track_stock}
                            onChange={(event) => setEditForm((prev) => (prev ? { ...prev, track_stock: event.target.checked } : prev))}
                          />
                          Controlar estoque
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void handleSaveItem(item.id)}
                          disabled={isSaving || isDeleting}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {isSaving ? "Salvando..." : "Salvar"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          disabled={isSaving || isDeleting}
                          className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id)}
                          disabled={isSaving || isDeleting}
                          className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {isDeleting ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <SectionCard title="Arquivo de origem">
                      <div className="text-lg text-gray-800">{metadata.source_file_name || "Não informado"}</div>
                    </SectionCard>

                    {extraFields.length > 0 ? (
                      <SectionCard title="Campos identificados">
                        <div className="space-y-2 text-base text-gray-800">
                          {extraFields.slice(0, 4).map(([label, value]) => (
                            <div key={label}>
                              <span className="font-semibold">{label}:</span> {value}
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    ) : (
                      <SectionCard title="Informações do item">
                        <div className="space-y-2 text-base text-gray-800">
                          <div><span className="font-semibold">Categoria:</span> {categoryLabel(category)}</div>
                          <div><span className="font-semibold">Fotos cadastradas:</span> {itemPhotos.length}</div>
                          <div><span className="font-semibold">Moeda:</span> {item.currency || "BRL"}</div>
                        </div>
                      </SectionCard>
                    )}
                  </div>

                  {description ? (
                    <SectionCard title="Descrição limpa">
                      <div className="whitespace-pre-wrap text-lg leading-8 text-gray-800">{description}</div>
                    </SectionCard>
                  ) : null}

                  {extraFields.length > 4 ? (
                    <SectionCard title="Informações adicionais">
                      <div className="space-y-2 text-base text-gray-800">
                        {extraFields.slice(4).map(([label, value]) => (
                          <div key={label}>
                            <span className="font-semibold">{label}:</span> {value}
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  ) : null}

                  <SectionCard title="Fotos do item">
                    {isEditing ? (
                      <div className="space-y-4">
                        <div>
                          <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(event) => handleCatalogFilesChange(item.id, event)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                          />
                          <p className="mt-1 text-[10px] text-gray-500">
                            Até {MAX_CATALOG_PHOTOS} imagens, máximo de 50 MB por arquivo.
                          </p>
                          {selectedCatalogFiles.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              {selectedCatalogFiles.map((file) => (
                                <div
                                  key={`${file.name}-${file.size}`}
                                  className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 ring-1 ring-black/5"
                                >
                                  {file.name} — {formatFileSize(file.size)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleUploadNewCatalogPhotos(item.id)}
                          disabled={uploadingPhotosItemId === item.id}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {uploadingPhotosItemId === item.id ? "Enviando fotos..." : "Adicionar fotos"}
                        </button>

                        {itemPhotos.length === 0 ? (
                          <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                            Nenhuma foto cadastrada para este item.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {itemPhotos.map((photo) => {
                              const isDeletingPhoto = deletingPhotoId === photo.id;
                              return (
                                <div key={photo.id} className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5">
                                  <img
                                    src={getPublicImageUrl(photo.storage_path)}
                                    alt={photo.file_name || item.name}
                                    className="block h-28 w-full object-cover"
                                  />
                                  <div className="space-y-2 p-3">
                                    <div className="truncate text-xs text-gray-600">{photo.file_name || "Foto"}</div>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteCatalogPhoto(photo)}
                                      disabled={isDeletingPhoto}
                                      className="w-full rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
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
                      <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                        Nenhuma foto cadastrada para este item.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                        {itemPhotos.map((photo) => (
                          <div key={photo.id} className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5">
                            <img
                              src={getPublicImageUrl(photo.storage_path)}
                              alt={photo.file_name || item.name}
                              className="block h-20 w-full object-cover"
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
