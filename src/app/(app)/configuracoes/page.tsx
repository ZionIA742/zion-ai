"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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

type CharacteristicRow = {
  label: string;
  value: string;
};

const STORAGE_BUCKET = "pool-photos";
const MAX_POOL_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

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
  const decimalPart = parts[1] ? parts[1].slice(0, 2) : "";
  return decimalPart ? `${formattedInteger},${decimalPart}` : formattedInteger;
}

function priceInputToNumber(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
  return (
    normalized === "descricao detalhada" ||
    normalized === "descrição detalhada" ||
    normalized.startsWith("arquivo de teste") ||
    normalized.startsWith("imagem de referencia visual") ||
    normalized.startsWith("imagem de referência visual") ||
    normalized.startsWith("campo") ||
    normalized.startsWith("valor") ||
    normalized.startsWith("categoria") ||
    normalized.startsWith("modelo") ||
    normalized.startsWith("tipo") ||
    normalized.startsWith("medidas") ||
    normalized.startsWith("profundidade") ||
    normalized.startsWith("capacidade") ||
    normalized.startsWith("material") ||
    normalized.startsWith("preco") ||
    normalized.startsWith("preço") ||
    normalized.startsWith("prazo") ||
    normalized.startsWith("observacao de teste") ||
    normalized.startsWith("observação de teste")
  );
}

function pushCharacteristic(rows: CharacteristicRow[], label: string, value: string | null | undefined) {
  const safeValue = cleanLooseText(value);
  if (!safeValue) return;
  if (rows.some((row) => row.label === label && row.value === safeValue)) return;
  rows.push({ label, value: safeValue });
}

function buildPoolCharacteristics(pool: PoolRow): CharacteristicRow[] {
  const rows: CharacteristicRow[] = [];
  pushCharacteristic(rows, "Nome", pool.name || "");
  if (pool.price != null) pushCharacteristic(rows, "Preço", moneyBRL(pool.price));
  pushCharacteristic(rows, "Formato", pool.shape);
  pushCharacteristic(rows, "Material", pool.material);
  if (pool.width_m != null) pushCharacteristic(rows, "Largura", `${pool.width_m} m`);
  if (pool.length_m != null) pushCharacteristic(rows, "Comprimento", `${pool.length_m} m`);
  if (pool.depth_m != null) pushCharacteristic(rows, "Profundidade", `${pool.depth_m} m`);
  if (pool.max_capacity_l != null) pushCharacteristic(rows, "Capacidade", `${pool.max_capacity_l.toLocaleString("pt-BR")} L`);
  if (pool.weight_kg != null) pushCharacteristic(rows, "Peso", `${pool.weight_kg} kg`);
  return rows;
}

function buildComplementaryDescription(pool: PoolRow, characteristics: CharacteristicRow[]) {
  const sourceText = cleanLooseText(pool.description || "");
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
      return !characteristicValues.some((value) => value.length >= 8 && normalized === value);
    });

  const unique: string[] = [];
  for (const line of lines) {
    if (!unique.some((existing) => normalizeLoose(existing) === normalizeLoose(line))) {
      unique.push(line);
    }
  }

  return unique.join("\n").trim();
}

function buildEditForm(pool: PoolRow): EditPoolForm {
  return {
    name: pool.name || "",
    description: pool.description || "",
    price: pool.price == null ? "" : formatPriceInput(String(pool.price.toFixed(2).replace(".", ","))),
    is_active: pool.is_active,
    track_stock: pool.track_stock,
    stock_quantity: pool.stock_quantity == null ? "" : String(pool.stock_quantity),
  };
}

function DetailChip({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10">
      {value}
    </span>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] bg-white p-5 ring-1 ring-black/5">
      <h3 className="mb-3 text-xl font-bold text-gray-900">{title}</h3>
      {children}
    </div>
  );
}

function CharacteristicsTable({ title, rows }: { title: string; rows: CharacteristicRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionCard title={title}>
      <div className="overflow-hidden rounded-2xl ring-1 ring-black/5">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className={`grid gap-2 px-4 py-3 text-sm sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start ${index % 2 === 0 ? "bg-gray-50" : "bg-white"} ${index > 0 ? "border-t border-gray-200" : ""}`}
          >
            <div className="font-semibold text-gray-700">{row.label}</div>
            <div className="break-words text-gray-900">{row.value}</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default function PoolsPage() {
  const { organizationId, activeStoreId } = useStoreContext();

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [photosByPoolId, setPhotosByPoolId] = useState<Record<string, PoolPhotoRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editPoolForm, setEditPoolForm] = useState<EditPoolForm | null>(null);
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null);
  const [deletingPoolId, setDeletingPoolId] = useState<string | null>(null);
  const [deletingPoolPhotoId, setDeletingPoolPhotoId] = useState<string | null>(null);
  const [selectedPoolFilesByPoolId, setSelectedPoolFilesByPoolId] = useState<Record<string, File[]>>({});
  const [uploadingPoolPhotosId, setUploadingPoolPhotosId] = useState<string | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const hasValidStoreContext = Boolean(organizationId && activeStoreId);

  async function fetchData() {
    if (!organizationId || !activeStoreId) {
      setPools([]);
      setPhotosByPoolId({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const { data: poolRows, error } = await supabase
        .from("pools")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const nextPools = (poolRows || []) as PoolRow[];
      setPools(nextPools);

      if (nextPools.length === 0) {
        setPhotosByPoolId({});
        return;
      }

      const poolIds = nextPools.map((pool) => pool.id);
      const { data: photoRows, error: photosError } = await supabase
        .from("pool_photos")
        .select("*")
        .in("pool_id", poolIds)
        .order("sort_order", { ascending: true });

      if (photosError) throw photosError;

      const grouped: Record<string, PoolPhotoRow[]> = {};
      for (const photo of (photoRows || []) as PoolPhotoRow[]) {
        if (!grouped[photo.pool_id]) grouped[photo.pool_id] = [];
        grouped[photo.pool_id].push(photo);
      }
      setPhotosByPoolId(grouped);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar piscinas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
  }, [organizationId, activeStoreId]);

  function startEditing(pool: PoolRow) {
    setEditingPoolId(pool.id);
    setEditPoolForm(buildEditForm(pool));
    setErrorText(null);
    setSuccessText(null);
  }

  function cancelEditing() {
    setEditingPoolId(null);
    setEditPoolForm(null);
  }

  function handlePoolFilesChange(poolId: string, event: ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files || []);

    if (fileList.length > MAX_POOL_PHOTOS) {
      setErrorText(`Você pode selecionar no máximo ${MAX_POOL_PHOTOS} fotos por piscina.`);
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
    setSelectedPoolFilesByPoolId((prev) => ({ ...prev, [poolId]: fileList }));
  }

  async function uploadPoolFiles(poolId: string, files: File[]) {
    if (!organizationId || !activeStoreId) throw new Error("Loja ativa não encontrada.");

    const existingPhotos = photosByPoolId[poolId] || [];
    let nextSortOrder = existingPhotos.length;

    for (const file of files) {
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${organizationId}/${activeStoreId}/${poolId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from("pool_photos").insert({
        pool_id: poolId,
        organization_id: organizationId,
        store_id: activeStoreId,
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
      setSelectedPoolFilesByPoolId((prev) => ({ ...prev, [poolId]: [] }));
      const input = fileInputRefs.current[poolId];
      if (input) input.value = "";
      setSuccessText("Fotos adicionadas com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao adicionar fotos da piscina.");
    } finally {
      setUploadingPoolPhotosId(null);
    }
  }

  async function handleDeletePoolPhoto(photo: PoolPhotoRow) {
    setErrorText(null);
    setSuccessText(null);
    setDeletingPoolPhotoId(photo.id);

    try {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([photo.storage_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase.from("pool_photos").delete().eq("id", photo.id);
      if (dbError) throw dbError;

      setSuccessText("Foto excluída com sucesso.");
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir foto da piscina.");
    } finally {
      setDeletingPoolPhotoId(null);
    }
  }

  async function handleSavePool(poolId: string) {
    if (!editPoolForm || !organizationId || !activeStoreId) return;
    setSavingPoolId(poolId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const parsedPrice = priceInputToNumber(editPoolForm.price);
      const { error } = await supabase
        .from("pools")
        .update({
          name: editPoolForm.name.trim() || null,
          description: editPoolForm.description.trim() || null,
          price: parsedPrice,
          is_active: editPoolForm.is_active,
          track_stock: editPoolForm.track_stock,
          stock_quantity:
            editPoolForm.track_stock && editPoolForm.stock_quantity.trim() ? Number(editPoolForm.stock_quantity) : null,
        })
        .eq("id", poolId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (error) throw error;

      const pendingFiles = selectedPoolFilesByPoolId[poolId] || [];
      if (pendingFiles.length > 0) {
        await uploadPoolFiles(poolId, pendingFiles);
        setSelectedPoolFilesByPoolId((prev) => ({ ...prev, [poolId]: [] }));
        const input = fileInputRefs.current[poolId];
        if (input) input.value = "";
      }

      setSuccessText("Piscina salva com sucesso.");
      setEditingPoolId(null);
      setEditPoolForm(null);
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar piscina.");
    } finally {
      setSavingPoolId(null);
    }
  }

  async function handleDeletePool(poolId: string) {
    if (!organizationId || !activeStoreId) return;
    const confirmed = window.confirm("Tem certeza que deseja excluir esta piscina? Essa ação também apaga as fotos dela.");
    if (!confirmed) return;

    setDeletingPoolId(poolId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const poolPhotos = photosByPoolId[poolId] || [];
      const storagePaths = poolPhotos.map((photo) => photo.storage_path).filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(storagePaths);
        if (storageError) throw storageError;
      }

      if (poolPhotos.length > 0) {
        const { error: photoDeleteError } = await supabase.from("pool_photos").delete().eq("pool_id", poolId);
        if (photoDeleteError) throw photoDeleteError;
      }

      const { error: poolDeleteError } = await supabase
        .from("pools")
        .delete()
        .eq("id", poolId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);
      if (poolDeleteError) throw poolDeleteError;

      setPools((prev) => prev.filter((pool) => pool.id !== poolId));
      setPhotosByPoolId((prev) => {
        const next = { ...prev };
        delete next[poolId];
        return next;
      });
      if (editingPoolId === poolId) {
        setEditingPoolId(null);
        setEditPoolForm(null);
      }
      setSuccessText("Piscina excluída com sucesso.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir piscina.");
    } finally {
      setDeletingPoolId(null);
    }
  }

  const totalPools = useMemo(() => pools.length, [pools]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[42px] font-black tracking-[-0.03em] text-black">Piscinas cadastradas</h1>
          <p className="mt-2 text-lg text-gray-700">Visualize e edite todas as piscinas cadastradas.</p>
          <p className="mt-2 text-sm text-gray-500">Total de piscinas: {totalPools}</p>
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
        <div className="rounded-[28px] bg-white p-10 text-sm text-gray-600 ring-1 ring-black/5">Carregando piscinas...</div>
      ) : pools.length === 0 ? (
        <div className="rounded-[28px] bg-white p-10 text-sm text-gray-600 ring-1 ring-black/5">Nenhuma piscina cadastrada.</div>
      ) : (
        <div className="space-y-5">
          {pools.map((pool) => {
            const poolPhotos = photosByPoolId[pool.id] || [];
            const isEditing = editingPoolId === pool.id;
            const characteristics = buildPoolCharacteristics(pool);
            const complementaryDescription = buildComplementaryDescription(pool, characteristics);

            return (
              <section key={pool.id} className="overflow-hidden rounded-[28px] bg-white ring-1 ring-black/5">
                <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <h2 className="max-w-4xl text-[22px] font-black leading-tight tracking-[-0.02em] text-black">{pool.name || "Piscina sem nome"}</h2>
                      <p className="mt-2 text-base text-gray-600">{pool.shape && pool.material ? `${pool.shape} • ${pool.material}` : "Dados básicos da piscina"}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      <DetailChip value={moneyBRL(pool.price)} />
                      <DetailChip value={pool.is_active ? "Ativa" : "Inativa"} />
                      <DetailChip value={pool.track_stock ? `Estoque: ${pool.stock_quantity ?? 0}` : "Sem controle de estoque"} />
                      <DetailChip value={pool.is_active && (!pool.track_stock || (pool.stock_quantity ?? 0) > 0) ? "Disponível para oferta" : "Indisponível"} />
                      <button
                        type="button"
                        onClick={() => startEditing(pool)}
                        className="rounded-2xl bg-white px-5 py-3 text-base font-semibold text-gray-900 ring-1 ring-black/10 transition hover:bg-gray-50"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
                  {isEditing && editPoolForm ? (
                    <div className="rounded-[24px] bg-gray-50 p-4 ring-1 ring-black/5">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</label>
                          <input
                            value={editPoolForm.name}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, name: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</label>
                          <input
                            value={editPoolForm.price}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, price: formatPriceInput(event.target.value) } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                            placeholder="58.900,00"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantidade em estoque</label>
                          <input
                            value={editPoolForm.stock_quantity}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, stock_quantity: event.target.value } : current))}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                            placeholder="0"
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição</label>
                          <textarea
                            value={editPoolForm.description}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, description: event.target.value } : current))}
                            rows={6}
                            className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-black"
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-800">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editPoolForm.is_active}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, is_active: event.target.checked } : current))}
                          />
                          Piscina ativa
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editPoolForm.track_stock}
                            onChange={(event) => setEditPoolForm((current) => (current ? { ...current, track_stock: event.target.checked } : current))}
                          />
                          Controlar estoque
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSavePool(pool.id)}
                          disabled={savingPoolId === pool.id}
                          className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPoolId === pool.id ? "Salvando..." : "Salvar"}
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
                          onClick={() => void handleDeletePool(pool.id)}
                          disabled={deletingPoolId === pool.id}
                          className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingPoolId === pool.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <CharacteristicsTable title="Características da piscina" rows={characteristics} />

                  {complementaryDescription ? (
                    <SectionCard title="Descrição complementar">
                      <div className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">{complementaryDescription}</div>
                    </SectionCard>
                  ) : null}

                  <SectionCard title="Fotos da piscina">
                    {isEditing ? (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                          <input
                            ref={(element) => {
                              fileInputRefs.current[pool.id] = element;
                            }}
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(event) => handlePoolFilesChange(pool.id, event)}
                            className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                          />
                          <p className="mt-2 text-xs text-gray-500">Até {MAX_POOL_PHOTOS} imagens, máximo de 50 MB por arquivo.</p>
                        </div>

                        {(selectedPoolFilesByPoolId[pool.id] || []).length > 0 ? (
                          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                            {(selectedPoolFilesByPoolId[pool.id] || []).map((file) => (
                              <div key={`${file.name}-${file.size}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 py-2 last:border-b-0">
                                <span className="truncate font-medium text-gray-900">{file.name}</span>
                                <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => void handleUploadNewPoolPhotos(pool.id)}
                          disabled={uploadingPoolPhotosId === pool.id}
                          className="rounded-2xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingPoolPhotosId === pool.id ? "Adicionando fotos..." : "Adicionar fotos"}
                        </button>

                        {poolPhotos.length === 0 ? (
                          <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">Nenhuma foto cadastrada para esta piscina.</div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {poolPhotos.map((photo) => {
                              const isDeletingPhoto = deletingPoolPhotoId === photo.id;
                              return (
                                <div key={photo.id} className="overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5">
                                  <img src={getPublicImageUrl(photo.storage_path)} alt={photo.file_name || pool.name || "Foto da piscina"} className="block h-28 w-full object-cover" />
                                  <div className="space-y-2 p-3">
                                    <div className="truncate text-xs text-gray-600">{photo.file_name || "Foto"}</div>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeletePoolPhoto(photo)}
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
                    ) : poolPhotos.length === 0 ? (
                      <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">Nenhuma foto cadastrada para esta piscina.</div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                        {poolPhotos.map((photo) => (
                          <div key={photo.id} className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5">
                            <img src={getPublicImageUrl(photo.storage_path)} alt={photo.file_name || pool.name || "Foto da piscina"} className="block h-20 w-full object-cover" />
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
