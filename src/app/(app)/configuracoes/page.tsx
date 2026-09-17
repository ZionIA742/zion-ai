"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IntelligentCatalogImportPanel from "@/components/catalog/IntelligentCatalogImportPanel";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";
import {
  createStoreCommercialAiSettingsInputFromSources,
  deriveStoreCommercialAiLegacyMirrors,
  normalizeStoreCommercialAiSettingsInput,
  type StoreCommercialAiSettingsRow,
} from "@/lib/store-commercial-ai-settings";
import {
  createStorePaymentPresentationFromSources,
  createStorePaymentSettingsInputFromSources,
  deriveStorePaymentSettingsSummary,
  formatStorePaymentCurrencyInput,
  formatStorePaymentInstallmentsInput,
  formatStorePaymentPercentInput,
  getStorePaymentLegacyConditionTagLabel,
  normalizeStorePaymentSettingsInput,
  type StorePaymentLegacyConditionTag,
  type StorePaymentSettingsRow,
} from "@/lib/store-payment-settings";
import {
  normalizeMonthlySalesGoalInput,
  normalizeStoreMonthlySalesGoalRow,
  type StoreMonthlySalesGoalInput,
  type StoreMonthlySalesGoalRow,
} from "@/lib/store-monthly-sales-goal";
import {
  createStoreDiscountPresentationFromSources,
  createStoreDiscountSettingsInputFromSources,
  formatStoreDiscountMoneyInput,
  formatStoreDiscountPercentInput,
  getStoreDiscountAutonomyModeLabel,
  normalizeStoreDiscountSettingsInput,
  type StoreDiscountSettingsRow,
  type StoreHighValueDiscountSettingsRow,
} from "@/lib/store-discount-settings";
import {
  createStoreChannelSettingsInputFromSources,
  normalizeStoreChannelSettingsInput,
  type StoreChannelSettingsRow,
} from "@/lib/store-channel-settings";
import {
  createStoreStrategySettingsInputFromSources,
  deriveStoreStrategyAiStoreSummary,
  normalizeStoreStrategySettingsInput,
  type StoreStrategySettingsInput,
  type StoreStrategySettingsRow,
} from "@/lib/store-strategy-settings";
import {
  applyWeekendSelectionToOperatingDays,
  createStoreOperationSettingsInputFromSources,
  deriveWeekendAvailabilityFromOperatingDays,
  normalizePersistedOperationDraft,
  normalizeOperatingDays,
  normalizeStoreOperationSettingsInput,
  type StoreOperationTechnicalVisitRule,
  type StoreOperationSettingsRow,
} from "@/lib/store-operation-settings";

import {
  buildDeliveryExecutionPolicy,
  buildInstallationExecutionPolicy,
  buildPickupExecutionPolicy,
  buildPoolReplacementExecutionPolicy,
  buildTechnicalServicesExecutionPolicy,
  buildTechnicalVisitExecutionPolicy,
  deliveryPolicyToDraftPatch,
  installationPolicyToDraftPatch,
  parseVisitFixedFeeToCents,
  pickupPolicyToDraftPatch,
  poolReplacementPolicyToDraftPatch,
  technicalServicesPolicyToDraftPatch,
  technicalVisitPolicyToDraftPatch,
  type DeliveryExecutionPolicy,
  type InstallationExecutionPolicy,
  type PickupExecutionPolicy,
  type PoolReplacementExecutionPolicy,
  type StoreOperationExecutionPoliciesRow,
  type TechnicalServicesExecutionPolicy,
  type TechnicalVisitExecutionPolicy,
} from "@/lib/store-operation-execution-policies";
type CountState = {
  pools: number;
  quimicos: number;
  acessorios: number;
  outros: number;
};

type CatalogItemRow = {
  id: string;
  name?: string | null;
  is_active?: boolean | null;
  price_status?: string | null;
  stock_status?: string | null;
  metadata?: {
    categoria?: string | null;
    brand?: string | null;
  } | null;
};

type PoolCatalogSuggestionRow = {
  id: string;
  name: string | null;
  is_active?: boolean | null;
  price_status?: string | null;
  stock_status?: string | null;
};

type CatalogQualityState = {
  total: number;
  withoutPrice: number;
  unknownStock: number;
  withoutPhotos: number;
  inactive: number;
};

type CatalogSuggestionItem = {
  key: string;
  category: "piscinas" | "acessorios" | "quimicos" | "equipamentos" | "outros_catalogo";
  label: string;
};

type CatalogPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string | null;
};

type PoolPhotoRow = {
  id: string;
  pool_id: string;
  storage_path: string | null;
};

type StoreImportFileRow = {
  id: string;
  organization_id: string;
  store_id: string;
  source: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  extension: string | null;
  size_bytes: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  import_summary?: Record<string, unknown> | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreCatalogSettingsRow = {
  organization_id: string;
  store_id: string;
  allow_full_catalog_send: boolean;
  customer_catalog_import_file_ids: string[];
  created_at: string;
  updated_at: string;
};

type StoreBrandingSettingsRow = {
  id: string;
  organization_id: string;
  store_id: string;
  logo_storage_bucket: string | null;
  logo_storage_path: string | null;
  logo_original_filename: string | null;
  logo_mime_type: string | null;
  logo_size_bytes: number | null;
  logo_uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreBrandingApiResponse = {
  ok: boolean;
  branding?: StoreBrandingSettingsRow | null;
  signedUrl?: string | null;
  warning?: string | null;
  error?: string;
  message?: string;
};

type StoreWhatsappStatusApiResponse = {
  ok: boolean;
  connected?: boolean;
  provider?: string | null;
  status?: string | null;
  isActive?: boolean;
  displayPhoneNumber?: string | null;
  phoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  pendingInboxCount?: number;
  pendingOutboundCount?: number;
  lastSafeError?: string | null;
  recentDeliveryStatus?: {
    sentCount?: number;
    deliveredCount?: number;
    readCount?: number;
  } | null;
  automaticWorker?: {
    routeReady?: boolean;
    scheduledAutomatically?: boolean;
    reason?: string | null;
  } | null;
  error?: string;
  message?: string;
};

type CanonicalPrimaryResponsible = {
  id: string;
  name: string | null;
  whatsappNumber: string;
  role: string | null;
};

type StorePrimaryResponsibleApiResponse = {
  ok: boolean;
  responsible?: CanonicalPrimaryResponsible | null;
  error?: string;
  message?: string;
};

type StoreContractTemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string | null;
  active_version_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateVersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  raw_extracted_text: string | null;
  analysis_summary: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateExtractedRuleRow = {
  id: string;
  template_version_id: string;
  organization_id: string;
  store_id: string;
  rule_key: string;
  rule_group: string;
  label: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  source_excerpt: string | null;
  confidence: number | null;
  review_status: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateApiResponse = {
  ok: boolean;
  template?: StoreContractTemplateRow | null;
  activeVersion?: StoreContractTemplateVersionRow | null;
  versions?: StoreContractTemplateVersionRow[];
  extractedRules?: StoreContractTemplateExtractedRuleRow[];
  error?: string;
  message?: string;
};

type ContractRuleReviewStatus = "pending" | "approved" | "rejected" | "edited";


type OnboardingRow = {
  id?: string;
  store_id: string;
  organization_id: string;
  status: string;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type AnswersMap = Record<string, unknown>;

type PoolFormState = {
  name: string;
  brand: string;
  material: string;
  shape: string;
  color: string;
  finish: string;
  width_m: string;
  length_m: string;
  depth_m: string;
  price: string;
  stock_quantity: string;
  description: string;
  included_items: string;
  installation_notes: string;
  application: string;
  technical_notes: string;
  is_active: boolean;
  track_stock: boolean;
};

type CatalogFormState = {
  category: "quimicos" | "acessorios" | "outros";
  name: string;
  sku: string;
  brand: string;
  line: string;
  unit_label: string;
  size_details: string;
  width_cm: string;
  height_cm: string;
  length_cm: string;
  weight_kg: string;
  price: string;
  stock_quantity: string;
  description: string;
  application: string;
  technical_notes: string;
  is_active: boolean;
  track_stock: boolean;
};

type ManualPriceStatus = "valid" | "missing";
type ManualStockStatus = "available" | "zero" | "unknown" | "not_tracked";

function resolveManualPriceStatus(value: number | null): ManualPriceStatus {
  return value == null ? "missing" : "valid";
}

function resolveManualPriceStatusFromCents(value: number | null): ManualPriceStatus {
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

  const parsedQuantity = Number(trimmedQuantity.replace(",", "."));
  const normalizedQuantity = Number.isFinite(parsedQuantity) ? Math.max(0, Math.round(parsedQuantity)) : null;
  if (normalizedQuantity == null) {
    return {
      stockQuantity: null,
      stockStatus: "unknown" as const,
    };
  }

  return {
    stockQuantity: normalizedQuantity,
    stockStatus: normalizedQuantity > 0 ? ("available" as const) : ("zero" as const),
  };
}

type OperationDraftState = {
  operating_days: string;
  operating_hours: string;
  installation_days_rule: string;
  technical_visit_days_rule: string;
  serves_saturday: string;
  serves_sunday: string;
  serves_holiday: string;
  allow_multiple_appointments_per_day: string;
  allow_same_time_appointments: string;
  offers_installation: string;
  average_installation_time_days: string;
  installation_process_summary: string;
  offers_technical_visit: string;
  technical_visit_rules_selected: StoreOperationTechnicalVisitRule[];
  technical_visit_rules_other: string;
  agenda_capacity_rule: string;
};

type GeneralAddressDraftState = {
  has_public_address: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  customer_visit_mode: string;
  reference_point: string;
  directions_notes: string;
};

type StoreGeneralAddressSettingsRow = {
  organization_id: string;
  store_id: string;
  has_public_address: boolean;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  customer_visit_mode: string | null;
  reference_point: string | null;
  directions_notes: string | null;
  address_configured_at: string | null;
  created_at: string;
  updated_at: string;
};

type StoreCepLookupApiResponse =
  | {
      ok: true;
      found: true;
      address: {
        street?: string | null;
        district?: string | null;
        city?: string | null;
        state?: string | null;
      };
    }
  | {
      ok: true;
      found: false;
      message?: string | null;
    }
  | {
      ok: false;
      message?: string | null;
    };

type OperationExperienceDraftState = {
  team_same_hours: string;
  team_days: string[];
  team_open_time: string;
  team_close_time: string;
  team_day_hours: Record<string, { open: string; close: string }>;
  holiday_mode: string;
  holiday_open_time: string;
  holiday_close_time: string;
  holiday_notes: string;
  ai_after_hours_enabled: string;
  ai_after_hours_mode: string;
  ai_after_hours_start: string;
  ai_after_hours_end: string;
  ai_attends_holidays: string;
  agenda_daily_limit_mode: string;
  agenda_daily_limit: string;
  agenda_buffer_enabled: string;
  agenda_buffer_minutes: string;
  ai_can_accept_customer_reschedule_without_approval: string;
  visit_required_situations: string[];
  visit_required_other: string;
  visit_optional_situations: string[];
  visit_optional_other: string;
  visit_requires_appointment: string;
  visit_availability_mode: string;
  visit_duration_mode: string;
  visit_duration_minutes: string;
  visit_duration_rule: string;
  visit_team_mode: string;
  visit_team_rule: string;
  visit_pricing_mode: string;
  visit_fixed_fee: string;
  visit_case_by_case_rule: string;
  visit_deductible: string;
  visit_preconfirm_items: string[];
  visit_preconfirm_other: string;
  visit_other_notes: string;
  installation_customer_can_buy_without: string;
  installation_customer_can_buy_without_rule: string;
  installation_third_party_pool: string;
  installation_third_party_pool_rule: string;
  installation_availability_mode: string;
  installation_supply_mode: string;
  installation_supplier_lead_time_mode: string;
  installation_supplier_lead_time_value: string;
  installation_supplier_lead_time_rule: string;
  installation_start_lead_time_mode: string;
  installation_start_lead_time_days: string;
  installation_start_lead_time_rule: string;
  installation_duration_mode: string;
  installation_duration_value: string;
  installation_duration_unit: string;
  installation_duration_rule: string;
  installation_has_multiple_teams: string;
  installation_concurrent_capacity: string;
  installation_schedule_gates: string[];
  installation_schedule_gates_other: string;
  installation_start_gates: string[];
  installation_start_gates_other: string;
  installation_includes: string[];
  installation_includes_other: string;
  installation_excludes_options: string[];
  installation_excludes: string;
  installation_notes: string;
  pool_replacement_enabled: string;
  pool_replacement_situations: string[];
  pool_replacement_situations_other: string;
  pool_replacement_removes_old: string;
  pool_replacement_removes_old_rule: string;
  pool_replacement_disposal_included: string;
  pool_replacement_disposal_rule: string;
  pool_replacement_requires_visit: string;
  pool_replacement_visit_rule: string;
  pool_replacement_uses_installation_team: string;
  pool_replacement_team_rule: string;
  pool_replacement_duration_mode: string;
  pool_replacement_duration_value: string;
  pool_replacement_duration_rule: string;
  pool_replacement_includes: string[];
  pool_replacement_excludes_options: string[];
  pool_replacement_excludes: string;
  pool_replacement_notes: string;
  delivery_enabled: string;
  delivery_items: string[];
  delivery_items_other: string;
  delivery_with_installation_mode: string;
  delivery_with_installation_timing: string;
  delivery_with_installation_notes: string;
  delivery_provider: string;
  delivery_provider_rule: string;
  delivery_uses_installation_team: string;
  delivery_installation_team_rule: string;
  delivery_coverage_mode: string;
  delivery_pricing_mode: string;
  delivery_pricing_destination_mode: string;
  delivery_pricing_destination_rule: string;
  delivery_partner_pricing_mode: string;
  delivery_partner_pricing_rule: string;
  delivery_case_factors: string[];
  delivery_case_rule: string;
  delivery_fixed_fee: string;
  delivery_requires_appointment: string;
  delivery_lead_time_mode: string;
  delivery_lead_time_days: string;
  delivery_release_gates: string[];
  delivery_release_gates_other: string;
  delivery_unloading_mode: string;
  delivery_notes: string;
  pickup_enabled: string;
  pickup_items: string[];
  pickup_items_other: string;
  pickup_location_mode: string;
  pickup_other_location: string;
  pickup_requires_appointment: string;
  pickup_ready_mode: string;
  pickup_ready_value: string;
  pickup_third_party_allowed: string;
  pickup_release_gates: string[];
  pickup_release_gates_other: string;
  pickup_notes: string;
  region_outside_policy: string;
  technical_services_enabled: string;
  technical_service_types: string[];
  technical_services_other: string;
  technical_equipment_types: string[];
  technical_equipment_other: string;
  equipment_installation_origin_policy: string;
  equipment_installation_origin_rule: string;
  equipment_replacement_existing: string;
  equipment_replacement_existing_rule: string;
  technical_services_notes: string;
};

function createEmptyGeneralAddressDraft(): GeneralAddressDraftState {
  return {
    has_public_address: "Não definido",
    cep: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    customer_visit_mode: "",
    reference_point: "",
    directions_notes: "",
  };
}

function createGeneralAddressDraftFromSettings(
  row: StoreGeneralAddressSettingsRow | null,
): GeneralAddressDraftState {
  if (!row) return createEmptyGeneralAddressDraft();

  return {
    has_public_address: row.has_public_address ? "Sim" : "Não",
    cep: formatBrazilianCepInput(cleanText(row.cep)),
    street: cleanText(row.street),
    number: cleanText(row.number),
    complement: cleanText(row.complement),
    district: cleanText(row.district),
    city: cleanText(row.city),
    state: cleanText(row.state),
    customer_visit_mode: cleanText(row.customer_visit_mode),
    reference_point: cleanText(row.reference_point),
    directions_notes: cleanText(row.directions_notes),
  };
}

function createEmptyOperationExperienceDraft(): OperationExperienceDraftState {
  return {
    team_same_hours: "Sim",
    team_days: ["segunda", "terca", "quarta", "quinta", "sexta"],
    team_open_time: "08:00",
    team_close_time: "18:00",
    team_day_hours: {
      segunda: { open: "08:00", close: "18:00" },
      terca: { open: "08:00", close: "18:00" },
      quarta: { open: "08:00", close: "18:00" },
      quinta: { open: "08:00", close: "18:00" },
      sexta: { open: "08:00", close: "18:00" },
      sabado: { open: "08:00", close: "12:00" },
      domingo: { open: "08:00", close: "12:00" },
    },
    holiday_mode: "",
    holiday_open_time: "",
    holiday_close_time: "",
    holiday_notes: "",
    ai_after_hours_enabled: "Não definido",
    ai_after_hours_mode: "",
    ai_after_hours_start: "",
    ai_after_hours_end: "",
    ai_attends_holidays: "",
    agenda_daily_limit_mode: "",
    agenda_daily_limit: "",
    agenda_buffer_enabled: "",
    agenda_buffer_minutes: "",
    ai_can_accept_customer_reschedule_without_approval: "",
    visit_required_situations: [],
    visit_required_other: "",
    visit_optional_situations: [],
    visit_optional_other: "",
    visit_requires_appointment: "",
    visit_availability_mode: "",
    visit_duration_mode: "",
    visit_duration_minutes: "",
    visit_duration_rule: "",
    visit_team_mode: "",
    visit_team_rule: "",
    visit_pricing_mode: "",
    visit_fixed_fee: "",
    visit_case_by_case_rule: "",
    visit_deductible: "",
    visit_preconfirm_items: [],
    visit_preconfirm_other: "",
    visit_other_notes: "",
    installation_customer_can_buy_without: "",
    installation_customer_can_buy_without_rule: "",
    installation_third_party_pool: "",
    installation_third_party_pool_rule: "",
    installation_availability_mode: "",
    installation_supply_mode: "",
    installation_supplier_lead_time_mode: "",
    installation_supplier_lead_time_value: "",
    installation_supplier_lead_time_rule: "",
    installation_start_lead_time_mode: "",
    installation_start_lead_time_days: "",
    installation_start_lead_time_rule: "",
    installation_duration_mode: "",
    installation_duration_value: "",
    installation_duration_unit: "horas",
    installation_duration_rule: "",
    installation_has_multiple_teams: "",
    installation_concurrent_capacity: "",
    installation_schedule_gates: [],
    installation_schedule_gates_other: "",
    installation_start_gates: [],
    installation_start_gates_other: "",
    installation_includes: [],
    installation_includes_other: "",
    installation_excludes_options: [],
    installation_excludes: "",
    installation_notes: "",
    pool_replacement_enabled: "Não definido",
    pool_replacement_situations: [],
    pool_replacement_situations_other: "",
    pool_replacement_removes_old: "",
    pool_replacement_removes_old_rule: "",
    pool_replacement_disposal_included: "",
    pool_replacement_disposal_rule: "",
    pool_replacement_requires_visit: "",
    pool_replacement_visit_rule: "",
    pool_replacement_uses_installation_team: "",
    pool_replacement_team_rule: "",
    pool_replacement_duration_mode: "",
    pool_replacement_duration_value: "",
    pool_replacement_duration_rule: "",
    pool_replacement_includes: [],
    pool_replacement_excludes_options: [],
    pool_replacement_excludes: "",
    pool_replacement_notes: "",
    delivery_enabled: "Não definido",
    delivery_items: [],
    delivery_items_other: "",
    delivery_with_installation_mode: "",
    delivery_with_installation_timing: "",
    delivery_with_installation_notes: "",
    delivery_provider: "",
    delivery_provider_rule: "",
    delivery_uses_installation_team: "",
    delivery_installation_team_rule: "",
    delivery_coverage_mode: "",
    delivery_pricing_mode: "",
    delivery_pricing_destination_mode: "",
    delivery_pricing_destination_rule: "",
    delivery_partner_pricing_mode: "",
    delivery_partner_pricing_rule: "",
    delivery_case_factors: [],
    delivery_case_rule: "",
    delivery_fixed_fee: "",
    delivery_requires_appointment: "",
    delivery_lead_time_mode: "",
    delivery_lead_time_days: "",
    delivery_release_gates: [],
    delivery_release_gates_other: "",
    delivery_unloading_mode: "",
    delivery_notes: "",
    pickup_enabled: "Não definido",
    pickup_items: [],
    pickup_items_other: "",
    pickup_location_mode: "",
    pickup_other_location: "",
    pickup_requires_appointment: "",
    pickup_ready_mode: "",
    pickup_ready_value: "",
    pickup_third_party_allowed: "",
    pickup_release_gates: [],
    pickup_release_gates_other: "",
    pickup_notes: "",
    region_outside_policy: "",
    technical_services_enabled: "Não definido",
    technical_service_types: [],
    technical_services_other: "",
    technical_equipment_types: [],
    technical_equipment_other: "",
    equipment_installation_origin_policy: "",
    equipment_installation_origin_rule: "",
    equipment_replacement_existing: "",
    equipment_replacement_existing_rule: "",
    technical_services_notes: "",
  };
}

type ScheduleSettingsRow = {
  id?: string;
  organization_id: string;
  store_id: string;
  allow_multiple_appointments_per_day: boolean;
  allow_same_time_appointments: boolean;
  same_time_capacity: number | null;
  attends_holidays: boolean;
  operating_days: unknown;
  operating_hours: unknown;
  installation_days: unknown;
  technical_visit_days: unknown;
  after_hours_behavior: string | null;
  notes: string | null;
  enforce_operating_window?: boolean;
  timezone_name?: string | null;
  holiday_mode?: string | null;
  holiday_open_time?: string | null;
  holiday_close_time?: string | null;
  holiday_notes?: string | null;
  human_schedule_configured_at?: string | null;
  ai_after_hours_configured_at?: string | null;
  agenda_capacity_configured_at?: string | null;
  ai_can_accept_customer_reschedule_without_approval?: boolean | null;
  customer_reschedule_autonomy_configured_at?: string | null;
  daily_limit_mode?: string | null;
  daily_limit?: number | null;
  appointment_buffer_enabled?: boolean | null;
  appointment_buffer_minutes?: number | null;
  ai_after_hours_enabled?: boolean | null;
  ai_after_hours_mode?: string | null;
  ai_after_hours_start?: string | null;
  ai_after_hours_end?: string | null;
  ai_attends_holidays?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};


type CommercialDraftState = {
  ai_display_name: string;
  ai_presentation_mode: string;
  price_answer_policy: string;
  price_context_requirements: string[];
  ai_tone_summary: string;
  ai_speaks_as: string;
  can_send_price_directly: string;
  price_before_summary: string;
  price_policy_summary: string;
  human_help_summary: string;
  payment_methods_summary: string;
  accepted_payment_methods: string[];
  legacy_payment_condition_tags: string[];
  pix_key_type: string;
  pix_key: string;
  pix_holder_name: string;
  down_payment_mode: string;
  down_payment_value_type: string;
  down_payment_percent: string;
  down_payment_amount: string;
  installments_enabled: string;
  max_installments: string;
  installment_interest_policy: string;
  payment_notes: string;
  discount_policy_summary: string;
  negotiation_rules_summary: string;
  promise_limits_summary: string;
  post_sale_summary: string;
  after_hours_summary: string;
  commercial_ai_summary: string;
};


type CommercialExperienceDraftState = {
  offering_products: string[];
  offering_products_other: string;
  offering_services: string[];
  offering_services_other: string;
  strategy_sell_more: string[];
  strategy_sell_more_other: string;
  strategy_sale_preference: string;
  strategy_sale_preference_other: string;
  strategy_customer_traits: string[];
  strategy_customer_traits_other: string;
  strategy_attention_cases: string[];
  strategy_attention_other: string;
  strategy_priority_deal_types: string[];
  strategy_priority_deal_types_other: string;
  strategy_avoid_cases: string[];
  strategy_avoid_cases_other: string;
  strategy_avoid_action: string;
  strategy_sale_value_range: string;
  strategy_sale_value_custom: string;
  brands_has_main: string;
  brands_main_choice: string;
  brands_main_other: string;
  brands_worked: string[];
  brands_worked_other: string;
  brands_priority_enabled: string;
  brands_priority: string[];
  brands_priority_other: string;
  ai_guidance_enabled: string;
  ai_guidance_other: string;
  price_context_other_enabled: boolean;
  price_context_other: string;
  suggestions_enabled: string;
  suggestion_types: string[];
  suggestion_catalog_item_keys: string[];
  suggestion_services_detail: string;
  suggestion_other: string;
  better_option_policy: string;
  payment_other_enabled: boolean;
  payment_other_method: string;
  down_payment_case_rule: string;
  entry_due_trigger: string;
  entry_due_other: string;
  installments_interest_free_enabled: string;
  installments_interest_free_max: string;
  installment_interest_above_mode: string;
  installment_interest_above_rule: string;
  installment_minimum_enabled: string;
  installment_minimum_amount: string;
  financing_mode: string;
  financing_partner_name: string;
  financing_credit_analysis: string;
  financing_simulation_by: string;
  financing_ai_policy: string;
  financing_other: string;
  balance_due_trigger: string;
  balance_due_other: string;
  payment_blocking_actions: string[];
  payment_blocking_other: string;
  high_value_requires_human: string;
  quote_validity: string;
  quote_validity_other_days: string;
  quote_customer_note_enabled: string;
  quote_customer_note: string;
  quote_internal_note_enabled: string;
  quote_internal_note: string;
  quote_preliminary_before_visit: string;
  quote_definitive_requires_visit_result: string;
  post_sale_duration: string;
  post_sale_duration_other_days: string;
  post_sale_start: string;
  post_sale_start_other: string;
  post_sale_checks: string[];
  post_sale_checks_other: string;
  warranty_extra_mode: string;
  warranty_extra_rule: string;
  warranty_items: string[];
  warranty_items_other: string;
  warranty_start: string;
  warranty_start_other: string;
  warranty_duration_value: string;
  warranty_duration_unit: string;
  warranty_conditions_enabled: string;
  warranty_conditions: string;
  cancellation_policy_exists: string;
  cancellation_rule_situations: string[];
  cancellation_after_contract_enabled: string;
  cancellation_after_contract_rule: string;
  cancellation_ordered_product_enabled: string;
  cancellation_ordered_product_rule: string;
  cancellation_custom_order_enabled: string;
  cancellation_custom_order_rule: string;
  cancellation_after_delivery_enabled: string;
  cancellation_after_delivery_rule: string;
  cancellation_service_started_enabled: string;
  cancellation_service_started_rule: string;
  cancellation_charge_or_retention_enabled: string;
  cancellation_charge_or_retention_rule: string;
  cancellation_refund_rule_enabled: string;
  cancellation_refund_rule: string;
  cancellation_policy_other_enabled: string;
  cancellation_policy_other: string;
};

function createEmptyCommercialExperienceDraft(): CommercialExperienceDraftState {
  return {
    offering_products: [],
    offering_products_other: "",
    offering_services: [],
    offering_services_other: "",
    strategy_sell_more: [],
    strategy_sell_more_other: "",
    strategy_sale_preference: "",
    strategy_sale_preference_other: "",
    strategy_customer_traits: [],
    strategy_customer_traits_other: "",
    strategy_attention_cases: [],
    strategy_attention_other: "",
    strategy_priority_deal_types: [],
    strategy_priority_deal_types_other: "",
    strategy_avoid_cases: [],
    strategy_avoid_cases_other: "",
    strategy_avoid_action: "",
    strategy_sale_value_range: "",
    strategy_sale_value_custom: "",
    brands_has_main: "Não definido",
    brands_main_choice: "",
    brands_main_other: "",
    brands_worked: [],
    brands_worked_other: "",
    brands_priority_enabled: "Não definido",
    brands_priority: [],
    brands_priority_other: "",
    ai_guidance_enabled: "Não definido",
    ai_guidance_other: "",
    price_context_other_enabled: false,
    price_context_other: "",
    suggestions_enabled: "Não definido",
    suggestion_types: [],
    suggestion_catalog_item_keys: [],
    suggestion_services_detail: "",
    suggestion_other: "",
    better_option_policy: "",
    payment_other_enabled: false,
    payment_other_method: "",
    down_payment_case_rule: "",
    entry_due_trigger: "",
    entry_due_other: "",
    installments_interest_free_enabled: "",
    installments_interest_free_max: "",
    installment_interest_above_mode: "",
    installment_interest_above_rule: "",
    installment_minimum_enabled: "",
    installment_minimum_amount: "",
    financing_mode: "",
    financing_partner_name: "",
    financing_credit_analysis: "",
    financing_simulation_by: "",
    financing_ai_policy: "",
    financing_other: "",
    balance_due_trigger: "",
    balance_due_other: "",
    payment_blocking_actions: [],
    payment_blocking_other: "",
    high_value_requires_human: "",
    quote_validity: "",
    quote_validity_other_days: "",
    quote_customer_note_enabled: "",
    quote_customer_note: "",
    quote_internal_note_enabled: "",
    quote_internal_note: "",
    quote_preliminary_before_visit: "",
    quote_definitive_requires_visit_result: "",
    post_sale_duration: "",
    post_sale_duration_other_days: "",
    post_sale_start: "",
    post_sale_start_other: "",
    post_sale_checks: [],
    post_sale_checks_other: "",
    warranty_extra_mode: "",
    warranty_extra_rule: "",
    warranty_items: [],
    warranty_items_other: "",
    warranty_start: "",
    warranty_start_other: "",
    warranty_duration_value: "",
    warranty_duration_unit: "meses",
    warranty_conditions_enabled: "",
    warranty_conditions: "",
    cancellation_policy_exists: "",
    cancellation_rule_situations: [],
    cancellation_after_contract_enabled: "",
    cancellation_after_contract_rule: "",
    cancellation_ordered_product_enabled: "",
    cancellation_ordered_product_rule: "",
    cancellation_custom_order_enabled: "",
    cancellation_custom_order_rule: "",
    cancellation_after_delivery_enabled: "",
    cancellation_after_delivery_rule: "",
    cancellation_service_started_enabled: "",
    cancellation_service_started_rule: "",
    cancellation_charge_or_retention_enabled: "",
    cancellation_charge_or_retention_rule: "",
    cancellation_refund_rule_enabled: "",
    cancellation_refund_rule: "",
    cancellation_policy_other_enabled: "",
    cancellation_policy_other: "",
  };
}

type BrandExperienceDraftState = {
  use_logo_on_quotes: string;
  use_logo_on_contracts: string;
  primary_color: string;
  secondary_color: string;
  document_footer: string;
};

type ContractExperienceDraftState = {
  enabled: string;
  applicability_mode: string;
  applicability_cases: string[];
  applicability_other: string;
  high_value_amount: string;
  formats: string[];
  signed_before: string[];
  signed_before_other: string;
  notes: string;
};

function createEmptyBrandExperienceDraft(): BrandExperienceDraftState {
  return {
    use_logo_on_quotes: "Sim",
    use_logo_on_contracts: "Sim",
    primary_color: "#111111",
    secondary_color: "#FFFFFF",
    document_footer: "",
  };
}

function createEmptyContractExperienceDraft(): ContractExperienceDraftState {
  return {
    enabled: "",
    applicability_mode: "",
    applicability_cases: [],
    applicability_other: "",
    high_value_amount: "",
    formats: [],
    signed_before: [],
    signed_before_other: "",
    notes: "",
  };
}

type DiscountDraftState = {
  default_discount_percent: string;
  max_discount_percent: string;
  allow_ask_above_max_discount: boolean;
  discount_autonomy_mode: string;
  high_value_enabled: boolean;
  high_value_threshold_amount: string;
  high_value_discount_percent: string;
  human_help_discount_summary: string;
  discount_approver: string;
  special_discount_rules: string;
  discount_explanation: string;
};


type ChannelDraftState = {
  commercial_channel_name: string;
  commercial_whatsapp: string;
  commercial_channel_active: string;
  commercial_receives_real_clients: string;
  commercial_is_official_sales_channel: string;
  commercial_channel_type: string;
  commercial_entry_priority: string;
  commercial_human_handoff_enabled: string;
  commercial_channel_notes: string;
  responsible_channel_name: string;
  responsible_whatsapp: string;
  responsible_channel_active: string;
  responsible_channel_type: string;
  responsible_is_primary_alert_channel: string;
  responsible_is_human_command_channel: string;
  responsible_receives_ai_alerts: string;
  responsible_receives_reports: string;
  responsible_receives_urgencies: string;
  responsible_receives_visit_alerts: string;
  responsible_receives_payment_alerts: string;
  responsible_channel_notes: string;
  internal_chat_enabled: string;
  internal_chat_for_assistant: string;
  internal_chat_separate_from_inbox: string;
  internal_chat_visible_to_team: string;
  internal_chat_accepts_manual_commands: string;
  internal_chat_priority: string;
  internal_chat_notes: string;
  channels_are_separate: string;
  dedicated_number: string;
  telegram_future_status: string;
  extra_channel_notes: string;
  integration_provider_name: string;
  integration_connection_mode: string;
  integration_test_status: string;
  webhook_inbound_status: string;
  external_send_status: string;
  integration_has_inbound_webhook: string;
  integration_has_status_webhook: string;
  integration_has_outbound_delivery: string;
  whatsapp_integration_status: string;
  integrations_status: string;
  integrations_notes: string;
  customer_messages_route: string;
  assistant_alerts_route: string;
  urgency_route: string;
  reports_route: string;
  channel_fallback_rule: string;
  channels_system_summary: string;
};


type PersistedConfiguracoesState = {
  activeTab: SettingsTabId;
  scrollY: number;
  isOverviewEditing: boolean;
  isStrategyEditing: boolean;
  isOperationEditing: boolean;
  isCommercialEditing: boolean;
  isDiscountEditing: boolean;
  isChannelsEditing: boolean;
  showChannelsAdvanced: boolean;
  isActivationEditing: boolean;
  overviewDraft: Record<string, string>;
  strategyDraft: StoreStrategySettingsInput;
  operationDraft: OperationDraftState;
  commercialDraft: CommercialDraftState;
  commercialExperienceDraft: CommercialExperienceDraftState;
  savedCommercialExperience: CommercialExperienceDraftState;
  brandExperienceDraft: BrandExperienceDraftState;
  savedBrandExperience: BrandExperienceDraftState;
  contractExperienceDraft: ContractExperienceDraftState;
  savedContractExperience: ContractExperienceDraftState;
  isCatalogImportedFilesOpen: boolean;
  discountDraft: DiscountDraftState;
  channelDraft: ChannelDraftState;
  primaryResponsibleDraft: ResponsiblePersonDraft;
  additionalResponsiblesDraft: ResponsiblePersonDraft[];
  activationConfirmInformationDraft: boolean;
  activationNotificationCasesDraft: string;
  activationPreferencesDraft: string;
  poolForm: PoolFormState;
  catalogForm: CatalogFormState;
};

type ResponsiblePersonDraft = {
  id: string;
  name: string;
  whatsapp: string;
  role: string;
  receives_ai_alerts: boolean;
  can_approve_discount: boolean;
  can_approve_exceptions: boolean;
  can_assume_human: boolean;
  notes: string;
};

type StatusTone = "green" | "amber" | "red" | "gray" | "blue";

type SettingsTabId =
  | "geral"
  | "operacao"
  | "comercial"
  | "catalogo"
  | "contratos-marca"
  | "canais-integracoes"
  | "plano-cobranca";

function normalizeSettingsTabId(tab: string | null | undefined): SettingsTabId {
  switch (tab) {
    case "geral":
    case "visao-geral":
      return "geral";
    case "operacao":
      return "operacao";
    case "comercial":
    case "estrategia":
    case "comercial-ia":
    case "descontos":
      return "comercial";
    case "catalogo":
    case "piscinas":
    case "produtos-acessorios":
      return "catalogo";
    case "contratos-marca":
    case "contratos":
    case "identidade":
      return "contratos-marca";
    case "canais-integracoes":
    case "responsavel-ativacao":
      return "canais-integracoes";
    case "plano-cobranca":
    case "plano":
    case "planos":
      return "plano-cobranca";
    default:
      return "geral";
  }
}

type Option = {
  value: string;
  label: string;
};

const STORE_SERVICE_OPTIONS: Option[] = [
  { value: "venda_piscinas", label: "Venda de piscinas" },
  { value: "instalacao_piscinas", label: "Instalação de piscinas" },
  { value: "venda_produtos_quimicos", label: "Venda de produtos químicos" },
  { value: "venda_acessorios", label: "Venda de acessórios" },
  { value: "visita_tecnica", label: "Visita técnica" },
  { value: "manutencao", label: "Limpeza / manutenção" },
];

const SERVICE_REGION_MODE_OPTIONS: Option[] = [
  { value: "somente_cidade_loja", label: "Somente a cidade da loja" },
  { value: "cidade_e_vizinhas", label: "Cidade da loja + cidades vizinhas" },
  { value: "grande_regiao", label: "Atende várias cidades da região" },
  { value: "todo_estado", label: "Todo o estado" },
  { value: "sob_consulta", label: "Fora da região, só sob consulta" },
];

const POOL_TYPE_OPTIONS: Option[] = [
  { value: "fibra", label: "Fibra" },
  { value: "vinil", label: "Vinil" },
  { value: "alvenaria", label: "Alvenaria" },
  { value: "pastilha", label: "Pastilha / revestida" },
  { value: "spa", label: "SPA / hidromassagem" },
  { value: "prainha", label: "Prainha / complemento" },
];

const DAYS_OF_WEEK_OPTIONS: Option[] = [
  { value: "segunda", label: "Segunda" },
  { value: "terca", label: "Terça" },
  { value: "quarta", label: "Quarta" },
  { value: "quinta", label: "Quinta" },
  { value: "sexta", label: "Sexta" },
  { value: "sabado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

const CANONICAL_OPERATION_DAYS = DAYS_OF_WEEK_OPTIONS.map((day) => day.value);
const DEFAULT_SCHEDULE_TIMEZONE = "America/Sao_Paulo";

const TECHNICAL_VISIT_RULE_OPTIONS: Option[] = [
  { value: "precisa_agendar", label: "Precisa agendar antes" },
  { value: "confirmar_endereco", label: "Precisa confirmar endereço antes" },
  { value: "analise_do_local", label: "Pode depender de avaliação do local" },
  { value: "pode_ter_taxa", label: "Pode ter taxa de deslocamento" },
];

const IMPORTANT_LIMITATION_OPTIONS: Option[] = [
  { value: "nao_atende_domingo", label: "Não atende domingo" },
  { value: "nao_atende_fora_regiao", label: "Não atende fora da região definida" },
  { value: "nao_faz_obra_entorno", label: "Não faz a obra estética completa do entorno" },
  { value: "nao_passa_preco_sem_contexto", label: "Não passa preço sem entender o caso" },
  { value: "depende_avaliacao_tecnica", label: "Alguns casos dependem de avaliação técnica" },
  { value: "prazos_podem_variar", label: "Prazos podem variar conforme o projeto" },
];

const STORE_OFFERED_PRODUCT_OPTIONS: Option[] = [
  { value: "piscinas", label: "Piscinas" },
  { value: "quimicos", label: "Produtos químicos" },
  { value: "acessorios", label: "Acessórios" },
  { value: "equipamentos", label: "Equipamentos" },
  { value: "pecas_componentes", label: "Peças e componentes" },
  { value: "outro", label: "Outros produtos" },
];

const STORE_OFFERED_SERVICE_OPTIONS: Option[] = [
  { value: "instalacao_piscina", label: "Instalação de piscina nova" },
  { value: "troca_piscina", label: "Troca / substituição de piscina" },
  { value: "instalacao_equipamentos", label: "Instalação de equipamentos" },
  { value: "troca_equipamentos", label: "Troca de equipamentos" },
  { value: "limpeza_manutencao", label: "Limpeza / manutenção de piscina" },
  { value: "servico_tecnico", label: "Assistência / serviço técnico" },
  { value: "visita_tecnica", label: "Visita técnica" },
  { value: "outro", label: "Outros serviços" },
];

const COMMERCIAL_SELL_MORE_OPTIONS: Option[] = [
  { value: "piscinas", label: "Piscinas" },
  { value: "acessorios", label: "Acessórios e equipamentos" },
  { value: "quimicos", label: "Produtos químicos" },
  { value: "servicos", label: "Serviços técnicos e manutenção" },
  { value: "troca_equipamentos", label: "Troca / substituição de equipamentos" },
  { value: "sem_prioridade", label: "Não existe uma prioridade específica" },
  { value: "outro", label: "Outro" },
];

const COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS: Option[] = [
  { value: "maior_valor", label: "Vendas de maior valor" },
  { value: "piscina_com_instalacao", label: "Piscina com instalação" },
  { value: "varios_itens_servicos", label: "Venda com vários itens ou serviços juntos" },
  { value: "venda_rapida_produto", label: "Venda rápida de produto" },
  { value: "cliente_recorrente", label: "Venda para cliente recorrente" },
  { value: "servico_tecnico_manutencao", label: "Serviços técnicos e manutenção" },
  { value: "sem_prioridade", label: "Não existe uma prioridade específica" },
  { value: "outro", label: "Outro tipo de negócio" },
];

const COMMERCIAL_AVOID_CASE_OPTIONS: Option[] = [
  { value: "conflitos_repetidos", label: "Cliente cria conflitos ou problemas repetidamente" },
  { value: "muitas_idas_voltas", label: "Cliente muda o que quer muitas vezes e gera muitas idas e vindas" },
  { value: "excecoes_fora_regras", label: "Cliente exige muitas exceções fora das regras da loja" },
  { value: "insiste_condicoes_nao_oferecidas", label: "Cliente insiste em condições que a loja não oferece" },
  { value: "servico_nao_executado", label: "Cliente quer um serviço que a loja não executa" },
  { value: "esforco_desproporcional", label: "Atendimento exige esforço muito desproporcional à oportunidade" },
  { value: "agressivo_desrespeitoso", label: "Cliente é agressivo ou desrespeitoso com a equipe" },
  { value: "nenhum", label: "Não existe nenhum caso específico" },
  { value: "outro", label: "Outro tipo de atendimento ou negócio" },
];

const COMMERCIAL_AVOID_ACTION_OPTIONS: Option[] = [
  { value: "nao_insistir_seguir_educadamente", label: "Não insistir na venda e seguir educadamente" },
  { value: "chamar_humano_antes_avancar", label: "Chamar uma pessoa da loja antes de avançar" },
  { value: "sinalizar_internamente_continuar", label: "Sinalizar internamente e continuar normalmente" },
];

const COMMERCIAL_SALE_VALUE_OPTIONS: Option[] = [
  { value: "ate_1000", label: "Até R$ 1.000" },
  { value: "1000_5000", label: "R$ 1.000 a R$ 5.000" },
  { value: "5000_10000", label: "R$ 5.000 a R$ 10.000" },
  { value: "10000_20000", label: "R$ 10.000 a R$ 20.000" },
  { value: "20000_50000", label: "R$ 20.000 a R$ 50.000" },
  { value: "acima_50000", label: "Acima de R$ 50.000" },
  { value: "varia_muito", label: "Varia muito conforme a venda" },
  { value: "outra", label: "Quero informar outra faixa" },
];

const POOL_MARKET_BRAND_OPTIONS: Option[] = [
  { value: "iGUi", label: "iGUi" },
  { value: "Henrimar", label: "Henrimar" },
  { value: "Fiber", label: "Fiber" },
  { value: "Fibratec", label: "Fibratec" },
  { value: "Sodramar", label: "Sodramar" },
  { value: "Nautilus", label: "Nautilus" },
  { value: "Jacuzzi", label: "Jacuzzi" },
  { value: "Dancor", label: "Dancor" },
  { value: "Syllent", label: "Syllent" },
  { value: "Pooltec", label: "Pooltec" },
  { value: "AstralPool", label: "AstralPool" },
  { value: "Veico", label: "Veico" },
  { value: "Albacete", label: "Albacete" },
  { value: "Panozon", label: "Panozon" },
  { value: "Sibrape / Pentair", label: "Sibrape / Pentair" },
  { value: "HTH", label: "HTH" },
  { value: "Genco", label: "Genco" },
  { value: "Hidroall", label: "Hidroall" },
  { value: "Maresias", label: "Maresias" },
  { value: "CTX Professional", label: "CTX Professional" },
  { value: "outro", label: "Outra marca" },
];

const STRATEGY_SERVICE_TO_OFFERING: Record<
  string,
  { key: "offering_products" | "offering_services"; value: string }
> = {
  venda_piscinas: { key: "offering_products", value: "piscinas" },
  venda_produtos_quimicos: { key: "offering_products", value: "quimicos" },
  venda_acessorios: { key: "offering_products", value: "acessorios" },
  instalacao_piscinas: { key: "offering_services", value: "instalacao_piscina" },
  visita_tecnica: { key: "offering_services", value: "visita_tecnica" },
  manutencao: { key: "offering_services", value: "limpeza_manutencao" },
};

const OFFERING_TO_STRATEGY_SERVICE: Record<string, string> = Object.fromEntries(
  Object.entries(STRATEGY_SERVICE_TO_OFFERING).map(([strategyValue, offering]) => [
    `${offering.key}:${offering.value}`,
    strategyValue,
  ]),
);

const COMMERCIAL_SUGGESTION_TYPE_OPTIONS: Option[] = [
  { value: "piscinas", label: "Piscinas" },
  { value: "acessorios", label: "Acessórios" },
  { value: "quimicos", label: "Produtos químicos" },
  { value: "equipamentos", label: "Equipamentos" },
  { value: "outros_catalogo", label: "Outros produtos do catálogo" },
  { value: "servicos", label: "Serviços relacionados" },
  { value: "outro", label: "Outro tipo de sugestão" },
];

const CATALOG_BACKED_SUGGESTION_TYPES = [
  "piscinas",
  "acessorios",
  "quimicos",
  "equipamentos",
  "outros_catalogo",
] as const;

const PAYMENT_BLOCKING_ACTION_OPTIONS: Option[] = [
  { value: "agendar_instalacao", label: "Agendar instalação" },
  { value: "iniciar_instalacao", label: "Iniciar instalação" },
  { value: "liberar_entrega", label: "Liberar entrega" },
  { value: "liberar_retirada", label: "Liberar retirada" },
  { value: "concluir_venda", label: "Concluir a venda" },
  { value: "nenhuma", label: "Nenhuma dessas ações é bloqueada automaticamente" },
  { value: "outro", label: "Outra ação" },
];

const POST_SALE_CHECK_OPTIONS: Option[] = [
  { value: "satisfacao", label: "Se o cliente ficou satisfeito" },
  { value: "produto_funciona", label: "Se o produto está funcionando corretamente" },
  { value: "instalacao_ok", label: "Se a instalação ficou correta" },
  { value: "orientacao_uso", label: "Se precisa de orientação de uso" },
  { value: "manutencao", label: "Se precisa de produtos de manutenção" },
  { value: "problema", label: "Se existe algum problema a resolver" },
  { value: "outro", label: "Outro ponto" },
];

const WARRANTY_ITEM_OPTIONS: Option[] = [
  { value: "piscina", label: "Piscina" },
  { value: "instalacao", label: "Instalação" },
  { value: "equipamentos", label: "Equipamentos" },
  { value: "produtos", label: "Produtos" },
  { value: "servicos", label: "Serviços técnicos" },
  { value: "outro", label: "Outro" },
];


const CANCELLATION_RULE_SITUATION_OPTIONS: Option[] = [
  { value: "after_contract", label: "Depois que o contrato já foi assinado" },
  { value: "ordered_product", label: "Depois que o produto já foi encomendado ao fornecedor" },
  { value: "custom_order", label: "Produto sob encomenda ou personalizado" },
  { value: "after_delivery", label: "Depois da entrega ou retirada" },
  { value: "service_started", label: "Instalação ou serviço já iniciado" },
  { value: "charge_or_retention", label: "Multa, cobrança ou retenção previamente prevista" },
  { value: "refund", label: "Regra própria de reembolso" },
  { value: "other", label: "Outra situação" },
];

const CONTRACT_APPLICABILITY_CASE_OPTIONS: Option[] = [
  { value: "piscina", label: "Venda de piscina" },
  { value: "instalacao", label: "Venda com instalação" },
  { value: "servico", label: "Serviço técnico / manutenção" },
  { value: "sob_encomenda", label: "Produto sob encomenda ou personalizado" },
  { value: "financiamento", label: "Venda com financiamento" },
  { value: "alto_valor", label: "Venda acima de determinado valor" },
  { value: "outro", label: "Outra situação" },
];

const CONTRACT_FORMAT_OPTIONS: Option[] = [
  { value: "digital", label: "Digital / virtual" },
  { value: "fisico", label: "Físico / impresso" },
];

const CONTRACT_SIGNED_BEFORE_OPTIONS: Option[] = [
  { value: "encomendar", label: "Encomendar produto ao fornecedor" },
  { value: "agendar_instalacao", label: "Agendar instalação" },
  { value: "iniciar_instalacao", label: "Iniciar instalação ou serviço" },
  { value: "entrega", label: "Liberar entrega" },
  { value: "retirada", label: "Liberar retirada" },
  { value: "outro", label: "Outro momento" },
];

const PAYMENT_METHOD_MAIN_OPTIONS: Option[] = [
  { value: "pix", label: "Pix" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
  { value: "financiamento", label: "Financiamento" },
];

const PRICE_DIRECT_BEFORE_OPTIONS: Option[] = [
  { value: "so_apos_entender_objetivo", label: "Só depois de entender o que o cliente quer" },
  { value: "so_apos_identificar_interesse_real", label: "Só depois de perceber interesse real" },
  { value: "so_apos_entender_tipo", label: "Só depois de entender o tipo de piscina ou produto" },
  { value: "so_apos_entender_medidas", label: "Só depois de entender medidas ou porte do projeto" },
  { value: "so_apos_entender_instalacao", label: "Só depois de entender se precisa instalação" },
];

const HUMAN_HELP_DISCOUNT_OPTIONS: Option[] = [
  { value: "pediu_desconto_maior", label: "Pediu desconto maior que o permitido" },
  { value: "quer_condicao_especial", label: "Quer condição especial" },
  { value: "fechamento_imediato", label: "Cliente quer fechar agora" },
  { value: "cliente_importante", label: "Cliente com alto potencial de fechar" },
];

const HUMAN_HELP_CUSTOM_PROJECT_OPTIONS: Option[] = [
  { value: "projeto_fora_padrao", label: "Projeto fora do padrão" },
  { value: "terreno_dificil", label: "Local ou terreno com dificuldade" },
  { value: "duvida_tecnica_complexa", label: "Dúvida técnica complexa" },
  { value: "pedido_muito_personalizado", label: "Pedido muito personalizado" },
  { value: "obra_complementar", label: "Pedido com obra extra além da piscina" },
];

const HUMAN_HELP_PAYMENT_OPTIONS: Option[] = [
  { value: "parcelamento_diferente", label: "Parcelamento diferente do padrão" },
  { value: "financiamento_especifico", label: "Pedido de financiamento específico" },
  { value: "prazo_especial", label: "Prazo especial de pagamento" },
  { value: "comprovante_pagamento", label: "Validação manual de pagamento" },
];

const RESPONSIBLE_NOTIFICATION_CASE_OPTIONS: Option[] = [
  { value: "pedido_desconto", label: "Pedido de desconto" },
  { value: "cliente_quase_fechando", label: "Cliente com alta chance de fechar" },
  { value: "duvida_tecnica", label: "Dúvida técnica importante" },
  { value: "pedido_visita", label: "Pedido de visita técnica" },
  { value: "pedido_instalacao", label: "Pedido de instalação" },
  { value: "problema_pagamento", label: "Problema de pagamento" },
];

const ACTIVATION_STYLE_OPTIONS: Option[] = [
  { value: "ia_direta", label: "Mais direta" },
  { value: "ia_humanizada", label: "Mais humana" },
  { value: "priorizar_qualificacao", label: "Priorizar qualificação antes de preço" },
  { value: "priorizar_agendamento", label: "Priorizar visita ou agendamento" },
];

const ACTIVATION_GUARDRAIL_OPTIONS: Option[] = [
  { value: "nao_prometer_fora_escopo", label: "Nunca prometer fora do escopo" },
  { value: "encaminhar_humano_casos_criticos", label: "Chamar humano em casos críticos" },
];

const LEGACY_PAYMENT_CONDITION_OPTIONS: Option[] = [
  { value: "parcelado", label: "Parcelado" },
  { value: "a_vista", label: "À vista" },
  { value: "sinal_mais_parcelas", label: "Sinal + parcelas" },
  { value: "sob_analise", label: "Sob análise" },
];

const PIX_KEY_TYPE_OPTIONS: Option[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatoria" },
];

const DOWN_PAYMENT_MODE_OPTIONS: Option[] = [
  { value: "none", label: "Não exige entrada" },
  { value: "optional", label: "Depende da venda" },
  { value: "required", label: "Sim, a entrada é obrigatória" },
];

const DOWN_PAYMENT_VALUE_TYPE_OPTIONS: Option[] = [
  { value: "percent", label: "Percentual da venda" },
  { value: "fixed", label: "Valor fixo" },
  { value: "case_by_case", label: "Varia conforme a venda" },
];

const INSTALLMENT_INTEREST_POLICY_OPTIONS: Option[] = [
  { value: "interest_free", label: "Sem juros" },
  { value: "with_interest", label: "Com juros" },
  { value: "case_by_case", label: "Juros caso a caso" },
];

const PRICE_TALK_MODE_OPTIONS: Option[] = [
  { value: "quando_cliente_perguntar", label: "Quando o cliente perguntar" },
  { value: "so_quando_fizer_sentido", label: "Só quando fizer sentido" },
  { value: "com_contexto_antes", label: "Primeiro com contexto, depois preço" },
];

const PRICE_ANSWER_POLICY_OPTIONS: Option[] = [
  { value: "direct_when_asked", label: "Informar o preço quando existir um preço confiável no catálogo" },
  { value: "range_only_when_asked", label: "Informar apenas uma faixa de preço" },
  { value: "human_required_for_price", label: "Chamar uma pessoa da loja antes de informar preço" },
];

const PRICE_CONTEXT_REQUIREMENT_OPTIONS: Option[] = [
  { value: "need_summary", label: "Entender a necessidade ou o objetivo do cliente" },
  { value: "interested_product_reference", label: "Saber qual produto ou tipo o cliente procura" },
  { value: "space_or_measurements", label: "Entender o espaço ou as medidas" },
  { value: "installation_scope", label: "Saber se a venda inclui instalação" },
];

const SALES_FLOW_FINAL_OPTIONS: Option[] = [
  { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
  { value: "instalacao", label: "Instalação" },
  { value: "entrega_final", label: "Entrega final" },
  { value: "pos_venda", label: "Pós-venda" },
];


function normalizeCategory(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";
  return "outros";
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function statusToneClass(tone: StatusTone) {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  if (tone === "blue") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function resolveOnboardingLabel(status: string | null | undefined) {
  const normalized = String(status || "not_started").trim().toLowerCase();
  if (normalized === "completed") return { label: "Concluído", tone: "green" as const };
  if (normalized === "in_progress") return { label: "Em andamento", tone: "amber" as const };
  return { label: "Não iniciado", tone: "red" as const };
}

function buildStoreName(activeStore: unknown) {
  const store = (activeStore || {}) as Record<string, unknown>;
  return (
    String(
      store.store_display_name ||
        store.display_name ||
        store.name ||
        store.store_name ||
        "Loja ativa"
    ).trim() || "Loja ativa"
  );
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function onlyCepDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 8);
}

function formatBrazilianCepInput(value: unknown) {
  const digits = onlyCepDigits(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function isValidCustomerVisitMode(value: unknown) {
  return ["sem_agendamento", "com_agendamento", "nao_recebe_clientes"].includes(
    cleanText(value),
  );
}

function isGeneralAddressComplete(address: GeneralAddressDraftState) {
  if (address.has_public_address === "Não") return true;
  if (address.has_public_address !== "Sim") return false;

  return Boolean(
    cleanText(address.street) &&
      cleanText(address.number) &&
      cleanText(address.district) &&
      cleanText(address.city) &&
      cleanText(address.state) &&
      isValidCustomerVisitMode(address.customer_visit_mode),
  );
}

function formatMonthlyGoalDraftAmount(value: number | null | undefined) {
  if (value == null || value <= 0) return "";
  return String(Math.round(value / 100));
}

function parseMonthlyGoalDraftAmount(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount > 0 ? amount * 100 : null;
}

function normalizeMonthlySalesGoalApiValue(value: unknown) {
  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

  if (record && "enabled" in record) {
    return normalizeMonthlySalesGoalInput({
      enabled: record.enabled === true,
      amountCents:
        typeof record.amountCents === "number" ? record.amountCents : null,
    });
  }

  return normalizeStoreMonthlySalesGoalRow(
    value as StoreMonthlySalesGoalRow | null,
  );
}

function buildImportFileKey(file: StoreImportFileRow, index: number) {
  const key = [
    file.id,
    file.storage_path,
    file.original_file_name,
    file.created_at,
    file.updated_at,
    file.size_bytes,
    index,
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .join("-");

  return key || `catalog-imported-file-${index}`;
}

function summarizeMetricText(value: unknown, maxLength = 72) {
  const normalized = cleanText(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}


function formatFileSize(sizeBytes: number | null | undefined) {
  if (!sizeBytes || sizeBytes <= 0) return "Tamanho não definido";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatImportDate(value: string | null | undefined) {
  if (!value) return "Data não definida";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Data não definida";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function resolveStoreWhatsappVisualStatus(status: StoreWhatsappStatusApiResponse | null) {
  const normalizedStatus = cleanText(status?.status).toLowerCase();

  if (status?.connected && status?.isActive && normalizedStatus === "active") {
    return { label: "Conectado", tone: "green" as const };
  }

  if (!status?.connected || normalizedStatus === "error" || normalizedStatus === "failed") {
    return { label: "Erro", tone: "red" as const };
  }

  return { label: "Desconectado", tone: "gray" as const };
}

function resolveHumanReadableWhatsappSafeError(value: string | null | undefined) {
  const normalized = cleanText(value);
  if (!normalized) return "";
  if (normalized === "status_message_not_found_by_external_message_id") {
    return "O detalhamento do ultimo status ainda nao ficou disponivel na integracao.";
  }
  if (/^[a-z0-9_]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function resolveResponsibleChannelLabel(value: string | null | undefined) {
  const responsibleName = cleanText(value);
  return responsibleName ? `Canal de ${responsibleName}` : "Canal do responsavel";
}

function resolveContractVersionStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "draft") return { label: "Sem envio", tone: "gray" as const };
  if (normalized === "uploaded") return { label: "Enviado", tone: "gray" as const };
  if (normalized === "analyzing") return { label: "Analisando", tone: "amber" as const };
  if (normalized === "analyzed") return { label: "Analisado", tone: "gray" as const };
  if (normalized === "awaiting_review") {
    return { label: "Aguardando revisao", tone: "amber" as const };
  }
  if (normalized === "approved") return { label: "Aprovado", tone: "green" as const };
  if (normalized === "active") return { label: "Ativo", tone: "green" as const };
  if (normalized === "rejected") return { label: "Rejeitado", tone: "red" as const };
  if (normalized === "archived") return { label: "Arquivado", tone: "gray" as const };
  if (normalized === "failed") return { label: "Falhou", tone: "red" as const };
  return { label: "Nao definido", tone: "gray" as const };
}

function maskSensitiveContractPreview(value: string | null | undefined) {
  const normalized = String(value || "");
  if (!normalized.trim()) return "";

  return normalized
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "***.***.***-**")
    .replace(/\b\d{11}\b/g, "***********")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "**.***.***/****-**")
    .replace(/\b(?:RG|Rg|rg)\s*[:\-]?\s*\d[\d.\-]*\b/g, "RG oculto")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email oculto]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})-?\d{4}\b/g, "[telefone oculto]")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[data oculta]")
    .replace(/\b(?:RUA|AVENIDA|AV\.|ALAMEDA|TRAVESSA|ESTRADA)\b[\s\S]{0,80}?\d{1,5}/gi, "[endereco oculto]");
}

function renderHighlightedContractText(
  value: string,
  query: string,
  activeMatchIndex: number | null = null,
) {
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) return value;

  const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(${escapedQuery})`, "gi");
  const exactMatcher = new RegExp(`^${escapedQuery}$`, "i");
  let matchIndex = 0;

  return value.split(matcher).map((part, index) => {
    if (!exactMatcher.test(part)) return part;

    const currentMatchIndex = matchIndex;
    matchIndex += 1;
    const isActiveMatch = activeMatchIndex === currentMatchIndex;

    return (
      <mark
        key={`${part}-${index}`}
        data-contract-search-match-index={currentMatchIndex}
        data-contract-current-search-target={isActiveMatch ? "true" : undefined}
        className={`rounded px-0.5 text-gray-950 transition ${
          isActiveMatch
            ? "bg-amber-400 ring-2 ring-amber-500/40"
            : "bg-amber-200"
        }`}
      >
        {part}
      </mark>
    );
  });
}

function summarizeContractUiText(value: string | null | undefined, maxLength = 180) {
  const masked = maskSensitiveContractPreview(value);
  const normalized = cleanText(masked);
  if (!normalized) return "Nenhum resumo disponivel.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function resolveContractRuleStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") {
    return { label: "Aprovada", tone: "green" as const };
  }
  if (normalized === "rejected") {
    return { label: "Ignorada", tone: "red" as const };
  }
  if (normalized === "edited") {
    return { label: "Ajustada", tone: "amber" as const };
  }
  return { label: "Aguardando revisao", tone: "amber" as const };
}

function normalizeContractReviewStatus(status: string | null | undefined) {
  return cleanText(status).toLowerCase();
}

function normalizeContractVersionStatusValue(status: string | null | undefined) {
  return cleanText(status).toLowerCase();
}

function isFinalContractRuleReviewStatus(status: string): status is ContractRuleReviewStatus {
  return status === "approved" || status === "rejected" || status === "edited";
}

function isMutableStoreContractVersion({
  version,
  isActiveVersion,
}: {
  version: StoreContractTemplateVersionRow | null | undefined;
  isActiveVersion: boolean;
}) {
  if (!version || isActiveVersion || version.rejected_at) return false;

  const normalizedStatus = normalizeContractVersionStatusValue(version.status);
  return ["uploaded", "failed", "analyzed", "awaiting_review"].includes(normalizedStatus);
}

function canAnalyzeStoreContractVersion({
  version,
  isActiveVersion,
  hasReadText,
}: {
  version: StoreContractTemplateVersionRow | null | undefined;
  isActiveVersion: boolean;
  hasReadText: boolean;
}) {
  if (isActiveVersion) return false;
  if (!isMutableStoreContractVersion({ version, isActiveVersion })) return false;

  const normalizedStatus = normalizeContractVersionStatusValue(version?.status);
  return normalizedStatus === "uploaded" || normalizedStatus === "failed";
}

function canExtractRulesForStoreContractVersion({
  version,
  versionRules,
  isActiveVersion,
  hasReadText,
}: {
  version: StoreContractTemplateVersionRow | null | undefined;
  versionRules: StoreContractTemplateExtractedRuleRow[];
  isActiveVersion: boolean;
  hasReadText: boolean;
}) {
  if (!hasReadText || versionRules.length > 0) return false;
  if (!isMutableStoreContractVersion({ version, isActiveVersion })) return false;

  const normalizedStatus = normalizeContractVersionStatusValue(version?.status);
  return normalizedStatus === "analyzed" || normalizedStatus === "awaiting_review";
}

function canReviewRulesForStoreContractVersion({
  version,
  isActiveVersion,
}: {
  version: StoreContractTemplateVersionRow | null | undefined;
  isActiveVersion: boolean;
}) {
  if (!isMutableStoreContractVersion({ version, isActiveVersion })) return false;

  const normalizedStatus = normalizeContractVersionStatusValue(version?.status);
  return normalizedStatus === "analyzed" || normalizedStatus === "awaiting_review";
}

function canApproveStoreContractVersion({
  version,
  versionRules,
  isActiveVersion,
}: {
  version: StoreContractTemplateVersionRow | null | undefined;
  versionRules: StoreContractTemplateExtractedRuleRow[];
  isActiveVersion: boolean;
}) {
  if (!version) return false;

  const normalizedStatus = normalizeContractVersionStatusValue(version.status);
  if (isActiveVersion || normalizedStatus === "rejected" || version.rejected_at) return false;
  if (!["analyzed", "awaiting_review"].includes(normalizedStatus)) return false;
  if (versionRules.length === 0) return false;

  return versionRules.every((rule) =>
    isFinalContractRuleReviewStatus(normalizeContractReviewStatus(rule.review_status))
  );
}

function resolveContractRuleGroupLabel(group: string | null | undefined) {
  const normalized = String(group || "").trim().toLowerCase();
  if (normalized === "partes") return "Partes";
  if (normalized === "objeto") return "Objeto";
  if (normalized === "pagamento") return "Pagamento";
  if (normalized === "instalacao") return "Entrega e instalacao";
  if (normalized === "obrigacoes_cliente") return "Obrigacoes do cliente";
  if (normalized === "obrigacoes_loja") return "Obrigacoes da loja";
  if (normalized === "garantia") return "Garantia";
  if (normalized === "rescisao") return "Rescisao";
  if (normalized === "foro") return "Foro";
  if (normalized === "imagem") return "Uso de imagem";
  return "Regra";
}

function getImportSummaryText(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== "object") return "Resumo não disponível";
  const totalFiles = Number(summary.totalFiles ?? 0);
  const normalizedItems = Number(summary.normalizedItems ?? 0);
  const extractedImages = Number(summary.extractedImages ?? 0);
  const parts: string[] = [];
  if (totalFiles > 0) parts.push(`${totalFiles} arquivo(s)`);
  if (normalizedItems > 0) parts.push(`${normalizedItems} item(ns)`);
  if (extractedImages > 0) parts.push(`${extractedImages} imagem(ns)`);
  return parts.length > 0 ? parts.join(" • ") : "Resumo não disponível";
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage setItem error:", error);
  }
}

function readFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage getItem error:", error);
    return null;
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage removeItem error:", error);
  }
}



function createEmptyPoolForm(): PoolFormState {
  return {
    name: "",
    brand: "",
    material: "",
    shape: "",
    color: "",
    finish: "",
    width_m: "",
    length_m: "",
    depth_m: "",
    price: "",
    stock_quantity: "",
    description: "",
    included_items: "",
    installation_notes: "",
    application: "",
    technical_notes: "",
    is_active: true,
    track_stock: true,
  };
}

function createEmptyCatalogForm(): CatalogFormState {
  return {
    category: "quimicos",
    name: "",
    sku: "",
    brand: "",
    line: "",
    unit_label: "",
    size_details: "",
    width_cm: "",
    height_cm: "",
    length_cm: "",
    weight_kg: "",
    price: "",
    stock_quantity: "",
    description: "",
    application: "",
    technical_notes: "",
    is_active: true,
    track_stock: true,
  };
}


function createEmptyResponsibleDraft(isPrimary = false): ResponsiblePersonDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: "",
    whatsapp: "",
    role: isPrimary ? "Responsável principal" : "",
    receives_ai_alerts: true,
    can_approve_discount: isPrimary,
    can_approve_exceptions: isPrimary,
    can_assume_human: isPrimary,
    notes: "",
  };
}

function createPrimaryResponsibleDraftFromSources(
  answers: AnswersMap,
  responsible: CanonicalPrimaryResponsible | null,
): ResponsiblePersonDraft {
  return {
    id: "principal",
    name: cleanText(responsible?.name),
    whatsapp: cleanText(responsible?.whatsappNumber),
    role:
      cleanText(responsible?.role) ||
      cleanText(answers.responsible_role) ||
      "ResponsÃ¡vel principal",
    receives_ai_alerts: yesNoLabel(answers.ai_should_notify_responsible) !== "NÃ£o",
    can_approve_discount: true,
    can_approve_exceptions: true,
    can_assume_human: true,
    notes: cleanText(answers.responsible_notes),
  };
}

function parseResponsiblePeopleFromAnswers(answers: AnswersMap): ResponsiblePersonDraft[] {
  const raw = (answers as Record<string, unknown>).additional_responsibles;
  let parsed: unknown[] = [];
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const json = JSON.parse(raw);
      if (Array.isArray(json)) parsed = json;
    } catch {}
  }

  return parsed
    .map((item, index) => {
      const row = (item || {}) as Record<string, unknown>;
      const name = cleanText(row.name);
      const whatsapp = cleanText(row.whatsapp);
      if (!name && !whatsapp) return null;
      return {
        id: cleanText(row.id) || `resp-${index + 1}`,
        name,
        whatsapp,
        role: cleanText(row.role),
        receives_ai_alerts: Boolean(row.receives_ai_alerts),
        can_approve_discount: Boolean(row.can_approve_discount),
        can_approve_exceptions: Boolean(row.can_approve_exceptions),
        can_assume_human: Boolean(row.can_assume_human),
        notes: cleanText(row.notes),
      } satisfies ResponsiblePersonDraft;
    })
    .filter(Boolean) as ResponsiblePersonDraft[];
}

function serializeResponsiblePeople(items: ResponsiblePersonDraft[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      name: cleanText(item.name),
      whatsapp: cleanText(item.whatsapp),
      role: cleanText(item.role),
      receives_ai_alerts: item.receives_ai_alerts,
      can_approve_discount: item.can_approve_discount,
      can_approve_exceptions: item.can_approve_exceptions,
      can_assume_human: item.can_assume_human,
      notes: cleanText(item.notes),
    }))
  );
}

const CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL = "Não definido";

function normalizeLoose(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function deriveCanonicalWeekendAvailabilityLabel(
  day: "sabado" | "domingo",
  scheduleSettings?: ScheduleSettingsRow | null,
) {
  if (scheduleSettings) {
    const availability = deriveWeekendAvailabilityFromOperatingDays(
      scheduleSettings.operating_days,
    );
    return day === "sabado"
      ? availability.serves_saturday
      : availability.serves_sunday;
  }

  return CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL;
}

function createOperationDraftFromAnswers(
  answers: AnswersMap,
  scheduleSettings?: ScheduleSettingsRow | null,
  operationSettings?: StoreOperationSettingsRow | null,
): OperationDraftState {
  const operationInput = createStoreOperationSettingsInputFromSources({
    answers,
    settings: operationSettings,
  });
  const operatingDaysFromSettings = Array.isArray(scheduleSettings?.operating_days)
    ? (scheduleSettings?.operating_days as unknown[]).map((item) => cleanText(item)).filter(Boolean).join(", ")
    : "";

  const operatingHoursFromSettings =
    scheduleSettings?.operating_hours && typeof scheduleSettings.operating_hours === "object"
      ? JSON.stringify(scheduleSettings.operating_hours)
      : "";
  const humanScheduleConfigured = isConfiguredTimestamp(
    scheduleSettings?.human_schedule_configured_at,
  );
  const agendaCapacityConfigured = isConfiguredTimestamp(
    scheduleSettings?.agenda_capacity_configured_at,
  );

  return {
    operating_days: operatingDaysFromSettings,
    operating_hours: operatingHoursFromSettings,
    installation_days_rule: operationInput.installationDaysRule,
    technical_visit_days_rule: operationInput.technicalVisitDaysRule,
    serves_saturday: deriveCanonicalWeekendAvailabilityLabel("sabado", scheduleSettings),
    serves_sunday: deriveCanonicalWeekendAvailabilityLabel("domingo", scheduleSettings),
    serves_holiday:
      humanScheduleConfigured && cleanText(scheduleSettings?.holiday_mode)
        ? optionLabel(toUiHolidayMode(scheduleSettings?.holiday_mode), [
            { value: "fechado", label: "NÃ£o" },
            { value: "normal", label: "Sim" },
            { value: "especial", label: "Sim" },
            { value: "caso_a_caso", label: "Caso a caso" },
          ])
        : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL,
    allow_multiple_appointments_per_day:
      agendaCapacityConfigured && typeof scheduleSettings?.allow_multiple_appointments_per_day === "boolean"
        ? yesNoLabel(scheduleSettings.allow_multiple_appointments_per_day)
        : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL,
    allow_same_time_appointments:
      agendaCapacityConfigured && typeof scheduleSettings?.allow_same_time_appointments === "boolean"
        ? yesNoLabel(scheduleSettings.allow_same_time_appointments)
        : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL,
    offers_installation: yesNoLabel(operationInput.offersInstallation),
    average_installation_time_days: operationInput.averageInstallationTimeDays == null ? "" : String(operationInput.averageInstallationTimeDays),
    installation_process_summary: operationInput.installationProcessNotes,
    offers_technical_visit: yesNoLabel(operationInput.offersTechnicalVisit),
    technical_visit_rules_selected: operationInput.technicalVisitRules,
    technical_visit_rules_other: operationInput.technicalVisitRulesOther,
    agenda_capacity_rule:
      agendaCapacityConfigured && Number.isFinite(Number(scheduleSettings?.same_time_capacity))
        ? String(scheduleSettings?.same_time_capacity)
        : "",
  };
}

function restoreOperationDraftWithoutScheduleAuthority(
  current: OperationDraftState,
  persisted: Partial<OperationDraftState>,
) {
  const normalized = normalizePersistedOperationDraft(current, persisted);
  return {
    ...normalized,
    serves_holiday: current.serves_holiday,
    allow_multiple_appointments_per_day:
      current.allow_multiple_appointments_per_day,
    allow_same_time_appointments: current.allow_same_time_appointments,
    agenda_capacity_rule: current.agenda_capacity_rule,
  };
}


function createCommercialDraftFromAnswers(answers: AnswersMap): any {
  const paymentMain = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    PAYMENT_METHOD_MAIN_OPTIONS
  );
  const paymentConditions = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    LEGACY_PAYMENT_CONDITION_OPTIONS
  );
  const priceBefore = joinSelectedLabels(
    parseArrayAnswer(answers.price_must_understand_before),
    PRICE_DIRECT_BEFORE_OPTIONS,
    cleanText(answers.price_direct_rule_other)
  );
  const humanHelp = [
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_discount_cases_selected),
      HUMAN_HELP_DISCOUNT_OPTIONS,
      cleanText(answers.human_help_discount_cases_other)
    ),
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_custom_project_cases_selected),
      HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
      cleanText(answers.human_help_custom_project_cases_other)
    ),
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_payment_cases_selected),
      HUMAN_HELP_PAYMENT_OPTIONS,
      cleanText(answers.human_help_payment_cases_other)
    ),
  ].filter(Boolean).join(" • ");

  const tone = joinSelectedLabels(
    parseArrayAnswer(answers.activation_preferences),
    [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
    cleanText(answers.activation_preferences_other)
  );

  return {
    ai_display_name: cleanText(answers.store_display_name),
    ai_presentation_mode: "Não definido",
    ai_tone_summary: tone || "Ainda não definido",
    ai_speaks_as: cleanText(answers.ai_identity_mode) || "Equipe da loja",
    can_send_price_directly: yesNoLabel(answers.ai_can_send_price_directly),
    price_before_summary: priceBefore || cleanText(answers.price_direct_rule_other) || cleanText(answers.price_direct_rule) || "Ainda não definido",
    price_policy_summary: cleanText(answers.price_direct_rule) || cleanText(answers.price_direct_rule_other),
    human_help_summary: humanHelp || "Ainda não definido",
    payment_methods_summary: [paymentMain, paymentConditions].filter(Boolean).join(" • "),
    discount_policy_summary: `${yesNoLabel(answers.can_offer_discount)}${cleanText(answers.max_discount_percent) ? ` • máximo de ${cleanText(answers.max_discount_percent)}%` : ""}`,
    negotiation_rules_summary:
      joinSelectedLabels(parseArrayAnswer(answers.price_must_understand_before), PRICE_DIRECT_BEFORE_OPTIONS) ||
      cleanText(answers.price_direct_rule),
    promise_limits_summary: cleanText(answers.final_activation_notes) || cleanText(answers.store_description),
    post_sale_summary:
      joinSelectedLabels(parseArrayAnswer(answers.sales_flow_final_steps), SALES_FLOW_FINAL_OPTIONS, cleanText(answers.sales_flow_notes)) ||
      cleanText(answers.sales_flow_notes),
    after_hours_summary: cleanText(answers.after_hours_behavior) || "Fora do horário, a IA deve acolher, qualificar e alinhar próximo passo sem prometer execução imediata.",
    commercial_ai_summary: cleanText(answers.commercial_ai_summary) || cleanText(answers.price_direct_rule),
  };
}


function createCommercialDraftFromAnswersWithPaymentSettings(
  answers: AnswersMap,
  paymentSettings?: StorePaymentSettingsRow | null,
  discountSettings?: StoreDiscountSettingsRow | null,
  highValueDiscountSettings?: StoreHighValueDiscountSettingsRow | null,
  commercialAiSettings?: StoreCommercialAiSettingsRow | null,
  strategySettingsInput?: StoreStrategySettingsInput,
): CommercialDraftState {
  const baseDraft = createCommercialDraftFromAnswers(answers);
  const commercialAiSettingsInput =
    createStoreCommercialAiSettingsInputFromSources({
      answers,
      settings: commercialAiSettings ?? null,
    });
  const normalizedCommercialAiSettings =
    normalizeStoreCommercialAiSettingsInput(commercialAiSettingsInput);
  const commercialAiLegacyMirrors = normalizedCommercialAiSettings.ok
    ? deriveStoreCommercialAiLegacyMirrors(normalizedCommercialAiSettings.value)
    : null;
  const paymentPresentation = createStorePaymentPresentationFromSources({
    answers,
    settings: paymentSettings ?? null,
  });
  const discountPresentation = createStoreDiscountPresentationFromSources({
    answers,
    settings: discountSettings ?? null,
    highValueSettings: highValueDiscountSettings ?? null,
  });
  const paymentSettingsInput = createStorePaymentSettingsInputFromSources({
    answers,
    settings: paymentSettings ?? null,
  });

  return {
    ...baseDraft,
    ai_presentation_mode:
      cleanText(strategySettingsInput?.strategyAiPresentation) ||
      "Não definido",
    price_answer_policy: commercialAiSettingsInput.priceAnswerPolicy,
    price_context_requirements:
      commercialAiSettingsInput.priceContextRequirements,
    price_policy_summary:
      commercialAiLegacyMirrors?.price_direct_rule || baseDraft.price_policy_summary,
    payment_methods_summary: paymentPresentation.paymentSummary,
    accepted_payment_methods: paymentSettingsInput.acceptedPaymentMethods,
    legacy_payment_condition_tags: paymentPresentation.legacyPaymentConditionTags,
    pix_key_type: paymentSettingsInput.pixKeyType,
    pix_key: paymentSettingsInput.pixKey,
    pix_holder_name: paymentSettingsInput.pixHolderName,
    down_payment_mode: paymentSettingsInput.downPaymentMode,
    down_payment_value_type: paymentSettingsInput.downPaymentValueType,
    down_payment_percent: paymentSettingsInput.downPaymentPercent,
    down_payment_amount: paymentSettingsInput.downPaymentAmount,
    installments_enabled: paymentSettingsInput.installmentsEnabled,
    max_installments: paymentSettingsInput.maxInstallments,
    installment_interest_policy: paymentSettingsInput.installmentInterestPolicy,
    payment_notes: paymentSettingsInput.paymentNotes,
    discount_policy_summary:
      discountPresentation.policySummary || baseDraft.discount_policy_summary,
  };
}

function createDiscountDraftFromAnswers(
  answers: AnswersMap,
  discountSettings?: StoreDiscountSettingsRow | null,
  highValueDiscountSettings?: StoreHighValueDiscountSettingsRow | null,
): DiscountDraftState {
  const discountInput = createStoreDiscountSettingsInputFromSources({
    answers,
    settings: discountSettings ?? null,
    highValueSettings: highValueDiscountSettings ?? null,
  });
  const legacyDiscountExplanation =
    "A IA só deve trabalhar com desconto dentro do limite permitido pela loja. Quando o pedido sair da regra, ela deve acionar aprovação humana antes de confirmar qualquer condição especial.";
  const currentDiscountExplanation = cleanText(answers.discount_explanation);
  const safeDiscountExplanation =
    !currentDiscountExplanation ||
    currentDiscountExplanation === legacyDiscountExplanation
      ? "A política de desconto define os limites comerciais da loja. Quem pode conceder desconto dentro desses limites depende do modo de autonomia configurado. Quando a política ou o modo exigir, a IA deve obter aprovação humana antes de confirmar a concessão."
      : currentDiscountExplanation;

  return {
    default_discount_percent: discountInput.defaultDiscountPercent,
    max_discount_percent: discountInput.maxDiscountPercent,
    allow_ask_above_max_discount: discountInput.allowAskAboveMaxDiscount,
    discount_autonomy_mode: discountInput.discountAutonomyMode,
    high_value_enabled: discountInput.highValueEnabled,
    high_value_threshold_amount: discountInput.highValueThresholdAmount,
    high_value_discount_percent: discountInput.highValueDiscountPercent,
    human_help_discount_summary:
      [
        getStoreDiscountAutonomyModeLabel(discountInput.discountAutonomyMode),
        discountInput.maxDiscountPercent
          ? `Teto normal ${discountInput.maxDiscountPercent}%`
          : "",
        discountInput.allowAskAboveMaxDiscount
          ? "Acima do teto: consultar humano antes de confirmar."
          : "Acima do teto: não confirmar fora da política.",
        discountInput.highValueEnabled
          ? "Política de alto valor ativa."
          : "",
      ]
        .filter(Boolean)
        .join(" | "),
    discount_approver:
      cleanText(answers.discount_approver_name) ||
      cleanText(answers.responsible_name) ||
      "Não definido",
    special_discount_rules: discountInput.discountSpecialRules || "",
    discount_explanation: safeDiscountExplanation,
  };
}


function createChannelDraftFromSources(
  answers: AnswersMap,
  channelSettings?: StoreChannelSettingsRow | null,
  responsible?: CanonicalPrimaryResponsible | null,
): ChannelDraftState {
  const channelSettingsInput = createStoreChannelSettingsInputFromSources({
    answers,
    settings: channelSettings ?? null,
  });
  const commercialWhatsapp = cleanText(answers.commercial_whatsapp);
  const responsibleWhatsapp = cleanText(responsible?.whatsappNumber);
  const responsibleName = cleanText(responsible?.name);

  const draft: ChannelDraftState = {
    commercial_channel_name: channelSettingsInput.commercialChannelName,
    commercial_whatsapp: commercialWhatsapp,
    commercial_channel_active: cleanText(answers.commercial_channel_active) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_receives_real_clients: cleanText(answers.commercial_receives_real_clients) || (commercialWhatsapp ? "Sim" : "Não definido"),

    commercial_is_official_sales_channel: cleanText(answers.commercial_is_official_sales_channel) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_channel_type: cleanText(answers.commercial_channel_type) || "WhatsApp comercial da loja",
    commercial_entry_priority: cleanText(answers.commercial_entry_priority) || "Canal principal de entrada de clientes",
    commercial_human_handoff_enabled: cleanText(answers.commercial_human_handoff_enabled) || "Sim",
    commercial_channel_notes: cleanText(answers.commercial_channel_notes),

    responsible_channel_name: resolveResponsibleChannelLabel(responsibleName),
    responsible_whatsapp: responsibleWhatsapp,

    responsible_channel_active: cleanText(answers.responsible_channel_active) || (responsibleWhatsapp ? "Sim" : "Não definido"),
    responsible_channel_type: cleanText(answers.responsible_channel_type) || "WhatsApp do responsável",
    responsible_is_primary_alert_channel: cleanText(answers.responsible_is_primary_alert_channel) || "Sim",
    responsible_is_human_command_channel: cleanText(answers.responsible_is_human_command_channel) || "Sim",
    responsible_receives_ai_alerts: cleanText(answers.responsible_receives_ai_alerts) || "Sim",
    responsible_receives_reports: cleanText(answers.responsible_receives_reports) || "Sim",
    responsible_receives_urgencies: cleanText(answers.responsible_receives_urgencies) || "Sim",
    responsible_receives_visit_alerts: cleanText(answers.responsible_receives_visit_alerts) || "Sim",
    responsible_receives_payment_alerts: cleanText(answers.responsible_receives_payment_alerts) || "Sim",
    responsible_channel_notes: cleanText(answers.responsible_channel_notes),

    internal_chat_enabled: cleanText(answers.internal_chat_enabled) || "Sim",

    internal_chat_for_assistant: cleanText(answers.internal_chat_for_assistant) || "Sim",
    internal_chat_separate_from_inbox: cleanText(answers.internal_chat_separate_from_inbox) || "Sim",
    internal_chat_visible_to_team: cleanText(answers.internal_chat_visible_to_team) || "Sim",
    internal_chat_accepts_manual_commands: cleanText(answers.internal_chat_accepts_manual_commands) || "Sim",
    internal_chat_priority: cleanText(answers.internal_chat_priority) || "Canal secundário de apoio",
    internal_chat_notes: cleanText(answers.internal_chat_notes) || "Canal interno do painel para o responsável falar com a IA assistente sem misturar com clientes.",

    channels_are_separate: cleanText(answers.channels_are_separate) || "Sim",
    dedicated_number: cleanText(answers.dedicated_number) || commercialWhatsapp,
    telegram_future_status: cleanText(answers.telegram_future_status) || "Previsto para expansão futura",

    extra_channel_notes: cleanText(answers.extra_channel_notes),

    integration_provider_name: cleanText(answers.integration_provider_name) || "Ainda não definido",
    integration_connection_mode: cleanText(answers.integration_connection_mode) || "API / webhook",
    integration_test_status: cleanText(answers.integration_test_status) || "Ainda não testado nesta tela",
    webhook_inbound_status: cleanText(answers.webhook_inbound_status) || "Previsto no projeto",
    external_send_status: cleanText(answers.external_send_status) || "Previsto no projeto",
    integration_has_inbound_webhook: cleanText(answers.integration_has_inbound_webhook) || "Não definido",
    integration_has_status_webhook: cleanText(answers.integration_has_status_webhook) || "Não definido",
    integration_has_outbound_delivery: cleanText(answers.integration_has_outbound_delivery) || "Não definido",
    whatsapp_integration_status: cleanText(answers.whatsapp_integration_status) || (commercialWhatsapp ? "Base configurada" : "Pendente"),
    integrations_status: cleanText(answers.integrations_status) || resolveOnboardingLabel(cleanText(answers.integration_status_override) || cleanText(answers.onboarding_status_override)).label,
    integrations_notes: cleanText(answers.integrations_notes) || "As integrações devem respeitar a separação entre canal comercial da IA vendedora e canal do responsável para a IA assistente.",

    customer_messages_route: cleanText(answers.customer_messages_route) || "Mensagens de clientes entram pelo canal comercial da loja e seguem para a IA vendedora.",
    assistant_alerts_route: cleanText(answers.assistant_alerts_route) || "Avisos da assistente vão para o canal do responsável e também podem aparecer no chat interno.",
    urgency_route: cleanText(answers.urgency_route) || "Urgências e casos críticos devem priorizar o responsável principal.",
    reports_route: cleanText(answers.reports_route) || "Relatórios operacionais devem ir para o canal do responsável e ficar disponíveis no painel.",
    channel_fallback_rule: cleanText(answers.channel_fallback_rule) || "Se um canal externo falhar, o sistema deve manter fallback pelo painel/chat interno até o humano visualizar.",
    channels_system_summary: cleanText(answers.channels_system_summary) || "O canal comercial atende clientes. O canal do responsável recebe contexto, alertas e urgências. O chat interno serve como apoio operacional separado da Inbox.",
  };

  draft.commercial_receives_real_clients =
    channelSettingsInput.commercialReceivesRealClients;
  draft.commercial_is_official_sales_channel =
    channelSettingsInput.commercialIsOfficialSalesChannel;
  draft.commercial_channel_type = channelSettingsInput.commercialChannelType;
  draft.commercial_entry_priority =
    channelSettingsInput.commercialEntryPriority;
  draft.commercial_human_handoff_enabled =
    channelSettingsInput.commercialHumanHandoffEnabled;
  draft.commercial_channel_notes = channelSettingsInput.commercialChannelNotes;
  draft.integration_provider_name =
    channelSettingsInput.integrationProviderName;
  draft.integration_connection_mode =
    channelSettingsInput.integrationConnectionMode;
  draft.integrations_notes = channelSettingsInput.integrationsNotes;

  return draft;
}

function validateSelectedPhotos(files: File[]) {
  if (files.length > 10) {
    return "Cada item pode ter no máximo 10 fotos.";
  }

  const oversized = files.find((file) => file.size > 50 * 1024 * 1024);
  if (oversized) {
    return `A foto ${oversized.name} ultrapassa o limite de 50 MB.`;
  }

  return null;
}

function parseNumberInput(value: string) {
  const normalized = String(value || "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeManualDuplicateText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

function formatFixedDecimalInput(value: string, decimalPlaces = 2) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  const safeDecimalPlaces = Math.max(0, decimalPlaces);
  if (safeDecimalPlaces === 0) {
    return digits.replace(/^0+(?=\d)/, "") || "0";
  }

  const paddedDigits = digits.padStart(safeDecimalPlaces + 1, "0");
  const integerPartRaw = paddedDigits.slice(0, -safeDecimalPlaces);
  const decimalPart = paddedDigits.slice(-safeDecimalPlaces);
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";

  return `${integerPart}.${decimalPart}`;
}

function formatManualPoolFieldValue(
  key: keyof PoolFormState,
  value: string | boolean
): string | boolean {
  if (typeof value !== "string") return value;
  return value;
}

function formatManualCatalogFieldValue(
  key: keyof CatalogFormState,
  value: string | boolean
): string | boolean {
  if (typeof value !== "string") return value;
  return value;
}

function buildPoolManualDescription(form: PoolFormState) {
  const baseDescription = cleanText(form.description);
  const detailLines = buildBulletRows([
    { label: "Marca", value: cleanText(form.brand) },
    { label: "Material", value: cleanText(form.material) },
    { label: "Formato", value: cleanText(form.shape) },
    { label: "Cor", value: cleanText(form.color) },
    { label: "Acabamento / linha", value: cleanText(form.finish) },
    { label: "Largura (m)", value: cleanText(form.width_m) },
    { label: "Comprimento (m)", value: cleanText(form.length_m) },
    { label: "Profundidade (m)", value: cleanText(form.depth_m) },
    { label: "Itens inclusos", value: cleanText(form.included_items) },
    { label: "Observações de instalação", value: cleanText(form.installation_notes) },
    { label: "Aplicação / uso recomendado", value: cleanText(form.application) },
    { label: "Observações técnicas", value: cleanText(form.technical_notes) },
  ]);

  if (!baseDescription && detailLines.length === 0) return "";
  if (!baseDescription) return detailLines.join("\n");
  if (detailLines.length === 0) return baseDescription;

  return `${baseDescription}\n\n${detailLines.join("\n")}`;
}

function parseArrayAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('{') && trimmed.endsWith('}')) ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {}
    }
    return trimmed
      .split(",")
      .map((item) => item.replace(/^[\[\]"]+|[\[\]"]+$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeOptionToken(value: unknown) {
  return cleanText(value).toLocaleLowerCase("pt-BR");
}

function uniqueCleanStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)));
}

function resolveBrandsWorkedFromStrategy(value: unknown) {
  const selected: string[] = [];
  const otherValues: string[] = [];

  for (const item of parseArrayAnswer(value)) {
    const normalizedItem = normalizeOptionToken(item);
    const matched = POOL_MARKET_BRAND_OPTIONS.find(
      (option) =>
        option.value !== "outro" &&
        (normalizeOptionToken(option.value) === normalizedItem ||
          normalizeOptionToken(option.label) === normalizedItem),
    );

    if (matched) {
      selected.push(matched.value);
    } else {
      otherValues.push(item);
    }
  }

  if (otherValues.length > 0) selected.push("outro");

  return {
    brandsWorked: uniqueCleanStrings(selected),
    brandsWorkedOther: uniqueCleanStrings(otherValues).join(", "),
  };
}

function buildBrandsWorkedForStrategy(values: string[], other: string) {
  return joinSelectedLabels(
    values.filter((value) => value !== "outro"),
    POOL_MARKET_BRAND_OPTIONS,
    values.includes("outro") ? other : "",
  );
}

function createCanonicalCommercialExperienceDraft(
  baseDraft: CommercialExperienceDraftState,
  strategyInput: StoreStrategySettingsInput,
  strategySettings?: StoreStrategySettingsRow | null,
): CommercialExperienceDraftState {
  const offeringProducts: string[] = [];
  const offeringServices: string[] = [];

  for (const service of strategyInput.storeServices) {
    const mapped = STRATEGY_SERVICE_TO_OFFERING[service];
    if (!mapped) continue;
    if (mapped.key === "offering_products") offeringProducts.push(mapped.value);
    else offeringServices.push(mapped.value);
  }

  if (cleanText(strategyInput.storeServicesOther)) {
    offeringServices.push("outro");
  }

  const brands = resolveBrandsWorkedFromStrategy(strategyInput.brandsWorked);
  const hasStructuredCommercialExperience = Boolean(
    strategySettings?.strategy_commercial_experience_configured_at,
  );
  const hasRedesignedCommercialStrategy = Boolean(
    strategySettings?.strategy_commercial_strategy_configured_at,
  );

  return {
    ...baseDraft,
    offering_products: uniqueCleanStrings(offeringProducts),
    offering_products_other: "",
    offering_services: uniqueCleanStrings(offeringServices),
    offering_services_other: cleanText(strategyInput.storeServicesOther),
    brands_worked: brands.brandsWorked,
    brands_worked_other: brands.brandsWorkedOther,
    ...(hasStructuredCommercialExperience
      ? {
          strategy_sell_more: uniqueCleanStrings(
            (strategySettings?.strategy_sell_more_choices ?? [])
              .map((value) =>
                ["equipamentos", "acessorios_equipamentos"].includes(value)
                  ? "acessorios"
                  : value,
              )
              .filter((value) =>
                [
                  "piscinas",
                  "acessorios",
                  "quimicos",
                  "servicos",
                  "troca_equipamentos",
                  "sem_prioridade",
                  "outro",
                ].includes(value),
              ),
          ),
          strategy_sell_more_other: cleanText(strategySettings?.strategy_sell_more_other),
          strategy_sale_preference: cleanText(strategySettings?.strategy_sale_preference),
          strategy_sale_preference_other: cleanText(
            strategySettings?.strategy_sale_preference_other,
          ),
          strategy_customer_traits: uniqueCleanStrings(
            strategySettings?.strategy_customer_traits ?? [],
          ),
          strategy_customer_traits_other: cleanText(
            strategySettings?.strategy_customer_traits_other,
          ),
          strategy_attention_cases: uniqueCleanStrings(
            strategySettings?.strategy_attention_cases ?? [],
          ),
          strategy_attention_other: cleanText(strategySettings?.strategy_attention_other),
          strategy_sale_value_range: cleanText(strategySettings?.strategy_sale_value_range),
          strategy_sale_value_custom: cleanText(strategySettings?.strategy_sale_value_custom),
        }
      : {}),
    ...(hasRedesignedCommercialStrategy
      ? {
          strategy_priority_deal_types: uniqueCleanStrings(
            strategySettings?.strategy_priority_deal_types ?? [],
          ),
          strategy_priority_deal_types_other: cleanText(
            strategySettings?.strategy_priority_deal_types_other,
          ),
          strategy_avoid_cases: uniqueCleanStrings(
            strategySettings?.strategy_avoid_cases ?? [],
          ),
          strategy_avoid_cases_other: cleanText(strategySettings?.strategy_avoid_cases_other),
          strategy_avoid_action: cleanText(strategySettings?.strategy_avoid_action),
        }
      : {}),
  };
}

function buildStrategyServicesFromOfferings(input: CommercialExperienceDraftState) {
  return uniqueCleanStrings([
    ...input.offering_products.map(
      (value) => OFFERING_TO_STRATEGY_SERVICE[`offering_products:${value}`] || "",
    ),
    ...input.offering_services.map(
      (value) => OFFERING_TO_STRATEGY_SERVICE[`offering_services:${value}`] || "",
    ),
  ]);
}

function buildStoreServicesOtherFromOfferings(input: CommercialExperienceDraftState) {
  return uniqueCleanStrings([
    input.offering_products.includes("outro") ? input.offering_products_other : "",
    input.offering_services.includes("outro") ? input.offering_services_other : "",
  ]).join(", ");
}

function yesNoLabel(value: unknown) {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return "Não definido";
  if (["sim", "true", "1"].includes(normalized)) return "Sim";
  if (["não", "nao", "false", "0"].includes(normalized)) return "Não";
  return cleanText(value);
}

function parseYesNoToBoolean(value: unknown, fallback: boolean) {
  const normalized = cleanText(value).toLowerCase();
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["não", "nao", "false", "0"].includes(normalized)) return false;
  return fallback;
}

function parseYesNoToNullableBoolean(value: unknown) {
  const normalized = cleanText(value).toLowerCase();
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["não", "nao", "false", "0"].includes(normalized)) return false;
  return null;
}

function parseOptionalPositiveInteger(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function isConfiguredTimestamp(value: unknown) {
  return Boolean(cleanText(value));
}

function normalizeTimeInput(value: unknown) {
  return cleanText(value).slice(0, 5);
}

function isValidTimeRange(open: string, close: string) {
  return Boolean(open && close && open < close);
}

function toCanonicalHolidayMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "fechado") return "closed";
  if (normalized === "normal") return "normal";
  if (normalized === "especial") return "special";
  if (normalized === "caso_a_caso") return "case_by_case";
  return null;
}

function toUiHolidayMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "closed") return "fechado";
  if (normalized === "normal") return "normal";
  if (normalized === "special") return "especial";
  if (normalized === "case_by_case") return "caso_a_caso";
  return "";
}

function toCanonicalAfterHoursMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "todo_fechado") return "all_closed_hours";
  if (normalized === "janela") return "specific_window";
  return null;
}

function toUiAfterHoursMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "all_closed_hours") return "todo_fechado";
  if (normalized === "specific_window") return "janela";
  return "";
}

function toCanonicalAgendaDailyLimitMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "limite") return "fixed_limit";
  if (normalized === "sem_limite") return "no_fixed_limit";
  return null;
}

function toUiAgendaDailyLimitMode(value: unknown) {
  const normalized = normalizeLoose(value);
  if (normalized === "fixed_limit") return "limite";
  if (normalized === "no_fixed_limit") return "sem_limite";
  return "";
}

function readCanonicalOperatingDays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter((day) => CANONICAL_OPERATION_DAYS.includes(day));
}

function readCanonicalDayHours(value: unknown) {
  const fallback = createEmptyOperationExperienceDraft().team_day_hours;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const source = value as Record<string, unknown>;
  return CANONICAL_OPERATION_DAYS.reduce<Record<string, { open: string; close: string }>>(
    (acc, day) => {
      const row = source[day];
      if (row && typeof row === "object" && !Array.isArray(row)) {
        const dayRow = row as Record<string, unknown>;
        acc[day] = {
          open: normalizeTimeInput(dayRow.start ?? dayRow.open) || fallback[day]?.open || "08:00",
          close: normalizeTimeInput(dayRow.end ?? dayRow.close) || fallback[day]?.close || "18:00",
        };
      } else {
        acc[day] = fallback[day] ?? { open: "08:00", close: "18:00" };
      }
      return acc;
    },
    {},
  );
}

function hasHumanScheduleCanonicalShape(scheduleSettings?: ScheduleSettingsRow | null) {
  if (!scheduleSettings || !isConfiguredTimestamp(scheduleSettings.human_schedule_configured_at)) {
    return false;
  }

  const days = readCanonicalOperatingDays(scheduleSettings.operating_days);
  if (days.length === 0) return false;

  const hours = readCanonicalDayHours(scheduleSettings.operating_hours);
  const hoursComplete = days.every((day) => {
    const window = hours[day];
    return isValidTimeRange(window?.open ?? "", window?.close ?? "");
  });
  if (!hoursComplete) return false;

  const holidayMode = cleanText(scheduleSettings.holiday_mode);
  if (!["closed", "normal", "special", "case_by_case"].includes(holidayMode)) {
    return false;
  }
  if (
    holidayMode === "special" &&
    !isValidTimeRange(
      normalizeTimeInput(scheduleSettings.holiday_open_time),
      normalizeTimeInput(scheduleSettings.holiday_close_time),
    )
  ) {
    return false;
  }
  if (holidayMode === "case_by_case" && !cleanText(scheduleSettings.holiday_notes)) {
    return false;
  }
  return true;
}

function hasAgendaCapacityCanonicalShape(scheduleSettings?: ScheduleSettingsRow | null) {
  if (!scheduleSettings || !isConfiguredTimestamp(scheduleSettings.agenda_capacity_configured_at)) {
    return false;
  }

  if (typeof scheduleSettings.allow_multiple_appointments_per_day !== "boolean") return false;
  if (typeof scheduleSettings.allow_same_time_appointments !== "boolean") return false;
  if (scheduleSettings.allow_same_time_appointments) {
    const capacity = Number(scheduleSettings.same_time_capacity);
    if (!Number.isInteger(capacity) || capacity < 2) return false;
  }
  if (scheduleSettings.daily_limit_mode === "fixed_limit") {
    const dailyLimit = Number(scheduleSettings.daily_limit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 2) return false;
  }
  if (scheduleSettings.appointment_buffer_enabled) {
    const minutes = Number(scheduleSettings.appointment_buffer_minutes);
    if (!Number.isInteger(minutes) || minutes < 1) return false;
  }
  return true;
}

function resolveHumanScheduleCardStatus(scheduleSettings?: ScheduleSettingsRow | null): { tone: ConfigurationCardTone; status: string } {
  if (!isConfiguredTimestamp(scheduleSettings?.human_schedule_configured_at)) {
    return { tone: "yellow", status: "Precisa de atenção" };
  }
  if (!hasHumanScheduleCanonicalShape(scheduleSettings)) {
    return { tone: "red", status: "Configuração crítica" };
  }
  return { tone: "blue", status: "Completo" };
}

function resolveAfterHoursCardStatus(scheduleSettings?: ScheduleSettingsRow | null): { tone: ConfigurationCardTone; status: string } {
  if (!isConfiguredTimestamp(scheduleSettings?.ai_after_hours_configured_at)) {
    return { tone: "yellow", status: "Precisa de atenção" };
  }
  if (scheduleSettings?.ai_after_hours_enabled === false) {
    return { tone: "blue", status: "Completo" };
  }
  if (
    scheduleSettings?.ai_after_hours_enabled === true &&
    (scheduleSettings.ai_after_hours_mode === "all_closed_hours" ||
      (scheduleSettings.ai_after_hours_mode === "specific_window" &&
        isValidTimeRange(
          normalizeTimeInput(scheduleSettings.ai_after_hours_start),
          normalizeTimeInput(scheduleSettings.ai_after_hours_end),
        )))
  ) {
    return { tone: "blue", status: "Completo" };
  }
  return { tone: "red", status: "Configuração crítica" };
}

function resolveAgendaCapacityCardStatus(scheduleSettings?: ScheduleSettingsRow | null): { tone: ConfigurationCardTone; status: string } {
  if (!isConfiguredTimestamp(scheduleSettings?.agenda_capacity_configured_at)) {
    return { tone: "yellow", status: "Precisa de atenção" };
  }
  if (!hasAgendaCapacityCanonicalShape(scheduleSettings)) {
    return { tone: "red", status: "Configuração crítica" };
  }
  return { tone: "blue", status: "Completo" };
}

function resolveCustomerRescheduleAutonomyCardStatus(scheduleSettings?: ScheduleSettingsRow | null): { tone: ConfigurationCardTone; status: string } {
  if (!isConfiguredTimestamp(scheduleSettings?.customer_reschedule_autonomy_configured_at)) {
    return { tone: "yellow", status: "Precisa de atenção" };
  }
  if (scheduleSettings?.ai_can_accept_customer_reschedule_without_approval == null) {
    return { tone: "red", status: "Configuração crítica" };
  }
  return { tone: "blue", status: "Completo" };
}

function buildHumanScheduleConfigurationPayload(
  draft: OperationExperienceDraftState,
  scheduleSettings?: ScheduleSettingsRow | null,
):
  | {
      error: string;
    }
  | {
      operatingDays: string[];
      operatingHours: Record<string, { start: string; end: string }>;
      timezoneName: string;
      holidayMode: string;
      holidayOpenTime: string | null;
      holidayCloseTime: string | null;
      holidayNotes: string | null;
    } {
  const selectedDays = CANONICAL_OPERATION_DAYS.filter((day) =>
    draft.team_days.includes(day),
  );
  if (selectedDays.length === 0) {
    return { error: "Informe pelo menos um dia de atendimento da equipe." };
  }

  const sameHours = normalizeLoose(draft.team_same_hours) !== "nao";
  const operatingHours: Record<string, { start: string; end: string }> = {};

  for (const day of selectedDays) {
    const open = sameHours
      ? normalizeTimeInput(draft.team_open_time)
      : normalizeTimeInput(draft.team_day_hours[day]?.open);
    const close = sameHours
      ? normalizeTimeInput(draft.team_close_time)
      : normalizeTimeInput(draft.team_day_hours[day]?.close);

    if (!isValidTimeRange(open, close)) {
      return { error: `Informe um horario valido para ${optionLabel(day, DAYS_OF_WEEK_OPTIONS)}.` };
    }
    operatingHours[day] = { start: open, end: close };
  }

  const holidayMode = toCanonicalHolidayMode(draft.holiday_mode);
  if (!holidayMode) {
    return { error: "Informe como a loja funciona em feriados." };
  }

  const holidayOpenTime =
    holidayMode === "special" ? normalizeTimeInput(draft.holiday_open_time) : null;
  const holidayCloseTime =
    holidayMode === "special" ? normalizeTimeInput(draft.holiday_close_time) : null;
  const holidayNotes =
    holidayMode === "case_by_case" ? cleanText(draft.holiday_notes) : null;

  if (holidayMode === "special" && !isValidTimeRange(holidayOpenTime || "", holidayCloseTime || "")) {
    return { error: "Informe um horario especial valido para feriados." };
  }
  if (holidayMode === "case_by_case" && !holidayNotes) {
    return { error: "Explique como o atendimento em feriados e definido caso a caso." };
  }

  return {
    operatingDays: selectedDays,
    operatingHours,
    timezoneName: cleanText(scheduleSettings?.timezone_name) || DEFAULT_SCHEDULE_TIMEZONE,
    holidayMode,
    holidayOpenTime,
    holidayCloseTime,
    holidayNotes,
  };
}

function createScheduleOperationExperienceDraftFromSettings(
  scheduleSettings?: ScheduleSettingsRow | null,
  fallback: OperationExperienceDraftState = createEmptyOperationExperienceDraft(),
) {
  if (!scheduleSettings) return fallback;

  const operatingDays = readCanonicalOperatingDays(scheduleSettings.operating_days);
  const teamDayHours = readCanonicalDayHours(scheduleSettings.operating_hours);
  const selectedDays = operatingDays.length ? operatingDays : fallback.team_days;
  const firstWindow = teamDayHours[selectedDays[0]];
  const sameHours =
    Boolean(firstWindow) &&
    selectedDays.every(
      (day) =>
        teamDayHours[day]?.open === firstWindow.open &&
        teamDayHours[day]?.close === firstWindow.close,
    );
  const afterHoursConfigured = isConfiguredTimestamp(scheduleSettings.ai_after_hours_configured_at);
  const agendaConfigured = isConfiguredTimestamp(scheduleSettings.agenda_capacity_configured_at);
  const rescheduleAutonomyConfigured = isConfiguredTimestamp(
    scheduleSettings.customer_reschedule_autonomy_configured_at,
  );

  return {
    ...fallback,
    team_days: selectedDays,
    team_same_hours: sameHours ? "Sim" : "NÃ£o",
    team_open_time: firstWindow?.open || fallback.team_open_time,
    team_close_time: firstWindow?.close || fallback.team_close_time,
    team_day_hours: teamDayHours,
    holiday_mode: toUiHolidayMode(scheduleSettings.holiday_mode),
    holiday_open_time: normalizeTimeInput(scheduleSettings.holiday_open_time),
    holiday_close_time: normalizeTimeInput(scheduleSettings.holiday_close_time),
    holiday_notes: cleanText(scheduleSettings.holiday_notes),
    ai_after_hours_enabled: afterHoursConfigured
      ? yesNoLabel(scheduleSettings.ai_after_hours_enabled)
      : "NÃ£o definido",
    ai_after_hours_mode: afterHoursConfigured
      ? toUiAfterHoursMode(scheduleSettings.ai_after_hours_mode)
      : "",
    ai_after_hours_start: afterHoursConfigured
      ? normalizeTimeInput(scheduleSettings.ai_after_hours_start)
      : "",
    ai_after_hours_end: afterHoursConfigured
      ? normalizeTimeInput(scheduleSettings.ai_after_hours_end)
      : "",
    ai_attends_holidays: afterHoursConfigured
      ? yesNoLabel(scheduleSettings.ai_attends_holidays)
      : "",
    agenda_daily_limit_mode: agendaConfigured
      ? toUiAgendaDailyLimitMode(scheduleSettings.daily_limit_mode)
      : "",
    agenda_daily_limit:
      agendaConfigured && scheduleSettings.daily_limit != null
        ? String(scheduleSettings.daily_limit)
        : "",
    agenda_buffer_enabled: agendaConfigured
      ? yesNoLabel(scheduleSettings.appointment_buffer_enabled)
      : "",
    agenda_buffer_minutes:
      agendaConfigured && scheduleSettings.appointment_buffer_minutes != null
        ? String(scheduleSettings.appointment_buffer_minutes)
        : "",
    ai_can_accept_customer_reschedule_without_approval:
      rescheduleAutonomyConfigured
        ? yesNoLabel(scheduleSettings.ai_can_accept_customer_reschedule_without_approval)
        : "",
  };
}

function optionLabel(value: string, options: Option[]) {
  return options.find((option) => option.value === value)?.label || value;
}

function joinSelectedLabels(values: string[], options: Option[], extra?: string) {
  const labels = values.map((value) => optionLabel(value, options)).filter(Boolean);
  const safeExtra = cleanText(extra);
  if (safeExtra) labels.push(safeExtra);
  return labels.join(", ");
}

function buildBulletRows(items: Array<{ label: string; value: string }>) {
  return items.filter((item) => cleanText(item.value)).map((item) => `${item.label}: ${item.value}`);
}

type ConfigurationCardTone = "blue" | "yellow" | "red";

function resolveCommercialPaymentCardStatus({
  paymentSettings,
  commercialDraft,
  commercialExperienceDraft,
}: {
  paymentSettings: StorePaymentSettingsRow | null;
  commercialDraft: CommercialDraftState;
  commercialExperienceDraft: CommercialExperienceDraftState;
}): { tone: ConfigurationCardTone; status: string } {
  if (!paymentSettings) {
    return { tone: "red", status: "Configuração crítica" };
  }

  const acceptedPaymentMethods = commercialDraft.accepted_payment_methods;
  const pixIsIncomplete =
    acceptedPaymentMethods.includes("pix") &&
    (!cleanText(commercialDraft.pix_key_type) || !cleanText(commercialDraft.pix_key));
  const installmentsEnabled = normalizeLoose(commercialDraft.installments_enabled) === "sim";
  const maxInstallments = Number.parseInt(cleanText(commercialDraft.max_installments), 10);
  const installmentsAreIncomplete =
    installmentsEnabled &&
    (!Number.isInteger(maxInstallments) ||
      maxInstallments <= 0 ||
      !cleanText(commercialDraft.installment_interest_policy) ||
      !cleanText(commercialExperienceDraft.installments_interest_free_enabled) ||
      (commercialExperienceDraft.installments_interest_free_enabled === "Sim" &&
        (() => {
          const interestFreeMax = Number.parseInt(
            cleanText(commercialExperienceDraft.installments_interest_free_max),
            10,
          );
          return (
            !Number.isInteger(interestFreeMax) ||
            interestFreeMax <= 0 ||
            interestFreeMax > maxInstallments
          );
        })()) ||
      (["regra_propria", "depende", "outro"].includes(
        commercialExperienceDraft.installment_interest_above_mode,
      ) &&
        !cleanText(commercialExperienceDraft.installment_interest_above_rule)) ||
      (commercialExperienceDraft.installment_minimum_enabled === "Sim" &&
        !cleanText(commercialExperienceDraft.installment_minimum_amount)));
  const financingIsIncomplete =
    acceptedPaymentMethods.includes("financiamento") &&
    (!cleanText(commercialExperienceDraft.financing_mode) ||
      (commercialExperienceDraft.financing_mode === "parceiro" &&
        !cleanText(commercialExperienceDraft.financing_partner_name)) ||
      (["depende", "outro"].includes(commercialExperienceDraft.financing_mode) &&
        !cleanText(commercialExperienceDraft.financing_other)) ||
      !cleanText(commercialExperienceDraft.financing_credit_analysis) ||
      !cleanText(commercialExperienceDraft.financing_simulation_by) ||
      !cleanText(commercialExperienceDraft.financing_ai_policy));

  if (
    acceptedPaymentMethods.length === 0 ||
    pixIsIncomplete ||
    installmentsAreIncomplete ||
    financingIsIncomplete
  ) {
    return { tone: "yellow", status: "Precisa de atenção" };
  }

  return { tone: "blue", status: "Configurado" };
}

function configurationCardBarClass(tone: ConfigurationCardTone) {
  if (tone === "yellow") return "bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-300";
  if (tone === "red") return "bg-gradient-to-r from-red-500 via-rose-500 to-red-400";
  return "bg-gradient-to-r from-sky-500 via-cyan-500 to-cyan-400";
}

function configurationCardStatusClass(tone: ConfigurationCardTone) {
  if (tone === "yellow") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function SectionBlock({
  title,
  description,
  actions,
  status,
  tone = "blue",
  className = "",
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  status?: string;
  tone?: ConfigurationCardTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`self-start overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      <div className={`h-0.5 w-full ${configurationCardBarClass(tone)}`} />
      <div className="p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-950">{title}</h2>
            {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-gray-600">{description}</p> : null}
          </div>
          {status || actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {status ? (
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${configurationCardStatusClass(tone)}`}>
                  {status}
                </span>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}

function PreparedEditButton() {
  return (
    <button
      type="button"
      disabled
      title="A edição será habilitada quando esta autoridade for conectada ao fluxo correspondente."
      className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-400"
    >
      Editar
    </button>
  );
}

function PreparedSettingsCard({
  title,
  description,
  items,
  tone = "yellow",
  status = "Aguardando configuração",
  className = "",
}: {
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
  tone?: ConfigurationCardTone;
  status?: string;
  className?: string;
}) {
  return (
    <SectionBlock
      title={title}
      description={description}
      tone={tone}
      status={status}
      className={className}
      actions={<PreparedEditButton />}
    >
      <SummaryList items={buildBulletRows(items)} />
    </SectionBlock>
  );
}

function QuickCard({
  href,
  title,
  count,
}: {
  href: string;
  title: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[44px] items-center justify-between rounded-xl border border-gray-200 bg-gray-50/70 px-3.5 py-2 transition hover:border-cyan-300 hover:bg-cyan-50/40"
    >
      <h3 className="min-w-0 text-sm font-semibold text-gray-700 transition group-hover:text-gray-950">{title}</h3>
      {typeof count === "number" ? (
        <span className="ml-4 inline-flex min-w-10 shrink-0 justify-center rounded-lg bg-white px-2.5 py-1 text-sm font-bold tabular-nums text-gray-950 ring-1 ring-gray-200">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
    >
      {children}
    </Link>
  );
}

function StatusCard({
  label,
  value,
  tone = "gray",
  hint,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  hint?: string;
}) {
  return (
    <div className="min-h-[104px] rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </div>
      <div className="mt-2">
        <span
          className={`inline-flex max-w-full break-words whitespace-normal rounded-full border px-2.5 py-1 text-left text-xs font-semibold leading-5 ${statusToneClass(
            tone
          )}`}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <div
          className="mt-2 text-xs leading-5 text-gray-600"
          title={hint}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SummaryList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <div className="py-2 text-sm text-gray-500">Nada relevante para mostrar ainda.</div>;
  }

  return (
    <div className="divide-y divide-gray-100">
      {items.map((item, index) => {
        const separatorIndex = item.indexOf(":");
        const hasLabel = separatorIndex > 0 && separatorIndex < 48;
        const label = hasLabel ? item.slice(0, separatorIndex).trim() : "";
        const value = hasLabel ? item.slice(separatorIndex + 1).trim() : item.trim();

        return (
          <div
            key={`${item}-${index}`}
            className="grid gap-1 py-2.5 sm:grid-cols-[minmax(150px,0.42fr)_minmax(0,1fr)] sm:gap-5"
          >
            {hasLabel ? (
              <div className="text-[13px] font-medium text-gray-500">{label}</div>
            ) : null}
            <div
              title={value}
              className={[
                "min-w-0 break-words text-sm font-semibold leading-5 text-gray-950",
                hasLabel ? "" : "sm:col-span-2",
              ].join(" ")}
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </div>
      <div className="mt-2">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusToneClass(
            tone
          )}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function SettingsTabButton({
  active,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex min-h-[46px] min-w-0 w-full flex-col items-center justify-center rounded-lg px-2.5 py-2 text-center transition",
        active
          ? "bg-black text-white shadow-sm"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      <div className="break-words text-[13px] font-semibold leading-tight">{label}</div>
      {badge ? (
        <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${active ? "bg-white/15 text-white/85" : "bg-gray-100 text-gray-500"}`}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ChoiceButtonGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = normalizeLoose(value) === normalizeLoose(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-xl border px-3 py-2 text-sm font-semibold transition",
              active
                ? "border-black bg-black text-white"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RepeatableBrandSelect({
  values,
  onChange,
  options,
  addLabel = "Adicionar mais uma opção",
  selectPlaceholder = "Selecione uma opção",
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: Option[];
  addLabel?: string;
  selectPlaceholder?: string;
}) {
  const rows = values.length > 0 ? values : [""];

  const updateRow = (index: number, nextValue: string) => {
    const next = [...rows];
    next[index] = nextValue;
    onChange(next.filter((item, itemIndex) => cleanText(item) || itemIndex <= index));
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length > 0 ? next : []);
  };

  return (
    <div className="space-y-2">
      {rows.map((rowValue, index) => (
        <div key={`brand-row-${index}`} className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <select
              value={rowValue}
              onChange={(event) => updateRow(index, event.target.value)}
              className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-11 text-sm outline-none focus:border-black"
            >
              <option value="">{selectPlaceholder}</option>
              {options.map((option) => {
                const alreadyUsed =
                  option.value !== "outro" &&
                  rows.some((value, itemIndex) => itemIndex !== index && value === option.value);
                return (
                  <option key={option.value} value={option.value} disabled={alreadyUsed}>
                    {option.label}
                  </option>
                );
              })}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500">⌄</span>
          </div>
          {(rows.length > 1 || cleanText(rowValue)) ? (
            <button
              type="button"
              onClick={() => removeRow(index)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              aria-label="Remover item"
            >
              Remover
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows.filter((item) => cleanText(item)), ""])}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-cyan-300 hover:bg-cyan-50/40"
      >
        <span className="text-base leading-none">+</span>
        {addLabel}
      </button>
    </div>
  );
}


function MultiSelectBoxGroup({
  values,
  onToggle,
  options,
  columns = "md:grid-cols-2",
  disabled = false,
}: {
  values: string[];
  onToggle: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  columns?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((option) => {
        const active = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(option.value)}
            className={[
              "rounded-xl border px-3 py-2.5 text-left text-sm transition",
              disabled
                ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                : active
                  ? "border-cyan-500 bg-cyan-50 text-cyan-950"
                  : "border-gray-200 bg-white text-gray-700 hover:border-cyan-300 hover:bg-cyan-50/40",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RequiredOperationDetailField({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rows?: number;
}) {
  return (
    <label className="mt-3 block space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-950">{label}</span>
        <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">Obrigatório para salvar</span>
      </div>
      <textarea
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
      />
    </label>
  );
}

export default function ConfiguracoesPage() {
  const { organizationId, activeStoreId, activeStore, refreshStores } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);
  const [counts, setCounts] = useState<CountState>({
    pools: 0,
    quimicos: 0,
    acessorios: 0,
    outros: 0,
  });
  const [poolCatalogSuggestionRows, setPoolCatalogSuggestionRows] = useState<PoolCatalogSuggestionRow[]>([]);
  const [catalogSuggestionRows, setCatalogSuggestionRows] = useState<CatalogItemRow[]>([]);
  const [catalogQuality, setCatalogQuality] = useState<CatalogQualityState>({
    total: 0,
    withoutPrice: 0,
    unknownStock: 0,
    withoutPhotos: 0,
    inactive: 0,
  });
  const [isCatalogImportedFilesOpen, setIsCatalogImportedFilesOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingRow | null>(null);
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettingsRow | null>(null);
  const [operationSettings, setOperationSettings] = useState<StoreOperationSettingsRow | null>(null);
  const [strategySettings, setStrategySettings] = useState<StoreStrategySettingsRow | null>(null);
  const [channelSettings, setChannelSettings] = useState<StoreChannelSettingsRow | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<StorePaymentSettingsRow | null>(null);
  const [commercialAiSettings, setCommercialAiSettings] =
    useState<StoreCommercialAiSettingsRow | null>(null);
  const [monthlySalesGoal, setMonthlySalesGoal] =
    useState<StoreMonthlySalesGoalInput>(
      normalizeStoreMonthlySalesGoalRow(null),
    );
  const [monthlySalesGoalDraft, setMonthlySalesGoalDraft] =
    useState<StoreMonthlySalesGoalInput>(
      normalizeStoreMonthlySalesGoalRow(null),
    );
  const [isMonthlySalesGoalEditing, setIsMonthlySalesGoalEditing] = useState(false);
  const [discountSettings, setDiscountSettings] = useState<StoreDiscountSettingsRow | null>(null);
  const [highValueDiscountSettings, setHighValueDiscountSettings] =
    useState<StoreHighValueDiscountSettingsRow | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("geral");
  const [isOverviewEditing, setIsOverviewEditing] = useState(false);
  const [overviewEditTarget, setOverviewEditTarget] = useState<"store" | "address" | "responsible" | null>(null);
  const [isStrategyEditing, setIsStrategyEditing] = useState(false);
  const [strategyEditTarget, setStrategyEditTarget] = useState<"region" | "services" | "offerings" | "strategy" | "brands" | "ai" | null>(null);
  const [isOperationEditing, setIsOperationEditing] = useState(false);
  const [operationEditTarget, setOperationEditTarget] = useState<
    | "hours"
    | "after_hours"
    | "agenda"
    | "reschedule_autonomy"
    | "region"
    | "technical_visit"
    | "installation"
    | "pool_replacement"
    | "delivery"
    | "pickup"
    | "technical_services"
    | null
  >(null);
  const [generalAddressDraft, setGeneralAddressDraft] = useState<GeneralAddressDraftState>(createEmptyGeneralAddressDraft());
  const [savedGeneralAddress, setSavedGeneralAddress] = useState<GeneralAddressDraftState>(createEmptyGeneralAddressDraft());
  const [generalAddressCepLookupLoading, setGeneralAddressCepLookupLoading] = useState(false);
  const [generalAddressCepLookupMessage, setGeneralAddressCepLookupMessage] = useState<string | null>(null);
  const [operationExperienceDraft, setOperationExperienceDraft] = useState<OperationExperienceDraftState>(createEmptyOperationExperienceDraft());
  const [savedOperationExperience, setSavedOperationExperience] = useState<OperationExperienceDraftState>(createEmptyOperationExperienceDraft());
  const [operationExecutionPolicies, setOperationExecutionPolicies] =
    useState<StoreOperationExecutionPoliciesRow | null>(null);
  const [overviewDraft, setOverviewDraft] = useState<Record<string, string>>({});
  const [strategyDraft, setStrategyDraft] = useState<StoreStrategySettingsInput>(
    createStoreStrategySettingsInputFromSources({}),
  );
  const [operationDraft, setOperationDraft] = useState<OperationDraftState>(createOperationDraftFromAnswers({}, null, null));
  const [isCommercialEditing, setIsCommercialEditing] = useState(false);
  const [commercialEditTarget, setCommercialEditTarget] = useState<"ai_price" | "payments" | null>(null);
  const [commercialDraft, setCommercialDraft] = useState<CommercialDraftState>(
    createCommercialDraftFromAnswersWithPaymentSettings({}),
  );
  const [commercialExperienceDraft, setCommercialExperienceDraft] =
    useState<CommercialExperienceDraftState>(createEmptyCommercialExperienceDraft());
  const [savedCommercialExperience, setSavedCommercialExperience] =
    useState<CommercialExperienceDraftState>(createEmptyCommercialExperienceDraft());
  const [commercialExperienceEditTarget, setCommercialExperienceEditTarget] = useState<
    | "suggestions"
    | "payment_blocks"
    | "quote"
    | "post_sale"
    | "warranty"
    | "cancellation"
    | null
  >(null);
  const [isDiscountEditing, setIsDiscountEditing] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraftState>(
    createDiscountDraftFromAnswers({}, null, null),
  );
  const [isChannelsEditing, setIsChannelsEditing] = useState(false);
  const [showChannelsAdvanced, setShowChannelsAdvanced] = useState(false);
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(
    createChannelDraftFromSources({}, null),
  );
  const [isActivationEditing, setIsActivationEditing] = useState(false);
  const [responsibleEditTarget, setResponsibleEditTarget] = useState<"primary" | "additional" | null>(null);
  const [isBrandEditing, setIsBrandEditing] = useState(false);
  const [brandExperienceDraft, setBrandExperienceDraft] = useState<BrandExperienceDraftState>(createEmptyBrandExperienceDraft());
  const [savedBrandExperience, setSavedBrandExperience] = useState<BrandExperienceDraftState>(createEmptyBrandExperienceDraft());
  const [isContractPolicyEditing, setIsContractPolicyEditing] = useState(false);
  const [contractExperienceDraft, setContractExperienceDraft] = useState<ContractExperienceDraftState>(createEmptyContractExperienceDraft());
  const [savedContractExperience, setSavedContractExperience] = useState<ContractExperienceDraftState>(createEmptyContractExperienceDraft());
  const [isContractsEditing, setIsContractsEditing] = useState(false);
  const [commercialWhatsappDraft, setCommercialWhatsappDraft] = useState("");
  const [isCommercialWhatsappEditing, setIsCommercialWhatsappEditing] = useState(false);
  const [primaryResponsibleDraft, setPrimaryResponsibleDraft] = useState<ResponsiblePersonDraft>(createEmptyResponsibleDraft(true));
  const [additionalResponsiblesDraft, setAdditionalResponsiblesDraft] = useState<ResponsiblePersonDraft[]>([]);
  const [activationConfirmInformationDraft, setActivationConfirmInformationDraft] = useState(false);
  const [activationNotificationCasesDraft, setActivationNotificationCasesDraft] = useState("");
  const [activationPreferencesDraft, setActivationPreferencesDraft] = useState("");
  const [poolForm, setPoolForm] = useState<PoolFormState>(createEmptyPoolForm());
  const [poolPhotos, setPoolPhotos] = useState<File[]>([]);
  const [savingPool, setSavingPool] = useState(false);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(createEmptyCatalogForm());
  const [catalogPhotos, setCatalogPhotos] = useState<File[]>([]);
  const [savingCatalogItem, setSavingCatalogItem] = useState(false);
  const [poolImportFiles, setPoolImportFiles] = useState<StoreImportFileRow[]>([]);
  const [catalogImportFiles, setCatalogImportFiles] = useState<StoreImportFileRow[]>([]);
  const [storeCatalogSettings, setStoreCatalogSettings] = useState<StoreCatalogSettingsRow | null>(null);
  const [isCustomerCatalogEditing, setIsCustomerCatalogEditing] = useState(false);
  const [customerCatalogAllowDraft, setCustomerCatalogAllowDraft] = useState<"Sim" | "Não">("Não");
  const [customerCatalogFileIdsDraft, setCustomerCatalogFileIdsDraft] = useState<string[]>([]);
  const [savingCustomerCatalogSettings, setSavingCustomerCatalogSettings] = useState(false);
  const [downloadingImportFileId, setDownloadingImportFileId] = useState<string | null>(null);
  const [deletingImportFileId, setDeletingImportFileId] = useState<string | null>(null);
  const [rawImportFilesModalTab, setRawImportFilesModalTab] = useState<"pools" | "catalog" | null>(null);
  const [isManualCatalogItemModalOpen, setIsManualCatalogItemModalOpen] = useState(false);
  const [manualCatalogItemCategory, setManualCatalogItemCategory] = useState<
    "piscina" | "quimicos" | "acessorios" | "outros"
  >("piscina");
  const [manualCatalogItemModalError, setManualCatalogItemModalError] = useState<string | null>(null);
  const [manualCatalogItemModalSuccess, setManualCatalogItemModalSuccess] = useState<string | null>(null);
  const [storeBranding, setStoreBranding] = useState<StoreBrandingSettingsRow | null>(null);
  const [storeLogoPreviewUrl, setStoreLogoPreviewUrl] = useState<string | null>(null);
  const [isIdentityEditing, setIsIdentityEditing] = useState(false);
  const [storeWhatsappStatus, setStoreWhatsappStatus] = useState<StoreWhatsappStatusApiResponse | null>(null);
  const [storeWhatsappStatusLoading, setStoreWhatsappStatusLoading] = useState(false);
  const [storeWhatsappStatusErrorText, setStoreWhatsappStatusErrorText] = useState<string | null>(null);
  const [selectedStoreLogoFile, setSelectedStoreLogoFile] = useState<File | null>(null);
  const [savingStoreLogo, setSavingStoreLogo] = useState(false);
  const [removingStoreLogo, setRemovingStoreLogo] = useState(false);
  const [storeContractTemplate, setStoreContractTemplate] = useState<StoreContractTemplateRow | null>(null);
  const [storeContractActiveVersion, setStoreContractActiveVersion] = useState<StoreContractTemplateVersionRow | null>(null);
  const [storeContractVersions, setStoreContractVersions] = useState<StoreContractTemplateVersionRow[]>([]);
  const [showContractVersionHistory, setShowContractVersionHistory] = useState(false);
  const [storeContractExtractedRules, setStoreContractExtractedRules] = useState<
    StoreContractTemplateExtractedRuleRow[]
  >([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [selectedContractBaseFile, setSelectedContractBaseFile] = useState<File | null>(null);
  const [uploadingContractBase, setUploadingContractBase] = useState(false);
  const [contractActionVersionId, setContractActionVersionId] = useState<string | null>(null);
  const [contractActionType, setContractActionType] = useState<
    "analyze" | "approve" | "reject" | "extract-rules" | null
  >(null);
  const [contractRejectReasonDrafts, setContractRejectReasonDrafts] = useState<Record<string, string>>({});
  const [contractsErrorText, setContractsErrorText] = useState<string | null>(null);
  const [contractsSuccessText, setContractsSuccessText] = useState<string | null>(null);
  const [contractRuleActionRuleId, setContractRuleActionRuleId] = useState<string | null>(null);
  const [contractRuleActionType, setContractRuleActionType] = useState<
    "approve" | "reject" | "save-edit" | null
  >(null);
  const [contractRuleEditDrafts, setContractRuleEditDrafts] = useState<Record<string, string>>({});
  const [contractRuleEditingIds, setContractRuleEditingIds] = useState<Record<string, boolean>>({});
  const [contractContentModal, setContractContentModal] = useState<
    | {
        type: "text" | "rules";
        versionId: string;
      }
    | null
  >(null);
  const [contractContentSearchQuery, setContractContentSearchQuery] = useState("");
  const [contractContentSearchIndex, setContractContentSearchIndex] = useState(0);
  const contractContentModalRef = useRef<HTMLDivElement | null>(null);
  const [canonicalPrimaryResponsible, setCanonicalPrimaryResponsible] =
    useState<CanonicalPrimaryResponsible | null>(null);
  const [hasLoadedCanonicalPrimaryResponsible, setHasLoadedCanonicalPrimaryResponsible] =
    useState(false);

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const storeName = useMemo(() => buildStoreName(activeStore), [activeStore]);
  const loadedCanonicalPrimaryResponsible = hasLoadedCanonicalPrimaryResponsible
    ? canonicalPrimaryResponsible
    : null;
  const canonicalPrimaryResponsibleDraft = useMemo(
    () => createPrimaryResponsibleDraftFromSources(answers, loadedCanonicalPrimaryResponsible),
    [answers, loadedCanonicalPrimaryResponsible],
  );
  const storeLogoInputRef = useRef<HTMLInputElement | null>(null);
  const contractBaseInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!contractContentModal || !cleanText(contractContentSearchQuery)) return;

    const frame = window.requestAnimationFrame(() => {
      const target = contractContentModalRef.current?.querySelector<HTMLElement>(
        '[data-contract-current-search-target="true"]',
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [contractContentModal, contractContentSearchIndex, contractContentSearchQuery]);
  const configDraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStoreId) return null;
    return `zion_configuracoes_draft:${organizationId}:${activeStoreId}`;
  }, [organizationId, activeStoreId]);
  const intelligentImportStorageKey = useMemo(() => {
    if (!organizationId || !activeStoreId) return null;
    return `zion_configuracoes_intelligent_import:${organizationId}:${activeStoreId}`;
  }, [organizationId, activeStoreId]);
  const hasRestoredLocalDraftRef = useRef(false);
  const hasInitializedLocalDraftRef = useRef(false);

  const tabs = useMemo(
    () => [
      { id: "geral" as const, label: "Geral" },
      { id: "operacao" as const, label: "Operação" },
      { id: "catalogo" as const, label: "Catálogo" },
      { id: "comercial" as const, label: "Comercial" },
      { id: "contratos-marca" as const, label: "Contratos e Marca" },
      { id: "canais-integracoes" as const, label: "Canais e Integrações" },
      { id: "plano-cobranca" as const, label: "Plano e cobrança" },
    ],
    []
  );


  async function fetchStoreBrandingFromApi(storeIdOverride?: string | null) {
    const resolvedStoreId = cleanText(storeIdOverride) || cleanText(activeStoreId);

    if (!resolvedStoreId) {
      setStoreBranding(null);
      setStoreLogoPreviewUrl(null);
      return;
    }

    const response = await fetch(
      `/api/store-branding/logo?storeId=${encodeURIComponent(resolvedStoreId)}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );
    const result = (await response.json()) as StoreBrandingApiResponse;

    if (!response.ok || !result?.ok) {
      throw new Error(result?.message || "Nao foi possivel carregar a logo da loja.");
    }

    setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
    setStoreLogoPreviewUrl(result.signedUrl || null);
  }

  async function fetchStoreWhatsappStatusFromApi(storeIdOverride?: string | null) {
    const resolvedStoreId = cleanText(storeIdOverride) || cleanText(activeStoreId);

    if (!resolvedStoreId) {
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(null);
      setStoreWhatsappStatusLoading(false);
      return;
    }

    setStoreWhatsappStatusLoading(true);

    try {
      const response = await fetch(
        `/api/store/whatsapp/status?storeId=${encodeURIComponent(resolvedStoreId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }
      );
      const result = (await response.json().catch(() => null)) as StoreWhatsappStatusApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel carregar o status do WhatsApp da loja.");
      }

      setStoreWhatsappStatus(result);
      setStoreWhatsappStatusErrorText(null);
    } catch (error: any) {
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(
        error?.message || "Nao foi possivel carregar o status do WhatsApp da loja."
      );
    } finally {
      setStoreWhatsappStatusLoading(false);
    }
  }

  const applyStoreContractTemplateResponse = useCallback(
    (result: StoreContractTemplateApiResponse | null | undefined) => {
      setStoreContractTemplate((result?.template ?? null) as StoreContractTemplateRow | null);
      setStoreContractActiveVersion(
        (result?.activeVersion ?? null) as StoreContractTemplateVersionRow | null
      );
      setStoreContractVersions(
        Array.isArray(result?.versions)
          ? (result?.versions as StoreContractTemplateVersionRow[])
          : []
      );
      setStoreContractExtractedRules(
        Array.isArray(result?.extractedRules)
          ? (result?.extractedRules as StoreContractTemplateExtractedRuleRow[])
          : []
      );
      setContractRuleEditDrafts((current) => {
        const nextDrafts = { ...current };
        for (const rule of Array.isArray(result?.extractedRules)
          ? (result?.extractedRules as StoreContractTemplateExtractedRuleRow[])
          : []) {
          nextDrafts[rule.id] = cleanText(rule.value_text) || "";
        }
        return nextDrafts;
      });
    },
    []
  );

  const fetchStoreContractTemplates = useCallback(async () => {
    if (!activeStoreId) {
      setStoreContractTemplate(null);
      setStoreContractActiveVersion(null);
      setStoreContractVersions([]);
      setStoreContractExtractedRules([]);
      setSelectedContractBaseFile(null);
      setContractRejectReasonDrafts({});
      setContractRuleEditDrafts({});
      setContractRuleEditingIds({});
      setContractsLoading(false);
      return;
    }

    setContractsLoading(true);

    try {
      const response = await fetch(
        `/api/store-contract-templates?storeId=${encodeURIComponent(activeStoreId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message || "Nao foi possivel carregar os contratos base da loja."
        );
      }

      applyStoreContractTemplateResponse(result);
      setContractsErrorText(null);
    } catch (error: any) {
      setContractsErrorText(
        error?.message || "Erro ao carregar os contratos base da loja."
      );
    } finally {
      setContractsLoading(false);
    }
  }, [activeStoreId, applyStoreContractTemplateResponse]);

  async function handleUploadContractBase() {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para enviar o contrato base.");
      setContractsSuccessText(null);
      return;
    }

    if (!selectedContractBaseFile) {
      setContractsErrorText("Selecione um arquivo PDF, DOC ou DOCX para continuar.");
      setContractsSuccessText(null);
      return;
    }

    setUploadingContractBase(true);
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const formData = new FormData();
      formData.set("storeId", activeStoreId);
      formData.set("file", selectedContractBaseFile);

      const response = await fetch("/api/store-contract-templates/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel enviar o contrato base.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato base enviado com sucesso.");
      setSelectedContractBaseFile(null);
      if (contractBaseInputRef.current) contractBaseInputRef.current.value = "";
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao enviar o contrato base.");
    } finally {
      setUploadingContractBase(false);
    }
  }

  function resolveStoreContractVersionAccess(versionId: string) {
    const version = storeContractVersions.find((item) => item.id === versionId);
    const normalizedStatus = normalizeContractVersionStatusValue(version?.status);
    const isActiveVersion =
      storeContractActiveVersion?.id === versionId || normalizedStatus === "active";
    const versionRules = storeContractExtractedRules.filter(
      (rule) => rule.template_version_id === versionId
    );
    const hasReadText = Boolean(cleanText(version?.raw_extracted_text));

    return {
      version,
      versionRules,
      isActiveVersion,
      hasReadText,
    };
  }

  async function handleApproveContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para aprovar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    const versionAccess = resolveStoreContractVersionAccess(versionId);
    if (!canApproveStoreContractVersion(versionAccess)) {
      setContractsErrorText("Essa versao ainda nao pode ser aprovada.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("approve");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(`/api/store-contract-templates/${versionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel aprovar essa versao.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato base aprovado com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao aprovar essa versao.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleRejectContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para rejeitar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    const versionAccess = resolveStoreContractVersionAccess(versionId);
    if (!isMutableStoreContractVersion(versionAccess)) {
      setContractsErrorText("Essa versao nao pode mais ser rejeitada.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("reject");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const rejectionReason = cleanText(contractRejectReasonDrafts[versionId]);
      const response = await fetch(`/api/store-contract-templates/${versionId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
          rejectionReason: rejectionReason || undefined,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel rejeitar essa versao.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Versao rejeitada com sucesso.");
      setContractRejectReasonDrafts((current) => ({
        ...current,
        [versionId]: "",
      }));
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao rejeitar essa versao.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleAnalyzeContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para analisar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    const versionAccess = resolveStoreContractVersionAccess(versionId);
    if (!canAnalyzeStoreContractVersion(versionAccess)) {
      setContractsErrorText("Essa versao nao pode ser analisada novamente.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("analyze");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(`/api/store-contract-templates/${versionId}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel ler esse arquivo.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato analisado com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Nao foi possivel ler esse arquivo.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleExtractContractRules(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para buscar regras.");
      setContractsSuccessText(null);
      return;
    }

    const versionAccess = resolveStoreContractVersionAccess(versionId);
    if (!canExtractRulesForStoreContractVersion(versionAccess)) {
      setContractsErrorText("Essa versao nao pode ter regras extraidas agora.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("extract-rules");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(
        `/api/store-contract-templates/${versionId}/extract-rules`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            storeId: activeStoreId,
          }),
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel encontrar regras nesse contrato.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Regras encontradas com sucesso.");
    } catch (error: any) {
      setContractsErrorText(
        error?.message || "Nao foi possivel encontrar regras nesse contrato."
      );
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleReviewContractRule(args: {
    ruleId: string;
    reviewStatus: "approved" | "rejected" | "edited";
  }) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para revisar essa regra.");
      setContractsSuccessText(null);
      return;
    }

    const rule = storeContractExtractedRules.find((item) => item.id === args.ruleId);
    const versionAccess = rule
      ? resolveStoreContractVersionAccess(rule.template_version_id)
      : null;
    if (!versionAccess || !canReviewRulesForStoreContractVersion(versionAccess)) {
      setContractsErrorText("Essa regra pertence a uma versao somente leitura.");
      setContractsSuccessText(null);
      return;
    }

    setContractRuleActionRuleId(args.ruleId);
    setContractRuleActionType(
      args.reviewStatus === "approved"
        ? "approve"
        : args.reviewStatus === "rejected"
          ? "reject"
          : "save-edit"
    );
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(
        `/api/store-contract-templates/rules/${args.ruleId}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            storeId: activeStoreId,
            reviewStatus: args.reviewStatus,
            valueText: contractRuleEditDrafts[args.ruleId] || undefined,
          }),
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel revisar essa regra.");
      }

      applyStoreContractTemplateResponse(result);
      if (args.reviewStatus === "edited") {
        setContractRuleEditingIds((current) => ({
          ...current,
          [args.ruleId]: false,
        }));
      }
      setContractsSuccessText("Regra atualizada com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Nao foi possivel revisar essa regra.");
    } finally {
      setContractRuleActionRuleId(null);
      setContractRuleActionType(null);
    }
  }

  const fetchPageData = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setCounts({ pools: 0, quimicos: 0, acessorios: 0, outros: 0 });
      setPoolCatalogSuggestionRows([]);
      setCatalogSuggestionRows([]);
      setCatalogQuality({ total: 0, withoutPrice: 0, unknownStock: 0, withoutPhotos: 0, inactive: 0 });
      setOnboarding(null);
      setAnswers({});
      setScheduleSettings(null);
      setOperationSettings(null);
      setStrategySettings(null);
      setChannelSettings(null);
      setCommercialAiSettings(null);
      setCanonicalPrimaryResponsible(null);
      setHasLoadedCanonicalPrimaryResponsible(false);
      setStoreBranding(null);
      setStoreLogoPreviewUrl(null);
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(null);
      setStoreWhatsappStatusLoading(false);
      setSelectedStoreLogoFile(null);
      setPoolImportFiles([]);
      setCatalogImportFiles([]);
      setStoreCatalogSettings(null);
      setIsCustomerCatalogEditing(false);
      setCustomerCatalogAllowDraft("Não");
      setCustomerCatalogFileIdsDraft([]);
      setSavingCustomerCatalogSettings(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);
    setCanonicalPrimaryResponsible(null);
    setHasLoadedCanonicalPrimaryResponsible(false);

    try {
      const [
        poolsResult,
        catalogResult,
        onboardingResult,
        answersResult,
        scheduleSettingsResult,
        operationSettingsResult,
        strategySettingsResult,
        channelSettingsResult,
        paymentSettingsResult,
        commercialAiSettingsResult,
        discountSettingsResult,
        highValueDiscountSettingsResult,
        catalogSettingsResult,
        primaryResponsibleResponse,
        monthlySalesGoalResponse,
      ] = await Promise.all([
        supabase
          .from("pools")
          .select("id, name, is_active, price_status, stock_status", { count: "exact" })
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
        supabase
          .from("store_catalog_items")
          .select("id, name, is_active, price_status, stock_status, metadata")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
        supabase.rpc("onboarding_get_store_onboarding_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        }),
        supabase.rpc("onboarding_get_answers_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        }),
        supabase
          .from("store_schedule_settings")
          .select("id, organization_id, store_id, allow_multiple_appointments_per_day, allow_same_time_appointments, same_time_capacity, attends_holidays, operating_days, operating_hours, installation_days, technical_visit_days, after_hours_behavior, notes, enforce_operating_window, timezone_name, holiday_mode, holiday_open_time, holiday_close_time, holiday_notes, human_schedule_configured_at, ai_after_hours_configured_at, agenda_capacity_configured_at, ai_can_accept_customer_reschedule_without_approval, customer_reschedule_autonomy_configured_at, daily_limit_mode, daily_limit, appointment_buffer_enabled, appointment_buffer_minutes, ai_after_hours_enabled, ai_after_hours_mode, ai_after_hours_start, ai_after_hours_end, ai_attends_holidays, created_at, updated_at")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_operation_settings")
          .select(
            "organization_id, store_id, offers_installation, average_installation_time_days, installation_days_rule, installation_process_notes, offers_technical_visit, technical_visit_days_rule, technical_visit_rules, technical_visit_rules_other, technical_visit_pricing_mode, technical_visit_fixed_fee_cents, technical_visit_case_by_case_rule, technical_visit_fee_deductible_from_purchase, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_strategy_settings")
          .select(
            "organization_id, store_id, city, state, service_regions, service_region_modes, service_region_primary_mode, service_region_outside_consultation, service_region_configured_at, service_region_notes, store_services, store_services_other, store_description, main_store_brand, brands_worked, strategy_service_exclusions, strategy_primary_focus, strategy_sell_more, strategy_common_customer, strategy_ideal_customer, strategy_ticket_range, strategy_positioning, strategy_priority_brands, strategy_non_worked_brands, strategy_top_lines, strategy_top_products, strategy_differentials, strategy_promise_limits, strategy_ai_presentation, strategy_ai_priorities, strategy_ai_never_forget, strategy_sell_more_choices, strategy_sell_more_other, strategy_sale_preference, strategy_sale_preference_other, strategy_customer_traits, strategy_customer_traits_other, strategy_attention_cases, strategy_attention_other, strategy_sale_value_range, strategy_sale_value_custom, strategy_commercial_experience_configured_at, strategy_priority_deal_types, strategy_priority_deal_types_other, strategy_avoid_cases, strategy_avoid_cases_other, strategy_avoid_action, strategy_commercial_strategy_configured_at, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_channel_settings")
          .select(
            "organization_id, store_id, commercial_channel_name, commercial_receives_real_clients, commercial_is_official_sales_channel, commercial_channel_type, commercial_entry_priority, commercial_human_handoff_enabled, commercial_channel_notes, integration_provider_name, integration_connection_mode, integrations_notes, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_payment_settings")
          .select(
            "organization_id, store_id, accepted_payment_methods, pix_key_type, pix_key, pix_holder_name, down_payment_mode, down_payment_value_type, down_payment_percent, down_payment_amount_cents, installments_enabled, max_installments, installment_interest_policy, payment_notes, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_commercial_ai_settings")
          .select(
            "organization_id, store_id, price_answer_policy, price_context_requirements, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_discount_settings")
          .select(
            "organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount, discount_autonomy_mode, discount_special_rules, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_high_value_discount_settings")
          .select(
            "organization_id, store_id, enabled, threshold_amount_cents, discount_percent, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .rpc("read_store_catalog_settings_multi_scoped", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
          })
          .maybeSingle(),
        fetch("/api/store/primary-responsible", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }),
        fetch("/api/store/monthly-sales-goal", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }),
      ]);

      if (poolsResult.error) throw poolsResult.error;
      if (catalogResult.error) throw catalogResult.error;
      if (onboardingResult.error) throw onboardingResult.error;
      if (answersResult.error) throw answersResult.error;
      if (scheduleSettingsResult.error) throw scheduleSettingsResult.error;
      if (operationSettingsResult.error) throw operationSettingsResult.error;
      if (strategySettingsResult.error) throw strategySettingsResult.error;
      if (channelSettingsResult.error) throw channelSettingsResult.error;
      if (paymentSettingsResult.error) throw paymentSettingsResult.error;
      if (commercialAiSettingsResult.error) throw commercialAiSettingsResult.error;
      if (discountSettingsResult.error) throw discountSettingsResult.error;
      if (highValueDiscountSettingsResult.error) throw highValueDiscountSettingsResult.error;
      if (catalogSettingsResult.error) throw catalogSettingsResult.error;

      const primaryResponsibleResult =
        (await primaryResponsibleResponse.json().catch(() => null)) as
          | StorePrimaryResponsibleApiResponse
          | null;

      if (!primaryResponsibleResponse.ok || !primaryResponsibleResult?.ok) {
        throw new Error(
          primaryResponsibleResult?.message ||
            "Nao foi possivel carregar o responsavel principal da loja.",
        );
      }
      const nextCanonicalPrimaryResponsible =
        primaryResponsibleResult.responsible ?? null;
      const monthlySalesGoalResult =
        (await monthlySalesGoalResponse.json().catch(() => null)) as
          | { ok: true; goal: StoreMonthlySalesGoalRow | StoreMonthlySalesGoalInput | null }
          | { ok: false; message?: string | null }
          | null;

      if (!monthlySalesGoalResponse.ok || !monthlySalesGoalResult?.ok) {
        const failure = monthlySalesGoalResult as { message?: string | null } | null;
        throw new Error(
          failure?.message ||
            "Nao foi possivel carregar a meta mensal da loja.",
        );
      }

      const nextMonthlySalesGoal = normalizeMonthlySalesGoalApiValue(
        monthlySalesGoalResult.goal,
      );

      const nextCounts: CountState = {
        pools: poolsResult.count ?? 0,
        quimicos: 0,
        acessorios: 0,
        outros: 0,
      };

      for (const row of (catalogResult.data || []) as CatalogItemRow[]) {
        const category = normalizeCategory(row?.metadata?.categoria);
        nextCounts[category] += 1;
      }

      const { data: importDestinationsData, error: importDestinationsError } = await supabase
        .from("store_import_file_items")
        .select("import_file_id, destination_type")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .in("destination_type", ["pool", "catalog_item"]);

      if (importDestinationsError) throw importDestinationsError;

      const poolImportIds = new Set<string>();
      const catalogImportIds = new Set<string>();

      for (const row of ((importDestinationsData || []) as Array<{ import_file_id: string; destination_type: string }>)) {
        const importFileId = String(row.import_file_id || "").trim();
        const destinationType = String(row.destination_type || "").trim();
        if (!importFileId) continue;
        if (destinationType === "pool") poolImportIds.add(importFileId);
        if (destinationType === "catalog_item") catalogImportIds.add(importFileId);
      }

      const allImportIds = Array.from(new Set([...poolImportIds, ...catalogImportIds]));
      let importFilesMap = new Map<string, StoreImportFileRow>();

      if (allImportIds.length > 0) {
        const { data: importFilesData, error: importFilesError } = await supabase
          .from("store_import_files")
          .select(
            "id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, created_at, updated_at"
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", allImportIds)
          .order("created_at", { ascending: false });

        if (importFilesError) throw importFilesError;

        importFilesMap = new Map(
          ((importFilesData || []) as StoreImportFileRow[]).map((item) => [item.id, item])
        );
      }

      const nextPoolImportFiles = Array.from(poolImportIds)
        .map((id) => importFilesMap.get(id))
        .filter(Boolean) as StoreImportFileRow[];
      const nextCatalogImportFiles = Array.from(catalogImportIds)
        .map((id) => importFilesMap.get(id))
        .filter(Boolean) as StoreImportFileRow[];

      nextPoolImportFiles.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });

      nextCatalogImportFiles.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });

      const poolRowsForQuality = (poolsResult.data ?? []) as PoolCatalogSuggestionRow[];
      const catalogRowsForQuality = (catalogResult.data ?? []) as CatalogItemRow[];
      const poolIdsForQuality = poolRowsForQuality.map((item) => item.id).filter(Boolean);
      const catalogIdsForQuality = catalogRowsForQuality.map((item) => item.id).filter(Boolean);
      const poolIdsWithPhotos = new Set<string>();
      const catalogIdsWithPhotos = new Set<string>();

      for (const ids of chunkArray(poolIdsForQuality, 100)) {
        if (ids.length === 0) continue;
        const { data: photoRows, error: photoError } = await supabase
          .from("pool_photos")
          .select("pool_id")
          .in("pool_id", ids);
        if (photoError) throw photoError;
        for (const row of (photoRows ?? []) as Array<{ pool_id: string }>) {
          if (row.pool_id) poolIdsWithPhotos.add(row.pool_id);
        }
      }

      for (const ids of chunkArray(catalogIdsForQuality, 100)) {
        if (ids.length === 0) continue;
        const { data: photoRows, error: photoError } = await supabase
          .from("store_catalog_item_photos")
          .select("catalog_item_id")
          .in("catalog_item_id", ids);
        if (photoError) throw photoError;
        for (const row of (photoRows ?? []) as Array<{ catalog_item_id: string }>) {
          if (row.catalog_item_id) catalogIdsWithPhotos.add(row.catalog_item_id);
        }
      }

      const allQualityRows = [
        ...poolRowsForQuality.map((item) => ({
          id: item.id,
          isActive: item.is_active !== false,
          priceStatus: cleanText(item.price_status),
          stockStatus: cleanText(item.stock_status),
          hasPhoto: poolIdsWithPhotos.has(item.id),
        })),
        ...catalogRowsForQuality.map((item) => ({
          id: item.id,
          isActive: item.is_active !== false,
          priceStatus: cleanText(item.price_status),
          stockStatus: cleanText(item.stock_status),
          hasPhoto: catalogIdsWithPhotos.has(item.id),
        })),
      ];

      const activeQualityRows = allQualityRows.filter((item) => item.isActive);
      const nextCatalogQuality: CatalogQualityState = {
        total: allQualityRows.length,
        withoutPrice: activeQualityRows.filter((item) => normalizeLoose(item.priceStatus) !== "valid").length,
        unknownStock: activeQualityRows.filter((item) => ["", "unknown"].includes(normalizeLoose(item.stockStatus))).length,
        withoutPhotos: activeQualityRows.filter((item) => !item.hasPhoto).length,
        inactive: allQualityRows.filter((item) => !item.isActive).length,
      };

      const nextAnswers = (answersResult.data ?? {}) as AnswersMap;
      const nextStrategySettings =
        (strategySettingsResult.data ?? null) as StoreStrategySettingsRow | null;
      const nextStrategyInput = createStoreStrategySettingsInputFromSources({
        answers: nextAnswers,
        settings: nextStrategySettings,
      });

      setCounts(nextCounts);
      setPoolCatalogSuggestionRows(poolRowsForQuality);
      setCatalogSuggestionRows(catalogRowsForQuality);
      setCatalogQuality(nextCatalogQuality);
      setOnboarding((onboardingResult.data ?? null) as OnboardingRow | null);
      setAnswers({
        ...nextAnswers,
        city: nextStrategyInput.city,
        state: nextStrategyInput.state,
        service_regions: nextStrategyInput.serviceRegions,
        service_region_modes: nextStrategyInput.serviceRegionModes,
        service_region_primary_mode: nextStrategyInput.serviceRegionPrimaryMode,
        service_region_outside_consultation:
          nextStrategyInput.serviceRegionOutsideConsultation,
        service_region_notes: nextStrategyInput.serviceRegionNotes,
        store_services: nextStrategyInput.storeServices,
        store_services_other: nextStrategyInput.storeServicesOther,
        store_description: nextStrategyInput.storeDescription,
        main_store_brand: nextStrategyInput.mainStoreBrand,
        brands_worked: nextStrategyInput.brandsWorked,
        strategy_service_exclusions: nextStrategyInput.strategyServiceExclusions,
        strategy_primary_focus: nextStrategyInput.strategyPrimaryFocus,
        strategy_sell_more: nextStrategyInput.strategySellMore,
        strategy_common_customer: nextStrategyInput.strategyCommonCustomer,
        strategy_ideal_customer: nextStrategyInput.strategyIdealCustomer,
        strategy_ticket_range: nextStrategyInput.strategyTicketRange,
        strategy_positioning: nextStrategyInput.strategyPositioning,
        strategy_priority_brands: nextStrategyInput.strategyPriorityBrands,
        strategy_non_worked_brands: nextStrategyInput.strategyNonWorkedBrands,
        strategy_top_lines: nextStrategyInput.strategyTopLines,
        strategy_top_products: nextStrategyInput.strategyTopProducts,
        strategy_differentials: nextStrategyInput.strategyDifferentials,
        strategy_promise_limits: nextStrategyInput.strategyPromiseLimits,
        strategy_ai_presentation: nextStrategyInput.strategyAiPresentation,
        strategy_ai_priorities: nextStrategyInput.strategyAiPriorities,
        strategy_ai_never_forget: nextStrategyInput.strategyAiNeverForget,
        strategy_ai_store_summary:
          deriveStoreStrategyAiStoreSummary(nextStrategyInput),
      });
      const nextScheduleSettings =
        (scheduleSettingsResult.data ?? null) as ScheduleSettingsRow | null;
      setScheduleSettings(nextScheduleSettings);
      setSavedOperationExperience((current) =>
        createScheduleOperationExperienceDraftFromSettings(
          nextScheduleSettings,
          current,
        ),
      );
      setOperationExperienceDraft((current) =>
        createScheduleOperationExperienceDraftFromSettings(
          nextScheduleSettings,
          current,
        ),
      );
      setOperationSettings(
        (operationSettingsResult.data ?? null) as StoreOperationSettingsRow | null,
      );
      setStrategySettings(nextStrategySettings);
      setChannelSettings((channelSettingsResult.data ?? null) as StoreChannelSettingsRow | null);
      setPaymentSettings((paymentSettingsResult.data ?? null) as StorePaymentSettingsRow | null);
      setCommercialAiSettings(
        (commercialAiSettingsResult.data ?? null) as StoreCommercialAiSettingsRow | null,
      );
      setMonthlySalesGoal(nextMonthlySalesGoal);
      setMonthlySalesGoalDraft(nextMonthlySalesGoal);
      setIsMonthlySalesGoalEditing(false);
      setDiscountSettings((discountSettingsResult.data ?? null) as StoreDiscountSettingsRow | null);
      setHighValueDiscountSettings(
        (highValueDiscountSettingsResult.data ?? null) as StoreHighValueDiscountSettingsRow | null,
      );
      const nextStoreCatalogSettings =
        (catalogSettingsResult.data ?? null) as StoreCatalogSettingsRow | null;
      const nextCustomerCatalogFileIds = Array.isArray(
        nextStoreCatalogSettings?.customer_catalog_import_file_ids,
      )
        ? nextStoreCatalogSettings.customer_catalog_import_file_ids
            .map((value) => cleanText(value))
            .filter(Boolean)
        : [];
      setStoreCatalogSettings(
        nextStoreCatalogSettings
          ? {
              ...nextStoreCatalogSettings,
              customer_catalog_import_file_ids: nextCustomerCatalogFileIds,
            }
          : null,
      );
      setCustomerCatalogAllowDraft(
        nextStoreCatalogSettings?.allow_full_catalog_send ? "Sim" : "Não",
      );
      setCustomerCatalogFileIdsDraft(nextCustomerCatalogFileIds);
      setCanonicalPrimaryResponsible(nextCanonicalPrimaryResponsible);
      setHasLoadedCanonicalPrimaryResponsible(true);
      setPoolImportFiles(nextPoolImportFiles);
      setCatalogImportFiles(nextCatalogImportFiles);
      await fetchStoreBrandingFromApi(activeStoreId);
      await fetchStoreWhatsappStatusFromApi(activeStoreId);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar a visão geral das configurações.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeStoreId]);


  const upsertConfigAnswers = useCallback(
    async (entries: Record<string, unknown>, successMessage: string) => {
      if (!organizationId || !activeStoreId) {
        setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alterações.");
        setSuccessText(null);
        return false;
      }

      try {
        const nextStoreName =
          typeof entries.store_display_name === "string"
            ? entries.store_display_name.trim()
            : "";
        const hasPrimaryResponsibleData =
          Object.prototype.hasOwnProperty.call(entries, "responsible_name") ||
          Object.prototype.hasOwnProperty.call(entries, "responsible_whatsapp");

        if (hasPrimaryResponsibleData) {
          const responsibleName =
            typeof entries.responsible_name === "string"
              ? entries.responsible_name.trim()
              : "";
          const responsibleWhatsapp =
            typeof entries.responsible_whatsapp === "string"
              ? entries.responsible_whatsapp.trim()
              : "";

          if (!responsibleName || !responsibleWhatsapp) {
            throw new Error(
              "Nome e WhatsApp do responsavel principal sao obrigatorios para sincronizar a configuracao."
            );
          }

          const { error: responsibleSyncError } = await supabase.rpc(
            "upsert_store_primary_responsible_with_legacy_mirror_scoped",
            {
              p_organization_id: organizationId,
              p_store_id: activeStoreId,
              p_name: responsibleName,
              p_whatsapp_number: responsibleWhatsapp,
            }
          );

          if (responsibleSyncError) throw responsibleSyncError;
        }

        const legacyEntries = Object.fromEntries(
          Object.entries(entries).filter(
            ([questionKey]) =>
              questionKey !== "responsible_name" &&
              questionKey !== "responsible_whatsapp"
          )
        );

        for (const [questionKey, rawValue] of Object.entries(legacyEntries)) {
          const answerValue =
            typeof rawValue === "string" ? rawValue.trim() : rawValue ?? null;

          const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_question_key: questionKey,
            p_answer: answerValue,
          });

          if (error) throw error;
        }

        if (nextStoreName) {
          const response = await fetch("/api/store/update-name", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              storeId: activeStoreId,
              name: nextStoreName,
            }),
          });

          const result = (await response.json().catch(() => null)) as
            | { ok?: boolean; message?: string; error?: string }
            | null;

          if (!response.ok || !result?.ok) {
            throw new Error(
              result?.message || "Nao foi possivel atualizar o nome oficial da loja."
            );
          }

          await refreshStores();
        }

        const currentStatus = cleanText(onboarding?.status).toLowerCase();
        const nextStatus = currentStatus === "completed" ? "completed" : "in_progress";

        const { error: onboardingError } = await supabase.rpc(
          "onboarding_upsert_store_onboarding_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_status: nextStatus,
          }
        );

        if (onboardingError) throw onboardingError;

        setAnswers((current) => ({
          ...current,
          ...entries,
        }));
        setSuccessText(successMessage);
        setErrorText(null);
        await fetchPageData();
        return true;
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao salvar alterações da configuração.");
        setSuccessText(null);
        return false;
      }
    },
    [organizationId, activeStoreId, onboarding?.status, fetchPageData]
  );

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    void fetchStoreContractTemplates();
  }, [fetchStoreContractTemplates]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (hasRestoredLocalDraftRef.current) return;
    if (loading) return;

    const raw = readFromLocalStorageSafe(configDraftStorageKey);
    hasRestoredLocalDraftRef.current = true;

    if (!raw) {
      hasInitializedLocalDraftRef.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedConfiguracoesState>;

      if (parsed.activeTab) setActiveTab(normalizeSettingsTabId(parsed.activeTab));
      if (typeof parsed.isOverviewEditing === "boolean") setIsOverviewEditing(parsed.isOverviewEditing);
      if (typeof parsed.isStrategyEditing === "boolean") setIsStrategyEditing(parsed.isStrategyEditing);
      if (typeof parsed.isOperationEditing === "boolean") setIsOperationEditing(parsed.isOperationEditing);
      if (typeof parsed.isCommercialEditing === "boolean") setIsCommercialEditing(parsed.isCommercialEditing);
      if (typeof parsed.isDiscountEditing === "boolean") setIsDiscountEditing(parsed.isDiscountEditing);
      if (typeof parsed.isChannelsEditing === "boolean") setIsChannelsEditing(parsed.isChannelsEditing);
      if (typeof parsed.showChannelsAdvanced === "boolean") setShowChannelsAdvanced(parsed.showChannelsAdvanced);
      if (typeof parsed.isActivationEditing === "boolean") setIsActivationEditing(parsed.isActivationEditing);
      if (parsed.overviewDraft) setOverviewDraft(parsed.overviewDraft);
      if (parsed.strategyDraft) setStrategyDraft(parsed.strategyDraft);
      if (parsed.operationDraft) {
        setOperationDraft((current) =>
          restoreOperationDraftWithoutScheduleAuthority(current, parsed.operationDraft ?? {}),
        );
      }
      if (parsed.commercialDraft) setCommercialDraft(parsed.commercialDraft);
      if (parsed.commercialExperienceDraft) {
        setCommercialExperienceDraft({
          ...createEmptyCommercialExperienceDraft(),
          ...parsed.commercialExperienceDraft,
        });
      }
      if (parsed.savedCommercialExperience) {
        setSavedCommercialExperience({
          ...createEmptyCommercialExperienceDraft(),
          ...parsed.savedCommercialExperience,
        });
      }
      if (parsed.brandExperienceDraft) {
        setBrandExperienceDraft({
          ...createEmptyBrandExperienceDraft(),
          ...parsed.brandExperienceDraft,
        });
      }
      if (parsed.savedBrandExperience) {
        setSavedBrandExperience({
          ...createEmptyBrandExperienceDraft(),
          ...parsed.savedBrandExperience,
        });
      }
      if (parsed.contractExperienceDraft) {
        setContractExperienceDraft({
          ...createEmptyContractExperienceDraft(),
          ...parsed.contractExperienceDraft,
        });
      }
      if (parsed.savedContractExperience) {
        setSavedContractExperience({
          ...createEmptyContractExperienceDraft(),
          ...parsed.savedContractExperience,
        });
      }
      if (typeof parsed.isCatalogImportedFilesOpen === "boolean") {
        setIsCatalogImportedFilesOpen(parsed.isCatalogImportedFilesOpen);
      }
      if (parsed.discountDraft) setDiscountDraft(parsed.discountDraft);
      if (parsed.channelDraft) setChannelDraft(parsed.channelDraft);
      if (parsed.primaryResponsibleDraft) setPrimaryResponsibleDraft(parsed.primaryResponsibleDraft);
      if (Array.isArray(parsed.additionalResponsiblesDraft)) setAdditionalResponsiblesDraft(parsed.additionalResponsiblesDraft);
      if (typeof parsed.activationConfirmInformationDraft === "boolean") {
        setActivationConfirmInformationDraft(parsed.activationConfirmInformationDraft);
      }
      if (typeof parsed.activationNotificationCasesDraft === "string") {
        setActivationNotificationCasesDraft(parsed.activationNotificationCasesDraft);
      }
      if (typeof parsed.activationPreferencesDraft === "string") {
        setActivationPreferencesDraft(parsed.activationPreferencesDraft);
      }
      if (parsed.poolForm) setPoolForm(parsed.poolForm);
      if (parsed.catalogForm) setCatalogForm(parsed.catalogForm);

      if (typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY) && parsed.scrollY >= 0) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: parsed.scrollY, behavior: "auto" });
          });
        });
      }
    } catch (error) {
      console.error("[ConfiguracoesPage] restore draft error:", error);
      removeFromLocalStorageSafe(configDraftStorageKey);
    } finally {
      hasInitializedLocalDraftRef.current = true;
    }
  }, [configDraftStorageKey, loading]);

  const persistConfiguracoesDraft = useCallback(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (!hasInitializedLocalDraftRef.current) return;

    const payload: PersistedConfiguracoesState = {
      activeTab,
      scrollY: window.scrollY,
      isOverviewEditing,
      isStrategyEditing,
      isOperationEditing,
      isCommercialEditing,
      isDiscountEditing,
      isChannelsEditing,
      showChannelsAdvanced,
      isActivationEditing,
      overviewDraft,
      strategyDraft,
      operationDraft,
      commercialDraft,
      commercialExperienceDraft,
      savedCommercialExperience,
      brandExperienceDraft,
      savedBrandExperience,
      contractExperienceDraft,
      savedContractExperience,
      isCatalogImportedFilesOpen,
      discountDraft,
      channelDraft,
      primaryResponsibleDraft,
      additionalResponsiblesDraft,
      activationConfirmInformationDraft,
      activationNotificationCasesDraft,
      activationPreferencesDraft,
      poolForm,
      catalogForm,
    };

    persistToLocalStorageSafe(configDraftStorageKey, JSON.stringify(payload));
  }, [
    configDraftStorageKey,
    activeTab,
    isOverviewEditing,
    isStrategyEditing,
    isOperationEditing,
    isCommercialEditing,
    isDiscountEditing,
    isChannelsEditing,
    showChannelsAdvanced,
    isActivationEditing,
    overviewDraft,
    strategyDraft,
    operationDraft,
    commercialDraft,
    commercialExperienceDraft,
    savedCommercialExperience,
    brandExperienceDraft,
    savedBrandExperience,
    contractExperienceDraft,
    savedContractExperience,
    isCatalogImportedFilesOpen,
    discountDraft,
    channelDraft,
    primaryResponsibleDraft,
    additionalResponsiblesDraft,
    activationConfirmInformationDraft,
    activationNotificationCasesDraft,
    activationPreferencesDraft,
    poolForm,
    catalogForm,
  ]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (!hasInitializedLocalDraftRef.current) return;
    persistConfiguracoesDraft();
  }, [configDraftStorageKey, persistConfiguracoesDraft]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;

    const persistNow = () => persistConfiguracoesDraft();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    };

    window.addEventListener("pagehide", persistNow);
    window.addEventListener("beforeunload", persistNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow);
      window.removeEventListener("beforeunload", persistNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [configDraftStorageKey, persistConfiguracoesDraft]);

  useEffect(() => {
    const currentOperationInput = createStoreOperationSettingsInputFromSources({
      answers,
      settings: operationSettings,
    });

    setOverviewDraft({
      store_display_name: cleanText(answers.store_display_name) || storeName,
      responsible_name: cleanText(canonicalPrimaryResponsibleDraft.name),
      responsible_whatsapp: cleanText(canonicalPrimaryResponsibleDraft.whatsapp),
      commercial_whatsapp: cleanText(answers.commercial_whatsapp),
      installation_days_rule: currentOperationInput.installationDaysRule,
      technical_visit_days_rule: currentOperationInput.technicalVisitDaysRule,
      final_activation_notes: cleanText(answers.final_activation_notes),
    });
  }, [answers, canonicalPrimaryResponsibleDraft, operationSettings, storeName]);

  useEffect(() => {
    setSelectedStoreLogoFile(null);
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    setSelectedContractBaseFile(null);
    setContractActionType(null);
    setContractRuleActionRuleId(null);
    setContractRuleActionType(null);
    setContractRuleEditDrafts({});
    setContractRuleEditingIds({});
    setContractContentModal(null);
    setContractRejectReasonDrafts({});
    setContractsErrorText(null);
    setContractsSuccessText(null);
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    if (selectedStoreLogoFile) {
      const objectUrl = URL.createObjectURL(selectedStoreLogoFile);
      setStoreLogoPreviewUrl(objectUrl);

      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }
  }, [selectedStoreLogoFile]);

  const totalCatalogo = useMemo(
    () => counts.pools + counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );


  const catalogSuggestionItems = useMemo<CatalogSuggestionItem[]>(() => {
    const items: CatalogSuggestionItem[] = [];

    for (const pool of poolCatalogSuggestionRows) {
      if (pool.is_active === false) continue;
      const name = cleanText(pool.name);
      if (!name) continue;
      items.push({
        key: `pool:${pool.id}`,
        category: "piscinas",
        label: name,
      });
    }

    for (const item of catalogSuggestionRows) {
      if (item.is_active === false) continue;
      const name = cleanText(item.name);
      if (!name) continue;

      const rawCategory = normalizeLoose(item.metadata?.categoria);
      let category: CatalogSuggestionItem["category"] = "outros_catalogo";
      if (rawCategory === "quimicos" || rawCategory === "quimico") category = "quimicos";
      else if (rawCategory === "acessorios" || rawCategory === "acessorio") category = "acessorios";
      else if (rawCategory === "equipamentos" || rawCategory === "equipamento") category = "equipamentos";

      const brand = cleanText(item.metadata?.brand);
      items.push({
        key: `catalog:${item.id}`,
        category,
        label: brand ? `${name} • ${brand}` : name,
      });
    }

    return items.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [catalogSuggestionRows, poolCatalogSuggestionRows]);


  const suggestionsCommercialConfigured = useMemo(() => {
    if (savedCommercialExperience.suggestions_enabled === "Não") return true;
    if (savedCommercialExperience.suggestions_enabled !== "Sim") return false;
    if (savedCommercialExperience.suggestion_types.length === 0) return false;
    if (!cleanText(savedCommercialExperience.better_option_policy)) return false;
    if (savedCommercialExperience.suggestion_types.includes("outro") && !cleanText(savedCommercialExperience.suggestion_other)) return false;

    return CATALOG_BACKED_SUGGESTION_TYPES.filter((type) =>
      savedCommercialExperience.suggestion_types.includes(type),
    ).every((type) => {
      const availableItems = catalogSuggestionItems.filter((item) => item.category === type);
      return availableItems.length > 0 && availableItems.some((item) =>
        savedCommercialExperience.suggestion_catalog_item_keys.includes(item.key),
      );
    });
  }, [catalogSuggestionItems, savedCommercialExperience]);

  const onboardingStatus = useMemo(
    () => resolveOnboardingLabel(onboarding?.status),
    [onboarding?.status]
  );

  const strategySettingsInput = useMemo(
    () =>
      createStoreStrategySettingsInputFromSources({
        answers,
        settings: strategySettings,
      }),
    [answers, strategySettings],
  );

  const canonicalCommercialExperience = useMemo(
    () => createCanonicalCommercialExperienceDraft(savedCommercialExperience, strategySettingsInput, strategySettings),
    [savedCommercialExperience, strategySettingsInput, strategySettings],
  );

  useEffect(() => {
    setSavedCommercialExperience((current) =>
      createCanonicalCommercialExperienceDraft(current, strategySettingsInput, strategySettings),
    );
    setCommercialExperienceDraft((current) =>
      createCanonicalCommercialExperienceDraft(current, strategySettingsInput, strategySettings),
    );
  }, [strategySettingsInput, strategySettings]);

  const derivedStrategyAiStoreSummary = useMemo(
    () => deriveStoreStrategyAiStoreSummary(strategySettingsInput),
    [strategySettingsInput],
  );

  useEffect(() => {
    setStrategyDraft(strategySettingsInput);
  }, [strategySettingsInput]);

  const strategyBaseItems = useMemo(() => {
    const city = cleanText(strategySettingsInput.city);
    const state = cleanText(strategySettingsInput.state);
    const serviceRegions = cleanText(strategySettingsInput.serviceRegions);
    const regionModes = joinSelectedLabels(
      strategySettingsInput.serviceRegionModes,
      SERVICE_REGION_MODE_OPTIONS
    );

    return buildBulletRows([
      { label: "Cidade base", value: city },
      { label: "Estado", value: state },
      { label: "Região principal de atendimento", value: serviceRegions },
      { label: "Até onde atende", value: regionModes },
      { label: "Observações sobre cobertura", value: cleanText(strategySettingsInput.serviceRegionNotes) },
    ]);
  }, [strategySettingsInput, strategySettings]);

  const strategyServicesItems = useMemo(() => {
    const services = joinSelectedLabels(
      strategySettingsInput.storeServices,
      STORE_SERVICE_OPTIONS,
      cleanText(strategySettingsInput.storeServicesOther)
    );

    return buildBulletRows([
      { label: "Serviços principais", value: services },
      { label: "Serviços extras", value: cleanText(strategySettingsInput.storeServicesOther) },
      { label: "Serviços que a loja não faz", value: cleanText(strategySettingsInput.strategyServiceExclusions) },
    ]);
  }, [strategySettingsInput, strategySettings]);

  const strategyCommercialFocusItems = useMemo(() => {
    return buildBulletRows([
      { label: "Tipo de loja / foco comercial", value: cleanText(strategySettingsInput.storeDescription) },
      { label: "Principal foco da loja", value: cleanText(strategySettingsInput.strategyPrimaryFocus) },
      { label: "Prioridades de venda", value: cleanText(strategySettingsInput.strategySellMore) },
      { label: "Tipo de cliente mais comum", value: cleanText(strategySettingsInput.strategyCommonCustomer) },
      { label: "Tipo de cliente ideal", value: cleanText(strategySettingsInput.strategyIdealCustomer) },
      { label: "Faixa de ticket mais comum", value: cleanText(strategySettingsInput.strategyTicketRange) },
      { label: "Posicionamento da loja", value: cleanText(strategySettingsInput.strategyPositioning) },
    ]);
  }, [strategySettingsInput, strategySettings]);

  const strategyBrandsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Marca principal", value: cleanText(strategySettingsInput.mainStoreBrand) },
      { label: "Outras marcas trabalhadas", value: cleanText(strategySettingsInput.brandsWorked) },
      { label: "Marcas prioritárias", value: cleanText(strategySettingsInput.strategyPriorityBrands) },
      { label: "Marcas que não trabalha", value: cleanText(strategySettingsInput.strategyNonWorkedBrands) },
      { label: "Linhas principais", value: cleanText(strategySettingsInput.strategyTopLines) },
      { label: "Produtos com maior giro", value: cleanText(strategySettingsInput.strategyTopProducts) },
    ]);
  }, [strategySettingsInput, strategySettings]);

  const strategyDifferentialsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Diferenciais da loja", value: cleanText(strategySettingsInput.strategyDifferentials) },
      { label: "O que não pode prometer", value: cleanText(strategySettingsInput.strategyPromiseLimits) },
      { label: "O que depende de visita", value: cleanText(answers.strategy_requires_visit) },
      { label: "O que depende de humano", value: cleanText(answers.strategy_requires_human) },
      { label: "Casos de exceção", value: cleanText(answers.strategy_exception_cases) },
    ]);
  }, [answers, strategySettingsInput]);

  const strategyAiSummaryItems = useMemo(() => {
    return buildBulletRows([
      { label: "Como a IA deve entender a loja", value: cleanText(derivedStrategyAiStoreSummary) },
      { label: "Como deve apresentar a loja", value: cleanText(strategySettingsInput.strategyAiPresentation) },
      { label: "O que a IA deve priorizar", value: cleanText(strategySettingsInput.strategyAiPriorities) },
      { label: "O que nunca deve esquecer", value: cleanText(strategySettingsInput.strategyAiNeverForget) },
    ]);
  }, [derivedStrategyAiStoreSummary, strategySettingsInput]);

  const poolTypesLabel = useMemo(() => {
    return joinSelectedLabels(
      parseArrayAnswer(answers.pool_types_selected),
      POOL_TYPE_OPTIONS,
      cleanText(answers.pool_types_other)
    );
  }, [answers]);

  const poolsOverviewMetrics = useMemo(() => {
    const stockRule = counts.pools > 0 ? "Controle por piscina" : "A definir";
    return [
      {
        label: "Piscinas cadastradas",
        value: String(counts.pools),
        tone: counts.pools > 0 ? ("green" as const) : ("gray" as const),
        hint: counts.pools > 0 ? "Já existe base manual/importada" : "Nenhuma piscina cadastrada ainda",
      },
      {
        label: "Fotos por piscina",
        value: "Até 10",
        tone: "gray" as const,
        hint: "Máximo de 50 MB por foto",
      },
      {
        label: "Status de venda",
        value: counts.pools > 0 ? "Controlado por item" : "Aguardando cadastro",
        tone: counts.pools > 0 ? ("green" as const) : ("amber" as const),
        hint: "Ativa/inativa e vendível por piscina",
      },
      {
        label: "Estoque",
        value: stockRule,
        tone: counts.pools > 0 ? ("green" as const) : ("gray" as const),
        hint: "Quantidade disponível por item",
      },
    ];
  }, [counts.pools]);

  const poolsOperationalItems = useMemo(() => {
    return buildBulletRows([
      { label: "Tipos de piscina trabalhados", value: poolTypesLabel || cleanText(answers.pool_types) },
      { label: "Marca principal para piscinas", value: cleanText(strategySettingsInput.mainStoreBrand) || cleanText(strategySettingsInput.brandsWorked) },
      { label: "Cadastro manual", value: "Pode cadastrar piscina completa com medidas, estoque, preço, fotos, itens inclusos e observações" },
      { label: "Fotos", value: counts.pools > 0 ? "Gerenciadas por piscina, com até 10 imagens" : "Quando cadastrar, poderá subir até 10 imagens por piscina" },
      { label: "Preço e estoque", value: "Preenchidos diretamente na própria aba de Configurações" },
      { label: "Campos esperados", value: "Nome, marca, material, formato, cor, acabamento, medidas, descrição, itens inclusos e observações de instalação" },
      { label: "Edição e exclusão", value: "Devem continuar disponíveis nas páginas internas de piscinas" },
      { label: "Importação inteligente", value: "Continua existindo sem depender deste cadastro manual" },
    ]);
  }, [answers, counts.pools, poolTypesLabel, strategySettingsInput]);

  const catalogOverviewMetrics = useMemo(() => {
    return [
      {
        label: "Total do catálogo",
        value: String(totalCatalogo),
        tone: totalCatalogo > 0 ? ("green" as const) : ("gray" as const),
        hint: `${counts.quimicos} químicos • ${counts.acessorios} acessórios • ${counts.outros} outros`,
      },
      {
        label: "Fotos por item",
        value: "Até 10",
        tone: "gray" as const,
        hint: "Máximo de 50 MB por foto",
      },
      {
        label: "Controle de estoque",
        value: totalCatalogo > 0 ? "Por item" : "A definir",
        tone: totalCatalogo > 0 ? ("green" as const) : ("gray" as const),
        hint: "Ativo/inativo, estoque e SKU por cadastro",
      },
      {
        label: "Cadastro manual",
        value: "Disponível",
        tone: "green" as const,
        hint: "Químicos, acessórios e outros na mesma aba",
      },
    ];
  }, [counts.quimicos, counts.acessorios, counts.outros, totalCatalogo]);

  const catalogOperationalItems = useMemo(() => {
    return buildBulletRows([
      { label: "Produtos químicos", value: String(counts.quimicos) },
      { label: "Acessórios", value: String(counts.acessorios) },
      { label: "Outros itens", value: String(counts.outros) },
      { label: "Cadastro manual", value: "Pode cadastrar item com categoria, SKU, marca, linha, medidas, peso, aplicação, descrição e fotos" },
      { label: "Campos principais", value: "Nome, categoria, SKU, marca, linha, unidade, tamanho, medidas, peso, preço, estoque, aplicação e observações técnicas" },
      { label: "Fotos", value: totalCatalogo > 0 ? "Gerenciadas por item, com até 10 imagens" : "Quando cadastrar, poderá subir até 10 imagens por item" },
      { label: "Preço e estoque", value: "Controlados item por item dentro da própria aba de Configurações" },
      { label: "Edição e exclusão", value: "Devem continuar disponíveis nas páginas internas de catálogo" },
      { label: "Importação inteligente", value: "Continua existindo sem depender deste cadastro manual" },
    ]);
  }, [counts.quimicos, counts.acessorios, counts.outros, totalCatalogo]);

  const installationDaysSelected = useMemo(
    () =>
      Array.isArray(scheduleSettings?.installation_days)
        ? (scheduleSettings.installation_days as unknown[])
            .map((item) => cleanText(item))
            .filter(Boolean)
        : [],
    [scheduleSettings?.installation_days],
  );

  const technicalVisitDaysSelected = useMemo(
    () =>
      Array.isArray(scheduleSettings?.technical_visit_days)
        ? (scheduleSettings.technical_visit_days as unknown[])
            .map((item) => cleanText(item))
            .filter(Boolean)
        : [],
    [scheduleSettings?.technical_visit_days],
  );

  const installationDaysLabel = useMemo(
    () => joinSelectedLabels(installationDaysSelected, DAYS_OF_WEEK_OPTIONS),
    [installationDaysSelected]
  );

  const technicalVisitDaysLabel = useMemo(
    () => joinSelectedLabels(technicalVisitDaysSelected, DAYS_OF_WEEK_OPTIONS),
    [technicalVisitDaysSelected]
  );

  const operationSettingsInput = useMemo(
    () =>
      createStoreOperationSettingsInputFromSources({
        answers,
        settings: operationSettings,
      }),
    [answers, operationSettings],
  );

  const isTechnicalVisitConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.technical_visit_configured_at,
  );

  const isInstallationConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.installation_configured_at,
  );

  const isPoolReplacementConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.pool_replacement_configured_at,
  );

  const isDeliveryConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.delivery_configured_at,
  );

  const isPickupConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.pickup_configured_at,
  );

  const isTechnicalServicesConfigured = isConfiguredTimestamp(
    operationExecutionPolicies?.technical_services_configured_at,
  );

  const technicalVisitExecutionPolicy = isTechnicalVisitConfigured
    ? operationExecutionPolicies?.technical_visit_policy ?? null
    : null;

  const installationExecutionPolicy = isInstallationConfigured
    ? operationExecutionPolicies?.installation_policy ?? null
    : null;

  const poolReplacementExecutionPolicy = isPoolReplacementConfigured
    ? operationExecutionPolicies?.pool_replacement_policy ?? null
    : null;

  const deliveryExecutionPolicy = isDeliveryConfigured
    ? operationExecutionPolicies?.delivery_policy ?? null
    : null;

  const pickupExecutionPolicy = isPickupConfigured
    ? operationExecutionPolicies?.pickup_policy ?? null
    : null;

  const technicalServicesExecutionPolicy = isTechnicalServicesConfigured
    ? operationExecutionPolicies?.technical_services_policy ?? null
    : null;

  const technicalVisitCardIsComplete =
    isTechnicalVisitConfigured &&
    operationSettingsInput.offersTechnicalVisit !== null &&
    (
      operationSettingsInput.offersTechnicalVisit === false ||
      technicalVisitExecutionPolicy !== null
    );

  const installationCardIsComplete =
    isInstallationConfigured &&
    operationSettingsInput.offersInstallation !== null &&
    (
      operationSettingsInput.offersInstallation === false ||
      installationExecutionPolicy !== null
    );

  const poolReplacementCardIsComplete =
    isPoolReplacementConfigured;

  const deliveryCardIsComplete =
    isDeliveryConfigured;

  const pickupCardIsComplete =
    isPickupConfigured;

  const technicalServicesCardIsComplete =
    isTechnicalServicesConfigured;
  const technicalVisitRulesLabel = useMemo(
    () =>
      joinSelectedLabels(
        operationSettingsInput.technicalVisitRules,
        TECHNICAL_VISIT_RULE_OPTIONS,
        operationSettingsInput.technicalVisitRulesOther,
      ),
    [operationSettingsInput],
  );

  const servesSaturdayLabel = useMemo(
    () => deriveCanonicalWeekendAvailabilityLabel("sabado", scheduleSettings),
    [scheduleSettings],
  );
  const servesSundayLabel = useMemo(
    () => deriveCanonicalWeekendAvailabilityLabel("domingo", scheduleSettings),
    [scheduleSettings],
  );
  const servesHolidayLabel =
    isConfiguredTimestamp(scheduleSettings?.human_schedule_configured_at) &&
    cleanText(scheduleSettings?.holiday_mode)
      ? optionLabel(toUiHolidayMode(scheduleSettings?.holiday_mode), [
          { value: "fechado", label: "NÃ£o atende" },
          { value: "normal", label: "HorÃ¡rio normal" },
          { value: "especial", label: "HorÃ¡rio especial" },
          { value: "caso_a_caso", label: "Caso a caso" },
        ])
      : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL;

  const isRegionConfigured = isConfiguredTimestamp(
    strategySettings?.service_region_configured_at,
  );

  const canonicalRegionOutsidePolicy = isRegionConfigured
    ? strategySettings?.service_region_outside_consultation === true
      ? "consulta"
      : "nao"
    : "";
  const operationReadinessMetrics = useMemo(() => {
    const hasOperationalSchedule = Boolean(scheduleSettings);
    const hasInstallation = operationSettingsInput.offersInstallation === true;
    const hasVisit = operationSettingsInput.offersTechnicalVisit === true;
    const serviceRegions = cleanText(strategySettingsInput.serviceRegions) || cleanText(strategySettingsInput.serviceRegionNotes);
    const compactOperationalHint = summarizeMetricText(
      installationDaysLabel || technicalVisitDaysLabel || "Defina os dias reais de operação",
      70
    );
    const compactVisitHint = summarizeMetricText(
      technicalVisitRulesLabel || technicalVisitDaysLabel || "Defina regras e disponibilidade de visita",
      70
    );
    const compactCoverageHint = summarizeMetricText(
      serviceRegions || "Defina regiões e política de deslocamento",
      70
    );
    const sameTimeAllowed = scheduleSettings
      ? yesNoLabel(scheduleSettings.allow_same_time_appointments)
      : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL;
    const sameTimeCapacity =
      scheduleSettings && Number.isFinite(Number(scheduleSettings.same_time_capacity))
        ? String(scheduleSettings.same_time_capacity)
        : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL;

    return [
      {
        label: "Atendimento operacional",
        value: hasOperationalSchedule ? "Configurado" : "Pendente",
        tone: hasOperationalSchedule ? ("green" as const) : ("amber" as const),
        hint: compactOperationalHint,
      },
      {
        label: "Instalação",
        value: hasInstallation ? "Ativa" : "Não configurada",
        tone: hasInstallation ? ("green" as const) : ("gray" as const),
        hint: operationSettingsInput.averageInstallationTimeDays != null
          ? `Prazo médio: ${operationSettingsInput.averageInstallationTimeDays} dia(s)`
          : "Defina prazo e etapas da instalação",
      },
      {
        label: "Visita técnica",
        value: hasVisit ? "Ativa" : "Não configurada",
        tone: hasVisit ? ("green" as const) : ("gray" as const),
        hint: compactVisitHint,
      },
      {
        label: "Agenda no mesmo horário",
        value: scheduleSettings
          ? sameTimeAllowed === "Sim"
            ? `Permitido • cap. ${sameTimeCapacity}`
            : "Bloqueado"
          : "Pendente",
        tone: sameTimeAllowed === "Sim" ? ("green" as const) : ("amber" as const),
        hint: scheduleSettings
          ? sameTimeAllowed === "Sim"
            ? "A agenda permite múltiplos compromissos no mesmo horário."
            : compactCoverageHint
          : "Agenda canônica ainda não configurada.",
      },
    ];
  }, [installationDaysSelected.length, technicalVisitDaysSelected.length, installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel, scheduleSettings, strategySettingsInput, operationSettingsInput]);

  const operationSections = useMemo(() => {
    return [
      {
        title: "Disponibilidade operacional",
        items: buildBulletRows([
          { label: "Dias de instalação", value: installationDaysLabel },
          { label: "Regra complementar da instalação", value: operationSettingsInput.installationDaysRule },
          { label: "Dias de visita técnica", value: technicalVisitDaysLabel },
          { label: "Regra complementar da visita técnica", value: operationSettingsInput.technicalVisitDaysRule },
          { label: "Atende sábado", value: servesSaturdayLabel },
          { label: "Atende domingo", value: servesSundayLabel },
          { label: "Atende feriado", value: servesHolidayLabel },
        ]),
      },
      {
        title: "Visita técnica",
        items: buildBulletRows([
          { label: "Faz visita técnica", value: yesNoLabel(operationSettingsInput.offersTechnicalVisit) },
          { label: "Regras da visita", value: technicalVisitRulesLabel },
        ]),
      },
      {
        title: "Instalação",
        items: buildBulletRows([
          { label: "Faz instalação", value: yesNoLabel(operationSettingsInput.offersInstallation) },
          { label: "Prazo médio", value: operationSettingsInput.averageInstallationTimeDays != null ? `${operationSettingsInput.averageInstallationTimeDays} dia(s)` : "Não definido" },
          { label: "Observações operacionais da instalação", value: operationSettingsInput.installationProcessNotes },
        ]),
      },
      {
        title: "Cobertura e deslocamento",
        items: buildBulletRows([
          { label: "Regiões atendidas", value: cleanText(strategySettingsInput.serviceRegions) || cleanText(strategySettingsInput.serviceRegionNotes) },
          { label: "Cobertura principal", value: joinSelectedLabels(strategySettingsInput.serviceRegionModes, SERVICE_REGION_MODE_OPTIONS) },
        ]),
      },
      {
        title: "Capacidade da agenda",
        items: buildBulletRows([
          { label: "Pode ter vários compromissos no dia", value: scheduleSettings ? yesNoLabel(scheduleSettings.allow_multiple_appointments_per_day) : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL },
          { label: "Pode ter compromissos no mesmo horário", value: scheduleSettings ? yesNoLabel(scheduleSettings.allow_same_time_appointments) : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL },
          { label: "Capacidade máxima no mesmo horário", value: scheduleSettings && Number.isFinite(Number(scheduleSettings.same_time_capacity)) ? String(scheduleSettings.same_time_capacity) : CANONICAL_SCHEDULE_NOT_CONFIGURED_LABEL },
        ]),
      },
    ];
  }, [installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel, servesSaturdayLabel, servesSundayLabel, servesHolidayLabel, scheduleSettings, strategySettingsInput, operationSettingsInput]);

  const commercialIdentityItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome da IA no atendimento", value: cleanText(answers.store_display_name) || "Não definido" },
      { label: "Como a IA se apresenta", value: cleanText(strategySettingsInput.strategyAiPresentation) || "Não definido" },
      { label: "Tom comercial da IA", value: joinSelectedLabels(parseArrayAnswer(answers.activation_preferences), [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS], cleanText(answers.activation_preferences_other)) || "Ainda não definido" },
      { label: "Fala como", value: cleanText(answers.ai_identity_mode) || "Equipe da loja" },
    ]);
  }, [answers, strategySettingsInput]);

  const commercialAiSettingsInput = useMemo(
    () =>
      createStoreCommercialAiSettingsInputFromSources({
        answers,
        settings: commercialAiSettings,
      }),
    [answers, commercialAiSettings],
  );

  const commercialAiLegacyMirrors = useMemo(() => {
    const normalized =
      normalizeStoreCommercialAiSettingsInput(commercialAiSettingsInput);
    return normalized.ok
      ? deriveStoreCommercialAiLegacyMirrors(normalized.value)
      : null;
  }, [commercialAiSettingsInput]);

  const commercialDraftPriceRulePreview = useMemo(() => {
    const normalized = normalizeStoreCommercialAiSettingsInput({
      priceAnswerPolicy: commercialDraft.price_answer_policy,
      priceContextRequirements: commercialDraft.price_context_requirements,
    });
    return normalized.ok
      ? deriveStoreCommercialAiLegacyMirrors(normalized.value).price_direct_rule
      : commercialDraft.price_policy_summary;
  }, [commercialDraft]);

  const commercialPriceItems = useMemo(() => {
    const priceAnswerPolicyLabel =
      PRICE_ANSWER_POLICY_OPTIONS.find(
        (option) => option.value === commercialAiSettingsInput.priceAnswerPolicy,
      )?.label || commercialAiSettingsInput.priceAnswerPolicy;
    const priceContextRequirementsLabel =
      joinSelectedLabels(
        commercialAiSettingsInput.priceContextRequirements,
        PRICE_CONTEXT_REQUIREMENT_OPTIONS,
      ) || "Sem requisito configurado";

    return buildBulletRows([
      { label: "Política de resposta de preço", value: priceAnswerPolicyLabel },
      { label: "Requisitos antes de preço não-catalogado", value: priceContextRequirementsLabel },
      { label: "Regra principal de preço", value: commercialAiLegacyMirrors?.price_direct_rule || cleanText(answers.price_direct_rule) },
    ]);
  }, [answers, commercialAiLegacyMirrors, commercialAiSettingsInput]);

  const commercialHumanHelpItems = useMemo(() => {
    return buildBulletRows([
      { label: "Casos de desconto", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS, cleanText(answers.human_help_discount_cases_other)) },
      { label: "Projetos fora do padrão", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_custom_project_cases_selected), HUMAN_HELP_CUSTOM_PROJECT_OPTIONS, cleanText(answers.human_help_custom_project_cases_other)) },
      { label: "Pagamentos e validações", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_payment_cases_selected), HUMAN_HELP_PAYMENT_OPTIONS, cleanText(answers.human_help_payment_cases_other)) },
    ]);
  }, [answers]);

  const discountPresentation = useMemo(() => {
    return createStoreDiscountPresentationFromSources({
      answers,
      settings: discountSettings,
      highValueSettings: highValueDiscountSettings,
    });
  }, [answers, discountSettings, highValueDiscountSettings]);

  const channelSettingsInput = useMemo(() => {
    return createStoreChannelSettingsInputFromSources({
      answers,
      settings: channelSettings,
    });
  }, [answers, channelSettings]);

  const storeWhatsappVisualStatus = useMemo(
    () => resolveStoreWhatsappVisualStatus(storeWhatsappStatus),
    [storeWhatsappStatus]
  );
  const connectedCommercialWhatsapp = cleanText(
    storeWhatsappStatus?.displayPhoneNumber,
  );
  const primaryResponsibleName = cleanText(loadedCanonicalPrimaryResponsible?.name);
  const primaryResponsibleWhatsapp = cleanText(
    loadedCanonicalPrimaryResponsible?.whatsappNumber,
  );
  const primaryResponsibleChannelLabel =
    resolveResponsibleChannelLabel(primaryResponsibleName);
  const storeWhatsappSafeErrorText = resolveHumanReadableWhatsappSafeError(
    storeWhatsappStatus?.lastSafeError,
  );

  const commercialPaymentCardStatus = useMemo(
    () =>
      resolveCommercialPaymentCardStatus({
        paymentSettings,
        commercialDraft,
        commercialExperienceDraft,
      }),
    [commercialDraft, commercialExperienceDraft, paymentSettings],
  );

  const commercialPaymentItems = useMemo(() => {
    const paymentPresentation = createStorePaymentPresentationFromSources({
      answers,
      settings: paymentSettings,
    });
    const pixConfigured = commercialDraft.accepted_payment_methods.includes("pix")
      ? cleanText(commercialDraft.pix_key_type) && cleanText(commercialDraft.pix_key)
        ? "Configurado"
        : "Pendente"
      : "Não aceita Pix";
    const financingConfigured = commercialDraft.accepted_payment_methods.includes("financiamento")
      ? savedCommercialExperience.financing_mode
        ? optionLabel(savedCommercialExperience.financing_mode, [
            { value: "parceiro", label: "Banco / financeira parceira" },
            { value: "loja", label: "Intermediado pela loja" },
            { value: "cliente", label: "Cliente busca diretamente" },
            { value: "depende", label: "Depende do caso" },
            { value: "outro", label: "Outro modelo" },
          ])
        : "Precisa configurar"
      : "Não aceita";
    return buildBulletRows([
      { label: "Formas aceitas", value: paymentPresentation.paymentSummary || "Não definido" },
      { label: "Pix", value: pixConfigured },
      { label: "Parcelamento", value: normalizeLoose(commercialDraft.installments_enabled) === "sim" ? `Até ${cleanText(commercialDraft.max_installments) || "?"}x` : normalizeLoose(commercialDraft.installments_enabled) === "nao" ? "Não parcela" : "Não definido" },
      { label: "Financiamento", value: financingConfigured },
    ]);
  }, [answers, commercialDraft, paymentSettings, savedCommercialExperience.financing_mode]);

  const commercialNegotiationItems = useMemo(() => {
    return buildBulletRows([
      { label: "Regras gerais de negociação", value: joinSelectedLabels(parseArrayAnswer(answers.price_must_understand_before), PRICE_DIRECT_BEFORE_OPTIONS) || cleanText(answers.negotiation_rules_summary) || cleanText(answers.price_direct_rule) },
      { label: "Limites de promessa da IA", value: cleanText(answers.final_activation_notes) || cleanText(answers.store_description) },
      { label: "Pós-venda", value: joinSelectedLabels(parseArrayAnswer(answers.sales_flow_final_steps), SALES_FLOW_FINAL_OPTIONS, cleanText(answers.sales_flow_notes)) || cleanText(answers.sales_flow_notes) },
      { label: "Comportamento fora do horário", value: cleanText(answers.after_hours_behavior) || "Acolher, qualificar e alinhar próximo passo sem prometer execução imediata." },
      { label: "Resumo comercial para a IA", value: cleanText(answers.commercial_ai_summary) || cleanText(answers.price_direct_rule) || "Ainda não definido" },
    ]);
  }, [answers]);

  const commercialOverviewMetrics = useMemo(() => {
    const priceAnswerPolicy =
      commercialAiSettingsInput.priceAnswerPolicy;
    const canTalkPrice =
      priceAnswerPolicy === "human_required_for_price"
        ? "Humano"
        : priceAnswerPolicy === "range_only_when_asked"
          ? "Faixa"
          : "Direto";
    const canDiscount = discountPresentation.canOfferDiscount ? "Sim" : "Nao";
    const rawTone =
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        ACTIVATION_STYLE_OPTIONS,
        cleanText(answers.activation_preferences_other)
      ) || "A definir";
    const humanCasesSummary = [
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_discount_cases_selected),
        HUMAN_HELP_DISCOUNT_OPTIONS,
        cleanText(answers.human_help_discount_cases_other)
      ),
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_custom_project_cases_selected),
        HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
        cleanText(answers.human_help_custom_project_cases_other)
      ),
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_payment_cases_selected),
        HUMAN_HELP_PAYMENT_OPTIONS,
        cleanText(answers.human_help_payment_cases_other)
      ),
      cleanText(answers.human_help_general_summary),
    ]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        label: "Preço direto",
        value: canTalkPrice,
        tone: priceAnswerPolicy === "human_required_for_price" ? ("amber" as const) : ("green" as const),
        hint: "Política canonical de resposta de preço da IA",
      },
      {
        label: "Desconto",
        value: canDiscount,
        tone: discountPresentation.maxDiscountPercent != null ? ("green" as const) : ("gray" as const),
        hint:
          discountPresentation.policySummary ||
          "Primeiro degrau, teto normal, autonomia e alto valor",
      },
      {
        label: "Tom da IA",
        value: rawTone === "A definir" ? rawTone : summarizeMetricText(rawTone, 26),
        tone: rawTone === "A definir" ? ("gray" as const) : ("green" as const),
        hint: rawTone === "A definir" ? "Personalidade comercial viva da IA" : summarizeMetricText(rawTone, 72),
      },
      {
        label: "Casos que chamam humano",
        value: humanCasesSummary ? "Configurado" : "A definir",
        tone: humanCasesSummary ? ("green" as const) : ("amber" as const),
        hint: humanCasesSummary ? summarizeMetricText(humanCasesSummary, 72) : "Desconto, projeto especial, pagamento e exceções",
      },
    ];
  }, [answers, commercialAiSettingsInput, discountPresentation]);

  const activationItems = useMemo(() => {
    const notificationCases = joinSelectedLabels(
      parseArrayAnswer(answers.responsible_notification_cases),
      RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
      cleanText(answers.responsible_notification_cases_other)
    );
    const activationPrefs = joinSelectedLabels(
      parseArrayAnswer(answers.activation_preferences),
      ACTIVATION_STYLE_OPTIONS,
      cleanText(answers.activation_preferences_other)
    );

    return buildBulletRows([
      { label: "Responsável principal", value: primaryResponsibleName },
      { label: "WhatsApp do responsável", value: primaryResponsibleWhatsapp },
      { label: "Observações do responsável", value: cleanText(answers.responsible_notes) },
      { label: "A IA avisa o responsável", value: yesNoLabel(answers.ai_should_notify_responsible) },
      { label: "Canal para falar com a IA assistente", value: activationPrefs },
      { label: "Web chat interno", value: "Previsto como canal do sistema" },
      { label: "Número/chip dedicado", value: cleanText(answers.commercial_whatsapp) },
      { label: "Futuro Telegram", value: "Previsto para expansão" },
      { label: "Dados mínimos para ativação", value: yesNoLabel(answers.confirm_information_is_correct) },
      { label: "Checklist de ativação real", value: notificationCases },
      { label: "Status da ativação da loja", value: resolveOnboardingLabel(onboarding?.status).label },
    ]);
  }, [answers, onboarding?.status, primaryResponsibleName, primaryResponsibleWhatsapp]);

  const discountItems = useMemo(() => {
    const autonomyLabel =
      discountPresentation.autonomyMode === "within_limit"
        ? "Pode confirmar descontos dentro do limite"
        : discountPresentation.autonomyMode === "guided"
          ? "Pode negociar aos poucos dentro do limite"
          : "Sempre precisa de aprovação humana";
    return buildBulletRows([
      {
        label: "Desconto inicial para negociar",
        value: discountPresentation.defaultDiscountPercent == null ? "Não definido" : `${discountPresentation.defaultDiscountPercent}%`,
      },
      {
        label: "Maior desconto da negociação normal",
        value: discountPresentation.maxDiscountPercent == null ? "Não definido" : `${discountPresentation.maxDiscountPercent}%`,
      },
      { label: "A IA pode confirmar sozinha", value: autonomyLabel },
      { label: "Pode consultar acima do limite", value: discountPresentation.allowAskAboveMaxDiscount ? "Sim" : "Não" },
      {
        label: "Regra para vendas de valor alto",
        value: discountPresentation.highValueEnabled
          ? `A partir do valor configurado${discountPresentation.highValueDiscountPercent == null ? "" : ` • desconto ${discountPresentation.highValueDiscountPercent}%`}`
          : "Não usa regra diferente",
      },
      {
        label: "Aprovação em venda de valor alto",
        value: discountPresentation.highValueEnabled
          ? savedCommercialExperience.high_value_requires_human || "Não definido"
          : "Não se aplica",
      },
    ]);
  }, [discountPresentation, savedCommercialExperience.high_value_requires_human]);

  const channelsOverviewMetrics = useMemo(() => {
    const integrationStatus =
      cleanText(storeWhatsappVisualStatus.label) ||
      resolveOnboardingLabel(onboarding?.status).label;
    const canonicalSettingsReady =
      cleanText(channelSettingsInput.commercialChannelName) &&
      cleanText(channelSettingsInput.integrationProviderName) &&
      cleanText(channelSettingsInput.integrationConnectionMode);

    return [
      {
        label: "Canal comercial",
        value: connectedCommercialWhatsapp ? "Conectado" : "Pendente",
        tone: connectedCommercialWhatsapp ? ("green" as const) : ("amber" as const),
        hint:
          connectedCommercialWhatsapp ||
          "O WhatsApp comercial oficial e derivado do status vivo da integracao.",
      },
      {
        label: "Canal do responsável",
        value: primaryResponsibleWhatsapp ? "Configurado" : "Pendente",
        tone: primaryResponsibleWhatsapp ? ("green" as const) : ("amber" as const),
        hint:
          primaryResponsibleWhatsapp ||
          "Defina o responsavel principal na configuracao canonica de responsaveis.",
      },
      {
        label: "Configuração canônica",
        value: canonicalSettingsReady ? "Definida" : "Pendente",
        tone: canonicalSettingsReady ? ("green" as const) : ("amber" as const),
        hint: canonicalSettingsReady
          ? "Os campos canônicos principais desta família já foram definidos."
          : "Revise nome comercial, provedor principal e modo de conexão.",
      },
      {
        label: "Integrações externas",
        value: integrationStatus || "Pendente",
        tone: integrationStatus === "Concluído" ? ("green" as const) : ("amber" as const),
        hint:
          channelSettingsInput.integrationsNotes ||
          "A configuracao humana define provedor, modo de conexao e notas permanentes.",
      },
    ];
  }, [
    channelSettingsInput.commercialChannelName,
    channelSettingsInput.integrationConnectionMode,
    channelSettingsInput.integrationProviderName,
    channelSettingsInput.integrationsNotes,
    connectedCommercialWhatsapp,
    onboarding?.status,
    primaryResponsibleWhatsapp,
    storeWhatsappVisualStatus.label,
  ]);


  const channelEssentialPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!connectedCommercialWhatsapp) {
      pendencies.push("Conectar o WhatsApp oficial da loja para habilitar o canal comercial real.");
    }
    if (!primaryResponsibleWhatsapp) {
      pendencies.push("Definir o WhatsApp do responsavel principal na configuracao canonica de responsaveis.");
    }
    if (!cleanText(channelSettingsInput.integrationProviderName) || normalizeLoose(channelSettingsInput.integrationProviderName).includes("ainda nao definido")) {
      pendencies.push("Definir qual é o provedor principal da integração de WhatsApp.");
    }
    if (!cleanText(channelSettingsInput.integrationConnectionMode)) {
      pendencies.push("Definir como a integração se conecta ao sistema.");
    }

    return pendencies;
  }, [
    channelSettingsInput.integrationConnectionMode,
    channelSettingsInput.integrationProviderName,
    connectedCommercialWhatsapp,
    primaryResponsibleWhatsapp,
  ]);

  const channelRecommendedPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!cleanText(channelDraft.commercial_channel_notes)) {
      pendencies.push("Registrar observacoes permanentes do canal comercial.");
    }
    if (!cleanText(channelDraft.integrations_notes)) {
      pendencies.push("Registrar observacoes permanentes sobre a integracao principal.");
    }

    return pendencies;
  }, [channelDraft.commercial_channel_notes, channelDraft.integrations_notes]);

  const channelGuidedStatusMetrics = useMemo(() => {
    const essentialDone = channelEssentialPendencies.length === 0;
    const recommendedDone = channelRecommendedPendencies.length === 0;
    const providerDefined =
      cleanText(channelDraft.integration_provider_name) &&
      !normalizeLoose(channelDraft.integration_provider_name).includes("ainda nao definido");
    const authorityDefined = connectedCommercialWhatsapp && primaryResponsibleWhatsapp;

    return [
      {
        label: "Essencial",
        value: essentialDone ? "Completo" : "Pendente",
        tone: essentialDone ? ("green" as const) : ("amber" as const),
        hint: essentialDone ? "Os campos mínimos dos canais já foram definidos." : `${channelEssentialPendencies.length} pendência(s) crítica(s) para ativação.`,
      },
      {
        label: "Recomendado",
        value: recommendedDone ? "Completo" : "Faltando revisar",
        tone: recommendedDone ? ("green" as const) : ("gray" as const),
        hint: recommendedDone ? "Os ajustes finos dos canais já foram revisados." : `${channelRecommendedPendencies.length} pendência(s) recomendada(s).`,
      },
      {
        label: "Provedor",
        value: providerDefined ? "Definido" : "Pendente",
        tone: providerDefined ? ("green" as const) : ("amber" as const),
        hint: cleanText(channelDraft.integration_provider_name) || "Defina qual integração principal a loja usa.",
      },
      {
        label: "Autoridades derivadas",
        value: authorityDefined ? "Disponíveis" : "Pendentes",
        tone: authorityDefined ? ("green" as const) : ("amber" as const),
        hint: authorityDefined ? "WhatsApp comercial e responsável principal já estão disponíveis por fonte viva/canônica." : "Conecte o WhatsApp oficial e defina o responsável principal na frente apropriada.",
      },
    ];
  }, [
    channelDraft.integration_provider_name,
    channelEssentialPendencies,
    channelRecommendedPendencies,
    connectedCommercialWhatsapp,
    primaryResponsibleWhatsapp,
  ]);

  const channelCommercialItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome do canal comercial", value: channelSettingsInput.commercialChannelName },
      { label: "WhatsApp oficial conectado", value: connectedCommercialWhatsapp || "Nao informado" },
      { label: "Status real do WhatsApp", value: storeWhatsappVisualStatus.label },
      { label: "Recebe clientes reais", value: channelSettingsInput.commercialReceivesRealClients },
      { label: "É o canal oficial da IA vendedora", value: channelSettingsInput.commercialIsOfficialSalesChannel },
      { label: "Tipo de canal", value: channelSettingsInput.commercialChannelType },
      { label: "Prioridade de entrada", value: channelSettingsInput.commercialEntryPriority },
      { label: "Permite transbordo para humano", value: channelSettingsInput.commercialHumanHandoffEnabled },
      { label: "Observações", value: channelSettingsInput.commercialChannelNotes },
    ]);
  }, [channelSettingsInput, connectedCommercialWhatsapp, storeWhatsappVisualStatus.label]);

  const channelResponsibleItems = useMemo(() => {
    return buildBulletRows([
      { label: "Canal derivado do responsável principal", value: primaryResponsibleChannelLabel },
      { label: "WhatsApp do responsável", value: primaryResponsibleWhatsapp || "Nao definido" },
      { label: "Canal ativo", value: primaryResponsibleWhatsapp ? "Sim" : "Nao definido" },
      { label: "Origem", value: "Configuracao canonica de responsaveis" },
      { label: "Observações", value: "Os comportamentos operacionais do responsável pertencem ao Bloco 5 e não são editados nesta família." },
    ]);
  }, [primaryResponsibleChannelLabel, primaryResponsibleWhatsapp]);

  const channelOtherAndIntegrationItems = useMemo(() => {
    return buildBulletRows([
      { label: "Provedor / integração principal", value: channelSettingsInput.integrationProviderName },
      { label: "Modo de conexão", value: channelSettingsInput.integrationConnectionMode },
      { label: "Status real da integração oficial", value: storeWhatsappVisualStatus.label },
      { label: "Observações permanentes da integração", value: channelSettingsInput.integrationsNotes },
    ]);
  }, [channelSettingsInput, storeWhatsappVisualStatus.label]);

  const hasStoredLogo = Boolean(
    cleanText(storeBranding?.logo_storage_bucket) && cleanText(storeBranding?.logo_storage_path)
  );
  const displayedLogoFileName =
    cleanText(selectedStoreLogoFile?.name) ||
    cleanText(storeBranding?.logo_original_filename) ||
    "Nenhum arquivo";
  const displayedLogoSize = selectedStoreLogoFile?.size ?? storeBranding?.logo_size_bytes ?? null;

  const identityItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome da loja", value: cleanText(answers.store_display_name) || storeName },
      {
        label: "Logo",
        value: hasStoredLogo ? "Logo cadastrada para os PDFs da loja" : "Nenhuma logo enviada ainda",
      },
      { label: "Cores", value: "Ainda não configuradas nesta tela" },
      { label: "Nome que a IA usa", value: cleanText(answers.store_display_name) || storeName },
      { label: "Assinatura padrão da IA", value: cleanText(answers.store_description) },
      { label: "Dados usados em orçamento e contrato", value: cleanText(answers.store_display_name) || storeName },
    ]);
  }, [answers, storeName, hasStoredLogo]);

  const overviewSummary = useMemo(() => {
    return [
      `Loja ativa: ${storeName}.`,
      `Status da configuração: ${onboardingStatus.label.toLowerCase()}.`,
      `Piscinas cadastradas: ${counts.pools}.`,
      `Catálogo geral: ${totalCatalogo} itens (${counts.quimicos} químicos, ${counts.acessorios} acessórios e ${counts.outros} outros).`,
      primaryResponsibleName ? `Responsável principal: ${primaryResponsibleName}${primaryResponsibleWhatsapp ? ` • ${primaryResponsibleWhatsapp}` : ""}.` : "",
    ].filter(Boolean);
  }, [
    storeName,
    onboardingStatus.label,
    counts.pools,
    totalCatalogo,
    counts.quimicos,
    counts.acessorios,
    counts.outros,
    primaryResponsibleName,
    primaryResponsibleWhatsapp,
  ]);

  const iaReadiness = useMemo(() => {
    if (onboardingStatus.label === "Concluído" && (counts.pools > 0 || totalCatalogo > 0)) {
      return {
        value: "Pronta para revisão final",
        tone: "green" as const,
        hint: "Base mínima já existe para validar a operação real da IA.",
      };
    }
    if (onboardingStatus.label === "Em andamento") {
      return {
        value: "Em preparação",
        tone: "amber" as const,
        hint: "Ainda faltam definições da loja para liberar a IA com segurança.",
      };
    }
    return {
      value: "Não pronta",
      tone: "red" as const,
      hint: "A loja ainda precisa concluir a estrutura mínima de configuração.",
    };
  }, [onboardingStatus.label, counts.pools, totalCatalogo]);

  const activationPendencies = useMemo(() => {
    const list: string[] = [];

    if (onboardingStatus.label !== "Concluído") {
      list.push("Finalizar o onboarding principal da loja.");
    }
    if (counts.pools === 0) {
      list.push("Cadastrar pelo menos uma piscina, se a loja trabalha com venda de piscinas.");
    }
    if (totalCatalogo === 0) {
      list.push("Cadastrar produtos, acessórios ou outros itens no catálogo.");
    }
    if (!primaryResponsibleName) {
      list.push("Definir o responsável principal da loja.");
    }
    if (!primaryResponsibleWhatsapp) {
      list.push("Definir o WhatsApp do responsável.");
    }

    return list;
  }, [counts.pools, totalCatalogo, onboardingStatus.label, primaryResponsibleName, primaryResponsibleWhatsapp]);


  useEffect(() => {
    let cancelled = false;

    if (!organizationId || !activeStoreId) {
      setSavedGeneralAddress(createEmptyGeneralAddressDraft());
      setGeneralAddressDraft(createEmptyGeneralAddressDraft());

      return () => {
        cancelled = true;
      };
    }

    setSavedGeneralAddress(createEmptyGeneralAddressDraft());
    setGeneralAddressDraft(createEmptyGeneralAddressDraft());

    void (async () => {
      const { data, error } = await supabase.rpc(
        "read_store_general_address_settings_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        },
      );

      if (cancelled) return;

      if (error) {
        console.error(
          "Nao foi possivel carregar o endereco canonico da loja.",
          error,
        );
        return;
      }

      const row = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreGeneralAddressSettingsRow | null;

      const nextAddress = createGeneralAddressDraftFromSettings(row);

      setSavedGeneralAddress(nextAddress);
      setGeneralAddressDraft(nextAddress);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeStoreId, organizationId]);

  useEffect(() => {
    setGeneralAddressDraft((current) => {
      if (cleanText(current.city) || cleanText(current.state)) return current;
      const next = {
        ...current,
        city: cleanText(strategySettingsInput.city),
        state: cleanText(strategySettingsInput.state),
      };

      return next;
    });
  }, [strategySettingsInput.city, strategySettingsInput.state]);

  const updateGeneralAddressDraft = useCallback(<K extends keyof GeneralAddressDraftState>(
    key: K,
    value: GeneralAddressDraftState[K],
  ) => {
    setGeneralAddressDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const lookupGeneralAddressCep = useCallback(async (cepDigits: string) => {
    if (cepDigits.length !== 8) return;

    setGeneralAddressCepLookupLoading(true);
    setGeneralAddressCepLookupMessage(null);

    try {
      const response = await fetch(`/api/store/cep?cep=${encodeURIComponent(cepDigits)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as StoreCepLookupApiResponse | null;

      if (!result) {
        throw new Error("Nao foi possivel consultar o CEP agora. Voce pode preencher o endereco manualmente.");
      }

      if (!response.ok || !result.ok) {
        const failureMessage = "message" in result ? result.message : null;
        setGeneralAddressCepLookupMessage(
          failureMessage || "Nao foi possivel consultar o CEP agora. Voce pode preencher o endereco manualmente.",
        );
        return;
      }

      if (!result.found) {
        setGeneralAddressCepLookupMessage(
          result.message || "CEP nao encontrado. Voce pode preencher o endereco manualmente.",
        );
        return;
      }

      setGeneralAddressDraft((current) => ({
        ...current,
        street: cleanText(result.address.street) || current.street,
        district: cleanText(result.address.district) || current.district,
        city: cleanText(result.address.city) || current.city,
        state: cleanText(result.address.state) || current.state,
      }));
      setGeneralAddressCepLookupMessage(null);
    } catch {
      setGeneralAddressCepLookupMessage(
        "Nao foi possivel consultar o CEP agora. Voce pode preencher o endereco manualmente.",
      );
    } finally {
      setGeneralAddressCepLookupLoading(false);
    }
  }, []);

  const handleGeneralAddressCepChange = useCallback((value: string) => {
    const formattedCep = formatBrazilianCepInput(value);
    const digits = onlyCepDigits(formattedCep);

    setGeneralAddressDraft((current) => ({ ...current, cep: formattedCep }));
    setGeneralAddressCepLookupMessage(null);

    if (digits.length === 8) {
      void lookupGeneralAddressCep(digits);
    }
  }, [lookupGeneralAddressCep]);

  const handleGeneralAddressSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar o endereço.");
      setSuccessText(null);
      return false;
    }

    const hasPublicAddress =
      generalAddressDraft.has_public_address === "Sim"
        ? true
        : generalAddressDraft.has_public_address === "Não"
          ? false
          : null;

    if (hasPublicAddress == null) {
      setErrorText("Informe se a loja possui um endereço físico que pode ser informado aos clientes.");
      setSuccessText(null);
      return false;
    }

    if (hasPublicAddress && !isGeneralAddressComplete(generalAddressDraft)) {
      setErrorText("Preencha rua, número, bairro, cidade, estado e como clientes podem ir até a loja.");
      setSuccessText(null);
      return false;
    }

    const cepDigits = onlyCepDigits(generalAddressDraft.cep);

    if (hasPublicAddress && cleanText(generalAddressDraft.cep) && cepDigits.length !== 8) {
      setErrorText("Informe um CEP válido com 8 dígitos ou deixe o CEP em branco.");
      setSuccessText(null);
      return false;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_general_address_settings_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_has_public_address: hasPublicAddress,
          p_cep: hasPublicAddress && cepDigits ? cepDigits : null,
          p_street: hasPublicAddress ? cleanText(generalAddressDraft.street) || null : null,
          p_number: hasPublicAddress ? cleanText(generalAddressDraft.number) || null : null,
          p_complement: hasPublicAddress ? cleanText(generalAddressDraft.complement) || null : null,
          p_district: hasPublicAddress ? cleanText(generalAddressDraft.district) || null : null,
          p_city: hasPublicAddress ? cleanText(generalAddressDraft.city) || null : null,
          p_state: hasPublicAddress ? cleanText(generalAddressDraft.state) || null : null,
          p_customer_visit_mode: hasPublicAddress ? cleanText(generalAddressDraft.customer_visit_mode) || null : null,
          p_reference_point: hasPublicAddress ? cleanText(generalAddressDraft.reference_point) || null : null,
          p_directions_notes: hasPublicAddress ? cleanText(generalAddressDraft.directions_notes) || null : null,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreGeneralAddressSettingsRow | null;

      if (!savedRow) {
        throw new Error("O writer do endereço não retornou a configuração salva.");
      }

      const nextAddress = createGeneralAddressDraftFromSettings(savedRow);
      setSavedGeneralAddress(nextAddress);
      setGeneralAddressDraft(nextAddress);
      setErrorText(null);
      setSuccessText("Endereço da loja salvo com sucesso.");
      setOverviewEditTarget(null);
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Não foi possível salvar o endereço da loja.");
      setSuccessText(null);
      return false;
    }
  }, [activeStoreId, generalAddressDraft, organizationId]);

  const updateOperationExperienceDraft = useCallback(<K extends keyof OperationExperienceDraftState>(
    key: K,
    value: OperationExperienceDraftState[K],
  ) => {
    setOperationExperienceDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const updateOperationDayHours = useCallback((
    day: string,
    field: "open" | "close",
    value: string,
  ) => {
    setOperationExperienceDraft((current) => ({
      ...current,
      team_day_hours: {
        ...current.team_day_hours,
        [day]: {
          ...(current.team_day_hours[day] ?? { open: "08:00", close: "18:00" }),
          [field]: value,
        },
      },
    }));
  }, []);

  const toggleOperationExperienceArrayValue = useCallback((
    key: keyof OperationExperienceDraftState,
    value: string,
  ) => {
    setOperationExperienceDraft((current) => {
      const currentValue = current[key];
      if (!Array.isArray(currentValue)) return current;
      const nextValue = currentValue.includes(value)
        ? currentValue.filter((item) => item !== value)
        : [...currentValue, value];
      return { ...current, [key]: nextValue } as OperationExperienceDraftState;
    });
  }, []);

  const validateOperationExperienceDraft = useCallback((target: string) => {
    const required = (condition: boolean, value: unknown, message: string) =>
      condition && !cleanText(value) ? message : null;

    if (target === "hours") {
      return (
        required(operationExperienceDraft.team_days.includes("sabado"), operationExperienceDraft.team_day_hours.sabado?.open, "Informe o horário de abertura de sábado.") ||
        required(operationExperienceDraft.team_days.includes("sabado"), operationExperienceDraft.team_day_hours.sabado?.close, "Informe o horário de fechamento de sábado.") ||
        required(operationExperienceDraft.team_days.includes("domingo"), operationExperienceDraft.team_day_hours.domingo?.open, "Informe o horário de abertura de domingo.") ||
        required(operationExperienceDraft.team_days.includes("domingo"), operationExperienceDraft.team_day_hours.domingo?.close, "Informe o horário de fechamento de domingo.") ||
        required(operationExperienceDraft.holiday_mode === "caso_a_caso", operationExperienceDraft.holiday_notes, "Explique como o atendimento em feriados é definido caso a caso.")
      );
    }

    if (target === "technical_visit") {
      if (normalizeLoose(operationDraft.offers_technical_visit) !== "sim") return null;
      return (
        required(operationExperienceDraft.visit_required_situations.includes("outro"), operationExperienceDraft.visit_required_other, "Especifique em quais outras situações a visita técnica é obrigatória.") ||
        required(operationExperienceDraft.visit_optional_situations.includes("outro"), operationExperienceDraft.visit_optional_other, "Especifique em quais outras situações a visita técnica pode ser oferecida.") ||
        required(["outro_time", "caso_a_caso"].includes(operationExperienceDraft.visit_team_mode), operationExperienceDraft.visit_team_rule, "Explique quem realiza a visita técnica nessa situação.") ||
        required(operationExperienceDraft.visit_duration_mode === "personalizado", operationExperienceDraft.visit_duration_minutes, "Informe quantos minutos devem ser reservados para o outro tempo de visita.") ||
        required(operationExperienceDraft.visit_duration_mode === "varia", operationExperienceDraft.visit_duration_rule, "Explique o que define a duração da visita técnica.") ||
        required(operationExperienceDraft.visit_pricing_mode === "case_by_case", operationExperienceDraft.visit_case_by_case_rule, "Explique como o valor da visita técnica é calculado caso a caso.") ||
        required(operationExperienceDraft.visit_preconfirm_items.includes("outro"), operationExperienceDraft.visit_preconfirm_other, "Especifique o que mais deve ser confirmado antes de agendar a visita.")
      );
    }

    if (target === "installation") {
      if (normalizeLoose(operationDraft.offers_installation) !== "sim") return null;
      const supplierLeadApplies = ["sob_encomenda", "misto"].includes(operationExperienceDraft.installation_supply_mode);
      return (
        required(operationExperienceDraft.installation_customer_can_buy_without === "depende", operationExperienceDraft.installation_customer_can_buy_without_rule, "Explique para quais piscinas/projetos a compra sem instalação é permitida.") ||
        required(operationExperienceDraft.installation_third_party_pool === "depende", operationExperienceDraft.installation_third_party_pool_rule, "Explique em quais casos a loja instala piscinas compradas de terceiros.") ||
        required(supplierLeadApplies, operationExperienceDraft.installation_supplier_lead_time_mode, "Informe como funciona o prazo de chegada da fábrica/fornecedor para piscinas sob encomenda.") ||
        required(supplierLeadApplies && operationExperienceDraft.installation_supplier_lead_time_mode === "outro", operationExperienceDraft.installation_supplier_lead_time_value, "Informe o prazo normal de chegada da fábrica/fornecedor.") ||
        required(supplierLeadApplies && operationExperienceDraft.installation_supplier_lead_time_mode === "varia", operationExperienceDraft.installation_supplier_lead_time_rule, "Explique o que faz o prazo da fábrica/fornecedor variar.") ||
        required(operationExperienceDraft.installation_start_lead_time_mode === "outro", operationExperienceDraft.installation_start_lead_time_days, "Informe o prazo normal entre a disponibilidade da piscina e o início da instalação.") ||
        required(operationExperienceDraft.installation_start_lead_time_mode === "varia", operationExperienceDraft.installation_start_lead_time_rule, "Explique o que define quando a instalação pode começar.") ||
        required(operationExperienceDraft.installation_duration_mode === "varia", operationExperienceDraft.installation_duration_rule, "Explique o que define quanto tempo a instalação ocupa uma equipe.") ||
        required(operationExperienceDraft.installation_has_multiple_teams === "Sim", operationExperienceDraft.installation_concurrent_capacity, "Informe quantas equipes podem realizar instalações ao mesmo tempo.") ||
        required(operationExperienceDraft.installation_schedule_gates.includes("outro"), operationExperienceDraft.installation_schedule_gates_other, "Especifique o outro requisito antes de agendar a instalação.") ||
        required(operationExperienceDraft.installation_start_gates.includes("outro"), operationExperienceDraft.installation_start_gates_other, "Especifique o outro requisito antes de iniciar a instalação.") ||
        required(operationExperienceDraft.installation_includes.includes("outro"), operationExperienceDraft.installation_includes_other, "Especifique o outro serviço ou etapa incluído na instalação.") ||
        required(operationExperienceDraft.installation_excludes_options.includes("outro"), operationExperienceDraft.installation_excludes, "Especifique o outro item que a instalação da loja não inclui.")
      );
    }

    if (target === "pool_replacement") {
      if (operationExperienceDraft.pool_replacement_enabled !== "Sim") return null;
      return (
        required(operationExperienceDraft.pool_replacement_situations.includes("caso_a_caso"), operationExperienceDraft.pool_replacement_situations_other, "Explique quais outros tipos de troca a loja aceita mediante avaliação.") ||
        required(operationExperienceDraft.pool_replacement_uses_installation_team === "depende", operationExperienceDraft.pool_replacement_team_rule, "Explique em quais casos a troca usa a mesma equipe de instalação.") ||
        required(operationExperienceDraft.pool_replacement_removes_old === "caso_a_caso", operationExperienceDraft.pool_replacement_removes_old_rule, "Explique em quais casos a loja remove a piscina antiga.") ||
        required(operationExperienceDraft.pool_replacement_disposal_included === "caso_a_caso", operationExperienceDraft.pool_replacement_disposal_rule, "Explique em quais casos o descarte da piscina antiga está incluído.") ||
        required(operationExperienceDraft.pool_replacement_requires_visit === "depende", operationExperienceDraft.pool_replacement_visit_rule, "Explique em quais casos a troca exige visita técnica.") ||
        required(operationExperienceDraft.pool_replacement_duration_mode === "varia", operationExperienceDraft.pool_replacement_duration_rule, "Explique o que define quanto tempo a troca ocupa a equipe.") ||
        required(operationExperienceDraft.pool_replacement_includes.includes("outro"), operationExperienceDraft.pool_replacement_notes, "Especifique o outro serviço incluído na troca.") ||
        required(operationExperienceDraft.pool_replacement_excludes_options.includes("outro"), operationExperienceDraft.pool_replacement_excludes, "Especifique o outro serviço que a loja não faz durante a troca.")
      );
    }

    if (target === "delivery") {
      if (operationExperienceDraft.delivery_enabled !== "Sim") return null;
      return (
        required(operationExperienceDraft.delivery_items.includes("outros"), operationExperienceDraft.delivery_items_other, "Especifique quais outros produtos do catálogo a loja entrega.") ||
        required(["depende"].includes(operationExperienceDraft.delivery_with_installation_mode) || operationExperienceDraft.delivery_with_installation_timing === "depende", operationExperienceDraft.delivery_with_installation_notes, "Explique o que define como a entrega é organizada em relação à instalação.") ||
        required(["ambos", "caso_a_caso"].includes(operationExperienceDraft.delivery_provider), operationExperienceDraft.delivery_provider_rule, "Explique como a loja decide quem realiza a entrega.") ||
        required(operationExperienceDraft.delivery_uses_installation_team === "depende", operationExperienceDraft.delivery_installation_team_rule, "Explique em quais pedidos a entrega usa a mesma equipe de instalação.") ||
        required(operationExperienceDraft.delivery_partner_pricing_mode === "depende", operationExperienceDraft.delivery_partner_pricing_rule, "Explique quando e como o valor do parceiro é repassado ao cliente.") ||
        required(operationExperienceDraft.delivery_pricing_mode === "destino" && operationExperienceDraft.delivery_pricing_destination_mode === "outra", operationExperienceDraft.delivery_pricing_destination_rule, "Explique a outra regra usada para calcular o frete por destino.") ||
        required(operationExperienceDraft.delivery_pricing_mode === "caso_a_caso", operationExperienceDraft.delivery_case_rule, "Explique como a equipe calcula o frete caso a caso.") ||
        required(operationExperienceDraft.delivery_case_factors.includes("outro"), operationExperienceDraft.delivery_case_rule, "Especifique o outro fator usado para calcular o frete.") ||
        required(operationExperienceDraft.delivery_release_gates.includes("outro"), operationExperienceDraft.delivery_release_gates_other, "Especifique o outro requisito antes de liberar a entrega.") ||
        required(operationExperienceDraft.delivery_unloading_mode === "depende", operationExperienceDraft.delivery_notes, "Explique quando a equipe apenas transporta, descarrega ou posiciona o produto.")
      );
    }

    if (target === "pickup") {
      if (operationExperienceDraft.pickup_enabled !== "Sim") return null;
      return (
        required(operationExperienceDraft.pickup_items.includes("outros"), operationExperienceDraft.pickup_items_other, "Especifique quais outros itens do catálogo podem ser retirados.") ||
        required(operationExperienceDraft.pickup_location_mode === "outro", operationExperienceDraft.pickup_other_location, "Informe o outro local de retirada.") ||
        required(operationExperienceDraft.pickup_release_gates.includes("outro"), operationExperienceDraft.pickup_release_gates_other, "Especifique o outro requisito antes de liberar a retirada.")
      );
    }

    if (target === "technical_services") {
      if (operationExperienceDraft.technical_services_enabled !== "Sim") return null;
      return (
        required(operationExperienceDraft.technical_service_types.includes("outro"), operationExperienceDraft.technical_services_other, "Especifique quais outros serviços técnicos a loja realiza.") ||
        required(operationExperienceDraft.technical_equipment_types.includes("outros"), operationExperienceDraft.technical_equipment_other, "Especifique em quais outros equipamentos a loja trabalha.") ||
        required(operationExperienceDraft.equipment_installation_origin_policy === "depende", operationExperienceDraft.equipment_installation_origin_rule, "Explique de quais equipamentos depende a instalação de itens comprados fora da loja.") ||
        required(operationExperienceDraft.equipment_replacement_existing === "caso_a_caso", operationExperienceDraft.equipment_replacement_existing_rule, "Explique em quais casos a loja substitui equipamentos já existentes.")
      );
    }

    return null;
  }, [operationDraft.offers_installation, operationDraft.offers_technical_visit, operationExperienceDraft]);

  const saveOperationExperienceCard = useCallback((target: string, close = true) => {
    const validationError = validateOperationExperienceDraft(target);
    if (validationError) {
      setErrorText(validationError);
      setSuccessText(null);
      return false;
    }

    setSavedOperationExperience(operationExperienceDraft);
    setErrorText(null);
    setSuccessText("Alterações de operação revisadas com sucesso.");
    if (close) setOperationEditTarget(null);
    return true;
  }, [operationExperienceDraft, validateOperationExperienceDraft]);

  const saveHumanScheduleCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar os horarios.");
      setSuccessText(null);
      return false;
    }

    const payload = buildHumanScheduleConfigurationPayload(
      operationExperienceDraft,
      scheduleSettings,
    );
    if ("error" in payload) {
      setErrorText(payload.error);
      setSuccessText(null);
      return false;
    }

    try {
      const { data: savedScheduleSettings, error: scheduleError } =
        await supabase.rpc(
          "upsert_store_human_schedule_configuration_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_operating_days: payload.operatingDays,
            p_operating_hours: payload.operatingHours,
            p_timezone_name: payload.timezoneName,
            p_holiday_mode: payload.holidayMode,
            p_holiday_open_time: payload.holidayOpenTime,
            p_holiday_close_time: payload.holidayCloseTime,
            p_holiday_notes: payload.holidayNotes,
          },
        );

      if (scheduleError) throw scheduleError;

      const nextScheduleSettings =
        (savedScheduleSettings ?? null) as ScheduleSettingsRow | null;
      setScheduleSettings(nextScheduleSettings);
      const nextDraft = createScheduleOperationExperienceDraftFromSettings(
        nextScheduleSettings,
        operationExperienceDraft,
      );
      setSavedOperationExperience(nextDraft);
      setOperationExperienceDraft(nextDraft);
      setErrorText(null);
      setSuccessText("Horarios da equipe salvos com sucesso.");
      setOperationEditTarget(null);
      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar os horarios da equipe.");
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
    scheduleSettings,
  ]);

  const saveAfterHoursCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a IA fora do horario.");
      setSuccessText(null);
      return false;
    }
    if (!scheduleSettings) {
      setErrorText("Configure os horarios da equipe antes da IA fora do horario.");
      setSuccessText(null);
      return false;
    }

    const enabled = parseYesNoToNullableBoolean(
      operationExperienceDraft.ai_after_hours_enabled,
    );
    if (enabled == null) {
      setErrorText("Informe se a IA pode atender fora do horario.");
      setSuccessText(null);
      return false;
    }

    const mode = enabled
      ? toCanonicalAfterHoursMode(operationExperienceDraft.ai_after_hours_mode)
      : null;
    if (enabled && !mode) {
      setErrorText("Informe quando a IA pode atender fora do horario.");
      setSuccessText(null);
      return false;
    }

    const afterHoursStart =
      enabled && mode === "specific_window"
        ? normalizeTimeInput(operationExperienceDraft.ai_after_hours_start)
        : null;
    const afterHoursEnd =
      enabled && mode === "specific_window"
        ? normalizeTimeInput(operationExperienceDraft.ai_after_hours_end)
        : null;
    if (enabled && mode === "specific_window" && !isValidTimeRange(afterHoursStart || "", afterHoursEnd || "")) {
      setErrorText("Informe uma janela valida para a IA fora do horario.");
      setSuccessText(null);
      return false;
    }

    try {
      const { data: savedScheduleSettings, error: scheduleError } =
        await supabase.rpc(
          "upsert_store_schedule_ai_after_hours_policy_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_ai_after_hours_enabled: enabled,
            p_ai_after_hours_mode: mode,
            p_ai_after_hours_start: afterHoursStart,
            p_ai_after_hours_end: afterHoursEnd,
            p_ai_attends_holidays: enabled
              ? parseYesNoToBoolean(operationExperienceDraft.ai_attends_holidays, false)
              : false,
          },
        );

      if (scheduleError) throw scheduleError;

      const nextScheduleSettings =
        (savedScheduleSettings ?? null) as ScheduleSettingsRow | null;
      setScheduleSettings(nextScheduleSettings);
      const nextDraft = createScheduleOperationExperienceDraftFromSettings(
        nextScheduleSettings,
        operationExperienceDraft,
      );
      setSavedOperationExperience(nextDraft);
      setOperationExperienceDraft(nextDraft);
      setErrorText(null);
      setSuccessText("Politica de IA fora do horario salva com sucesso.");
      setOperationEditTarget(null);
      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar a IA fora do horario.");
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
    scheduleSettings,
  ]);

  const saveAgendaCapacityCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a agenda.");
      setSuccessText(null);
      return false;
    }
    if (!scheduleSettings) {
      setErrorText("Configure os horarios da equipe antes da agenda e capacidade.");
      setSuccessText(null);
      return false;
    }

    const allowMultipleAppointmentsPerDay = parseYesNoToNullableBoolean(
      operationDraft.allow_multiple_appointments_per_day,
    );
    if (allowMultipleAppointmentsPerDay == null) {
      setErrorText("Informe se a agenda pode ter mais de um compromisso no mesmo dia.");
      setSuccessText(null);
      return false;
    }

    const allowSameTimeAppointments = allowMultipleAppointmentsPerDay
      ? parseYesNoToNullableBoolean(operationDraft.allow_same_time_appointments)
      : false;
    const appointmentBufferEnabled = allowMultipleAppointmentsPerDay
      ? parseYesNoToNullableBoolean(operationExperienceDraft.agenda_buffer_enabled)
      : false;

    if (allowMultipleAppointmentsPerDay && allowSameTimeAppointments == null) {
      setErrorText("Informe se a agenda permite compromissos no mesmo horario.");
      setSuccessText(null);
      return false;
    }
    if (allowMultipleAppointmentsPerDay && appointmentBufferEnabled == null) {
      setErrorText("Informe se existe intervalo entre compromissos.");
      setSuccessText(null);
      return false;
    }

    const dailyLimitMode = allowMultipleAppointmentsPerDay
      ? toCanonicalAgendaDailyLimitMode(operationExperienceDraft.agenda_daily_limit_mode)
      : null;
    if (allowMultipleAppointmentsPerDay && !dailyLimitMode) {
      setErrorText("Informe se existe limite diario fixo.");
      setSuccessText(null);
      return false;
    }

    const dailyLimit =
      allowMultipleAppointmentsPerDay && dailyLimitMode === "fixed_limit"
        ? parseOptionalPositiveInteger(operationExperienceDraft.agenda_daily_limit)
        : null;
    if (Number.isNaN(dailyLimit) || (dailyLimitMode === "fixed_limit" && (!dailyLimit || dailyLimit < 2))) {
      setErrorText("Informe um limite diario de pelo menos 2 compromissos.");
      setSuccessText(null);
      return false;
    }

    const sameTimeCapacity =
      allowMultipleAppointmentsPerDay && allowSameTimeAppointments
        ? parseOptionalPositiveInteger(operationDraft.agenda_capacity_rule)
        : null;
    if (Number.isNaN(sameTimeCapacity) || (allowSameTimeAppointments && (!sameTimeCapacity || sameTimeCapacity < 2))) {
      setErrorText("Informe capacidade simultanea de pelo menos 2 compromissos.");
      setSuccessText(null);
      return false;
    }

    const appointmentBufferMinutes =
      allowMultipleAppointmentsPerDay && appointmentBufferEnabled
        ? parseOptionalPositiveInteger(operationExperienceDraft.agenda_buffer_minutes)
        : null;
    if (Number.isNaN(appointmentBufferMinutes) || (appointmentBufferEnabled && !appointmentBufferMinutes)) {
      setErrorText("Informe o intervalo minimo em minutos.");
      setSuccessText(null);
      return false;
    }

    try {
      const { data: savedScheduleSettings, error: scheduleError } =
        await supabase.rpc(
          "upsert_store_agenda_capacity_configuration_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_allow_multiple_appointments_per_day: allowMultipleAppointmentsPerDay,
            p_allow_same_time_appointments: allowSameTimeAppointments ?? false,
            p_appointment_buffer_enabled: appointmentBufferEnabled ?? false,
            p_daily_limit_mode: dailyLimitMode,
            p_daily_limit: dailyLimit,
            p_same_time_capacity: sameTimeCapacity,
            p_appointment_buffer_minutes: appointmentBufferMinutes,
          },
        );

      if (scheduleError) throw scheduleError;

      const nextScheduleSettings =
        (savedScheduleSettings ?? null) as ScheduleSettingsRow | null;
      setScheduleSettings(nextScheduleSettings);
      const nextDraft = createScheduleOperationExperienceDraftFromSettings(
        nextScheduleSettings,
        operationExperienceDraft,
      );
      setSavedOperationExperience(nextDraft);
      setOperationExperienceDraft(nextDraft);
      setErrorText(null);
      setSuccessText("Agenda e capacidade salvas com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);
      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar a agenda e capacidade.");
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationDraft,
    operationExperienceDraft,
    organizationId,
    scheduleSettings,
  ]);

  const saveCustomerRescheduleAutonomyCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a autonomia de remarcações.");
      setSuccessText(null);
      return false;
    }
    if (!scheduleSettings) {
      setErrorText("Configure os horários da equipe antes da autonomia de remarcações.");
      setSuccessText(null);
      return false;
    }

    const aiCanAcceptWithoutApproval = parseYesNoToNullableBoolean(
      operationExperienceDraft.ai_can_accept_customer_reschedule_without_approval,
    );
    if (aiCanAcceptWithoutApproval == null) {
      setErrorText("Informe se a IA pode confirmar sozinha um novo horário sugerido pelo cliente.");
      setSuccessText(null);
      return false;
    }

    try {
      const { data: savedScheduleSettings, error: scheduleError } = await supabase.rpc(
        "upsert_store_customer_reschedule_autonomy_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_ai_can_accept_without_approval: aiCanAcceptWithoutApproval,
        },
      );

      if (scheduleError) throw scheduleError;

      const nextScheduleSettings =
        (savedScheduleSettings ?? null) as ScheduleSettingsRow | null;
      setScheduleSettings(nextScheduleSettings);
      const nextDraft = createScheduleOperationExperienceDraftFromSettings(
        nextScheduleSettings,
        operationExperienceDraft,
      );
      setSavedOperationExperience(nextDraft);
      setOperationExperienceDraft(nextDraft);
      setErrorText(null);
      setSuccessText("Autonomia de remarcações salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);
      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Não foi possível salvar a autonomia de remarcações.");
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
    scheduleSettings,
  ]);

  const handleOverviewDraftChange = useCallback((key: string, value: string) => {
    setOverviewDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleOverviewEditCancel = useCallback(() => {
    setOverviewDraft({
      store_display_name: cleanText(answers.store_display_name) || storeName,
      responsible_name: cleanText(canonicalPrimaryResponsibleDraft.name),
      responsible_whatsapp: cleanText(canonicalPrimaryResponsibleDraft.whatsapp),
      commercial_whatsapp: cleanText(answers.commercial_whatsapp),
      installation_days_rule: operationSettingsInput.installationDaysRule,
      technical_visit_days_rule: operationSettingsInput.technicalVisitDaysRule,
      final_activation_notes: cleanText(answers.final_activation_notes),
    });
    setIsOverviewEditing(false);
    setOverviewEditTarget(null);
  }, [answers, canonicalPrimaryResponsibleDraft, operationSettingsInput, storeName]);

  const handleOverviewEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        store_display_name: overviewDraft.store_display_name,
        responsible_name: overviewDraft.responsible_name,
        responsible_whatsapp: overviewDraft.responsible_whatsapp,
        commercial_whatsapp: overviewDraft.commercial_whatsapp,
        final_activation_notes: overviewDraft.final_activation_notes,
      },
      "Alterações da visão geral salvas com sucesso."
    );

    if (!saved) return;

    setIsOverviewEditing(false);
    setOverviewEditTarget(null);
  }, [overviewDraft, upsertConfigAnswers]);

  const handleStrategyDraftChange = useCallback(<K extends keyof StoreStrategySettingsInput>(
    key: K,
    value: StoreStrategySettingsInput[K]
  ) => {
    setStrategyDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleStrategyMultiValueToggle = useCallback(
    (key: "serviceRegionModes" | "storeServices", value: string) => {
      setStrategyDraft((current) => ({
        ...current,
        [key]: current[key].includes(value)
          ? current[key].filter((item) => item !== value)
          : [...current[key], value],
      }));
    },
    [],
  );

  const handleStrategyEditOpen = useCallback(() => {
    setStrategyDraft(strategySettingsInput);
    setIsStrategyEditing(true);
  }, [strategySettingsInput, strategySettings]);

  const handleStrategyEditCancel = useCallback(() => {
    setStrategyDraft(strategySettingsInput);
    setIsStrategyEditing(false);
  }, [strategySettingsInput, strategySettings]);

  const handleStrategyEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a estrategia.");
      setSuccessText(null);
      return false;
    }

    const normalizedStrategySettings = normalizeStoreStrategySettingsInput(strategyDraft);

    try {
      const { data: savedStrategySettings, error: strategySaveError } =
        await supabase.rpc(
          "upsert_store_strategy_settings_with_legacy_mirror_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_city: normalizedStrategySettings.value.city,
            p_state: normalizedStrategySettings.value.state,
            p_service_regions: normalizedStrategySettings.value.serviceRegions,
            p_service_region_modes: normalizedStrategySettings.value.serviceRegionModes,
            p_service_region_primary_mode:
              normalizedStrategySettings.value.serviceRegionPrimaryMode,
            p_service_region_outside_consultation:
              normalizedStrategySettings.value.serviceRegionOutsideConsultation,
            p_service_region_notes: normalizedStrategySettings.value.serviceRegionNotes,
            p_store_services: normalizedStrategySettings.value.storeServices,
            p_store_services_other: normalizedStrategySettings.value.storeServicesOther,
            p_store_description: normalizedStrategySettings.value.storeDescription,
            p_main_store_brand: normalizedStrategySettings.value.mainStoreBrand,
            p_brands_worked: normalizedStrategySettings.value.brandsWorked,
            p_strategy_service_exclusions:
              normalizedStrategySettings.value.strategyServiceExclusions,
            p_strategy_primary_focus:
              normalizedStrategySettings.value.strategyPrimaryFocus,
            p_strategy_sell_more: normalizedStrategySettings.value.strategySellMore,
            p_strategy_common_customer:
              normalizedStrategySettings.value.strategyCommonCustomer,
            p_strategy_ideal_customer:
              normalizedStrategySettings.value.strategyIdealCustomer,
            p_strategy_ticket_range:
              normalizedStrategySettings.value.strategyTicketRange,
            p_strategy_positioning:
              normalizedStrategySettings.value.strategyPositioning,
            p_strategy_priority_brands:
              normalizedStrategySettings.value.strategyPriorityBrands,
            p_strategy_non_worked_brands:
              normalizedStrategySettings.value.strategyNonWorkedBrands,
            p_strategy_top_lines: normalizedStrategySettings.value.strategyTopLines,
            p_strategy_top_products:
              normalizedStrategySettings.value.strategyTopProducts,
            p_strategy_differentials:
              normalizedStrategySettings.value.strategyDifferentials,
            p_strategy_promise_limits:
              normalizedStrategySettings.value.strategyPromiseLimits,
            p_strategy_ai_presentation:
              normalizedStrategySettings.value.strategyAiPresentation,
            p_strategy_ai_priorities:
              normalizedStrategySettings.value.strategyAiPriorities,
            p_strategy_ai_never_forget:
              normalizedStrategySettings.value.strategyAiNeverForget,
          },
        );

      if (strategySaveError) throw strategySaveError;

      setStrategySettings(
        (savedStrategySettings ?? null) as StoreStrategySettingsRow | null,
      );
      setErrorText(null);
      setSuccessText("Alteracoes da estrategia salvas com sucesso.");
      setIsStrategyEditing(false);
      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar as alteracoes da estrategia.");
      setSuccessText(null);
      return false;
    }
  }, [activeStoreId, fetchPageData, organizationId, strategyDraft]);

  const handleRegionEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a região.");
      setSuccessText(null);
      return false;
    }

    const outsidePolicy = cleanText(
      operationExperienceDraft.region_outside_policy,
    );

    if (!["consulta", "nao"].includes(outsidePolicy)) {
      setErrorText(
        "Informe se a loja atende fora da cobertura somente sob consulta ou não atende.",
      );
      setSuccessText(null);
      return false;
    }

    const normalizedRegion = normalizeStoreStrategySettingsInput({
      ...strategyDraft,
      serviceRegionOutsideConsultation: outsidePolicy === "consulta",
    });

    const primaryMode = normalizedRegion.value.serviceRegionPrimaryMode;

    if (!primaryMode) {
      setErrorText("Escolha a cobertura principal da loja.");
      setSuccessText(null);
      return false;
    }

    if (
      primaryMode === "grande_regiao" &&
      !cleanText(normalizedRegion.value.serviceRegions)
    ) {
      setErrorText(
        "Informe quais cidades, regiões ou limites fazem parte da cobertura.",
      );
      setSuccessText(null);
      return false;
    }

    try {
      const { data: savedStrategySettings, error: strategySaveError } =
        await supabase.rpc(
          "upsert_store_strategy_region_configuration_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_service_regions: normalizedRegion.value.serviceRegions,
            p_service_region_modes: normalizedRegion.value.serviceRegionModes,
            p_service_region_primary_mode: primaryMode,
            p_service_region_outside_consultation:
              outsidePolicy === "consulta",
            p_service_region_notes: normalizedRegion.value.serviceRegionNotes,
          },
        );

      if (strategySaveError) throw strategySaveError;

      const savedRow =
        (savedStrategySettings ?? null) as StoreStrategySettingsRow | null;

      setStrategySettings(savedRow);

      if (savedRow) {
        setStrategyDraft(
          createStoreStrategySettingsInputFromSources({
            settings: savedRow,
          }),
        );
      }

      setErrorText(null);
      setSuccessText("Região de atendimento salva com sucesso.");
      setOperationEditTarget(null);
      setIsStrategyEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a região de atendimento.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft.region_outside_policy,
    organizationId,
    strategyDraft,
  ]);
  const handleGeneralInformationSave = useCallback(async () => {
    const strategySaved = await handleStrategyEditSave();
    if (!strategySaved) return;

    const saved = await upsertConfigAnswers(
      {
        store_display_name: overviewDraft.store_display_name,
      },
      "Informações da loja salvas com sucesso.",
    );

    if (!saved) return;
    setOverviewEditTarget(null);
    setIsOverviewEditing(false);
  }, [handleStrategyEditSave, overviewDraft.store_display_name, upsertConfigAnswers]);


  useEffect(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers, scheduleSettings, operationSettings));
  }, [answers, scheduleSettings, operationSettings]);

  useEffect(() => {
    let cancelled = false;

    if (!organizationId || !activeStoreId) {
      setOperationExecutionPolicies(null);

      return () => {
        cancelled = true;
      };
    }

    // Fail-closed during store changes: never keep another store's
    // execution policy visible while the next scoped read is pending.
    setOperationExecutionPolicies(null);

    void (async () => {
      const { data, error } = await supabase.rpc(
        "read_store_operation_execution_policies_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        },
      );

      if (cancelled) return;

      if (error) {
        console.error(
          "Nao foi possivel carregar as execution policies de Operacao.",
          error,
        );
        setOperationExecutionPolicies(null);
        return;
      }

      const row = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      setOperationExecutionPolicies(row);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeStoreId, organizationId]);

  useEffect(() => {
    const technicalVisitPatch = technicalVisitPolicyToDraftPatch(
      technicalVisitExecutionPolicy,
      {
        mode: operationSettingsInput.technicalVisitPricingMode,
        fixedFeeCents: operationSettingsInput.technicalVisitFixedFeeCents,
        caseByCaseRule:
          operationSettingsInput.technicalVisitCaseByCaseRule,
        deductible:
          operationSettingsInput.technicalVisitFeeDeductibleFromPurchase,
      },
    );

    const installationPatch = installationPolicyToDraftPatch(
      installationExecutionPolicy,
    );

    setSavedOperationExperience((current) => ({
      ...current,
      ...technicalVisitPatch,
      ...installationPatch,
    }));

    setOperationExperienceDraft((current) => ({
      ...current,
      ...technicalVisitPatch,
      ...installationPatch,
    }));
  }, [
    installationExecutionPolicy,
    operationSettingsInput.technicalVisitCaseByCaseRule,
    operationSettingsInput.technicalVisitFeeDeductibleFromPurchase,
    operationSettingsInput.technicalVisitFixedFeeCents,
    operationSettingsInput.technicalVisitPricingMode,
    technicalVisitExecutionPolicy,
  ]);
  const handleOperationDraftChange = useCallback((key: keyof OperationDraftState, value: string) => {
    setOperationDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleOperationTechnicalVisitRuleToggle = useCallback(
    (value: StoreOperationTechnicalVisitRule) => {
      setOperationDraft((current) => {
        const selectedValues = current.technical_visit_rules_selected.includes(value)
          ? current.technical_visit_rules_selected.filter((item) => item !== value)
          : [...current.technical_visit_rules_selected, value];

        return {
          ...current,
          technical_visit_rules_selected: selectedValues,
        };
      });
    },
    [],
  );

  useEffect(() => {
    const poolReplacementPatch = poolReplacementPolicyToDraftPatch(
      poolReplacementExecutionPolicy,
      isPoolReplacementConfigured,
    );

    const deliveryPatch = deliveryPolicyToDraftPatch(
      deliveryExecutionPolicy,
      isDeliveryConfigured,
    );

    const pickupPatch = pickupPolicyToDraftPatch(
      pickupExecutionPolicy,
      isPickupConfigured,
    );

    const technicalServicesPatch = technicalServicesPolicyToDraftPatch(
      technicalServicesExecutionPolicy,
      isTechnicalServicesConfigured,
    );

    setSavedOperationExperience((current) => ({
      ...current,
      ...poolReplacementPatch,
      ...deliveryPatch,
      ...pickupPatch,
      ...technicalServicesPatch,
    }));

    setOperationExperienceDraft((current) => ({
      ...current,
      ...poolReplacementPatch,
      ...deliveryPatch,
      ...pickupPatch,
      ...technicalServicesPatch,
    }));
  }, [
    deliveryExecutionPolicy,
    isDeliveryConfigured,
    isPickupConfigured,
    isPoolReplacementConfigured,
    isTechnicalServicesConfigured,
    pickupExecutionPolicy,
    poolReplacementExecutionPolicy,
    technicalServicesExecutionPolicy,
  ]);
  const handleOperationEditCancel = useCallback(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers, scheduleSettings, operationSettings));
    setIsOperationEditing(false);
    setOperationEditTarget(null);
  }, [answers, scheduleSettings, operationSettings]);

  const saveTechnicalVisitConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar a visita técnica.",
      );
      setSuccessText(null);
      return false;
    }

    const offersTechnicalVisit = parseYesNoToNullableBoolean(
      operationDraft.offers_technical_visit,
    );

    if (offersTechnicalVisit == null) {
      setErrorText("Defina se a loja oferece visita técnica.");
      setSuccessText(null);
      return false;
    }

    let technicalVisitPolicy: TechnicalVisitExecutionPolicy | null = null;
    let pricingMode: string | null = null;
    let fixedFeeCents: number | null = null;
    let caseByCaseRule: string | null = null;
    let deductible: boolean | null = null;

    if (offersTechnicalVisit) {
      const policyResult = buildTechnicalVisitExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      technicalVisitPolicy = policyResult.value;
      pricingMode = cleanText(
        operationExperienceDraft.visit_pricing_mode,
      );

      if (!["free", "fixed", "case_by_case"].includes(pricingMode)) {
        setErrorText("Defina como a visita técnica é cobrada.");
        setSuccessText(null);
        return false;
      }

      if (pricingMode === "fixed") {
        fixedFeeCents = parseVisitFixedFeeToCents(
          operationExperienceDraft.visit_fixed_fee,
        );

        if (fixedFeeCents == null) {
          setErrorText(
            "Informe um valor válido e positivo para a visita técnica.",
          );
          setSuccessText(null);
          return false;
        }

        deductible = parseYesNoToNullableBoolean(
          operationExperienceDraft.visit_deductible,
        );

        if (deductible == null) {
          setErrorText(
            "Defina se o valor da visita é descontado quando o cliente fecha a compra.",
          );
          setSuccessText(null);
          return false;
        }
      }

      if (pricingMode === "case_by_case") {
        caseByCaseRule = cleanText(
          operationExperienceDraft.visit_case_by_case_rule,
        );

        if (!caseByCaseRule) {
          setErrorText(
            "Explique como o valor da visita técnica é calculado.",
          );
          setSuccessText(null);
          return false;
        }

        deductible = parseYesNoToNullableBoolean(
          operationExperienceDraft.visit_deductible,
        );

        if (deductible == null) {
          setErrorText(
            "Defina se o valor da visita é descontado quando o cliente fecha a compra.",
          );
          setSuccessText(null);
          return false;
        }
      }
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_technical_visit_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_offers_technical_visit: offersTechnicalVisit,
          p_technical_visit_policy: technicalVisitPolicy,
          p_technical_visit_pricing_mode: pricingMode,
          p_technical_visit_fixed_fee_cents: fixedFeeCents,
          p_technical_visit_case_by_case_rule: caseByCaseRule,
          p_technical_visit_fee_deductible_from_purchase: deductible,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer da visita técnica não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = technicalVisitPolicyToDraftPatch(
        savedRow.technical_visit_policy,
        {
          mode: pricingMode,
          fixedFeeCents,
          caseByCaseRule,
          deductible,
        },
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Visita técnica salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração da visita técnica.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationDraft.offers_technical_visit,
    operationExperienceDraft,
    organizationId,
  ]);

  const saveInstallationConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar a instalação.",
      );
      setSuccessText(null);
      return false;
    }

    const offersInstallation = parseYesNoToNullableBoolean(
      operationDraft.offers_installation,
    );

    if (offersInstallation == null) {
      setErrorText("Defina se a loja instala piscinas novas.");
      setSuccessText(null);
      return false;
    }

    let installationPolicy: InstallationExecutionPolicy | null = null;

    if (offersInstallation) {
      const policyResult = buildInstallationExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      installationPolicy = policyResult.value;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_installation_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_offers_installation: offersInstallation,
          p_installation_policy: installationPolicy,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer da instalação não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = installationPolicyToDraftPatch(
        savedRow.installation_policy,
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Instalação salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração da instalação.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationDraft.offers_installation,
    operationExperienceDraft,
    organizationId,
  ]);
  const savePoolReplacementConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar a configuração de troca.",
      );
      setSuccessText(null);
      return false;
    }

    const enabled = parseYesNoToNullableBoolean(
      operationExperienceDraft.pool_replacement_enabled,
    );

    if (enabled == null) {
      setErrorText(
        "Defina se a loja realiza troca ou substituição de piscina existente.",
      );
      setSuccessText(null);
      return false;
    }

    let policy: PoolReplacementExecutionPolicy | null = null;

    if (enabled) {
      const policyResult = buildPoolReplacementExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      policy = policyResult.value;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_pool_replacement_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_enabled: enabled,
          p_policy: policy,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer de troca de piscina não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = poolReplacementPolicyToDraftPatch(
        savedRow.pool_replacement_policy,
        isConfiguredTimestamp(
          savedRow.pool_replacement_configured_at,
        ),
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Troca de piscina salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração de troca de piscina.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
  ]);

  const saveDeliveryConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar a configuração de entrega.",
      );
      setSuccessText(null);
      return false;
    }

    const enabled = parseYesNoToNullableBoolean(
      operationExperienceDraft.delivery_enabled,
    );

    if (enabled == null) {
      setErrorText(
        "Defina se a loja entrega produtos no endereço do cliente.",
      );
      setSuccessText(null);
      return false;
    }

    let policy: DeliveryExecutionPolicy | null = null;

    if (enabled) {
      const policyResult = buildDeliveryExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      policy = policyResult.value;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_delivery_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_enabled: enabled,
          p_policy: policy,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer de entrega não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = deliveryPolicyToDraftPatch(
        savedRow.delivery_policy,
        isConfiguredTimestamp(savedRow.delivery_configured_at),
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Entrega salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração de entrega.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
  ]);

  const savePickupConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar a configuração de retirada.",
      );
      setSuccessText(null);
      return false;
    }

    const enabled = parseYesNoToNullableBoolean(
      operationExperienceDraft.pickup_enabled,
    );

    if (enabled == null) {
      setErrorText(
        "Defina se a loja permite que clientes retirem produtos.",
      );
      setSuccessText(null);
      return false;
    }

    let policy: PickupExecutionPolicy | null = null;

    if (enabled) {
      const policyResult = buildPickupExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      policy = policyResult.value;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_pickup_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_enabled: enabled,
          p_policy: policy,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer de retirada não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = pickupPolicyToDraftPatch(
        savedRow.pickup_policy,
        isConfiguredTimestamp(savedRow.pickup_configured_at),
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Retirada salva com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração de retirada.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
  ]);

  const saveTechnicalServicesConfigurationCard = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText(
        "Nenhuma loja ativa foi encontrada para salvar os serviços técnicos.",
      );
      setSuccessText(null);
      return false;
    }

    const enabled = parseYesNoToNullableBoolean(
      operationExperienceDraft.technical_services_enabled,
    );

    if (enabled == null) {
      setErrorText(
        "Defina se a loja realiza serviços técnicos além da instalação de piscinas.",
      );
      setSuccessText(null);
      return false;
    }

    let policy: TechnicalServicesExecutionPolicy | null = null;

    if (enabled) {
      const policyResult = buildTechnicalServicesExecutionPolicy(
        operationExperienceDraft,
      );

      if (!policyResult.ok) {
        setErrorText(policyResult.error);
        setSuccessText(null);
        return false;
      }

      policy = policyResult.value;
    }

    try {
      const { data, error } = await supabase.rpc(
        "upsert_store_operation_technical_services_configuration_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_enabled: enabled,
          p_policy: policy,
        },
      );

      if (error) throw error;

      const savedRow = (
        Array.isArray(data)
          ? data[0] ?? null
          : data ?? null
      ) as StoreOperationExecutionPoliciesRow | null;

      if (!savedRow) {
        throw new Error(
          "O writer de serviços técnicos não retornou a configuração salva.",
        );
      }

      setOperationExecutionPolicies(savedRow);

      const canonicalPatch = technicalServicesPolicyToDraftPatch(
        savedRow.technical_services_policy,
        isConfiguredTimestamp(
          savedRow.technical_services_configured_at,
        ),
      );

      setSavedOperationExperience((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setOperationExperienceDraft((current) => ({
        ...current,
        ...canonicalPatch,
      }));

      setErrorText(null);
      setSuccessText("Serviços técnicos salvos com sucesso.");
      setOperationEditTarget(null);
      setIsOperationEditing(false);

      await fetchPageData();
      return true;
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração de serviços técnicos.",
      );
      setSuccessText(null);
      return false;
    }
  }, [
    activeStoreId,
    fetchPageData,
    operationExperienceDraft,
    organizationId,
  ]);
  const handleOperationEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a operação.");
      setSuccessText(null);
      return;
    }

    try {
      const parsedAverageInstallationTime = parseOptionalPositiveInteger(
        operationDraft.average_installation_time_days,
      );

      if (Number.isNaN(parsedAverageInstallationTime)) {
        setErrorText(
          "Prazo médio de instalação deve ser vazio ou um inteiro positivo.",
        );
        setSuccessText(null);
        return;
      }

      const normalizedOperationSettings = normalizeStoreOperationSettingsInput({
        offersInstallation: parseYesNoToNullableBoolean(
          operationDraft.offers_installation,
        ),
        averageInstallationTimeDays: parsedAverageInstallationTime,
        installationDaysRule: operationDraft.installation_days_rule,
        installationProcessNotes: operationDraft.installation_process_summary,
        offersTechnicalVisit: parseYesNoToNullableBoolean(
          operationDraft.offers_technical_visit,
        ),
        technicalVisitDaysRule: operationDraft.technical_visit_days_rule,
        technicalVisitRules: operationDraft.technical_visit_rules_selected,
        technicalVisitRulesOther: operationDraft.technical_visit_rules_other,
      });

      if (!normalizedOperationSettings.ok) {
        setErrorText(normalizedOperationSettings.error);
        setSuccessText(null);
        return;
      }

      const { data: savedOperationSettings, error: operationSettingsError } =
        await supabase.rpc(
          "upsert_store_operation_settings_with_legacy_mirror_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_offers_installation:
              normalizedOperationSettings.value.offersInstallation,
            p_average_installation_time_days:
              normalizedOperationSettings.value.averageInstallationTimeDays,
            p_installation_days_rule:
              normalizedOperationSettings.value.installationDaysRule,
            p_installation_process_notes:
              normalizedOperationSettings.value.installationProcessNotes,
            p_offers_technical_visit:
              normalizedOperationSettings.value.offersTechnicalVisit,
            p_technical_visit_days_rule:
              normalizedOperationSettings.value.technicalVisitDaysRule,
            p_technical_visit_rules:
              normalizedOperationSettings.value.technicalVisitRules,
            p_technical_visit_rules_other:
              normalizedOperationSettings.value.technicalVisitRulesOther,
          },
        );

      if (operationSettingsError) throw operationSettingsError;

      let savedScheduleSettings: ScheduleSettingsRow | null = null;

      if (scheduleSettings) {
        const updatedOperatingDays = applyWeekendSelectionToOperatingDays({
          currentDays: scheduleSettings.operating_days,
          saturdaySelection: operationDraft.serves_saturday,
          sundaySelection: operationDraft.serves_sunday,
        });
        const { data: scheduleData, error: scheduleSettingsError } =
          await supabase.rpc("upsert_store_schedule_settings", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_allow_multiple_appointments_per_day: parseYesNoToBoolean(
              operationDraft.allow_multiple_appointments_per_day,
              scheduleSettings.allow_multiple_appointments_per_day,
            ),
            p_allow_same_time_appointments: parseYesNoToBoolean(
              operationDraft.allow_same_time_appointments,
              scheduleSettings.allow_same_time_appointments,
            ),
            p_same_time_capacity: Math.max(
              1,
              Number.parseInt(
                cleanText(operationDraft.agenda_capacity_rule) ||
                  String(scheduleSettings.same_time_capacity || 1),
                10,
              ) || 1,
            ),
            p_attends_holidays: parseYesNoToBoolean(
              operationDraft.serves_holiday,
              scheduleSettings.attends_holidays,
            ),
            p_operating_days: updatedOperatingDays,
            p_operating_hours:
              scheduleSettings.operating_hours &&
              typeof scheduleSettings.operating_hours === "object"
                ? scheduleSettings.operating_hours
                : {},
            p_installation_days: Array.isArray(scheduleSettings.installation_days)
              ? scheduleSettings.installation_days
              : [],
            p_after_hours_behavior: scheduleSettings.after_hours_behavior ?? null,
            p_notes: scheduleSettings.notes ?? null,
            p_enforce_operating_window: scheduleSettings.enforce_operating_window ?? false,
            p_timezone_name: scheduleSettings.timezone_name || "America/Sao_Paulo",
          });

        if (scheduleSettingsError) throw scheduleSettingsError;
        savedScheduleSettings = (scheduleData ?? null) as ScheduleSettingsRow | null;
      }

      setOperationSettings(
        (savedOperationSettings ?? null) as StoreOperationSettingsRow | null,
      );
      if (savedScheduleSettings) {
        setScheduleSettings(savedScheduleSettings);
      }
      setErrorText(null);
      setSuccessText("Alterações da operação salvas com sucesso.");
      setIsOperationEditing(false);
      setOperationEditTarget(null);
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar alterações da operação.");
      setSuccessText(null);
    }
  }, [
    organizationId,
    activeStoreId,
    operationDraft,
    scheduleSettings,
    fetchPageData,
  ]);


  useEffect(() => {
    setCommercialDraft(
      createCommercialDraftFromAnswersWithPaymentSettings(
        answers,
        paymentSettings,
        discountSettings,
        highValueDiscountSettings,
        commercialAiSettings,
        strategySettingsInput,
      ),
    );
  }, [
    answers,
    commercialAiSettings,
    discountSettings,
    highValueDiscountSettings,
    paymentSettings,
    strategySettingsInput,
  ]);

  useEffect(() => {
    setPrimaryResponsibleDraft(canonicalPrimaryResponsibleDraft);
    setAdditionalResponsiblesDraft(parseResponsiblePeopleFromAnswers(answers));
    setActivationConfirmInformationDraft(Boolean(answers.confirm_information_is_correct));
    setActivationNotificationCasesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.responsible_notification_cases),
        RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
        cleanText(answers.responsible_notification_cases_other)
      )
    );
    setActivationPreferencesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
        cleanText(answers.activation_preferences_other)
      )
    );
  }, [answers, canonicalPrimaryResponsibleDraft]);

  const handleCommercialDraftChange = useCallback((key: keyof CommercialDraftState, value: string) => {
    setCommercialDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleCommercialPaymentMethodToggle = useCallback((value: string) => {
    setCommercialDraft((current) => {
      const selectedValues = current.accepted_payment_methods.includes(value)
        ? current.accepted_payment_methods.filter((item) => item !== value)
        : [...current.accepted_payment_methods, value];

      return {
        ...current,
        accepted_payment_methods: selectedValues,
      };
    });
  }, []);

  const handleCommercialPriceContextRequirementToggle = useCallback((value: string) => {
    setCommercialDraft((current) => {
      const selectedValues = current.price_context_requirements.includes(value)
        ? current.price_context_requirements.filter((item) => item !== value)
        : [...current.price_context_requirements, value];

      return {
        ...current,
        price_context_requirements: selectedValues,
      };
    });
  }, []);

  const updateCommercialExperienceDraft = useCallback(<K extends keyof CommercialExperienceDraftState>(
    key: K,
    value: CommercialExperienceDraftState[K],
  ) => {
    setCommercialExperienceDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const toggleCommercialExperienceArrayValue = useCallback((
    key: keyof CommercialExperienceDraftState,
    value: string,
  ) => {
    setCommercialExperienceDraft((current) => {
      const currentValue = current[key];
      if (!Array.isArray(currentValue)) return current;

      const exclusiveValue =
        key === "strategy_avoid_cases"
          ? "nenhum"
          : key === "strategy_sell_more" || key === "strategy_priority_deal_types"
            ? "sem_prioridade"
            : null;

      let nextValue: string[];

      if (exclusiveValue) {
        if (value === exclusiveValue) {
          nextValue = currentValue.includes(value) ? [] : [value];
        } else {
          const withoutExclusive = currentValue.filter((item) => item !== exclusiveValue);
          nextValue = withoutExclusive.includes(value)
            ? withoutExclusive.filter((item) => item !== value)
            : [...withoutExclusive, value];
        }
      } else {
        nextValue = currentValue.includes(value)
          ? currentValue.filter((item) => item !== value)
          : [...currentValue, value];
      }

      const nextState = {
        ...current,
        [key]: nextValue,
      } as CommercialExperienceDraftState;

      if (key === "strategy_sell_more" && !nextValue.includes("outro")) {
        nextState.strategy_sell_more_other = "";
      }

      if (key === "strategy_priority_deal_types" && !nextValue.includes("outro")) {
        nextState.strategy_priority_deal_types_other = "";
      }

      if (key === "strategy_avoid_cases") {
        if (!nextValue.includes("outro")) {
          nextState.strategy_avoid_cases_other = "";
        }

        if (nextValue.includes("nenhum") || nextValue.length === 0) {
          nextState.strategy_avoid_action = "";
        }
      }

      return nextState;
    });
  }, []);
  const saveCommercialExperienceCard = useCallback(async (target: string) => {
    const required = (condition: boolean, value: unknown, message: string) =>
      condition && !cleanText(value) ? message : "";

    let validationError = "";

    if (target === "offerings") {
      validationError =
        (commercialExperienceDraft.offering_products.length === 0 && commercialExperienceDraft.offering_services.length === 0
          ? "Selecione pelo menos um tipo de produto ou serviço que a loja oferece."
          : "") ||
        required(commercialExperienceDraft.offering_products.includes("outro"), commercialExperienceDraft.offering_products_other, "Explique quais outros produtos a loja vende.") ||
        required(commercialExperienceDraft.offering_services.includes("outro"), commercialExperienceDraft.offering_services_other, "Explique quais outros serviços a loja oferece.");
    }

    if (target === "strategy") {
      validationError =
        commercialExperienceDraft.strategy_sell_more.length === 0
          ? "Selecione o que a loja quer priorizar nas vendas."
          : commercialExperienceDraft.strategy_sell_more.includes("sem_prioridade") && commercialExperienceDraft.strategy_sell_more.length > 1
            ? "Se não existe uma prioridade específica, não selecione outras prioridades junto."
            : required(commercialExperienceDraft.strategy_sell_more.includes("outro"), commercialExperienceDraft.strategy_sell_more_other, "Explique a outra prioridade comercial da loja.") ||
              (commercialExperienceDraft.strategy_priority_deal_types.length === 0
                ? "Selecione quais tipos de negócio a loja quer priorizar."
                : commercialExperienceDraft.strategy_priority_deal_types.includes("sem_prioridade") && commercialExperienceDraft.strategy_priority_deal_types.length > 1
                  ? "Se não existe prioridade por tipo de negócio, não selecione outras opções junto."
                  : required(commercialExperienceDraft.strategy_priority_deal_types.includes("outro"), commercialExperienceDraft.strategy_priority_deal_types_other, "Explique o outro tipo de negócio que a loja quer priorizar.") ||
                    (commercialExperienceDraft.strategy_avoid_cases.length === 0
                      ? "Informe se existe algum tipo de atendimento ou negócio que a loja prefere evitar."
                      : commercialExperienceDraft.strategy_avoid_cases.includes("nenhum") && commercialExperienceDraft.strategy_avoid_cases.length > 1
                        ? "Se não existe nenhum caso específico, não selecione outros casos junto."
                        : required(commercialExperienceDraft.strategy_avoid_cases.includes("outro"), commercialExperienceDraft.strategy_avoid_cases_other, "Explique o outro tipo de atendimento ou negócio que a loja prefere evitar.") ||
                          (!commercialExperienceDraft.strategy_avoid_cases.includes("nenhum") && !cleanText(commercialExperienceDraft.strategy_avoid_action)
                            ? "Informe o que a IA deve fazer quando identificar um desses casos."
                            : !cleanText(commercialExperienceDraft.strategy_sale_value_range)
                              ? "Informe a faixa de valor típica das vendas da loja."
                              : required(["outra", "varia_muito"].includes(commercialExperienceDraft.strategy_sale_value_range), commercialExperienceDraft.strategy_sale_value_custom, commercialExperienceDraft.strategy_sale_value_range === "varia_muito" ? "Explique como o valor das vendas costuma variar." : "Informe a outra faixa de valor das vendas."))));
    }
    if (target === "brands") {
      const workedBrands = commercialExperienceDraft.brands_worked.filter((item) => cleanText(item));
      const priorityBrands = commercialExperienceDraft.brands_priority.filter((item) => cleanText(item));
      validationError =
        required(true, commercialExperienceDraft.brands_has_main, "Informe se a loja trabalha com uma marca principal.") ||
        required(commercialExperienceDraft.brands_has_main === "Sim", commercialExperienceDraft.brands_main_choice, "Escolha a marca principal da loja.") ||
        required(commercialExperienceDraft.brands_main_choice === "outro", commercialExperienceDraft.brands_main_other, "Informe qual é a outra marca principal.") ||
        required(workedBrands.includes("outro"), commercialExperienceDraft.brands_worked_other, "Informe qual é a outra marca que a loja trabalha.") ||
        required(true, commercialExperienceDraft.brands_priority_enabled, "Informe se a loja possui alguma marca preferida entre opções adequadas e disponíveis.") ||
        (commercialExperienceDraft.brands_priority_enabled === "Sim" && priorityBrands.length === 0 ? "Adicione pelo menos uma marca que deve receber preferência." : "") ||
        required(priorityBrands.includes("outro"), commercialExperienceDraft.brands_priority_other, "Informe a outra marca preferida.");
    }

    if (target === "ai") {
      validationError =
        required(commercialExperienceDraft.ai_guidance_enabled === "Sim", commercialExperienceDraft.ai_guidance_other, "Explique a orientação comercial adicional da loja.");
    }

    if (target === "suggestions") {
      const selectedCatalogSuggestionTypes = CATALOG_BACKED_SUGGESTION_TYPES.filter((type) =>
        commercialExperienceDraft.suggestion_types.includes(type),
      );
      const missingCatalogType = selectedCatalogSuggestionTypes.find((type) => {
        const availableItems = catalogSuggestionItems.filter((item) => item.category === type);
        if (availableItems.length === 0) return true;
        return !availableItems.some((item) =>
          commercialExperienceDraft.suggestion_catalog_item_keys.includes(item.key),
        );
      });
      const missingCatalogTypeLabel = missingCatalogType
        ? optionLabel(missingCatalogType, COMMERCIAL_SUGGESTION_TYPE_OPTIONS)
        : "";

      validationError =
        (commercialExperienceDraft.suggestions_enabled === "Sim" && commercialExperienceDraft.suggestion_types.length === 0 ? "Selecione o que a IA pode sugerir." : "") ||
        (missingCatalogType ? `Selecione pelo menos um item real do catálogo para: ${missingCatalogTypeLabel}. Se ainda não houver item cadastrado, configure o Catálogo primeiro.` : "") ||
        required(commercialExperienceDraft.suggestion_types.includes("servicos"), commercialExperienceDraft.suggestion_services_detail, "Explique quais serviços relacionados a IA pode sugerir.") ||
        required(commercialExperienceDraft.suggestion_types.includes("outro"), commercialExperienceDraft.suggestion_other, "Explique o outro tipo de sugestão.") ||
        required(commercialExperienceDraft.suggestions_enabled === "Sim", commercialExperienceDraft.better_option_policy, "Defina quando a IA pode apresentar uma opção melhor ou mais completa.");
    }

    if (target === "payment_blocks") {
      validationError =
        required(true, commercialExperienceDraft.entry_due_trigger, "Defina quando a entrada precisa estar paga ou informe que a loja não exige entrada.") ||
        required(commercialExperienceDraft.entry_due_trigger === "outro", commercialExperienceDraft.entry_due_other, "Explique quando a entrada precisa estar paga.") ||
        required(true, commercialExperienceDraft.balance_due_trigger, "Defina quando o restante do valor precisa estar pago.") ||
        required(commercialExperienceDraft.balance_due_trigger === "outro", commercialExperienceDraft.balance_due_other, "Explique quando o restante do valor precisa estar pago.") ||
        (commercialExperienceDraft.payment_blocking_actions.length === 0 ? "Selecione quais etapas ficam bloqueadas ou marque que nenhuma delas é bloqueada automaticamente." : "") ||
        required(commercialExperienceDraft.payment_blocking_actions.includes("outro"), commercialExperienceDraft.payment_blocking_other, "Explique a outra ação que não pode avançar com pagamento pendente.");
    }

    if (target === "quote") {
      validationError =
        required(true, commercialExperienceDraft.quote_validity, "Defina por quantos dias um orçamento normalmente é válido.") ||
        required(commercialExperienceDraft.quote_validity === "outro", commercialExperienceDraft.quote_validity_other_days, "Informe por quantos dias o orçamento é válido.") ||
        required(true, commercialExperienceDraft.quote_customer_note_enabled, "Informe se a loja usa uma mensagem padrão nos orçamentos.") ||
        required(commercialExperienceDraft.quote_customer_note_enabled === "Sim", commercialExperienceDraft.quote_customer_note, "Informe a mensagem padrão que deve aparecer no orçamento.") ||
        required(true, commercialExperienceDraft.quote_internal_note_enabled, "Informe se a loja usa uma observação interna padrão.") ||
        required(commercialExperienceDraft.quote_internal_note_enabled === "Sim", commercialExperienceDraft.quote_internal_note, "Informe a observação interna padrão.") ||
        required(true, commercialExperienceDraft.quote_preliminary_before_visit, "Defina se a loja pode enviar orçamento inicial antes de uma visita técnica obrigatória.") ||
        required(true, commercialExperienceDraft.quote_definitive_requires_visit_result, "Defina se o resultado da visita é necessário para o orçamento final.");
    }

    if (target === "post_sale") {
      validationError =
        required(commercialExperienceDraft.post_sale_duration === "outro", commercialExperienceDraft.post_sale_duration_other_days, "Informe por quantos dias a loja acompanha o cliente.") ||
        required(commercialExperienceDraft.post_sale_start === "depende", commercialExperienceDraft.post_sale_start_other, "Explique quando o pós-venda começa em cada tipo de venda.") ||
        required(commercialExperienceDraft.post_sale_checks.includes("outro"), commercialExperienceDraft.post_sale_checks_other, "Explique o outro ponto que a loja verifica no pós-venda.");
    }

    if (target === "warranty") {
      validationError =
        required(commercialExperienceDraft.warranty_extra_mode === "depende", commercialExperienceDraft.warranty_extra_rule, "Explique quando existe garantia própria da loja.") ||
        required(commercialExperienceDraft.warranty_items.includes("outro"), commercialExperienceDraft.warranty_items_other, "Informe o outro item ou serviço com garantia.") ||
        required(commercialExperienceDraft.warranty_start === "outro", commercialExperienceDraft.warranty_start_other, "Explique quando começa a contar a garantia.") ||
        required(commercialExperienceDraft.warranty_extra_mode === "Sim", commercialExperienceDraft.warranty_duration_value, "Informe quanto tempo dura a garantia própria da loja.") ||
        required(commercialExperienceDraft.warranty_conditions_enabled === "Sim", commercialExperienceDraft.warranty_conditions, "Explique as condições importantes da garantia.");
    }

    if (target === "cancellation") {
      const hasPolicy = commercialExperienceDraft.cancellation_policy_exists === "Sim";
      const situations = commercialExperienceDraft.cancellation_rule_situations;
      validationError =
        (hasPolicy && situations.length === 0 ? "Selecione pelo menos uma situação em que a política da loja possui uma regra específica." : "") ||
        required(hasPolicy && situations.includes("after_contract"), commercialExperienceDraft.cancellation_after_contract_rule, "Explique a regra aplicável após a assinatura do contrato.") ||
        required(hasPolicy && situations.includes("ordered_product"), commercialExperienceDraft.cancellation_ordered_product_rule, "Explique a regra para produto já encomendado ao fornecedor.") ||
        required(hasPolicy && situations.includes("custom_order"), commercialExperienceDraft.cancellation_custom_order_rule, "Explique a regra para produtos sob encomenda ou personalizados.") ||
        required(hasPolicy && situations.includes("after_delivery"), commercialExperienceDraft.cancellation_after_delivery_rule, "Explique a regra aplicável depois da entrega ou retirada.") ||
        required(hasPolicy && situations.includes("service_started"), commercialExperienceDraft.cancellation_service_started_rule, "Explique a regra quando instalação ou serviço já começou.") ||
        required(hasPolicy && situations.includes("charge_or_retention"), commercialExperienceDraft.cancellation_charge_or_retention_rule, "Explique a regra validada de multa, cobrança ou retenção.") ||
        required(hasPolicy && situations.includes("refund"), commercialExperienceDraft.cancellation_refund_rule, "Explique a regra de reembolso da loja.") ||
        required(hasPolicy && situations.includes("other"), commercialExperienceDraft.cancellation_policy_other, "Explique a outra regra da política.");
    }

    if (validationError) {
      setErrorText(validationError);
      setSuccessText(null);
      return false;
    }

    const normalizedCommercialExperience =
      target === "brands"
        ? {
            ...commercialExperienceDraft,
            brands_worked: commercialExperienceDraft.brands_worked.filter((item) => cleanText(item)),
            brands_priority: commercialExperienceDraft.brands_priority.filter((item) => cleanText(item)),
          }
        : commercialExperienceDraft;

    const nextStrategyInput =
      target === "offerings"
        ? {
            ...strategySettingsInput,
            storeServices: buildStrategyServicesFromOfferings(normalizedCommercialExperience),
            storeServicesOther: buildStoreServicesOtherFromOfferings(
              normalizedCommercialExperience,
            ),
          }
        : target === "brands"
          ? {
              ...strategySettingsInput,
              brandsWorked: buildBrandsWorkedForStrategy(
                normalizedCommercialExperience.brands_worked,
                normalizedCommercialExperience.brands_worked_other,
              ),
            }
          : strategySettingsInput;

    if (target === "strategy") {
      if (!organizationId || !activeStoreId) {
        setErrorText("Não foi possível identificar a loja ativa.");
        setSuccessText(null);
        return false;
      }

      try {
        const { data: savedStructuredStrategy, error: structuredStrategySaveError } = await supabase.rpc(
          "upsert_store_commercial_strategy_policy_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_strategy_sell_more_choices: normalizedCommercialExperience.strategy_sell_more,
            p_strategy_sell_more_other: normalizedCommercialExperience.strategy_sell_more.includes("outro")
              ? cleanText(normalizedCommercialExperience.strategy_sell_more_other)
              : null,
            p_strategy_priority_deal_types: normalizedCommercialExperience.strategy_priority_deal_types,
            p_strategy_priority_deal_types_other: normalizedCommercialExperience.strategy_priority_deal_types.includes("outro")
              ? cleanText(normalizedCommercialExperience.strategy_priority_deal_types_other)
              : null,
            p_strategy_avoid_cases: normalizedCommercialExperience.strategy_avoid_cases,
            p_strategy_avoid_cases_other: normalizedCommercialExperience.strategy_avoid_cases.includes("outro")
              ? cleanText(normalizedCommercialExperience.strategy_avoid_cases_other)
              : null,
            p_strategy_avoid_action: normalizedCommercialExperience.strategy_avoid_cases.includes("nenhum")
              ? null
              : cleanText(normalizedCommercialExperience.strategy_avoid_action) || null,
            p_strategy_sale_value_range: cleanText(normalizedCommercialExperience.strategy_sale_value_range) || null,
            p_strategy_sale_value_custom: ["outra", "varia_muito"].includes(normalizedCommercialExperience.strategy_sale_value_range)
              ? cleanText(normalizedCommercialExperience.strategy_sale_value_custom)
              : null,
          },
        );

        if (structuredStrategySaveError) throw structuredStrategySaveError;
        setStrategySettings((savedStructuredStrategy ?? null) as StoreStrategySettingsRow | null);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Não foi possível salvar a estratégia comercial.");
        setSuccessText(null);
        return false;
      }
    }
    if (target === "offerings" || target === "brands") {
      if (!organizationId || !activeStoreId) {
        setErrorText("Nenhuma loja ativa foi encontrada para salvar a estrategia.");
        setSuccessText(null);
        return false;
      }

      const normalizedStrategySettings = normalizeStoreStrategySettingsInput(nextStrategyInput);

      try {
        const { data: savedStrategySettings, error: strategySaveError } =
          await supabase.rpc(
            "upsert_store_strategy_settings_with_legacy_mirror_scoped",
            {
              p_organization_id: organizationId,
              p_store_id: activeStoreId,
              p_city: normalizedStrategySettings.value.city,
              p_state: normalizedStrategySettings.value.state,
              p_service_regions: normalizedStrategySettings.value.serviceRegions,
              p_service_region_modes: normalizedStrategySettings.value.serviceRegionModes,
              p_service_region_primary_mode:
                normalizedStrategySettings.value.serviceRegionPrimaryMode,
              p_service_region_outside_consultation:
                normalizedStrategySettings.value.serviceRegionOutsideConsultation,
              p_service_region_notes: normalizedStrategySettings.value.serviceRegionNotes,
              p_store_services: normalizedStrategySettings.value.storeServices,
              p_store_services_other: normalizedStrategySettings.value.storeServicesOther,
              p_store_description: normalizedStrategySettings.value.storeDescription,
              p_main_store_brand: normalizedStrategySettings.value.mainStoreBrand,
              p_brands_worked: normalizedStrategySettings.value.brandsWorked,
              p_strategy_service_exclusions:
                normalizedStrategySettings.value.strategyServiceExclusions,
              p_strategy_primary_focus:
                normalizedStrategySettings.value.strategyPrimaryFocus,
              p_strategy_sell_more: normalizedStrategySettings.value.strategySellMore,
              p_strategy_common_customer:
                normalizedStrategySettings.value.strategyCommonCustomer,
              p_strategy_ideal_customer:
                normalizedStrategySettings.value.strategyIdealCustomer,
              p_strategy_ticket_range:
                normalizedStrategySettings.value.strategyTicketRange,
              p_strategy_positioning:
                normalizedStrategySettings.value.strategyPositioning,
              p_strategy_priority_brands:
                normalizedStrategySettings.value.strategyPriorityBrands,
              p_strategy_non_worked_brands:
                normalizedStrategySettings.value.strategyNonWorkedBrands,
              p_strategy_top_lines: normalizedStrategySettings.value.strategyTopLines,
              p_strategy_top_products:
                normalizedStrategySettings.value.strategyTopProducts,
              p_strategy_differentials:
                normalizedStrategySettings.value.strategyDifferentials,
              p_strategy_promise_limits:
                normalizedStrategySettings.value.strategyPromiseLimits,
              p_strategy_ai_presentation:
                normalizedStrategySettings.value.strategyAiPresentation,
              p_strategy_ai_priorities:
                normalizedStrategySettings.value.strategyAiPriorities,
              p_strategy_ai_never_forget:
                normalizedStrategySettings.value.strategyAiNeverForget,
            },
          );

        if (strategySaveError) throw strategySaveError;

        setStrategySettings(
          (savedStrategySettings ?? null) as StoreStrategySettingsRow | null,
        );
      } catch (error: any) {
        setErrorText(error?.message ?? "Nao foi possivel salvar as alteracoes da estrategia.");
        setSuccessText(null);
        return false;
      }
    }

    const nextCommercialExperience = createCanonicalCommercialExperienceDraft(
      normalizedCommercialExperience,
      nextStrategyInput,
    );

    setCommercialExperienceDraft(nextCommercialExperience);
    setSavedCommercialExperience(nextCommercialExperience);
    setErrorText(null);
    setSuccessText("Configuração comercial atualizada.");

    if (["offerings", "strategy", "brands", "ai"].includes(target)) {
      setStrategyEditTarget(null);
      setIsStrategyEditing(false);
    } else {
      setCommercialExperienceEditTarget(null);
    }

    return true;
  }, [
    activeStoreId,
    catalogSuggestionItems,
    commercialExperienceDraft,
    organizationId,
    strategySettingsInput,
  ]);

  const handleCommercialEditCancel = useCallback(() => {
    setCommercialDraft(
      createCommercialDraftFromAnswersWithPaymentSettings(
        answers,
        paymentSettings,
        discountSettings,
        highValueDiscountSettings,
        commercialAiSettings,
        strategySettingsInput,
      ),
    );
    setCommercialExperienceDraft(savedCommercialExperience);
    setIsCommercialEditing(false);
    setCommercialEditTarget(null);
  }, [
    answers,
    commercialAiSettings,
    discountSettings,
    highValueDiscountSettings,
    paymentSettings,
    savedCommercialExperience,
    strategySettingsInput,
  ]);

  const handleCommercialEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alteraÃ§Ãµes.");
      setSuccessText(null);
      return;
    }

    if (commercialEditTarget === "ai_price" && commercialExperienceDraft.price_context_other_enabled && !cleanText(commercialExperienceDraft.price_context_other)) {
      setErrorText("Explique qual é o outro contexto necessário antes de informar preço.");
      setSuccessText(null);
      return;
    }

    if (commercialEditTarget === "payments") {
      if (commercialExperienceDraft.payment_other_enabled && !cleanText(commercialExperienceDraft.payment_other_method)) {
        setErrorText("Informe qual é a outra forma de pagamento aceita pela loja.");
        setSuccessText(null);
        return;
      }

      if (["optional", "required"].includes(commercialDraft.down_payment_mode) && commercialDraft.down_payment_value_type === "case_by_case" && !cleanText(commercialExperienceDraft.down_payment_case_rule)) {
        setErrorText("Explique como a entrada é definida quando varia conforme a venda.");
        setSuccessText(null);
        return;
      }

      if (normalizeLoose(commercialDraft.installments_enabled) === "sim") {
        const maxInstallments = Number.parseInt(cleanText(commercialDraft.max_installments), 10);
        if (!Number.isInteger(maxInstallments) || maxInstallments <= 0) {
          setErrorText("Informe em até quantas vezes a loja parcela.");
          setSuccessText(null);
          return;
        }

        if (!cleanText(commercialExperienceDraft.installments_interest_free_enabled)) {
          setErrorText("Informe se existe parcelamento sem juros.");
          setSuccessText(null);
          return;
        }

        if (commercialExperienceDraft.installments_interest_free_enabled === "Sim") {
          const interestFreeMax = Number.parseInt(cleanText(commercialExperienceDraft.installments_interest_free_max), 10);
          if (!Number.isInteger(interestFreeMax) || interestFreeMax <= 0 || interestFreeMax > maxInstallments) {
            setErrorText("Informe um número válido de parcelas sem juros, sem ultrapassar o máximo de parcelas.");
            setSuccessText(null);
            return;
          }
        }

        if (["regra_propria", "depende", "outro"].includes(commercialExperienceDraft.installment_interest_above_mode) && !cleanText(commercialExperienceDraft.installment_interest_above_rule)) {
          setErrorText("Explique como funcionam os juros acima do parcelamento sem juros.");
          setSuccessText(null);
          return;
        }

        if (commercialExperienceDraft.installment_minimum_enabled === "Sim" && !cleanText(commercialExperienceDraft.installment_minimum_amount)) {
          setErrorText("Informe o valor mínimo de cada parcela.");
          setSuccessText(null);
          return;
        }
      }

      if (commercialDraft.accepted_payment_methods.includes("financiamento")) {
        if (!cleanText(commercialExperienceDraft.financing_mode)) {
          setErrorText("Explique como funciona o financiamento oferecido aos clientes.");
          setSuccessText(null);
          return;
        }
        if (commercialExperienceDraft.financing_mode === "parceiro" && !cleanText(commercialExperienceDraft.financing_partner_name)) {
          setErrorText("Informe o banco ou financeira parceira.");
          setSuccessText(null);
          return;
        }
        if (["depende", "outro"].includes(commercialExperienceDraft.financing_mode) && !cleanText(commercialExperienceDraft.financing_other)) {
          setErrorText("Explique como funciona o financiamento nesse caso.");
          setSuccessText(null);
          return;
        }
        if (!cleanText(commercialExperienceDraft.financing_credit_analysis) || !cleanText(commercialExperienceDraft.financing_simulation_by) || !cleanText(commercialExperienceDraft.financing_ai_policy)) {
          setErrorText("Complete as perguntas sobre análise de crédito, simulação e o que a IA pode informar sobre financiamento.");
          setSuccessText(null);
          return;
        }
      }
    }

    const normalizedPaymentSettings = normalizeStorePaymentSettingsInput({
      acceptedPaymentMethods: commercialDraft.accepted_payment_methods,
      pixKeyType: commercialDraft.pix_key_type,
      pixKey: commercialDraft.pix_key,
      pixHolderName: commercialDraft.pix_holder_name,
      downPaymentMode: commercialDraft.down_payment_mode,
      downPaymentValueType: commercialDraft.down_payment_value_type,
      downPaymentPercent: commercialDraft.down_payment_percent,
      downPaymentAmount: commercialDraft.down_payment_amount,
      installmentsEnabled: commercialDraft.installments_enabled,
      maxInstallments: commercialDraft.max_installments,
      installmentInterestPolicy: commercialDraft.installment_interest_policy,
      paymentNotes: commercialDraft.payment_notes,
    });

    if (!normalizedPaymentSettings.ok) {
      setErrorText(normalizedPaymentSettings.error);
      setSuccessText(null);
      return;
    }
    const normalizedCommercialAiSettings =
      normalizeStoreCommercialAiSettingsInput({
        priceAnswerPolicy: commercialDraft.price_answer_policy,
        priceContextRequirements: commercialDraft.price_context_requirements,
      });

    if (!normalizedCommercialAiSettings.ok) {
      setErrorText(normalizedCommercialAiSettings.error);
      setSuccessText(null);
      return;
    }

    const derivedPaymentSummary = deriveStorePaymentSettingsSummary(
      normalizedPaymentSettings.value,
    );

    const { data: savedPaymentSettings, error: paymentSettingsError } =
      await supabase.rpc("upsert_store_payment_settings_with_legacy_mirror_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_accepted_payment_methods:
          normalizedPaymentSettings.value.acceptedPaymentMethods,
        p_pix_key_type: normalizedPaymentSettings.value.pixKeyType,
        p_pix_key: normalizedPaymentSettings.value.pixKey,
        p_pix_holder_name: normalizedPaymentSettings.value.pixHolderName,
        p_down_payment_mode: normalizedPaymentSettings.value.downPaymentMode,
        p_down_payment_value_type:
          normalizedPaymentSettings.value.downPaymentValueType,
        p_down_payment_percent:
          normalizedPaymentSettings.value.downPaymentPercent,
        p_down_payment_amount_cents:
          normalizedPaymentSettings.value.downPaymentAmountCents,
        p_installments_enabled:
          normalizedPaymentSettings.value.installmentsEnabled,
        p_max_installments: normalizedPaymentSettings.value.maxInstallments,
        p_installment_interest_policy:
          normalizedPaymentSettings.value.installmentInterestPolicy,
        p_payment_notes: normalizedPaymentSettings.value.paymentNotes,
      });

    if (paymentSettingsError) {
      setErrorText("Falha ao sincronizar as configuracoes canonicas de pagamento.");
      setSuccessText(null);
      return;
    }

    setPaymentSettings((savedPaymentSettings ?? null) as StorePaymentSettingsRow | null);
    const { data: savedCommercialAiSettings, error: commercialAiSettingsError } =
      await supabase.rpc("upsert_store_commercial_ai_settings_with_legacy_mirror_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_price_answer_policy:
          normalizedCommercialAiSettings.value.priceAnswerPolicy,
        p_price_context_requirements:
          normalizedCommercialAiSettings.value.priceContextRequirements,
      });

    if (commercialAiSettingsError) {
      setErrorText("Falha ao sincronizar as configuracoes canonicas comerciais.");
      setSuccessText(null);
      return;
    }

    setCommercialAiSettings(
      (savedCommercialAiSettings ?? null) as StoreCommercialAiSettingsRow | null,
    );

    const saved = await upsertConfigAnswers(
      {
        store_display_name: commercialDraft.ai_display_name,
        activation_preferences_other: commercialDraft.ai_tone_summary,
        ai_identity_mode: commercialDraft.ai_speaks_as,
        human_help_general_summary: commercialDraft.human_help_summary,
        accepted_payment_methods_summary: derivedPaymentSummary,

        negotiation_rules_summary: commercialDraft.negotiation_rules_summary,
        final_activation_notes: commercialDraft.promise_limits_summary,
        sales_flow_notes: commercialDraft.post_sale_summary,
        after_hours_behavior: commercialDraft.after_hours_summary,
        commercial_ai_summary: commercialDraft.commercial_ai_summary,
      },
      "Alterações de Comercial e IA salvas com sucesso."
    );

    if (!saved) return;

    setSavedCommercialExperience(commercialExperienceDraft);
    setIsCommercialEditing(false);
    setCommercialEditTarget(null);
  }, [
    activeStoreId,
    commercialDraft,
    commercialEditTarget,
    commercialExperienceDraft,
    organizationId,
    upsertConfigAnswers,
  ]);

  const handleMonthlySalesGoalSave = useCallback(async () => {
    try {
      const normalized = normalizeMonthlySalesGoalInput(monthlySalesGoalDraft);
      const response = await fetch("/api/store/monthly-sales-goal", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: normalized.enabled,
          amountCents: normalized.amountCents,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; goal: StoreMonthlySalesGoalInput | StoreMonthlySalesGoalRow | null }
        | { ok: false; message?: string | null }
        | null;

      if (!response.ok || !body?.ok) {
        const failure = body as { message?: string | null } | null;
        throw new Error(failure?.message || "Nao foi possivel salvar a meta mensal.");
      }

      const nextGoal = normalizeMonthlySalesGoalApiValue(body.goal);
      setMonthlySalesGoal(nextGoal);
      setMonthlySalesGoalDraft(nextGoal);
      setIsMonthlySalesGoalEditing(false);
      setErrorText(null);
      setSuccessText("Meta mensal salva com sucesso.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar a meta mensal.");
      setSuccessText(null);
    }
  }, [monthlySalesGoalDraft]);



  useEffect(() => {
    setDiscountDraft(
      createDiscountDraftFromAnswers(
        answers,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
  }, [answers, discountSettings, highValueDiscountSettings]);

  const handleDiscountDraftChange = useCallback((
    key: keyof DiscountDraftState,
    value: string | boolean,
  ) => {
    setDiscountDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);
  const handleDiscountNegotiationEnabledChange = useCallback((value: string) => {
    if (value === "Não") {
      setDiscountDraft((current) => ({
        ...current,
        default_discount_percent: "0",
        max_discount_percent: "0",
        allow_ask_above_max_discount: false,
        discount_autonomy_mode: "approval_required",
        high_value_enabled: false,
      }));
      setCommercialExperienceDraft((current) => ({
        ...current,
        high_value_requires_human: "Não definido",
      }));
      return;
    }

    setDiscountDraft((current) => ({
      ...current,
      default_discount_percent: cleanText(current.default_discount_percent) && current.default_discount_percent !== "0" ? current.default_discount_percent : "5",
      max_discount_percent: cleanText(current.max_discount_percent) && current.max_discount_percent !== "0" ? current.max_discount_percent : "10",
      discount_autonomy_mode:
        current.discount_autonomy_mode && current.discount_autonomy_mode !== "approval_required"
          ? current.discount_autonomy_mode
          : "within_limit",
    }));
  }, []);

  const handleDiscountEditCancel = useCallback(() => {
    setDiscountDraft(
      createDiscountDraftFromAnswers(
        answers,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
    setIsDiscountEditing(false);
  }, [answers, discountSettings, highValueDiscountSettings]);

  const handleDiscountEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) return;

    if (discountDraft.high_value_enabled && !cleanText(commercialExperienceDraft.high_value_requires_human)) {
      setErrorText("Informe se vendas de valor alto precisam de aprovação humana.");
      setSuccessText(null);
      return;
    }

    const normalizedDiscountSettings = normalizeStoreDiscountSettingsInput({
      defaultDiscountPercent: discountDraft.default_discount_percent,
      maxDiscountPercent: discountDraft.max_discount_percent,
      allowAskAboveMaxDiscount: discountDraft.allow_ask_above_max_discount,
      discountAutonomyMode: discountDraft.discount_autonomy_mode,
      discountSpecialRules: discountDraft.special_discount_rules,
      highValueEnabled: discountDraft.high_value_enabled,
      highValueThresholdAmount: discountDraft.high_value_threshold_amount,
      highValueDiscountPercent: discountDraft.high_value_discount_percent,
    });

    if (!normalizedDiscountSettings.ok) {
      setErrorText(normalizedDiscountSettings.error);
      setSuccessText(null);
      return;
    }

    const { data: savedDiscountSettings, error: discountSettingsError } =
      await supabase.rpc("upsert_store_discount_settings_with_legacy_mirror_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_default_discount_percent:
          normalizedDiscountSettings.value.defaultDiscountPercent,
        p_max_discount_percent: normalizedDiscountSettings.value.maxDiscountPercent,
        p_allow_ask_above_max_discount:
          normalizedDiscountSettings.value.allowAskAboveMaxDiscount,
        p_discount_autonomy_mode:
          normalizedDiscountSettings.value.discountAutonomyMode,
        p_discount_special_rules:
          normalizedDiscountSettings.value.discountSpecialRules,
      });

    if (discountSettingsError) {
      setErrorText("Falha ao sincronizar as configuracoes canonicas de desconto.");
      setSuccessText(null);
      return;
    }

    const { data: savedHighValueDiscountSettings, error: highValueDiscountSettingsError } =
      await supabase.rpc("upsert_store_high_value_discount_settings_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_enabled: normalizedDiscountSettings.value.highValueEnabled,
        p_threshold_amount_cents:
          normalizedDiscountSettings.value.highValueThresholdAmountCents,
        p_discount_percent:
          normalizedDiscountSettings.value.highValueDiscountPercent,
      });

    if (highValueDiscountSettingsError) {
      setErrorText("Falha ao sincronizar a politica canonica de alto valor.");
      setSuccessText(null);
      return;
    }

    setDiscountSettings(
      (savedDiscountSettings ?? null) as StoreDiscountSettingsRow | null,
    );
    setHighValueDiscountSettings(
      (savedHighValueDiscountSettings ?? null) as StoreHighValueDiscountSettingsRow | null,
    );

    const saved = await upsertConfigAnswers(
      {
        discount_explanation: discountDraft.discount_explanation,
      },
      "Alterações de descontos salvas com sucesso."
    );

    if (!saved) return;

    setSavedCommercialExperience(commercialExperienceDraft);
    setIsDiscountEditing(false);
  }, [
    activeStoreId,
    commercialExperienceDraft,
    discountDraft,
    organizationId,
    upsertConfigAnswers,
  ]);

  useEffect(() => {
    setChannelDraft(createChannelDraftFromSources(answers, channelSettings, loadedCanonicalPrimaryResponsible));
  }, [answers, channelSettings, loadedCanonicalPrimaryResponsible]);

  const handleChannelDraftChange = useCallback((key: keyof ChannelDraftState, value: string) => {
    setChannelDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleChannelsEditCancel = useCallback(() => {
    setChannelDraft(createChannelDraftFromSources(answers, channelSettings, loadedCanonicalPrimaryResponsible));
    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [answers, channelSettings, loadedCanonicalPrimaryResponsible]);

  const handleChannelsEditSave = useCallback(async () => {
    const normalizedChannelSettings = normalizeStoreChannelSettingsInput({
      commercialChannelName: channelDraft.commercial_channel_name,
      commercialReceivesRealClients:
        channelDraft.commercial_receives_real_clients,
      commercialIsOfficialSalesChannel:
        channelDraft.commercial_is_official_sales_channel,
      commercialChannelType: channelDraft.commercial_channel_type,
      commercialEntryPriority: channelDraft.commercial_entry_priority,
      commercialHumanHandoffEnabled:
        channelDraft.commercial_human_handoff_enabled,
      commercialChannelNotes: channelDraft.commercial_channel_notes,
      integrationProviderName: channelDraft.integration_provider_name,
      integrationConnectionMode: channelDraft.integration_connection_mode,
      integrationsNotes: channelDraft.integrations_notes,
    });

    if (!normalizedChannelSettings.ok) {
      setErrorText(normalizedChannelSettings.error);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alteraÃ§Ãµes.");
      setSuccessText(null);
      return;
    }

    const { data: savedChannelSettings, error: channelSettingsError } =
      await supabase.rpc(
        "upsert_store_channel_settings_with_legacy_mirror_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_commercial_channel_name:
            normalizedChannelSettings.value.commercialChannelName,
          p_commercial_receives_real_clients:
            normalizedChannelSettings.value.commercialReceivesRealClients,
          p_commercial_is_official_sales_channel:
            normalizedChannelSettings.value
              .commercialIsOfficialSalesChannel,
          p_commercial_channel_type:
            normalizedChannelSettings.value.commercialChannelType,
          p_commercial_entry_priority:
            normalizedChannelSettings.value.commercialEntryPriority,
          p_commercial_human_handoff_enabled:
            normalizedChannelSettings.value.commercialHumanHandoffEnabled,
          p_commercial_channel_notes:
            normalizedChannelSettings.value.commercialChannelNotes,
          p_integration_provider_name:
            normalizedChannelSettings.value.integrationProviderName,
          p_integration_connection_mode:
            normalizedChannelSettings.value.integrationConnectionMode,
          p_integrations_notes:
            normalizedChannelSettings.value.integrationsNotes,
        }
      );

    if (channelSettingsError) {
      setErrorText(
        channelSettingsError.message ||
          "Erro ao salvar a configuraÃ§Ã£o canÃ´nica de canais."
      );
      setSuccessText(null);
      return;
    }

    setChannelSettings(
      (savedChannelSettings ?? null) as StoreChannelSettingsRow | null
    );
    setErrorText(null);
    setSuccessText("Alterações de canais e integrações salvas com sucesso.");

    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [activeStoreId, channelDraft, organizationId]);

  const storeWhatsappStatusMetrics = useMemo(
    () => [
      {
        label: "Status",
        value: storeWhatsappVisualStatus.label,
        tone: storeWhatsappVisualStatus.tone,
        hint:
          cleanText(storeWhatsappStatus?.status) ||
          (storeWhatsappStatus?.connected ? "Integracao operacional ativa." : "Integracao ainda nao conectada."),
      },
      {
        label: "Numero conectado",
        value: connectedCommercialWhatsapp || "Nao informado",
        tone: connectedCommercialWhatsapp ? "green" as const : "gray" as const,
        hint:
          cleanText(storeWhatsappStatus?.phoneNumberId)
            ? `Phone Number ID: ${cleanText(storeWhatsappStatus?.phoneNumberId)}`
            : "O numero tecnico ainda nao foi vinculado nesta loja.",
      },
      {
        label: "Ultima mensagem recebida",
        value: formatImportDate(storeWhatsappStatus?.lastInboundAt),
        tone: cleanText(storeWhatsappStatus?.lastInboundAt) ? "green" as const : "gray" as const,
        hint: "Ultimo evento recebido pela inbox do WhatsApp.",
      },
      {
        label: "Ultima mensagem enviada",
        value: formatImportDate(storeWhatsappStatus?.lastOutboundAt),
        tone: cleanText(storeWhatsappStatus?.lastOutboundAt) ? "green" as const : "gray" as const,
        hint: "Ultimo envio externo registrado para a loja.",
      },
      {
        label: "Pendencias de entrada",
        value: String(storeWhatsappStatus?.pendingInboxCount ?? 0),
        tone:
          Number(storeWhatsappStatus?.pendingInboxCount ?? 0) > 0 ? "amber" as const : "green" as const,
        hint: "Eventos recebidos e ainda nao processados.",
      },
      {
        label: "Pendencias de envio",
        value: String(storeWhatsappStatus?.pendingOutboundCount ?? 0),
        tone:
          Number(storeWhatsappStatus?.pendingOutboundCount ?? 0) > 0 ? "amber" as const : "green" as const,
        hint: "Mensagens prontas para sair no canal real.",
      },
    ],
    [connectedCommercialWhatsapp, storeWhatsappStatus, storeWhatsappVisualStatus]
  );

  const handlePrimaryResponsibleChange = useCallback(
    (key: keyof ResponsiblePersonDraft, value: string | boolean) => {
      setPrimaryResponsibleDraft((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const handleAdditionalResponsibleChange = useCallback(
    (id: string, key: keyof ResponsiblePersonDraft, value: string | boolean) => {
      setAdditionalResponsiblesDraft((current) =>
        current.map((item) => (item.id === id ? { ...item, [key]: value } : item))
      );
    },
    []
  );

  const handleAddResponsible = useCallback(() => {
    setAdditionalResponsiblesDraft((current) => [...current, createEmptyResponsibleDraft(false)]);
    setIsActivationEditing(true);
  }, []);

  const handleRemoveResponsible = useCallback((id: string) => {
    setAdditionalResponsiblesDraft((current) => current.filter((item) => item.id !== id));
  }, []);

  const handleActivationEditCancel = useCallback(() => {
    setPrimaryResponsibleDraft(canonicalPrimaryResponsibleDraft);
    setAdditionalResponsiblesDraft(parseResponsiblePeopleFromAnswers(answers));
    setActivationConfirmInformationDraft(Boolean(answers.confirm_information_is_correct));
    setActivationNotificationCasesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.responsible_notification_cases),
        RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
        cleanText(answers.responsible_notification_cases_other)
      )
    );
    setActivationPreferencesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
        cleanText(answers.activation_preferences_other)
      )
    );
    setIsActivationEditing(false);
  }, [answers, canonicalPrimaryResponsibleDraft]);

  const handleActivationEditSave = useCallback(async () => {
    const cleanAdditional = additionalResponsiblesDraft.filter(
      (item) => cleanText(item.name) || cleanText(item.whatsapp)
    );

    const saved = await upsertConfigAnswers(
      {
        responsible_name: cleanText(primaryResponsibleDraft.name),
        responsible_whatsapp: cleanText(primaryResponsibleDraft.whatsapp),
        responsible_role: cleanText(primaryResponsibleDraft.role),
        responsible_notes: cleanText(primaryResponsibleDraft.notes),
        confirm_information_is_correct: activationConfirmInformationDraft,
        responsible_notification_cases_other: cleanText(activationNotificationCasesDraft),
        activation_preferences_other: cleanText(activationPreferencesDraft),
        final_activation_notes: cleanText(activationPreferencesDraft),
        additional_responsibles: serializeResponsiblePeople(cleanAdditional),
      },
      "Alterações de responsável e ativação salvas com sucesso."
    );

    if (!saved) return false;

    setIsActivationEditing(false);
    return true;
  }, [
    primaryResponsibleDraft,
    additionalResponsiblesDraft,
    activationConfirmInformationDraft,
    activationNotificationCasesDraft,
    activationPreferencesDraft,
    upsertConfigAnswers,
  ]);

  const handlePoolFormChange = useCallback(
    (key: keyof PoolFormState, value: string | boolean) => {
      setPoolForm((current) => ({
        ...current,
        [key]: formatManualPoolFieldValue(key, value),
      } as PoolFormState));
    },
    []
  );

  const handlePoolPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);

    if (validationError) {
      setErrorText(validationError);
      return;
    }

    setPoolPhotos(selectedFiles);
    setErrorText(null);
  }, []);

  const handleSaveManualPool = useCallback(async () => {
    const poolName = cleanText(poolForm.name);
    const material = cleanText(poolForm.material);
    const shape = cleanText(poolForm.shape);
    const widthM = parseNumberInput(poolForm.width_m);
    const lengthM = parseNumberInput(poolForm.length_m);
    const depthM = parseNumberInput(poolForm.depth_m);
    const price = parseNumberInput(poolForm.price);

    if (!poolName) {
      setErrorText("Preencha pelo menos o nome da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (widthM === null || lengthM === null || depthM === null) {
      setErrorText("Preencha largura, comprimento e profundidade da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (!shape) {
      setErrorText("Preencha o formato da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (!material) {
      setErrorText("Preencha o material da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    const poolPhotosError = validateSelectedPhotos(poolPhotos);
    if (poolPhotosError) {
      setErrorText(poolPhotosError);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a piscina.");
      setSuccessText(null);
      return;
    }

    setSavingPool(true);
    setErrorText(null);
    setSuccessText(null);

    let createdPoolId = "";
    const uploadedStoragePaths: string[] = [];

    try {
      const composedPoolDescription = buildPoolManualDescription(poolForm);
      const maxCapacityL = Math.max(1, Math.round(widthM * lengthM * depthM * 1000));
      const stockState = resolveManualStockState({
        rawQuantity: poolForm.stock_quantity,
        trackStock: poolForm.track_stock,
      });

      const insertPayload = {
        organization_id: organizationId,
        store_id: activeStoreId,
        name: poolName,
        width_m: widthM,
        length_m: lengthM,
        depth_m: depthM,
        shape,
        material,
        max_capacity_l: maxCapacityL,
        price,
        price_status: resolveManualPriceStatus(price),
        description: composedPoolDescription || null,
        stock_quantity: stockState.stockQuantity,
        stock_status: stockState.stockStatus,
        is_active: poolForm.is_active,
        track_stock: poolForm.track_stock,
      };

      const { data: createdPool, error: insertError } = await supabase
        .from("pools")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      createdPoolId = String(createdPool?.id || "").trim();
      if (!createdPoolId) {
        throw new Error("Não foi possível obter o ID da piscina criada.");
      }

      if (poolPhotos.length > 0) {
        const photoRows: Array<{
          pool_id: string;
          organization_id: string;
          store_id: string;
          storage_path: string;
          file_name: string;
          file_size_bytes: number;
          sort_order: number;
        }> = [];

        for (const [index, file] of poolPhotos.entries()) {
          const safeFileName = `${Date.now()}-${index}-${file.name.replace(/\s+/g, "-")}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdPoolId}/${safeFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("pool-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          uploadedStoragePaths.push(storagePath);
          photoRows.push({
            pool_id: createdPoolId,
            organization_id: organizationId,
            store_id: activeStoreId,
            storage_path: storagePath,
            file_name: file.name,
            file_size_bytes: file.size,
            sort_order: index,
          });
        }

        const { error: poolPhotosInsertError } = await supabase
          .from("pool_photos")
          .insert(photoRows);

        if (poolPhotosInsertError) throw poolPhotosInsertError;
      }

      setPoolForm(createEmptyPoolForm());
      setPoolPhotos([]);
      setCounts((current) => ({
        ...current,
        pools: current.pools + 1,
      }));
      setSuccessText(
        poolPhotos.length > 0
          ? "Piscina e fotos salvas com sucesso."
          : "Piscina salva com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      if (uploadedStoragePaths.length > 0) {
        await supabase.storage.from("pool-photos").remove(uploadedStoragePaths);
      }

      if (createdPoolId) {
        await supabase.from("pool_photos").delete().eq("pool_id", createdPoolId);
        await supabase.from("pools").delete().eq("id", createdPoolId);
      }

      setErrorText(error?.message ?? "Erro ao salvar a piscina manualmente.");
      setSuccessText(null);
    } finally {
      setSavingPool(false);
    }
  }, [organizationId, activeStoreId, poolForm, poolPhotos, fetchPageData]);

  const handleCatalogFormChange = useCallback(
    (key: keyof CatalogFormState, value: string | boolean) => {
      setCatalogForm((current) => ({
        ...current,
        [key]: formatManualCatalogFieldValue(key, value),
      } as CatalogFormState));
    },
    []
  );

  const handleCatalogPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);

    if (validationError) {
      setErrorText(validationError);
      return;
    }

    setCatalogPhotos(selectedFiles);
    setErrorText(null);
  }, []);

  const handleSaveManualCatalogItem = useCallback(async () => {
    const itemName = cleanText(catalogForm.name);
    if (!itemName) {
      setErrorText("Preencha pelo menos o nome do item antes de salvar.");
      setSuccessText(null);
      return;
    }

    const catalogPhotosError = validateSelectedPhotos(catalogPhotos);
    if (catalogPhotosError) {
      setErrorText(catalogPhotosError);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar o item do catálogo.");
      setSuccessText(null);
      return;
    }

    setSavingCatalogItem(true);
    setErrorText(null);
    setSuccessText(null);

    let createdCatalogItemId = "";
    const uploadedStoragePaths: string[] = [];

    try {
      const parsedPrice = parseNumberInput(catalogForm.price);
      const stockState = resolveManualStockState({
        rawQuantity: catalogForm.stock_quantity,
        trackStock: catalogForm.track_stock,
      });
      const metadataPayload = {
        categoria: catalogForm.category,
        brand: cleanText(catalogForm.brand) || null,
        line: cleanText(catalogForm.line) || null,
        unit_label: cleanText(catalogForm.unit_label) || null,
        size_details: cleanText(catalogForm.size_details) || null,
        width_cm: parseNumberInput(catalogForm.width_cm),
        height_cm: parseNumberInput(catalogForm.height_cm),
        length_cm: parseNumberInput(catalogForm.length_cm),
        weight_kg: parseNumberInput(catalogForm.weight_kg),
        application: cleanText(catalogForm.application) || null,
        technical_notes: cleanText(catalogForm.technical_notes) || null,
        manual_created_in_configuracoes: true,
        pending_photo_upload_count: 0,
      };

      const insertPayload = {
        organization_id: organizationId,
        store_id: activeStoreId,
        sku: cleanText(catalogForm.sku) || null,
        name: itemName,
        description: cleanText(catalogForm.description) || null,
        price_cents: parsedPrice === null ? null : Math.round(parsedPrice * 100),
        price_status: resolveManualPriceStatusFromCents(
          parsedPrice === null ? null : Math.round(parsedPrice * 100)
        ),
        currency: "BRL",
        is_active: catalogForm.is_active,
        track_stock: catalogForm.track_stock,
        stock_quantity: stockState.stockQuantity,
        stock_status: stockState.stockStatus,
        metadata: metadataPayload,
      };

      const { data: createdItem, error: insertError } = await supabase
        .from("store_catalog_items")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      createdCatalogItemId = String(createdItem?.id || "").trim();
      if (!createdCatalogItemId) {
        throw new Error("Não foi possível obter o ID do item criado.");
      }

      if (catalogPhotos.length > 0) {
        const photoRows: Array<{
          catalog_item_id: string;
          storage_path: string;
          file_name: string;
          file_size_bytes: number;
          sort_order: number;
        }> = [];

        for (const [index, file] of catalogPhotos.entries()) {
          const extension = file.name.split(".").pop() || "jpg";
          const safeFileName = `${Date.now()}-${index}-${crypto.randomUUID()}.${extension}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdCatalogItemId}/${safeFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("store-catalog-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          uploadedStoragePaths.push(storagePath);
          photoRows.push({
            catalog_item_id: createdCatalogItemId,
            storage_path: storagePath,
            file_name: file.name,
            file_size_bytes: file.size,
            sort_order: index,
          });
        }

        const { error: insertPhotosError } = await supabase
          .from("store_catalog_item_photos")
          .insert(photoRows);

        if (insertPhotosError) throw insertPhotosError;
      }

      setCatalogForm(createEmptyCatalogForm());
      setCatalogPhotos([]);
      setCounts((current) => ({
        ...current,
        [catalogForm.category]: current[catalogForm.category] + 1,
      }));
      setSuccessText(
        catalogPhotos.length > 0
          ? "Item e fotos salvos com sucesso."
          : "Item salvo com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      if (uploadedStoragePaths.length > 0) {
        await supabase.storage.from("store-catalog-photos").remove(uploadedStoragePaths);
      }

      if (createdCatalogItemId) {
        await supabase
          .from("store_catalog_item_photos")
          .delete()
          .eq("catalog_item_id", createdCatalogItemId);
        await supabase
          .from("store_catalog_items")
          .delete()
          .eq("id", createdCatalogItemId)
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId);
      }

      setErrorText(error?.message ?? "Erro ao salvar o item manualmente.");
      setSuccessText(null);
    } finally {
      setSavingCatalogItem(false);
    }
  }, [organizationId, activeStoreId, catalogForm, catalogPhotos, fetchPageData]);

  const handleDownloadImportFile = useCallback(
    async (file: StoreImportFileRow) => {
      const bucket = cleanText(file.storage_bucket);
      const path = cleanText(file.storage_path);

      if (!bucket || !path) {
        setErrorText("Este arquivo bruto não possui bucket ou caminho válido para download.");
        setSuccessText(null);
        return;
      }

      setDownloadingImportFileId(file.id);
      setErrorText(null);

      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error("Não foi possível gerar o link temporário deste arquivo.");
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao gerar o download do arquivo bruto.");
        setSuccessText(null);
      } finally {
        setDownloadingImportFileId(null);
      }
    },
    []
  );

  const handleCustomerCatalogEditStart = useCallback(() => {
    const savedFileIds = Array.isArray(
      storeCatalogSettings?.customer_catalog_import_file_ids,
    )
      ? storeCatalogSettings.customer_catalog_import_file_ids
          .map((value) => cleanText(value))
          .filter(Boolean)
      : [];
    const allowFullCatalogSend = storeCatalogSettings?.allow_full_catalog_send === true;

    setCustomerCatalogAllowDraft(allowFullCatalogSend ? "Sim" : "Não");
    setCustomerCatalogFileIdsDraft(
      allowFullCatalogSend ? (savedFileIds.length > 0 ? savedFileIds : [""]) : [],
    );
    setErrorText(null);
    setSuccessText(null);
    setIsCustomerCatalogEditing(true);
  }, [storeCatalogSettings]);

  const handleCustomerCatalogEditCancel = useCallback(() => {
    const savedFileIds = Array.isArray(
      storeCatalogSettings?.customer_catalog_import_file_ids,
    )
      ? storeCatalogSettings.customer_catalog_import_file_ids
          .map((value) => cleanText(value))
          .filter(Boolean)
      : [];
    const allowFullCatalogSend = storeCatalogSettings?.allow_full_catalog_send === true;

    setCustomerCatalogAllowDraft(allowFullCatalogSend ? "Sim" : "Não");
    setCustomerCatalogFileIdsDraft(
      allowFullCatalogSend ? (savedFileIds.length > 0 ? savedFileIds : [""]) : [],
    );
    setIsCustomerCatalogEditing(false);
    setErrorText(null);
  }, [storeCatalogSettings]);

  const handleCustomerCatalogSettingsSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar esta configuração.");
      setSuccessText(null);
      return;
    }

    const allowFullCatalogSend = customerCatalogAllowDraft === "Sim";
    const selectedFileIds = allowFullCatalogSend
      ? customerCatalogFileIdsDraft.map((value) => cleanText(value)).filter(Boolean)
      : [];

    if (allowFullCatalogSend && selectedFileIds.length === 0) {
      setErrorText("Selecione pelo menos um catálogo que a IA pode enviar aos clientes.");
      setSuccessText(null);
      return;
    }

    if (new Set(selectedFileIds).size !== selectedFileIds.length) {
      setErrorText("O mesmo arquivo não pode ser autorizado mais de uma vez.");
      setSuccessText(null);
      return;
    }

    if (allowFullCatalogSend) {
      const allImportFiles = [...poolImportFiles, ...catalogImportFiles];
      const invalidSelectedFileId = selectedFileIds.find((selectedFileId) => {
        const selectedFile = allImportFiles.find((file) => file.id === selectedFileId);
        return !(
          selectedFile &&
          normalizeLoose(selectedFile.status) === "active" &&
          Boolean(cleanText(selectedFile.storage_bucket)) &&
          Boolean(cleanText(selectedFile.storage_path))
        );
      });

      if (invalidSelectedFileId) {
        setErrorText(
          "Um dos catálogos selecionados não está mais disponível como uma importação ativa desta loja. Revise a lista e tente novamente.",
        );
        setSuccessText(null);
        return;
      }
    }

    setSavingCustomerCatalogSettings(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data, error } = await supabase
        .rpc("upsert_store_catalog_settings_multi_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_allow_full_catalog_send: allowFullCatalogSend,
          p_customer_catalog_import_file_ids: selectedFileIds,
        })
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error(
          "A configuração foi enviada, mas não foi possível confirmar o estado salvo.",
        );
      }

      const savedSettings = data as StoreCatalogSettingsRow;
      const savedFileIds = Array.isArray(savedSettings.customer_catalog_import_file_ids)
        ? savedSettings.customer_catalog_import_file_ids
            .map((value) => cleanText(value))
            .filter(Boolean)
        : [];
      const normalizedSavedSettings: StoreCatalogSettingsRow = {
        ...savedSettings,
        customer_catalog_import_file_ids: savedFileIds,
      };

      setStoreCatalogSettings(normalizedSavedSettings);
      setCustomerCatalogAllowDraft(
        normalizedSavedSettings.allow_full_catalog_send ? "Sim" : "Não",
      );
      setCustomerCatalogFileIdsDraft(savedFileIds);
      setIsCustomerCatalogEditing(false);
      setSuccessText(
        normalizedSavedSettings.allow_full_catalog_send
          ? `${savedFileIds.length} catálogo(s) autorizado(s) para clientes com sucesso.`
          : "Envio de catálogos completos aos clientes desativado com sucesso.",
      );
    } catch (error: any) {
      setErrorText(
        error?.message ??
          "Não foi possível salvar a configuração dos catálogos para clientes.",
      );
      setSuccessText(null);
    } finally {
      setSavingCustomerCatalogSettings(false);
    }
  }, [
    organizationId,
    activeStoreId,
    customerCatalogAllowDraft,
    customerCatalogFileIdsDraft,
    poolImportFiles,
    catalogImportFiles,
  ]);

  const handleDeleteImportFile = useCallback(
    async (file: StoreImportFileRow) => {
      if (!organizationId || !activeStoreId) {
        setErrorText("Nenhuma loja ativa foi encontrada para excluir o arquivo bruto.");
        setSuccessText(null);
        return;
      }

      if (deletingImportFileId) return;

      if (
        storeCatalogSettings?.allow_full_catalog_send &&
        storeCatalogSettings.customer_catalog_import_file_ids.includes(file.id)
      ) {
        setErrorText(
          "Este arquivo está autorizado como catálogo para clientes. Primeiro edite “Catálogos para clientes” e remova este arquivo da lista autorizada.",
        );
        setSuccessText(null);
        return;
      }

      const fileName = cleanText(file.original_file_name) || "arquivo bruto";
      const confirmed = window.confirm(
        `Excluir o arquivo bruto "${fileName}"?\n\nIsso remove apenas o arquivo original importado e o vínculo dele com a importação. Nenhum item do catálogo será excluído.`
      );

      if (!confirmed) return;

      const bucket = cleanText(file.storage_bucket);
      const path = cleanText(file.storage_path);

      setDeletingImportFileId(file.id);
      setErrorText(null);
      setSuccessText(null);

      try {
        const { error: deleteLinksError } = await supabase
          .from("store_import_file_items")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .eq("import_file_id", file.id);

        if (deleteLinksError) throw deleteLinksError;

        const { error: deleteFileRowError } = await supabase
          .from("store_import_files")
          .delete()
          .eq("id", file.id)
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId);

        if (deleteFileRowError) throw deleteFileRowError;

        if (bucket && path) {
          const { error: storageError } = await supabase.storage.from(bucket).remove([path]);
          if (storageError) throw storageError;
        }

        setPoolImportFiles((prev) => prev.filter((item) => item.id !== file.id));
        setCatalogImportFiles((prev) => prev.filter((item) => item.id !== file.id));
        setSuccessText("Arquivo bruto excluído com sucesso. Os itens do catálogo foram preservados.");
        await fetchPageData();
      } catch (error: any) {
        if (cleanText(error?.code) === "23503") {
          setErrorText(
            "Este arquivo está protegido por uma configuração ativa. Remova primeiro a autorização em “Catálogo para clientes” e tente novamente.",
          );
        } else {
          setErrorText(error?.message ?? "Erro ao excluir o arquivo bruto.");
        }
        setSuccessText(null);
      } finally {
        setDeletingImportFileId(null);
      }
    },
    [
      organizationId,
      activeStoreId,
      deletingImportFileId,
      fetchPageData,
      storeCatalogSettings,
    ]
  );

  const handleStoreLogoFileChange = useCallback((files: FileList | null) => {
    const file = files?.[0] ?? null;

    if (!file) {
      return;
    }

    const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedMimeTypes.has(file.type)) {
      setSelectedStoreLogoFile(null);
      setErrorText("Envie uma imagem PNG, JPEG ou WebP para a logo da loja.");
      setSuccessText(null);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setSelectedStoreLogoFile(null);
      setErrorText("A logo deve ter no maximo 2 MB.");
      setSuccessText(null);
      return;
    }

    setSelectedStoreLogoFile(file);
    setErrorText(null);
    setSuccessText(null);
  }, []);

  const handleSaveStoreLogo = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para enviar a logo.");
      setSuccessText(null);
      return false;
    }

    if (!selectedStoreLogoFile) {
      setErrorText("Selecione uma imagem antes de enviar a logo.");
      setSuccessText(null);
      return false;
    }

    if (savingStoreLogo) {
      return false;
    }

    setSavingStoreLogo(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const formData = new FormData();
      formData.set("storeId", activeStoreId);
      formData.set("file", selectedStoreLogoFile);

      const response = await fetch("/api/store-branding/logo", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as StoreBrandingApiResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel salvar a logo.");
      }

      setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
      setStoreLogoPreviewUrl(result.signedUrl || null);
      setSelectedStoreLogoFile(null);
      setSuccessText(result.warning ? `Logo salva com sucesso. ${result.warning}` : "Logo salva com sucesso.");
      return true;
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar a logo.");
      setSuccessText(null);
      return false;
    } finally {
      setSavingStoreLogo(false);
    }
  }, [
    organizationId,
    activeStoreId,
    selectedStoreLogoFile,
    savingStoreLogo,
  ]);

  const handleRemoveStoreLogo = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para remover a logo.");
      setSuccessText(null);
      return;
    }

    if (removingStoreLogo) {
      return;
    }

    if (!storeBranding?.id && !cleanText(storeBranding?.logo_storage_path)) {
      setSuccessText("Nenhuma logo enviada ainda.");
      setErrorText(null);
      return;
    }

    const confirmed = window.confirm("Remover a logo atual da loja?");
    if (!confirmed) return;

    setRemovingStoreLogo(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const response = await fetch("/api/store-branding/logo", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });
      const result = (await response.json()) as StoreBrandingApiResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel remover a logo.");
      }

      setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
      setStoreLogoPreviewUrl(result.signedUrl || null);
      setSelectedStoreLogoFile(null);
      setSuccessText(result.warning ? `Logo removida. ${result.warning}` : "Logo removida.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel remover a logo.");
      setSuccessText(null);
    } finally {
      setRemovingStoreLogo(false);
    }
  }, [
    organizationId,
    activeStoreId,
    removingStoreLogo,
    storeBranding?.id,
    storeBranding?.logo_storage_path,
  ]);

  const updateBrandExperienceDraft = useCallback(<K extends keyof BrandExperienceDraftState>(
    key: K,
    value: BrandExperienceDraftState[K],
  ) => {
    setBrandExperienceDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const handleBrandSettingsCancel = useCallback(() => {
    setSelectedStoreLogoFile(null);
    setBrandExperienceDraft(savedBrandExperience);
    setIsBrandEditing(false);
    setErrorText(null);
  }, [savedBrandExperience]);

  const handleBrandSettingsSave = useCallback(async () => {
    const colorPattern = /^#[0-9A-Fa-f]{6}$/;
    if (!colorPattern.test(cleanText(brandExperienceDraft.primary_color))) {
      setErrorText("Informe uma cor principal válida no formato #RRGGBB.");
      setSuccessText(null);
      return;
    }
    if (cleanText(brandExperienceDraft.secondary_color) && !colorPattern.test(cleanText(brandExperienceDraft.secondary_color))) {
      setErrorText("Informe uma cor secundária válida no formato #RRGGBB.");
      setSuccessText(null);
      return;
    }
    if (!["Sim", "Não"].includes(brandExperienceDraft.use_logo_on_quotes)) {
      setErrorText("Informe se a logo deve aparecer nos orçamentos.");
      setSuccessText(null);
      return;
    }
    if (!["Sim", "Não"].includes(brandExperienceDraft.use_logo_on_contracts)) {
      setErrorText("Informe se a logo deve aparecer nos contratos.");
      setSuccessText(null);
      return;
    }

    if (selectedStoreLogoFile) {
      const logoSaved = await handleSaveStoreLogo();
      if (!logoSaved) return;
    }

    setSavedBrandExperience(brandExperienceDraft);
    setErrorText(null);
    setSuccessText("Configurações de marca atualizadas.");
    setIsBrandEditing(false);
  }, [brandExperienceDraft, handleSaveStoreLogo, selectedStoreLogoFile]);

  const updateContractExperienceDraft = useCallback(<K extends keyof ContractExperienceDraftState>(
    key: K,
    value: ContractExperienceDraftState[K],
  ) => {
    setContractExperienceDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const toggleContractExperienceArrayValue = useCallback((
    key: "applicability_cases" | "formats" | "signed_before",
    value: string,
  ) => {
    setContractExperienceDraft((current) => {
      const currentValues = current[key];
      return {
        ...current,
        [key]: currentValues.includes(value)
          ? currentValues.filter((item) => item !== value)
          : [...currentValues, value],
      };
    });
  }, []);

  const handleContractPolicyCancel = useCallback(() => {
    setContractExperienceDraft(savedContractExperience);
    setIsContractPolicyEditing(false);
    setErrorText(null);
  }, [savedContractExperience]);

  const handleContractPolicySave = useCallback(() => {
    const draft = contractExperienceDraft;
    if (!["Sim", "Não"].includes(draft.enabled)) {
      setErrorText("Informe se a loja utiliza contrato nas vendas.");
      setSuccessText(null);
      return;
    }

    if (draft.enabled === "Sim") {
      if (!cleanText(draft.applicability_mode)) {
        setErrorText("Defina quando o contrato é usado pela loja.");
        setSuccessText(null);
        return;
      }
      if (draft.applicability_mode === "depende" && draft.applicability_cases.length === 0) {
        setErrorText("Selecione em quais situações o contrato é exigido.");
        setSuccessText(null);
        return;
      }
      if (draft.applicability_cases.includes("outro") && !cleanText(draft.applicability_other)) {
        setErrorText("Explique a outra situação em que o contrato é usado.");
        setSuccessText(null);
        return;
      }
      if (draft.applicability_cases.includes("alto_valor") && !cleanText(draft.high_value_amount)) {
        setErrorText("Informe a partir de qual valor a regra de contrato de alto valor se aplica.");
        setSuccessText(null);
        return;
      }
      if (draft.formats.length === 0) {
        setErrorText("Selecione se a loja trabalha com contrato digital, físico ou ambos.");
        setSuccessText(null);
        return;
      }
      if (draft.signed_before.length === 0) {
        setErrorText("Defina antes de qual etapa o contrato precisa estar assinado.");
        setSuccessText(null);
        return;
      }
      if (draft.signed_before.includes("outro") && !cleanText(draft.signed_before_other)) {
        setErrorText("Explique o outro momento em que o contrato precisa estar assinado.");
        setSuccessText(null);
        return;
      }
    }

    setSavedContractExperience(draft);
    setErrorText(null);
    setSuccessText("Regras de uso do contrato atualizadas.");
    setIsContractPolicyEditing(false);
  }, [contractExperienceDraft]);

  useEffect(() => {
    setCommercialWhatsappDraft(cleanText(answers.commercial_whatsapp));
  }, [answers.commercial_whatsapp, activeStoreId]);

  const handleCommercialWhatsappSave = useCallback(async () => {
    const phone = cleanText(commercialWhatsappDraft);
    if (!phone) {
      setErrorText("Informe o número comercial que a loja pretende conectar ao WhatsApp.");
      setSuccessText(null);
      return;
    }
    const saved = await upsertConfigAnswers(
      { commercial_whatsapp: phone },
      "Número comercial da loja salvo com sucesso.",
    );
    if (!saved) return;
    setIsCommercialWhatsappEditing(false);
  }, [commercialWhatsappDraft, upsertConfigAnswers]);

  const handleCommercialWhatsappCancel = useCallback(() => {
    setCommercialWhatsappDraft(cleanText(answers.commercial_whatsapp));
    setIsCommercialWhatsappEditing(false);
    setErrorText(null);
  }, [answers.commercial_whatsapp]);

  const handleDeleteAllCatalog = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para apagar o catálogo.");
      return;
    }

    if (deletingCatalog) return;

    if (totalCatalogo === 0) {
      setSuccessText("O catálogo geral já está vazio.");
      setErrorText(null);
      return;
    }

    const firstConfirm = window.confirm(
      "Tem certeza que deseja apagar TODO o catálogo geral desta loja? Isso vai remover químicos, acessórios e outros itens cadastrados."
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Confirma mais uma vez: apagar todo o catálogo geral agora? Essa ação não apaga as piscinas."
    );
    if (!secondConfirm) return;

    setDeletingCatalog(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: catalogItems, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (catalogItemsError) throw catalogItemsError;

      const catalogItemIds = ((catalogItems || []) as Array<{ id: string }>).map(
        (item) => item.id
      );

      if (catalogItemIds.length === 0) {
        setSuccessText("O catálogo geral já estava vazio.");
        await fetchPageData();
        return;
      }

      const photoRows: CatalogPhotoRow[] = [];
      const idChunks = chunkArray(catalogItemIds, 200);

      for (const ids of idChunks) {
        const { data: photoChunk, error: photosError } = await supabase
          .from("store_catalog_item_photos")
          .select("id, catalog_item_id, storage_path")
          .in("catalog_item_id", ids);

        if (photosError) throw photosError;
        photoRows.push(...((photoChunk || []) as CatalogPhotoRow[]));
      }

      const storagePaths = photoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      const storagePathChunks = chunkArray(storagePaths, 100);
      for (const paths of storagePathChunks) {
        const { error: storageRemoveError } = await supabase.storage
          .from("store-catalog-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      if (photoRows.length > 0) {
        const photoIdChunks = chunkArray(
          photoRows.map((row) => row.id),
          200
        );

        for (const ids of photoIdChunks) {
          const { error: deletePhotosError } = await supabase
            .from("store_catalog_item_photos")
            .delete()
            .in("id", ids);

          if (deletePhotosError) throw deletePhotosError;
        }
      }

      for (const ids of idChunks) {
        const { error: deleteItemsError } = await supabase
          .from("store_catalog_items")
          .delete()
          .in("id", ids);

        if (deleteItemsError) throw deleteItemsError;
      }

      setSuccessText("Todo o catálogo geral da loja foi apagado com sucesso.");
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao apagar todo o catálogo geral da loja.");
    } finally {
      setDeletingCatalog(false);
    }
  }, [organizationId, activeStoreId, deletingCatalog, totalCatalogo, fetchPageData]);
  void handleDeleteAllCatalog;

  const handleDeleteAllStoreCatalog = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nao foi possivel identificar a organizacao e a loja ativa com seguranca.");
      setSuccessText(null);
      return;
    }

    if (deletingCatalog) return;

    if (totalCatalogo === 0) {
      setSuccessText("O catalogo da loja ja esta vazio.");
      setErrorText(null);
      return;
    }

    const firstConfirm = window.confirm(
      "Tem certeza que deseja apagar TODO o catalogo desta loja? Isso vai remover piscinas, quimicos, acessorios e outros itens cadastrados."
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Confirma mais uma vez: apagar todo o catalogo agora? Essa acao remove definitivamente piscinas e itens gerais da loja atual."
    );
    if (!secondConfirm) return;

    setDeletingCatalog(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: poolsData, error: poolsError } = await supabase
        .from("pools")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (poolsError) throw poolsError;

      const poolIds = ((poolsData || []) as Array<{ id: string }>).map((pool) => pool.id);
      const poolPhotoRows: PoolPhotoRow[] = [];

      for (const ids of chunkArray(poolIds, 200)) {
        if (ids.length === 0) continue;

        const { data: photoChunk, error: poolPhotosError } = await supabase
          .from("pool_photos")
          .select("id, pool_id, storage_path")
          .in("pool_id", ids);

        if (poolPhotosError) throw poolPhotosError;
        poolPhotoRows.push(...((photoChunk || []) as PoolPhotoRow[]));
      }

      const poolStoragePaths = poolPhotoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      for (const paths of chunkArray(poolStoragePaths, 100)) {
        if (paths.length === 0) continue;

        const { error: storageRemoveError } = await supabase.storage
          .from("pool-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      for (const ids of chunkArray(poolPhotoRows.map((row) => row.id), 200)) {
        if (ids.length === 0) continue;

        const { error: deletePoolPhotosError } = await supabase
          .from("pool_photos")
          .delete()
          .in("id", ids);

        if (deletePoolPhotosError) throw deletePoolPhotosError;
      }

      for (const ids of chunkArray(poolIds, 200)) {
        if (ids.length === 0) continue;

        const { error: deletePoolsError } = await supabase
          .from("pools")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", ids);

        if (deletePoolsError) throw deletePoolsError;
      }

      const { data: catalogItems, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (catalogItemsError) throw catalogItemsError;

      const catalogItemIds = ((catalogItems || []) as Array<{ id: string }>).map(
        (item) => item.id
      );

      const photoRows: CatalogPhotoRow[] = [];
      for (const ids of chunkArray(catalogItemIds, 200)) {
        if (ids.length === 0) continue;

        const { data: photoChunk, error: photosError } = await supabase
          .from("store_catalog_item_photos")
          .select("id, catalog_item_id, storage_path")
          .in("catalog_item_id", ids);

        if (photosError) throw photosError;
        photoRows.push(...((photoChunk || []) as CatalogPhotoRow[]));
      }

      const storagePaths = photoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      for (const paths of chunkArray(storagePaths, 100)) {
        if (paths.length === 0) continue;

        const { error: storageRemoveError } = await supabase.storage
          .from("store-catalog-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      for (const ids of chunkArray(photoRows.map((row) => row.id), 200)) {
        if (ids.length === 0) continue;

        const { error: deletePhotosError } = await supabase
          .from("store_catalog_item_photos")
          .delete()
          .in("id", ids);

        if (deletePhotosError) throw deletePhotosError;
      }

      for (const ids of chunkArray(catalogItemIds, 200)) {
        if (ids.length === 0) continue;

        const { error: deleteItemsError } = await supabase
          .from("store_catalog_items")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", ids);

        if (deleteItemsError) throw deleteItemsError;
      }

      setSuccessText("Todo o catalogo da loja foi apagado com sucesso, incluindo piscinas e itens gerais.");
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao apagar todo o catalogo da loja.");
      setSuccessText(null);
    } finally {
      setDeletingCatalog(false);
    }
  }, [organizationId, activeStoreId, deletingCatalog, totalCatalogo, fetchPageData]);

  const rawImportFilesModalFiles = rawImportFilesModalTab === "pools" ? poolImportFiles : catalogImportFiles;
  const rawImportFilesModalTitle =
    rawImportFilesModalTab === "pools"
      ? "Arquivos brutos de piscinas"
      : "Arquivos brutos de produtos e acessórios";
  const rawImportFilesModalEmptyText =
    rawImportFilesModalTab === "pools"
      ? "Nenhum arquivo bruto importado foi encontrado para piscinas ainda."
      : "Nenhum arquivo bruto importado foi encontrado para produtos e acessórios ainda.";
  const catalogImportedFiles = useMemo(() => {
    return [...poolImportFiles, ...catalogImportFiles].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [poolImportFiles, catalogImportFiles]);
  const customerCatalogEligibleFiles = useMemo(() => {
    const uniqueById = new Map<string, StoreImportFileRow>();

    for (const file of catalogImportedFiles) {
      if (
        normalizeLoose(file.status) !== "active" ||
        !cleanText(file.storage_bucket) ||
        !cleanText(file.storage_path)
      ) {
        continue;
      }
      if (!uniqueById.has(file.id)) uniqueById.set(file.id, file);
    }

    return Array.from(uniqueById.values());
  }, [catalogImportedFiles]);
  const selectedCustomerCatalogFiles = useMemo(() => {
    const selectedIds = Array.isArray(
      storeCatalogSettings?.customer_catalog_import_file_ids,
    )
      ? storeCatalogSettings.customer_catalog_import_file_ids
      : [];

    return selectedIds
      .map((selectedId) => catalogImportedFiles.find((file) => file.id === selectedId) ?? null)
      .filter(Boolean) as StoreImportFileRow[];
  }, [catalogImportedFiles, storeCatalogSettings]);
  const customerCatalogDraftFiles = useMemo(() => {
    return customerCatalogFileIdsDraft.map(
      (selectedId) =>
        customerCatalogEligibleFiles.find((file) => file.id === selectedId) ?? null,
    );
  }, [customerCatalogEligibleFiles, customerCatalogFileIdsDraft]);
  const customerCatalogCardStatus = useMemo(() => {
    if (!storeCatalogSettings) {
      return { tone: "yellow" as const, status: "Precisa de atenção" };
    }
    if (!storeCatalogSettings.allow_full_catalog_send) {
      return { tone: "blue" as const, status: "Completo" };
    }

    const selectedIds = Array.isArray(
      storeCatalogSettings.customer_catalog_import_file_ids,
    )
      ? storeCatalogSettings.customer_catalog_import_file_ids
      : [];

    if (selectedIds.length === 0 || selectedCustomerCatalogFiles.length !== selectedIds.length) {
      return { tone: "red" as const, status: "Configuração crítica" };
    }

    const hasInvalidSelectedFile = selectedCustomerCatalogFiles.some(
      (file) =>
        normalizeLoose(file.status) !== "active" ||
        !cleanText(file.storage_bucket) ||
        !cleanText(file.storage_path),
    );

    if (hasInvalidSelectedFile) {
      return { tone: "red" as const, status: "Configuração crítica" };
    }

    return { tone: "blue" as const, status: "Completo" };
  }, [storeCatalogSettings, selectedCustomerCatalogFiles]);
  const resetManualCatalogItemModalForm = useCallback(() => {
    setPoolForm(createEmptyPoolForm());
    setPoolPhotos([]);
    setCatalogForm(createEmptyCatalogForm());
    setCatalogPhotos([]);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const closeManualCatalogItemModal = useCallback(() => {
    resetManualCatalogItemModalForm();
    setManualCatalogItemCategory("piscina");
    setIsManualCatalogItemModalOpen(false);
  }, [resetManualCatalogItemModalForm]);
  const handleManualCatalogItemCategoryChange = useCallback(
    (value: "piscina" | "quimicos" | "acessorios" | "outros") => {
      setManualCatalogItemCategory(value);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(null);

      if (value !== "piscina") {
        setCatalogForm((current) => ({
          ...current,
          category: value,
        }));
      }
    },
    []
  );
  const handleManualCatalogPoolPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);
    if (validationError) {
      setManualCatalogItemModalError(validationError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setPoolPhotos(selectedFiles);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const handleManualCatalogGeneralPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);
    if (validationError) {
      setManualCatalogItemModalError(validationError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setCatalogPhotos(selectedFiles);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const handleManualCatalogItemVisualSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setManualCatalogItemModalError("Nenhuma loja ativa foi encontrada para salvar este item.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    const parseIntegerField = (value: string) => {
      const normalized = cleanText(value).replace(/\s+/g, "");
      if (!normalized) return null;
      if (!/^-?\d+$/.test(normalized)) return Number.NaN;
      return Number(normalized);
    };

    if (manualCatalogItemCategory === "piscina") {
      const poolName = cleanText(poolForm.name);
      const widthInput = cleanText(poolForm.width_m);
      const lengthInput = cleanText(poolForm.length_m);
      const depthInput = cleanText(poolForm.depth_m);
      const priceInput = cleanText(poolForm.price);
      const widthM = parseNumberInput(poolForm.width_m);
      const lengthM = parseNumberInput(poolForm.length_m);
      const depthM = parseNumberInput(poolForm.depth_m);
      const price = parseNumberInput(poolForm.price);
      const stockValue = parseIntegerField(poolForm.stock_quantity);
      const poolPhotosError = validateSelectedPhotos(poolPhotos);

      if (!poolName) {
        setManualCatalogItemModalError("Preencha o nome da piscina para continuar.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (widthM === null || lengthM === null || depthM === null) {
        setManualCatalogItemModalError(
          "Preencha largura, comprimento e profundidade da piscina antes de salvar."
        );
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (widthInput && widthM === null) {
        setManualCatalogItemModalError("Preencha uma largura válida em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (lengthInput && lengthM === null) {
        setManualCatalogItemModalError("Preencha um comprimento válido em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (depthInput && depthM === null) {
        setManualCatalogItemModalError("Preencha uma profundidade válida em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }
      if (widthM !== null && widthM <= 0) {
        setManualCatalogItemModalError("A largura da piscina deve ser maior que zero.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (lengthM !== null && lengthM <= 0) {
        setManualCatalogItemModalError("O comprimento da piscina deve ser maior que zero.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (depthM !== null && depthM <= 0) {
        setManualCatalogItemModalError("A profundidade da piscina deve ser maior que zero.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (priceInput && price === null) {
        setManualCatalogItemModalError("Preencha um preço numérico válido.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (price !== null && price < 0) {
        setManualCatalogItemModalError("O preço não pode ser negativo.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (Number.isNaN(stockValue) || (stockValue !== null && stockValue < 0)) {
        setManualCatalogItemModalError("O estoque deve ser um número inteiro igual ou maior que zero.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (poolPhotosError) {
        setManualCatalogItemModalError(poolPhotosError);
        setManualCatalogItemModalSuccess(null);
        return;
      }

      setSavingPool(true);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(null);

      try {
        const { data: existingPool, error: existingPoolError } = await supabase
          .from("pools")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .eq("name", poolName)
          .limit(1)
          .maybeSingle();

        if (existingPoolError) throw existingPoolError;

        if (existingPool?.id) {
          setManualCatalogItemModalError("Já existe uma piscina com esse nome nesta loja.");
          setManualCatalogItemModalSuccess(null);
          return;
        }

        const composedPoolDescription = buildPoolManualDescription(poolForm);
        const maxCapacityL =
          widthM !== null && lengthM !== null && depthM !== null
            ? Math.max(1, Math.round(widthM * lengthM * depthM * 1000))
            : null;
        const stockState = resolveManualStockState({
          rawQuantity: poolForm.stock_quantity,
          trackStock: poolForm.track_stock,
        });

        const { data: createdPool, error: insertError } = await supabase
          .from("pools")
          .insert({
            organization_id: organizationId,
            store_id: activeStoreId,
            name: poolName,
            width_m: widthM,
            length_m: lengthM,
            depth_m: depthM,
            shape: cleanText(poolForm.shape) || null,
            material: cleanText(poolForm.material) || null,
            max_capacity_l: maxCapacityL,
            weight_kg: null,
            price,
            price_status: resolveManualPriceStatus(price),
            description: composedPoolDescription || null,
            stock_quantity: stockState.stockQuantity,
            stock_status: stockState.stockStatus,
            is_active: poolForm.is_active,
            track_stock: poolForm.track_stock,
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        const createdPoolId = cleanText(createdPool?.id);
        if (!createdPoolId) {
          throw new Error("Não foi possível obter o ID da piscina criada.");
        }

        let photoUploadFailed = false;

        for (const [index, file] of poolPhotos.entries()) {
          const safeFileName = `${Date.now()}-${index}-${file.name.replace(/\s+/g, "-")}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdPoolId}/${safeFileName}`;

          try {
            const { error: uploadError } = await supabase.storage
              .from("pool-photos")
              .upload(storagePath, file, {
                cacheControl: "3600",
                upsert: false,
              });

            if (uploadError) throw uploadError;

            const { error: metadataError } = await supabase.from("pool_photos").insert({
              pool_id: createdPoolId,
              organization_id: organizationId,
              store_id: activeStoreId,
              storage_path: storagePath,
              file_name: file.name,
              file_size_bytes: file.size,
              sort_order: index,
            });

            if (metadataError) {
              await supabase.storage.from("pool-photos").remove([storagePath]);
              throw metadataError;
            }
          } catch {
            photoUploadFailed = true;
          }
        }

        setPoolForm(createEmptyPoolForm());
        setPoolPhotos([]);
        setManualCatalogItemModalError(null);
        setManualCatalogItemModalSuccess(
          photoUploadFailed
            ? "Piscina salva, mas uma ou mais fotos não foram enviadas."
            : "Piscina salva com sucesso."
        );
        await fetchPageData();
        return;
      } catch (error: any) {
        setManualCatalogItemModalError(error?.message ?? "Erro ao salvar a piscina manualmente.");
        setManualCatalogItemModalSuccess(null);
        return;
      } finally {
        setSavingPool(false);
      }
    }

    const itemName = cleanText(catalogForm.name);
    const priceInput = cleanText(catalogForm.price);
    const price = parseNumberInput(catalogForm.price);
    const stockValue = parseIntegerField(catalogForm.stock_quantity);
    const widthInput = cleanText(catalogForm.width_cm);
    const heightInput = cleanText(catalogForm.height_cm);
    const lengthInput = cleanText(catalogForm.length_cm);
    const weightInput = cleanText(catalogForm.weight_kg);
    const widthCm = parseNumberInput(catalogForm.width_cm);
    const heightCm = parseNumberInput(catalogForm.height_cm);
    const lengthCm = parseNumberInput(catalogForm.length_cm);
    const weightKg = parseNumberInput(catalogForm.weight_kg);
    const catalogPhotosError = validateSelectedPhotos(catalogPhotos);
    const sku = cleanText(catalogForm.sku) || null;

    if (!itemName) {
      setManualCatalogItemModalError("Preencha o nome do item para continuar.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (priceInput && price === null) {
      setManualCatalogItemModalError("Preencha um preço numérico válido.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (price !== null && price < 0) {
      setManualCatalogItemModalError("O preço não pode ser negativo.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (Number.isNaN(stockValue) || (stockValue !== null && stockValue < 0)) {
      setManualCatalogItemModalError("O estoque deve ser um número inteiro igual ou maior que zero.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (widthInput && widthCm === null) {
      setManualCatalogItemModalError("Preencha uma largura válida em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (heightInput && heightCm === null) {
      setManualCatalogItemModalError("Preencha uma altura válida em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (lengthInput && lengthCm === null) {
      setManualCatalogItemModalError("Preencha um comprimento válido em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (weightInput && weightKg === null) {
      setManualCatalogItemModalError("Preencha um peso válido em quilos.");
      setManualCatalogItemModalSuccess(null);
      return;
    }
    if (widthCm !== null && widthCm <= 0) {
      setManualCatalogItemModalError("A largura deve ser maior que zero.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (heightCm !== null && heightCm <= 0) {
      setManualCatalogItemModalError("A altura deve ser maior que zero.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (lengthCm !== null && lengthCm <= 0) {
      setManualCatalogItemModalError("O comprimento deve ser maior que zero.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (weightKg !== null && weightKg <= 0) {
      setManualCatalogItemModalError("O peso deve ser maior que zero.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (catalogPhotosError) {
      setManualCatalogItemModalError(catalogPhotosError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setSavingCatalogItem(true);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);

    try {
      const { data: existingItems, error: existingItemsError } = await supabase
        .from("store_catalog_items")
        .select("id, name, sku, metadata")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (existingItemsError) throw existingItemsError;

      const normalizedItemName = normalizeManualDuplicateText(itemName);
      const normalizedSku = normalizeManualDuplicateText(sku);
      const existingItemsList = (existingItems || []) as Array<{
        id: string;
        name: string | null;
        sku: string | null;
        metadata?: Record<string, unknown> | null;
      }>;

      const hasDuplicateName = existingItemsList.some(
        (existingItem) => normalizeManualDuplicateText(existingItem.name) === normalizedItemName
      );

      if (hasDuplicateName) {
        setManualCatalogItemModalError("Já existe um item com esse nome nesta loja.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (normalizedSku) {
        const hasDuplicateSku = existingItemsList.some(
          (existingItem) => normalizeManualDuplicateText(existingItem.sku) === normalizedSku
        );

        if (hasDuplicateSku) {
          setManualCatalogItemModalError("Já existe um item com esse SKU nesta loja.");
          setManualCatalogItemModalSuccess(null);
          return;
        }
      }

      const stockState = resolveManualStockState({
        rawQuantity: catalogForm.stock_quantity,
        trackStock: catalogForm.track_stock,
      });
      const metadataPayload = {
        categoria: manualCatalogItemCategory,
        brand: cleanText(catalogForm.brand) || null,
        line: cleanText(catalogForm.line) || null,
        unit_label: cleanText(catalogForm.unit_label) || null,
        size_details: cleanText(catalogForm.size_details) || null,
        width_cm: widthCm,
        height_cm: heightCm,
        length_cm: lengthCm,
        weight_kg: weightKg,
        application: cleanText(catalogForm.application) || null,
        technical_notes: cleanText(catalogForm.technical_notes) || null,
        manual_created_in_configuracoes: true,
        pending_photo_upload_count: 0,
      };

      const { data: createdItem, error: insertError } = await supabase
        .from("store_catalog_items")
        .insert({
          organization_id: organizationId,
          store_id: activeStoreId,
          sku,
          name: itemName,
          description: cleanText(catalogForm.description) || null,
          price_cents: price === null ? null : Math.round(price * 100),
          price_status: resolveManualPriceStatusFromCents(
            price === null ? null : Math.round(price * 100)
          ),
          currency: "BRL",
          is_active: catalogForm.is_active,
          track_stock: catalogForm.track_stock,
          stock_quantity: stockState.stockQuantity,
          stock_status: stockState.stockStatus,
          metadata: metadataPayload,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      const createdCatalogItemId = cleanText(createdItem?.id);
      if (!createdCatalogItemId) {
        throw new Error("Não foi possível obter o ID do item criado.");
      }

      let photoUploadFailed = false;

      for (const [index, file] of catalogPhotos.entries()) {
        const extension = file.name.split(".").pop() || "jpg";
        const safeFileName = `${Date.now()}-${index}-${crypto.randomUUID()}.${extension}`;
        const storagePath = `${organizationId}/${activeStoreId}/${createdCatalogItemId}/${safeFileName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from("store-catalog-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          const { error: metadataError } = await supabase
            .from("store_catalog_item_photos")
            .insert({
              catalog_item_id: createdCatalogItemId,
              storage_path: storagePath,
              file_name: file.name,
              file_size_bytes: file.size,
              sort_order: index,
            });

          if (metadataError) {
            await supabase.storage.from("store-catalog-photos").remove([storagePath]);
            throw metadataError;
          }
        } catch {
          photoUploadFailed = true;
        }
      }

      setCatalogForm({
        ...createEmptyCatalogForm(),
        category: manualCatalogItemCategory,
      });
      setCatalogPhotos([]);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(
        photoUploadFailed
          ? "Item salvo, mas uma ou mais fotos não foram enviadas."
          : "Item salvo com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      setManualCatalogItemModalError(error?.message ?? "Erro ao salvar o item manualmente.");
      setManualCatalogItemModalSuccess(null);
    } finally {
      setSavingCatalogItem(false);
    }
  }, [
    activeStoreId,
    catalogForm,
    catalogPhotos,
    fetchPageData,
    manualCatalogItemCategory,
    organizationId,
    poolForm,
    poolPhotos,
  ]);

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 overflow-x-hidden pb-10 pt-5">

      {!hasValidStoreContext ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhuma loja ativa foi encontrada.
        </div>
      ) : null}

      {errorText ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorText}
        </div>
      ) : null}

      {successText ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successText}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="h-0.5 w-full bg-black" />
        <div className="p-2.5">
          <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
            Áreas de configuração
          </div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-7">
            {tabs.map((tab) => (
              <SettingsTabButton
                key={tab.id}
                active={activeTab === tab.id}
                label={tab.label}
                badge={tab.id === "plano-cobranca" ? "Em breve" : undefined}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {activeTab === "geral" ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-2 [&>section]:h-full [&>section]:self-stretch">
          <SectionBlock
            title="Informações da loja"
            description="Informações básicas que identificam a loja no ZION e ajudam as IAs a apresentá-la corretamente."
            tone={!cleanText(storeName) ? "red" : !cleanText(strategySettingsInput.storeDescription) ? "yellow" : "blue"}
            status={!cleanText(storeName) ? "Configuração crítica" : !cleanText(strategySettingsInput.storeDescription) ? "Precisa de atenção" : "Completo"}
            className={overviewEditTarget === "store" ? "xl:col-span-2" : ""}
            actions={
              overviewEditTarget === "store" ? (
                <>
                  <button type="button" onClick={() => void handleGeneralInformationSave()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button>
                  <button type="button" onClick={() => { handleOverviewEditCancel(); setStrategyDraft(strategySettingsInput); setOverviewEditTarget(null); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">Cancelar</button>
                </>
              ) : (
                <button type="button" onClick={() => { setStrategyDraft(strategySettingsInput); setOverviewEditTarget("store"); setIsOverviewEditing(true); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">Editar</button>
              )
            }
          >
            {overviewEditTarget === "store" ? (
              <div className="grid gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual nome da loja deve aparecer para clientes e no ZION?</span>
                  <input value={overviewDraft.store_display_name ?? ""} onChange={(e) => handleOverviewDraftChange("store_display_name", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como você descreveria a loja em poucas frases?</span>
                  <textarea value={strategyDraft.storeDescription} onChange={(e) => handleStrategyDraftChange("storeDescription", e.target.value)} rows={4} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
                </label>
              </div>
            ) : (
              <SummaryList items={buildBulletRows([
                { label: "Nome da loja", value: storeName || "Não definido" },
                { label: "Descrição", value: cleanText(strategySettingsInput.storeDescription) || "Não definida" },
              ])} />
            )}
          </SectionBlock>

          <SectionBlock
            title="Endereço da loja"
            description="Defina onde a loja está localizada e como a IA deve orientar um cliente que queira ir até o estabelecimento."
            tone={isGeneralAddressComplete(savedGeneralAddress) ? "blue" : "yellow"}
            status={isGeneralAddressComplete(savedGeneralAddress) ? "Completo" : "Precisa de atenção"}
            className={overviewEditTarget === "address" ? "xl:col-span-2" : ""}
            actions={overviewEditTarget === "address" ? <><button type="button" onClick={() => { void handleGeneralAddressSave(); }} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setGeneralAddressDraft(savedGeneralAddress); setOverviewEditTarget(null); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">Cancelar</button></> : <button type="button" onClick={() => { setGeneralAddressDraft(savedGeneralAddress); setOverviewEditTarget("address"); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800">Editar</button>}
          >
            {overviewEditTarget === "address" ? (
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja possui um endereço físico que pode ser informado aos clientes?</span>
                  <ChoiceButtonGroup value={generalAddressDraft.has_public_address} onChange={(value) => updateGeneralAddressDraft("has_public_address", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                </label>
                {generalAddressDraft.has_public_address !== "Não" ? (
                  <fieldset disabled={generalAddressDraft.has_public_address !== "Sim"} className={generalAddressDraft.has_public_address === "Sim" ? "space-y-3" : "space-y-3 opacity-45"}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">CEP</span><input value={generalAddressDraft.cep} onChange={(e) => handleGeneralAddressCepChange(e.target.value)} placeholder="00000-000" inputMode="numeric" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />{generalAddressCepLookupLoading ? <span className="block text-xs text-gray-500">Consultando CEP...</span> : null}{generalAddressCepLookupMessage ? <span className="block text-xs text-amber-700">{generalAddressCepLookupMessage}</span> : null}</label>
                      <label className="space-y-1.5 md:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Rua / avenida</span><input value={generalAddressDraft.street} onChange={(e) => updateGeneralAddressDraft("street", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Número</span><input value={generalAddressDraft.number} onChange={(e) => updateGeneralAddressDraft("number", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Complemento</span><input value={generalAddressDraft.complement} onChange={(e) => updateGeneralAddressDraft("complement", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Bairro</span><input value={generalAddressDraft.district} onChange={(e) => updateGeneralAddressDraft("district", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cidade</span><input value={generalAddressDraft.city} onChange={(e) => updateGeneralAddressDraft("city", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estado</span><input value={generalAddressDraft.state} onChange={(e) => updateGeneralAddressDraft("state", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Ponto de referência</span><input value={generalAddressDraft.reference_point} onChange={(e) => updateGeneralAddressDraft("reference_point", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como clientes podem ir até a loja?</div>
                      <ChoiceButtonGroup value={generalAddressDraft.customer_visit_mode} onChange={(value) => updateGeneralAddressDraft("customer_visit_mode", value)} options={[{ value: "sem_agendamento", label: "Podem comparecer sem agendar" }, { value: "com_agendamento", label: "Somente com agendamento" }, { value: "nao_recebe_clientes", label: "O endereço não recebe clientes" }]} />
                    </div>
                    <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Orientações adicionais para chegar ao local</span><textarea value={generalAddressDraft.directions_notes} onChange={(e) => updateGeneralAddressDraft("directions_notes", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                  </fieldset>
                ) : null}
              </div>
            ) : (
              <SummaryList items={buildBulletRows([
                { label: "Endereço pode ser informado", value: savedGeneralAddress.has_public_address },
                ...(savedGeneralAddress.has_public_address === "Sim" ? [
                  { label: "Endereço", value: [savedGeneralAddress.street, savedGeneralAddress.number, savedGeneralAddress.district].filter(Boolean).join(", ") || "Não definido" },
                  { label: "Cidade / Estado", value: [savedGeneralAddress.city, savedGeneralAddress.state].filter(Boolean).join(" / ") || "Não definidos" },
                  { label: "Como recebe clientes", value: savedGeneralAddress.customer_visit_mode ? optionLabel(savedGeneralAddress.customer_visit_mode, [{ value: "sem_agendamento", label: "Sem agendamento" }, { value: "com_agendamento", label: "Somente com agendamento" }, { value: "nao_recebe_clientes", label: "Não recebe clientes no endereço" }]) : "Não definido" },
                ] : []),
              ])} />
            )}
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "operacao" ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-2 [&>section]:h-full [&>section]:self-stretch">
          <SectionBlock
            title="Horários da equipe"
            description="Defina quando a equipe humana da loja trabalha. As IAs usam isso para saber quando um humano pode realmente assumir uma situação."
            tone={resolveHumanScheduleCardStatus(scheduleSettings).tone}
            status={resolveHumanScheduleCardStatus(scheduleSettings).status}
            className={operationEditTarget === "hours" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "hours" ? <><button type="button" onClick={() => void saveHumanScheduleCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setOperationExperienceDraft(savedOperationExperience); setOperationEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setOperationExperienceDraft(savedOperationExperience); setOperationEditTarget("hours"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "hours" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais dias a equipe humana atende?</div>
                  <MultiSelectBoxGroup values={operationExperienceDraft.team_days} onToggle={(value) => toggleOperationExperienceArrayValue("team_days", value)} columns="sm:grid-cols-2 lg:grid-cols-4" options={DAYS_OF_WEEK_OPTIONS} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A equipe usa o mesmo horário em todos os dias selecionados?</div>
                  <ChoiceButtonGroup value={operationExperienceDraft.team_same_hours} onChange={(value) => updateOperationExperienceDraft("team_same_hours", value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não, alguns dias têm horários diferentes"}]} />
                </div>
                {operationExperienceDraft.team_same_hours === "Sim" ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Abertura padrão nos dias úteis</span><input type="time" value={operationExperienceDraft.team_open_time} onChange={(e) => updateOperationExperienceDraft("team_open_time", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                      <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fechamento padrão nos dias úteis</span><input type="time" value={operationExperienceDraft.team_close_time} onChange={(e) => updateOperationExperienceDraft("team_close_time", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {DAYS_OF_WEEK_OPTIONS.filter((day) => operationExperienceDraft.team_days.includes(day.value)).map((day) => (
                      <div key={day.value} className="grid items-end gap-3 rounded-xl border border-gray-200 bg-gray-50/50 p-3 sm:grid-cols-[1fr_1fr_1fr]">
                        <div className="pb-2 text-sm font-semibold text-gray-800">{day.label}</div>
                        <label className="space-y-1"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">Abre</span><input type="time" value={operationExperienceDraft.team_day_hours[day.value]?.open ?? "08:00"} onChange={(e) => updateOperationDayHours(day.value,"open",e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" /></label>
                        <label className="space-y-1"><span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">Fecha</span><input type="time" value={operationExperienceDraft.team_day_hours[day.value]?.close ?? "18:00"} onChange={(e) => updateOperationDayHours(day.value,"close",e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" /></label>
                      </div>
                    ))}
                  </div>
                )}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a loja funciona em feriados?</div><ChoiceButtonGroup value={operationExperienceDraft.holiday_mode} onChange={(value) => updateOperationExperienceDraft("holiday_mode", value)} options={[{value:"fechado",label:"Não atende"},{value:"normal",label:"Atende no horário normal"},{value:"especial",label:"Atende em horário especial"},{value:"caso_a_caso",label:"É definido caso a caso"}]} /></div>
                {operationExperienceDraft.holiday_mode === "especial" ? <div className="grid gap-3 sm:grid-cols-2"><input type="time" value={operationExperienceDraft.holiday_open_time} onChange={(e)=>updateOperationExperienceDraft("holiday_open_time",e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/><input type="time" value={operationExperienceDraft.holiday_close_time} onChange={(e)=>updateOperationExperienceDraft("holiday_close_time",e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></div> : null}
                {operationExperienceDraft.holiday_mode === "caso_a_caso" ? <RequiredOperationDetailField label="Como o atendimento em feriados é definido caso a caso?" value={operationExperienceDraft.holiday_notes} onChange={(value)=>updateOperationExperienceDraft("holiday_notes",value)} placeholder="Explique como a equipe decide se atende e qual horário usa em cada feriado." rows={3} /> : null}
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm"><span className="font-semibold">Fuso horário:</span> {cleanText(scheduleSettings?.timezone_name) || DEFAULT_SCHEDULE_TIMEZONE}</div>
              </div>
            ) : <SummaryList items={buildBulletRows([{label:"Dias",value:hasHumanScheduleCanonicalShape(scheduleSettings) ? savedOperationExperience.team_days.map((day)=>optionLabel(day,DAYS_OF_WEEK_OPTIONS)).join(", ") || "Não definidos" : "Não definido"},{label:"Horário",value:hasHumanScheduleCanonicalShape(scheduleSettings) ? savedOperationExperience.team_same_hours === "Sim" && savedOperationExperience.team_open_time && savedOperationExperience.team_close_time ? `${savedOperationExperience.team_open_time}–${savedOperationExperience.team_close_time}` : "Definido por dia" : "Não definido"},{label:"Feriados",value:isConfiguredTimestamp(scheduleSettings?.human_schedule_configured_at) && savedOperationExperience.holiday_mode ? optionLabel(savedOperationExperience.holiday_mode,[{value:"fechado",label:"Não atende"},{value:"normal",label:"Horário normal"},{value:"especial",label:"Horário especial"},{value:"caso_a_caso",label:"Caso a caso"}]) : "Não definido"},{label:"Fuso horário",value:cleanText(scheduleSettings?.timezone_name) || DEFAULT_SCHEDULE_TIMEZONE}])} />}
          </SectionBlock>

          <SectionBlock
            title="IA fora do horário"
            description="Defina quando a IA pode continuar atendendo clientes enquanto a equipe humana estiver fechada."
            tone={resolveAfterHoursCardStatus(scheduleSettings).tone}
            status={resolveAfterHoursCardStatus(scheduleSettings).status}
            className={operationEditTarget === "after_hours" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "after_hours" ? <><button type="button" onClick={()=>void saveAfterHoursCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget(null);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("after_hours");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "after_hours" ? <div className="space-y-4"><label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA pode continuar atendendo clientes quando a equipe humana estiver fechada?</span><ChoiceButtonGroup value={operationExperienceDraft.ai_after_hours_enabled} onChange={(value)=>updateOperationExperienceDraft("ai_after_hours_enabled",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>{operationExperienceDraft.ai_after_hours_enabled !== "Não" ? <fieldset disabled={operationExperienceDraft.ai_after_hours_enabled !== "Sim"} className={operationExperienceDraft.ai_after_hours_enabled === "Sim" ? "space-y-4" : "space-y-4 opacity-45"}><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a IA pode continuar atendendo?</div><ChoiceButtonGroup value={operationExperienceDraft.ai_after_hours_mode} onChange={(value)=>updateOperationExperienceDraft("ai_after_hours_mode",value)} options={[{value:"todo_fechado",label:"Durante todo o período em que a equipe estiver fechada"},{value:"janela",label:"Apenas dentro de uma janela específica"}]} /></div>{operationExperienceDraft.ai_after_hours_mode === "janela" ? <div className="grid gap-3 sm:grid-cols-2"><input type="time" value={operationExperienceDraft.ai_after_hours_start} onChange={(e)=>updateOperationExperienceDraft("ai_after_hours_start",e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/><input type="time" value={operationExperienceDraft.ai_after_hours_end} onChange={(e)=>updateOperationExperienceDraft("ai_after_hours_end",e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></div> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA pode atender em feriados quando a equipe humana não estiver disponível?</div><ChoiceButtonGroup value={operationExperienceDraft.ai_attends_holidays} onChange={(value)=>updateOperationExperienceDraft("ai_attends_holidays",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div></fieldset> : null}</div> : <SummaryList items={buildBulletRows([{label:"Atende fora do horário",value:savedOperationExperience.ai_after_hours_enabled},{label:"Modo",value:savedOperationExperience.ai_after_hours_mode ? optionLabel(savedOperationExperience.ai_after_hours_mode,[{value:"todo_fechado",label:"Todo o período fechado"},{value:"janela",label:"Janela específica"}]) : "Não definido"},{label:"Feriados",value:savedOperationExperience.ai_attends_holidays || "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Agenda e capacidade"
            description="Defina quantos compromissos a agenda pode receber e como funciona a capacidade simultânea."
            tone={resolveAgendaCapacityCardStatus(scheduleSettings).tone}
            status={resolveAgendaCapacityCardStatus(scheduleSettings).status}
            className={operationEditTarget === "agenda" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "agenda" ? <><button type="button" onClick={() => void saveAgendaCapacityCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={handleOperationEditCancel} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("agenda");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "agenda" ? (
              <div className="space-y-4">
                <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A agenda pode ter mais de um compromisso no mesmo dia?</span><ChoiceButtonGroup value={operationDraft.allow_multiple_appointments_per_day} onChange={(value)=>handleOperationDraftChange("allow_multiple_appointments_per_day",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
                {normalizeLoose(operationDraft.allow_multiple_appointments_per_day) !== "nao" ? (
                  <fieldset disabled={normalizeLoose(operationDraft.allow_multiple_appointments_per_day) !== "sim"} className={normalizeLoose(operationDraft.allow_multiple_appointments_per_day) === "sim" ? "space-y-4" : "space-y-4 opacity-45"}>
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe um limite máximo de compromissos por dia?</div><ChoiceButtonGroup value={operationExperienceDraft.agenda_daily_limit_mode} onChange={(value)=>updateOperationExperienceDraft("agenda_daily_limit_mode",value)} options={[{value:"limite",label:"Sim, existe um limite"},{value:"sem_limite",label:"Não há limite diário fixo"}]} /></div>
                    {operationExperienceDraft.agenda_daily_limit_mode === "limite" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantos compromissos no máximo podem ser marcados no mesmo dia?</span><input inputMode="numeric" value={operationExperienceDraft.agenda_daily_limit} onChange={(e)=>updateOperationExperienceDraft("agenda_daily_limit",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}
                    <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Pode haver mais de um compromisso no mesmo horário?</span><ChoiceButtonGroup value={operationDraft.allow_same_time_appointments} onChange={(value)=>handleOperationDraftChange("allow_same_time_appointments",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
                    {normalizeLoose(operationDraft.allow_same_time_appointments) === "sim" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantos compromissos podem acontecer ao mesmo tempo?</span><input inputMode="numeric" value={operationDraft.agenda_capacity_rule} onChange={(e)=>handleOperationDraftChange("agenda_capacity_rule", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe um intervalo mínimo necessário entre compromissos?</div><ChoiceButtonGroup value={operationExperienceDraft.agenda_buffer_enabled} onChange={(value)=>updateOperationExperienceDraft("agenda_buffer_enabled",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div>
                    {operationExperienceDraft.agenda_buffer_enabled === "Sim" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantos minutos de intervalo?</span><input inputMode="numeric" value={operationExperienceDraft.agenda_buffer_minutes} onChange={(e)=>updateOperationExperienceDraft("agenda_buffer_minutes",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}
                  </fieldset>
                ) : null}
              </div>
            ) : <SummaryList items={buildBulletRows([{label:"Vários compromissos no dia",value:isConfiguredTimestamp(scheduleSettings?.agenda_capacity_configured_at) ? yesNoLabel(scheduleSettings?.allow_multiple_appointments_per_day ?? null) : "Não definido"},{label:"Mesmo horário",value:isConfiguredTimestamp(scheduleSettings?.agenda_capacity_configured_at) ? yesNoLabel(scheduleSettings?.allow_same_time_appointments ?? null) : "Não definido"},{label:"Capacidade simultânea",value:isConfiguredTimestamp(scheduleSettings?.agenda_capacity_configured_at) && scheduleSettings?.same_time_capacity ? String(scheduleSettings.same_time_capacity) : "Não definida"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Autonomia de remarcações"
            description="Defina se a IA pode aceitar sozinha um novo horário sugerido pelo cliente quando esse horário estiver disponível."
            tone={resolveCustomerRescheduleAutonomyCardStatus(scheduleSettings).tone}
            status={resolveCustomerRescheduleAutonomyCardStatus(scheduleSettings).status}
            className={operationEditTarget === "reschedule_autonomy" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "reschedule_autonomy" ? <><button type="button" onClick={() => void saveCustomerRescheduleAutonomyCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setOperationExperienceDraft(savedOperationExperience); setOperationEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setOperationExperienceDraft(savedOperationExperience); setOperationEditTarget("reschedule_autonomy"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "reschedule_autonomy" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se o cliente sugerir outro horário e ele estiver disponível, a IA pode confirmar a remarcação sozinha?</div>
                  <ChoiceButtonGroup value={operationExperienceDraft.ai_can_accept_customer_reschedule_without_approval} onChange={(value) => updateOperationExperienceDraft("ai_can_accept_customer_reschedule_without_approval", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                </div>
                <p className="text-sm text-gray-500">Mesmo com “Sim”, a IA só confirma automaticamente quando o horário estiver livre e respeitar todas as regras da agenda.</p>
              </div>
            ) : <SummaryList items={buildBulletRows([{label:"Novo horário sugerido pelo cliente",value:isConfiguredTimestamp(scheduleSettings?.customer_reschedule_autonomy_configured_at) ? (scheduleSettings?.ai_can_accept_customer_reschedule_without_approval ? "IA pode confirmar sozinha" : "Precisa de aprovação da loja") : "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Região de atendimento"
            description="Defina onde a loja atende e quais restrições a IA deve respeitar quando um pedido estiver fora da cobertura principal."
            tone={isRegionConfigured ? "blue" : "yellow"}
            status={isRegionConfigured ? "Completo" : "Precisa de atenção"}
            className={operationEditTarget === "region" ? "xl:col-span-2" : ""}
            actions={
              operationEditTarget === "region" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRegionEditSave()}
                    className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStrategyDraft(strategySettingsInput);
                      setOperationExperienceDraft((current) => ({
                        ...current,
                        region_outside_policy: canonicalRegionOutsidePolicy,
                      }));
                      setOperationEditTarget(null);
                      setIsStrategyEditing(false);
                    }}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStrategyDraft(strategySettingsInput);
                    setOperationExperienceDraft((current) => ({
                      ...current,
                      region_outside_policy: canonicalRegionOutsidePolicy,
                    }));
                    setOperationEditTarget("region");
                    setIsStrategyEditing(true);
                  }}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold"
                >
                  Editar
                </button>
              )
            }
          >
            {operationEditTarget === "region" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Qual é a cobertura principal da loja?
                  </div>
                  <ChoiceButtonGroup
                    value={strategyDraft.serviceRegionPrimaryMode}
                    onChange={(value) =>
                      setStrategyDraft((current) => ({
                        ...current,
                        serviceRegionPrimaryMode: value,
                        serviceRegionModes: [value],
                        serviceRegions:
                          value === "grande_regiao"
                            ? current.serviceRegions
                            : "",
                      }))
                    }
                    options={SERVICE_REGION_MODE_OPTIONS.filter(
                      (option) => option.value !== "sob_consulta",
                    )}
                  />
                </div>

                {strategyDraft.serviceRegionPrimaryMode === "grande_regiao" ? (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                      Quais cidades, regiões ou limites fazem parte da cobertura?
                    </span>
                    <textarea
                      value={strategyDraft.serviceRegions}
                      onChange={(e) =>
                        handleStrategyDraftChange(
                          "serviceRegions",
                          e.target.value,
                        )
                      }
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                    />
                  </label>
                ) : null}

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    A loja atende pedidos fora dessa cobertura principal?
                  </div>
                  <ChoiceButtonGroup
                    value={operationExperienceDraft.region_outside_policy}
                    onChange={(value) =>
                      updateOperationExperienceDraft(
                        "region_outside_policy",
                        value,
                      )
                    }
                    options={[
                      {
                        value: "consulta",
                        label: "Sim, mas somente sob consulta",
                      },
                      {
                        value: "nao",
                        label: "Não",
                      },
                    ]}
                  />
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Há alguma regra de cobertura que a IA deve saber?
                  </span>
                  <textarea
                    value={strategyDraft.serviceRegionNotes}
                    onChange={(e) =>
                      handleStrategyDraftChange(
                        "serviceRegionNotes",
                        e.target.value,
                      )
                    }
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                  />
                </label>
              </div>
            ) : (
              <SummaryList
                items={buildBulletRows([
                  {
                    label: "Cobertura principal",
                    value: isRegionConfigured
                      ? optionLabel(
                          strategySettingsInput.serviceRegionPrimaryMode,
                          SERVICE_REGION_MODE_OPTIONS,
                        ) ||
                        strategySettingsInput.serviceRegions ||
                        "Não definida"
                      : "Não definida",
                  },
                  {
                    label: "Fora da cobertura",
                    value: isRegionConfigured
                      ? strategySettingsInput.serviceRegionOutsideConsultation
                        ? "Somente sob consulta"
                        : "Não atende"
                      : "Não definido",
                  },
                  {
                    label: "Observações",
                    value: isRegionConfigured
                      ? strategySettingsInput.serviceRegionNotes || "Nenhuma"
                      : "Não definida",
                  },
                ])}
              />
            )}
          </SectionBlock>

          <SectionBlock
            title="Visita técnica"
            description="Defina quando a visita técnica é oferecida, quando é obrigatória, quanto tempo ocupa na agenda e como deve ser executada e cobrada."
            tone={technicalVisitCardIsComplete ? "blue" : "yellow"}
            status={
              technicalVisitCardIsComplete
                ? "Completo"
                : "Precisa de atenção"
            }            className={operationEditTarget === "technical_visit" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "technical_visit" ? <><button type="button" onClick={()=>void saveTechnicalVisitConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);handleOperationEditCancel();}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("technical_visit");setIsOperationEditing(true);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "technical_visit" ? <div className="space-y-4">
              <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja oferece visita técnica?</span><ChoiceButtonGroup value={operationDraft.offers_technical_visit} onChange={(value)=>handleOperationDraftChange("offers_technical_visit",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
              {normalizeLoose(operationDraft.offers_technical_visit)!=="nao" ? <fieldset disabled={normalizeLoose(operationDraft.offers_technical_visit)!=="sim"} className={normalizeLoose(operationDraft.offers_technical_visit)==="sim" ? "space-y-5" : "space-y-5 opacity-45"}>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando uma visita técnica é obrigatória?</div><MultiSelectBoxGroup values={operationExperienceDraft.visit_required_situations} onToggle={(value)=>toggleOperationExperienceArrayValue("visit_required_situations",value)} options={[{value:"toda_venda_piscina",label:"Em toda venda de piscina"},{value:"piscina_com_instalacao",label:"Quando a piscina também será instalada pela loja"},{value:"instalacao_sem_venda",label:"Instalação de piscina sem uma venda nova"},{value:"troca_piscina",label:"Troca/substituição de uma piscina existente"},{value:"instalacao_equipamento",label:"Instalação de equipamento ou acessório"},{value:"projeto_fora_padrao",label:"Projeto fora do padrão"},{value:"medidas",label:"Quando medidas ainda precisam ser confirmadas"},{value:"viabilidade",label:"Dúvida sobre terreno, acesso ou viabilidade"},{value:"equipe_tecnica",label:"Quando a equipe técnica determinar"},{value:"outro",label:"Outro"}]} />{operationExperienceDraft.visit_required_situations.includes("outro") ? <RequiredOperationDetailField label="Quais outras situações tornam a visita obrigatória?" value={operationExperienceDraft.visit_required_other} onChange={(value)=>updateOperationExperienceDraft("visit_required_other",value)} placeholder="Descreva claramente as outras situações em que a visita é obrigatória." /> : null}{operationExperienceDraft.visit_required_situations.includes("toda_venda_piscina") ? <div className="mt-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900">“Em toda venda de piscina” já abrange vendas de piscina que também terão instalação da loja. As demais opções continuam úteis para operações sem uma nova venda de piscina, como troca ou instalação avulsa.</div> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a visita pode ser oferecida mesmo sem ser obrigatória?</div><MultiSelectBoxGroup values={operationExperienceDraft.visit_optional_situations} onToggle={(value)=>toggleOperationExperienceArrayValue("visit_optional_situations",value)} options={[{value:"cliente_pedir",label:"Quando o cliente pedir"},{value:"avaliar_local",label:"Para avaliar melhor o local"},{value:"confirmar_medidas",label:"Para confirmar medidas"},{value:"orcamento_preciso",label:"Para preparar um orçamento mais preciso"},{value:"outro",label:"Outro"}]} />{operationExperienceDraft.visit_optional_situations.includes("outro") ? <RequiredOperationDetailField label="Quais outras situações permitem oferecer a visita?" value={operationExperienceDraft.visit_optional_other} onChange={(value)=>updateOperationExperienceDraft("visit_optional_other",value)} placeholder="Explique quando a visita pode ser oferecida mesmo sem ser obrigatória." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quem normalmente realiza a visita técnica?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_team_mode} onChange={(value)=>updateOperationExperienceDraft("visit_team_mode",value)} options={[{value:"dono_loja",label:"Dono da loja"},{value:"mesma_instalacao",label:"A mesma equipe que faz instalações"},{value:"equipe_tecnica",label:"Uma equipe técnica própria separada"},{value:"outro_time",label:"Outro funcionário/equipe da loja"},{value:"parceiro",label:"Parceiro/terceiro"},{value:"caso_a_caso",label:"Depende do caso"}]} />{["outro_time","caso_a_caso"].includes(operationExperienceDraft.visit_team_mode) ? <RequiredOperationDetailField label="Quem realiza a visita nessa situação?" value={operationExperienceDraft.visit_team_rule} onChange={(value)=>updateOperationExperienceDraft("visit_team_rule",value)} placeholder="Informe o funcionário/equipe ou explique de quais casos depende." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A visita precisa ser agendada?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_requires_appointment} onChange={(value)=>updateOperationExperienceDraft("visit_requires_appointment",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div>
                {operationExperienceDraft.visit_requires_appointment === "Sim" ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quanto tempo deve ser reservado na agenda para cada visita técnica?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_duration_mode} onChange={(value)=>{updateOperationExperienceDraft("visit_duration_mode",value); if(["30","60","90","120"].includes(value)) updateOperationExperienceDraft("visit_duration_minutes",value);}} options={[{value:"30",label:"30 minutos"},{value:"60",label:"1 hora"},{value:"90",label:"1h30"},{value:"120",label:"2 horas"},{value:"personalizado",label:"Outro tempo"},{value:"varia",label:"Varia conforme o caso"}]} /></div> : null}
                {operationExperienceDraft.visit_duration_mode === "personalizado" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantos minutos devem ser reservados?</span><input inputMode="numeric" value={operationExperienceDraft.visit_duration_minutes} onChange={(e)=>updateOperationExperienceDraft("visit_duration_minutes",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></label> : null}
                {operationExperienceDraft.visit_duration_mode === "varia" ? <RequiredOperationDetailField label="O que faz a duração variar?" value={operationExperienceDraft.visit_duration_rule} onChange={(value)=>updateOperationExperienceDraft("visit_duration_rule",value)} placeholder="Explique o que define quanto tempo deve ser reservado para a visita." /> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a visita é cobrada?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_pricing_mode} onChange={(value)=>updateOperationExperienceDraft("visit_pricing_mode",value)} options={[{value:"free",label:"Gratuita"},{value:"fixed",label:"Valor fixo"},{value:"case_by_case",label:"Calculada caso a caso"}]} /></div>
                {operationExperienceDraft.visit_pricing_mode==="fixed" ? <div className="grid gap-3 sm:grid-cols-2"><input placeholder="Valor da visita (R$)" value={operationExperienceDraft.visit_fixed_fee} onChange={(e)=>updateOperationExperienceDraft("visit_fixed_fee",e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se o cliente fechar a compra, o valor da visita é descontado do valor final?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_deductible} onChange={(value)=>updateOperationExperienceDraft("visit_deductible",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div></div> : null}
                {operationExperienceDraft.visit_pricing_mode==="case_by_case" ? <div className="space-y-3"><RequiredOperationDetailField label="Como o valor é calculado?" value={operationExperienceDraft.visit_case_by_case_rule} onChange={(value)=>updateOperationExperienceDraft("visit_case_by_case_rule",value)} placeholder="Explique os critérios usados para calcular o valor da visita." rows={3} /><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se o cliente fechar a compra, o valor da visita é descontado do valor final?</div><ChoiceButtonGroup value={operationExperienceDraft.visit_deductible} onChange={(value)=>updateOperationExperienceDraft("visit_deductible",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div></div> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que deve ser confirmado antes de agendar a visita?</div><MultiSelectBoxGroup values={operationExperienceDraft.visit_preconfirm_items} onToggle={(value)=>toggleOperationExperienceArrayValue("visit_preconfirm_items",value)} options={[{value:"endereco",label:"Endereço"},{value:"contato",label:"Telefone/contato"},{value:"interesse",label:"Produto ou serviço de interesse"},{value:"medidas",label:"Medidas aproximadas"},{value:"fotos",label:"Fotos do local"},{value:"outro",label:"Outro"}]} />{operationExperienceDraft.visit_preconfirm_items.includes("outro") ? <RequiredOperationDetailField label="O que mais deve ser confirmado?" value={operationExperienceDraft.visit_preconfirm_other} onChange={(value)=>updateOperationExperienceDraft("visit_preconfirm_other",value)} placeholder="Especifique o outro requisito antes do agendamento." /> : null}</div>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 space-y-2"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-cyan-950">Descreva com suas palavras como a visita técnica funciona</div><p className="text-xs leading-5 text-cyan-900">Conte como esse processo acontece na prática, do início ao fim, como você explicaria para um cliente. A IA usará este texto para entender o processo real da loja e responder aos clientes, sempre respeitando as regras objetivas configuradas acima.</p><textarea placeholder="Ex.: combinamos um dia com o cliente, a equipe vai ao local, confere medidas, entende o projeto e verifica a viabilidade..." value={operationExperienceDraft.visit_other_notes} onChange={(e)=>updateOperationExperienceDraft("visit_other_notes",e.target.value)} rows={5} className="w-full rounded-xl border border-cyan-200 bg-white px-3 py-2.5 text-sm"/></div>
              </fieldset> : null}
            </div> : <SummaryList items={buildBulletRows([{label:"Oferece visita",value:yesNoLabel(operationSettingsInput.offersTechnicalVisit)},{label:"Obrigatória em",value:savedOperationExperience.visit_required_situations.length ? `${savedOperationExperience.visit_required_situations.length} ${savedOperationExperience.visit_required_situations.length === 1 ? "situação" : "situações"}` : "Não definido"},{label:"Tempo reservado",value:savedOperationExperience.visit_duration_minutes ? `${savedOperationExperience.visit_duration_minutes} min` : savedOperationExperience.visit_duration_mode === "varia" ? "Varia" : "Não definido"},{label:"Cobrança",value:savedOperationExperience.visit_pricing_mode ? optionLabel(savedOperationExperience.visit_pricing_mode,[{value:"free",label:"Gratuita"},{value:"fixed",label:"Valor fixo"},{value:"case_by_case",label:"Caso a caso"}]) : "Não definida"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Instalação de piscina nova"
            description="Defina como funciona a instalação de uma piscina nova, quanto tempo uma equipe fica ocupada e quais requisitos precisam estar cumpridos antes de agendar e iniciar o serviço."
            tone={installationCardIsComplete ? "blue" : "yellow"}
            status={
              installationCardIsComplete
                ? "Completo"
                : "Precisa de atenção"
            }            className={operationEditTarget === "installation" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "installation" ? <><button type="button" onClick={()=>void saveInstallationConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);handleOperationEditCancel();}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("installation");setIsOperationEditing(true);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "installation" ? <div className="space-y-4">
              <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja instala piscinas novas?</span><ChoiceButtonGroup value={operationDraft.offers_installation} onChange={(value)=>handleOperationDraftChange("offers_installation",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
              {normalizeLoose(operationDraft.offers_installation)!=="nao" ? <fieldset disabled={normalizeLoose(operationDraft.offers_installation)!=="sim"} className={normalizeLoose(operationDraft.offers_installation)==="sim" ? "space-y-5" : "space-y-5 opacity-45"}>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O cliente pode comprar a piscina sem contratar a instalação da loja?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_customer_can_buy_without} onChange={(value)=>updateOperationExperienceDraft("installation_customer_can_buy_without",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"depende",label:"Depende do tipo de piscina/projeto"}]} />{operationExperienceDraft.installation_customer_can_buy_without === "depende" ? <RequiredOperationDetailField label="De quais piscinas ou projetos depende?" value={operationExperienceDraft.installation_customer_can_buy_without_rule} onChange={(value)=>updateOperationExperienceDraft("installation_customer_can_buy_without_rule",value)} placeholder="Ex.: determinados modelos, tamanhos ou condições comerciais." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja instala piscina comprada de terceiros?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_third_party_pool} onChange={(value)=>updateOperationExperienceDraft("installation_third_party_pool",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"depende",label:"Depende do caso"}]} />{operationExperienceDraft.installation_third_party_pool === "depende" ? <RequiredOperationDetailField label="Em quais casos a loja instala piscina de terceiros?" value={operationExperienceDraft.installation_third_party_pool_rule} onChange={(value)=>updateOperationExperienceDraft("installation_third_party_pool_rule",value)} placeholder="Explique os tipos de piscina, condições ou limitações." /> : null}</div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-gray-950">Disponibilidade da piscina depois da venda</div>
                    <p className="mt-1 text-xs leading-5 text-gray-600">Separe o prazo de fábrica/fornecedor do prazo da própria equipe. Isso evita prometer instalação imediata quando a loja trabalha sob encomenda.</p>
                  </div>
                  <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a loja normalmente obtém a piscina depois da venda confirmada?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_supply_mode} onChange={(value)=>updateOperationExperienceDraft("installation_supply_mode",value)} options={[{value:"disponivel",label:"Normalmente já está disponível para a loja"},{value:"sob_encomenda",label:"Normalmente é encomendada da fábrica/fornecedor"},{value:"misto",label:"Depende do modelo: algumas disponíveis e outras sob encomenda"}]} /></div>
                  {["sob_encomenda","misto"].includes(operationExperienceDraft.installation_supply_mode) ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando depende da fábrica/fornecedor, qual é o prazo normal para a piscina ficar disponível para a loja?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_supplier_lead_time_mode} onChange={(value)=>updateOperationExperienceDraft("installation_supplier_lead_time_mode",value)} options={[{value:"1_3",label:"1 a 3 dias"},{value:"4_7",label:"4 a 7 dias"},{value:"8_15",label:"8 a 15 dias"},{value:"varia",label:"Varia conforme modelo/fornecedor"},{value:"outro",label:"Outro prazo"}]} /></div> : null}
                  {operationExperienceDraft.installation_supplier_lead_time_mode === "outro" ? <RequiredOperationDetailField label="Qual é o outro prazo normal?" value={operationExperienceDraft.installation_supplier_lead_time_value} onChange={(value)=>updateOperationExperienceDraft("installation_supplier_lead_time_value",value)} placeholder="Ex.: cerca de 20 dias corridos após a confirmação da venda." /> : null}
                  {operationExperienceDraft.installation_supplier_lead_time_mode === "varia" ? <RequiredOperationDetailField label="O que faz o prazo da fábrica/fornecedor variar?" value={operationExperienceDraft.installation_supplier_lead_time_rule} onChange={(value)=>updateOperationExperienceDraft("installation_supplier_lead_time_rule",value)} placeholder="Ex.: modelo, tamanho, fabricante, época do ano ou disponibilidade." /> : null}
                  <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Depois que a piscina estiver disponível e os demais requisitos estiverem concluídos, em quanto tempo a equipe normalmente consegue iniciar a instalação?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_start_lead_time_mode} onChange={(value)=>updateOperationExperienceDraft("installation_start_lead_time_mode",value)} options={[{value:"mesmo_dia",label:"No mesmo dia"},{value:"1_dia",label:"1 dia útil"},{value:"2_3_dias",label:"2 a 3 dias úteis"},{value:"4_7_dias",label:"4 a 7 dias úteis"},{value:"varia",label:"Depende da agenda/projeto"},{value:"outro",label:"Outro prazo"}]} /><div className="mt-2 text-xs text-gray-500">Aqui começa a contar a disponibilidade da equipe, não o tempo de fabricação ou transporte da piscina.</div></div>
                  {operationExperienceDraft.installation_start_lead_time_mode === "outro" ? <RequiredOperationDetailField label="Qual é o outro prazo para iniciar?" value={operationExperienceDraft.installation_start_lead_time_days} onChange={(value)=>updateOperationExperienceDraft("installation_start_lead_time_days",value)} placeholder="Informe o prazo normal depois que piscina e requisitos estiverem prontos." /> : null}
                  {operationExperienceDraft.installation_start_lead_time_mode === "varia" ? <RequiredOperationDetailField label="O que define quando a equipe consegue iniciar?" value={operationExperienceDraft.installation_start_lead_time_rule} onChange={(value)=>updateOperationExperienceDraft("installation_start_lead_time_rule",value)} placeholder="Ex.: agenda disponível, complexidade do projeto, região ou equipe necessária." /> : null}
                </div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Por quanto tempo uma instalação normalmente ocupa uma equipe?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_duration_mode} onChange={(value)=>{updateOperationExperienceDraft("installation_duration_mode",value); if(value==="horas") updateOperationExperienceDraft("installation_duration_unit","horas"); if(value==="dias_uteis") updateOperationExperienceDraft("installation_duration_unit","dias_uteis"); if(value==="dias_corridos") updateOperationExperienceDraft("installation_duration_unit","dias_corridos");}} options={[{value:"horas",label:"Algumas horas no mesmo dia"},{value:"dias_uteis",label:"Um ou mais dias úteis"},{value:"dias_corridos",label:"Um ou mais dias corridos"},{value:"varia",label:"Varia conforme o projeto"}]} /></div>
                {operationExperienceDraft.installation_duration_mode && operationExperienceDraft.installation_duration_mode !== "varia" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{operationExperienceDraft.installation_duration_mode === "horas" ? "Quantas horas a equipe fica ocupada?" : "Quantos dias a equipe fica ocupada?"}</span><input inputMode="numeric" value={operationExperienceDraft.installation_duration_value} onChange={(e)=>updateOperationExperienceDraft("installation_duration_value",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></label> : null}
                {operationExperienceDraft.installation_duration_mode === "varia" ? <RequiredOperationDetailField label="O que faz o tempo de instalação variar?" value={operationExperienceDraft.installation_duration_rule} onChange={(value)=>updateOperationExperienceDraft("installation_duration_rule",value)} placeholder="Explique quais características do projeto alteram o tempo de ocupação da equipe." /> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Sua loja tem mais de uma equipe capaz de fazer instalações em locais diferentes ao mesmo tempo?</div><ChoiceButtonGroup value={operationExperienceDraft.installation_has_multiple_teams} onChange={(value)=>{updateOperationExperienceDraft("installation_has_multiple_teams",value); if(value === "Não") updateOperationExperienceDraft("installation_concurrent_capacity","1");}} options={[{value:"Sim",label:"Sim, existem equipes simultâneas"},{value:"Não",label:"Não, existe uma única equipe de instalação"}]} /></div>
                {operationExperienceDraft.installation_has_multiple_teams === "Sim" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quantas equipes podem realizar instalações ao mesmo tempo?</span><input inputMode="numeric" min="2" value={operationExperienceDraft.installation_concurrent_capacity} onChange={(e)=>updateOperationExperienceDraft("installation_concurrent_capacity",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/><span className="block text-xs text-gray-500">Durante todo o tempo informado acima, cada equipe ocupada deve ficar indisponível para outra instalação.</span></label> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que precisa estar concluído antes de agendar a instalação?</div><MultiSelectBoxGroup values={operationExperienceDraft.installation_schedule_gates} onToggle={(value)=>toggleOperationExperienceArrayValue("installation_schedule_gates",value)} options={[{value:"visita",label:"Visita técnica concluída, quando aplicável"},{value:"endereco",label:"Endereço do cliente confirmado"},{value:"produto",label:"Piscina/produto definido"},{value:"orcamento",label:"Orçamento aprovado"},{value:"pagamento",label:"Entrada/pagamento exigido para agendamento confirmado"},{value:"contrato",label:"Contrato concluído, quando aplicável"},{value:"outro",label:"Outro requisito"}]} />{operationExperienceDraft.installation_schedule_gates.includes("outro") ? <RequiredOperationDetailField label="Qual é o outro requisito para agendar?" value={operationExperienceDraft.installation_schedule_gates_other} onChange={(value)=>updateOperationExperienceDraft("installation_schedule_gates_other",value)} placeholder="Especifique o requisito adicional antes do agendamento." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que precisa estar concluído antes de iniciar a instalação?</div><MultiSelectBoxGroup values={operationExperienceDraft.installation_start_gates} onToggle={(value)=>toggleOperationExperienceArrayValue("installation_start_gates",value)} options={[{value:"visita",label:"Visita técnica concluída, quando aplicável"},{value:"pagamento",label:"Pagamentos exigidos para início confirmados"},{value:"produto",label:"Piscina e materiais necessários disponíveis"},{value:"contrato",label:"Contrato concluído, quando aplicável"},{value:"local",label:"Local do cliente preparado para iniciar a instalação"},{value:"outro",label:"Outro requisito"}]} />{operationExperienceDraft.installation_start_gates.includes("outro") ? <RequiredOperationDetailField label="Qual é o outro requisito para iniciar?" value={operationExperienceDraft.installation_start_gates_other} onChange={(value)=>updateOperationExperienceDraft("installation_start_gates_other",value)} placeholder="Especifique o requisito adicional antes do início do serviço." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais etapas e serviços a instalação da loja normalmente inclui?</div><MultiSelectBoxGroup values={operationExperienceDraft.installation_includes} onToggle={(value)=>toggleOperationExperienceArrayValue("installation_includes",value)} columns="sm:grid-cols-2 lg:grid-cols-3" options={[{value:"entrega",label:"Entrega da piscina no local da instalação"},{value:"escavacao",label:"Escavação e preparação do terreno"},{value:"base",label:"Preparação da base/berço da piscina"},{value:"posicionamento",label:"Posicionamento e assentamento da piscina"},{value:"hidraulica",label:"Ligação hidráulica da piscina e equipamentos"},{value:"eletrica",label:"Ligação elétrica dos equipamentos"},{value:"bomba_filtro",label:"Instalação de bomba e filtro"},{value:"acessorios",label:"Instalação dos acessórios contratados"},{value:"testes",label:"Testes de funcionamento e verificação final"},{value:"enchimento",label:"Enchimento inicial da piscina"},{value:"tratamento",label:"Tratamento inicial da água"},{value:"orientacao",label:"Orientação inicial de uso e cuidados ao cliente"},{value:"acabamento",label:"Acabamento do entorno da piscina"},{value:"residuos",label:"Retirada de entulho e resíduos da instalação"},{value:"outro",label:"Outro serviço/etapa"}]} />{operationExperienceDraft.installation_includes.includes("outro") ? <RequiredOperationDetailField label="Qual outro serviço ou etapa está incluído?" value={operationExperienceDraft.installation_includes_other} onChange={(value)=>updateOperationExperienceDraft("installation_includes_other",value)} placeholder="Especifique o outro serviço incluído na instalação." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a instalação da loja normalmente não inclui?</div><MultiSelectBoxGroup values={operationExperienceDraft.installation_excludes_options} onToggle={(value)=>toggleOperationExperienceArrayValue("installation_excludes_options",value)} columns="sm:grid-cols-2 lg:grid-cols-3" options={[{value:"entorno",label:"Piso, deck, calçada ou acabamento do entorno"},{value:"paisagismo",label:"Paisagismo e acabamento decorativo"},{value:"eletrica_externa",label:"Adequações elétricas fora do conjunto instalado"},{value:"hidraulica_externa",label:"Adequações hidráulicas externas ao escopo da piscina"},{value:"entulho",label:"Retirada de terra/entulho excedente"},{value:"acessos",label:"Reparos em muro, portão ou acesso ao imóvel"},{value:"outro",label:"Outro item não incluído"}]} /></div>
                <textarea placeholder="Detalhes adicionais sobre o que a instalação NÃO inclui" value={operationExperienceDraft.installation_excludes} onChange={(e)=>updateOperationExperienceDraft("installation_excludes",e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2.5 text-sm ${operationExperienceDraft.installation_excludes_options.includes("outro") ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}/>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 space-y-2"><div className="text-xs font-semibold uppercase tracking-[0.08em] text-cyan-950">Descreva com suas palavras como a instalação funciona</div><p className="text-xs leading-5 text-cyan-900">Conte como esse processo acontece na prática, do início ao fim, como você explicaria para um cliente. A IA usará este texto para entender o processo real da loja e responder aos clientes, sempre respeitando as regras objetivas configuradas acima.</p><textarea placeholder="Ex.: depois da aprovação, confirmamos os requisitos, combinamos a data, a equipe executa a instalação e faz as verificações finais..." value={operationExperienceDraft.installation_notes} onChange={(e)=>updateOperationExperienceDraft("installation_notes",e.target.value)} rows={5} className="w-full rounded-xl border border-cyan-200 bg-white px-3 py-2.5 text-sm"/></div>
              </fieldset> : null}
            </div> : <SummaryList items={buildBulletRows([{label:"Instala piscinas",value:yesNoLabel(operationSettingsInput.offersInstallation)},{label:"Prazo para começar",value:savedOperationExperience.installation_start_lead_time_mode ? optionLabel(savedOperationExperience.installation_start_lead_time_mode,[{value:"mesmo_dia",label:"Mesmo dia"},{value:"1_dia",label:"1 dia útil"},{value:"2_3_dias",label:"2–3 dias úteis"},{value:"4_7_dias",label:"4–7 dias úteis"},{value:"varia",label:"Varia"},{value:"outro",label:"Outro"}]) : "Não definido"},{label:"Tempo de ocupação da equipe",value:savedOperationExperience.installation_duration_value ? `${savedOperationExperience.installation_duration_value} ${savedOperationExperience.installation_duration_unit === "horas" ? "hora(s)" : savedOperationExperience.installation_duration_unit === "dias_uteis" ? "dia(s) útil(eis)" : "dia(s)"}` : savedOperationExperience.installation_duration_mode === "varia" ? "Varia conforme o projeto" : "Não definido"},{label:"Equipes simultâneas",value:savedOperationExperience.installation_concurrent_capacity || "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Troca de piscina existente"
            description="Defina se a loja substitui uma piscina antiga por outra, quanto tempo esse serviço ocupa uma equipe e quais partes da troca realmente executa."
            tone={poolReplacementCardIsComplete ? "blue" : "yellow"}
            status={poolReplacementCardIsComplete ? "Completo" : "Precisa de atenção"}
            className={operationEditTarget === "pool_replacement" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "pool_replacement" ? <><button type="button" onClick={()=>void savePoolReplacementConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget(null);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("pool_replacement");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "pool_replacement" ? <div className="space-y-4">
              <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja realiza troca/substituição de piscina existente?</span><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_enabled} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_enabled",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
              {operationExperienceDraft.pool_replacement_enabled !== "Não" ? <fieldset disabled={operationExperienceDraft.pool_replacement_enabled !== "Sim"} className={operationExperienceDraft.pool_replacement_enabled === "Sim" ? "space-y-4" : "space-y-4 opacity-45"}>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais situações?</div><button type="button" disabled={operationExperienceDraft.pool_replacement_enabled !== "Sim"} onClick={()=>{const all=["nova_da_loja","nova_terceiro","danificada","modelo_diferente","caso_a_caso"];updateOperationExperienceDraft("pool_replacement_situations", all.every((value)=>operationExperienceDraft.pool_replacement_situations.includes(value)) ? [] : all);}} className={`mb-2 w-full rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${["nova_da_loja","nova_terceiro","danificada","modelo_diferente","caso_a_caso"].every((value)=>operationExperienceDraft.pool_replacement_situations.includes(value)) ? "border-cyan-500 bg-cyan-50 text-cyan-950" : "border-gray-200 bg-white text-gray-700"}`}>Todas as opções</button><MultiSelectBoxGroup values={operationExperienceDraft.pool_replacement_situations} onToggle={(value)=>toggleOperationExperienceArrayValue("pool_replacement_situations",value)} options={[{value:"nova_da_loja",label:"Troca uma piscina antiga por uma nova vendida pela loja"},{value:"nova_terceiro",label:"Troca mesmo quando a nova piscina não foi comprada na loja"},{value:"danificada",label:"Substitui uma piscina danificada por uma nova"},{value:"modelo_diferente",label:"Substitui por modelo ou tamanho diferente"},{value:"caso_a_caso",label:"Aceita outros tipos de troca mediante avaliação"}]} />{operationExperienceDraft.pool_replacement_situations.includes("caso_a_caso") ? <RequiredOperationDetailField label="Quais outros tipos de troca são avaliados?" value={operationExperienceDraft.pool_replacement_situations_other} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_situations_other",value)} placeholder="Explique quais situações entram nessa avaliação." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A troca utiliza uma das mesmas equipes que fazem instalação de piscina nova?</div><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_uses_installation_team} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_uses_installation_team",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não, há outra equipe"},{value:"depende",label:"Depende do caso"}]} />{operationExperienceDraft.pool_replacement_uses_installation_team === "depende" ? <RequiredOperationDetailField label="Em quais casos usa a mesma equipe?" value={operationExperienceDraft.pool_replacement_team_rule} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_team_rule",value)} placeholder="Explique quando a troca usa a equipe de instalação nova e quando não usa." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Por quanto tempo uma troca normalmente ocupa a equipe responsável?</div><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_duration_mode} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_duration_mode",value)} options={[{value:"horas",label:"Algumas horas no mesmo dia"},{value:"dias",label:"Um ou mais dias"},{value:"varia",label:"Varia conforme o caso"}]} /></div>
                {operationExperienceDraft.pool_replacement_duration_mode === "horas" || operationExperienceDraft.pool_replacement_duration_mode === "dias" ? <input inputMode="numeric" placeholder={operationExperienceDraft.pool_replacement_duration_mode === "horas" ? "Quantas horas?" : "Quantos dias?"} value={operationExperienceDraft.pool_replacement_duration_value} onChange={(e)=>updateOperationExperienceDraft("pool_replacement_duration_value",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/> : null}
                {operationExperienceDraft.pool_replacement_duration_mode === "varia" ? <RequiredOperationDetailField label="O que faz o tempo da troca variar?" value={operationExperienceDraft.pool_replacement_duration_rule} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_duration_rule",value)} placeholder="Explique quais condições da troca alteram o tempo de ocupação da equipe." /> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A piscina antiga é removida pela própria loja?</div><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_removes_old} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_removes_old",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"caso_a_caso",label:"Caso a caso"}]} />{operationExperienceDraft.pool_replacement_removes_old === "caso_a_caso" ? <RequiredOperationDetailField label="Em quais casos a loja remove a piscina antiga?" value={operationExperienceDraft.pool_replacement_removes_old_rule} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_removes_old_rule",value)} placeholder="Explique as condições para a remoção." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O descarte/retirada da piscina antiga está incluído?</div><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_disposal_included} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_disposal_included",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"caso_a_caso",label:"Caso a caso"}]} />{operationExperienceDraft.pool_replacement_disposal_included === "caso_a_caso" ? <RequiredOperationDetailField label="Em quais casos o descarte está incluído?" value={operationExperienceDraft.pool_replacement_disposal_rule} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_disposal_rule",value)} placeholder="Explique quando a loja assume o descarte e quando não assume." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A troca exige visita técnica antes?</div><ChoiceButtonGroup value={operationExperienceDraft.pool_replacement_requires_visit} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_requires_visit",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"depende",label:"Depende do caso"}]} />{operationExperienceDraft.pool_replacement_requires_visit === "depende" ? <RequiredOperationDetailField label="Em quais casos a visita técnica é exigida?" value={operationExperienceDraft.pool_replacement_visit_rule} onChange={(value)=>updateOperationExperienceDraft("pool_replacement_visit_rule",value)} placeholder="Explique os casos em que a troca precisa de visita antes." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que normalmente está incluído na troca?</div><MultiSelectBoxGroup values={operationExperienceDraft.pool_replacement_includes} onToggle={(value)=>toggleOperationExperienceArrayValue("pool_replacement_includes",value)} options={[{value:"desconexao",label:"Desconexão da piscina/equipamentos existentes"},{value:"retirada_antiga",label:"Retirada da piscina antiga"},{value:"preparacao_base",label:"Preparação ou ajuste da base"},{value:"posicionamento",label:"Posicionamento da nova piscina"},{value:"hidraulica",label:"Reconexão/adequação hidráulica da nova piscina"},{value:"equipamentos",label:"Reinstalação dos equipamentos contratados"},{value:"testes",label:"Testes e verificação final"},{value:"descarte",label:"Descarte da piscina antiga, quando contratado"},{value:"outro",label:"Outro serviço"}]} /></div>
                <textarea placeholder="Detalhes adicionais sobre o que está incluído na troca" value={operationExperienceDraft.pool_replacement_notes} onChange={(e)=>updateOperationExperienceDraft("pool_replacement_notes",e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2.5 text-sm ${operationExperienceDraft.pool_replacement_includes.includes("outro") ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}/>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a loja normalmente não faz durante a troca?</div><MultiSelectBoxGroup values={operationExperienceDraft.pool_replacement_excludes_options} onToggle={(value)=>toggleOperationExperienceArrayValue("pool_replacement_excludes_options",value)} options={[{value:"descarte",label:"Descarte/transporte da piscina antiga"},{value:"obra_entorno",label:"Piso, deck ou acabamento do entorno"},{value:"paisagismo",label:"Paisagismo e acabamento decorativo"},{value:"estrutura",label:"Obra estrutural adicional no local"},{value:"eletrica_externa",label:"Adequações elétricas externas"},{value:"hidraulica_externa",label:"Adequações hidráulicas fora do escopo da troca"},{value:"outro",label:"Outro serviço que não faz"}]} /></div>
                <textarea placeholder="Detalhes adicionais sobre o que a loja NÃO faz durante a troca" value={operationExperienceDraft.pool_replacement_excludes} onChange={(e)=>updateOperationExperienceDraft("pool_replacement_excludes",e.target.value)} rows={3} className={`w-full rounded-xl border px-3 py-2.5 text-sm ${operationExperienceDraft.pool_replacement_excludes_options.includes("outro") ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}/>
              </fieldset> : null}
            </div> : <SummaryList items={buildBulletRows([{label:"Realiza troca",value:savedOperationExperience.pool_replacement_enabled},{label:"Situações atendidas",value:savedOperationExperience.pool_replacement_situations.length ? `${savedOperationExperience.pool_replacement_situations.length} configurada(s)` : "Não definidas"},{label:"Tempo de ocupação",value:savedOperationExperience.pool_replacement_duration_value ? `${savedOperationExperience.pool_replacement_duration_value} ${savedOperationExperience.pool_replacement_duration_mode === "horas" ? "hora(s)" : "dia(s)"}` : savedOperationExperience.pool_replacement_duration_mode === "varia" ? "Varia" : "Não definido"},{label:"Usa equipe de instalação",value:savedOperationExperience.pool_replacement_uses_installation_team || "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Entrega"
            description="Entrega é o transporte de um produto vendido pela loja até o endereço indicado pelo cliente. Defina exatamente o que é entregue, quem realiza o transporte, como o frete é calculado e o que acontece no local."
            tone={deliveryCardIsComplete ? "blue" : "yellow"}
            status={deliveryCardIsComplete ? "Completo" : "Precisa de atenção"}
            className={operationEditTarget === "delivery" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "delivery" ? <><button type="button" onClick={()=>void saveDeliveryConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget(null);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("delivery");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "delivery" ? <div className="space-y-4">
              <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja entrega produtos no endereço do cliente?</span><ChoiceButtonGroup value={operationExperienceDraft.delivery_enabled} onChange={(value)=>updateOperationExperienceDraft("delivery_enabled",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>
              {operationExperienceDraft.delivery_enabled !== "Não" ? <fieldset disabled={operationExperienceDraft.delivery_enabled !== "Sim"} className={operationExperienceDraft.delivery_enabled === "Sim" ? "space-y-4" : "space-y-4 opacity-45"}>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a loja entrega?</div><MultiSelectBoxGroup values={operationExperienceDraft.delivery_items} onToggle={(value)=>toggleOperationExperienceArrayValue("delivery_items",value)} options={[{value:"piscina_sem_instalacao",label:"Piscina vendida sem instalação da loja"},{value:"piscina_com_instalacao",label:"Piscina que será instalada pela própria loja"},{value:"equipamentos",label:"Equipamentos — bomba, filtro, aquecedor etc."},{value:"acessorios",label:"Acessórios"},{value:"quimicos",label:"Produtos químicos"},{value:"outros",label:"Outros produtos do catálogo"}]} />{operationExperienceDraft.delivery_items.includes("outros") ? <RequiredOperationDetailField label="Quais outros produtos a loja entrega?" value={operationExperienceDraft.delivery_items_other} onChange={(value)=>updateOperationExperienceDraft("delivery_items_other",value)} placeholder="Especifique os outros produtos do catálogo." /> : null}</div>
                {operationExperienceDraft.delivery_items.includes("piscina_com_instalacao") ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a piscina será instalada pela própria loja, como o transporte da piscina até o local é organizado?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_with_installation_mode} onChange={(value)=>updateOperationExperienceDraft("delivery_with_installation_mode",value)} options={[{value:"parte_instalacao",label:"A entrega já faz parte do serviço de instalação"},{value:"separado",label:"A entrega é agendada separadamente da instalação"},{value:"depende",label:"A forma de entrega depende do projeto"}]} /></div> : null}
                {operationExperienceDraft.delivery_with_installation_mode === "parte_instalacao" ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a entrega costuma acontecer em relação à instalação?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_with_installation_timing} onChange={(value)=>updateOperationExperienceDraft("delivery_with_installation_timing",value)} options={[{value:"mesmo_dia",label:"No mesmo dia da instalação"},{value:"antes",label:"Antes do dia da instalação"},{value:"depende",label:"Depende do projeto"}]} /></div> : null}
                {operationExperienceDraft.delivery_with_installation_mode === "separado" ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A entrega precisa acontecer antes do dia da instalação?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_with_installation_timing} onChange={(value)=>updateOperationExperienceDraft("delivery_with_installation_timing",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"depende",label:"Depende do projeto"}]} /></div> : null}
                {(operationExperienceDraft.delivery_with_installation_mode === "depende" || operationExperienceDraft.delivery_with_installation_timing === "depende") ? <RequiredOperationDetailField label="De que depende a relação entre entrega e instalação?" value={operationExperienceDraft.delivery_with_installation_notes} onChange={(value)=>updateOperationExperienceDraft("delivery_with_installation_notes",value)} placeholder="Explique em quais projetos a entrega acontece junto, antes ou separadamente da instalação." /> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quem normalmente realiza a entrega?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_provider} onChange={(value)=>updateOperationExperienceDraft("delivery_provider",value)} options={[{value:"propria",label:"Equipe/frota própria da loja"},{value:"parceiro",label:"Transportadora ou parceiro"},{value:"ambos",label:"A loja usa os dois, dependendo do tipo de pedido"},{value:"caso_a_caso",label:"É definido individualmente para cada pedido"}]} /></div>
                {operationExperienceDraft.delivery_provider === "ambos" ? <RequiredOperationDetailField label="Quando a loja entrega e quando usa parceiro?" value={operationExperienceDraft.delivery_provider_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_provider_rule",value)} placeholder="Explique como essa decisão é tomada." /> : null}
                {operationExperienceDraft.delivery_provider === "caso_a_caso" ? <RequiredOperationDetailField label="Como a forma de entrega é definida caso a caso?" value={operationExperienceDraft.delivery_provider_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_provider_rule",value)} placeholder="Explique quem decide e com base em quais critérios." /> : null}
                {(operationExperienceDraft.delivery_provider === "propria" || operationExperienceDraft.delivery_provider === "ambos" || operationExperienceDraft.delivery_provider === "caso_a_caso") ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a própria loja faz a entrega, ela usa uma das mesmas equipes de instalação?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_uses_installation_team} onChange={(value)=>updateOperationExperienceDraft("delivery_uses_installation_team",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não, há equipe/frota separada"},{value:"depende",label:"Depende do pedido"}]} />{operationExperienceDraft.delivery_uses_installation_team === "depende" ? <RequiredOperationDetailField label="Em quais pedidos a entrega usa a equipe de instalação?" value={operationExperienceDraft.delivery_installation_team_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_installation_team_rule",value)} placeholder="Explique em quais casos a equipe de instalação também fica ocupada com a entrega." /> : null}</div> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como o frete é cobrado do cliente?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_pricing_mode} onChange={(value)=>updateOperationExperienceDraft("delivery_pricing_mode",value)} options={[{value:"gratuito",label:"Não há cobrança de frete"},{value:"incluido",label:"O frete já está incluído no preço da venda"},{value:"fixo",label:"A loja cobra um valor fixo"},{value:"destino",label:"O valor é calculado conforme distância ou região"},{value:"parceiro",label:"O valor é definido pela transportadora/parceiro"},{value:"caso_a_caso",label:"A equipe calcula individualmente para cada pedido"}]} /></div>
                {operationExperienceDraft.delivery_pricing_mode === "fixo" ? <input placeholder="Valor padrão do frete (R$)" value={operationExperienceDraft.delivery_fixed_fee} onChange={(e)=>updateOperationExperienceDraft("delivery_fixed_fee",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/> : null}
                {operationExperienceDraft.delivery_pricing_mode === "destino" ? <div className="space-y-3"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como o valor é calculado?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_pricing_destination_mode} onChange={(value)=>updateOperationExperienceDraft("delivery_pricing_destination_mode",value)} options={[{value:"distancia",label:"Por distância"},{value:"regiao",label:"Por cidade/região"},{value:"faixa",label:"Por faixa de distância"},{value:"outra",label:"Outra regra"}]} /></div>{operationExperienceDraft.delivery_pricing_destination_mode === "outra" ? <RequiredOperationDetailField label="Qual é a outra regra de cálculo?" value={operationExperienceDraft.delivery_pricing_destination_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_pricing_destination_rule",value)} placeholder="Descreva claramente a outra regra usada para calcular o frete." /> : <textarea placeholder="Descreva a regra de cálculo para a IA saber quando precisa consultar a equipe." value={operationExperienceDraft.delivery_pricing_destination_rule} onChange={(e)=>updateOperationExperienceDraft("delivery_pricing_destination_rule",e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/>}</div> : null}
                {operationExperienceDraft.delivery_pricing_mode === "parceiro" ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Depois da cotação da transportadora/parceiro, como o valor chega ao cliente?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_partner_pricing_mode} onChange={(value)=>updateOperationExperienceDraft("delivery_partner_pricing_mode",value)} options={[{value:"repasse",label:"É repassado integralmente ao cliente"},{value:"loja_define",label:"A loja define o preço depois da cotação"},{value:"depende",label:"Depende do pedido"}]} />{operationExperienceDraft.delivery_partner_pricing_mode === "depende" ? <RequiredOperationDetailField label="De que depende o valor cobrado ao cliente?" value={operationExperienceDraft.delivery_partner_pricing_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_partner_pricing_rule",value)} placeholder="Explique quando há repasse integral e quando a loja define outro valor." /> : null}</div> : null}
                {operationExperienceDraft.delivery_pricing_mode === "caso_a_caso" ? <div className="space-y-3"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a equipe considera para definir o frete?</div><MultiSelectBoxGroup values={operationExperienceDraft.delivery_case_factors} onToggle={(value)=>toggleOperationExperienceArrayValue("delivery_case_factors",value)} options={[{value:"distancia",label:"Distância"},{value:"peso_tamanho",label:"Tamanho/peso do produto"},{value:"veiculo",label:"Necessidade de veículo especial"},{value:"regiao",label:"Região"},{value:"acesso",label:"Acesso ao local"},{value:"outro",label:"Outro"}]} /></div><RequiredOperationDetailField label={operationExperienceDraft.delivery_case_factors.includes("outro") ? "Como o frete é calculado e qual é o outro fator?" : "Como a equipe calcula o frete caso a caso?"} value={operationExperienceDraft.delivery_case_rule} onChange={(value)=>updateOperationExperienceDraft("delivery_case_rule",value)} placeholder="Explique como esses fatores são usados para chegar ao valor cobrado do cliente." /></div> : null}
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que deve estar concluído antes de liberar a entrega?</div><MultiSelectBoxGroup values={operationExperienceDraft.delivery_release_gates} onToggle={(value)=>toggleOperationExperienceArrayValue("delivery_release_gates",value)} options={[{value:"pagamento",label:"Pagamento confirmado"},{value:"produto",label:"Produto disponível"},{value:"endereco",label:"Endereço confirmado"},{value:"contrato",label:"Contrato, quando aplicável"},{value:"outro",label:"Outro"}]} />{operationExperienceDraft.delivery_release_gates.includes("outro") ? <RequiredOperationDetailField label="Qual é o outro requisito para liberar a entrega?" value={operationExperienceDraft.delivery_release_gates_other} onChange={(value)=>updateOperationExperienceDraft("delivery_release_gates_other",value)} placeholder="Especifique o requisito adicional." /> : null}</div>
                <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando a loja entrega itens grandes, o que a equipe faz no local?</div><ChoiceButtonGroup value={operationExperienceDraft.delivery_unloading_mode} onChange={(value)=>updateOperationExperienceDraft("delivery_unloading_mode",value)} options={[{value:"transporta",label:"Apenas transporta até o endereço"},{value:"descarrega",label:"Transporta e descarrega"},{value:"posiciona",label:"Transporta, descarrega e posiciona no local indicado"},{value:"depende",label:"Depende do produto ou projeto"}]} /></div>
                {operationExperienceDraft.delivery_unloading_mode === "depende" ? <RequiredOperationDetailField label="De quais produtos ou projetos depende o atendimento no local?" value={operationExperienceDraft.delivery_notes} onChange={(value)=>updateOperationExperienceDraft("delivery_notes",value)} placeholder="Explique quando a equipe apenas transporta, quando descarrega e quando também posiciona o produto." /> : <textarea placeholder="Observações ou restrições da entrega" value={operationExperienceDraft.delivery_notes} onChange={(e)=>updateOperationExperienceDraft("delivery_notes",e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/>}
              </fieldset> : null}
            </div> : <SummaryList items={buildBulletRows([{label:"Oferece entrega",value:savedOperationExperience.delivery_enabled},{label:"O que entrega",value:savedOperationExperience.delivery_items.length ? `${savedOperationExperience.delivery_items.length} categoria(s)` : "Não definido"},{label:"Quem entrega",value:savedOperationExperience.delivery_provider ? optionLabel(savedOperationExperience.delivery_provider,[{value:"propria",label:"Equipe própria"},{value:"parceiro",label:"Parceiro"},{value:"ambos",label:"Loja e parceiro"},{value:"caso_a_caso",label:"Caso a caso"}]) : "Não definido"},{label:"Frete",value:savedOperationExperience.delivery_pricing_mode ? optionLabel(savedOperationExperience.delivery_pricing_mode,[{value:"gratuito",label:"Sem cobrança"},{value:"incluido",label:"Incluído"},{value:"fixo",label:"Fixo"},{value:"destino",label:"Por distância/região"},{value:"parceiro",label:"Definido pelo parceiro"},{value:"caso_a_caso",label:"Caso a caso"}]) : "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Retirada"
            description="Retirada é quando o cliente ou alguém autorizado busca na loja um produto comprado. Defina quais itens podem ser retirados e como funciona a liberação."
            tone={pickupCardIsComplete ? "blue" : "yellow"}
            status={pickupCardIsComplete ? "Completo" : "Precisa de atenção"}
            className={operationEditTarget === "pickup" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "pickup" ? <><button type="button" onClick={()=>void savePickupConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget(null);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("pickup");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "pickup" ? <div className="space-y-4"><label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja permite que clientes retirem produtos?</span><ChoiceButtonGroup value={operationExperienceDraft.pickup_enabled} onChange={(value)=>updateOperationExperienceDraft("pickup_enabled",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>{operationExperienceDraft.pickup_enabled !== "Não" ? <fieldset disabled={operationExperienceDraft.pickup_enabled !== "Sim"} className={operationExperienceDraft.pickup_enabled === "Sim" ? "space-y-4" : "space-y-4 opacity-45"}><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que pode ser retirado?</div><MultiSelectBoxGroup values={operationExperienceDraft.pickup_items} onToggle={(value)=>toggleOperationExperienceArrayValue("pickup_items",value)} options={[{value:"piscinas",label:"Piscinas"},{value:"equipamentos",label:"Equipamentos"},{value:"acessorios",label:"Acessórios"},{value:"quimicos",label:"Produtos químicos"},{value:"outros",label:"Outros itens do catálogo"}]} />{operationExperienceDraft.pickup_items.includes("outros") ? <RequiredOperationDetailField label="Quais outros itens podem ser retirados?" value={operationExperienceDraft.pickup_items_other} onChange={(value)=>updateOperationExperienceDraft("pickup_items_other",value)} placeholder="Especifique os outros itens do catálogo." /> : null}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Onde a retirada acontece?</div><ChoiceButtonGroup value={operationExperienceDraft.pickup_location_mode} onChange={(value)=>updateOperationExperienceDraft("pickup_location_mode",value)} options={[{value:"loja",label:"Endereço principal da loja"},{value:"outro",label:"Outro local"}]} /></div>{operationExperienceDraft.pickup_location_mode==="outro" ? <input placeholder="Informe o outro local de retirada" value={operationExperienceDraft.pickup_other_location} onChange={(e)=>updateOperationExperienceDraft("pickup_other_location",e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">É necessário agendar?</div><ChoiceButtonGroup value={operationExperienceDraft.pickup_requires_appointment} onChange={(value)=>updateOperationExperienceDraft("pickup_requires_appointment",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"}]} /></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quem pode retirar?</div><ChoiceButtonGroup value={operationExperienceDraft.pickup_third_party_allowed} onChange={(value)=>updateOperationExperienceDraft("pickup_third_party_allowed",value)} options={[{value:"comprador",label:"Somente comprador"},{value:"autorizado",label:"Comprador ou pessoa autorizada"}]} /></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que deve estar confirmado antes de liberar a retirada?</div><MultiSelectBoxGroup values={operationExperienceDraft.pickup_release_gates} onToggle={(value)=>toggleOperationExperienceArrayValue("pickup_release_gates",value)} options={[{value:"pagamento",label:"Pagamento confirmado"},{value:"separado",label:"Produto separado/pronto"},{value:"identificacao",label:"Documento/identificação"},{value:"autorizacao",label:"Autorização quando terceiro"},{value:"outro",label:"Outro"}]} />{operationExperienceDraft.pickup_release_gates.includes("outro") ? <RequiredOperationDetailField label="Qual é o outro requisito para liberar a retirada?" value={operationExperienceDraft.pickup_release_gates_other} onChange={(value)=>updateOperationExperienceDraft("pickup_release_gates_other",value)} placeholder="Especifique o requisito adicional." /> : null}</div><textarea placeholder="Observações da retirada" value={operationExperienceDraft.pickup_notes} onChange={(e)=>updateOperationExperienceDraft("pickup_notes",e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></fieldset> : null}</div> : <SummaryList items={buildBulletRows([{label:"Permite retirada",value:savedOperationExperience.pickup_enabled},{label:"Itens",value:savedOperationExperience.pickup_items.length ? `${savedOperationExperience.pickup_items.length} categoria(s)` : "Não definido"},{label:"Agendamento",value:savedOperationExperience.pickup_requires_appointment || "Não definido"}])} />}
          </SectionBlock>

          <SectionBlock
            title="Serviços técnicos e manutenção"
            description="Defina quais serviços técnicos a loja executa além da instalação de piscinas e em quais equipamentos trabalha."
            tone={technicalServicesCardIsComplete ? "blue" : "yellow"}
            status={technicalServicesCardIsComplete ? "Completo" : "Precisa de atenção"}
            className={operationEditTarget === "technical_services" ? "xl:col-span-2" : ""}
            actions={operationEditTarget === "technical_services" ? <><button type="button" onClick={()=>void saveTechnicalServicesConfigurationCard()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget(null);}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={()=>{setOperationExperienceDraft(savedOperationExperience);setOperationEditTarget("technical_services");}} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {operationEditTarget === "technical_services" ? <div className="space-y-4"><label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja realiza serviços técnicos além da instalação de piscinas?</span><ChoiceButtonGroup value={operationExperienceDraft.technical_services_enabled} onChange={(value)=>updateOperationExperienceDraft("technical_services_enabled",value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></label>{operationExperienceDraft.technical_services_enabled !== "Não" ? <fieldset disabled={operationExperienceDraft.technical_services_enabled !== "Sim"} className={operationExperienceDraft.technical_services_enabled === "Sim" ? "space-y-4" : "space-y-4 opacity-45"}><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais serviços a loja realiza?</div><MultiSelectBoxGroup values={operationExperienceDraft.technical_service_types} onToggle={(value)=>toggleOperationExperienceArrayValue("technical_service_types",value)} options={[{value:"limpeza",label:"Limpeza / manutenção de piscina"},{value:"agua",label:"Tratamento da água"},{value:"diagnostico",label:"Diagnóstico técnico"},{value:"reparo",label:"Reparo de equipamentos"},{value:"instalacao_equipamento",label:"Instalação de equipamento novo"},{value:"troca_equipamento",label:"Substituição de equipamento existente"},{value:"outro",label:"Outro serviço"}]} />{operationExperienceDraft.technical_service_types.includes("outro") ? <RequiredOperationDetailField label="Qual outro serviço a loja realiza?" value={operationExperienceDraft.technical_services_other} onChange={(value)=>updateOperationExperienceDraft("technical_services_other",value)} placeholder="Especifique o outro serviço técnico ou de manutenção." /> : null}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais equipamentos a loja trabalha?</div><MultiSelectBoxGroup values={operationExperienceDraft.technical_equipment_types} onToggle={(value)=>toggleOperationExperienceArrayValue("technical_equipment_types",value)} columns="md:grid-cols-3" options={[{value:"bombas",label:"Bombas"},{value:"filtros",label:"Filtros"},{value:"aquecedores",label:"Aquecedores"},{value:"iluminacao",label:"Iluminação"},{value:"automacao",label:"Automação"},{value:"cascata_hidro",label:"Cascatas / hidromassagem"},{value:"outros",label:"Outros"}]} />{operationExperienceDraft.technical_equipment_types.includes("outros") ? <RequiredOperationDetailField label="Quais outros equipamentos?" value={operationExperienceDraft.technical_equipment_other} onChange={(value)=>updateOperationExperienceDraft("technical_equipment_other",value)} placeholder="Especifique os outros equipamentos atendidos pela loja." /> : null}</div>{operationExperienceDraft.technical_service_types.includes("instalacao_equipamento") ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O equipamento precisa ter sido vendido pela loja?</div><ChoiceButtonGroup value={operationExperienceDraft.equipment_installation_origin_policy} onChange={(value)=>updateOperationExperienceDraft("equipment_installation_origin_policy",value)} options={[{value:"somente_loja",label:"Sim, apenas equipamento vendido pela loja"},{value:"tambem_cliente",label:"Não, também instala equipamento comprado pelo cliente"},{value:"depende",label:"Depende do equipamento"}]} />{operationExperienceDraft.equipment_installation_origin_policy === "depende" ? <RequiredOperationDetailField label="De quais equipamentos depende?" value={operationExperienceDraft.equipment_installation_origin_rule} onChange={(value)=>updateOperationExperienceDraft("equipment_installation_origin_rule",value)} placeholder="Explique quais equipamentos comprados fora da loja podem ou não ser instalados." /> : null}</div> : null}{operationExperienceDraft.technical_service_types.includes("troca_equipamento") ? <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja substitui equipamentos que o cliente já possui há algum tempo?</div><ChoiceButtonGroup value={operationExperienceDraft.equipment_replacement_existing} onChange={(value)=>updateOperationExperienceDraft("equipment_replacement_existing",value)} options={[{value:"Sim",label:"Sim"},{value:"Não",label:"Não"},{value:"caso_a_caso",label:"Caso a caso"}]} />{operationExperienceDraft.equipment_replacement_existing === "caso_a_caso" ? <RequiredOperationDetailField label="Em quais casos a loja faz a substituição?" value={operationExperienceDraft.equipment_replacement_existing_rule} onChange={(value)=>updateOperationExperienceDraft("equipment_replacement_existing_rule",value)} placeholder="Explique os casos em que a loja aceita substituir o equipamento existente." /> : null}</div> : null}<textarea placeholder="Regras, limites e observações dos serviços técnicos" value={operationExperienceDraft.technical_services_notes} onChange={(e)=>updateOperationExperienceDraft("technical_services_notes",e.target.value)} rows={4} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"/></fieldset> : null}</div> : <SummaryList items={buildBulletRows([{label:"Realiza serviços técnicos",value:savedOperationExperience.technical_services_enabled},{label:"Serviços",value:savedOperationExperience.technical_service_types.length ? `${savedOperationExperience.technical_service_types.length} configurado(s)` : "Não definidos"},{label:"Equipamentos",value:savedOperationExperience.technical_equipment_types.length ? `${savedOperationExperience.technical_equipment_types.length} tipo(s)` : "Não definidos"}])} />}
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "comercial" ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-2 [&>section]:h-full [&>section]:self-stretch">
          <SectionBlock
            title="O que a loja vende e oferece"
            description="Defina as categorias de produtos e serviços que fazem parte da operação da loja. Isso estabelece o escopo comercial geral sem substituir o catálogo real."
            tone={canonicalCommercialExperience.offering_products.length > 0 || canonicalCommercialExperience.offering_services.length > 0 ? "blue" : "yellow"}
            status={canonicalCommercialExperience.offering_products.length > 0 || canonicalCommercialExperience.offering_services.length > 0 ? "Completo" : "Precisa de atenção"}
            className={strategyEditTarget === "offerings" ? "xl:col-span-2" : ""}
            actions={strategyEditTarget === "offerings" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("offerings")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(canonicalCommercialExperience); setStrategyEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(canonicalCommercialExperience); setStrategyEditTarget("offerings"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {strategyEditTarget === "offerings" ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais tipos de produtos sua loja vende?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Marque as linhas que fazem parte da operação. Isso não significa que todo produto dessa categoria está disponível; a disponibilidade concreta continua vindo do catálogo e do estado real do item.</p>
                  <MultiSelectBoxGroup values={commercialExperienceDraft.offering_products} onToggle={(value) => toggleCommercialExperienceArrayValue("offering_products", value)} options={STORE_OFFERED_PRODUCT_OPTIONS} columns="md:grid-cols-3" />
                  {commercialExperienceDraft.offering_products.includes("outro") ? <RequiredOperationDetailField label="Quais outros produtos a loja vende?" value={commercialExperienceDraft.offering_products_other} onChange={(value) => updateCommercialExperienceDraft("offering_products_other", value)} placeholder="Especifique as outras linhas de produtos vendidas pela loja." /> : null}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais serviços sua loja oferece?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Marque apenas serviços que a loja realmente presta. As regras de como cada serviço funciona continuam sendo definidas em Operação.</p>
                  <MultiSelectBoxGroup values={commercialExperienceDraft.offering_services} onToggle={(value) => toggleCommercialExperienceArrayValue("offering_services", value)} options={STORE_OFFERED_SERVICE_OPTIONS} columns="md:grid-cols-2" />
                  {commercialExperienceDraft.offering_services.includes("outro") ? <RequiredOperationDetailField label="Quais outros serviços a loja oferece?" value={commercialExperienceDraft.offering_services_other} onChange={(value) => updateCommercialExperienceDraft("offering_services_other", value)} placeholder="Especifique os outros serviços prestados pela loja." /> : null}
                </div>
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">Esta configuração define o escopo comercial geral da loja. O catálogo continua sendo a fonte dos produtos concretos, preços, estoque e disponibilidade; Operação continua sendo a fonte de como os serviços são executados.</div>
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Tipos de produtos vendidos", value: joinSelectedLabels(canonicalCommercialExperience.offering_products, STORE_OFFERED_PRODUCT_OPTIONS, canonicalCommercialExperience.offering_products_other) || "Não definido" },
              { label: "Serviços oferecidos", value: joinSelectedLabels(canonicalCommercialExperience.offering_services, STORE_OFFERED_SERVICE_OPTIONS, canonicalCommercialExperience.offering_services_other) || "Não definido" },
              { label: "Disponibilidade concreta", value: "Continua vindo do catálogo e das fontes vivas" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Estratégia comercial"
            description="Defina o que a loja quer priorizar, quais tipos de negócio merecem mais esforço comercial e quais atendimentos a loja prefere não perseguir. Essas preferências orientam a atuação da IA sem limitar produtos, serviços ou oportunidades válidas."
            tone={savedCommercialExperience.strategy_sell_more.length > 0 && savedCommercialExperience.strategy_priority_deal_types.length > 0 && savedCommercialExperience.strategy_avoid_cases.length > 0 && (savedCommercialExperience.strategy_avoid_cases.includes("nenhum") || cleanText(savedCommercialExperience.strategy_avoid_action)) && cleanText(savedCommercialExperience.strategy_sale_value_range) ? "blue" : "yellow"}
            status={savedCommercialExperience.strategy_sell_more.length > 0 && savedCommercialExperience.strategy_priority_deal_types.length > 0 && savedCommercialExperience.strategy_avoid_cases.length > 0 && (savedCommercialExperience.strategy_avoid_cases.includes("nenhum") || cleanText(savedCommercialExperience.strategy_avoid_action)) && cleanText(savedCommercialExperience.strategy_sale_value_range) ? "Completo" : "Precisa de atenção"}
            className={strategyEditTarget === "strategy" ? "xl:col-span-2" : ""}
            actions={strategyEditTarget === "strategy" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("strategy")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setStrategyEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setStrategyEditTarget("strategy"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {strategyEditTarget === "strategy" ? (
              <div className="space-y-6">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que sua loja quer priorizar nas vendas?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Marque as categorias gerais de produtos e serviços que a loja quer vender mais. Isso não impede a venda de outros itens que a loja realmente ofereça.</p>
                  <MultiSelectBoxGroup values={commercialExperienceDraft.strategy_sell_more} onToggle={(value) => toggleCommercialExperienceArrayValue("strategy_sell_more", value)} options={COMMERCIAL_SELL_MORE_OPTIONS} columns="md:grid-cols-3" />
                  {commercialExperienceDraft.strategy_sell_more.includes("outro") ? <RequiredOperationDetailField label="Qual é a outra prioridade comercial?" value={commercialExperienceDraft.strategy_sell_more_other} onChange={(value) => updateCommercialExperienceDraft("strategy_sell_more_other", value)} placeholder="Especifique o produto, serviço ou frente comercial que a loja quer priorizar." /> : null}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais tipos de negócio a loja quer colocar mais esforço comercial?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Marque as oportunidades que normalmente merecem mais atenção durante a venda. Isso orienta prioridade, não cria uma regra de exclusão.</p>
                  <MultiSelectBoxGroup values={commercialExperienceDraft.strategy_priority_deal_types} onToggle={(value) => toggleCommercialExperienceArrayValue("strategy_priority_deal_types", value)} options={COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS} columns="md:grid-cols-2" />
                  {commercialExperienceDraft.strategy_priority_deal_types.includes("outro") ? <RequiredOperationDetailField label="Qual outro tipo de negócio a loja quer priorizar?" value={commercialExperienceDraft.strategy_priority_deal_types_other} onChange={(value) => updateCommercialExperienceDraft("strategy_priority_deal_types_other", value)} placeholder="Explique de forma objetiva qual outro tipo de oportunidade merece mais esforço comercial." /> : null}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais tipos de atendimento ou negócio a loja prefere evitar ou não quer que a IA fique insistindo em fechar?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Marque situações concretas que costumam gerar desgaste, conflito ou esforço desproporcional. Essas opções devem ser usadas pelo comportamento observado no atendimento, não por características pessoais do cliente.</p>
                  <MultiSelectBoxGroup values={commercialExperienceDraft.strategy_avoid_cases} onToggle={(value) => toggleCommercialExperienceArrayValue("strategy_avoid_cases", value)} options={COMMERCIAL_AVOID_CASE_OPTIONS} columns="md:grid-cols-2" />
                  {commercialExperienceDraft.strategy_avoid_cases.includes("outro") ? <RequiredOperationDetailField label="Qual outro tipo de atendimento ou negócio a loja prefere evitar?" value={commercialExperienceDraft.strategy_avoid_cases_other} onChange={(value) => updateCommercialExperienceDraft("strategy_avoid_cases_other", value)} placeholder="Descreva a situação de forma objetiva e observável." /> : null}
                </div>

                {!commercialExperienceDraft.strategy_avoid_cases.includes("nenhum") && commercialExperienceDraft.strategy_avoid_cases.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando um atendimento se encaixar em um desses casos, o que a IA deve fazer?</div>
                    <p className="mb-2 text-xs leading-5 text-gray-500">Essa regra define a postura comercial padrão da IA nesses casos. Ela não autoriza tratamento inadequado nem substitui regras de segurança, autoridade ou atendimento humano.</p>
                    <ChoiceButtonGroup value={commercialExperienceDraft.strategy_avoid_action} onChange={(value) => updateCommercialExperienceDraft("strategy_avoid_action", value)} options={COMMERCIAL_AVOID_ACTION_OPTIONS} />
                  </div>
                ) : null}

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual costuma ser o valor total das vendas da loja?</div>
                  <p className="mb-2 text-xs leading-5 text-gray-500">Considere o valor total normalmente pago pelo cliente em uma venda, incluindo os itens e serviços que costumam fazer parte do negócio.</p>
                  <ChoiceButtonGroup value={commercialExperienceDraft.strategy_sale_value_range} onChange={(value) => updateCommercialExperienceDraft("strategy_sale_value_range", value)} options={COMMERCIAL_SALE_VALUE_OPTIONS} />
                  {["outra", "varia_muito"].includes(commercialExperienceDraft.strategy_sale_value_range) ? <RequiredOperationDetailField label={commercialExperienceDraft.strategy_sale_value_range === "varia_muito" ? "Como o valor das vendas costuma variar?" : "Qual é a outra faixa de valor?"} value={commercialExperienceDraft.strategy_sale_value_custom} onChange={(value) => updateCommercialExperienceDraft("strategy_sale_value_custom", value)} placeholder={commercialExperienceDraft.strategy_sale_value_range === "varia_muito" ? "Explique de forma simples de que fatores o valor normalmente depende." : "Informe a faixa de valor normalmente praticada."} /> : null}
                </div>
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Prioridades de venda", value: joinSelectedLabels(savedCommercialExperience.strategy_sell_more, COMMERCIAL_SELL_MORE_OPTIONS, savedCommercialExperience.strategy_sell_more_other) || "Não definido" },
              { label: "Tipos de negócio prioritários", value: joinSelectedLabels(savedCommercialExperience.strategy_priority_deal_types, COMMERCIAL_PRIORITY_DEAL_TYPE_OPTIONS, savedCommercialExperience.strategy_priority_deal_types_other) || "Não definido" },
              { label: "Atendimentos que a loja prefere evitar", value: savedCommercialExperience.strategy_avoid_cases.includes("nenhum") ? "Nenhum caso específico" : joinSelectedLabels(savedCommercialExperience.strategy_avoid_cases, COMMERCIAL_AVOID_CASE_OPTIONS, savedCommercialExperience.strategy_avoid_cases_other) || "Não definido" },
              { label: "Ação da IA nesses casos", value: savedCommercialExperience.strategy_avoid_cases.includes("nenhum") ? "Não se aplica" : savedCommercialExperience.strategy_avoid_action ? optionLabel(savedCommercialExperience.strategy_avoid_action, COMMERCIAL_AVOID_ACTION_OPTIONS) : "Não definido" },
              { label: "Valor típico das vendas", value: savedCommercialExperience.strategy_sale_value_range ? (["outra", "varia_muito"].includes(savedCommercialExperience.strategy_sale_value_range) ? (savedCommercialExperience.strategy_sale_value_range === "varia_muito" ? `Varia conforme a venda${cleanText(savedCommercialExperience.strategy_sale_value_custom) ? ` • ${savedCommercialExperience.strategy_sale_value_custom}` : ""}` : savedCommercialExperience.strategy_sale_value_custom) : optionLabel(savedCommercialExperience.strategy_sale_value_range, COMMERCIAL_SALE_VALUE_OPTIONS)) : "Não definido" },
            ])} />}
          </SectionBlock>
          <SectionBlock
            title="Marcas trabalhadas e preferência"
            description="Defina a marca principal, as demais marcas que fazem parte da operação e, quando houver mais de uma opção adequada e disponível, quais marcas podem receber preferência. A lista de marcas não cria estoque nem disponibilidade."
            tone={canonicalCommercialExperience.brands_worked.length > 0 ? "blue" : "yellow"}
            status={canonicalCommercialExperience.brands_worked.length > 0 ? "Completo" : "Precisa de atenção"}
            className={strategyEditTarget === "brands" ? "xl:col-span-2" : ""}
            actions={strategyEditTarget === "brands" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("brands")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(canonicalCommercialExperience); setStrategyEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(canonicalCommercialExperience); setStrategyEditTarget("brands"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {strategyEditTarget === "brands" ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja trabalha com uma marca principal?</div>
                  <ChoiceButtonGroup
                    value={commercialExperienceDraft.brands_has_main}
                    onChange={(value) => updateCommercialExperienceDraft("brands_has_main", value)}
                    options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]}
                  />
                </div>

                {commercialExperienceDraft.brands_has_main === "Sim" ? (
                  <div className="space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual é a marca principal?</span>
                      <select
                        value={commercialExperienceDraft.brands_main_choice}
                        onChange={(event) => updateCommercialExperienceDraft("brands_main_choice", event.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-black"
                      >
                        <option value="">Selecione uma marca</option>
                        {POOL_MARKET_BRAND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    {commercialExperienceDraft.brands_main_choice === "outro" ? (
                      <RequiredOperationDetailField
                        label="Qual é a outra marca principal?"
                        value={commercialExperienceDraft.brands_main_other}
                        onChange={(value) => updateCommercialExperienceDraft("brands_main_other", value)}
                        placeholder="Informe a marca principal da loja."
                      />
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais outras marcas sua loja trabalha?</div>
                  <p className="mb-3 text-xs leading-5 text-gray-500">Adicione uma marca por vez. Esta lista informa quais marcas fazem parte da operação; disponibilidade real continua vindo do catálogo, estoque e fontes vivas.</p>
                  <RepeatableBrandSelect
                    values={commercialExperienceDraft.brands_worked}
                    onChange={(values) => updateCommercialExperienceDraft("brands_worked", values)}
                    options={POOL_MARKET_BRAND_OPTIONS.filter((option) => option.value === "outro" || option.value !== commercialExperienceDraft.brands_main_choice)}
                    addLabel="Adicionar mais uma marca"
                    selectPlaceholder="Selecione uma marca"
                  />
                  {commercialExperienceDraft.brands_worked.includes("outro") ? (
                    <RequiredOperationDetailField
                      label="Qual é a outra marca?"
                      value={commercialExperienceDraft.brands_worked_other}
                      onChange={(value) => updateCommercialExperienceDraft("brands_worked_other", value)}
                      placeholder="Informe a marca que não aparece na lista. Se houver mais de uma, separe por vírgulas."
                    />
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando houver mais de uma opção adequada e disponível, existe alguma marca que a loja prefere oferecer primeiro?</div>
                  <ChoiceButtonGroup
                    value={commercialExperienceDraft.brands_priority_enabled}
                    onChange={(value) => updateCommercialExperienceDraft("brands_priority_enabled", value)}
                    options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não, escolha conforme a necessidade do cliente" }]}
                  />
                  {commercialExperienceDraft.brands_priority_enabled === "Sim" ? (
                    <div className="mt-3 space-y-3">
                      <p className="text-xs leading-5 text-gray-500">Adicione as marcas preferidas em ordem de prioridade. A preferência só vale entre opções realmente adequadas e disponíveis.</p>
                      <RepeatableBrandSelect
                        values={commercialExperienceDraft.brands_priority}
                        onChange={(values) => updateCommercialExperienceDraft("brands_priority", values)}
                        addLabel="Adicionar mais uma marca preferida"
                        selectPlaceholder="Selecione uma marca preferida"
                        options={POOL_MARKET_BRAND_OPTIONS.filter((option) =>
                          option.value === "outro" ||
                          option.value === commercialExperienceDraft.brands_main_choice ||
                          commercialExperienceDraft.brands_worked.includes(option.value)
                        )}
                      />
                      {commercialExperienceDraft.brands_priority.includes("outro") ? (
                        <RequiredOperationDetailField
                          label="Qual é a outra marca preferida?"
                          value={commercialExperienceDraft.brands_priority_other}
                          onChange={(value) => updateCommercialExperienceDraft("brands_priority_other", value)}
                          placeholder="Informe a marca que pode receber preferência."
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Marca principal", value: canonicalCommercialExperience.brands_has_main === "Não" ? "Não usa marca principal" : canonicalCommercialExperience.brands_main_choice ? (canonicalCommercialExperience.brands_main_choice === "outro" ? canonicalCommercialExperience.brands_main_other : canonicalCommercialExperience.brands_main_choice) : "Não definida" },
              { label: "Marcas trabalhadas", value: joinSelectedLabels(canonicalCommercialExperience.brands_worked.filter((item) => cleanText(item) && item !== "outro"), POOL_MARKET_BRAND_OPTIONS, canonicalCommercialExperience.brands_worked.includes("outro") ? canonicalCommercialExperience.brands_worked_other : "") || "Não definidas" },
              { label: "Preferência entre opções válidas", value: canonicalCommercialExperience.brands_priority_enabled === "Sim" ? (canonicalCommercialExperience.brands_priority.filter((item) => cleanText(item)).length ? canonicalCommercialExperience.brands_priority.filter((item) => cleanText(item)).map((item) => item === "outro" ? canonicalCommercialExperience.brands_priority_other : item).filter(Boolean).join(" → ") : "Não definida") : canonicalCommercialExperience.brands_priority_enabled === "Não" ? "Sem preferência fixa" : "Não definido" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Orientações comerciais para a IA"
            description="Registre somente uma orientação comercial adicional da loja que não esteja coberta pelas outras configurações. As regras de segurança, verdade, autoridade e funcionamento do ZION continuam sempre ativas e prevalecem em qualquer conflito."
            tone={savedCommercialExperience.ai_guidance_enabled === "Não definido" ? "yellow" : "blue"}
            status={savedCommercialExperience.ai_guidance_enabled === "Não definido" ? "Precisa de atenção" : "Completo"}
            className={strategyEditTarget === "ai" ? "xl:col-span-2" : ""}
            actions={strategyEditTarget === "ai" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("ai")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setStrategyEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setStrategyEditTarget("ai"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {strategyEditTarget === "ai" ? <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe alguma orientação específica da loja que a IA precisa considerar durante uma venda?</div>
                <ChoiceButtonGroup value={commercialExperienceDraft.ai_guidance_enabled} onChange={(value) => updateCommercialExperienceDraft("ai_guidance_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
              </div>
              {commercialExperienceDraft.ai_guidance_enabled === "Sim" ? <RequiredOperationDetailField label="Qual orientação comercial adicional a IA deve considerar?" value={commercialExperienceDraft.ai_guidance_other} onChange={(value) => updateCommercialExperienceDraft("ai_guidance_other", value)} placeholder="Descreva somente uma particularidade real da loja que não esteja coberta nas outras configurações. Esta orientação não pode alterar regras universais do ZION nem criar produto, preço, estoque, disponibilidade, desconto, prazo ou autorização." rows={4} /> : null}
              <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">Comportamentos como informar corretamente que um item é sob encomenda, respeitar quando a instalação é opcional e explicar dependências reais de visita técnica não são opcionais: quando essas condições forem verdadeiras nas fontes do sistema, a IA deve respeitá-las automaticamente. Sugestões de alternativas ficam no card “Sugestões comerciais”.</div>
            </div> : <SummaryList items={buildBulletRows([
              { label: "Orientação adicional", value: savedCommercialExperience.ai_guidance_enabled === "Sim" ? summarizeMetricText(savedCommercialExperience.ai_guidance_other, 110) || "Não definida" : savedCommercialExperience.ai_guidance_enabled === "Não" ? "Nenhuma orientação adicional" : "Não definido" },
              { label: "Regras do ZION", value: "Continuam sempre ativas" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Preços"
            description="Defina o que a IA pode informar quando um cliente pergunta preço e quais informações ela precisa entender quando o valor depende do projeto."
            tone={commercialAiSettings ? "blue" : "yellow"}
            status={commercialAiSettings ? "Completo" : "Precisa de atenção"}
            className={commercialEditTarget === "ai_price" ? "xl:col-span-2" : ""}
            actions={commercialEditTarget === "ai_price" ? <><button type="button" onClick={() => void handleCommercialEditSave()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={handleCommercialEditCancel} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialEditTarget("ai_price"); setIsCommercialEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialEditTarget === "ai_price" ? <div className="space-y-4">
              <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando um cliente perguntar o preço de um produto, o que a IA pode fazer?</div><ChoiceButtonGroup value={commercialDraft.price_answer_policy} onChange={(value) => handleCommercialDraftChange("price_answer_policy", value)} options={PRICE_ANSWER_POLICY_OPTIONS} /></div>
              <div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Antes de falar um preço que depende do projeto, o que a IA precisa saber?</div><p className="mb-2 text-xs leading-5 text-gray-500">Um preço já cadastrado no catálogo é diferente de um valor que depende de medidas, instalação, visita ou outras condições do projeto.</p><MultiSelectBoxGroup values={commercialDraft.price_context_requirements} onToggle={handleCommercialPriceContextRequirementToggle} options={PRICE_CONTEXT_REQUIREMENT_OPTIONS} /><button type="button" onClick={() => updateCommercialExperienceDraft("price_context_other_enabled", !commercialExperienceDraft.price_context_other_enabled)} className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${commercialExperienceDraft.price_context_other_enabled ? "border-cyan-500 bg-cyan-50 text-cyan-950" : "border-gray-200 bg-white text-gray-700"}`}>Outro contexto necessário</button>{commercialExperienceDraft.price_context_other_enabled ? <RequiredOperationDetailField label="Qual outro contexto a IA precisa entender?" value={commercialExperienceDraft.price_context_other} onChange={(value) => updateCommercialExperienceDraft("price_context_other", value)} placeholder="Explique a informação adicional necessária antes de informar um preço que depende do projeto." /> : null}</div>
            </div> : <SummaryList items={commercialPriceItems} />}
          </SectionBlock>

          <SectionBlock
            title="Sugestões comerciais"
            description="Defina quais tipos de sugestões a IA pode fazer e, para produtos, escolha itens reais do catálogo. A IA continua sugerindo somente quando houver benefício e contexto adequados."
            tone={suggestionsCommercialConfigured ? "blue" : "yellow"}
            status={suggestionsCommercialConfigured ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "suggestions" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "suggestions" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("suggestions")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("suggestions"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "suggestions" ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA pode sugerir produtos ou serviços adicionais quando eles realmente fizerem sentido para o cliente?</div>
                  <ChoiceButtonGroup value={commercialExperienceDraft.suggestions_enabled} onChange={(value) => updateCommercialExperienceDraft("suggestions_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                </div>
                {commercialExperienceDraft.suggestions_enabled === "Sim" ? <>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Que tipos de itens ou serviços ela pode sugerir?</div>
                    <p className="mb-2 text-xs leading-5 text-gray-500">Ao marcar uma categoria de produto, escolha abaixo os itens reais já cadastrados. Isso evita que uma preferência manual crie um produto que não existe no catálogo.</p>
                    <MultiSelectBoxGroup values={commercialExperienceDraft.suggestion_types} onToggle={(value) => toggleCommercialExperienceArrayValue("suggestion_types", value)} options={COMMERCIAL_SUGGESTION_TYPE_OPTIONS} />
                    {commercialExperienceDraft.suggestion_types.includes("servicos") ? <RequiredOperationDetailField label="Quais serviços relacionados a IA pode sugerir?" value={commercialExperienceDraft.suggestion_services_detail} onChange={(value) => updateCommercialExperienceDraft("suggestion_services_detail", value)} placeholder="Ex.: instalação, manutenção preventiva ou visita técnica, quando fizerem sentido para a necessidade do cliente." rows={3} /> : null}
                    {commercialExperienceDraft.suggestion_types.includes("outro") ? <RequiredOperationDetailField label="Qual é o outro tipo de sugestão?" value={commercialExperienceDraft.suggestion_other} onChange={(value) => updateCommercialExperienceDraft("suggestion_other", value)} placeholder="Especifique o outro tipo de complemento ou serviço." /> : null}
                  </div>

                  {CATALOG_BACKED_SUGGESTION_TYPES.filter((type) => commercialExperienceDraft.suggestion_types.includes(type)).map((type) => {
                    const itemsForType = catalogSuggestionItems.filter((item) => item.category === type);
                    const typeLabel = optionLabel(type, COMMERCIAL_SUGGESTION_TYPE_OPTIONS);
                    const selectedKeysForType = commercialExperienceDraft.suggestion_catalog_item_keys.filter((key) => itemsForType.some((item) => item.key === key));
                    const remainingKeys = commercialExperienceDraft.suggestion_catalog_item_keys.filter((key) => !itemsForType.some((item) => item.key === key));
                    return (
                      <div key={type} className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
                        <div className="text-sm font-semibold text-gray-950">{typeLabel}</div>
                        <p className="mt-1 text-xs leading-5 text-gray-500">Escolha os itens desta categoria usando uma lista por vez. Assim a configuração fica mais enxuta mesmo quando existir muita opção no catálogo.</p>
                        {itemsForType.length > 0 ? (
                          <div className="mt-3">
                            <RepeatableBrandSelect
                              values={selectedKeysForType}
                              onChange={(values) => updateCommercialExperienceDraft("suggestion_catalog_item_keys", [...remainingKeys, ...values.filter((value) => cleanText(value))])}
                              options={itemsForType.map((item) => ({ value: item.key, label: item.label }))}
                              addLabel={`Adicionar mais um item de ${typeLabel.toLowerCase()}`}
                              selectPlaceholder={`Selecione um item de ${typeLabel.toLowerCase()}`}
                            />
                          </div>
                        ) : (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                            <div className="font-semibold">Nenhum item ativo dessa categoria foi encontrado no catálogo.</div>
                            <div className="mt-1 text-xs leading-5">Cadastre ou importe o catálogo antes de concluir esta seleção.</div>
                            <button type="button" onClick={() => setActiveTab("catalogo")} className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-950">Ir para Catálogo</button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA pode mostrar uma opção melhor ou mais completa do que a que o cliente pediu?</div>
                    <ChoiceButtonGroup value={commercialExperienceDraft.better_option_policy} onChange={(value) => updateCommercialExperienceDraft("better_option_policy", value)} options={[{ value: "beneficio", label: "Sim, quando houver benefício claro para o cliente" }, { value: "se_pedir", label: "Somente se o cliente pedir alternativas" }, { value: "nao", label: "Não" }]} />
                  </div>
                  <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">Selecionar um item aqui não garante estoque nem disponibilidade. No atendimento real, a IA ainda precisa validar o catálogo e as fontes vivas antes de oferecer qualquer opção.</div>
                </> : null}
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Sugestões complementares", value: savedCommercialExperience.suggestions_enabled === "Sim" ? "Permitidas quando fizerem sentido" : savedCommercialExperience.suggestions_enabled === "Não" ? "Não permitidas" : "Não definido" },
              { label: "Tipos de sugestão", value: savedCommercialExperience.suggestion_types.length ? `${savedCommercialExperience.suggestion_types.length} tipo(s)` : "Não definido" },
              { label: "Itens específicos do catálogo", value: savedCommercialExperience.suggestion_catalog_item_keys.length ? `${savedCommercialExperience.suggestion_catalog_item_keys.length} item(ns) selecionado(s)` : savedCommercialExperience.suggestions_enabled === "Sim" ? "Nenhum selecionado" : "Não se aplica" },
              { label: "Opção mais completa", value: savedCommercialExperience.better_option_policy ? optionLabel(savedCommercialExperience.better_option_policy, [{ value: "beneficio", label: "Quando houver benefício claro" }, { value: "se_pedir", label: "Somente quando o cliente pedir" }, { value: "nao", label: "Não oferecer" }]) : "Não definido" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Meta mensal"
            description="Defina se a loja trabalha com uma meta de vendas por mês e qual valor o Dashboard deve usar."
            tone={monthlySalesGoal.enabled ? "blue" : "yellow"}
            status={monthlySalesGoal.enabled ? "Configurada" : "Precisa de atenção"}
            className={isMonthlySalesGoalEditing ? "xl:col-span-2" : ""}
            actions={isMonthlySalesGoalEditing ? <><button type="button" onClick={() => void handleMonthlySalesGoalSave()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setMonthlySalesGoalDraft(monthlySalesGoal); setIsMonthlySalesGoalEditing(false); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setMonthlySalesGoalDraft(monthlySalesGoal); setIsMonthlySalesGoalEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {isMonthlySalesGoalEditing ? <div className="space-y-4"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Sua loja trabalha com uma meta de vendas por mês?</div><ChoiceButtonGroup value={monthlySalesGoalDraft.enabled ? "Sim" : "Não"} onChange={(value) => setMonthlySalesGoalDraft((current) => ({ ...current, enabled: value === "Sim", amountCents: value === "Sim" ? current.amountCents : null }))} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{monthlySalesGoalDraft.enabled ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual é a meta de vendas do mês? (R$)</span><input value={formatMonthlyGoalDraftAmount(monthlySalesGoalDraft.amountCents)} onChange={(e) => setMonthlySalesGoalDraft((current) => ({ ...current, amountCents: parseMonthlyGoalDraftAmount(e.target.value) }))} inputMode="numeric" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}</div> : <SummaryList items={buildBulletRows([{ label: "Usa meta mensal", value: monthlySalesGoal.enabled ? "Sim" : "Não" }, { label: "Meta", value: monthlySalesGoal.enabled && monthlySalesGoal.amountCents ? `R$ ${(monthlySalesGoal.amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "Não se aplica" }])} />}
          </SectionBlock>

          <SectionBlock
            title="Pagamentos"
            description="Defina quais formas de pagamento a loja aceita e como funcionam Pix, parcelamento e financiamento. As regras de entrada e liberação do pedido ficam no próximo bloco."
            tone={commercialPaymentCardStatus.tone}
            status={commercialPaymentCardStatus.status}
            className={commercialEditTarget === "payments" ? "xl:col-span-2" : ""}
            actions={commercialEditTarget === "payments" ? <><button type="button" onClick={() => void handleCommercialEditSave()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={handleCommercialEditCancel} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialEditTarget("payments"); setIsCommercialEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialEditTarget === "payments" ? <div className="space-y-6">
              <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais formas de pagamento sua loja aceita?</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{PAYMENT_METHOD_MAIN_OPTIONS.map((option) => { const selected = commercialDraft.accepted_payment_methods.includes(option.value); return <button key={option.value} type="button" onClick={() => handleCommercialPaymentMethodToggle(option.value)} className={`rounded-xl border px-3 py-2.5 text-sm transition ${selected ? "border-cyan-500 bg-cyan-50 text-cyan-950" : "border-gray-200 bg-white text-gray-700"}`}>{option.label}</button>; })}<button type="button" onClick={() => updateCommercialExperienceDraft("payment_other_enabled", !commercialExperienceDraft.payment_other_enabled)} className={`rounded-xl border px-3 py-2.5 text-sm transition ${commercialExperienceDraft.payment_other_enabled ? "border-cyan-500 bg-cyan-50 text-cyan-950" : "border-gray-200 bg-white text-gray-700"}`}>Outra forma</button></div>{commercialExperienceDraft.payment_other_enabled ? <RequiredOperationDetailField label="Qual é a outra forma de pagamento?" value={commercialExperienceDraft.payment_other_method} onChange={(value) => updateCommercialExperienceDraft("payment_other_method", value)} placeholder="Informe a outra forma de pagamento aceita." /> : null}</div>

              {commercialDraft.accepted_payment_methods.includes("pix") ? <div className="rounded-2xl border border-gray-200 p-4"><div className="mb-3 text-sm font-semibold text-gray-950">Pix</div><div className="grid gap-3 md:grid-cols-3"><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual tipo de chave Pix a loja usa?</span><select value={commercialDraft.pix_key_type} onChange={(e) => handleCommercialDraftChange("pix_key_type", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm">{PIX_KEY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Chave Pix</span><input value={commercialDraft.pix_key} onChange={(e) => handleCommercialDraftChange("pix_key", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome do titular</span><input value={commercialDraft.pix_holder_name} onChange={(e) => handleCommercialDraftChange("pix_holder_name", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label></div></div> : null}


              <div className="rounded-2xl border border-gray-200 p-4"><div className="mb-3 text-sm font-semibold text-gray-950">Parcelamento</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja aceita parcelamento?</div><ChoiceButtonGroup value={commercialDraft.installments_enabled} onChange={(value) => handleCommercialDraftChange("installments_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{normalizeLoose(commercialDraft.installments_enabled) === "sim" ? <div className="mt-4 space-y-4"><label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em até quantas vezes?</span><input inputMode="numeric" value={commercialDraft.max_installments} onChange={(e) => handleCommercialDraftChange("max_installments", formatStorePaymentInstallmentsInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe parcelamento sem juros?</div><ChoiceButtonGroup value={commercialExperienceDraft.installments_interest_free_enabled} onChange={(value) => updateCommercialExperienceDraft("installments_interest_free_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{commercialExperienceDraft.installments_interest_free_enabled === "Sim" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Até quantas vezes sem juros?</span><input inputMode="numeric" value={commercialExperienceDraft.installments_interest_free_max} onChange={(e) => updateCommercialExperienceDraft("installments_interest_free_max", e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando houver juros, como eles são definidos?</div><ChoiceButtonGroup value={commercialExperienceDraft.installment_interest_above_mode} onChange={(value) => { updateCommercialExperienceDraft("installment_interest_above_mode", value); handleCommercialDraftChange("installment_interest_policy", value === "operadora" || value === "regra_propria" ? "with_interest" : "case_by_case"); }} options={[{ value: "operadora", label: "A operadora / cartão calcula" }, { value: "regra_propria", label: "A loja possui uma regra própria" }, { value: "depende", label: "Depende da condição" }, { value: "outro", label: "Outro" }]} /></div>{["regra_propria", "depende", "outro"].includes(commercialExperienceDraft.installment_interest_above_mode) ? <RequiredOperationDetailField label="Como funcionam os juros?" value={commercialExperienceDraft.installment_interest_above_rule} onChange={(value) => updateCommercialExperienceDraft("installment_interest_above_rule", value)} placeholder="Explique a regra de juros de forma simples." /> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe valor mínimo por parcela?</div><ChoiceButtonGroup value={commercialExperienceDraft.installment_minimum_enabled} onChange={(value) => updateCommercialExperienceDraft("installment_minimum_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{commercialExperienceDraft.installment_minimum_enabled === "Sim" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Valor mínimo por parcela (R$)</span><input value={commercialExperienceDraft.installment_minimum_amount} onChange={(e) => updateCommercialExperienceDraft("installment_minimum_amount", formatStorePaymentCurrencyInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}</div> : null}</div>

              {commercialDraft.accepted_payment_methods.includes("financiamento") ? <div className="rounded-2xl border border-gray-200 p-4"><div className="mb-3 text-sm font-semibold text-gray-950">Financiamento</div><div className="space-y-4"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como funciona o financiamento oferecido aos clientes?</div><ChoiceButtonGroup value={commercialExperienceDraft.financing_mode} onChange={(value) => updateCommercialExperienceDraft("financing_mode", value)} options={[{ value: "parceiro", label: "Banco / financeira parceira" }, { value: "loja", label: "Financiamento intermediado pela loja" }, { value: "cliente", label: "O próprio cliente busca o financiamento" }, { value: "depende", label: "Depende do caso" }, { value: "outro", label: "Outro" }]} /></div>{commercialExperienceDraft.financing_mode === "parceiro" ? <RequiredOperationDetailField label="Qual banco ou financeira parceira?" value={commercialExperienceDraft.financing_partner_name} onChange={(value) => updateCommercialExperienceDraft("financing_partner_name", value)} placeholder="Informe o nome da instituição ou parceiro." /> : null}{["depende", "outro"].includes(commercialExperienceDraft.financing_mode) ? <RequiredOperationDetailField label="Como funciona o financiamento nesse caso?" value={commercialExperienceDraft.financing_other} onChange={(value) => updateCommercialExperienceDraft("financing_other", value)} placeholder="Explique o fluxo de financiamento." /> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O financiamento depende de análise de crédito?</div><ChoiceButtonGroup value={commercialExperienceDraft.financing_credit_analysis} onChange={(value) => updateCommercialExperienceDraft("financing_credit_analysis", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }, { value: "depende", label: "Depende da instituição" }]} /></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quem faz a simulação?</div><ChoiceButtonGroup value={commercialExperienceDraft.financing_simulation_by} onChange={(value) => updateCommercialExperienceDraft("financing_simulation_by", value)} options={[{ value: "loja", label: "A loja" }, { value: "financeira", label: "Banco / financeira" }, { value: "cliente", label: "Cliente diretamente" }, { value: "outro", label: "Outro" }]} /></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a IA pode fazer quando o cliente perguntar sobre financiamento?</div><ChoiceButtonGroup value={commercialExperienceDraft.financing_ai_policy} onChange={(value) => updateCommercialExperienceDraft("financing_ai_policy", value)} options={[{ value: "explica", label: "Explicar somente as regras cadastradas" }, { value: "explica_chama", label: "Explicar as regras e chamar uma pessoa para a simulação" }, { value: "chama", label: "Chamar uma pessoa antes de falar detalhes" }]} /></div></div></div> : null}

              <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observação adicional sobre pagamentos</span><textarea value={commercialDraft.payment_notes} onChange={(e) => handleCommercialDraftChange("payment_notes", e.target.value)} rows={3} placeholder="Use apenas se existir uma regra importante que não ficou coberta pelas perguntas acima." className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
            </div> : <SummaryList items={commercialPaymentItems} />}
          </SectionBlock>

          <SectionBlock
            title="Entradas e liberação do pedido"
            description="Defina quando a entrada e o restante do valor precisam estar pagos e quais etapas do pedido só podem ser liberadas depois da confirmação do pagamento."
            tone={cleanText(savedCommercialExperience.balance_due_trigger) || savedCommercialExperience.payment_blocking_actions.length ? "blue" : "yellow"}
            status={cleanText(savedCommercialExperience.balance_due_trigger) || savedCommercialExperience.payment_blocking_actions.length ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "payment_blocks" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "payment_blocks" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("payment_blocks")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("payment_blocks"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "payment_blocks" ? <div className="space-y-5"><div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4"><div className="mb-3 text-sm font-semibold text-gray-950">Entrada</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja exige entrada em algum tipo de venda?</div><ChoiceButtonGroup value={commercialDraft.down_payment_mode} onChange={(value) => handleCommercialDraftChange("down_payment_mode", value)} options={DOWN_PAYMENT_MODE_OPTIONS} /></div>{["optional", "required"].includes(commercialDraft.down_payment_mode) ? <div className="mt-4 space-y-3"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a entrada é calculada?</div><ChoiceButtonGroup value={commercialDraft.down_payment_value_type} onChange={(value) => handleCommercialDraftChange("down_payment_value_type", value)} options={DOWN_PAYMENT_VALUE_TYPE_OPTIONS} /></div>{commercialDraft.down_payment_value_type === "percent" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual percentual da venda?</span><input value={commercialDraft.down_payment_percent} onChange={(e) => handleCommercialDraftChange("down_payment_percent", formatStorePaymentPercentInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}{commercialDraft.down_payment_value_type === "fixed" ? <label className="block space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual valor fixo? (R$)</span><input value={commercialDraft.down_payment_amount} onChange={(e) => handleCommercialDraftChange("down_payment_amount", formatStorePaymentCurrencyInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label> : null}{commercialDraft.down_payment_value_type === "case_by_case" ? <RequiredOperationDetailField label="Como a entrada é definida quando varia conforme a venda?" value={commercialExperienceDraft.down_payment_case_rule} onChange={(value) => updateCommercialExperienceDraft("down_payment_case_rule", value)} placeholder="Explique de quais fatores depende a entrada." /> : null}<div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se a loja exigir entrada, quando ela precisa estar paga?</div><ChoiceButtonGroup value={commercialExperienceDraft.entry_due_trigger} onChange={(value) => updateCommercialExperienceDraft("entry_due_trigger", value)} options={[{ value: "fechamento", label: "No fechamento da venda" }, { value: "antes_pedido", label: "Antes de encomendar o produto" }, { value: "antes_agendar", label: "Antes de agendar instalação" }, { value: "antes_iniciar", label: "Antes de iniciar instalação" }, { value: "outro", label: "Outro momento" }]} />{commercialExperienceDraft.entry_due_trigger === "outro" ? <RequiredOperationDetailField label="Quando a entrada precisa estar paga?" value={commercialExperienceDraft.entry_due_other} onChange={(value) => updateCommercialExperienceDraft("entry_due_other", value)} placeholder="Explique o momento em que a entrada precisa estar confirmada." /> : null}</div></div> : <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">Como a loja não exige entrada, as próximas regras deste bloco tratam apenas do restante do pagamento e da liberação do pedido.</div>}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando o restante do valor precisa estar pago?</div><ChoiceButtonGroup value={commercialExperienceDraft.balance_due_trigger} onChange={(value) => updateCommercialExperienceDraft("balance_due_trigger", value)} options={[{ value: "fechamento", label: "No fechamento da venda" }, { value: "antes_entrega", label: "Antes da entrega" }, { value: "antes_retirada", label: "Antes da retirada" }, { value: "antes_instalacao", label: "Antes de iniciar instalação" }, { value: "apos_instalacao", label: "Após a instalação" }, { value: "parcelas", label: "Conforme as parcelas acordadas" }, { value: "outro", label: "Outro momento" }]} />{commercialExperienceDraft.balance_due_trigger === "outro" ? <RequiredOperationDetailField label="Quando o restante precisa estar pago?" value={commercialExperienceDraft.balance_due_other} onChange={(value) => updateCommercialExperienceDraft("balance_due_other", value)} placeholder="Explique o momento ou regra de vencimento do saldo." /> : null}</div><div><div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Enquanto houver um pagamento obrigatório pendente, quais etapas do pedido devem ficar bloqueadas?</div><p className="mb-2 text-xs leading-5 text-gray-500">Marque as etapas que só podem ser liberadas depois da confirmação do pagamento. Se nenhuma delas depender disso, selecione a opção correspondente.</p><MultiSelectBoxGroup values={commercialExperienceDraft.payment_blocking_actions} onToggle={(value) => toggleCommercialExperienceArrayValue("payment_blocking_actions", value)} options={PAYMENT_BLOCKING_ACTION_OPTIONS} />{commercialExperienceDraft.payment_blocking_actions.includes("outro") ? <RequiredOperationDetailField label="Qual outra ação deve ficar bloqueada?" value={commercialExperienceDraft.payment_blocking_other} onChange={(value) => updateCommercialExperienceDraft("payment_blocking_other", value)} placeholder="Especifique a ação que não pode avançar." /> : null}</div></div> : <SummaryList items={buildBulletRows([{ label: "A loja exige entrada", value: optionLabel(commercialDraft.down_payment_mode, DOWN_PAYMENT_MODE_OPTIONS) || "Não definido" }, { label: "Quando a entrada precisa estar paga", value: commercialDraft.down_payment_mode === "disabled" ? "Não se aplica" : savedCommercialExperience.entry_due_trigger ? optionLabel(savedCommercialExperience.entry_due_trigger, [{ value: "fechamento", label: "No fechamento" }, { value: "antes_pedido", label: "Antes de encomendar" }, { value: "antes_agendar", label: "Antes de agendar instalação" }, { value: "antes_iniciar", label: "Antes de iniciar instalação" }, { value: "outro", label: savedCommercialExperience.entry_due_other || "Outro momento" }]) : "Não definido" }, { label: "Saldo precisa estar pago", value: savedCommercialExperience.balance_due_trigger ? optionLabel(savedCommercialExperience.balance_due_trigger, [{ value: "fechamento", label: "No fechamento" }, { value: "antes_entrega", label: "Antes da entrega" }, { value: "antes_retirada", label: "Antes da retirada" }, { value: "antes_instalacao", label: "Antes da instalação" }, { value: "apos_instalacao", label: "Após a instalação" }, { value: "parcelas", label: "Conforme parcelas" }, { value: "outro", label: savedCommercialExperience.balance_due_other || "Outro momento" }]) : "Não definido" }, { label: "Ações bloqueadas", value: savedCommercialExperience.payment_blocking_actions.length ? `${savedCommercialExperience.payment_blocking_actions.length} ação(ões)` : "Nenhuma definida" }])} />}
          </SectionBlock>

          <SectionBlock
            title="Descontos e aprovação"
            description="Defina quanto desconto pode ser usado numa negociação e quando uma pessoa da loja precisa aprovar."
            tone={discountSettings ? "blue" : "yellow"}
            status={discountSettings ? "Completo" : "Precisa de atenção"}
            className={isDiscountEditing ? "xl:col-span-2" : ""}
            actions={isDiscountEditing ? <><button type="button" onClick={() => void handleDiscountEditSave()} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { handleDiscountEditCancel(); setCommercialExperienceDraft(savedCommercialExperience); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setIsDiscountEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {isDiscountEditing ? <div className="space-y-5"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA está autorizada a negociar dando algum tipo de desconto?</div><ChoiceButtonGroup value={(Number.parseFloat(String(discountDraft.max_discount_percent || "0").replace(",", ".")) > 0 || Number.parseFloat(String(discountDraft.default_discount_percent || "0").replace(",", ".")) > 0) ? "Sim" : "Não"} onChange={handleDiscountNegotiationEnabledChange} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{(Number.parseFloat(String(discountDraft.max_discount_percent || "0").replace(",", ".")) > 0 || Number.parseFloat(String(discountDraft.default_discount_percent || "0").replace(",", ".")) > 0) ? <div className="space-y-5"><div className="grid items-start gap-4 md:grid-cols-2"><label className="flex h-full flex-col"><span className="min-h-8 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual desconto inicial a IA pode oferecer? (%)</span><input value={discountDraft.default_discount_percent} onChange={(e) => handleDiscountDraftChange("default_discount_percent", formatStoreDiscountPercentInput(e.target.value))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /><span className="mt-1.5 block text-xs leading-5 text-gray-500">A IA só usa esse percentual quando houver motivo real para negociar; ele não é oferecido automaticamente.</span></label><label className="flex h-full flex-col"><span className="min-h-8 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual é o limite máximo de desconto? (%)</span><input value={discountDraft.max_discount_percent} onChange={(e) => handleDiscountDraftChange("max_discount_percent", formatStoreDiscountPercentInput(e.target.value))} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /><span className="mt-1.5 block text-xs leading-5 text-gray-500">Acima deste limite, a IA não confirma um desconto usando a regra normal da loja.</span></label></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Dentro desse limite, a IA pode confirmar descontos sozinha?</div><ChoiceButtonGroup value={discountDraft.discount_autonomy_mode} onChange={(value) => handleDiscountDraftChange("discount_autonomy_mode", value)} options={[{ value: "within_limit", label: "Sim, dentro do limite permitido" }, { value: "guided", label: "Sim, mas deve negociar aos poucos" }, { value: "approval_required", label: "Não. Sempre precisa de aprovação" }]} /></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se o cliente pedir mais desconto do que o limite, a IA pode consultar uma pessoa da loja?</div><ChoiceButtonGroup value={discountDraft.allow_ask_above_max_discount ? "Sim" : "Não"} onChange={(value) => handleDiscountDraftChange("allow_ask_above_max_discount", value === "Sim")} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /><p className="mt-2 text-xs leading-5 text-gray-500">Se marcar “Não”, a IA informa que não pode confirmar um desconto acima do limite e continua a venda normalmente dentro das condições permitidas. Isso não encerra a negociação.</p></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Vendas de valor alto têm uma regra de desconto diferente?</div><ChoiceButtonGroup value={discountDraft.high_value_enabled ? "Sim" : "Não"} onChange={(value) => handleDiscountDraftChange("high_value_enabled", value === "Sim")} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>{discountDraft.high_value_enabled ? <div className="rounded-2xl border border-gray-200 p-4"><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A partir de qual valor uma venda é considerada de valor alto? (R$)</span><input value={discountDraft.high_value_threshold_amount} onChange={(e) => handleDiscountDraftChange("high_value_threshold_amount", formatStoreDiscountMoneyInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual desconto pode ser usado nessas vendas? (%)</span><input value={discountDraft.high_value_discount_percent} onChange={(e) => handleDiscountDraftChange("high_value_discount_percent", formatStoreDiscountPercentInput(e.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label></div><div className="mt-4"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse desconto precisa de aprovação humana?</div><ChoiceButtonGroup value={commercialExperienceDraft.high_value_requires_human} onChange={(value) => updateCommercialExperienceDraft("high_value_requires_human", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não, pode seguir a regra acima" }]} /></div></div> : null}</div> : <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">Com esta opção desligada, a IA não negocia usando desconto. Se um cliente insistir, o caso segue para análise humana.</div>}</div> : <SummaryList items={discountItems} />}
          </SectionBlock>

          <SectionBlock
            title="Orçamento"
            description="Defina as regras padrão dos novos orçamentos e como uma visita técnica obrigatória interfere no orçamento inicial e no orçamento final."
            tone={cleanText(savedCommercialExperience.quote_validity) && cleanText(savedCommercialExperience.quote_customer_note_enabled) && cleanText(savedCommercialExperience.quote_internal_note_enabled) && cleanText(savedCommercialExperience.quote_preliminary_before_visit) && cleanText(savedCommercialExperience.quote_definitive_requires_visit_result) ? "blue" : "yellow"}
            status={cleanText(savedCommercialExperience.quote_validity) && cleanText(savedCommercialExperience.quote_customer_note_enabled) && cleanText(savedCommercialExperience.quote_internal_note_enabled) && cleanText(savedCommercialExperience.quote_preliminary_before_visit) && cleanText(savedCommercialExperience.quote_definitive_requires_visit_result) ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "quote" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "quote" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("quote")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("quote"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "quote" ? (
              <div className="space-y-6">
                <div>
                  <div className="mb-3 text-sm font-semibold text-gray-950">Regras padrão do orçamento</div>
                  <div className="space-y-5">
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Por quantos dias um orçamento normalmente é válido?</div><ChoiceButtonGroup value={commercialExperienceDraft.quote_validity} onChange={(value) => updateCommercialExperienceDraft("quote_validity", value)} options={[{ value: "3", label: "3 dias" }, { value: "5", label: "5 dias" }, { value: "7", label: "7 dias" }, { value: "10", label: "10 dias" }, { value: "15", label: "15 dias" }, { value: "30", label: "30 dias" }, { value: "outro", label: "Outro prazo" }]} />{commercialExperienceDraft.quote_validity === "outro" ? <RequiredOperationDetailField label="Quantos dias?" value={commercialExperienceDraft.quote_validity_other_days} onChange={(value) => updateCommercialExperienceDraft("quote_validity_other_days", value.replace(/\D/g, ""))} placeholder="Informe o número de dias." /> : null}</div>
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe uma mensagem que deve aparecer em todos os orçamentos?</div><ChoiceButtonGroup value={commercialExperienceDraft.quote_customer_note_enabled} onChange={(value) => updateCommercialExperienceDraft("quote_customer_note_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />{commercialExperienceDraft.quote_customer_note_enabled === "Sim" ? <RequiredOperationDetailField label="Qual mensagem deve aparecer para o cliente?" value={commercialExperienceDraft.quote_customer_note} onChange={(value) => updateCommercialExperienceDraft("quote_customer_note", value)} placeholder="Informe a observação padrão destinada ao cliente." /> : null}</div>
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe alguma observação interna padrão para a equipe?</div><ChoiceButtonGroup value={commercialExperienceDraft.quote_internal_note_enabled} onChange={(value) => updateCommercialExperienceDraft("quote_internal_note_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />{commercialExperienceDraft.quote_internal_note_enabled === "Sim" ? <RequiredOperationDetailField label="Qual é a observação interna?" value={commercialExperienceDraft.quote_internal_note} onChange={(value) => updateCommercialExperienceDraft("quote_internal_note", value)} placeholder="Essa observação é interna e não é destinada ao cliente." /> : null}</div>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-5">
                  <div className="mb-1 text-sm font-semibold text-gray-950">Quando houver visita técnica obrigatória</div>
                  <p className="mb-4 text-xs leading-5 text-gray-500">Estas regras definem somente como a visita interfere no orçamento. As regras de quando a visita é necessária continuam em Operação.</p>
                  <div className="space-y-5">
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja pode enviar um orçamento inicial antes da visita?</div><ChoiceButtonGroup value={commercialExperienceDraft.quote_preliminary_before_visit} onChange={(value) => updateCommercialExperienceDraft("quote_preliminary_before_visit", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>
                    {commercialExperienceDraft.quote_preliminary_before_visit === "Sim" ? <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm leading-5 text-sky-950">O orçamento inicial deve deixar claro que valores ou condições que dependem da visita ainda podem mudar depois da avaliação técnica.</div> : null}
                    <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Para enviar o orçamento final, o resultado da visita precisa estar concluído?</div><ChoiceButtonGroup value={commercialExperienceDraft.quote_definitive_requires_visit_result} onChange={(value) => updateCommercialExperienceDraft("quote_definitive_requires_visit_result", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} /></div>
                  </div>
                </div>
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Validade padrão", value: savedCommercialExperience.quote_validity ? (savedCommercialExperience.quote_validity === "outro" ? `${savedCommercialExperience.quote_validity_other_days || "?"} dias` : `${savedCommercialExperience.quote_validity} dias`) : "Não definida" },
              { label: "Mensagem padrão ao cliente", value: savedCommercialExperience.quote_customer_note_enabled === "Sim" ? "Configurada" : savedCommercialExperience.quote_customer_note_enabled === "Não" ? "Não usa" : "Não definido" },
              { label: "Observação interna padrão", value: savedCommercialExperience.quote_internal_note_enabled === "Sim" ? "Configurada" : savedCommercialExperience.quote_internal_note_enabled === "Não" ? "Não usa" : "Não definido" },
              { label: "Orçamento inicial antes de visita obrigatória", value: savedCommercialExperience.quote_preliminary_before_visit || "Não definido" },
              { label: "Resultado da visita exigido para orçamento final", value: savedCommercialExperience.quote_definitive_requires_visit_result || "Não definido" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Pós-venda"
            description="Defina por quanto tempo a loja acompanha o cliente depois da venda e o que costuma verificar nesse contato."
            tone={cleanText(savedCommercialExperience.post_sale_duration) && cleanText(savedCommercialExperience.post_sale_start) ? "blue" : "yellow"}
            status={cleanText(savedCommercialExperience.post_sale_duration) && cleanText(savedCommercialExperience.post_sale_start) ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "post_sale" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "post_sale" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("post_sale")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("post_sale"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "post_sale" ? <div className="space-y-5"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Por quanto tempo a loja normalmente acompanha o cliente depois da venda?</div><ChoiceButtonGroup value={commercialExperienceDraft.post_sale_duration} onChange={(value) => updateCommercialExperienceDraft("post_sale_duration", value)} options={[{ value: "7", label: "7 dias" }, { value: "15", label: "15 dias" }, { value: "30", label: "30 dias" }, { value: "60", label: "60 dias" }, { value: "90", label: "90 dias" }, { value: "outro", label: "Outro período" }]} />{commercialExperienceDraft.post_sale_duration === "outro" ? <RequiredOperationDetailField label="Por quantos dias?" value={commercialExperienceDraft.post_sale_duration_other_days} onChange={(value) => updateCommercialExperienceDraft("post_sale_duration_other_days", value.replace(/\D/g, ""))} placeholder="Informe o número de dias." /> : null}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando esse acompanhamento começa?</div><ChoiceButtonGroup value={commercialExperienceDraft.post_sale_start} onChange={(value) => updateCommercialExperienceDraft("post_sale_start", value)} options={[{ value: "entrega", label: "Após a entrega" }, { value: "instalacao", label: "Após a instalação" }, { value: "retirada", label: "Após a retirada" }, { value: "venda", label: "Após a conclusão da venda quando não houver outra execução" }, { value: "depende", label: "Depende do tipo de venda" }]} />{commercialExperienceDraft.post_sale_start === "depende" ? <RequiredOperationDetailField label="Quando o pós-venda começa em cada caso?" value={commercialExperienceDraft.post_sale_start_other} onChange={(value) => updateCommercialExperienceDraft("post_sale_start_other", value)} placeholder="Explique de forma simples quando começa para cada tipo de venda." /> : null}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a loja costuma verificar no pós-venda?</div><MultiSelectBoxGroup values={commercialExperienceDraft.post_sale_checks} onToggle={(value) => toggleCommercialExperienceArrayValue("post_sale_checks", value)} options={POST_SALE_CHECK_OPTIONS} />{commercialExperienceDraft.post_sale_checks.includes("outro") ? <RequiredOperationDetailField label="O que mais a loja verifica?" value={commercialExperienceDraft.post_sale_checks_other} onChange={(value) => updateCommercialExperienceDraft("post_sale_checks_other", value)} placeholder="Informe o outro ponto verificado no pós-venda." /> : null}</div></div> : <SummaryList items={buildBulletRows([{ label: "Duração do acompanhamento", value: savedCommercialExperience.post_sale_duration ? (savedCommercialExperience.post_sale_duration === "outro" ? `${savedCommercialExperience.post_sale_duration_other_days || "?"} dias` : `${savedCommercialExperience.post_sale_duration} dias`) : "Não definida" }, { label: "Quando começa", value: savedCommercialExperience.post_sale_start ? optionLabel(savedCommercialExperience.post_sale_start, [{ value: "entrega", label: "Após a entrega" }, { value: "instalacao", label: "Após a instalação" }, { value: "retirada", label: "Após a retirada" }, { value: "venda", label: "Após a conclusão da venda" }, { value: "depende", label: "Depende do tipo de venda" }]) : "Não definido" }, { label: "O que verifica", value: savedCommercialExperience.post_sale_checks.length ? `${savedCommercialExperience.post_sale_checks.length} ponto(s)` : "Não definido" }])} />}
          </SectionBlock>

          <SectionBlock
            title="Garantia"
            description="Defina se a loja oferece alguma garantia própria além da garantia do fabricante e em quais situações ela se aplica."
            tone={cleanText(savedCommercialExperience.warranty_extra_mode) ? "blue" : "yellow"}
            status={cleanText(savedCommercialExperience.warranty_extra_mode) ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "warranty" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "warranty" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("warranty")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("warranty"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "warranty" ? <div className="space-y-5"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja oferece alguma garantia própria além da garantia do fabricante?</div><ChoiceButtonGroup value={commercialExperienceDraft.warranty_extra_mode} onChange={(value) => updateCommercialExperienceDraft("warranty_extra_mode", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }, { value: "depende", label: "Depende do produto ou serviço" }]} />{commercialExperienceDraft.warranty_extra_mode === "depende" ? <RequiredOperationDetailField label="Quando existe garantia própria da loja?" value={commercialExperienceDraft.warranty_extra_rule} onChange={(value) => updateCommercialExperienceDraft("warranty_extra_rule", value)} placeholder="Explique para quais produtos ou serviços a loja oferece garantia própria." /> : null}</div>{commercialExperienceDraft.warranty_extra_mode !== "Não" && cleanText(commercialExperienceDraft.warranty_extra_mode) ? <><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A garantia própria pode existir para quais itens?</div><MultiSelectBoxGroup values={commercialExperienceDraft.warranty_items} onToggle={(value) => toggleCommercialExperienceArrayValue("warranty_items", value)} options={WARRANTY_ITEM_OPTIONS} />{commercialExperienceDraft.warranty_items.includes("outro") ? <RequiredOperationDetailField label="Qual outro item ou serviço?" value={commercialExperienceDraft.warranty_items_other} onChange={(value) => updateCommercialExperienceDraft("warranty_items_other", value)} placeholder="Especifique o outro item ou serviço." /> : null}</div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando começa a contar o prazo da garantia própria?</div><ChoiceButtonGroup value={commercialExperienceDraft.warranty_start} onChange={(value) => updateCommercialExperienceDraft("warranty_start", value)} options={[{ value: "compra", label: "Data da compra" }, { value: "entrega", label: "Data da entrega" }, { value: "instalacao", label: "Data da instalação" }, { value: "servico", label: "Conclusão do serviço" }, { value: "outro", label: "Outro momento" }]} />{commercialExperienceDraft.warranty_start === "outro" ? <RequiredOperationDetailField label="Quando começa a garantia?" value={commercialExperienceDraft.warranty_start_other} onChange={(value) => updateCommercialExperienceDraft("warranty_start_other", value)} placeholder="Explique quando começa a contar o prazo." /> : null}</div><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quanto tempo dura?</span><input inputMode="numeric" value={commercialExperienceDraft.warranty_duration_value} onChange={(e) => updateCommercialExperienceDraft("warranty_duration_value", e.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label><label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Unidade</span><select value={commercialExperienceDraft.warranty_duration_unit} onChange={(e) => updateCommercialExperienceDraft("warranty_duration_unit", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"><option value="dias">Dias</option><option value="meses">Meses</option><option value="anos">Anos</option></select></label></div><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Existe alguma condição importante que o cliente precisa cumprir?</div><ChoiceButtonGroup value={commercialExperienceDraft.warranty_conditions_enabled} onChange={(value) => updateCommercialExperienceDraft("warranty_conditions_enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />{commercialExperienceDraft.warranty_conditions_enabled === "Sim" ? <RequiredOperationDetailField label="Quais são as condições importantes?" value={commercialExperienceDraft.warranty_conditions} onChange={(value) => updateCommercialExperienceDraft("warranty_conditions", value)} placeholder="Informe somente condições reais que a loja consegue sustentar e comunicar ao cliente." /> : null}</div></> : null}</div> : <SummaryList items={buildBulletRows([{ label: "Garantia própria da loja", value: savedCommercialExperience.warranty_extra_mode || "Não definido" }, { label: "Itens cobertos", value: savedCommercialExperience.warranty_items.length ? `${savedCommercialExperience.warranty_items.length} tipo(s)` : savedCommercialExperience.warranty_extra_mode === "Não" ? "Não se aplica" : "Não definido" }, { label: "Duração", value: savedCommercialExperience.warranty_duration_value ? `${savedCommercialExperience.warranty_duration_value} ${savedCommercialExperience.warranty_duration_unit}` : savedCommercialExperience.warranty_extra_mode === "Não" ? "Não se aplica" : "Não definida" }])} />}
          </SectionBlock>

          <SectionBlock
            title="Cancelamento, rescisão e reembolso"
            description="Registre somente regras próprias e já validadas da loja. A IA pode explicar a política cadastrada, mas pedidos concretos, cálculos e decisões finais continuam no fluxo humano correto."
            tone={savedCommercialExperience.cancellation_policy_exists === "Não" || (savedCommercialExperience.cancellation_policy_exists === "Sim" && savedCommercialExperience.cancellation_rule_situations.length > 0) ? "blue" : "yellow"}
            status={savedCommercialExperience.cancellation_policy_exists === "Não" || (savedCommercialExperience.cancellation_policy_exists === "Sim" && savedCommercialExperience.cancellation_rule_situations.length > 0) ? "Completo" : "Precisa de atenção"}
            className={commercialExperienceEditTarget === "cancellation" ? "xl:col-span-2" : ""}
            actions={commercialExperienceEditTarget === "cancellation" ? <><button type="button" onClick={() => void saveCommercialExperienceCard("cancellation")} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setCommercialExperienceDraft(savedCommercialExperience); setCommercialExperienceEditTarget("cancellation"); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {commercialExperienceEditTarget === "cancellation" ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm leading-5 text-amber-950">
                  A IA nunca decide por conta própria se o cliente tem direito a cancelar, rescindir ou receber determinado valor. Ela não calcula multa, retenção ou reembolso. Ela pode explicar apenas regras previamente validadas e encaminhar o pedido para análise humana.
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja possui uma política própria e validada de cancelamento, rescisão ou reembolso?</div>
                  <ChoiceButtonGroup
                    value={commercialExperienceDraft.cancellation_policy_exists}
                    onChange={(value) => updateCommercialExperienceDraft("cancellation_policy_exists", value)}
                    options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]}
                  />
                  {commercialExperienceDraft.cancellation_policy_exists === "Não" ? (
                    <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">
                      Sem uma política própria cadastrada, a IA não inventa condições. Ela registra o pedido e encaminha o caso para a análise humana apropriada.
                    </div>
                  ) : null}
                </div>

                {commercialExperienceDraft.cancellation_policy_exists === "Sim" ? (
                  <>
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais situações a política da loja possui uma regra específica?</div>
                      <p className="mb-3 text-xs leading-5 text-gray-500">Marque somente situações realmente previstas na política. Ao marcar uma situação, descreva a regra validada logo abaixo.</p>
                      <MultiSelectBoxGroup
                        values={commercialExperienceDraft.cancellation_rule_situations}
                        onToggle={(value) => toggleCommercialExperienceArrayValue("cancellation_rule_situations", value)}
                        options={CANCELLATION_RULE_SITUATION_OPTIONS}
                      />
                    </div>

                    {commercialExperienceDraft.cancellation_rule_situations.includes("after_contract") ? (
                      <RequiredOperationDetailField
                        label="Qual é a regra após a assinatura do contrato?"
                        value={commercialExperienceDraft.cancellation_after_contract_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_after_contract_rule", value)}
                        placeholder="Descreva somente a regra já validada pela loja para esse momento da venda."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("ordered_product") ? (
                      <RequiredOperationDetailField
                        label="Como funciona quando o produto já foi encomendado ao fornecedor?"
                        value={commercialExperienceDraft.cancellation_ordered_product_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_ordered_product_rule", value)}
                        placeholder="Explique a regra validada para pedidos que já foram enviados ao fornecedor."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("custom_order") ? (
                      <RequiredOperationDetailField
                        label="Qual é a regra para produtos sob encomenda ou personalizados?"
                        value={commercialExperienceDraft.cancellation_custom_order_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_custom_order_rule", value)}
                        placeholder="Explique quais pedidos entram nessa regra e como a política da loja os trata."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("after_delivery") ? (
                      <RequiredOperationDetailField
                        label="Qual é a regra depois da entrega ou retirada?"
                        value={commercialExperienceDraft.cancellation_after_delivery_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_after_delivery_rule", value)}
                        placeholder="Explique a regra validada para pedidos já entregues ou retirados."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("service_started") ? (
                      <RequiredOperationDetailField
                        label="Qual é a regra quando a instalação ou o serviço já começou?"
                        value={commercialExperienceDraft.cancellation_service_started_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_service_started_rule", value)}
                        placeholder="Explique como a política trata instalação ou serviço iniciado, parcial ou concluído."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("charge_or_retention") ? (
                      <RequiredOperationDetailField
                        label="Qual é a regra validada de multa, cobrança ou retenção?"
                        value={commercialExperienceDraft.cancellation_charge_or_retention_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_charge_or_retention_rule", value)}
                        placeholder="Descreva quando essa regra existe e como está definida. A IA não calcula nem confirma a aplicação ao caso concreto."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("refund") ? (
                      <RequiredOperationDetailField
                        label="Como funciona a regra de reembolso?"
                        value={commercialExperienceDraft.cancellation_refund_rule}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_refund_rule", value)}
                        placeholder="Explique as condições gerais já validadas. O valor e a decisão de um caso concreto continuam exigindo análise humana."
                        rows={3}
                      />
                    ) : null}

                    {commercialExperienceDraft.cancellation_rule_situations.includes("other") ? (
                      <RequiredOperationDetailField
                        label="Qual é a outra regra?"
                        value={commercialExperienceDraft.cancellation_policy_other}
                        onChange={(value) => updateCommercialExperienceDraft("cancellation_policy_other", value)}
                        placeholder="Descreva a regra de forma objetiva e sem substituir a análise do caso concreto."
                        rows={3}
                      />
                    ) : null}

                    <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">
                      Essas respostas descrevem a política da loja; elas não dão à IA autoridade para decidir direitos, aplicar multa, calcular retenção ou confirmar reembolso.
                    </div>
                  </>
                ) : null}
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Política própria", value: savedCommercialExperience.cancellation_policy_exists || "Não definido" },
              { label: "Situações com regra específica", value: savedCommercialExperience.cancellation_policy_exists === "Sim" ? (savedCommercialExperience.cancellation_rule_situations.length ? `${savedCommercialExperience.cancellation_rule_situations.length} situação(ões)` : "Não definidas") : "Não se aplica" },
              { label: "Resumo", value: savedCommercialExperience.cancellation_policy_exists === "Sim" && savedCommercialExperience.cancellation_rule_situations.length ? savedCommercialExperience.cancellation_rule_situations.map((item) => optionLabel(item, CANCELLATION_RULE_SITUATION_OPTIONS)).join(", ") : savedCommercialExperience.cancellation_policy_exists === "Não" ? "Pedidos seguem para análise humana sem regra própria cadastrada" : "Não definido" },
              { label: "Decisão final", value: "Sempre segue análise humana e a autoridade correta" },
            ])} />}
          </SectionBlock>
        </div>
      ) : null}


      {activeTab === "catalogo" ? (
        <div className="space-y-4">
          <SectionBlock
            title="Resumo do catálogo"
            description="Visão rápida da base atual da loja."
            tone="blue"
            status={`${totalCatalogo} itens`}
          >
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <QuickCard href="/configuracoes/piscinas" title="Piscinas" count={counts.pools} />
              <QuickCard href="/configuracoes/catalogo/quimicos" title="Químicos" count={counts.quimicos} />
              <QuickCard href="/configuracoes/catalogo/acessorios" title="Acessórios" count={counts.acessorios} />
              <QuickCard href="/configuracoes/catalogo/outros" title="Outros" count={counts.outros} />
            </div>
          </SectionBlock>

          <SectionBlock
            title="Cadastro manual e importação inteligente"
            description="Use este bloco tanto para adicionar um item individualmente quanto para importar arquivos do catálogo."
          >
            <div className="space-y-5">
              <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-950">Adicionar um item manualmente</div>
                    <p className="mt-1 text-sm leading-5 text-gray-600">Use esta opção quando quiser cadastrar apenas um item por vez.</p>
                  </div>
                  <button type="button" onClick={() => { setManualCatalogItemModalError(null); setManualCatalogItemModalSuccess(null); setIsManualCatalogItemModalOpen(true); }} className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">Adicionar item</button>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-4">
                <div className="mb-3">
                  <div className="text-sm font-semibold text-gray-950">Importar arquivos do catálogo</div>
                  <p className="mt-1 text-sm leading-5 text-gray-600">Use esta opção quando já existir um arquivo com vários itens e você quiser aproveitar a importação inteligente.</p>
                </div>
                <IntelligentCatalogImportPanel
                  organizationId={organizationId}
                  storeId={activeStoreId}
                  storageKey={intelligentImportStorageKey}
                  source="configuracoes_intelligent_import"
                  disabled={!hasValidStoreContext}
                  supabaseClient={supabase}
                  onError={(message) => {
                    setErrorText(message);
                    if (message) setSuccessText(null);
                  }}
                  onSuccess={(message) => {
                    setSuccessText(message);
                    if (message) setErrorText(null);
                  }}
                  onSaved={async () => {
                    await fetchPageData();
                  }}
                />
              </div>
            </div>
          </SectionBlock>

          <SectionBlock
            title="Catálogos para clientes"
            description="Autorize, de forma explícita, quais arquivos originais usados na Importação Inteligente a IA pode enviar aos clientes. Os preços, o estoque e a disponibilidade continuam sendo definidos pelo catálogo atual do ZION."
            tone={customerCatalogCardStatus.tone}
            status={customerCatalogCardStatus.status}
            actions={
              isCustomerCatalogEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCustomerCatalogSettingsSave()}
                    disabled={
                      savingCustomerCatalogSettings ||
                      (customerCatalogAllowDraft === "Sim" &&
                        customerCatalogFileIdsDraft.filter((value) => cleanText(value)).length === 0)
                    }
                    className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savingCustomerCatalogSettings ? "Salvando..." : "Salvar"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCustomerCatalogEditCancel}
                    disabled={savingCustomerCatalogSettings}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCustomerCatalogEditStart}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800"
                >
                  Editar
                </button>
              )
            }
          >
            {isCustomerCatalogEditing ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-sm font-semibold text-gray-950">
                    A IA pode enviar catálogos completos aos clientes?
                  </div>
                  <ChoiceButtonGroup
                    value={customerCatalogAllowDraft}
                    onChange={(value) => {
                      const nextValue = value === "Sim" ? "Sim" : "Não";
                      setCustomerCatalogAllowDraft(nextValue);
                      setCustomerCatalogFileIdsDraft((current) => {
                        if (nextValue === "Não") return [];
                        return current.length > 0 ? current : [""];
                      });
                    }}
                    options={[
                      { value: "Sim", label: "Sim" },
                      { value: "Não", label: "Não" },
                    ]}
                  />
                </div>

                {customerCatalogAllowDraft === "Sim" ? (
                  <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                    <div>
                      <div className="text-sm font-semibold text-gray-950">
                        Catálogos autorizados para envio
                      </div>
                      <p className="mt-1 text-xs leading-5 text-gray-600">
                        Escolha um ou mais arquivos que já foram usados na Importação Inteligente. O ZION enviará os próprios arquivos originais; eles não serão recriados a partir dos itens cadastrados.
                      </p>
                    </div>

                    {customerCatalogEligibleFiles.length > 0 ? (
                      <div className="space-y-2">
                        {(customerCatalogFileIdsDraft.length > 0
                          ? customerCatalogFileIdsDraft
                          : [""]
                        ).map((selectedFileId, index, rows) => {
                          const selectedFile = customerCatalogDraftFiles[index] ?? null;
                          const usedByOtherRows = new Set(
                            rows.filter(
                              (value, rowIndex) =>
                                rowIndex !== index && Boolean(cleanText(value)),
                            ),
                          );

                          return (
                            <div
                              key={`customer-catalog-row-${index}`}
                              className="flex flex-col gap-2 sm:flex-row sm:items-center"
                            >
                              <div className="relative min-w-0 flex-1">
                                <select
                                  value={selectedFileId}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setCustomerCatalogFileIdsDraft((current) => {
                                      const base = current.length > 0 ? [...current] : [""];
                                      base[index] = nextValue;
                                      return base;
                                    });
                                  }}
                                  className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-11 text-sm text-gray-900 outline-none focus:border-black"
                                >
                                  <option value="">Selecione um catálogo</option>
                                  {customerCatalogEligibleFiles.map((file) => (
                                    <option
                                      key={file.id}
                                      value={file.id}
                                      disabled={usedByOtherRows.has(file.id)}
                                    >
                                      {cleanText(file.original_file_name) || "Arquivo importado"} —{" "}
                                      {formatImportDate(file.created_at)}
                                    </option>
                                  ))}
                                </select>
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500"
                                >
                                  ⌄
                                </span>
                              </div>

                              {selectedFile ? (
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadImportFile(selectedFile)}
                                  disabled={downloadingImportFileId === selectedFile.id}
                                  className="shrink-0 rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm font-semibold text-sky-900 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {downloadingImportFileId === selectedFile.id
                                    ? "Abrindo..."
                                    : "Visualizar"}
                                </button>
                              ) : null}

                              {(rows.length > 1 || cleanText(selectedFileId)) ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomerCatalogFileIdsDraft((current) => {
                                      const base = current.length > 0 ? current : [""];
                                      const next = base.filter(
                                        (_, rowIndex) => rowIndex !== index,
                                      );
                                      return next.length > 0 ? next : [""];
                                    })
                                  }
                                  className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                                >
                                  Remover
                                </button>
                              ) : null}
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() =>
                            setCustomerCatalogFileIdsDraft((current) => [
                              ...(current.length > 0 ? current : [""]),
                              "",
                            ])
                          }
                          disabled={
                            customerCatalogFileIdsDraft.filter((value) => cleanText(value))
                              .length >= customerCatalogEligibleFiles.length
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:border-cyan-300 hover:bg-cyan-50/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="text-base leading-none">+</span>
                          Adicionar mais um catálogo
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                        Nenhum arquivo ativo da Importação Inteligente está disponível. Importe um catálogo primeiro e depois volte a esta configuração.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                    Nenhum arquivo ficará autorizado para envio completo aos clientes.
                  </div>
                )}

                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">
                  Esta autorização vale somente para o envio dos arquivos originais. A IA deve consultar o catálogo vivo do ZION para preço, estoque e disponibilidade; o conteúdo dos arquivos não substitui essas autoridades.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SummaryList
                  items={[
                    ...buildBulletRows([
                      {
                        label: "Envio de catálogos completos",
                        value: storeCatalogSettings
                          ? storeCatalogSettings.allow_full_catalog_send
                            ? "Sim"
                            : "Não"
                          : "Não definido",
                      },
                      {
                        label: "Catálogos autorizados",
                        value: storeCatalogSettings?.allow_full_catalog_send
                          ? `${selectedCustomerCatalogFiles.length} arquivo(s)`
                          : "Nenhum",
                      },
                    ]),
                    ...(storeCatalogSettings?.allow_full_catalog_send
                      ? selectedCustomerCatalogFiles.map(
                          (file, index) =>
                            `Catálogo ${index + 1}: ${
                              cleanText(file.original_file_name) || "Arquivo importado"
                            }`,
                        )
                      : []),
                    ...buildBulletRows([
                      {
                        label: "Preço, estoque e disponibilidade",
                        value: "Catálogo atual do ZION",
                      },
                    ]),
                  ]}
                />

                {storeCatalogSettings?.allow_full_catalog_send &&
                selectedCustomerCatalogFiles.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {selectedCustomerCatalogFiles.map((file) => (
                      <button
                        key={`customer-catalog-preview-${file.id}`}
                        type="button"
                        onClick={() => void handleDownloadImportFile(file)}
                        disabled={downloadingImportFileId === file.id}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {downloadingImportFileId === file.id
                          ? "Abrindo..."
                          : `Visualizar ${
                              cleanText(file.original_file_name) || "catálogo"
                            }`}
                      </button>
                    ))}
                  </div>
                ) : null}

                {storeCatalogSettings?.allow_full_catalog_send &&
                selectedCustomerCatalogFiles.length !==
                  storeCatalogSettings.customer_catalog_import_file_ids.length ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
                    Um ou mais catálogos autorizados não estão disponíveis entre as importações atuais desta loja. Revise esta configuração antes de permitir novos envios.
                  </div>
                ) : null}
              </div>
            )}
          </SectionBlock>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setIsCatalogImportedFilesOpen((current) => !current)}
              className="w-full text-left"
            >
              <div className={`h-0.5 w-full ${configurationCardBarClass("blue")}`} />
              <div className="flex items-start justify-between gap-4 p-5">
                <div>
                  <h2 className="text-base font-semibold text-gray-950">Arquivos importados</h2>
                  <p className="mt-1 text-sm leading-5 text-gray-600">Consulte os arquivos brutos vinculados às importações da loja somente quando precisar.</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${configurationCardStatusClass("blue")}`}>
                    {catalogImportedFiles.length > 0 ? `${catalogImportedFiles.length} arquivo(s)` : "Nenhum arquivo"}
                  </span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-700">
                    {isCatalogImportedFilesOpen ? "▲" : "▼"}
                  </span>
                </div>
              </div>
            </button>
            {isCatalogImportedFilesOpen ? (
              <div className="border-t border-gray-100 px-5 pb-5 pt-4">
                {catalogImportedFiles.length > 0 ? (
                  <div className="space-y-2">
                    {catalogImportedFiles.slice(0, 12).map((file, index) => (
                      <div key={buildImportFileKey(file, index)} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{cleanText(file.original_file_name) || "Arquivo importado"}</div>
                          <div className="text-xs text-gray-500">{formatImportDate(file.created_at)} • {formatFileSize(file.size_bytes)}</div>
                        </div>
                        <button type="button" onClick={(event) => { event.stopPropagation(); void handleDownloadImportFile(file); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold">Baixar</button>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-sm text-gray-500">Nenhum arquivo bruto importado ainda.</div>}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "contratos-marca" ? (
        <div className="space-y-4">
          <SectionBlock
            title="Marca e identidade"
            description="Defina a identidade visual usada nos documentos gerados pelo ZION sem duplicar os dados básicos da loja que já ficam em Geral."
            tone={hasStoredLogo ? "blue" : "yellow"}
            status={hasStoredLogo ? "Logo cadastrada" : "Precisa de atenção"}
            className={isBrandEditing ? "xl:col-span-2" : ""}
            actions={isBrandEditing ? <><button type="button" onClick={() => void handleBrandSettingsSave()} disabled={savingStoreLogo} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Salvar</button><button type="button" onClick={handleBrandSettingsCancel} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setBrandExperienceDraft(savedBrandExperience); setIsBrandEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {isBrandEditing ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Logo da loja</div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                      {storeLogoPreviewUrl ? <img src={storeLogoPreviewUrl} alt="Logo da loja" className="h-full w-full object-contain" /> : <span className="text-xs text-gray-500">Sem logo</span>}
                    </div>
                    <div className="flex-1">
                      <input ref={storeLogoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleStoreLogoFileChange(event.target.files)} className="block w-full text-sm" />
                      <div className="mt-2 text-xs text-gray-500">PNG, JPEG ou WebP • até 2 MB.</div>
                    </div>
                  </div>
                  {hasStoredLogo ? <button type="button" onClick={() => void handleRemoveStoreLogo()} disabled={removingStoreLogo} className="mt-3 rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">Remover logo atual</button> : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Usar a logo nos orçamentos?</div>
                    <ChoiceButtonGroup value={brandExperienceDraft.use_logo_on_quotes} onChange={(value) => updateBrandExperienceDraft("use_logo_on_quotes", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Usar a logo nos contratos?</div>
                    <ChoiceButtonGroup value={brandExperienceDraft.use_logo_on_contracts} onChange={(value) => updateBrandExperienceDraft("use_logo_on_contracts", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cor principal da marca</span>
                    <div className="flex items-center gap-2">
                      <input type="color" value={brandExperienceDraft.primary_color || "#111111"} onChange={(event) => updateBrandExperienceDraft("primary_color", event.target.value.toUpperCase())} className="h-11 w-14 rounded-lg border border-gray-200 bg-white p-1" />
                      <input value={brandExperienceDraft.primary_color} onChange={(event) => updateBrandExperienceDraft("primary_color", event.target.value.toUpperCase())} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="#111111" />
                    </div>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cor secundária</span>
                    <div className="flex items-center gap-2">
                      <input type="color" value={brandExperienceDraft.secondary_color || "#FFFFFF"} onChange={(event) => updateBrandExperienceDraft("secondary_color", event.target.value.toUpperCase())} className="h-11 w-14 rounded-lg border border-gray-200 bg-white p-1" />
                      <input value={brandExperienceDraft.secondary_color} onChange={(event) => updateBrandExperienceDraft("secondary_color", event.target.value.toUpperCase())} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="#FFFFFF" />
                    </div>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Rodapé ou assinatura padrão dos documentos</span>
                  <textarea value={brandExperienceDraft.document_footer} onChange={(event) => updateBrandExperienceDraft("document_footer", event.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="Opcional. Ex.: agradecimento, contato da loja ou orientação curta que deve acompanhar documentos." />
                </label>
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Logo", value: hasStoredLogo ? displayedLogoFileName : "Não enviada" },
              { label: "Logo em orçamentos", value: savedBrandExperience.use_logo_on_quotes || "Não definido" },
              { label: "Logo em contratos", value: savedBrandExperience.use_logo_on_contracts || "Não definido" },
              { label: "Cor principal", value: savedBrandExperience.primary_color || "Não definida" },
              { label: "Cor secundária", value: savedBrandExperience.secondary_color || "Não definida" },
              { label: "Rodapé dos documentos", value: cleanText(savedBrandExperience.document_footer) || "Não definido" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Uso do contrato"
            description="Defina se a loja usa contrato, em quais vendas ele é necessário, quais formatos aceita e antes de qual etapa precisa estar assinado."
            tone={savedContractExperience.enabled === "Não" || (savedContractExperience.enabled === "Sim" && cleanText(savedContractExperience.applicability_mode) && savedContractExperience.formats.length > 0 && savedContractExperience.signed_before.length > 0) ? "blue" : "yellow"}
            status={savedContractExperience.enabled === "Não" || (savedContractExperience.enabled === "Sim" && cleanText(savedContractExperience.applicability_mode) && savedContractExperience.formats.length > 0 && savedContractExperience.signed_before.length > 0) ? "Completo" : "Precisa de atenção"}
            className={isContractPolicyEditing ? "xl:col-span-2" : ""}
            actions={isContractPolicyEditing ? <><button type="button" onClick={handleContractPolicySave} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={handleContractPolicyCancel} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setContractExperienceDraft(savedContractExperience); setIsContractPolicyEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {isContractPolicyEditing ? (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A loja utiliza contrato nas vendas?</div>
                  <ChoiceButtonGroup value={contractExperienceDraft.enabled} onChange={(value) => updateContractExperienceDraft("enabled", value)} options={[{ value: "Sim", label: "Sim" }, { value: "Não", label: "Não" }]} />
                </div>

                {contractExperienceDraft.enabled === "Sim" ? (
                  <>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando o contrato é usado?</div>
                      <ChoiceButtonGroup
                        value={contractExperienceDraft.applicability_mode}
                        onChange={(value) => updateContractExperienceDraft("applicability_mode", value)}
                        options={[
                          { value: "sempre", label: "É obrigatório em todas as vendas" },
                          { value: "depende", label: "É obrigatório apenas em algumas vendas" },
                          { value: "opcional", label: "É opcional" },
                        ]}
                      />
                      <p className="mt-2 text-xs leading-5 text-gray-500">“Todas as vendas” significa qualquer venda da loja. Se o contrato só for obrigatório em certos tipos de venda, escolha “apenas em algumas vendas” e selecione as situações abaixo.</p>
                    </div>

                    {contractExperienceDraft.applicability_mode === "depende" ? (
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais situações o contrato é exigido?</div>
                        <MultiSelectBoxGroup values={contractExperienceDraft.applicability_cases} onToggle={(value) => toggleContractExperienceArrayValue("applicability_cases", value)} options={CONTRACT_APPLICABILITY_CASE_OPTIONS} />
                        {contractExperienceDraft.applicability_cases.includes("alto_valor") ? (
                          <label className="mt-3 block space-y-1.5">
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A partir de qual valor?</span>
                            <input value={contractExperienceDraft.high_value_amount} onChange={(event) => updateContractExperienceDraft("high_value_amount", formatStorePaymentCurrencyInput(event.target.value))} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="R$ 0,00" />
                          </label>
                        ) : null}
                        {contractExperienceDraft.applicability_cases.includes("outro") ? (
                          <RequiredOperationDetailField label="Qual é a outra situação?" value={contractExperienceDraft.applicability_other} onChange={(value) => updateContractExperienceDraft("applicability_other", value)} placeholder="Explique em qual outra situação o contrato é exigido." />
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quais formatos a loja aceita?</div>
                      <p className="mb-2 text-xs leading-5 text-gray-500">A loja pode trabalhar com contrato digital, físico ou ambos. Isso não cria modelos concorrentes: o ZION continua mantendo um contrato padrão ativo por loja.</p>
                      <MultiSelectBoxGroup values={contractExperienceDraft.formats} onToggle={(value) => toggleContractExperienceArrayValue("formats", value)} options={CONTRACT_FORMAT_OPTIONS} />
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Antes de quais etapas o contrato precisa estar assinado?</div>
                      <MultiSelectBoxGroup values={contractExperienceDraft.signed_before} onToggle={(value) => toggleContractExperienceArrayValue("signed_before", value)} options={CONTRACT_SIGNED_BEFORE_OPTIONS} />
                      {contractExperienceDraft.signed_before.includes("outro") ? (
                        <RequiredOperationDetailField label="Qual é o outro momento?" value={contractExperienceDraft.signed_before_other} onChange={(value) => updateContractExperienceDraft("signed_before_other", value)} placeholder="Explique antes de qual outra etapa o contrato precisa estar assinado." />
                      ) : null}
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações sobre o uso do contrato</span>
                      <textarea value={contractExperienceDraft.notes} onChange={(event) => updateContractExperienceDraft("notes", event.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="Opcional. Registre somente particularidades reais da loja que não estejam cobertas acima." />
                    </label>
                  </>
                ) : null}
              </div>
            ) : <SummaryList items={buildBulletRows([
              { label: "Usa contrato", value: savedContractExperience.enabled || "Não definido" },
              { label: "Quando usa", value: savedContractExperience.enabled === "Sim" ? (savedContractExperience.applicability_mode ? optionLabel(savedContractExperience.applicability_mode, [{ value: "sempre", label: "Obrigatório em todas as vendas" }, { value: "depende", label: "É obrigatório apenas em algumas vendas" }, { value: "opcional", label: "Opcional" }]) : "Não definido") : savedContractExperience.enabled === "Não" ? "Não se aplica" : "Não definido" },
              { label: "Formatos", value: savedContractExperience.enabled === "Sim" ? (savedContractExperience.formats.length ? joinSelectedLabels(savedContractExperience.formats, CONTRACT_FORMAT_OPTIONS) : "Não definidos") : "Não se aplica" },
              { label: "Precisa estar assinado antes de", value: savedContractExperience.enabled === "Sim" ? (savedContractExperience.signed_before.length ? joinSelectedLabels(savedContractExperience.signed_before, CONTRACT_SIGNED_BEFORE_OPTIONS, savedContractExperience.signed_before_other) : "Não definido") : "Não se aplica" },
            ])} />}
          </SectionBlock>

          <SectionBlock
            title="Contrato padrão da loja"
            description="Envie, revise e aprove o contrato base oficial da loja. O ZION mantém uma única versão ativa por vez e preserva as versões anteriores no histórico."
            tone={storeContractActiveVersion ? "blue" : savedContractExperience.enabled === "Não" ? "blue" : "yellow"}
            status={storeContractActiveVersion ? "Versão ativa" : savedContractExperience.enabled === "Não" ? "Não aplicável" : "Precisa de atenção"}
            actions={<button type="button" onClick={() => setIsContractsEditing((current) => !current)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">{isContractsEditing ? "Fechar" : "Gerenciar contrato"}</button>}
          >
            <div className="space-y-4">
              {contractsLoading ? <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Carregando contratos da loja...</div> : null}
              {contractsErrorText ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{contractsErrorText}</div> : null}
              {contractsSuccessText ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{contractsSuccessText}</div> : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold text-gray-950">Enviar contrato base</div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">Formatos aceitos: PDF, DOC e DOCX. O envio cria uma nova versão para revisão; ele não substitui silenciosamente a versão ativa.</p>
                  <input
                    ref={contractBaseInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      setSelectedContractBaseFile(nextFile);
                      setContractsErrorText(null);
                      setContractsSuccessText(null);
                      event.currentTarget.value = "";
                    }}
                    className="hidden"
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => contractBaseInputRef.current?.click()}
                      disabled={!hasValidStoreContext || uploadingContractBase || contractsLoading}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Escolher arquivo
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUploadContractBase()}
                      disabled={!hasValidStoreContext || !selectedContractBaseFile || uploadingContractBase || contractsLoading}
                      className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {uploadingContractBase ? "Enviando contrato base..." : "Enviar contrato base"}
                    </button>
                  </div>
                  <div className="mt-3 text-sm text-gray-700"><span className="font-semibold">Arquivo selecionado:</span> {selectedContractBaseFile?.name || "Nenhum arquivo selecionado"}</div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold text-gray-950">Contrato base ativo</div>
                  {storeContractActiveVersion ? (
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      <div><span className="font-semibold">Arquivo:</span> {cleanText(storeContractActiveVersion.original_filename) || "Sem nome"}</div>
                      <div><span className="font-semibold">Versão:</span> {storeContractActiveVersion.version_number ?? "?"}</div>
                      <div><span className="font-semibold">Status:</span> {resolveContractVersionStatus(storeContractActiveVersion.status).label}</div>
                      <div><span className="font-semibold">Aprovado em:</span> {formatImportDate(storeContractActiveVersion.approved_at)}</div>
                    </div>
                  ) : <div className="mt-3 text-sm text-gray-500">Nenhuma versão aprovada está ativa no momento.</div>}
                </div>
              </div>

              {isContractsEditing ? (
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-950">Versões enviadas</div>
                        <p className="mt-1 text-xs leading-5 text-gray-500">Analise, revise as regras encontradas e aprove somente a versão correta.</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
  <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700">
    {storeContractVersions.length} versão(ões)
  </span>

  {storeContractVersions.some((version) =>
    ["archived", "rejected"].includes(
      normalizeContractVersionStatusValue(version.status)
    )
  ) ? (
    <button
      type="button"
      onClick={() =>
        setShowContractVersionHistory((current) => !current)
      }
      className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
    >
      {showContractVersionHistory
        ? "Ocultar histórico de versões"
        : `Ver histórico de versões (${storeContractVersions.filter((version) =>
            ["archived", "rejected"].includes(
              normalizeContractVersionStatusValue(version.status)
            )
          ).length})`}
    </button>
  ) : null}
</div>
                    </div>

                    {storeContractVersions.length === 0 ? (
                      <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">Nenhuma versão enviada ainda.</div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {storeContractVersions
  .filter((version) => {
    const normalizedStatus =
      normalizeContractVersionStatusValue(version.status);

    const isHistoricalVersion =
      normalizedStatus === "archived" ||
      normalizedStatus === "rejected";

    return showContractVersionHistory || !isHistoricalVersion;
  })
  .map((version) => {
                          const status = resolveContractVersionStatus(version.status);
                          const normalizedStatus = normalizeContractVersionStatusValue(version.status);
                          const isActiveVersion =
                            storeContractActiveVersion?.id === version.id || normalizedStatus === "active";
                          const hasReadText = Boolean(cleanText(version.raw_extracted_text));
                          const busy = contractActionVersionId === version.id;
                          const isAnalyzeBusy = busy && contractActionType === "analyze";
                          const isExtractRulesBusy = busy && contractActionType === "extract-rules";
                          const isApproveBusy = busy && contractActionType === "approve";
                          const isRejectBusy = busy && contractActionType === "reject";
                          const versionRules = storeContractExtractedRules.filter((rule) => rule.template_version_id === version.id);
                          const canAnalyze = canAnalyzeStoreContractVersion({
                            version,
                            isActiveVersion,
                            hasReadText,
                          });
                          const canExtractRules = canExtractRulesForStoreContractVersion({
                            version,
                            versionRules,
                            isActiveVersion,
                            hasReadText,
                          });
                          const canApprove = canApproveStoreContractVersion({
                            version,
                            versionRules,
                            isActiveVersion,
                          });
                          const canReject = isMutableStoreContractVersion({
                            version,
                            isActiveVersion,
                          });
                          const pendingRules = versionRules.filter((rule) => !cleanText(rule.review_status) || rule.review_status === "pending").length;
                          const approvedRules = versionRules.filter((rule) => rule.review_status === "approved").length;
                          const rejectedRules = versionRules.filter((rule) => rule.review_status === "rejected").length;
                          const editedRules = versionRules.filter((rule) => rule.review_status === "edited").length;

                          return (
                            <div key={version.id} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold text-gray-950">Versão {version.version_number ?? "?"}</div>
                                    <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusToneClass(status.tone)}`}>{status.label}</span>
                                    {isActiveVersion ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">Ativa</span> : null}
                                  </div>
                                  <div className="mt-2 break-all text-sm text-gray-700"><span className="font-semibold">Arquivo:</span> {cleanText(version.original_filename) || "Arquivo sem nome"}</div>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                                    <span className="rounded-full border border-gray-200 bg-white px-2 py-1">Enviado em {formatImportDate(version.created_at)}</span>
                                    <span className="rounded-full border border-gray-200 bg-white px-2 py-1">Tamanho: {formatFileSize(version.size_bytes)}</span>
                                    {version.approved_at ? <span className="rounded-full border border-gray-200 bg-white px-2 py-1">Aprovado em {formatImportDate(version.approved_at)}</span> : null}
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <CompactMetric label="Aguardando revisão" value={String(pendingRules)} tone={pendingRules > 0 ? "amber" : "green"} />
                                    <CompactMetric label="Aprovadas" value={String(approvedRules)} tone="green" />
                                    <CompactMetric label="Ignoradas" value={String(rejectedRules)} tone={rejectedRules > 0 ? "gray" : "green"} />
                                    <CompactMetric label="Ajustadas" value={String(editedRules)} tone={editedRules > 0 ? "blue" : "gray"} />
                                  </div>

                                  {cleanText(version.analysis_summary) ? <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-700"><span className="font-semibold">Resumo da análise:</span> {maskSensitiveContractPreview(cleanText(version.analysis_summary))}</div> : null}
                                </div>

                                <div className="flex w-full flex-col gap-2 xl:w-52">
                                  {canAnalyze ? (
                                    <button
                                      type="button"
                                      disabled={busy || uploadingContractBase || contractsLoading}
                                      onClick={() => void handleAnalyzeContractVersion(version.id)}
                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      {isAnalyzeBusy ? "Lendo arquivo..." : "Analisar contrato"}
                                    </button>
                                  ) : null}
                                  {hasReadText ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setContractContentSearchIndex(0);
                                        setContractContentModal({ type: "text", versionId: version.id });
                                      }}
                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
                                    >
                                      Ver texto lido
                                    </button>
                                  ) : null}
                                  {canExtractRules ? (
                                    <button
                                      type="button"
                                      disabled={busy || uploadingContractBase || contractsLoading}
                                      onClick={() => void handleExtractContractRules(version.id)}
                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      {isExtractRulesBusy ? "Buscando regras..." : "Encontrar regras do contrato"}
                                    </button>
                                  ) : null}
                                  {versionRules.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setContractContentSearchIndex(0);
                                        setContractContentModal({ type: "rules", versionId: version.id });
                                      }}
                                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
                                    >
                                      Ver regras encontradas
                                    </button>
                                  ) : null}
                                  {canApprove ? (
                                    <button
                                      type="button"
                                      disabled={busy || uploadingContractBase || contractsLoading}
                                      onClick={() => void handleApproveContractVersion(version.id)}
                                      className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      {isApproveBusy ? "Aprovando..." : "Aprovar versão"}
                                    </button>
                                  ) : null}
                                  {canReject ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={busy || uploadingContractBase || contractsLoading}
                                        onClick={() => void handleRejectContractVersion(version.id)}
                                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        {isRejectBusy ? "Rejeitando..." : "Rejeitar versão"}
                                      </button>
                                      <textarea
                                        value={contractRejectReasonDrafts[version.id] || ""}
                                        onChange={(event) =>
                                          setContractRejectReasonDrafts((current) => ({
                                            ...current,
                                            [version.id]: event.target.value,
                                          }))
                                        }
                                        rows={2}
                                        placeholder="Motivo da rejeição (opcional)"
                                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                                      />
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="text-sm font-semibold text-gray-950">Resumo rápido</div>
                    <div className="mt-3 space-y-2">
                      <CompactMetric label="Versões enviadas" value={String(storeContractVersions.length)} tone={storeContractVersions.length > 0 ? "green" : "gray"} />
                      <CompactMetric label="Status atual" value={storeContractActiveVersion ? "Ativo" : "Sem versão ativa"} tone={storeContractActiveVersion ? "green" : "amber"} />
                      <CompactMetric
                        label="Regras da versao ativa"
                        value={String(
                          storeContractActiveVersion
                            ? storeContractExtractedRules.filter(
                                (rule) => rule.template_version_id === storeContractActiveVersion.id
                              ).length
                            : 0
                        )}
                        tone={storeContractActiveVersion ? "blue" : "gray"}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <SummaryList items={buildBulletRows([
                  { label: "Arquivo ativo", value: cleanText(storeContractActiveVersion?.original_filename) || "Nenhum contrato ativo" },
                  { label: "Status", value: storeContractActiveVersion ? resolveContractVersionStatus(storeContractActiveVersion.status).label : "Sem versão ativa" },
                  { label: "Versões enviadas", value: String(storeContractVersions.length) },
                  { label: "Regras extraídas", value: String(storeContractExtractedRules.length) },
                ])} />
              )}
            </div>
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "canais-integracoes" ? (
        <div className="space-y-4">
          <SectionBlock
            title="WhatsApp comercial"
            description="Canal oficial usado pelos clientes para conversar com a IA Vendedora. Depois de conectado, o número não pode ser trocado diretamente pela loja."
            tone={storeWhatsappStatus?.connected && storeWhatsappStatus?.isActive ? "blue" : "yellow"}
            status={storeWhatsappStatus?.connected && storeWhatsappStatus?.isActive ? "Conectado" : "Ainda não conectado"}
          >
            {storeWhatsappStatus?.connected && storeWhatsappStatus?.isActive ? (
              <div className="space-y-4">
                <SummaryList items={buildBulletRows([
                  { label: "Número comercial", value: connectedCommercialWhatsapp || "Número conectado não informado" },
                  { label: "Status", value: storeWhatsappVisualStatus.label },
                  { label: "Recebimento de mensagens", value: storeWhatsappStatus?.connected ? "Disponível" : "Indisponível" },
                  { label: "Envio de mensagens", value: storeWhatsappStatus?.isActive ? "Disponível" : "Indisponível" },
                  { label: "Última mensagem recebida", value: formatImportDate(storeWhatsappStatus?.lastInboundAt) },
                  { label: "Última mensagem enviada", value: formatImportDate(storeWhatsappStatus?.lastOutboundAt) },
                ])} />
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">
                  Para trocar o número comercial, será necessário iniciar um processo de troca assistida pelo ZION. A loja não altera esse número diretamente em Configurações, e o ZION não precisa acessar a conta Meta do cliente.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                  <div className="font-semibold">WhatsApp comercial ainda não conectado.</div>
                  <div className="mt-1">A conexão inicial será concluída no fluxo de implantação/onboarding autorizado da loja. Configurações mostra somente o estado real da integração e não cria uma conexão apenas porque um número foi digitado.</div>
                </div>
                {cleanText(answers.commercial_whatsapp) ? (
                  <div className="text-xs leading-5 text-gray-500">Número informado anteriormente para implantação: <span className="font-semibold text-gray-700">{cleanText(answers.commercial_whatsapp)}</span>. Ele só se torna o número comercial ativo depois da conexão real ser validada.</div>
                ) : null}
              </div>
            )}
          </SectionBlock>

          <SectionBlock
            title="Responsável principal"
            description="Pessoa autorizada com quem a IA Assistente fala quando precisa de decisão, confirmação, contexto ou ação humana da loja."
            tone={!primaryResponsibleName || !primaryResponsibleWhatsapp ? "red" : "blue"}
            status={!primaryResponsibleName || !primaryResponsibleWhatsapp ? "Configuração crítica" : "Completo"}
            className={responsibleEditTarget === "primary" ? "" : ""}
            actions={responsibleEditTarget === "primary" ? <><button type="button" onClick={async () => { const saved = await handleActivationEditSave(); if (saved) setResponsibleEditTarget(null); }} className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white">Salvar</button><button type="button" onClick={() => { handleActivationEditCancel(); setResponsibleEditTarget(null); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Cancelar</button></> : <button type="button" onClick={() => { setResponsibleEditTarget("primary"); setIsActivationEditing(true); }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold">Editar</button>}
          >
            {responsibleEditTarget === "primary" ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</span><input value={primaryResponsibleDraft.name} onChange={(event) => handlePrimaryResponsibleChange("name", event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                  <label className="space-y-1.5"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Função</span><input value={primaryResponsibleDraft.role} onChange={(event) => handlePrimaryResponsibleChange("role", event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
                  <label className="space-y-1.5 md:col-span-2"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">WhatsApp autorizado do responsável</span><input value={primaryResponsibleDraft.whatsapp} onChange={(event) => handlePrimaryResponsibleChange("whatsapp", event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" placeholder="Ex.: +55 15 99999-9999" /></label>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                  Este número não é apenas um contato: ele identifica quem terá o privilégio de responsável no canal da IA Assistente. Ao trocar o número e salvar, o novo número deve assumir essa autorização e o anterior deve deixar de ter esse privilégio no runtime canônico.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <SummaryList items={buildBulletRows([
                  { label: "Nome", value: primaryResponsibleName || "Não definido" },
                  { label: "Função", value: cleanText(loadedCanonicalPrimaryResponsible?.role) || "Não definida" },
                  { label: "WhatsApp autorizado", value: primaryResponsibleWhatsapp || "Não definido" },
                  { label: "Destino das mensagens desse responsável", value: primaryResponsibleWhatsapp ? "IA Assistente" : "Aguardando número autorizado" },
                  { label: "Números não autorizados", value: "Sem privilégio de responsável" },
                ])} />
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-sky-950">
                  Clientes continuam sendo atendidos pela IA Vendedora no WhatsApp comercial. Quando o número autorizado do responsável falar com esse mesmo canal, o ZION deverá reconhecê-lo e encaminhar a conversa para a IA Assistente.
                </div>
              </div>
            )}
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "plano-cobranca" ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="text-center text-lg font-semibold text-gray-500">Em breve</div>
        </div>
      ) : null}

      {isManualCatalogItemModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={closeManualCatalogItemModal}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 bg-gray-950 px-5 py-4 text-white">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                  Cadastro visual
                </div>
                <h2 className="mt-1 text-lg font-bold">Adicionar item manualmente</h2>
              </div>
              <button
                type="button"
                onClick={closeManualCatalogItemModal}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5">
              <div className="space-y-4">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Categoria</span>
                  <select
                    value={manualCatalogItemCategory}
                    onChange={(event) =>
                      handleManualCatalogItemCategoryChange(
                        event.target.value as "piscina" | "quimicos" | "acessorios" | "outros"
                      )
                    }
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  >
                    <option value="piscina">Piscina</option>
                    <option value="quimicos">Químico</option>
                    <option value="acessorios">Acessório</option>
                    <option value="outros">Outro</option>
                  </select>
                </label>

                {manualCatalogItemModalError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {manualCatalogItemModalError}
                  </div>
                ) : null}

                {manualCatalogItemModalSuccess ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {manualCatalogItemModalSuccess}
                  </div>
                ) : null}

                {manualCatalogItemCategory === "piscina" ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-1 md:col-span-2 xl:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome da piscina</span>
                        <input
                          value={poolForm.name}
                          onChange={(event) => handlePoolFormChange("name", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: Piscina Fibra Premium 7x3"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marca</span>
                        <input
                          value={poolForm.brand}
                          onChange={(event) => handlePoolFormChange("brand", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: iGUi"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Material</span>
                        <input
                          value={poolForm.material}
                          onChange={(event) => handlePoolFormChange("material", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Fibra, vinil, alvenaria..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Formato</span>
                        <input
                          value={poolForm.shape}
                          onChange={(event) => handlePoolFormChange("shape", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Retangular, oval..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cor</span>
                        <input
                          value={poolForm.color}
                          onChange={(event) => handlePoolFormChange("color", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Azul, branca, areia..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Acabamento / linha</span>
                        <input
                          value={poolForm.finish}
                          onChange={(event) => handlePoolFormChange("finish", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Premium, borda molhada, com hidro..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Largura (m)</span>
                        <input
                          value={poolForm.width_m}
                          onChange={(event) => handlePoolFormChange("width_m", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="3.00"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Comprimento (m)</span>
                        <input
                          value={poolForm.length_m}
                          onChange={(event) => handlePoolFormChange("length_m", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="7.00"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Profundidade (m)</span>
                        <input
                          value={poolForm.depth_m}
                          onChange={(event) => handlePoolFormChange("depth_m", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="1.40"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</span>
                        <input
                          value={poolForm.price}
                          onChange={(event) => handlePoolFormChange("price", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="15990.00"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estoque</span>
                        <input
                          value={poolForm.stock_quantity}
                          onChange={(event) => handlePoolFormChange("stock_quantity", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: 0"
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2 xl:col-span-4">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição completa</span>
                        <textarea
                          value={poolForm.description}
                          onChange={(event) => handlePoolFormChange("description", event.target.value)}
                          rows={4}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Descreva acabamento, diferenciais, instalação, cor, acessórios inclusos e qualquer detalhe importante."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Itens inclusos</span>
                        <textarea
                          value={poolForm.included_items}
                          onChange={(event) => handlePoolFormChange("included_items", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: dispositivo, casa de máquinas, hidro, iluminação..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações de instalação</span>
                        <textarea
                          value={poolForm.installation_notes}
                          onChange={(event) => handlePoolFormChange("installation_notes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: precisa de visita técnica, prazo médio, condições do terreno..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Aplicação / uso recomendado</span>
                        <textarea
                          value={poolForm.application}
                          onChange={(event) => handlePoolFormChange("application", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: lazer familiar, uso residencial, instalação em áreas gourmet..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações técnicas</span>
                        <textarea
                          value={poolForm.technical_notes}
                          onChange={(event) => handlePoolFormChange("technical_notes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: espessura, reforços estruturais, requisitos técnicos..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2 xl:col-span-4">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fotos do item</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => handleManualCatalogPoolPhotosChange(event.target.files)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />
                        <div className="text-xs text-gray-500">Máximo de 10 fotos por item. Cada foto pode ter até 50 MB.</div>
                        {poolPhotos.length > 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            {poolPhotos.length} foto(s) selecionada(s): {poolPhotos.map((file) => file.name).join(", ")}
                          </div>
                        ) : null}
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={poolForm.is_active}
                          onChange={(event) => handlePoolFormChange("is_active", event.target.checked)}
                        />
                        Item em estado vendível / ativo
                      </label>

                      <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={poolForm.track_stock}
                          onChange={(event) => handlePoolFormChange("track_stock", event.target.checked)}
                        />
                        Controlar estoque deste item
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-1 md:col-span-2 xl:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome do item</span>
                        <input
                          value={catalogForm.name}
                          onChange={(event) => handleCatalogFormChange("name", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: Cloro granulado premium"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">SKU</span>
                        <input
                          value={catalogForm.sku}
                          onChange={(event) => handleCatalogFormChange("sku", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Opcional"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marca</span>
                        <input
                          value={catalogForm.brand}
                          onChange={(event) => handleCatalogFormChange("brand", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Marca do item"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Linha / modelo</span>
                        <input
                          value={catalogForm.line}
                          onChange={(event) => handleCatalogFormChange("line", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: Premium, Manutenção..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Unidade</span>
                        <input
                          value={catalogForm.unit_label}
                          onChange={(event) => handleCatalogFormChange("unit_label", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Un, kg, L, kit..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tamanho / variação</span>
                        <input
                          value={catalogForm.size_details}
                          onChange={(event) => handleCatalogFormChange("size_details", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: 10kg, 1L, 1,5 polegada..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Largura (cm)</span>
                        <input
                          value={catalogForm.width_cm}
                          onChange={(event) => handleCatalogFormChange("width_cm", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Opcional"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Altura (cm)</span>
                        <input
                          value={catalogForm.height_cm}
                          onChange={(event) => handleCatalogFormChange("height_cm", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Opcional"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Comprimento (cm)</span>
                        <input
                          value={catalogForm.length_cm}
                          onChange={(event) => handleCatalogFormChange("length_cm", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Opcional"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Peso (kg)</span>
                        <input
                          value={catalogForm.weight_kg}
                          onChange={(event) => handleCatalogFormChange("weight_kg", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Opcional"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</span>
                        <input
                          value={catalogForm.price}
                          onChange={(event) => handleCatalogFormChange("price", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="59.90"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estoque</span>
                        <input
                          value={catalogForm.stock_quantity}
                          onChange={(event) => handleCatalogFormChange("stock_quantity", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: 0"
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2 xl:col-span-4">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição completa</span>
                        <textarea
                          value={catalogForm.description}
                          onChange={(event) => handleCatalogFormChange("description", event.target.value)}
                          rows={4}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Descreva composição, litragem, aplicação, medidas, uso recomendado e detalhes importantes."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Aplicação / uso recomendado</span>
                        <textarea
                          value={catalogForm.application}
                          onChange={(event) => handleCatalogFormChange("application", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: tratamento semanal, aspiração, conexão hidráulica..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações técnicas</span>
                        <textarea
                          value={catalogForm.technical_notes}
                          onChange={(event) => handleCatalogFormChange("technical_notes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: compatibilidade, concentração, conexão, restrições..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2 xl:col-span-4">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fotos do item</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => handleManualCatalogGeneralPhotosChange(event.target.files)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />
                        <div className="text-xs text-gray-500">Máximo de 10 fotos por item. Cada foto pode ter até 50 MB.</div>
                        {catalogPhotos.length > 0 ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            {catalogPhotos.length} foto(s) selecionada(s): {catalogPhotos.map((file) => file.name).join(", ")}
                          </div>
                        ) : null}
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={catalogForm.is_active}
                          onChange={(event) => handleCatalogFormChange("is_active", event.target.checked)}
                        />
                        Item em estado vendível / ativo
                      </label>

                      <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={catalogForm.track_stock}
                          onChange={(event) => handleCatalogFormChange("track_stock", event.target.checked)}
                        />
                        Controlar estoque deste item
                      </label>
                    </div>
                  </>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleManualCatalogItemVisualSave}
                    disabled={savingPool || savingCatalogItem || !hasValidStoreContext}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPool
                      ? "Salvando piscina..."
                      : savingCatalogItem
                        ? "Salvando item..."
                        : "Salvar item"}
                  </button>
                  <button
                    type="button"
                    onClick={resetManualCatalogItemModalForm}
                    disabled={savingPool || savingCatalogItem}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    Limpar formulário
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contractContentModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5"
          onClick={() => {
            setContractContentModal(null);
            setContractContentSearchQuery("");
            setContractContentSearchIndex(0);
          }}
        >
          <div
            ref={contractContentModalRef}
            className="flex h-[94vh] w-[96vw] max-w-[1500px] flex-col overflow-hidden rounded-3xl border border-gray-200 bg-gray-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const selectedVersion = storeContractVersions.find(
                (item) => item.id === contractContentModal.versionId
              );
              const selectedRules = storeContractExtractedRules.filter(
                (item) => item.template_version_id === contractContentModal.versionId
              );
              const isTextModal = contractContentModal.type === "text";
              const title = isTextModal ? "Texto lido do contrato" : "Regras encontradas";
              const maskedContractText = maskSensitiveContractPreview(
                cleanText(selectedVersion?.raw_extracted_text) || "Nenhum texto lido disponível."
              );
              const normalizedSearchQuery = cleanText(contractContentSearchQuery)?.toLowerCase() || "";
              const visibleRules = normalizedSearchQuery
                ? selectedRules.filter((rule) => {
                    const searchable = [
                      cleanText(rule.label),
                      cleanText(rule.value_text),
                      cleanText(rule.source_excerpt),
                      resolveContractRuleGroupLabel(rule.rule_group),
                    ]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase();
                    return searchable.includes(normalizedSearchQuery);
                  })
                : selectedRules;
              const textMatchCount = normalizedSearchQuery
                ? maskedContractText.toLowerCase().split(normalizedSearchQuery).length - 1
                : 0;
              const searchResultCount = isTextModal ? textMatchCount : visibleRules.length;
              const safeSearchIndex = searchResultCount > 0
                ? Math.min(contractContentSearchIndex, searchResultCount - 1)
                : 0;
              const versionStatus = resolveContractVersionStatus(selectedVersion?.status);
              const selectedVersionNormalizedStatus = normalizeContractVersionStatusValue(selectedVersion?.status);
              const isSelectedActiveVersion =
                storeContractActiveVersion?.id === contractContentModal.versionId ||
                selectedVersionNormalizedStatus === "active";
              const canReviewSelectedVersionRules = canReviewRulesForStoreContractVersion({
                version: selectedVersion,
                isActiveVersion: isSelectedActiveVersion,
              });

              const moveSearchResult = (direction: -1 | 1) => {
                if (searchResultCount <= 0) return;
                setContractContentSearchIndex((current) => {
                  const normalizedCurrent = Math.min(current, searchResultCount - 1);
                  return (normalizedCurrent + direction + searchResultCount) % searchResultCount;
                });
              };

              const closeModal = () => {
                setContractContentModal(null);
                setContractContentSearchQuery("");
                setContractContentSearchIndex(0);
              };

              return (
                <>
                  <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-5 py-4 sm:px-7 sm:py-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gray-500">
                          Contratos
                        </div>
                        <h2 className="mt-1 text-xl font-bold text-gray-950 sm:text-2xl">{title}</h2>
                        <p className="mt-1 break-words text-sm text-gray-600">
                          {cleanText(selectedVersion?.original_filename) || "Arquivo sem nome"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-700">
                            Versão {selectedVersion?.version_number ?? "—"}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusToneClass(
                              versionStatus.tone
                            )}`}
                          >
                            {versionStatus.label}
                          </span>
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                            Dados sensíveis ocultos
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={closeModal}
                        className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
                      >
                        Fechar
                      </button>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative min-w-0 flex-1">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">⌕</span>
                        <input
                          value={contractContentSearchQuery}
                          onChange={(event) => {
                            setContractContentSearchQuery(event.target.value);
                            setContractContentSearchIndex(0);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || !normalizedSearchQuery) return;
                            event.preventDefault();
                            moveSearchResult(event.shiftKey ? -1 : 1);
                          }}
                          placeholder={isTextModal ? "Buscar no contrato" : "Buscar nas regras encontradas"}
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-gray-400 focus:bg-white"
                        />
                      </div>
                      {normalizedSearchQuery ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="min-w-[72px] text-center text-xs font-medium text-gray-500">
                            {searchResultCount > 0 ? `${safeSearchIndex + 1} de ${searchResultCount}` : "0 de 0"}
                          </span>
                          <button
                            type="button"
                            onClick={() => moveSearchResult(-1)}
                            disabled={searchResultCount === 0}
                            aria-label="Resultado anterior"
                            title="Resultado anterior (Shift + Enter)"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-base font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                          >↑</button>
                          <button
                            type="button"
                            onClick={() => moveSearchResult(1)}
                            disabled={searchResultCount === 0}
                            aria-label="Próximo resultado"
                            title="Próximo resultado (Enter)"
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-base font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                          >↓</button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
                    {isTextModal ? (
                      <div className="mx-auto max-w-[1120px]">
                        <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
                          <div className="font-semibold">Conteúdo extraído</div>
                          <div className="mt-1 text-xs leading-5 text-sky-900">
                            O ZION identificou o texto abaixo no arquivo. Dados pessoais sensíveis são ocultados nesta visualização para facilitar uma revisão segura.
                          </div>
                        </div>

                        <article className="min-h-[68vh] rounded-2xl border border-gray-200 bg-white px-6 py-7 shadow-sm sm:px-10 sm:py-10">
                          <div className="mb-6 border-b border-gray-100 pb-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">
                              Documento extraído
                            </div>
                            <div className="mt-1 text-sm font-semibold text-gray-700">
                              {cleanText(selectedVersion?.original_filename) || "Arquivo sem nome"}
                            </div>
                          </div>
                          <div className="whitespace-pre-wrap break-words font-sans text-[15px] leading-7 text-gray-800 sm:text-base sm:leading-8">
                            {renderHighlightedContractText(maskedContractText, contractContentSearchQuery, normalizedSearchQuery ? safeSearchIndex : null)}
                          </div>
                        </article>
                      </div>
                    ) : selectedRules.length === 0 ? (
                      <div className="mx-auto max-w-[1120px] rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-600">
                        Nenhuma regra encontrada ainda.
                      </div>
                    ) : visibleRules.length === 0 ? (
                      <div className="mx-auto max-w-[1120px] rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-600">
                        Nenhuma regra corresponde à busca atual.
                      </div>
                    ) : (
                      <div className="mx-auto max-w-[1220px] space-y-4">
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
                          <div className="font-semibold">Revisão das regras encontradas</div>
                          <div className="mt-1 text-xs leading-5 text-sky-900">
                            Revise cada regra antes de usá-la como referência. Você pode aprovar, ignorar ou ajustar o texto encontrado sem alterar o arquivo original.
                          </div>
                        </div>

                        {visibleRules.map((rule, ruleResultIndex) => (
                          (() => {
                            const ruleStatus = resolveContractRuleStatus(rule.review_status);
                            const isEditing =
                              canReviewSelectedVersionRules && contractRuleEditingIds[rule.id] === true;
                            const isRuleBusy = contractRuleActionRuleId === rule.id;
                            const ruleDraft =
                              contractRuleEditDrafts[rule.id] ?? cleanText(rule.value_text) ?? "";
                            const ruleValue = maskSensitiveContractPreview(
                              cleanText(rule.value_text) || "Trecho não disponível"
                            );
                            const sourceExcerpt = cleanText(rule.source_excerpt)
                              ? maskSensitiveContractPreview(cleanText(rule.source_excerpt))
                              : null;

                            return (
                              <section
                                key={rule.id}
                                data-contract-rule-result-index={ruleResultIndex}
                                data-contract-current-search-target={
                                  normalizedSearchQuery && ruleResultIndex === safeSearchIndex ? "true" : undefined
                                }
                                className={`rounded-2xl border bg-white p-5 shadow-sm transition sm:p-6 ${
                                  normalizedSearchQuery && ruleResultIndex === safeSearchIndex
                                    ? "border-amber-300 ring-2 ring-amber-300/40"
                                    : "border-gray-200"
                                }`}
                              >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0">
                                    <div className="text-base font-bold text-gray-950 sm:text-lg">
                                      {renderHighlightedContractText(
                                        cleanText(rule.label) || "Regra encontrada",
                                        contractContentSearchQuery
                                      )}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <span
                                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusToneClass(
                                          ruleStatus.tone
                                        )}`}
                                      >
                                        {ruleStatus.label}
                                      </span>
                                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">
                                        {resolveContractRuleGroupLabel(rule.rule_group)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {!isEditing ? (
                                  <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-[15px] leading-7 text-gray-800">
                                    {renderHighlightedContractText(ruleValue, contractContentSearchQuery)}
                                  </div>
                                ) : (
                                  <div className="mt-5 space-y-2">
                                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                                      Editar texto
                                    </div>
                                    <textarea
                                      value={ruleDraft}
                                      onChange={(event) =>
                                        setContractRuleEditDrafts((current) => ({
                                          ...current,
                                          [rule.id]: event.target.value,
                                        }))
                                      }
                                      rows={7}
                                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[15px] leading-7 text-gray-900 outline-none transition focus:border-black"
                                    />
                                  </div>
                                )}

                                {sourceExcerpt ? (
                                  <details className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                                    <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
                                      Ver trecho encontrado no contrato
                                    </summary>
                                    <div className="mt-3 whitespace-pre-wrap break-words border-t border-gray-100 pt-3 text-sm leading-6 text-gray-600">
                                      {renderHighlightedContractText(sourceExcerpt, contractContentSearchQuery)}
                                    </div>
                                  </details>
                                ) : null}

                                {canReviewSelectedVersionRules ? (
                                  <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                                    {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "edited",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "save-edit"
                                          ? "Salvando..."
                                          : "Salvar ajuste"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setContractRuleEditingIds((current) => ({
                                            ...current,
                                            [rule.id]: false,
                                          }));
                                          setContractRuleEditDrafts((current) => ({
                                            ...current,
                                            [rule.id]: cleanText(rule.value_text) || "",
                                          }));
                                        }}
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Cancelar
                                      </button>
                                    </>
                                    ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setContractRuleEditingIds((current) => ({
                                            ...current,
                                            [rule.id]: true,
                                          }))
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Editar texto
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "approved",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "approve"
                                          ? "Aprovando..."
                                          : "Aprovar"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "rejected",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "reject"
                                          ? "Ignorando..."
                                          : "Ignorar"}
                                      </button>
                                    </>
                                    )}
                                  </div>
                                ) : null}
                              </section>
                            );
                          })()
                        ))}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {rawImportFilesModalTab ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={() => setRawImportFilesModalTab(null)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 bg-gray-950 px-5 py-4 text-white">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gray-400">
                  Arquivos do upload inteligente
                </div>
                <h2 className="mt-1 text-lg font-bold">{rawImportFilesModalTitle}</h2>
                <p className="mt-1 text-xs text-gray-300">
                  Excluir aqui remove apenas o arquivo bruto e o vínculo de importação. Os itens já salvos no catálogo permanecem.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRawImportFilesModalTab(null)}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Fechar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {rawImportFilesModalFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                  {rawImportFilesModalEmptyText}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rawImportFilesModalFiles.map((file, index) => (
                    <div
                      key={buildImportFileKey(file, index)}
                      className="rounded-2xl border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-gray-900">
                            {cleanText(file.original_file_name) || "Arquivo sem nome"}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Importado em {formatImportDate(file.created_at)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Tipo: {cleanText(file.extension)?.toUpperCase() || cleanText(file.mime_type) || "Não definido"}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Tamanho: {formatFileSize(file.size_bytes)}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Status: {cleanText(file.status) || "Não definido"}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              {getImportSummaryText(file.import_summary || null)}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDownloadImportFile(file)}
                            disabled={
                              downloadingImportFileId === file.id ||
                              deletingImportFileId === file.id
                            }
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {downloadingImportFileId === file.id ? "Gerando..." : "Baixar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteImportFile(file)}
                            disabled={deletingImportFileId === file.id}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingImportFileId === file.id ? "Excluindo..." : "Excluir arquivo"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
