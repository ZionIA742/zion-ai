"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import {
  getCatalogPriceSemanticsFromNumber,
  getCatalogStockSemantics,
} from "@/lib/catalog/presentation";
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
  price_status?: string | null;
  description: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  stock_status?: string | null;
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
  shape: string;
  material: string;
  width_m: string;
  length_m: string;
  depth_m: string;
  weight_kg: string;
};

type CharacteristicRow = {
  label: string;
  value: string;
};

type ManualPriceStatus = "valid" | "missing";
type ManualStockStatus = "available" | "zero" | "unknown" | "not_tracked";

function resolveManualPriceStatus(value: number | null): ManualPriceStatus {
  return value == null ? "missing" : "valid";
}

function resolveManualStockState(args: {
  rawQuantity: string;
  trackStock: boolean;
}): {
  stockQuantity: number | null;
  stockStatus: ManualStockStatus;
} {
  if (!args.trackStock) {
    return {
      stockQuantity: null,
      stockStatus: "not_tracked" as const,
    };
  }

  const trimmedQuantity = args.rawQuantity.trim();
  if (!trimmedQuantity) {
    return {
      stockQuantity: null,
      stockStatus: "unknown" as const,
    };
  }

  if (!/^\d+$/.test(trimmedQuantity)) {
    throw new Error("O estoque deve ser um número inteiro igual ou maior que zero.");
  }

  const parsedQuantity = Number(trimmedQuantity);
  if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 0) {
    throw new Error("O estoque deve ser um número inteiro igual ou maior que zero.");
  }

  return {
    stockQuantity: parsedQuantity,
    stockStatus: parsedQuantity > 0 ? ("available" as const) : ("zero" as const),
  };
}

const STORAGE_BUCKET = "pool-photos";
const MAX_POOL_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function getPoolPhotoUrl(storagePath: string) {
  const normalizedPath = String(storagePath || "").trim();
  if (!normalizedPath) return null;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(normalizedPath, SIGNED_URL_TTL_SECONDS);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  const publicUrl = getPublicImageUrl(normalizedPath);
  return publicUrl || null;
}

function formatPriceInput(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");
  if (!cleaned) return "";

  const parts = cleaned.split(",");
  const integerPartRaw = parts[0].replace(/^0+(?=\d)/, "");
  const integerPart = integerPartRaw || (parts[0] ? "0" : "");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  if (parts.length === 1) return formattedInteger;

  const decimalPart = parts.slice(1).join("").slice(0, 2);
  return `${formattedInteger},${decimalPart}`;
}

function priceInputToNumber(value: string) {
  const raw = value.trim();
  if (!raw) return null;

  const dotDecimal = /^-?\d+\.\d{1,2}$/.test(raw);
  const brazilianPrice =
    /^-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(raw) ||
    /^-?\d+(?:,\d{1,2})?$/.test(raw);

  if (!dotDecimal && !brazilianPrice) return Number.NaN;

  const normalized = dotDecimal
    ? raw
    : raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseLooseNumber(value: string | null | undefined) {
  const raw = String(value || "").trim().replace(/\s+/g, "");
  if (!raw) return null;
  if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return Number.NaN;

  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatLooseNumber(value: number | null | undefined) {
  if (value == null) return "";
  return String(value).replace(".", ",");
}

function formatFileSize(size: number | null) {
  if (!Number.isFinite(size) || !size || size <= 0) return "0 B";
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

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}



function matchesPoolSearch(pool: PoolRow, search: string) {
  const term = normalizeLoose(search);
  if (!term) return true;

  const haystack = [
    pool.name,
    pool.material,
    pool.shape,
    pool.description,
  ]
    .map((value) => normalizeLoose(value))
    .filter(Boolean)
    .join(" ");

  return haystack.includes(term);
}
function isJunkDescriptionLine(value: string) {
  const normalized = normalizeLoose(value);
  if (!normalized) return true;

  return (
    normalized === "descricao detalhada" ||
    normalized === "descrição detalhada" ||
    normalized.startsWith("arquivo de teste") ||
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
    normalized.startsWith("prazo")
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
  const price = getCatalogPriceSemanticsFromNumber({
    priceStatus: pool.price_status,
    price: pool.price,
  });
  const stock = getCatalogStockSemantics({
    stockStatus: pool.stock_status,
    stockQuantity: pool.stock_quantity,
    trackStock: pool.track_stock,
  });
  pushCharacteristic(rows, "Nome", pool.name || "");
  pushCharacteristic(rows, "Preço", price.label);
  pushCharacteristic(rows, "Estoque", stock.valueLabel);
  pushCharacteristic(rows, "Formato", pool.shape);
  pushCharacteristic(rows, "Material", pool.material);
  if (pool.width_m != null) pushCharacteristic(rows, "Largura", `${pool.width_m} m`);
  if (pool.length_m != null) pushCharacteristic(rows, "Comprimento", `${pool.length_m} m`);
  if (pool.depth_m != null) pushCharacteristic(rows, "Profundidade", `${pool.depth_m} m`);
  if (pool.max_capacity_l != null) {
    pushCharacteristic(rows, "Capacidade", `${pool.max_capacity_l.toLocaleString("pt-BR")} L`);
  }
  if (pool.weight_kg != null) pushCharacteristic(rows, "Peso", `${pool.weight_kg} kg`);
  return rows;
}

function buildComplementaryDescription(pool: PoolRow, characteristics: CharacteristicRow[]) {
  const sourceText = cleanLooseText(pool.description || "");
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
        (value) => value.length >= 8 && normalized === value
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

function buildEditForm(pool: PoolRow): EditPoolForm {
  return {
    name: pool.name || "",
    description: pool.description || "",
    price:
      pool.price == null
        ? ""
        : formatPriceInput(String(pool.price.toFixed(2).replace(".", ","))),
    is_active: pool.is_active,
    track_stock: pool.track_stock,
    stock_quantity: pool.stock_quantity == null ? "" : String(pool.stock_quantity),
    shape: pool.shape || "",
    material: pool.material || "",
    width_m: formatLooseNumber(pool.width_m),
    length_m: formatLooseNumber(pool.length_m),
    depth_m: formatLooseNumber(pool.depth_m),
    weight_kg: formatLooseNumber(pool.weight_kg),
  };
}

function DetailChip({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
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
    <section className="border-t border-gray-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-sm font-bold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

function SelectField({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-[150px]">
      <select
        value={value}
        onChange={onChange}
        className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-10 text-sm font-medium text-gray-700 outline-none transition hover:border-gray-300 focus:border-gray-400"
      >
        {children}
      </select>
      <svg
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 8 4 4 4-4" />
      </svg>
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
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="min-w-0 rounded-xl bg-gray-50 px-3 py-2.5"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              {row.label}
            </div>
            <div className="mt-1 break-words text-sm font-medium text-gray-900">
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default function PiscinasPage() {
  const { organizationId, activeStoreId } = useStoreContext();

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [photosByPoolId, setPhotosByPoolId] = useState<Record<string, PoolPhotoRow[]>>({});
  const [photoUrlByPhotoId, setPhotoUrlByPhotoId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editPoolForm, setEditPoolForm] = useState<EditPoolForm | null>(null);
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null);
  const [deletingPoolId, setDeletingPoolId] = useState<string | null>(null);
  const [deletingAllPools, setDeletingAllPools] = useState(false);
  const [deletingPoolPhotoId, setDeletingPoolPhotoId] = useState<string | null>(null);
  const [selectedPoolFilesByPoolId, setSelectedPoolFilesByPoolId] = useState<Record<string, File[]>>({});
  const [uploadingPoolPhotosId, setUploadingPoolPhotosId] = useState<string | null>(null);
  const [expandedPoolPhoto, setExpandedPoolPhoto] = useState<{
    url: string;
    alt: string;
    fileName: string;
  } | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const advancedActionsRef = useRef<HTMLDetailsElement | null>(null);
  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "available" | "zero" | "unknown">("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "price_asc" | "price_desc">("recent");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedPoolId, setExpandedPoolId] = useState<string | null>(null);

  async function fetchData() {
    if (!organizationId || !activeStoreId) {
      setPools([]);
      setPhotosByPoolId({});
      setPhotoUrlByPhotoId({});
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
        setPhotoUrlByPhotoId({});
        return;
      }

      const poolIds = nextPools.map((pool) => pool.id);
      const { data: photoRows, error: photosError } = await supabase
        .from("pool_photos")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .in("pool_id", poolIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (photosError) throw photosError;

      const grouped: Record<string, PoolPhotoRow[]> = {};
      for (const photo of (photoRows || []) as PoolPhotoRow[]) {
        if (!grouped[photo.pool_id]) grouped[photo.pool_id] = [];
        grouped[photo.pool_id].push(photo);
      }
      setPhotosByPoolId(grouped);

      const resolvedUrls = await Promise.all(
        ((photoRows || []) as PoolPhotoRow[]).map(async (photo) => {
          const url = await getPoolPhotoUrl(photo.storage_path);
          return [photo.id, url] as const;
        })
      );

      const nextPhotoUrlByPhotoId: Record<string, string> = {};
      for (const [photoId, url] of resolvedUrls) {
        if (url) {
          nextPhotoUrlByPhotoId[photoId] = url;
        }
      }
      setPhotoUrlByPhotoId(nextPhotoUrlByPhotoId);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar piscinas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    function closeAdvancedActionsOnOutsidePointer(event: MouseEvent | TouchEvent) {
      const details = advancedActionsRef.current;
      if (!details?.open) return;
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) {
        details.removeAttribute("open");
      }
    }

    function closeAdvancedActionsOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        advancedActionsRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("mousedown", closeAdvancedActionsOnOutsidePointer);
    document.addEventListener("touchstart", closeAdvancedActionsOnOutsidePointer);
    document.addEventListener("keydown", closeAdvancedActionsOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeAdvancedActionsOnOutsidePointer);
      document.removeEventListener("touchstart", closeAdvancedActionsOnOutsidePointer);
      document.removeEventListener("keydown", closeAdvancedActionsOnEscape);
    };
  }, []);

  function startEditing(pool: PoolRow) {
    setExpandedPoolId(pool.id);
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
    const currentCount = (photosByPoolId[poolId] || []).length;

    if (currentCount + fileList.length > MAX_POOL_PHOTOS) {
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
      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([photo.storage_path]);
      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from("pool_photos")
        .delete()
        .eq("id", photo.id);

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
      const poolName = editPoolForm.name.trim();
      if (!poolName) {
        throw new Error("Preencha o nome da piscina antes de salvar.");
      }

      const parsedPrice = priceInputToNumber(editPoolForm.price);
      if (editPoolForm.price.trim() && !Number.isFinite(parsedPrice)) {
        throw new Error("Preencha um preço numérico válido.");
      }
      if (parsedPrice !== null && parsedPrice < 0) {
        throw new Error("O preço não pode ser negativo.");
      }

      const parsedWidth = parseLooseNumber(editPoolForm.width_m);
      const parsedLength = parseLooseNumber(editPoolForm.length_m);
      const parsedDepth = parseLooseNumber(editPoolForm.depth_m);
      const parsedWeight = parseLooseNumber(editPoolForm.weight_kg);

      if (!Number.isFinite(parsedWidth) || parsedWidth === null || parsedWidth <= 0) {
        throw new Error("A largura da piscina deve ser maior que zero.");
      }
      if (!Number.isFinite(parsedLength) || parsedLength === null || parsedLength <= 0) {
        throw new Error("O comprimento da piscina deve ser maior que zero.");
      }
      if (!Number.isFinite(parsedDepth) || parsedDepth === null || parsedDepth <= 0) {
        throw new Error("A profundidade da piscina deve ser maior que zero.");
      }
      if (editPoolForm.weight_kg.trim() && (!Number.isFinite(parsedWeight) || parsedWeight === null || parsedWeight <= 0)) {
        throw new Error("O peso deve ser maior que zero.");
      }

      const stockState = resolveManualStockState({
        rawQuantity: editPoolForm.stock_quantity,
        trackStock: editPoolForm.track_stock,
      });
      const nextCapacity = Math.max(1, Math.round(parsedWidth * parsedLength * parsedDepth * 1000));

      const { error } = await supabase
        .from("pools")
        .update({
          name: poolName,
          description: editPoolForm.description.trim() || null,
          price: parsedPrice,
          shape: editPoolForm.shape.trim() || null,
          material: editPoolForm.material.trim() || null,
          width_m: parsedWidth,
          length_m: parsedLength,
          depth_m: parsedDepth,
          max_capacity_l: nextCapacity,
          weight_kg: parsedWeight,
          is_active: editPoolForm.is_active,
          price_status: resolveManualPriceStatus(parsedPrice),
          stock_status: stockState.stockStatus,
          track_stock: editPoolForm.track_stock,
          stock_quantity: stockState.stockQuantity,
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

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir esta piscina? Essa ação também apaga as fotos dela."
    );
    if (!confirmed) return;

    setDeletingPoolId(poolId);
    setErrorText(null);
    setSuccessText(null);

    try {
      const poolPhotos = photosByPoolId[poolId] || [];
      const storagePaths = poolPhotos.map((photo) => photo.storage_path).filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(storagePaths);
        if (storageError) throw storageError;
      }

      if (poolPhotos.length > 0) {
        const { error: photoDeleteError } = await supabase
          .from("pool_photos")
          .delete()
          .eq("pool_id", poolId);

        if (photoDeleteError) throw photoDeleteError;
      }

      const { error: poolDeleteError } = await supabase
        .from("pools")
        .delete()
        .eq("id", poolId)
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (poolDeleteError) throw poolDeleteError;

      setSuccessText("Piscina excluída com sucesso.");
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
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao excluir piscina.");
    } finally {
      setDeletingPoolId(null);
    }
  }

  async function handleDeleteAllPools() {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para apagar as piscinas.");
      setSuccessText(null);
      return;
    }

    if (deletingAllPools) return;

    const confirmed = window.confirm(
      `Você está prestes a apagar todas as piscinas cadastradas nesta loja. Essa ação não apaga produtos, acessórios ou outros itens.\nItens que serão apagados: ${totalPools}. Deseja continuar?`
    );
    if (!confirmed) return;

    setDeletingAllPools(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: poolRows, error: poolsError } = await supabase
        .from("pools")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (poolsError) throw poolsError;

      const poolIds = ((poolRows || []) as Array<{ id: string }>).map((pool) => pool.id);

      if (poolIds.length === 0) {
        setSuccessText("Não havia piscinas para apagar nesta loja.");
        await fetchData();
        return;
      }

      const photoRows: PoolPhotoRow[] = [];
      for (const ids of chunkArray(poolIds, 200)) {
        const { data: photoChunk, error: photosError } = await supabase
          .from("pool_photos")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("pool_id", ids);

        if (photosError) throw photosError;
        photoRows.push(...((photoChunk || []) as PoolPhotoRow[]));
      }

      const storagePaths = photoRows.map((photo) => photo.storage_path).filter(Boolean);
      for (const paths of chunkArray(storagePaths, 100)) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(paths);

        if (storageError) throw storageError;
      }

      for (const ids of chunkArray(poolIds, 200)) {
        const { error: photoDeleteError } = await supabase
          .from("pool_photos")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("pool_id", ids);

        if (photoDeleteError) throw photoDeleteError;
      }

      for (const ids of chunkArray(poolIds, 200)) {
        const { error: poolDeleteError } = await supabase
          .from("pools")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", ids);

        if (poolDeleteError) throw poolDeleteError;
      }

      setSuccessText(`${poolIds.length} piscina(s) apagada(s) com sucesso.`);
      setEditingPoolId(null);
      setEditPoolForm(null);
      setSelectedPoolFilesByPoolId({});
      await fetchData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao apagar todas as piscinas.");
    } finally {
      setDeletingAllPools(false);
    }
  }

  const totalPools = useMemo(() => pools.length, [pools]);
  const filteredPools = useMemo(() => {
    const next = pools.filter((pool) => {
      if (!matchesPoolSearch(pool, searchText)) return false;
      if (statusFilter === "active" && !pool.is_active) return false;
      if (statusFilter === "inactive" && pool.is_active) return false;

      const stockStatus = String(pool.stock_status || "").trim().toLowerCase();
      if (stockFilter === "available" && stockStatus !== "available") return false;
      if (stockFilter === "zero" && stockStatus !== "zero") return false;
      if (
        stockFilter === "unknown" &&
        stockStatus !== "unknown" &&
        stockStatus !== "not_tracked"
      ) {
        return false;
      }

      return true;
    });

    if (sortBy === "name") {
      return [...next].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );
    }

    if (sortBy === "price_asc" || sortBy === "price_desc") {
      return [...next].sort((a, b) => {
        const aPrice = typeof a.price === "number" ? a.price : Number.POSITIVE_INFINITY;
        const bPrice = typeof b.price === "number" ? b.price : Number.POSITIVE_INFINITY;
        return sortBy === "price_asc" ? aPrice - bPrice : bPrice - aPrice;
      });
    }

    return next;
  }, [pools, searchText, statusFilter, stockFilter, sortBy]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredPools.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visiblePools = filteredPools.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, statusFilter, stockFilter, sortBy]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black tracking-[-0.02em] text-black">
            Piscinas cadastradas
          </h1>
          <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700">
            {totalPools} piscinas
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <details ref={advancedActionsRef} className="relative">
            <summary
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100"
              title="Apagar opções"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
              <span className="sr-only">Abrir ações de apagar</span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={() => void handleDeleteAllPools()}
                disabled={!hasValidStoreContext || deletingAllPools || totalPools === 0}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingAllPools ? "Apagando piscinas..." : "Apagar todas as piscinas"}
              </button>
              <p className="px-3 pb-1 pt-2 text-xs leading-5 text-gray-500">
                Use apenas quando quiser remover todas as piscinas desta loja.
              </p>
            </div>
          </details>

          <Link
            href="/configuracoes"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
          >
            Voltar para configurações
          </Link>
        </div>
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

      <div className="rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m20 20-3.5-3.5"></path>
            </svg>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar por nome, material, formato ou descrição..."
              className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:flex">
            <SelectField
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | "active" | "inactive")
              }
            >
              <option value="all">Todos os status</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </SelectField>

            <SelectField
              value={stockFilter}
              onChange={(event) =>
                setStockFilter(event.target.value as "all" | "available" | "zero" | "unknown")
              }
            >
              <option value="all">Todo estoque</option>
              <option value="available">Com estoque</option>
              <option value="zero">Estoque zerado</option>
              <option value="unknown">Não informado</option>
            </SelectField>

            <SelectField
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as "recent" | "name" | "price_asc" | "price_desc"
                )
              }
            >
              <option value="recent">Mais recentes</option>
              <option value="name">Nome A–Z</option>
              <option value="price_asc">Menor preço</option>
              <option value="price_desc">Maior preço</option>
            </SelectField>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-gray-500">
          <span>{filteredPools.length} piscina(s) encontrada(s)</span>
          {(searchText.trim() || statusFilter !== "all" || stockFilter !== "all") ? (
            <button
              type="button"
              onClick={() => {
                setSearchText("");
                setStatusFilter("all");
                setStockFilter("all");
              }}
              className="font-semibold text-gray-700 hover:text-black"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      {!hasValidStoreContext ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          Nenhuma loja ativa encontrada.
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
          Carregando piscinas...
        </div>
      ) : filteredPools.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
          {searchText.trim() ? "Nenhuma piscina encontrada para essa busca." : "Nenhuma piscina cadastrada."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="hidden grid-cols-[minmax(280px,1.5fr)_minmax(170px,0.75fr)_minmax(120px,0.55fr)_minmax(210px,0.9fr)_96px] items-center gap-4 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 lg:grid">
            <div>Produto</div>
            <div>Medidas</div>
            <div>Preço</div>
            <div>Situação</div>
            <div className="text-right">Ações</div>
          </div>

          <div className="divide-y divide-gray-200">
          {visiblePools.map((pool) => {
            const poolPhotos = photosByPoolId[pool.id] || [];
            const primaryPoolPhoto = poolPhotos[0] || null;
            const primaryPoolPhotoUrl = primaryPoolPhoto ? photoUrlByPhotoId[primaryPoolPhoto.id] || "" : "";
            const isEditing = editingPoolId === pool.id;
            const isExpanded = expandedPoolId === pool.id;
            const characteristics = buildPoolCharacteristics(pool);
            const priceLabel = getCatalogPriceSemanticsFromNumber({
              priceStatus: pool.price_status,
              price: pool.price,
            }).label;
            const stockLabel = getCatalogStockSemantics({
              stockStatus: pool.stock_status,
              stockQuantity: pool.stock_quantity,
              trackStock: pool.track_stock,
            }).label;
            const complementaryDescription = buildComplementaryDescription(
              pool,
              characteristics
            );

            return (
              <section key={pool.id} className={isExpanded || isEditing ? "bg-gray-50/40" : "bg-white"}>
                <div className="grid gap-3 px-4 py-3.5 transition hover:bg-gray-50 lg:grid-cols-[minmax(280px,1.5fr)_minmax(170px,0.75fr)_minmax(120px,0.55fr)_minmax(210px,0.9fr)_96px] lg:items-center lg:gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPoolId((current) => (current === pool.id ? null : pool.id))
                    }
                    disabled={isEditing}
                    className="flex min-w-0 items-center gap-3 text-left disabled:cursor-default"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-[11px] font-semibold text-gray-400">
                      {primaryPoolPhotoUrl ? (
                        <img
                          src={primaryPoolPhotoUrl}
                          alt={primaryPoolPhoto?.file_name || pool.name || "Foto da piscina"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>Sem foto</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-gray-950">
                        {pool.name || "Piscina sem nome"}
                      </div>
                      <div className="mt-1 truncate text-sm text-gray-500">
                        {[pool.shape, pool.material].filter(Boolean).join(" • ") || "Sem formato/material"}
                      </div>
                    </div>
                  </button>

                  <div className="pl-[76px] text-sm text-gray-700 lg:pl-0">
                    {pool.length_m != null && pool.width_m != null && pool.depth_m != null
                      ? `${pool.length_m} × ${pool.width_m} × ${pool.depth_m} m`
                      : "Não informadas"}
                  </div>

                  <div className="pl-[76px] text-sm font-bold text-gray-950 lg:pl-0">
                    {priceLabel}
                  </div>

                  <div className="flex flex-wrap gap-1.5 pl-[76px] lg:pl-0">
                    <DetailChip value={pool.is_active ? "Ativa" : "Inativa"} />
                    <DetailChip value={stockLabel} />
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pl-[76px] lg:pl-0">
                    <button
                      type="button"
                      onClick={() => startEditing(pool)}
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-semibold text-gray-800 transition hover:bg-gray-50"
                    >
                      Editar
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedPoolId((current) => (current === pool.id ? null : pool.id))
                      }
                      disabled={isEditing}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-default disabled:opacity-50"
                      aria-label={isExpanded ? "Ocultar detalhes" : "Ver detalhes"}
                      title={isExpanded ? "Ocultar detalhes" : "Ver detalhes"}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>

                {isExpanded || isEditing ? (
                  <div className="space-y-5 border-t border-gray-200 bg-white px-4 py-5 sm:px-5">
                  {isEditing && editPoolForm ? (
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="mb-4">
                        <div className="text-sm font-bold text-gray-950">Editar piscina</div>
                        <div className="mt-1 text-xs text-gray-500">Atualize somente os dados que precisam mudar.</div>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Nome
                          </label>
                          <input
                            value={editPoolForm.name}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, name: event.target.value } : current
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
                            value={editPoolForm.price}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      price: event.target.value,
                                    }
                                  : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                            placeholder="58.900,00"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Formato
                          </label>
                          <input
                            value={editPoolForm.shape}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, shape: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Material
                          </label>
                          <input
                            value={editPoolForm.material}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, material: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Largura (m)
                          </label>
                          <input
                            value={editPoolForm.width_m}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, width_m: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Comprimento (m)
                          </label>
                          <input
                            value={editPoolForm.length_m}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, length_m: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Profundidade (m)
                          </label>
                          <input
                            value={editPoolForm.depth_m}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, depth_m: event.target.value } : current
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
                            value={editPoolForm.weight_kg}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current ? { ...current, weight_kg: event.target.value } : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Quantidade em estoque
                          </label>
                          <input
                            value={editPoolForm.stock_quantity}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
                                current
                                  ? { ...current, stock_quantity: event.target.value }
                                  : current
                              )
                            }
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-black"
                            placeholder="Ex.: 0"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-4 pt-6 text-sm text-gray-800 lg:col-span-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editPoolForm.is_active}
                              onChange={(event) =>
                                setEditPoolForm((current) =>
                                  current
                                    ? { ...current, is_active: event.target.checked }
                                    : current
                                )
                              }
                            />
                            Piscina ativa
                          </label>

                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={editPoolForm.track_stock}
                              onChange={(event) =>
                                setEditPoolForm((current) =>
                                  current
                                    ? { ...current, track_stock: event.target.checked }
                                    : current
                                )
                              }
                            />
                            Controlar estoque
                          </label>
                        </div>

                        <div className="border-t border-gray-200 pt-4 lg:col-span-2">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Descrição
                          </label>
                          <textarea
                            value={editPoolForm.description}
                            onChange={(event) =>
                              setEditPoolForm((current) =>
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
                          onClick={() => void handleSavePool(pool.id)}
                          disabled={savingPoolId === pool.id}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPoolId === pool.id ? "Salvando..." : "Salvar"}
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
                          onClick={() => void handleDeletePool(pool.id)}
                          disabled={deletingPoolId === pool.id}
                          className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingPoolId === pool.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!isEditing ? (
                    <>
                      <CharacteristicsTable
                        title="Características da piscina"
                        rows={characteristics}
                      />

                      {complementaryDescription ? (
                        <SectionCard title="Descrição complementar">
                          <div className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                            {complementaryDescription}
                          </div>
                        </SectionCard>
                      ) : null}
                    </>
                  ) : null}

                  <SectionCard title="Fotos da piscina">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <input
                            ref={(element) => {
                              fileInputRefs.current[pool.id] = element;
                            }}
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={(event) => handlePoolFilesChange(pool.id, event)}
                            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                          />
                          <p className="mt-2 text-xs text-gray-500">
                            Até {MAX_POOL_PHOTOS} imagens, máximo de 50 MB por arquivo.
                          </p>
                        </div>

                        {(selectedPoolFilesByPoolId[pool.id] || []).length > 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            {(selectedPoolFilesByPoolId[pool.id] || []).map((file) => (
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
                          onClick={() => void handleUploadNewPoolPhotos(pool.id)}
                          disabled={uploadingPoolPhotosId === pool.id}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {uploadingPoolPhotosId === pool.id
                            ? "Adicionando fotos..."
                            : "Adicionar fotos"}
                        </button>

                        {poolPhotos.length === 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                            Nenhuma foto cadastrada para esta piscina.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {poolPhotos.map((photo) => {
                              const isDeletingPhoto = deletingPoolPhotoId === photo.id;
                              const photoUrl = photoUrlByPhotoId[photo.id] || "";

                              return (
                                <div
                                  key={photo.id}
                                  className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!photoUrl) return;
                                      setExpandedPoolPhoto({
                                        url: photoUrl,
                                        alt: photo.file_name || pool.name || "Foto da piscina",
                                        fileName: photo.file_name || pool.name || "Foto da piscina",
                                      });
                                    }}
                                    className="block w-full cursor-zoom-in bg-gray-100 text-left"
                                    aria-label="Abrir foto da piscina em tamanho grande"
                                    disabled={!photoUrl}
                                  >
                                    {photoUrl ? (
                                      <img
                                        src={photoUrl}
                                        alt={photo.file_name || pool.name || "Foto da piscina"}
                                        className="block h-24 w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-24 items-center justify-center px-2 text-center text-xs text-gray-500">
                                        Carregando foto...
                                      </div>
                                    )}
                                  </button>
                                  <div className="space-y-2 p-2.5">
                                    <div className="truncate text-[11px] text-gray-600">
                                      {photo.file_name || "Foto"}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeletePoolPhoto(photo)}
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
                    ) : poolPhotos.length === 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                        Nenhuma foto cadastrada para esta piscina.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                        {poolPhotos.map((photo) => {
                          const photoUrl = photoUrlByPhotoId[photo.id] || "";

                          return (
                            <div
                              key={photo.id}
                              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (!photoUrl) return;
                                  setExpandedPoolPhoto({
                                    url: photoUrl,
                                    alt: photo.file_name || pool.name || "Foto da piscina",
                                    fileName: photo.file_name || pool.name || "Foto da piscina",
                                  });
                                }}
                                className="block w-full cursor-zoom-in bg-gray-100 text-left"
                                aria-label="Abrir foto da piscina em tamanho grande"
                                disabled={!photoUrl}
                              >
                                {photoUrl ? (
                                  <img
                                    src={photoUrl}
                                    alt={photo.file_name || pool.name || "Foto da piscina"}
                                    className="block h-16 w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-16 items-center justify-center px-2 text-center text-[11px] text-gray-500">
                                    Carregando...
                                  </div>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SectionCard>
                </div>
                ) : null}
              </section>
            );
          })}
          </div>

          {filteredPools.length > pageSize ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs text-gray-500">
                Mostrando {(safeCurrentPage - 1) * pageSize + 1}–{Math.min(safeCurrentPage * pageSize, filteredPools.length)} de {filteredPools.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-sm font-semibold text-gray-700">
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {expandedPoolPhoto ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={() => setExpandedPoolPhoto(null)}
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                  Foto da piscina
                </div>
                <div className="truncate text-sm font-bold text-gray-900">
                  {expandedPoolPhoto.fileName}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setExpandedPoolPhoto(null)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
              >
                Fechar
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 p-3">
              <img
                src={expandedPoolPhoto.url}
                alt={expandedPoolPhoto.alt}
                className="max-h-[78vh] max-w-full rounded-xl object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
