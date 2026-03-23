"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";

type ScheduleItem = {
  itemKind: "appointment" | "block" | string;
  itemId: string;
  organizationId: string;
  storeId: string;
  leadId: string | null;
  conversationId: string | null;
  title: string;
  itemType: string;
  status: string;
  startAt: string;
  endAt: string;
  customerName: string | null;
  customerPhone: string | null;
  addressText: string | null;
  notes: string | null;
  source: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScheduleApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  organizationId?: string;
  storeId?: string;
  start?: string;
  end?: string;
  count?: number;
  items?: ScheduleItem[];
};

type AppointmentEditForm = {
  title: string;
  appointmentType: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  customerName: string;
  customerPhone: string;
  addressText: string;
  notes: string;
};

type AppointmentCreateForm = {
  title: string;
  appointmentType: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  customerName: string;
  customerPhone: string;
  addressText: string;
  notes: string;
};

type BlockCreateForm = {
  title: string;
  blockType: string;
  startAt: string;
  endAt: string;
  notes: string;
};

const WEEKDAY_LABELS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatMonthYear(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function formatDayNumber(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
  });
}

function formatPhone(value: string | null) {
  if (!value) return "-";

  const digits = String(value).replace(/\D/g, "").slice(0, 11);

  if (!digits) return "-";

  if (digits.length <= 2) {
    return `(${digits}`;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function normalizePhoneForSave(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  return digits || null;
}

function applyPhoneMask(value: string) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);

  if (!digits) return "";

  if (digits.length <= 2) {
    return `(${digits}`;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function formatItemKind(value: string) {
  if (value === "appointment") return "Compromisso";
  if (value === "block") return "Bloqueio";
  return value || "-";
}

function formatItemType(value: string) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "technical_visit") return "Visita técnica";
  if (normalized === "installation") return "Instalação";
  if (normalized === "follow_up") return "Retorno";
  if (normalized === "meeting") return "Reunião";
  if (normalized === "personal_unavailable") return "Indisponível";
  if (normalized === "team_unavailable") return "Equipe indisponível";
  if (normalized === "holiday") return "Bloqueio por feriado";
  if (normalized === "manual_block") return "Bloqueio manual";
  if (normalized === "other") return "Outro";
  return value || "-";
}

function formatStatus(value: string) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "scheduled") return "Agendado";
  if (normalized === "rescheduled") return "Remarcado";
  if (normalized === "completed") return "Concluído";
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "blocked") return "Bloqueado";
  return value || "-";
}

function getStatusBadgeClass(status: string) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "scheduled") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (normalized === "rescheduled") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  if (normalized === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (normalized === "cancelled") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (normalized === "blocked") {
    return "bg-gray-100 text-gray-700 ring-gray-300";
  }

  return "bg-gray-50 text-gray-700 ring-gray-200";
}

function getItemChipClass(item: ScheduleItem) {
  if (item.itemKind === "block") {
    return "bg-gray-100 text-gray-800 ring-gray-300";
  }

  const normalized = String(item.status || "").toLowerCase();

  if (normalized === "scheduled") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (normalized === "rescheduled") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  if (normalized === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (normalized === "cancelled") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  return "bg-gray-50 text-gray-700 ring-gray-200";
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfCalendarGrid(date: Date) {
  const firstDay = startOfMonth(date);
  const sundayBasedOffset = firstDay.getDay();
  const result = new Date(firstDay);
  result.setDate(firstDay.getDate() - sundayBasedOffset);
  result.setHours(0, 0, 0, 0);
  return result;
}

function buildCalendarDays(date: Date) {
  const start = startOfCalendarGrid(date);
  const days: Date[] = [];

  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }

  return days;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function itemSpansDate(item: ScheduleItem, date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const itemStart = new Date(item.startAt);
  const itemEnd = new Date(item.endAt);

  if (Number.isNaN(itemStart.getTime()) || Number.isNaN(itemEnd.getTime())) {
    return false;
  }

  return itemStart <= dayEnd && itemEnd >= dayStart;
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function createAppointmentFormFromItem(item: ScheduleItem): AppointmentEditForm {
  return {
    title: item.title || "",
    appointmentType: item.itemType || "technical_visit",
    status:
      item.status && item.status !== "blocked" ? item.status : "scheduled",
    scheduledStart: toDateTimeLocalValue(item.startAt),
    scheduledEnd: toDateTimeLocalValue(item.endAt),
    customerName: item.customerName || "",
    customerPhone: formatPhone(item.customerPhone === null ? "" : item.customerPhone),
    addressText: item.addressText || "",
    notes: item.notes || "",
  };
}

function createDefaultAppointmentCreateForm(
  selectedDateKey: string
): AppointmentCreateForm {
  const base = selectedDateKey
    ? new Date(`${selectedDateKey}T09:00:00`)
    : new Date();

  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setHours(9, 0, 0, 0);

    const fallbackEnd = new Date(fallback);
    fallbackEnd.setHours(10, 0, 0, 0);

    return {
      title: "",
      appointmentType: "technical_visit",
      status: "scheduled",
      scheduledStart: toDateTimeLocalValue(fallback.toISOString()),
      scheduledEnd: toDateTimeLocalValue(fallbackEnd.toISOString()),
      customerName: "",
      customerPhone: "",
      addressText: "",
      notes: "",
    };
  }

  base.setHours(9, 0, 0, 0);

  const end = new Date(base);
  end.setHours(10, 0, 0, 0);

  return {
    title: "",
    appointmentType: "technical_visit",
    status: "scheduled",
    scheduledStart: toDateTimeLocalValue(base.toISOString()),
    scheduledEnd: toDateTimeLocalValue(end.toISOString()),
    customerName: "",
    customerPhone: "",
    addressText: "",
    notes: "",
  };
}

function createDefaultBlockForm(selectedDateKey: string): BlockCreateForm {
  const base = selectedDateKey
    ? new Date(`${selectedDateKey}T09:00:00`)
    : new Date();

  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setHours(9, 0, 0, 0);

    const fallbackEnd = new Date(fallback);
    fallbackEnd.setHours(10, 0, 0, 0);

    return {
      title: "",
      blockType: "manual_block",
      startAt: toDateTimeLocalValue(fallback.toISOString()),
      endAt: toDateTimeLocalValue(fallbackEnd.toISOString()),
      notes: "",
    };
  }

  base.setHours(9, 0, 0, 0);

  const end = new Date(base);
  end.setHours(10, 0, 0, 0);

  return {
    title: "",
    blockType: "manual_block",
    startAt: toDateTimeLocalValue(base.toISOString()),
    endAt: toDateTimeLocalValue(end.toISOString()),
    notes: "",
  };
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export default function SchedulePage() {
  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
    activeStore,
  } = useStoreContext();

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    toDateKey(new Date())
  );
  const [selectedItem, setSelectedItem] = useState<ScheduleItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<AppointmentEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveErrorText, setSaveErrorText] = useState<string | null>(null);

  const [createBlockOpen, setCreateBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState<BlockCreateForm>(() =>
    createDefaultBlockForm(toDateKey(new Date()))
  );
  const [savingBlock, setSavingBlock] = useState(false);
  const [blockErrorText, setBlockErrorText] = useState<string | null>(null);

  const [createAppointmentOpen, setCreateAppointmentOpen] = useState(false);
  const [appointmentCreateForm, setAppointmentCreateForm] =
    useState<AppointmentCreateForm>(() =>
      createDefaultAppointmentCreateForm(toDateKey(new Date()))
    );
  const [savingAppointmentCreate, setSavingAppointmentCreate] = useState(false);
  const [appointmentCreateErrorText, setAppointmentCreateErrorText] =
    useState<string | null>(null);

  const lastKnownRealMonthRef = useRef<Date>(startOfMonth(new Date()));
  const selectedItemRef = useRef<ScheduleItem | null>(null);
  const editModeRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const canLoadSchedule = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const monthStart = useMemo(() => startOfMonth(viewMonth), [viewMonth]);
  const monthEnd = useMemo(() => endOfMonth(viewMonth), [viewMonth]);
  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);

  const loadSchedule = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadSchedule || !organizationId || !activeStoreId) {
        return;
      }

      const currentRequestId = ++loadRequestIdRef.current;

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      try {
        const params = new URLSearchParams({
          organizationId,
          storeId: activeStoreId,
          start: monthStart.toISOString(),
          end: monthEnd.toISOString(),
        });

        const response = await fetch(`/api/schedule?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        const json = (await response.json()) as ScheduleApiResponse;

        if (currentRequestId !== loadRequestIdRef.current) {
          return;
        }

        if (!response.ok || !json.ok) {
          setItems([]);
          setErrorText(json.message || "Erro ao carregar agenda.");

          if (silent) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
          return;
        }

        const nextItems = json.items || [];
        setItems(nextItems);

        const currentSelectedItem = selectedItemRef.current;

        if (currentSelectedItem) {
          const refreshedSelectedItem =
            nextItems.find((item) => item.itemId === currentSelectedItem.itemId) || null;

          setSelectedItem(refreshedSelectedItem);

          if (refreshedSelectedItem && editModeRef.current) {
            setEditForm(createAppointmentFormFromItem(refreshedSelectedItem));
          }

          if (!refreshedSelectedItem) {
            setEditMode(false);
            setEditForm(null);
            setSaveErrorText(null);
          }
        }

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      } catch (error: any) {
        if (currentRequestId !== loadRequestIdRef.current) {
          return;
        }

        setItems([]);
        setErrorText(error?.message || "Erro inesperado ao carregar agenda.");

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [canLoadSchedule, organizationId, activeStoreId, monthStart, monthEnd]
  );

  useEffect(() => {
    if (!canLoadSchedule) return;
    void loadSchedule();
  }, [canLoadSchedule, loadSchedule]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nowMonth = startOfMonth(new Date());
      const lastKnownMonth = lastKnownRealMonthRef.current;
      const realMonthChanged = !isSameMonth(nowMonth, lastKnownMonth);

      if (realMonthChanged) {
        const userWasOnCurrentMonth = isSameMonth(viewMonth, lastKnownMonth);

        lastKnownRealMonthRef.current = nowMonth;

        if (userWasOnCurrentMonth) {
          setViewMonth(nowMonth);
          setSelectedDateKey(toDateKey(new Date()));
        }
      }
    }, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, [viewMonth]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};

    calendarDays.forEach((day) => {
      map[toDateKey(day)] = [];
    });

    items.forEach((item) => {
      calendarDays.forEach((day) => {
        if (itemSpansDate(item, day)) {
          const key = toDateKey(day);
          map[key] = map[key] || [];
          map[key].push(item);
        }
      });
    });

    Object.keys(map).forEach((key) => {
      map[key].sort((a, b) => {
        const aTime = new Date(a.startAt).getTime();
        const bTime = new Date(b.startAt).getTime();
        return aTime - bTime;
      });
    });

    return map;
  }, [calendarDays, items]);

  const selectedDateItems = useMemo(() => {
    return itemsByDate[selectedDateKey] || [];
  }, [itemsByDate, selectedDateKey]);

  const counts = useMemo(() => {
    const appointments = items.filter((item) => item.itemKind === "appointment").length;
    const blocks = items.filter((item) => item.itemKind === "block").length;

    return {
      total: items.length,
      appointments,
      blocks,
    };
  }, [items]);

  const selectedDateLabel = useMemo(() => {
    const [year, month, day] = selectedDateKey.split("-");
    const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);

    if (Number.isNaN(date.getTime())) return selectedDateKey;

    return date.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }, [selectedDateKey]);

  function goToPreviousMonth() {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function goToCurrentMonth() {
    const now = new Date();
    setViewMonth(startOfMonth(now));
    setSelectedDateKey(toDateKey(now));
  }

  function openItemDetails(item: ScheduleItem) {
    selectedItemRef.current = item;
    editModeRef.current = false;

    setSelectedItem(item);
    setEditMode(false);
    setSaveErrorText(null);

    if (item.itemKind === "appointment") {
      setEditForm(createAppointmentFormFromItem(item));
    } else {
      setEditForm(null);
    }
  }

  function closeItemDetails() {
    selectedItemRef.current = null;
    editModeRef.current = false;

    setSelectedItem(null);
    setEditMode(false);
    setEditForm(null);
    setSaveErrorText(null);
  }

  function startEditingSelectedItem() {
    if (!selectedItem || selectedItem.itemKind !== "appointment") return;
    setEditForm(createAppointmentFormFromItem(selectedItem));
    setEditMode(true);
    editModeRef.current = true;
    setSaveErrorText(null);
  }

  function cancelEditingSelectedItem() {
    if (!selectedItem || selectedItem.itemKind !== "appointment") {
      setEditMode(false);
      editModeRef.current = false;
      setEditForm(null);
      setSaveErrorText(null);
      return;
    }

    setEditForm(createAppointmentFormFromItem(selectedItem));
    setEditMode(false);
    editModeRef.current = false;
    setSaveErrorText(null);
  }

  function openCreateBlockPanel() {
    setCreateBlockOpen(true);
    setBlockErrorText(null);
    setBlockForm(createDefaultBlockForm(selectedDateKey));
  }

  function closeCreateBlockPanel() {
    setCreateBlockOpen(false);
    setBlockErrorText(null);
    setSavingBlock(false);
    setBlockForm(createDefaultBlockForm(selectedDateKey));
  }

  function openCreateAppointmentPanel() {
    setCreateAppointmentOpen(true);
    setAppointmentCreateErrorText(null);
    setAppointmentCreateForm(createDefaultAppointmentCreateForm(selectedDateKey));
  }

  function closeCreateAppointmentPanel() {
    setCreateAppointmentOpen(false);
    setAppointmentCreateErrorText(null);
    setSavingAppointmentCreate(false);
    setAppointmentCreateForm(createDefaultAppointmentCreateForm(selectedDateKey));
  }

  async function saveAppointmentEdit() {
    if (!selectedItem || selectedItem.itemKind !== "appointment" || !editForm) {
      return;
    }

    if (!organizationId || !activeStoreId) {
      setSaveErrorText("Contexto da loja não encontrado.");
      return;
    }

    setSavingEdit(true);
    setSaveErrorText(null);

    try {
      const startDate = new Date(editForm.scheduledStart);
      const endDate = new Date(editForm.scheduledEnd);

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setSaveErrorText("Preencha um período válido.");
        setSavingEdit(false);
        return;
      }

      const { data, error } = await supabase.rpc("update_store_appointment", {
        p_appointment_id: selectedItem.itemId,
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_title: editForm.title,
        p_appointment_type: editForm.appointmentType,
        p_status: editForm.status,
        p_scheduled_start: startDate.toISOString(),
        p_scheduled_end: endDate.toISOString(),
        p_customer_name: editForm.customerName || null,
        p_customer_phone: normalizePhoneForSave(editForm.customerPhone),
        p_address_text: editForm.addressText || null,
        p_notes: editForm.notes || null,
      });

      if (error) {
        setSaveErrorText(error.message);
        setSavingEdit(false);
        return;
      }

      const updatedItem = data
        ? ({
            itemKind: "appointment",
            itemId: data.id,
            organizationId: data.organization_id,
            storeId: data.store_id,
            leadId: data.lead_id,
            conversationId: data.conversation_id,
            title: data.title,
            itemType: data.appointment_type,
            status: data.status,
            startAt: data.scheduled_start,
            endAt: data.scheduled_end,
            customerName: data.customer_name,
            customerPhone: data.customer_phone,
            addressText: data.address_text,
            notes: data.notes,
            source: data.source,
            createdByUserId: data.created_by_user_id,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          } as ScheduleItem)
        : null;

      if (updatedItem) {
        selectedItemRef.current = updatedItem;
        setSelectedItem(updatedItem);
        setEditForm(createAppointmentFormFromItem(updatedItem));
      }

      setEditMode(false);
      editModeRef.current = false;

      await loadSchedule({ silent: true });
      setSavingEdit(false);
    } catch (error: any) {
      setSaveErrorText(error?.message || "Erro inesperado ao salvar compromisso.");
      setSavingEdit(false);
    }
  }

  async function cancelAppointment() {
    if (!selectedItem || selectedItem.itemKind !== "appointment") return;

    if (!organizationId || !activeStoreId) {
      setSaveErrorText("Contexto da loja não encontrado.");
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja cancelar este compromisso?"
    );

    if (!confirmed) return;

    setSavingEdit(true);
    setSaveErrorText(null);

    try {
      const { data, error } = await supabase.rpc("cancel_store_appointment", {
        p_appointment_id: selectedItem.itemId,
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_cancel_reason: "Cancelado manualmente pelo assinante na tela da agenda.",
      });

      if (error) {
        setSaveErrorText(error.message);
        setSavingEdit(false);
        return;
      }

      const updatedItem = data
        ? ({
            itemKind: "appointment",
            itemId: data.id,
            organizationId: data.organization_id,
            storeId: data.store_id,
            leadId: data.lead_id,
            conversationId: data.conversation_id,
            title: data.title,
            itemType: data.appointment_type,
            status: data.status,
            startAt: data.scheduled_start,
            endAt: data.scheduled_end,
            customerName: data.customer_name,
            customerPhone: data.customer_phone,
            addressText: data.address_text,
            notes: data.notes,
            source: data.source,
            createdByUserId: data.created_by_user_id,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          } as ScheduleItem)
        : null;

      if (updatedItem) {
        selectedItemRef.current = updatedItem;
        setSelectedItem(updatedItem);
        setEditForm(createAppointmentFormFromItem(updatedItem));
      }

      setEditMode(false);
      editModeRef.current = false;

      await loadSchedule({ silent: true });
      setSavingEdit(false);
    } catch (error: any) {
      setSaveErrorText(
        error?.message || "Erro inesperado ao cancelar compromisso."
      );
      setSavingEdit(false);
    }
  }

  async function saveNewBlock() {
    if (!organizationId || !activeStoreId) {
      setBlockErrorText("Contexto da loja não encontrado.");
      return;
    }

    setSavingBlock(true);
    setBlockErrorText(null);

    try {
      const startDate = new Date(blockForm.startAt);
      const endDate = new Date(blockForm.endAt);

      if (!blockForm.title.trim()) {
        setBlockErrorText("Preencha o título do bloqueio.");
        setSavingBlock(false);
        return;
      }

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setBlockErrorText("Preencha um período válido.");
        setSavingBlock(false);
        return;
      }

      const { error } = await supabase.rpc("create_store_schedule_block", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_title: blockForm.title.trim(),
        p_block_type: blockForm.blockType,
        p_start_at: startDate.toISOString(),
        p_end_at: endDate.toISOString(),
        p_notes: blockForm.notes.trim() || null,
        p_source: "panel",
        p_created_by_user_id: null,
      });

      if (error) {
        setBlockErrorText(error.message);
        setSavingBlock(false);
        return;
      }

      closeCreateBlockPanel();
      await loadSchedule({ silent: true });
      setSavingBlock(false);
    } catch (error: any) {
      setBlockErrorText(error?.message || "Erro inesperado ao criar bloqueio.");
      setSavingBlock(false);
    }
  }

  async function saveNewAppointment() {
    if (!organizationId || !activeStoreId) {
      setAppointmentCreateErrorText("Contexto da loja não encontrado.");
      return;
    }

    setSavingAppointmentCreate(true);
    setAppointmentCreateErrorText(null);

    try {
      const startDate = new Date(appointmentCreateForm.scheduledStart);
      const endDate = new Date(appointmentCreateForm.scheduledEnd);

      if (!appointmentCreateForm.title.trim()) {
        setAppointmentCreateErrorText("Preencha o título do compromisso.");
        setSavingAppointmentCreate(false);
        return;
      }

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setAppointmentCreateErrorText("Preencha um período válido.");
        setSavingAppointmentCreate(false);
        return;
      }

      const { error } = await supabase.rpc("create_store_appointment", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_lead_id: null,
        p_conversation_id: null,
        p_title: appointmentCreateForm.title.trim(),
        p_appointment_type: appointmentCreateForm.appointmentType,
        p_status: appointmentCreateForm.status,
        p_scheduled_start: startDate.toISOString(),
        p_scheduled_end: endDate.toISOString(),
        p_customer_name: appointmentCreateForm.customerName.trim() || null,
        p_customer_phone: normalizePhoneForSave(appointmentCreateForm.customerPhone),
        p_address_text: appointmentCreateForm.addressText.trim() || null,
        p_notes: appointmentCreateForm.notes.trim() || null,
        p_source: "panel",
        p_created_by_user_id: null,
      });

      if (error) {
        setAppointmentCreateErrorText(error.message);
        setSavingAppointmentCreate(false);
        return;
      }

      closeCreateAppointmentPanel();
      await loadSchedule({ silent: true });
      setSavingAppointmentCreate(false);
    } catch (error: any) {
      setAppointmentCreateErrorText(
        error?.message || "Erro inesperado ao criar compromisso."
      );
      setSavingAppointmentCreate(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Agenda</h1>

            <p className="mt-1 text-sm text-gray-600">
              Agenda mensal da loja, com visual simples, leitura rápida e controle
              manual dos compromissos e bloqueios.
            </p>

            <div className="mt-2 text-xs text-gray-500">
              {storeLoading
                ? "Carregando contexto da loja..."
                : storeError
                ? `Erro no contexto da loja: ${storeError}`
                : `Loja ativa: ${activeStore?.name ?? "Sem loja ativa"} • Organização: ${
                    organizationId ?? "-"
                  }`}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={openCreateAppointmentPanel}
              disabled={storeLoading || !organizationId || !activeStoreId}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Novo compromisso
            </button>

            <button
              onClick={openCreateBlockPanel}
              disabled={storeLoading || !organizationId || !activeStoreId}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Novo bloqueio
            </button>

            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}

            <button
              onClick={() => void loadSchedule()}
              disabled={loading || storeLoading || !organizationId || !activeStoreId}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recarregar
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Total de itens</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{counts.total}</div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Compromissos</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">
              {counts.appointments}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Bloqueios</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{counts.blocks}</div>
          </div>
        </div>

        {errorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-bold capitalize text-gray-900">
                  {formatMonthYear(viewMonth)}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  O mês atual é carregado automaticamente. Quando o mês virar, a tela
                  acompanha sozinha se você estiver olhando o mês atual.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={goToPreviousMonth}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Mês anterior
                </button>

                <button
                  onClick={goToCurrentMonth}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Hoje
                </button>

                <button
                  onClick={goToNextMonth}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Próximo mês
                </button>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-7 gap-2">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="rounded-xl bg-gray-50 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500"
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((date) => {
                const dayKey = toDateKey(date);
                const dayItems = itemsByDate[dayKey] || [];
                const isCurrentMonth = date.getMonth() === viewMonth.getMonth();
                const isToday = dayKey === toDateKey(new Date());
                const isSelected = dayKey === selectedDateKey;

                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => setSelectedDateKey(dayKey)}
                    className={[
                      "min-h-[140px] rounded-2xl border p-3 text-left transition",
                      isSelected
                        ? "border-black bg-black/[0.03] ring-2 ring-black/10"
                        : "border-black/10 bg-white hover:bg-gray-50",
                      !isCurrentMonth ? "opacity-45" : "",
                    ].join(" ")}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span
                        className={[
                          "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                          isToday
                            ? "bg-black text-white"
                            : "bg-transparent text-gray-900",
                        ].join(" ")}
                      >
                        {formatDayNumber(date)}
                      </span>

                      <span className="text-xs text-gray-400">
                        {dayItems.length > 0 ? `${dayItems.length} item(ns)` : ""}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {dayItems.slice(0, 3).map((item) => (
                        <div
                          key={`${dayKey}-${item.itemId}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            openItemDetails(item);
                          }}
                          className={`cursor-pointer rounded-xl px-2.5 py-2 text-xs font-semibold ring-1 ${getItemChipClass(
                            item
                          )}`}
                        >
                          <div className="truncate">
                            {item.itemKind === "block" ? "Bloqueio" : "Compromisso"}
                          </div>
                          <div className="mt-0.5 truncate font-medium">
                            {item.title || "-"}
                          </div>
                        </div>
                      ))}

                      {dayItems.length > 3 ? (
                        <div className="text-xs font-semibold text-gray-500">
                          +{dayItems.length - 3} item(ns)
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-lg font-bold text-gray-900">Itens do dia</h2>
              <p className="mt-1 text-sm capitalize text-gray-500">
                {selectedDateLabel}
              </p>

              <div className="mt-4 space-y-3">
                {loading || storeLoading ? (
                  <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
                    Carregando itens do dia...
                  </div>
                ) : selectedDateItems.length === 0 ? (
                  <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
                    Nenhum item nesse dia.
                  </div>
                ) : (
                  selectedDateItems.map((item) => (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => openItemDetails(item)}
                      className="w-full rounded-2xl border border-black/10 bg-white p-4 text-left transition hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-900">
                            {item.title}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {formatItemKind(item.itemKind)} •{" "}
                            {formatItemType(item.itemType)}
                          </div>
                        </div>

                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${getStatusBadgeClass(
                            item.status
                          )}`}
                        >
                          {formatStatus(item.status)}
                        </span>
                      </div>

                      <div className="mt-3 text-sm text-gray-600">
                        {formatDateTime(item.startAt)} até {formatDateTime(item.endAt)}
                      </div>

                      {item.customerName ? (
                        <div className="mt-1 text-xs text-gray-500">
                          Cliente: {item.customerName}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="text-lg font-bold text-gray-900">Resumo do mês</h2>

              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                  <span className="text-gray-600">Total</span>
                  <span className="font-bold text-gray-900">{counts.total}</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                  <span className="text-gray-600">Compromissos</span>
                  <span className="font-bold text-gray-900">
                    {counts.appointments}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                  <span className="text-gray-600">Bloqueios</span>
                  <span className="font-bold text-gray-900">{counts.blocks}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {selectedItem ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={closeItemDetails}
          >
            <div
              className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-6 py-5">
                <div>
                  <div className="text-sm font-semibold text-gray-500">
                    {formatItemKind(selectedItem.itemKind)}
                  </div>
                  <h3 className="mt-1 text-2xl font-bold text-gray-900">
                    {selectedItem.title}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeItemDetails}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {saveErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {saveErrorText}
                  </div>
                ) : null}

                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${getStatusBadgeClass(
                      selectedItem.status
                    )}`}
                  >
                    {formatStatus(selectedItem.status)}
                  </span>

                  <span className="rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                    {formatItemType(selectedItem.itemType)}
                  </span>
                </div>

                {selectedItem.itemKind === "appointment" && !editMode ? (
                  <div className="mb-5 flex flex-wrap gap-3">
                    <button
                      onClick={startEditingSelectedItem}
                      className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    >
                      Editar
                    </button>

                    <button
                      onClick={() => void cancelAppointment()}
                      disabled={savingEdit || selectedItem.status === "cancelled"}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancelar compromisso
                    </button>
                  </div>
                ) : null}

                {selectedItem.itemKind === "block" ? (
                  <div className="mb-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
                    A edição de bloqueio ainda não está conectada ao banco. A leitura e
                    criação já estão prontas, mas para salvar edição de bloqueios ainda
                    precisamos criar a função segura específica.
                  </div>
                ) : null}

                {selectedItem.itemKind === "appointment" && editMode && editForm ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Título
                        </label>
                        <input
                          value={editForm.title}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, title: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Tipo
                        </label>
                        <select
                          value={editForm.appointmentType}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev
                                ? { ...prev, appointmentType: e.target.value }
                                : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        >
                          <option value="technical_visit">Visita técnica</option>
                          <option value="installation">Instalação</option>
                          <option value="follow_up">Retorno</option>
                          <option value="meeting">Reunião</option>
                          <option value="other">Outro</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Status
                        </label>
                        <select
                          value={editForm.status}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, status: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        >
                          <option value="scheduled">Agendado</option>
                          <option value="rescheduled">Remarcado</option>
                          <option value="completed">Concluído</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Cliente
                        </label>
                        <input
                          value={editForm.customerName}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev
                                ? { ...prev, customerName: e.target.value }
                                : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Início
                        </label>
                        <input
                          type="datetime-local"
                          value={editForm.scheduledStart}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev
                                ? { ...prev, scheduledStart: e.target.value }
                                : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Fim
                        </label>
                        <input
                          type="datetime-local"
                          value={editForm.scheduledEnd}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, scheduledEnd: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Telefone
                        </label>
                        <input
                          value={editForm.customerPhone}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    customerPhone: applyPhoneMask(e.target.value),
                                  }
                                : prev
                            )
                          }
                          placeholder="(11) 99999-9999"
                          inputMode="numeric"
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-semibold text-gray-700">
                          Endereço
                        </label>
                        <input
                          value={editForm.addressText}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev
                                ? { ...prev, addressText: e.target.value }
                                : prev
                            )
                          }
                          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Observações
                      </label>
                      <textarea
                        value={editForm.notes}
                        onChange={(e) =>
                          setEditForm((prev) =>
                            prev ? { ...prev, notes: e.target.value } : prev
                          )
                        }
                        rows={5}
                        className="w-full rounded-2xl border border-black/10 px-3 py-3 text-sm outline-none focus:border-black"
                      />
                    </div>

                    <div className="flex flex-wrap gap-3 pt-2">
                      <button
                        onClick={() => void saveAppointmentEdit()}
                        disabled={savingEdit}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingEdit ? "Salvando..." : "Salvar alterações"}
                      </button>

                      <button
                        onClick={cancelEditingSelectedItem}
                        disabled={savingEdit}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancelar edição
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Início
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900">
                        {formatDateTime(selectedItem.startAt)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Fim
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900">
                        {formatDateTime(selectedItem.endAt)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Cliente
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900">
                        {selectedItem.customerName || "-"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {formatPhone(selectedItem.customerPhone)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Endereço
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm font-medium text-gray-900">
                        {selectedItem.addressText || "-"}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Observações
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm font-medium text-gray-900">
                        {selectedItem.notes || "-"}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Origem
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900">
                        {selectedItem.source || "-"}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {createBlockOpen ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={closeCreateBlockPanel}
          >
            <div
              className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-6 py-5">
                <div>
                  <div className="text-sm font-semibold text-gray-500">
                    Novo bloqueio
                  </div>
                  <h3 className="mt-1 text-2xl font-bold text-gray-900">
                    Criar bloqueio manual
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeCreateBlockPanel}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {blockErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {blockErrorText}
                  </div>
                ) : null}

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Título
                    </label>
                    <input
                      value={blockForm.title}
                      onChange={(e) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      placeholder="Ex.: Consulta médica, viagem, equipe ocupada..."
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Tipo do bloqueio
                    </label>
                    <select
                      value={blockForm.blockType}
                      onChange={(e) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          blockType: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    >
                      <option value="manual_block">Bloqueio manual</option>
                      <option value="personal_unavailable">Indisponível</option>
                      <option value="team_unavailable">Equipe indisponível</option>
                      <option value="holiday">Feriado</option>
                      <option value="other">Outro</option>
                    </select>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Início
                      </label>
                      <input
                        type="datetime-local"
                        value={blockForm.startAt}
                        onChange={(e) =>
                          setBlockForm((prev) => ({
                            ...prev,
                            startAt: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Fim
                      </label>
                      <input
                        type="datetime-local"
                        value={blockForm.endAt}
                        onChange={(e) =>
                          setBlockForm((prev) => ({
                            ...prev,
                            endAt: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Observações
                    </label>
                    <textarea
                      value={blockForm.notes}
                      onChange={(e) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                      rows={5}
                      className="w-full rounded-2xl border border-black/10 px-3 py-3 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => void saveNewBlock()}
                      disabled={savingBlock}
                      className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingBlock ? "Salvando..." : "Salvar bloqueio"}
                    </button>

                    <button
                      onClick={closeCreateBlockPanel}
                      disabled={savingBlock}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {createAppointmentOpen ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={closeCreateAppointmentPanel}
          >
            <div
              className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-6 py-5">
                <div>
                  <div className="text-sm font-semibold text-gray-500">
                    Novo compromisso
                  </div>
                  <h3 className="mt-1 text-2xl font-bold text-gray-900">
                    Criar compromisso manual
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeCreateAppointmentPanel}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {appointmentCreateErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {appointmentCreateErrorText}
                  </div>
                ) : null}

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Título
                    </label>
                    <input
                      value={appointmentCreateForm.title}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      placeholder="Ex.: Visita técnica na casa do cliente"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Tipo
                      </label>
                      <select
                        value={appointmentCreateForm.appointmentType}
                        onChange={(e) =>
                          setAppointmentCreateForm((prev) => ({
                            ...prev,
                            appointmentType: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      >
                        <option value="technical_visit">Visita técnica</option>
                        <option value="installation">Instalação</option>
                        <option value="follow_up">Retorno</option>
                        <option value="meeting">Reunião</option>
                        <option value="other">Outro</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Status inicial
                      </label>
                      <select
                        value={appointmentCreateForm.status}
                        onChange={(e) =>
                          setAppointmentCreateForm((prev) => ({
                            ...prev,
                            status: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      >
                        <option value="scheduled">Agendado</option>
                        <option value="rescheduled">Remarcado</option>
                        <option value="completed">Concluído</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Início
                      </label>
                      <input
                        type="datetime-local"
                        value={appointmentCreateForm.scheduledStart}
                        onChange={(e) =>
                          setAppointmentCreateForm((prev) => ({
                            ...prev,
                            scheduledStart: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-gray-700">
                        Fim
                      </label>
                      <input
                        type="datetime-local"
                        value={appointmentCreateForm.scheduledEnd}
                        onChange={(e) =>
                          setAppointmentCreateForm((prev) => ({
                            ...prev,
                            scheduledEnd: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Cliente
                    </label>
                    <input
                      value={appointmentCreateForm.customerName}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          customerName: e.target.value,
                        }))
                      }
                      placeholder="Nome do cliente"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Telefone
                    </label>
                    <input
                      value={appointmentCreateForm.customerPhone}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          customerPhone: applyPhoneMask(e.target.value),
                        }))
                      }
                      placeholder="(11) 99999-9999"
                      inputMode="numeric"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Endereço
                    </label>
                    <input
                      value={appointmentCreateForm.addressText}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          addressText: e.target.value,
                        }))
                      }
                      placeholder="Endereço do atendimento"
                      className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-gray-700">
                      Observações
                    </label>
                    <textarea
                      value={appointmentCreateForm.notes}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                      rows={5}
                      className="w-full rounded-2xl border border-black/10 px-3 py-3 text-sm outline-none focus:border-black"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      onClick={() => void saveNewAppointment()}
                      disabled={savingAppointmentCreate}
                      className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingAppointmentCreate ? "Salvando..." : "Salvar compromisso"}
                    </button>

                    <button
                      onClick={closeCreateAppointmentPanel}
                      disabled={savingAppointmentCreate}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}