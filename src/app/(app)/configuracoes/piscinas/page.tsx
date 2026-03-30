"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type PoolRow = {
  id: string;
  organization_id: string;
  store_id: string;
  name: string | null;
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  shape: string | null;
  material: string | null;
  max_capacity_l: number | null;
  weight_kg: number | null;
  price: number | null;
  description: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  created_at?: string | null;
};

type PoolPhotoRow = {
  id: string;
  pool_id: string;
  organization_id: string;
  store_id: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
  created_at?: string | null;
};

type EditPoolForm = {
  name: string;
  description: string;
  price: string;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: string;
};

const STORAGE_BUCKET = "pool-photos";
const MAX_POOL_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const ACTIVE_EDITING_POOL_KEY_PREFIX = "zion:piscinas:active-editing-pool-id";

function moneyBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return `R$ ${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
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

function getPoolAvailability(pool: Pick<PoolRow, "is_active" | "track_stock" | "stock_quantity">) {
  if (!pool.is_active) {
    return {
      label: "Indisponível para oferta",
      detail: "Piscina inativa",
    };
  }

  if (!pool.track_stock) {
    return {
      label: "Disponível para oferta",
      detail: "Sem controle de estoque",
    };
  }

  if ((pool.stock_quantity ?? 0) > 0) {
    return {
      label: "Disponível para oferta",
      detail: `Estoque: ${pool.stock_quantity ?? 0}`,
    };
  }

  return {
    label: "Indisponível para oferta",
    detail: "Sem estoque",
  };
}

function buildEditForm(pool: PoolRow): EditPoolForm {
  return {
    name: pool.name ?? "",
    description: pool.description ?? "",
    price: pool.price == null ? "" : formatPriceInput(String(pool.price).replace(".", ",")),
    is_active: Boolean(pool.is_active),
    track_stock: Boolean(pool.track_stock),
    stock_quantity:
      pool.track_stock && pool.stock_quantity != null ? String(pool.stock_quantity) : "",
  };
}

function getPoolDraftKey(params: { organizationId: string; storeId: string; poolId: string }) {
  return `zion:pool-edit-draft:${params.organizationId}:${params.storeId}:${params.poolId}`;
}

function getActiveEditingPoolKey(params: { organizationId: string; storeId: string }) {
  return `${ACTIVE_EDITING_POOL_KEY_PREFIX}:${params.organizationId}:${params.storeId}`;
}

export default function PiscinasPage() {
  const { loading: storeLoading, organizationId, activeStoreId } = useStoreContext();

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const ORGANIZATION_ID = organizationId ?? "";
  const STORE_ID = activeStoreId ?? "";

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [photos, setPhotos] = useState<PoolPhotoRow[]>([]);

  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editPoolForm, setEditPoolForm] = useState<EditPoolForm | null>(null);
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null);
  const [deletingPoolId, setDeletingPoolId] = useState<string | null>(null);

  const [selectedPoolFilesByPoolId, setSelectedPoolFilesByPoolId] = useState<Record<string, File[]>>(
    {}
  );
  const [uploadingPoolPhotosId, setUploadingPoolPhotosId] = useState<string | null>(null);
  const [deletingPoolPhotoId, setDeletingPoolPhotoId] = useState<string | null>(null);

  useEffect(() => {
    if (storeLoading) return;

    if (!hasValidStoreContext) {
      setLoading(false);
      setErrorText("Nenhuma loja ativa foi encontrada para carregar as piscinas.");
      return;
    }

    void fetchData();
  }, [storeLoading, hasValidStoreContext, ORGANIZATION_ID, STORE_ID]);

  async function fetchData() {
    if (!hasValidStoreContext) return;

    setLoading(true);
    setErrorText(null);

    const [poolsResult, photosResult] = await Promise.all([
      supabase
        .from("pools")
        .select(
          "id,organization_id,store_id,name,width_m,length_m,depth_m,shape,material,max_capacity_l,weight_kg,price,description,is_active,track_stock,stock_quantity,created_at"
        )
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID)
        .order("created_at", { ascending: false }),
      supabase
        .from("pool_photos")
        .select(
          "id,pool_id,organization_id,store_id,storage_path,file_name,file_size_bytes,sort_order,created_at"
        )
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID)
        .order("sort_order", { ascending: true }),
    ]);

    if (poolsResult.error) {
      setErrorText(poolsResult.error.message ?? "Erro ao carregar piscinas.");
      setLoading(false);
      return;
    }

    if (photosResult.error) {
      setErrorText(photosResult.error.message ?? "Erro ao carregar fotos.");
      setLoading(false);
      return;
    }

    setPools((poolsResult.data || []) as PoolRow[]);
    setPhotos((photosResult.data || []) as PoolPhotoRow[]);
    setLoading(false);
  }

  const photosByPoolId = useMemo(() => {
    const grouped: Record<string, PoolPhotoRow[]> = {};

    for (const photo of photos) {
      if (!grouped[photo.pool_id]) {
        grouped[photo.pool_id] = [];
      }
      grouped[photo.pool_id].push(photo);
    }

    for (const poolId of Object.keys(grouped)) {
      grouped[poolId] = grouped[poolId].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    return grouped;
  }, [photos]);

  useEffect(() => {
    if (!editingPoolId || !editPoolForm || typeof window === "undefined" || !hasValidStoreContext) {
      return;
    }

    window.localStorage.setItem(
      getPoolDraftKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        poolId: editingPoolId,
      }),
      JSON.stringify(editPoolForm)
    );

    window.localStorage.setItem(
      getActiveEditingPoolKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
      }),
      editingPoolId
    );
  }, [editingPoolId, editPoolForm, hasValidStoreContext, ORGANIZATION_ID, STORE_ID]);

  useEffect(() => {
    if (
      loading ||
      pools.length === 0 ||
      typeof window === "undefined" ||
      !hasValidStoreContext ||
      editingPoolId
    ) {
      return;
    }

    const savedEditingPoolId = window.localStorage.getItem(
      getActiveEditingPoolKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
      })
    );

    if (!savedEditingPoolId) return;

    const pool = pools.find((item) => item.id === savedEditingPoolId);
    if (!pool) {
      window.localStorage.removeItem(
        getActiveEditingPoolKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
        })
      );
      window.localStorage.removeItem(
        getPoolDraftKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          poolId: savedEditingPoolId,
        })
      );
      return;
    }

    const fallbackForm = buildEditForm(pool);
    const savedDraft = window.localStorage.getItem(
      getPoolDraftKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        poolId: pool.id,
      })
    );

    setEditingPoolId(pool.id);

    if (!savedDraft) {
      setEditPoolForm(fallbackForm);
      return;
    }

    try {
      const parsed = JSON.parse(savedDraft) as EditPoolForm;
      setEditPoolForm({
        name: parsed?.name ?? fallbackForm.name,
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
      setEditPoolForm(fallbackForm);
    }
  }, [loading, pools, editingPoolId, hasValidStoreContext, ORGANIZATION_ID, STORE_ID]);

  function startEditing(pool: PoolRow) {
    setErrorText(null);
    setSuccessText(null);
    setEditingPoolId(pool.id);

    if (typeof window !== "undefined" && hasValidStoreContext) {
      window.localStorage.setItem(
        getActiveEditingPoolKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
        }),
        pool.id
      );
    }

    const fallbackForm = buildEditForm(pool);

    if (typeof window === "undefined" || !hasValidStoreContext) {
      setEditPoolForm(fallbackForm);
      return;
    }

    const savedDraft = window.localStorage.getItem(
      getPoolDraftKey({
        organizationId: ORGANIZATION_ID,
        storeId: STORE_ID,
        poolId: pool.id,
      })
    );

    if (!savedDraft) {
      setEditPoolForm(fallbackForm);
      return;
    }

    try {
      const parsed = JSON.parse(savedDraft) as EditPoolForm;
      setEditPoolForm({
        name: parsed?.name ?? fallbackForm.name,
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
      setEditPoolForm(fallbackForm);
    }
  }

  function cancelEditing() {
    const currentEditingPoolId = editingPoolId;

    setEditingPoolId(null);
    setEditPoolForm(null);

    setSelectedPoolFilesByPoolId((prev) => {
      const next = { ...prev };
      if (currentEditingPoolId) delete next[currentEditingPoolId];
      return next;
    });

    if (currentEditingPoolId && typeof window !== "undefined" && hasValidStoreContext) {
      window.localStorage.removeItem(
        getPoolDraftKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          poolId: currentEditingPoolId,
        })
      );
      window.localStorage.removeItem(
        getActiveEditingPoolKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
        })
      );
    }
  }

  async function handleSavePool(poolId: string) {
    if (!editPoolForm || !hasValidStoreContext) return;

    setErrorText(null);
    setSuccessText(null);

    if (!editPoolForm.name.trim()) {
      setErrorText("O nome da piscina é obrigatório.");
      return;
    }

    const priceValue = toNullableNumber(editPoolForm.price);
    const stockQuantityValue = toNullableInteger(editPoolForm.stock_quantity);

    if (editPoolForm.price.trim() && priceValue == null) {
      setErrorText("O preço da piscina está inválido.");
      return;
    }

    if (editPoolForm.track_stock) {
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

    setSavingPoolId(poolId);

    const { error } = await supabase
      .from("pools")
      .update({
        name: editPoolForm.name.trim(),
        description: editPoolForm.description.trim() || null,
        price: editPoolForm.price.trim() ? priceValue : null,
        is_active: editPoolForm.is_active,
        track_stock: editPoolForm.track_stock,
        stock_quantity: editPoolForm.track_stock ? stockQuantityValue : null,
      })
      .eq("id", poolId)
      .eq("organization_id", ORGANIZATION_ID)
      .eq("store_id", STORE_ID);

    if (error) {
      setErrorText(error.message ?? "Erro ao salvar piscina.");
      setSavingPoolId(null);
      return;
    }

    const pendingFiles = selectedPoolFilesByPoolId[poolId] || [];

    if (pendingFiles.length > 0) {
      try {
        await uploadPoolFiles(poolId, pendingFiles);
      } catch (uploadError: any) {
        setErrorText(
          uploadError?.message ??
            "Os dados da piscina foram salvos, mas houve erro ao enviar as novas fotos."
        );
        setSavingPoolId(null);
        await fetchData();
        return;
      }
    }

    setSelectedPoolFilesByPoolId((prev) => {
      const next = { ...prev };
      delete next[poolId];
      return next;
    });

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(
        getPoolDraftKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
          poolId,
        })
      );
      window.localStorage.removeItem(
        getActiveEditingPoolKey({
          organizationId: ORGANIZATION_ID,
          storeId: STORE_ID,
        })
      );
    }

    setSuccessText(
      pendingFiles.length > 0
        ? "Piscina e fotos atualizadas com sucesso."
        : "Piscina atualizada com sucesso."
    );
    setSavingPoolId(null);
    setEditingPoolId(null);
    setEditPoolForm(null);
    await fetchData();
  }

  async function handleDeletePool(poolId: string) {
    if (!hasValidStoreContext) return;

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir esta piscina? Essa ação também excluirá as fotos dela."
    );

    if (!confirmed) return;

    setErrorText(null);
    setSuccessText(null);
    setDeletingPoolId(poolId);

    try {
      const relatedPhotos = photosByPoolId[poolId] || [];

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
          .from("pool_photos")
          .delete()
          .eq("pool_id", poolId)
          .eq("organization_id", ORGANIZATION_ID)
          .eq("store_id", STORE_ID);

        if (photosDeleteError) throw photosDeleteError;
      }

      const { error: poolDeleteError } = await supabase
        .from("pools")
        .delete()
        .eq("id", poolId)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID);

      if (poolDeleteError) throw poolDeleteError;

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(
          getPoolDraftKey({
            organizationId: ORGANIZATION_ID,
            storeId: STORE_ID,
            poolId,
          })
        );

        window.localStorage.removeItem(
          getActiveEditingPoolKey({
            organizationId: ORGANIZATION_ID,
            storeId: STORE_ID,
          })
        );
      }

      setSelectedPoolFilesByPoolId((prev) => {
        const next = { ...prev };
        delete next[poolId];
        return next;
      });

      setEditingPoolId(null);
      setEditPoolForm(null);
      setSuccessText("Piscina excluída com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir piscina.");
    } finally {
      setDeletingPoolId(null);
    }
  }

  function handlePoolFilesChange(poolId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files || []);
    const existingCount = (photosByPoolId[poolId] || []).length;
    const totalAfterSelection = existingCount + fileList.length;

    if (totalAfterSelection > MAX_POOL_PHOTOS) {
      setErrorText(`Essa piscina pode ter no máximo ${MAX_POOL_PHOTOS} fotos no total.`);
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
    setSelectedPoolFilesByPoolId((prev) => ({
      ...prev,
      [poolId]: fileList,
    }));
  }

  async function uploadPoolFiles(poolId: string, files: File[]) {
    if (!hasValidStoreContext) throw new Error("Loja ativa não encontrada.");

    const existingPhotos = photosByPoolId[poolId] || [];
    let nextSortOrder = existingPhotos.length;

    for (const file of files) {
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${poolId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from("pool_photos").insert({
        pool_id: poolId,
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        storage_path: storagePath,
        file_name: file.name,
        file_size_bytes: file.size,
        sort_order: nextSortOrder,
      });

      if (metadataError) throw metadataError;
      nextSortOrder += 1;
    }
  }

  async function handleUploadNewPoolPhotos(poolId: string) {
    const files = selectedPoolFilesByPoolId[poolId] || [];

    if (files.length === 0) {
      setErrorText("Selecione uma ou mais fotos para adicionar.");
      return;
    }

    setErrorText(null);
    setSuccessText(null);
    setUploadingPoolPhotosId(poolId);

    try {
      await uploadPoolFiles(poolId, files);
      setSelectedPoolFilesByPoolId((prev) => ({
        ...prev,
        [poolId]: [],
      }));
      setSuccessText("Fotos adicionadas com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao adicionar fotos da piscina.");
    } finally {
      setUploadingPoolPhotosId(null);
    }
  }

  async function handleDeletePoolPhoto(photo: PoolPhotoRow) {
    if (!hasValidStoreContext) return;

    setErrorText(null);
    setSuccessText(null);
    setDeletingPoolPhotoId(photo.id);

    const belongsToActiveStore =
      photo.organization_id === ORGANIZATION_ID && photo.store_id === STORE_ID;

    if (!belongsToActiveStore) {
      setErrorText("Esta foto não pertence à loja ativa.");
      setDeletingPoolPhotoId(null);
      return;
    }

    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([photo.storage_path]);

    if (storageError) {
      setErrorText(storageError.message ?? "Erro ao excluir arquivo da foto.");
      setDeletingPoolPhotoId(null);
      return;
    }

    const { error: dbError } = await supabase
      .from("pool_photos")
      .delete()
      .eq("id", photo.id)
      .eq("organization_id", ORGANIZATION_ID)
      .eq("store_id", STORE_ID);

    if (dbError) {
      setErrorText(dbError.message ?? "Erro ao excluir registro da foto.");
      setDeletingPoolPhotoId(null);
      return;
    }

    setSuccessText("Foto excluída com sucesso.");
    setDeletingPoolPhotoId(null);
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
            Nenhuma loja ativa encontrada para carregar as piscinas.
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
            <h1 className="text-2xl font-bold text-gray-900">Piscinas cadastradas</h1>
            <p className="mt-2 text-gray-600">
              Visualize e edite todas as piscinas cadastradas.
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
            Carregando piscinas...
          </div>
        ) : pools.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Nenhuma piscina cadastrada.
          </div>
        ) : (
          <div className="space-y-6">
            {pools.map((pool) => {
              const poolPhotos = photosByPoolId[pool.id] || [];
              const availability = getPoolAvailability(pool);
              const isEditing = editingPoolId === pool.id && editPoolForm;
              const isSaving = savingPoolId === pool.id;
              const isDeleting = deletingPoolId === pool.id;
              const isUploadingPhotos = uploadingPoolPhotosId === pool.id;
              const selectedNewFiles = selectedPoolFilesByPoolId[pool.id] || [];

              return (
                <section
                  key={pool.id}
                  className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="border-b border-black/5 px-6 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">
                          {pool.name ?? "Piscina sem nome"}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          {pool.shape ?? "-"} • {pool.material ?? "-"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!isEditing ? (
                          <>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {moneyBRL(pool.price)}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {pool.is_active ? "Ativa" : "Inativa"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {pool.track_stock ? "Controla estoque" : "Sem controle de estoque"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {availability.label}
                            </span>

                            <button
                              type="button"
                              onClick={() => startEditing(pool)}
                              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                            >
                              Editar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleSavePool(pool.id)}
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
                              onClick={() => void handleDeletePool(pool.id)}
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
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Largura
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.width_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Comprimento
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.length_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Profundidade
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.depth_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Capacidade
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.max_capacity_l != null ? `${Number(pool.max_capacity_l).toLocaleString("pt-BR")} L` : "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Material
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.material ?? "-"}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Fotos
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {poolPhotos.length}
                          </div>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-4 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Nome
                            </label>
                            <input
                              value={editPoolForm.name}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev ? { ...prev, name: e.target.value } : prev
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
                              value={editPoolForm.price}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev
                                    ? { ...prev, price: formatPriceInput(e.target.value) }
                                    : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="Ex.: 12.000,00"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Descrição
                            </label>
                            <textarea
                              value={editPoolForm.description}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
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
                                checked={editPoolForm.is_active}
                                onChange={(e) =>
                                  setEditPoolForm((prev) =>
                                    prev ? { ...prev, is_active: e.target.checked } : prev
                                  )
                                }
                              />
                              Piscina ativa para oferta
                            </label>

                            <label className="flex items-center gap-3 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editPoolForm.track_stock}
                                onChange={(e) =>
                                  setEditPoolForm((prev) =>
                                    prev ? { ...prev, track_stock: e.target.checked } : prev
                                  )
                                }
                              />
                              Controlar estoque desta piscina
                            </label>
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Quantidade em estoque
                            </label>
                            <input
                              value={editPoolForm.stock_quantity}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        stock_quantity: formatIntegerInput(e.target.value),
                                      }
                                    : prev
                                )
                              }
                              disabled={!editPoolForm.track_stock}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
                              placeholder={
                                editPoolForm.track_stock
                                  ? "Ex.: 3"
                                  : "Desativado porque o controle de estoque está desligado"
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">
                              Disponibilidade comercial
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-gray-600">
                              <div>Status: {pool.is_active ? "Ativa" : "Inativa"}</div>
                              <div>
                                Controle de estoque: {pool.track_stock ? "Sim" : "Não"}
                              </div>
                              <div>
                                Quantidade em estoque:{" "}
                                {pool.track_stock ? pool.stock_quantity ?? 0 : "Não controlado"}
                              </div>
                              <div>Situação: {availability.detail}</div>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">Descrição</div>
                            <div className="mt-2 text-sm text-gray-600">
                              {pool.description?.trim() || "Sem descrição."}
                            </div>
                          </div>
                        </>
                      )}

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Informações adicionais
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>Capacidade: {pool.max_capacity_l ?? "-"} L</div>
                          <div>Peso: {pool.weight_kg ?? "-"} kg</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">
                          Fotos da piscina
                        </div>
                        <div className="text-xs text-gray-500">Até 10 fotos por piscina</div>
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
                                onChange={(e) => handlePoolFilesChange(pool.id, e)}
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
                              onClick={() => void handleUploadNewPoolPhotos(pool.id)}
                              disabled={isUploadingPhotos || selectedNewFiles.length === 0}
                              className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isUploadingPhotos ? "Adicionando fotos..." : "Adicionar fotos"}
                            </button>
                          </div>

                          {poolPhotos.length === 0 ? (
                            <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                              Nenhuma foto cadastrada para esta piscina.
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                              {poolPhotos.map((photo) => {
                                const isDeletingPhoto = deletingPoolPhotoId === photo.id;

                                return (
                                  <div
                                    key={photo.id}
                                    className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                                  >
                                    <img
                                      src={getPublicImageUrl(photo.storage_path)}
                                      alt={photo.file_name || pool.name || "Foto da piscina"}
                                      className="block h-28 w-full object-cover"
                                    />
                                    <div className="space-y-2 p-3">
                                      <div className="truncate text-xs text-gray-600">
                                        {photo.file_name || "Foto"}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void handleDeletePoolPhoto(photo)}
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
                      ) : poolPhotos.length === 0 ? (
                        <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                          Nenhuma foto cadastrada para esta piscina.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                          {poolPhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <img
                                src={getPublicImageUrl(photo.storage_path)}
                                alt={photo.file_name || pool.name || "Foto da piscina"}
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
