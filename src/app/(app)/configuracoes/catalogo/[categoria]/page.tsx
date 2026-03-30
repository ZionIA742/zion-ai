"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type CatalogItemMetadata = {
  categoria?: string | null;
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
const ACTIVE_EDITING_CATALOG_ITEM_KEY_PREFIX = "zion:catalogo:active-editing-item-id";

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

function moneyFromCentsBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return `R$ ${(value / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPriceInput(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");
  if (!cleaned) return "";

  const parts = cleaned.split(",");
  const integerPartRaw = parts[0].replace(/^0+(?=\d)/, "");
  const integerPart = integerPartRaw || (parts[0] ? "0" : "");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  if (parts.length === 1) {
    return formattedInteger;
  }

  const decimalPart = parts.slice(1).join("").slice(0, 2);
  return `${formattedInteger},${decimalPart}`;
}

function toNullableNumber(value: string) {
  const cleaned = value.replace(/\./g, "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatIntegerInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function toNullableInteger(value: string) {
  const cleaned = value.replace(/[^\d-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return null;
  return Math.trunc(parsed);
}

function formatFileSize(bytes: number | null) {
  if (bytes == null) return "-";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function getCatalogAvailability(
  item: Pick<CatalogItemRow, "is_active" | "track_stock" | "stock_quantity">
) {
  if (!item.is_active) {
    return {
      label: "Indisponível para oferta",
      detail: "Item inativo",
    };
  }

  if (!item.track_stock) {
    return {
      label: "Disponível para oferta",
      detail: "Sem controle de estoque",
    };
  }

  if ((item.stock_quantity ?? 0) > 0) {
    return {
      label: "Disponível para oferta",
      detail: `Estoque: ${item.stock_quantity ?? 0}`,
    };
  }

  return {
    label: "Indisponível para oferta",
    detail: "Sem estoque",
  };
}

function buildEditForm(item: CatalogItemRow): EditCatalogForm {
  return {
    name: item.name ?? "",
    sku: item.sku ?? "",
    description: item.description ?? "",
    price:
      item.price_cents == null
        ? ""
        : formatPriceInput(String(item.price_cents / 100).replace(".", ",")),
    is_active: Boolean(item.is_active),
    track_stock: Boolean(item.track_stock),
    stock_quantity:
      item.track_stock && item.stock_quantity != null ? String(item.stock_quantity) : "",
  };
}

function getCatalogDraftKey(params: {
  organizationId: string;
  storeId: string;
  category: string;
  itemId: string;
}) {
  return `zion:catalog-edit-draft:${params.organizationId}:${params.storeId}:${params.category}:${params.itemId}`;
}

function getActiveEditingCatalogItemKey(params: {
  organizationId: string;
  storeId: string;
  category: string;
}) {
  return `${ACTIVE_EDITING_CATALOG_ITEM_KEY_PREFIX}:${params.organizationId}:${params.storeId}:${params.category}`;
}

export default function CatalogoCategoriaPage() {
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const params = useParams();
  const categoriaParam = Array.isArray(params?.categoria)
    ? params.categoria[0]
    : (params?.categoria as string | undefined);

  const categoria = normalizeCategory(categoriaParam);

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const ORGANIZATION_ID = organizationId ?? "";
  const STORE_ID = activeStoreId ?? "";

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [photos, setPhotos] = useState<CatalogItemPhotoRow[]>([]);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemForm, setEditItemForm] = useState<EditCatalogForm | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const [selectedCatalogFilesByItemId, setSelectedCatalogFilesByItemId] = useState<
    Record<string, File[]>
  >({});
  const [uploadingCatalogPhotosId, setUploadingCatalogPhotosId] = useState<string | null>(null);
  const [deletingCatalogPhotoId, setDeletingCatalogPhotoId] = useState<string | null>(null);

  useEffect(() => {
    if (storeLoading) return;

    if (!hasValidStoreContext) {
      setLoading(false);
      setErrorText("Nenhuma loja ativa foi encontrada para carregar o catálogo.");
      return;
    }

    void fetchData();
  }, [storeLoading, hasValidStoreContext, ORGANIZATION_ID, STORE_ID, categoria]);

  async function fetchData() {
    if (!hasValidStoreContext) return;

    setLoading(true);
    setErrorText(null);

    const [itemsResult, photosResult] = await Promise.all([
      supabase
        .from("store_catalog_items")
        .select(
          "id,organization_id,store_id,sku,name,description,price_cents,currency,is_active,track_stock,stock_quantity,metadata,created_at,updated_at"
        )
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID)
        .order("created_at", { ascending: false }),
      supabase
        .from("store_catalog_item_photos")
        .select(
          "id,catalog_item_id,storage_path,file_name,file_size_bytes,sort_order,created_at"
        )
        .order("sort_order", { ascending: true }),
    ]);

    if (itemsResult.error) {
      setErrorText(itemsResult.error.message ?? "Erro ao carregar itens do catálogo.");
      setLoading(false);
      return;
    }

    if (photosResult.error) {
      setErrorText(photosResult.error.message ?? "Erro ao carregar fotos dos itens.");
      setLoading(false);
      return;
    }

    const allItems = (itemsResult.data || []) as CatalogItemRow[];
    const filteredItems = allItems.filter(
      (item) => normalizeCategory(item.metadata?.categoria) === categoria
    );

    const validItemIds = new Set(filteredItems.map((item) => item.id));
    const filteredPhotos = ((photosResult.data || []) as CatalogItemPhotoRow[]).filter((photo) =>
      validItemIds.has(photo.catalog_item_id)
    );

    setItems(filteredItems);
    setPhotos(filteredPhotos);
    setLoading(false);
  }

  const photosByItemId = useMemo(() => {
    const grouped: Record<string, CatalogItemPhotoRow[]> = {};

    for (const photo of photos) {
      if (!grouped[photo.catalog_item_id]) {
        grouped[photo.catalog_item_id] = [];
      }
      grouped[photo.catalog_item_id].push(photo);
    }

    for (const itemId of Object.keys(grouped)) {
      grouped[itemId] = grouped[itemId].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    return grouped;
  }, [photos]);

  useEffect(() => {
    if (!editingItemId || !editItemForm || typeof window === "undefined" || !hasValidStoreContext) {
      return;
    }

    const key = getCatalogDraftKey({
      organizationId: ORGANIZATION_ID,
      storeId: STORE_ID,
      category: categoria,
      itemId: editingItemId,
    });

    window.localStorage.setItem(key, JSON.stringify(editItemForm));
    window.localStorage.setItem(
      getActiveEditingCatalogItemKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        category: categoria,
      }),
      editingItemId
    );
  }, [editingItemId, editItemForm, categoria, hasValidStoreContext, ORGANIZATION_ID, STORE_ID]);

  useEffect(() => {
    if (
      loading ||
      items.length === 0 ||
      typeof window === "undefined" ||
      !hasValidStoreContext ||
      editingItemId
    ) {
      return;
    }

    const savedEditingItemId = window.localStorage.getItem(
      getActiveEditingCatalogItemKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        category: categoria,
      })
    );

    if (!savedEditingItemId) return;

    const item = items.find((current) => current.id === savedEditingItemId);
    if (!item) {
      window.localStorage.removeItem(
        getActiveEditingCatalogItemKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
        })
      );
      window.localStorage.removeItem(
        getCatalogDraftKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
          itemId: savedEditingItemId,
        })
      );
      return;
    }

    const fallbackForm = buildEditForm(item);
    const key = getCatalogDraftKey({
      organizationId: ORGANIZATION_ID,
      storeId: STORE_ID,
      category: categoria,
      itemId: item.id,
    });
    const savedDraft = window.localStorage.getItem(key);

    setEditingItemId(item.id);

    if (!savedDraft) {
      setEditItemForm(fallbackForm);
      return;
    }

    try {
      const parsed = JSON.parse(savedDraft) as EditCatalogForm;
      setEditItemForm({
        name: parsed?.name ?? fallbackForm.name,
        sku: parsed?.sku ?? fallbackForm.sku,
        description: parsed?.description ?? fallbackForm.description,
        price: parsed?.price ?? fallbackForm.price,
        is_active:
          typeof parsed?.is_active === "boolean"
            ? parsed.is_active
            : fallbackForm.is_active,
        track_stock:
          typeof parsed?.track_stock === "boolean"
            ? parsed.track_stock
            : fallbackForm.track_stock,
        stock_quantity: parsed?.stock_quantity ?? fallbackForm.stock_quantity,
      });
    } catch {
      setEditItemForm(fallbackForm);
    }
  }, [loading, items, editingItemId, categoria, hasValidStoreContext, ORGANIZATION_ID, STORE_ID]);

  function startEditing(item: CatalogItemRow) {
    setErrorText(null);
    setSuccessText(null);
    setEditingItemId(item.id);

    if (typeof window !== "undefined" && hasValidStoreContext) {
      window.localStorage.setItem(
        getActiveEditingCatalogItemKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
        }),
        item.id
      );
    }

    const fallbackForm = buildEditForm(item);

    if (typeof window === "undefined" || !hasValidStoreContext) {
      setEditItemForm(fallbackForm);
      return;
    }

    const key = getCatalogDraftKey({
      organizationId: ORGANIZATION_ID,
      storeId: STORE_ID,
      category: categoria,
      itemId: item.id,
    });

    const savedDraft = window.localStorage.getItem(key);

    if (!savedDraft) {
      setEditItemForm(fallbackForm);
      return;
    }

    try {
      const parsed = JSON.parse(savedDraft) as EditCatalogForm;
      setEditItemForm({
        name: parsed?.name ?? fallbackForm.name,
        sku: parsed?.sku ?? fallbackForm.sku,
        description: parsed?.description ?? fallbackForm.description,
        price: parsed?.price ?? fallbackForm.price,
        is_active:
          typeof parsed?.is_active === "boolean"
            ? parsed.is_active
            : fallbackForm.is_active,
        track_stock:
          typeof parsed?.track_stock === "boolean"
            ? parsed.track_stock
            : fallbackForm.track_stock,
        stock_quantity: parsed?.stock_quantity ?? fallbackForm.stock_quantity,
      });
    } catch {
      setEditItemForm(fallbackForm);
    }
  }

  function cancelEditing() {
    const currentEditingItemId = editingItemId;

    setEditingItemId(null);
    setEditItemForm(null);

    setSelectedCatalogFilesByItemId((prev) => {
      const next = { ...prev };
      if (currentEditingItemId) delete next[currentEditingItemId];
      return next;
    });

    if (currentEditingItemId && typeof window !== "undefined" && hasValidStoreContext) {
      const key = getCatalogDraftKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        category: categoria,
        itemId: currentEditingItemId,
      });

      window.localStorage.removeItem(key);
      window.localStorage.removeItem(
        getActiveEditingCatalogItemKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
        })
      );
    }
  }

  async function handleSaveItem(itemId: string) {
    if (!editItemForm || !hasValidStoreContext) return;

    setErrorText(null);
    setSuccessText(null);

    if (!editItemForm.name.trim()) {
      setErrorText("O nome do item é obrigatório.");
      return;
    }

    const priceValue = toNullableNumber(editItemForm.price);
    const stockQuantityValue = toNullableInteger(editItemForm.stock_quantity);

    if (!editItemForm.price.trim()) {
      setErrorText("O preço do item é obrigatório.");
      return;
    }

    if (priceValue == null) {
      setErrorText("O preço do item está inválido.");
      return;
    }

    if (priceValue < 0) {
      setErrorText("O preço do item não pode ser negativo.");
      return;
    }

    if (editItemForm.track_stock) {
      if (stockQuantityValue == null) {
        setErrorText(
          "A quantidade em estoque é obrigatória quando o controle de estoque está ativado."
        );
        return;
      }

      if (stockQuantityValue < 0) {
        setErrorText("A quantidade em estoque não pode ser negativa.");
        return;
      }
    }

    setSavingItemId(itemId);

    const { error } = await supabase
      .from("store_catalog_items")
      .update({
        sku: editItemForm.sku.trim() || null,
        name: editItemForm.name.trim(),
        description: editItemForm.description.trim() || null,
        price_cents: Math.round(priceValue * 100),
        is_active: editItemForm.is_active,
        track_stock: editItemForm.track_stock,
        stock_quantity: editItemForm.track_stock ? stockQuantityValue : null,
      })
      .eq("id", itemId)
      .eq("organization_id", ORGANIZATION_ID)
      .eq("store_id", STORE_ID);

    if (error) {
      setErrorText(error.message ?? "Erro ao salvar item.");
      setSavingItemId(null);
      return;
    }

    const pendingFiles = selectedCatalogFilesByItemId[itemId] || [];

    if (pendingFiles.length > 0) {
      try {
        await uploadCatalogFiles(itemId, pendingFiles);
      } catch (uploadError: any) {
        setErrorText(
          uploadError?.message ??
            "Os dados do item foram salvos, mas houve erro ao enviar as novas fotos."
        );
        setSavingItemId(null);
        await fetchData();
        return;
      }
    }

    setSelectedCatalogFilesByItemId((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    if (typeof window !== "undefined") {
      const key = getCatalogDraftKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        category: categoria,
        itemId,
      });

      window.localStorage.removeItem(key);
      window.localStorage.removeItem(
        getActiveEditingCatalogItemKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
        })
      );
    }

    setSuccessText(
      pendingFiles.length > 0
        ? "Item e fotos atualizados com sucesso."
        : "Item atualizado com sucesso."
    );
    setSavingItemId(null);
    setEditingItemId(null);
    setEditItemForm(null);
    await fetchData();
  }

  async function handleDeleteItem(itemId: string) {
    if (!hasValidStoreContext) return;

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir este item? Essa ação também excluirá as fotos dele."
    );

    if (!confirmed) return;

    setErrorText(null);
    setSuccessText(null);
    setDeletingItemId(itemId);

    try {
      const relatedPhotos = photosByItemId[itemId] || [];

      if (relatedPhotos.length > 0) {
        const storagePaths = relatedPhotos
          .map((photo) => photo.storage_path)
          .filter(Boolean);

        if (storagePaths.length > 0) {
          const { error: storageError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove(storagePaths);

          if (storageError) throw storageError;
        }

        const { error: photosDeleteError } = await supabase
          .from("store_catalog_item_photos")
          .delete()
          .eq("catalog_item_id", itemId);

        if (photosDeleteError) throw photosDeleteError;
      }

      const { error: itemDeleteError } = await supabase
        .from("store_catalog_items")
        .delete()
        .eq("id", itemId)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID);

      if (itemDeleteError) throw itemDeleteError;

      if (typeof window !== "undefined") {
        const key = getCatalogDraftKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          category: categoria,
          itemId,
        });

        window.localStorage.removeItem(key);
        window.localStorage.removeItem(
          getActiveEditingCatalogItemKey({
            organizationId: ORGANIZATION_ID,
            storeId: STORE_ID,
            category: categoria,
          })
        );
      }

      setSelectedCatalogFilesByItemId((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });

      setEditingItemId(null);
      setEditItemForm(null);
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
    const existingCount = (photosByItemId[itemId] || []).length;
    const totalAfterSelection = existingCount + fileList.length;

    if (totalAfterSelection > MAX_CATALOG_PHOTOS) {
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
    setSelectedCatalogFilesByItemId((prev) => ({
      ...prev,
      [itemId]: fileList,
    }));
  }

  async function uploadCatalogFiles(itemId: string, files: File[]) {
    const existingPhotos = photosByItemId[itemId] || [];
    let nextSortOrder = existingPhotos.length;

    for (const file of files) {
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${itemId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase
        .from("store_catalog_item_photos")
        .insert({
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

    setErrorText(null);
    setSuccessText(null);
    setUploadingCatalogPhotosId(itemId);

    try {
      await uploadCatalogFiles(itemId, files);
      setSelectedCatalogFilesByItemId((prev) => ({
        ...prev,
        [itemId]: [],
      }));
      setSuccessText("Fotos adicionadas com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao adicionar fotos do item.");
    } finally {
      setUploadingCatalogPhotosId(null);
    }
  }

  async function handleDeleteCatalogPhoto(photo: CatalogItemPhotoRow) {
    if (!hasValidStoreContext) return;

    setErrorText(null);
    setSuccessText(null);
    setDeletingCatalogPhotoId(photo.id);

    const belongsToVisibleItem = items.some((item) => item.id === photo.catalog_item_id);

    if (!belongsToVisibleItem) {
      setErrorText("Esta foto não pertence à loja ativa.");
      setDeletingCatalogPhotoId(null);
      return;
    }

    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([photo.storage_path]);

    if (storageError) {
      setErrorText(storageError.message ?? "Erro ao excluir arquivo da foto.");
      setDeletingCatalogPhotoId(null);
      return;
    }

    const { error: dbError } = await supabase
      .from("store_catalog_item_photos")
      .delete()
      .eq("id", photo.id)
      .eq("catalog_item_id", photo.catalog_item_id);

    if (dbError) {
      setErrorText(dbError.message ?? "Erro ao excluir registro da foto.");
      setDeletingCatalogPhotoId(null);
      return;
    }

    setSuccessText("Foto excluída com sucesso.");
    setDeletingCatalogPhotoId(null);
    await fetchData();
  }

  if (storeLoading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando loja ativa...
          </div>
        </div>
      </div>
    );
  }

  if (!hasValidStoreContext) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Nenhuma loja ativa encontrada para carregar o catálogo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{categoryLabel(categoria)}</h1>
            <p className="mt-2 text-gray-600">
              Visualize e edite todos os itens cadastrados desta categoria.
            </p>
          </div>

          <Link
            href="/configuracoes"
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
          >
            Voltar para configurações
          </Link>
        </div>

        {errorText ? (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
            <div className="font-semibold">Erro</div>
            <div className="mt-1 break-words">{errorText}</div>
          </div>
        ) : null}

        {successText ? (
          <div className="mb-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
            <div className="font-semibold">Sucesso</div>
            <div className="mt-1 break-words">{successText}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando itens...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Nenhum item cadastrado nesta categoria.
          </div>
        ) : (
          <div className="space-y-6">
            {items.map((item) => {
              const itemPhotos = photosByItemId[item.id] || [];
              const availability = getCatalogAvailability(item);
              const isEditing = editingItemId === item.id && editItemForm;
              const isSaving = savingItemId === item.id;
              const isDeleting = deletingItemId === item.id;
              const isUploadingPhotos = uploadingCatalogPhotosId === item.id;
              const selectedNewFiles = selectedCatalogFilesByItemId[item.id] || [];

              return (
                <section
                  key={item.id}
                  className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="border-b border-black/5 px-6 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">{item.name}</h2>
                        <p className="mt-1 text-sm text-gray-600">
                          {item.sku ? `Código do produto: ${item.sku}` : "Sem código do produto"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!isEditing ? (
                          <>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {moneyFromCentsBRL(item.price_cents)}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {item.is_active ? "Ativo" : "Inativo"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {item.track_stock ? "Controla estoque" : "Sem controle de estoque"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {availability.label}
                            </span>

                            <button
                              type="button"
                              onClick={() => startEditing(item)}
                              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                            >
                              Editar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleSaveItem(item.id)}
                              disabled={isSaving || isDeleting}
                              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSaving ? "Salvando..." : "Salvar"}
                            </button>

                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={isSaving || isDeleting}
                              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDeleteItem(item.id)}
                              disabled={isSaving || isDeleting}
                              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isDeleting ? "Excluindo..." : "Excluir"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 p-6 lg:grid-cols-[320px,1fr]">
                    <div className="space-y-4">
                      {isEditing ? (
                        <div className="space-y-4 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Nome do item
                            </label>
                            <input
                              value={editItemForm.name}
                              onChange={(e) =>
                                setEditItemForm((prev) =>
                                  prev ? { ...prev, name: e.target.value } : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Código do produto
                            </label>
                            <input
                              value={editItemForm.sku}
                              onChange={(e) =>
                                setEditItemForm((prev) =>
                                  prev ? { ...prev, sku: e.target.value } : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Preço
                            </label>
                            <input
                              value={editItemForm.price}
                              onChange={(e) =>
                                setEditItemForm((prev) =>
                                  prev
                                    ? { ...prev, price: formatPriceInput(e.target.value) }
                                    : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Descrição
                            </label>
                            <textarea
                              value={editItemForm.description}
                              onChange={(e) =>
                                setEditItemForm((prev) =>
                                  prev ? { ...prev, description: e.target.value } : prev
                                )
                              }
                              className="min-h-[120px] w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                            <label className="flex items-center gap-3 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editItemForm.is_active}
                                onChange={(e) =>
                                  setEditItemForm((prev) =>
                                    prev ? { ...prev, is_active: e.target.checked } : prev
                                  )
                                }
                              />
                              Item ativo para oferta
                            </label>

                            <label className="flex items-center gap-3 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editItemForm.track_stock}
                                onChange={(e) =>
                                  setEditItemForm((prev) =>
                                    prev ? { ...prev, track_stock: e.target.checked } : prev
                                  )
                                }
                              />
                              Controlar estoque deste item
                            </label>
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Quantidade em estoque
                            </label>
                            <input
                              value={editItemForm.stock_quantity}
                              onChange={(e) =>
                                setEditItemForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        stock_quantity: formatIntegerInput(e.target.value),
                                      }
                                    : prev
                                )
                              }
                              disabled={!editItemForm.track_stock}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
                              placeholder={
                                editItemForm.track_stock
                                  ? "Ex.: 12"
                                  : "Desativado porque o controle de estoque está desligado"
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">Descrição</div>
                            <div className="mt-2 text-sm text-gray-600">
                              {item.description?.trim() || "Sem descrição."}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">
                              Disponibilidade comercial
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-gray-600">
                              <div>Status: {item.is_active ? "Ativo" : "Inativo"}</div>
                              <div>
                                Controle de estoque: {item.track_stock ? "Sim" : "Não"}
                              </div>
                              <div>
                                Quantidade em estoque:{" "}
                                {item.track_stock ? item.stock_quantity ?? 0 : "Não controlado"}
                              </div>
                              <div>Situação: {availability.detail}</div>
                            </div>
                          </div>
                        </>
                      )}

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Informações do item
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>Categoria: {categoryLabel(categoria)}</div>
                          <div>Fotos cadastradas: {itemPhotos.length}</div>
                          <div>Moeda: {item.currency || "BRL"}</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">
                          Fotos do item
                        </div>
                        <div className="text-xs text-gray-500">Até 10 fotos por item</div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-4">
                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="mb-3 text-sm font-semibold text-gray-900">
                              Adicionar novas fotos
                            </div>

                            <label className="inline-flex cursor-pointer items-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90">
                              Selecionar fotos
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                multiple
                                onChange={(e) => handleCatalogFilesChange(item.id, e)}
                                className="hidden"
                              />
                            </label>

                            {selectedNewFiles.length > 0 ? (
                              <div className="mt-3 space-y-2 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                                {selectedNewFiles.map((file, index) => (
                                  <div
                                    key={`${file.name}-${index}`}
                                    className="flex items-center justify-between gap-3 text-sm text-gray-700"
                                  >
                                    <span className="truncate">{file.name}</span>
                                    <span className="shrink-0 text-xs text-gray-500">
                                      {formatFileSize(file.size)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-3 text-sm text-gray-600">
                                Nenhuma nova foto selecionada.
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleUploadNewCatalogPhotos(item.id)}
                              disabled={isUploadingPhotos || selectedNewFiles.length === 0}
                              className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isUploadingPhotos ? "Adicionando fotos..." : "Adicionar fotos"}
                            </button>
                          </div>

                          {itemPhotos.length === 0 ? (
                            <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                              Nenhuma foto cadastrada para este item.
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                              {itemPhotos.map((photo) => {
                                const isDeletingPhoto = deletingCatalogPhotoId === photo.id;

                                return (
                                  <div
                                    key={photo.id}
                                    className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                                  >
                                    <img
                                      src={getPublicImageUrl(photo.storage_path)}
                                      alt={photo.file_name || item.name}
                                      className="block h-28 w-full object-cover"
                                    />
                                    <div className="space-y-2 p-3">
                                      <div className="truncate text-xs text-gray-600">
                                        {photo.file_name || "Foto"}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteCatalogPhoto(photo)}
                                        disabled={isDeletingPhoto}
                                        className="w-full rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                            <div
                              key={photo.id}
                              className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <img
                                src={getPublicImageUrl(photo.storage_path)}
                                alt={photo.file_name || item.name}
                                className="block h-20 w-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}