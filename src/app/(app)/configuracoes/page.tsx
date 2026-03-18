"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type PoolRow = {
  id: string;
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
  created_at?: string | null;
};

type ResponsibleRow = {
  id: string;
  organization_id: string;
  store_id: string;
  name: string | null;
  whatsapp_number: string | null;
  role: string | null;
  receive_discount_alerts: boolean;
  receive_subscription_alerts: boolean;
  receive_sla_alerts: boolean;
  created_at?: string | null;
};

type PoolPhotoRow = {
  id: string;
  pool_id: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  sort_order: number;
  created_at?: string | null;
};

type DiscountSettingsRow = {
  store_id: string;
  organization_id: string;
  default_discount_percent: number;
  max_discount_percent: number;
  allow_ask_above_max_discount: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

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
  metadata: CatalogItemMetadata | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CatalogItemPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  sort_order: number;
  created_at?: string | null;
};

type TabKey =
  | "visao_geral"
  | "piscinas"
  | "catalogo"
  | "responsaveis"
  | "descontos";

const POOL_STORAGE_BUCKET = "pool-photos";
const CATALOG_STORAGE_BUCKET = "store-catalog-photos";

const MAX_POOL_PHOTOS = 10;
const MAX_CATALOG_PHOTOS = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const TAB_STORAGE_KEY = "zion_configuracoes_active_tab";

const ROLE_OPTIONS = [
  { value: "owner", label: "Proprietário" },
  { value: "manager", label: "Gerente" },
  { value: "sales", label: "Vendas" },
  { value: "support", label: "Suporte" },
];

const CATALOG_CATEGORY_OPTIONS = [
  { value: "acessorios", label: "Acessórios" },
  { value: "quimicos", label: "Produtos químicos" },
  { value: "outros", label: "Outros itens" },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toNullableNumber(value: string) {
  const cleaned = value.replace(/\./g, "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
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

function formatPercentInput(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");
  if (!cleaned) return "";

  const parts = cleaned.split(",");
  const integerPartRaw = parts[0].replace(/^0+(?=\d)/, "");
  const integerPart = integerPartRaw || (parts[0] ? "0" : "");

  if (parts.length === 1) {
    return integerPart;
  }

  const decimalPart = parts.slice(1).join("").slice(0, 2);
  return `${integerPart},${decimalPart}`;
}

function formatNumberInput(value: string) {
  return value.replace(/[^\d.,]/g, "").replace(",", ".");
}

function moneyBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return `R$ ${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function moneyFromCentsBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return moneyBRL(value / 100);
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function roleLabel(role: string | null) {
  const found = ROLE_OPTIONS.find((item) => item.value === role);
  return found?.label ?? "Não definido";
}

function isValidTab(tab: string | null): tab is TabKey {
  return (
    tab === "visao_geral" ||
    tab === "piscinas" ||
    tab === "catalogo" ||
    tab === "responsaveis" ||
    tab === "descontos"
  );
}

function normalizeCatalogCategory(category: string | null | undefined) {
  if (category === "acessorios") return "acessorios";
  if (category === "quimicos") return "quimicos";
  return "outros";
}

export default function ConfiguracoesPage() {
  const {
    loading: storeLoading,
    organizationId,
    activeStoreId,
  } = useStoreContext();

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const ORGANIZATION_ID = organizationId ?? "";
  const STORE_ID = activeStoreId ?? "";

  const [activeTab, setActiveTab] = useState<TabKey>("visao_geral");

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const [pools, setPools] = useState<PoolRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [catalogItemPhotos, setCatalogItemPhotos] = useState<CatalogItemPhotoRow[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleRow[]>([]);
  const [poolPhotos, setPoolPhotos] = useState<PoolPhotoRow[]>([]);
  const [discountSettings, setDiscountSettings] = useState<DiscountSettingsRow | null>(
    null
  );

  const [savingPool, setSavingPool] = useState(false);
  const [savingCatalogItem, setSavingCatalogItem] = useState(false);
  const [savingResponsible, setSavingResponsible] = useState(false);
  const [savingDiscountSettings, setSavingDiscountSettings] = useState(false);

  const [poolName, setPoolName] = useState("");
  const [poolWidth, setPoolWidth] = useState("");
  const [poolLength, setPoolLength] = useState("");
  const [poolDepth, setPoolDepth] = useState("");
  const [poolShape, setPoolShape] = useState("retangular");
  const [poolMaterial, setPoolMaterial] = useState("fibra");
  const [poolCapacity, setPoolCapacity] = useState("");
  const [poolWeight, setPoolWeight] = useState("");
  const [poolPrice, setPoolPrice] = useState("");
  const [poolDescription, setPoolDescription] = useState("");
  const [selectedPoolFiles, setSelectedPoolFiles] = useState<File[]>([]);

  const [catalogCategory, setCatalogCategory] = useState("acessorios");
  const [catalogCode, setCatalogCode] = useState("");
  const [catalogName, setCatalogName] = useState("");
  const [catalogPrice, setCatalogPrice] = useState("");
  const [catalogDescription, setCatalogDescription] = useState("");
  const [catalogIsActive, setCatalogIsActive] = useState(true);
  const [selectedCatalogFiles, setSelectedCatalogFiles] = useState<File[]>([]);

  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleWhatsapp, setResponsibleWhatsapp] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("owner");
  const [receiveDiscountAlerts, setReceiveDiscountAlerts] = useState(true);
  const [receiveSubscriptionAlerts, setReceiveSubscriptionAlerts] = useState(true);
  const [receiveSlaAlerts, setReceiveSlaAlerts] = useState(true);

  const [defaultDiscountPercentInput, setDefaultDiscountPercentInput] = useState("");
  const [maxDiscountPercentInput, setMaxDiscountPercentInput] = useState("");
  const [allowAskAboveMaxDiscount, setAllowAskAboveMaxDiscount] = useState(false);

  const totalPools = pools.length;
  const totalResponsibles = responsibles.length;
  const totalCatalogItems = catalogItems.length;

  const catalogItemsByCategory = useMemo(() => {
    return {
      acessorios: catalogItems.filter(
        (item) => normalizeCatalogCategory(item.metadata?.categoria) === "acessorios"
      ),
      quimicos: catalogItems.filter(
        (item) => normalizeCatalogCategory(item.metadata?.categoria) === "quimicos"
      ),
      outros: catalogItems.filter(
        (item) => normalizeCatalogCategory(item.metadata?.categoria) === "outros"
      ),
    };
  }, [catalogItems]);

  async function fetchPools() {
    const { data, error } = await supabase
      .from("pools")
      .select(
        "id,name,width_m,length_m,depth_m,shape,material,max_capacity_l,weight_kg,price,description,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;
    setPools((data || []) as PoolRow[]);
  }

  async function fetchCatalogItems() {
    const { data, error } = await supabase
      .from("store_catalog_items")
      .select(
        "id,organization_id,store_id,sku,name,description,price_cents,currency,is_active,metadata,created_at,updated_at"
      )
      .eq("organization_id", ORGANIZATION_ID)
      .eq("store_id", STORE_ID)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setCatalogItems((data || []) as CatalogItemRow[]);
  }

  async function fetchCatalogItemPhotos() {
    const { data, error } = await supabase
      .from("store_catalog_item_photos")
      .select("id,catalog_item_id,storage_path,file_name,file_size_bytes,sort_order,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setCatalogItemPhotos((data || []) as CatalogItemPhotoRow[]);
  }

  async function fetchResponsibles() {
    const { data, error } = await supabase
      .from("store_responsibles")
      .select(
        "id,organization_id,store_id,name,whatsapp_number,role,receive_discount_alerts,receive_subscription_alerts,receive_sla_alerts,created_at"
      )
      .eq("organization_id", ORGANIZATION_ID)
      .eq("store_id", STORE_ID)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setResponsibles((data || []) as ResponsibleRow[]);
  }

  async function fetchPoolPhotos() {
    const { data, error } = await supabase
      .from("pool_photos")
      .select("id,pool_id,storage_path,file_name,file_size_bytes,sort_order,created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setPoolPhotos((data || []) as PoolPhotoRow[]);
  }

  async function fetchDiscountSettings() {
    const { data, error } = await supabase
      .from("store_discount_settings")
      .select(
        "store_id,organization_id,default_discount_percent,max_discount_percent,allow_ask_above_max_discount,created_at,updated_at"
      )
      .eq("store_id", STORE_ID)
      .eq("organization_id", ORGANIZATION_ID)
      .maybeSingle();

    if (error) throw error;

    const row = (data || null) as DiscountSettingsRow | null;
    setDiscountSettings(row);

    if (row) {
      setDefaultDiscountPercentInput(
        String(row.default_discount_percent ?? 0).replace(".", ",")
      );
      setMaxDiscountPercentInput(
        String(row.max_discount_percent ?? 0).replace(".", ",")
      );
      setAllowAskAboveMaxDiscount(Boolean(row.allow_ask_above_max_discount));
    } else {
      setDefaultDiscountPercentInput("0");
      setMaxDiscountPercentInput("0");
      setAllowAskAboveMaxDiscount(false);
    }
  }

  async function fetchPageData(mode: "initial" | "reload" = "initial") {
    setErrorText(null);

    if (!hasValidStoreContext) {
      if (mode === "initial") setLoadingInitial(false);
      if (mode === "reload") setReloading(false);
      return;
    }

    if (mode === "initial") setLoadingInitial(true);
    if (mode === "reload") setReloading(true);

    try {
      await Promise.all([
        fetchPools(),
        fetchCatalogItems(),
        fetchCatalogItemPhotos(),
        fetchResponsibles(),
        fetchPoolPhotos(),
        fetchDiscountSettings(),
      ]);
    } catch (error: any) {
      console.error("Erro ao carregar configurações:", error);
      setErrorText(error?.message ?? "Erro ao carregar configurações.");
      setPools([]);
      setCatalogItems([]);
      setCatalogItemPhotos([]);
      setResponsibles([]);
      setPoolPhotos([]);
      setDiscountSettings(null);
    } finally {
      if (mode === "initial") setLoadingInitial(false);
      if (mode === "reload") setReloading(false);
    }
  }

  function resetPoolForm() {
    setPoolName("");
    setPoolWidth("");
    setPoolLength("");
    setPoolDepth("");
    setPoolShape("retangular");
    setPoolMaterial("fibra");
    setPoolCapacity("");
    setPoolWeight("");
    setPoolPrice("");
    setPoolDescription("");
    setSelectedPoolFiles([]);
  }

  function resetCatalogForm() {
    setCatalogCategory("acessorios");
    setCatalogCode("");
    setCatalogName("");
    setCatalogPrice("");
    setCatalogDescription("");
    setCatalogIsActive(true);
    setSelectedCatalogFiles([]);
  }

  function resetResponsibleForm() {
    setResponsibleName("");
    setResponsibleWhatsapp("");
    setResponsibleRole("owner");
    setReceiveDiscountAlerts(true);
    setReceiveSubscriptionAlerts(true);
    setReceiveSlaAlerts(true);
  }

  function handlePoolFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
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
    setSelectedPoolFiles(fileList);
  }

  function handleCatalogFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
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
    setSelectedCatalogFiles(fileList);
  }

  async function uploadPoolFiles(poolId: string, files: File[]) {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${poolId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(POOL_STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from("pool_photos").insert({
        pool_id: poolId,
        storage_path: storagePath,
        file_name: file.name,
        file_size_bytes: file.size,
        sort_order: index,
      });

      if (metadataError) throw metadataError;
    }
  }

  async function uploadCatalogFiles(catalogItemId: string, files: File[]) {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const extension = file.name.split(".").pop() || "jpg";
      const safeFileName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${catalogItemId}/${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(CATALOG_STORAGE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase
        .from("store_catalog_item_photos")
        .insert({
          catalog_item_id: catalogItemId,
          storage_path: storagePath,
          file_name: file.name,
          file_size_bytes: file.size,
          sort_order: index,
        });

      if (metadataError) throw metadataError;
    }
  }

  async function handleCreatePool(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);
    setSuccessText(null);

    if (!hasValidStoreContext) {
      setErrorText("A loja ativa ainda não foi carregada. Tente novamente em instantes.");
      return;
    }

    if (!poolName.trim()) {
      setErrorText("O nome da piscina é obrigatório.");
      return;
    }

    const widthValue = toNullableNumber(poolWidth);
    const lengthValue = toNullableNumber(poolLength);
    const depthValue = toNullableNumber(poolDepth);
    const capacityValue = toNullableNumber(poolCapacity);

    if (widthValue == null) {
      setErrorText("A largura da piscina é obrigatória.");
      return;
    }

    if (lengthValue == null) {
      setErrorText("O comprimento da piscina é obrigatório.");
      return;
    }

    if (depthValue == null) {
      setErrorText("A profundidade da piscina é obrigatória.");
      return;
    }

    if (!poolShape.trim()) {
      setErrorText("O formato da piscina é obrigatório.");
      return;
    }

    if (!poolMaterial.trim()) {
      setErrorText("O material da piscina é obrigatório.");
      return;
    }

    if (capacityValue == null) {
      setErrorText("A capacidade máxima em litros é obrigatória.");
      return;
    }

    setSavingPool(true);

    const { data: createdPool, error } = await supabase
      .from("pools")
      .insert({
        name: poolName.trim(),
        width_m: widthValue,
        length_m: lengthValue,
        depth_m: depthValue,
        shape: poolShape.trim(),
        material: poolMaterial.trim(),
        max_capacity_l: capacityValue,
        weight_kg: toNullableNumber(poolWeight),
        price: toNullableNumber(poolPrice),
        description: poolDescription.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      setErrorText(error.message ?? "Erro ao cadastrar piscina.");
      setSavingPool(false);
      return;
    }

    try {
      if (selectedPoolFiles.length > 0) {
        await uploadPoolFiles(createdPool.id, selectedPoolFiles);
      }
    } catch (uploadError: any) {
      setErrorText(
        uploadError?.message ??
          "A piscina foi cadastrada, mas houve erro ao enviar as fotos."
      );
      setSavingPool(false);
      await fetchPageData("reload");
      return;
    }

    resetPoolForm();
    setSuccessText("Piscina cadastrada com sucesso.");
    setSavingPool(false);
    await fetchPageData("reload");
    setActiveTab("piscinas");
  }

  async function handleCreateCatalogItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);
    setSuccessText(null);

    if (!hasValidStoreContext) {
      setErrorText("A loja ativa ainda não foi carregada. Tente novamente em instantes.");
      return;
    }

    if (!catalogCategory.trim()) {
      setErrorText("A categoria do item é obrigatória.");
      return;
    }

    if (!catalogName.trim()) {
      setErrorText("O nome do item é obrigatório.");
      return;
    }

    const priceValue = toNullableNumber(catalogPrice);

    if (priceValue == null) {
      setErrorText("O preço do item é obrigatório.");
      return;
    }

    if (priceValue < 0) {
      setErrorText("O preço do item não pode ser negativo.");
      return;
    }

    setSavingCatalogItem(true);

    const priceCents = Math.round(priceValue * 100);

    const { data: createdItem, error } = await supabase
      .from("store_catalog_items")
      .insert({
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        sku: catalogCode.trim() || null,
        name: catalogName.trim(),
        description: catalogDescription.trim() || null,
        price_cents: priceCents,
        currency: "BRL",
        is_active: catalogIsActive,
        metadata: {
          categoria: catalogCategory,
        },
      })
      .select("id")
      .single();

    if (error) {
      setErrorText(error.message ?? "Erro ao cadastrar item do catálogo.");
      setSavingCatalogItem(false);
      return;
    }

    try {
      if (selectedCatalogFiles.length > 0) {
        await uploadCatalogFiles(createdItem.id, selectedCatalogFiles);
      }
    } catch (uploadError: any) {
      setErrorText(
        uploadError?.message ??
          "O item foi cadastrado, mas houve erro ao enviar as fotos."
      );
      setSavingCatalogItem(false);
      await fetchPageData("reload");
      return;
    }

    resetCatalogForm();
    setSuccessText("Item do catálogo cadastrado com sucesso.");
    setSavingCatalogItem(false);
    await fetchPageData("reload");
    setActiveTab("catalogo");
  }

  async function handleCreateResponsible(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);
    setSuccessText(null);

    if (!hasValidStoreContext) {
      setErrorText("A loja ativa ainda não foi carregada. Tente novamente em instantes.");
      return;
    }

    if (!responsibleName.trim()) {
      setErrorText("O nome do responsável é obrigatório.");
      return;
    }

    if (!responsibleWhatsapp.trim()) {
      setErrorText("O WhatsApp do responsável é obrigatório.");
      return;
    }

    setSavingResponsible(true);

    const { error } = await supabase.from("store_responsibles").insert({
      organization_id: ORGANIZATION_ID,
      store_id: STORE_ID,
      name: responsibleName.trim(),
      whatsapp_number: responsibleWhatsapp.trim(),
      role: responsibleRole.trim() || "owner",
      receive_discount_alerts: receiveDiscountAlerts,
      receive_subscription_alerts: receiveSubscriptionAlerts,
      receive_sla_alerts: receiveSlaAlerts,
    });

    if (error) {
      setErrorText(error.message ?? "Erro ao cadastrar responsável.");
      setSavingResponsible(false);
      return;
    }

    resetResponsibleForm();
    setSuccessText("Responsável cadastrado com sucesso.");
    setSavingResponsible(false);
    await fetchResponsibles();
    setActiveTab("responsaveis");
  }

  async function handleSaveDiscountSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);
    setSuccessText(null);

    if (!hasValidStoreContext) {
      setErrorText("A loja ativa ainda não foi carregada. Tente novamente em instantes.");
      return;
    }

    const defaultPercent = toNullableNumber(defaultDiscountPercentInput);
    const maxPercent = toNullableNumber(maxDiscountPercentInput);

    if (defaultPercent == null) {
      setErrorText("O desconto padrão da IA é obrigatório.");
      return;
    }

    if (maxPercent == null) {
      setErrorText("O desconto máximo com autorização é obrigatório.");
      return;
    }

    if (defaultPercent < 0 || maxPercent < 0) {
      setErrorText("Os percentuais não podem ser negativos.");
      return;
    }

    if (defaultPercent > 100 || maxPercent > 100) {
      setErrorText("Os percentuais não podem ser maiores que 100%.");
      return;
    }

    if (defaultPercent > maxPercent) {
      setErrorText(
        "O desconto padrão da IA não pode ser maior que o desconto máximo com autorização."
      );
      return;
    }

    setSavingDiscountSettings(true);

    const { error } = await supabase.from("store_discount_settings").upsert(
      {
        store_id: STORE_ID,
        organization_id: ORGANIZATION_ID,
        default_discount_percent: defaultPercent,
        max_discount_percent: maxPercent,
        allow_ask_above_max_discount: allowAskAboveMaxDiscount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" }
    );

    if (error) {
      setErrorText(error.message ?? "Erro ao salvar política de desconto.");
      setSavingDiscountSettings(false);
      return;
    }

    setSavingDiscountSettings(false);
    setSuccessText("Política de desconto salva com sucesso.");
    await fetchDiscountSettings();
    setActiveTab("descontos");
  }

  useEffect(() => {
    const savedTab =
      typeof window !== "undefined" ? localStorage.getItem(TAB_STORAGE_KEY) : null;

    if (isValidTab(savedTab)) {
      setActiveTab(savedTab);
    }
  }, []);

  useEffect(() => {
    if (storeLoading) return;

    if (!hasValidStoreContext) {
      setLoadingInitial(false);
      setErrorText("Nenhuma loja ativa foi encontrada para carregar as configurações.");
      return;
    }

    void fetchPageData("initial");
  }, [storeLoading, hasValidStoreContext]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    }
  }, [activeTab]);

  if (storeLoading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando loja ativa...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
            <p className="mt-2 text-gray-600">
              Área mínima de configuração da loja para a simulação.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void fetchPageData("reload")}
            disabled={reloading || !hasValidStoreContext}
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reloading ? "Recarregando..." : "Recarregar"}
          </button>
        </div>

        {!hasValidStoreContext ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            <div className="text-lg font-semibold text-gray-900">
              Nenhuma loja ativa encontrada
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Não foi possível identificar a loja ativa para carregar as configurações.
            </p>
          </div>
        ) : (
          <>
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

            {loadingInitial ? (
              <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
                Carregando configurações...
              </div>
            ) : (
              <div className="space-y-6">
                <div className="mb-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("visao_geral")}
                    className={cx(
                      "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10",
                      activeTab === "visao_geral"
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    Visão Geral
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("piscinas")}
                    className={cx(
                      "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10",
                      activeTab === "piscinas"
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    Piscinas
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("catalogo")}
                    className={cx(
                      "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10",
                      activeTab === "catalogo"
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    Catálogo Geral
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("responsaveis")}
                    className={cx(
                      "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10",
                      activeTab === "responsaveis"
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    Responsáveis
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("descontos")}
                    className={cx(
                      "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-black/10",
                      activeTab === "descontos"
                        ? "bg-black text-white"
                        : "bg-white text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    Descontos
                  </button>
                </div>

                {activeTab === "visao_geral" && (
                  <>
                    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                      <div className="border-b border-black/5 px-6 py-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                          Resumo do catálogo geral
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          Itens da loja organizados por categoria.
                        </p>
                      </div>

                      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm text-gray-500">Piscinas</div>
                              <div className="mt-2 text-3xl font-bold text-gray-900">
                                {totalPools}
                              </div>
                            </div>

                            <Link
                              href="/configuracoes/piscinas"
                              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                            >
                              Ver todas
                            </Link>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm text-gray-500">Acessórios</div>
                              <div className="mt-2 text-3xl font-bold text-gray-900">
                                {catalogItemsByCategory.acessorios.length}
                              </div>
                            </div>

                            <Link
                              href="/configuracoes/catalogo/acessorios"
                              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                            >
                              Ver todos
                            </Link>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm text-gray-500">Produtos químicos</div>
                              <div className="mt-2 text-3xl font-bold text-gray-900">
                                {catalogItemsByCategory.quimicos.length}
                              </div>
                            </div>

                            <Link
                              href="/configuracoes/catalogo/quimicos"
                              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                            >
                              Ver todos
                            </Link>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm text-gray-500">Outros itens</div>
                              <div className="mt-2 text-3xl font-bold text-gray-900">
                                {catalogItemsByCategory.outros.length}
                              </div>
                            </div>

                            <Link
                              href="/configuracoes/catalogo/outros"
                              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                            >
                              Ver todos
                            </Link>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                      <div className="border-b border-black/5 px-6 py-4">
                        <h2 className="text-lg font-semibold text-gray-900">
                          Política atual de desconto
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          Regras que a IA deve respeitar nas negociações.
                        </p>
                      </div>

                      <div className="grid gap-4 p-6 md:grid-cols-3">
                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-sm text-gray-500">Desconto padrão da IA</div>
                          <div className="mt-2 text-2xl font-bold text-gray-900">
                            {discountSettings?.default_discount_percent ?? 0}%
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-sm text-gray-500">
                            Desconto máximo com autorização
                          </div>
                          <div className="mt-2 text-2xl font-bold text-gray-900">
                            {discountSettings?.max_discount_percent ?? 0}%
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-sm text-gray-500">
                            Consultar acima do máximo
                          </div>
                          <div className="mt-2 text-2xl font-bold text-gray-900">
                            {discountSettings?.allow_ask_above_max_discount ? "Sim" : "Não"}
                          </div>
                        </div>
                      </div>
                    </section>
                  </>
                )}

                {activeTab === "piscinas" && (
                  <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                    <div className="border-b border-black/5 px-6 py-4">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Cadastro de Piscinas
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Cadastre modelos com todos os campos obrigatórios e faça upload das
                        fotos.
                      </p>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-2">
                      <form onSubmit={handleCreatePool} className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Nome
                          </label>
                          <input
                            value={poolName}
                            onChange={(e) => setPoolName(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: Piscina Premium 7x3"
                          />
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Largura (m)
                            </label>
                            <input
                              value={poolWidth}
                              onChange={(e) => setPoolWidth(formatNumberInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="3"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Comprimento (m)
                            </label>
                            <input
                              value={poolLength}
                              onChange={(e) => setPoolLength(formatNumberInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="6"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Profundidade (m)
                            </label>
                            <input
                              value={poolDepth}
                              onChange={(e) => setPoolDepth(formatNumberInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="1,5"
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Formato
                            </label>
                            <select
                              value={poolShape}
                              onChange={(e) => setPoolShape(e.target.value)}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            >
                              <option value="retangular">Retangular</option>
                              <option value="quadrada">Quadrada</option>
                              <option value="redonda">Redonda</option>
                              <option value="oval">Oval</option>
                              <option value="outro">Outro</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Material
                            </label>
                            <select
                              value={poolMaterial}
                              onChange={(e) => setPoolMaterial(e.target.value)}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            >
                              <option value="fibra">Fibra</option>
                              <option value="vinil">Vinil</option>
                              <option value="alvenaria">Alvenaria</option>
                              <option value="outro">Outro</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Capacidade máxima (L)
                            </label>
                            <input
                              value={poolCapacity}
                              onChange={(e) => setPoolCapacity(formatNumberInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="27000"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Peso (kg)
                            </label>
                            <input
                              value={poolWeight}
                              onChange={(e) => setPoolWeight(formatNumberInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="150"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Preço
                            </label>
                            <input
                              value={poolPrice}
                              onChange={(e) => setPoolPrice(formatPriceInput(e.target.value))}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="12.000 ou 10.500,10"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">
                            Fotos da piscina
                          </label>

                          <label className="inline-flex cursor-pointer items-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90">
                            Fazer upload das fotos
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/jpg,image/webp"
                              multiple
                              onChange={handlePoolFilesChange}
                              className="hidden"
                            />
                          </label>

                          <div className="mt-2 text-xs text-gray-500">
                            Máximo de {MAX_POOL_PHOTOS} fotos por piscina e até 50 MB por
                            arquivo.
                          </div>

                          {selectedPoolFiles.length > 0 ? (
                            <div className="mt-3 space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                              {selectedPoolFiles.map((file, index) => (
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
                          ) : null}
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Descrição
                          </label>
                          <textarea
                            value={poolDescription}
                            onChange={(e) => setPoolDescription(e.target.value)}
                            className="min-h-[120px] w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Descreva o modelo da piscina..."
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={savingPool || !hasValidStoreContext}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPool ? "Salvando..." : "Cadastrar piscina"}
                        </button>
                      </form>

                      <div className="rounded-2xl bg-gray-50 p-5 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Resumo rápido
                        </div>
                        <div className="mt-3 space-y-3 text-sm text-gray-700">
                          <div>Total de piscinas cadastradas: {totalPools}</div>
                          <div>Total de fotos cadastradas: {poolPhotos.length}</div>
                        </div>

                        <Link
                          href="/configuracoes/piscinas"
                          className="mt-5 inline-flex rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                        >
                          Ver todas as piscinas cadastradas
                        </Link>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "catalogo" && (
                  <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                    <div className="border-b border-black/5 px-6 py-4">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Catálogo Geral da Loja
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Cadastre acessórios, produtos químicos e outros itens usando a base
                        genérica do catálogo.
                      </p>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-2">
                      <form onSubmit={handleCreateCatalogItem} className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Categoria
                          </label>
                          <select
                            value={catalogCategory}
                            onChange={(e) => setCatalogCategory(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                          >
                            {CATALOG_CATEGORY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Nome do item
                            </label>
                            <input
                              value={catalogName}
                              onChange={(e) => setCatalogName(e.target.value)}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="Ex.: Cloro granulado 10 kg"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Código do produto (opcional)
                            </label>
                            <input
                              value={catalogCode}
                              onChange={(e) => setCatalogCode(e.target.value)}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="Ex.: CLORO-10KG"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Preço
                          </label>
                          <input
                            value={catalogPrice}
                            onChange={(e) => setCatalogPrice(formatPriceInput(e.target.value))}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: 129,90"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">
                            Fotos do item
                          </label>

                          <label className="inline-flex cursor-pointer items-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90">
                            Fazer upload das fotos
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/jpg,image/webp"
                              multiple
                              onChange={handleCatalogFilesChange}
                              className="hidden"
                            />
                          </label>

                          <div className="mt-2 text-xs text-gray-500">
                            Máximo de {MAX_CATALOG_PHOTOS} fotos por item e até 50 MB por
                            arquivo.
                          </div>

                          {selectedCatalogFiles.length > 0 ? (
                            <div className="mt-3 space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                              {selectedCatalogFiles.map((file, index) => (
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
                          ) : null}
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Descrição
                          </label>
                          <textarea
                            value={catalogDescription}
                            onChange={(e) => setCatalogDescription(e.target.value)}
                            className="min-h-[120px] w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Descreva o item do catálogo..."
                          />
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <label className="flex items-center gap-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={catalogIsActive}
                              onChange={(e) => setCatalogIsActive(e.target.checked)}
                            />
                            Item ativo para uso pela loja e pela IA
                          </label>
                        </div>

                        <button
                          type="submit"
                          disabled={savingCatalogItem || !hasValidStoreContext}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingCatalogItem ? "Salvando..." : "Cadastrar item no catálogo"}
                        </button>
                      </form>

                      <div className="rounded-2xl bg-gray-50 p-5 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Resumo rápido do catálogo
                        </div>

                        <div className="mt-3 space-y-3 text-sm text-gray-700">
                          <div>Total de itens cadastrados: {totalCatalogItems}</div>
                          <div>
                            Acessórios cadastrados: {catalogItemsByCategory.acessorios.length}
                          </div>
                          <div>
                            Produtos químicos cadastrados: {catalogItemsByCategory.quimicos.length}
                          </div>
                          <div>Outros itens cadastrados: {catalogItemsByCategory.outros.length}</div>
                          <div>Total de fotos cadastradas: {catalogItemPhotos.length}</div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3">
                          <Link
                            href="/configuracoes/catalogo/acessorios"
                            className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                          >
                            Ver acessórios
                          </Link>

                          <Link
                            href="/configuracoes/catalogo/quimicos"
                            className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                          >
                            Ver produtos químicos
                          </Link>

                          <Link
                            href="/configuracoes/catalogo/outros"
                            className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100"
                          >
                            Ver outros itens
                          </Link>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "responsaveis" && (
                  <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                    <div className="border-b border-black/5 px-6 py-4">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Responsáveis WhatsApp
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Cadastre os responsáveis que podem assumir conversas.
                      </p>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-2">
                      <form onSubmit={handleCreateResponsible} className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Nome
                          </label>
                          <input
                            value={responsibleName}
                            onChange={(e) => setResponsibleName(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: Carlos Comercial"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            WhatsApp
                          </label>
                          <input
                            value={responsibleWhatsapp}
                            onChange={(e) => setResponsibleWhatsapp(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: 5511999999999"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Papel
                          </label>
                          <select
                            value={responsibleRole}
                            onChange={(e) => setResponsibleRole(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                          >
                            {ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-3 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <label className="flex items-center gap-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={receiveDiscountAlerts}
                              onChange={(e) => setReceiveDiscountAlerts(e.target.checked)}
                            />
                            Receber alertas de desconto
                          </label>

                          <label className="flex items-center gap-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={receiveSubscriptionAlerts}
                              onChange={(e) => setReceiveSubscriptionAlerts(e.target.checked)}
                            />
                            Receber alertas de assinatura
                          </label>

                          <label className="flex items-center gap-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={receiveSlaAlerts}
                              onChange={(e) => setReceiveSlaAlerts(e.target.checked)}
                            />
                            Receber alertas de SLA
                          </label>
                        </div>

                        <button
                          type="submit"
                          disabled={savingResponsible || !hasValidStoreContext}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingResponsible ? "Salvando..." : "Cadastrar responsável"}
                        </button>
                      </form>

                      <div className="rounded-2xl bg-gray-50 p-5 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Resumo rápido
                        </div>

                        <div className="mt-3 text-sm text-gray-700">
                          Total de responsáveis cadastrados: {totalResponsibles}
                        </div>

                        <div className="mt-4 space-y-3">
                          {responsibles.slice(0, 5).map((responsible) => (
                            <div
                              key={responsible.id}
                              className="rounded-xl bg-white p-3 ring-1 ring-black/5"
                            >
                              <div className="font-semibold text-gray-900">
                                {responsible.name ?? "Responsável sem nome"}
                              </div>
                              <div className="mt-1 text-sm text-gray-600">
                                {responsible.whatsapp_number ?? "Sem WhatsApp"}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                {roleLabel(responsible.role)}
                              </div>
                            </div>
                          ))}

                          {responsibles.length === 0 ? (
                            <div className="rounded-xl bg-white p-3 text-sm text-gray-600 ring-1 ring-black/5">
                              Nenhum responsável cadastrado.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "descontos" && (
                  <section className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                    <div className="border-b border-black/5 px-6 py-4">
                      <h2 className="text-lg font-semibold text-gray-900">
                        Política de Descontos
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        A IA deve sempre tentar vender pelo maior valor possível. Ela só pode
                        negociar dentro dos limites abaixo e nunca deve oferecer desconto
                        desnecessário.
                      </p>
                    </div>

                    <div className="grid gap-6 p-6 lg:grid-cols-2">
                      <form onSubmit={handleSaveDiscountSettings} className="space-y-4">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Desconto padrão da IA (%)
                          </label>
                          <input
                            value={defaultDiscountPercentInput}
                            onChange={(e) =>
                              setDefaultDiscountPercentInput(formatPercentInput(e.target.value))
                            }
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: 10"
                          />
                          <div className="mt-2 text-xs text-gray-500">
                            Até este percentual a IA pode negociar sozinha, mas apenas quando
                            realmente precisar para fechar a venda.
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            Desconto máximo com autorização (%)
                          </label>
                          <input
                            value={maxDiscountPercentInput}
                            onChange={(e) =>
                              setMaxDiscountPercentInput(formatPercentInput(e.target.value))
                            }
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            placeholder="Ex.: 20"
                          />
                          <div className="mt-2 text-xs text-gray-500">
                            Acima do padrão da IA e até este máximo, a IA precisa pedir
                            autorização antes de conceder.
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <label className="flex items-start gap-3 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={allowAskAboveMaxDiscount}
                              onChange={(e) => setAllowAskAboveMaxDiscount(e.target.checked)}
                              className="mt-1"
                            />
                            <span>
                              Permitir que a IA consulte acima do desconto máximo
                              <span className="mt-1 block text-xs text-gray-500">
                                Se desmarcado, a IA não pergunta nada acima do máximo e já
                                entende que aquele desconto está fora da política da loja.
                              </span>
                            </span>
                          </label>
                        </div>

                        <button
                          type="submit"
                          disabled={savingDiscountSettings || !hasValidStoreContext}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingDiscountSettings
                            ? "Salvando..."
                            : "Salvar política de descontos"}
                        </button>
                      </form>

                      <div className="space-y-4">
                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-sm font-semibold text-gray-900">
                            Regra estratégica da IA
                          </div>
                          <div className="mt-2 text-sm text-gray-600">
                            A IA nunca deve oferecer desconto à toa. Ela sempre precisa tentar
                            preservar a margem da loja e conceder apenas o menor desconto
                            necessário para fechar a venda.
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-sm font-semibold text-gray-900">
                            Resumo da política atual
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-gray-700">
                            <div>
                              <span className="font-medium">Desconto padrão da IA:</span>{" "}
                              {discountSettings?.default_discount_percent ?? 0}%
                            </div>
                            <div>
                              <span className="font-medium">
                                Desconto máximo com autorização:
                              </span>{" "}
                              {discountSettings?.max_discount_percent ?? 0}%
                            </div>
                            <div>
                              <span className="font-medium">
                                Consultar acima do máximo:
                              </span>{" "}
                              {discountSettings?.allow_ask_above_max_discount ? "Sim" : "Não"}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20">
                          <div className="font-semibold">Importante</div>
                          <div className="mt-2">
                            Mesmo que a IA tenha autorização para negociar até um certo
                            percentual, ela não deve começar oferecendo esse valor. Ela deve
                            sempre tentar vender pelo maior preço possível.
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}