"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useStoreContext } from "@/components/StoreProvider";
import {
  TechnicalVisitStageProjectionError,
  projectTechnicalVisitStageByUser,
  shouldAttemptTechnicalVisitStageProjection,
} from "@/lib/commercial-opportunity-visit-stage-projection";
import {
  buildCommercialOpportunitySelectOptions,
  isCommercialOpportunitySelectionCompatible,
  resolveCommercialOpportunityIdForAppointmentCreate,
  type LeadCommercialOpportunityOption,
} from "./appointment-create-contract";

type ScheduleItem = {
  itemKind: "appointment" | "block" | string;
  itemId: string;
  organizationId: string;
  storeId: string;
  leadId: string | null;
  conversationId: string | null;
  commercialOpportunityId?: string | null;
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
  leadId: string;
  conversationId: string;
  commercialOpportunityId: string;
};

type LeadConversationOption = {
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadState: string | null;
  conversationId: string | null;
  conversationStatus: string | null;
  isHumanActive: boolean | null;
  lastMessageAt: string | null;
};

type CreateLeadConversationState = {
  leadId: string | null;
  status: "idle" | "loading" | "resolved" | "not_found";
  conversationId: string | null;
  conversationStatus: string | null;
  isHumanActive: boolean | null;
  lastMessageAt: string | null;
};

type BlockForm = {
  title: string;
  blockType: string;
  startAt: string;
  endAt: string;
  notes: string;
};

type CalendarView = "day" | "week" | "month";

const WEEKDAY_LABELS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];
const TIMELINE_HOUR_HEIGHT = 72;
const TIMELINE_HOURS = Array.from({ length: 24 }, (_, index) => index);

const SCHEDULE_TYPE_LEGEND = [
  { value: "technical_visit", label: "Visita técnica", dotClass: "bg-blue-600" },
  { value: "installation", label: "Instalação", dotClass: "bg-green-600" },
  { value: "follow_up", label: "Retorno", dotClass: "bg-yellow-400" },
  { value: "meeting", label: "Reunião", dotClass: "bg-cyan-500" },
  { value: "measurement", label: "Medição", dotClass: "bg-[#8B5A2B]" },
  { value: "maintenance", label: "Manutenção", dotClass: "bg-orange-500" },
  { value: "block", label: "Bloqueio", dotClass: "bg-slate-600" },
] as const;

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatMonthYear(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
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

function buildGoogleMapsDirectionsUrl(address: string | null | undefined) {
  const normalizedAddress = String(address || "").trim();

  if (!normalizedAddress) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    normalizedAddress
  )}`;
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
  if (normalized === "measurement") return "Medição";
  if (normalized === "maintenance") return "Manutenção";
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
    return "bg-sky-50 text-sky-700 ring-sky-200";
  }

  if (normalized === "rescheduled") {
    return "bg-amber-50 text-amber-800 ring-amber-300";
  }

  if (normalized === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (normalized === "cancelled") {
    return "bg-slate-100 text-slate-600 ring-slate-300";
  }

  if (normalized === "blocked") {
    return "bg-slate-100 text-slate-700 ring-slate-300";
  }

  return "bg-gray-50 text-gray-700 ring-gray-200";
}

function getItemTypeClass(item: ScheduleItem) {
  if (item.itemKind === "block") {
    return "bg-slate-600 text-white border-slate-700";
  }

  const normalizedType = String(item.itemType || "").toLowerCase();

  if (normalizedType === "technical_visit") {
    return "bg-blue-600 text-white border-blue-700";
  }

  if (normalizedType === "installation") {
    return "bg-green-600 text-white border-green-700";
  }

  if (normalizedType === "follow_up") {
    return "bg-yellow-400 text-slate-950 border-yellow-500";
  }

  if (normalizedType === "meeting") {
    return "bg-cyan-500 text-slate-950 border-cyan-600";
  }

  if (normalizedType === "measurement") {
    return "bg-[#8B5A2B] text-white border-[#6F451F]";
  }

  if (normalizedType === "maintenance") {
    return "bg-orange-500 text-white border-orange-600";
  }

  return "bg-slate-500 text-white border-slate-600";
}

function getItemChipClass(item: ScheduleItem) {
  const normalizedStatus = String(item.status || "").toLowerCase();

  if (normalizedStatus === "cancelled") {
    return "border-slate-300 bg-slate-100 text-slate-500 opacity-70 line-through";
  }

  const baseClass = getItemTypeClass(item);

  if (normalizedStatus === "rescheduled") {
    return `${baseClass} ring-2 ring-amber-300`;
  }

  if (normalizedStatus === "completed") {
    return `${baseClass} opacity-80`;
  }

  return baseClass;
}

function getItemStatusPrefix(item: ScheduleItem) {
  const normalizedStatus = String(item.status || "").toLowerCase();

  if (normalizedStatus === "completed") return "✓ ";
  if (normalizedStatus === "rescheduled") return "↻ ";
  if (normalizedStatus === "cancelled") return "× ";

  return "";
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

function createBlockFormFromItem(item: ScheduleItem): BlockForm {
  return {
    title: item.title || "",
    blockType: item.itemType || "manual_block",
    startAt: toDateTimeLocalValue(item.startAt),
    endAt: toDateTimeLocalValue(item.endAt),
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
      leadId: "",
      conversationId: "",
      commercialOpportunityId: "",
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
    leadId: "",
    conversationId: "",
    commercialOpportunityId: "",
  };
}

function createDefaultBlockForm(selectedDateKey: string): BlockForm {
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

function startOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfLocalDay(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addCalendarDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function startOfWeek(date: Date) {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function endOfWeek(date: Date) {
  return endOfLocalDay(addCalendarDays(startOfWeek(date), 6));
}

function buildWeekDays(date: Date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

function formatPeriodLabel(date: Date, view: CalendarView) {
  if (view === "day") {
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  if (view === "week") {
    const start = startOfWeek(date);
    const end = addCalendarDays(start, 6);
    const sameMonth =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth();

    if (sameMonth) {
      return `${start.getDate().toString().padStart(2, "0")}–${end
        .getDate()
        .toString()
        .padStart(2, "0")} de ${start.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      })}`;
    }

    return `${start.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    })} – ${end.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  }

  return formatMonthYear(date);
}

function formatWeekHeader(date: Date) {
  return {
    weekday: date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
    day: date.toLocaleDateString("pt-BR", { day: "2-digit" }),
  };
}

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimelinePosition(item: ScheduleItem, day: Date) {
  const itemStart = new Date(item.startAt);
  const itemEnd = new Date(item.endAt);

  if (Number.isNaN(itemStart.getTime()) || Number.isNaN(itemEnd.getTime())) {
    return null;
  }

  const dayStart = startOfLocalDay(day);
  const dayEnd = endOfLocalDay(day);

  if (itemEnd < dayStart || itemStart > dayEnd) {
    return null;
  }

  const effectiveStart = itemStart < dayStart ? dayStart : itemStart;
  const effectiveEnd = itemEnd > dayEnd ? dayEnd : itemEnd;

  const startMinutes =
    effectiveStart.getHours() * 60 +
    effectiveStart.getMinutes() +
    effectiveStart.getSeconds() / 60;
  const endMinutes =
    effectiveEnd.getHours() * 60 +
    effectiveEnd.getMinutes() +
    effectiveEnd.getSeconds() / 60;

  const top = (startMinutes / 60) * TIMELINE_HOUR_HEIGHT;
  const rawHeight = ((Math.max(endMinutes, startMinutes + 15) - startMinutes) / 60) *
    TIMELINE_HOUR_HEIGHT;

  return {
    top,
    height: Math.max(24, rawHeight),
  };
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = `${Math.floor(index / 2)}`.padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

function formatDateOnlyPtBr(value: string) {
  if (!value) return "-";

  const [year, month, day] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function extractDatePart(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const [datePart] = normalized.split("T");
  return datePart || "";
}

function extractTimePart(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return "09:00";

  const [, timePart] = normalized.split("T");
  if (!timePart) return "09:00";

  const [hours = "09", minutes = "00"] = timePart.split(":");
  const candidate = `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;

  return TIME_OPTIONS.includes(candidate) ? candidate : "09:00";
}

function combineDateAndTime(datePart: string, timePart: string) {
  if (!datePart) return "";
  const safeTime = TIME_OPTIONS.includes(timePart) ? timePart : "09:00";
  return `${datePart}T${safeTime}`;
}

type DateTimePickerFieldProps = {
  label: string;
  dateValue: string;
  timeValue: string;
  onDateChange: (nextDate: string) => void;
  onTimeChange: (nextTime: string) => void;
};

function DateTimePickerField(props: DateTimePickerFieldProps) {
  const { label, dateValue, timeValue, onDateChange, onTimeChange } = props;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const initial = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
    return startOfMonth(Number.isNaN(initial.getTime()) ? new Date() : initial);
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!calendarOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setCalendarOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [calendarOpen]);

  function toggleCalendar() {
    if (!calendarOpen && dateValue) {
      const nextDate = new Date(`${dateValue}T12:00:00`);
      if (!Number.isNaN(nextDate.getTime())) {
        setCalendarMonth(startOfMonth(nextDate));
      }
    }

    setCalendarOpen((prev) => !prev);
  }

  const calendarMonthDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  const selectedDateLabel = dateValue ? formatDateOnlyPtBr(dateValue) : "Selecionar dia";

  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-gray-700">{label}</label>

      <div className="grid gap-2 sm:grid-cols-[1.3fr_0.7fr]">
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={toggleCalendar}
            className="flex w-full items-center justify-between rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-left text-xs text-gray-900 outline-none transition hover:bg-gray-50 focus:border-black"
          >
            <span className={dateValue ? "text-gray-900" : "text-gray-400"}>{selectedDateLabel}</span>
            <span className="text-xs font-semibold text-gray-500">Calendário</span>
          </button>

          {calendarOpen ? (
            <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-full min-w-[260px] rounded-xl border border-black/10 bg-white p-2.5 shadow-xl">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                    )
                  }
                  className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Mês anterior
                </button>

                <div className="text-[11px] font-bold capitalize text-gray-900">
                  {formatMonthYear(calendarMonth)}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                    )
                  }
                  className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Próximo mês
                </button>
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1">
                {WEEKDAY_LABELS.map((weekday) => (
                  <div
                    key={`${label}-${weekday}`}
                    className="rounded-md bg-gray-50 px-1 py-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {weekday}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarMonthDays.map((day) => {
                  const dayKey = toDateKey(day);
                  const sameMonth = day.getMonth() === calendarMonth.getMonth();
                  const isSelected = dayKey === dateValue;
                  const isToday = dayKey === toDateKey(new Date());

                  return (
                    <button
                      key={`${label}-${dayKey}`}
                      type="button"
                      onClick={() => {
                        onDateChange(dayKey);
                        setCalendarOpen(false);
                      }}
                      className={[
                        "h-7 rounded-lg text-center text-[11px] font-semibold transition",
                        sameMonth ? "text-gray-900" : "text-gray-300",
                        isSelected
                          ? "bg-black text-white"
                          : isToday
                          ? "bg-gray-100 text-gray-900 ring-1 ring-black/10"
                          : "hover:bg-gray-100",
                      ].join(" ")}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <select
            value={timeValue}
            onChange={(event) => onTimeChange(event.target.value)}
            className="w-full min-w-[88px] rounded-lg border border-black/10 bg-white px-3 py-1.5 font-mono text-xs tabular-nums text-gray-900 outline-none focus:border-black"
          >
            {TIME_OPTIONS.map((option) => (
              <option key={`${label}-${option}`} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const {
    loading: storeLoading,
    organizationId,
    activeStoreId,
  } = useStoreContext();

  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
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
  const [blockEditForm, setBlockEditForm] = useState<BlockForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveErrorText, setSaveErrorText] = useState<string | null>(null);
  const [completionDecisionOpen, setCompletionDecisionOpen] = useState(false);

  const [createBlockOpen, setCreateBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState<BlockForm>(() =>
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
  const [leadOptions, setLeadOptions] = useState<LeadConversationOption[]>([]);
  const [loadingLeadOptions, setLoadingLeadOptions] = useState(false);
  const [leadCommercialOpportunityOptions, setLeadCommercialOpportunityOptions] =
    useState<LeadCommercialOpportunityOption[]>([]);
  const [loadingLeadCommercialOpportunityOptions, setLoadingLeadCommercialOpportunityOptions] =
    useState(false);
  const [createLeadConversationState, setCreateLeadConversationState] =
    useState<CreateLeadConversationState>({
      leadId: null,
      status: "idle",
      conversationId: null,
      conversationStatus: null,
      isHumanActive: null,
      lastMessageAt: null,
    });

  const lastKnownTodayKeyRef = useRef<string>(toDateKey(new Date()));
  const selectedItemRef = useRef<ScheduleItem | null>(null);
  const editModeRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  useEffect(() => {
    editModeRef.current = editMode;

    if (!editMode) {
      setCompletionDecisionOpen(false);
    }
  }, [editMode]);

  const canLoadSchedule = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const calendarDays = useMemo(() => buildCalendarDays(viewDate), [viewDate]);
  const weekDays = useMemo(() => buildWeekDays(viewDate), [viewDate]);

  const visibleDays = useMemo(() => {
    if (calendarView === "day") {
      return [startOfLocalDay(viewDate)];
    }

    if (calendarView === "week") {
      return weekDays;
    }

    return calendarDays;
  }, [calendarView, viewDate, weekDays, calendarDays]);

  const rangeStart = useMemo(() => {
    if (calendarView === "day") {
      return startOfLocalDay(viewDate);
    }

    if (calendarView === "week") {
      return startOfWeek(viewDate);
    }

    return startOfLocalDay(calendarDays[0] || startOfMonth(viewDate));
  }, [calendarView, viewDate, calendarDays]);

  const rangeEnd = useMemo(() => {
    if (calendarView === "day") {
      return endOfLocalDay(viewDate);
    }

    if (calendarView === "week") {
      return endOfWeek(viewDate);
    }

    return endOfLocalDay(
      calendarDays[calendarDays.length - 1] || endOfMonth(viewDate)
    );
  }, [calendarView, viewDate, calendarDays]);

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
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
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
            if (refreshedSelectedItem.itemKind === "appointment") {
              setEditForm(createAppointmentFormFromItem(refreshedSelectedItem));
              setBlockEditForm(null);
            } else if (refreshedSelectedItem.itemKind === "block") {
              setBlockEditForm(createBlockFormFromItem(refreshedSelectedItem));
              setEditForm(null);
            }
          }

          if (!refreshedSelectedItem) {
            setEditMode(false);
            setEditForm(null);
            setBlockEditForm(null);
            setSaveErrorText(null);
          }
        }

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      } catch (error: unknown) {
        if (currentRequestId !== loadRequestIdRef.current) {
          return;
        }

        setItems([]);
        setErrorText(getErrorMessage(error, "Erro inesperado ao carregar agenda."));

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [canLoadSchedule, organizationId, activeStoreId, rangeStart, rangeEnd]
  );

  useEffect(() => {
    if (!canLoadSchedule) return;
    void loadSchedule();
  }, [canLoadSchedule, loadSchedule]);

  const loadLeadOptions = useCallback(async () => {
    if (!canLoadSchedule || !organizationId || !activeStoreId) {
      setLeadOptions([]);
      return;
    }

    setLoadingLeadOptions(true);

    try {
      const { data: leadsData, error: leadsError } = await supabase
        .from("leads")
        .select("id, name, phone, state, created_at")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (leadsError) throw leadsError;

      const leads = (leadsData || []) as Array<{
        id: string;
        name: string | null;
        phone: string | null;
        state: string | null;
      }>;

      if (leads.length === 0) {
        setLeadOptions([]);
        setLoadingLeadOptions(false);
        return;
      }

      const leadIds = leads.map((lead) => lead.id).filter(Boolean);
      const { data: conversationsData, error: conversationsError } = await supabase
        .from("conversations")
        .select("id, lead_id, status, is_human_active, last_message_at")
        .eq("organization_id", organizationId)
        .in("lead_id", leadIds)
        .order("last_message_at", { ascending: false });

      if (conversationsError) throw conversationsError;

      const bestConversationByLead = new Map<string, {
        id: string;
        status: string | null;
        is_human_active: boolean | null;
        last_message_at: string | null;
      }>();

      for (const conversation of ((conversationsData || []) as Array<{
        id: string;
        lead_id: string;
        status: string | null;
        is_human_active: boolean | null;
        last_message_at: string | null;
      }>)) {
        if (!conversation.lead_id || bestConversationByLead.has(conversation.lead_id)) {
          continue;
        }

        bestConversationByLead.set(conversation.lead_id, {
          id: conversation.id,
          status: conversation.status,
          is_human_active: conversation.is_human_active,
          last_message_at: conversation.last_message_at,
        });
      }

      setLeadOptions(
        leads.map((lead) => {
          const bestConversation = bestConversationByLead.get(lead.id);

          return {
            leadId: lead.id,
            leadName: String(lead.name || "").trim() || "Lead sem nome",
            leadPhone: lead.phone,
            leadState: lead.state,
            conversationId: bestConversation?.id || null,
            conversationStatus: bestConversation?.status || null,
            isHumanActive: bestConversation?.is_human_active ?? null,
            lastMessageAt: bestConversation?.last_message_at || null,
          } satisfies LeadConversationOption;
        })
      );
    } catch (error) {
      console.error("[SchedulePage] loadLeadOptions error:", error);
      setLeadOptions([]);
    } finally {
      setLoadingLeadOptions(false);
    }
  }, [canLoadSchedule, organizationId, activeStoreId]);

  const fetchLatestConversationForLead = useCallback(
    async (leadId: string) => {
      if (!organizationId || !leadId) {
        return null;
      }

      const { data: fallbackConversation, error: fallbackConversationError } = await supabase
        .from("conversations")
        .select("id, status, is_human_active, last_message_at")
        .eq("organization_id", organizationId)
        .eq("lead_id", leadId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackConversationError) {
        throw fallbackConversationError;
      }

      return fallbackConversation || null;
    },
    [organizationId]
  );

  const loadLeadCommercialOpportunityOptions = useCallback(
    async (leadId: string) => {
      if (!canLoadSchedule || !organizationId || !activeStoreId || !leadId) {
        setLeadCommercialOpportunityOptions([]);
        return;
      }

      setLoadingLeadCommercialOpportunityOptions(true);

      try {
        const { data, error } = await supabase
          .from("commercial_opportunities")
          .select("id, stage, primary_conversation_id")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .eq("origin_lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw error;

        setLeadCommercialOpportunityOptions(
          ((data || []) as Array<{
            id: string;
            stage: string | null;
            primary_conversation_id: string | null;
          }>).map((row) => ({
            id: row.id,
            stage: row.stage,
            primaryConversationId: row.primary_conversation_id,
          })),
        );
      } catch (error) {
        console.error("[SchedulePage] loadLeadCommercialOpportunityOptions error:", error);
        setLeadCommercialOpportunityOptions([]);
      } finally {
        setLoadingLeadCommercialOpportunityOptions(false);
      }
    },
    [canLoadSchedule, organizationId, activeStoreId],
  );

  useEffect(() => {
    if (!canLoadSchedule) return;
    void loadLeadOptions();
  }, [canLoadSchedule, loadLeadOptions]);




  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextTodayKey = toDateKey(new Date());
      const previousTodayKey = lastKnownTodayKeyRef.current;

      if (nextTodayKey !== previousTodayKey) {
        if (selectedDateKey === previousTodayKey) {
          const now = new Date();
          setSelectedDateKey(nextTodayKey);
          setViewDate(now);
        }

        lastKnownTodayKeyRef.current = nextTodayKey;
      }
    }, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedDateKey]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, ScheduleItem[]> = {};

    visibleDays.forEach((day) => {
      map[toDateKey(day)] = [];
    });

    items.forEach((item) => {
      visibleDays.forEach((day) => {
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
  }, [visibleDays, items]);

  const selectedLeadOption = useMemo(() => {
    return leadOptions.find((lead) => lead.leadId === appointmentCreateForm.leadId) || null;
  }, [leadOptions, appointmentCreateForm.leadId]);

  const effectiveCreateConversationId = useMemo(() => {
    if (createLeadConversationState.leadId === appointmentCreateForm.leadId) {
      return createLeadConversationState.conversationId || "";
    }

    return "";
  }, [
    createLeadConversationState.conversationId,
    createLeadConversationState.leadId,
    appointmentCreateForm.leadId,
  ]);

  const selectedItemLeadOption = useMemo(() => {
    if (!selectedItem?.leadId) return null;
    return leadOptions.find((lead) => lead.leadId === selectedItem.leadId) || null;
  }, [leadOptions, selectedItem?.leadId]);

  const commercialOpportunitySelectOptions = useMemo(
    () =>
      buildCommercialOpportunitySelectOptions({
        opportunities: leadCommercialOpportunityOptions,
        selectedConversationId: effectiveCreateConversationId || null,
      }),
    [effectiveCreateConversationId, leadCommercialOpportunityOptions],
  );

  const compatibleCommercialOpportunities = useMemo(
    () =>
      leadCommercialOpportunityOptions.filter(
        (opportunity) =>
          !effectiveCreateConversationId ||
          opportunity.primaryConversationId === effectiveCreateConversationId,
      ),
    [effectiveCreateConversationId, leadCommercialOpportunityOptions],
  );

  useEffect(() => {
    if (
      isCommercialOpportunitySelectionCompatible({
        selectedCommercialOpportunityId:
          appointmentCreateForm.commercialOpportunityId,
        availableCommercialOpportunities: compatibleCommercialOpportunities,
      })
    ) {
      return;
    }

    setAppointmentCreateForm((prev) => ({
      ...prev,
      commercialOpportunityId: "",
    }));
  }, [
    appointmentCreateForm.commercialOpportunityId,
    compatibleCommercialOpportunities,
  ]);

  function changeCalendarView(nextView: CalendarView) {
    const now = new Date();
    setCalendarView(nextView);
    setViewDate(now);
    setSelectedDateKey(toDateKey(now));
  }

  function goToPreviousPeriod() {
    setViewDate((prev) => {
      let nextDate = new Date(prev);

      if (calendarView === "day") {
        nextDate = addCalendarDays(prev, -1);
      } else if (calendarView === "week") {
        nextDate = addCalendarDays(prev, -7);
      } else {
        nextDate = new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
      }

      setSelectedDateKey(toDateKey(nextDate));
      return nextDate;
    });
  }

  function goToNextPeriod() {
    setViewDate((prev) => {
      let nextDate = new Date(prev);

      if (calendarView === "day") {
        nextDate = addCalendarDays(prev, 1);
      } else if (calendarView === "week") {
        nextDate = addCalendarDays(prev, 7);
      } else {
        nextDate = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      }

      setSelectedDateKey(toDateKey(nextDate));
      return nextDate;
    });
  }

  function goToToday() {
    const now = new Date();
    setViewDate(now);
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
      setBlockEditForm(null);
      return;
    }

    if (item.itemKind === "block") {
      setBlockEditForm(createBlockFormFromItem(item));
      setEditForm(null);
      return;
    }

    setEditForm(null);
    setBlockEditForm(null);
  }

  function closeItemDetails() {
    selectedItemRef.current = null;
    editModeRef.current = false;

    setSelectedItem(null);
    setEditMode(false);
    setEditForm(null);
    setBlockEditForm(null);
    setSaveErrorText(null);
  }

  function startEditingSelectedItem() {
    if (!selectedItem) return;

    if (selectedItem.itemKind === "appointment") {
      setEditForm(createAppointmentFormFromItem(selectedItem));
      setBlockEditForm(null);
      setEditMode(true);
      editModeRef.current = true;
      setSaveErrorText(null);
      return;
    }

    if (selectedItem.itemKind === "block") {
      setBlockEditForm(createBlockFormFromItem(selectedItem));
      setEditForm(null);
      setEditMode(true);
      editModeRef.current = true;
      setSaveErrorText(null);
    }
  }

  function cancelEditingSelectedItem() {
    if (!selectedItem) {
      setEditMode(false);
      editModeRef.current = false;
      setEditForm(null);
      setBlockEditForm(null);
      setSaveErrorText(null);
      return;
    }

    if (selectedItem.itemKind === "appointment") {
      setEditForm(createAppointmentFormFromItem(selectedItem));
      setBlockEditForm(null);
      setEditMode(false);
      editModeRef.current = false;
      setSaveErrorText(null);
      return;
    }

    if (selectedItem.itemKind === "block") {
      setBlockEditForm(createBlockFormFromItem(selectedItem));
      setEditForm(null);
      setEditMode(false);
      editModeRef.current = false;
      setSaveErrorText(null);
      return;
    }

    setEditMode(false);
    editModeRef.current = false;
    setEditForm(null);
    setBlockEditForm(null);
    setSaveErrorText(null);
  }

  const syncCreateConversationPreview = useCallback(
    async (leadId: string, preferredLead?: LeadConversationOption | null) => {
      if (!leadId) {
        setCreateLeadConversationState({
          leadId: null,
          status: "idle",
          conversationId: null,
          conversationStatus: null,
          isHumanActive: null,
          lastMessageAt: null,
        });
        setAppointmentCreateForm((prev) => ({
          ...prev,
          conversationId: "",
        }));
        return;
      }

      const matchedLead =
        preferredLead || leadOptions.find((lead) => lead.leadId === leadId) || null;

      if (matchedLead?.conversationId) {
        setCreateLeadConversationState({
          leadId,
          status: "resolved",
          conversationId: matchedLead.conversationId,
          conversationStatus: matchedLead.conversationStatus || null,
          isHumanActive: matchedLead.isHumanActive ?? null,
          lastMessageAt: matchedLead.lastMessageAt || null,
        });
        setAppointmentCreateForm((prev) => {
          if (prev.leadId !== leadId && prev.leadId) return prev;
          return {
            ...prev,
            conversationId: matchedLead.conversationId || "",
          };
        });
        return;
      }

      setCreateLeadConversationState({
        leadId,
        status: "loading",
        conversationId: null,
        conversationStatus: null,
        isHumanActive: null,
        lastMessageAt: null,
      });

      try {
        const fallbackConversation = await fetchLatestConversationForLead(leadId);

        if (fallbackConversation?.id) {
          setCreateLeadConversationState({
            leadId,
            status: "resolved",
            conversationId: fallbackConversation.id,
            conversationStatus: fallbackConversation.status || null,
            isHumanActive: fallbackConversation.is_human_active ?? null,
            lastMessageAt: fallbackConversation.last_message_at || null,
          });

          setAppointmentCreateForm((prev) => {
            if (prev.leadId !== leadId) return prev;
            return {
              ...prev,
              conversationId: fallbackConversation.id,
            };
          });

          setLeadOptions((prev) =>
            prev.map((lead) =>
              lead.leadId === leadId
                ? {
                    ...lead,
                    conversationId: fallbackConversation.id,
                    conversationStatus: fallbackConversation.status || lead.conversationStatus,
                    isHumanActive:
                      fallbackConversation.is_human_active ?? lead.isHumanActive ?? null,
                    lastMessageAt:
                      fallbackConversation.last_message_at || lead.lastMessageAt || null,
                  }
                : lead
            )
          );
          return;
        }

        setCreateLeadConversationState({
          leadId,
          status: "not_found",
          conversationId: null,
          conversationStatus: null,
          isHumanActive: null,
          lastMessageAt: null,
        });
        setAppointmentCreateForm((prev) => {
          if (prev.leadId !== leadId) return prev;
          return {
            ...prev,
            conversationId: "",
          };
        });
      } catch (error: unknown) {
        console.error("[SchedulePage] create appointment conversation sync error:", error);
        setAppointmentCreateErrorText(
          getErrorMessage(error, "Não consegui puxar a conversa mais recente desse lead.")
        );
        setCreateLeadConversationState({
          leadId,
          status: "not_found",
          conversationId: null,
          conversationStatus: null,
          isHumanActive: null,
          lastMessageAt: null,
        });
      }
    },
    [fetchLatestConversationForLead, leadOptions]
  );

  useEffect(() => {
    if (!createAppointmentOpen) return;

    const leadId = appointmentCreateForm.leadId;

    if (!leadId) {
      setLeadCommercialOpportunityOptions([]);
      setCreateLeadConversationState({
        leadId: null,
        status: "idle",
        conversationId: null,
        conversationStatus: null,
        isHumanActive: null,
        lastMessageAt: null,
      });
      return;
    }

    if (createLeadConversationState.leadId === leadId) {
      return;
    }

    void syncCreateConversationPreview(leadId, selectedLeadOption);
    void loadLeadCommercialOpportunityOptions(leadId);
  }, [
    createAppointmentOpen,
    appointmentCreateForm.leadId,
    createLeadConversationState.leadId,
    loadLeadCommercialOpportunityOptions,
    selectedLeadOption,
    syncCreateConversationPreview,
  ]);

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
    setCreateLeadConversationState({
      leadId: null,
      status: "idle",
      conversationId: null,
      conversationStatus: null,
      isHumanActive: null,
      lastMessageAt: null,
    });
    setAppointmentCreateForm(createDefaultAppointmentCreateForm(selectedDateKey));
  }

  function closeCreateAppointmentPanel() {
    setCreateAppointmentOpen(false);
    setAppointmentCreateErrorText(null);
    setSavingAppointmentCreate(false);
    setCreateLeadConversationState({
      leadId: null,
      status: "idle",
      conversationId: null,
      conversationStatus: null,
      isHumanActive: null,
      lastMessageAt: null,
    });
    setAppointmentCreateForm(createDefaultAppointmentCreateForm(selectedDateKey));
  }

  async function handleAppointmentLeadChange(nextLeadId: string) {
    const matchedLead = leadOptions.find((lead) => lead.leadId === nextLeadId) || null;

    setAppointmentCreateErrorText(null);

    setAppointmentCreateForm((prev) => ({
      ...prev,
      leadId: nextLeadId,
      conversationId: matchedLead?.conversationId || "",
      commercialOpportunityId: "",
      customerName: matchedLead?.leadName || prev.customerName,
      customerPhone: matchedLead?.leadPhone
        ? applyPhoneMask(matchedLead.leadPhone)
        : prev.customerPhone,
    }));

    await syncCreateConversationPreview(nextLeadId, matchedLead);
    await loadLeadCommercialOpportunityOptions(nextLeadId);
  }

  async function resolveAppointmentCommercialOpportunityId(appointmentId: string) {
    if (!organizationId || !activeStoreId) {
      return null;
    }

    const { data, error } = await supabase
      .from("store_appointments")
      .select("commercial_opportunity_id")
      .eq("organization_id", organizationId)
      .eq("store_id", activeStoreId)
      .eq("id", appointmentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return String(data?.commercial_opportunity_id || "").trim() || null;
  }

  async function maybeProjectAppointmentToTechnicalVisitStage(args: {
    appointmentId: string;
    appointmentType: string;
    appointmentStatus: string;
    commercialOpportunityId: string | null;
  }) {
    if (
      !organizationId ||
      !activeStoreId ||
      !shouldAttemptTechnicalVisitStageProjection({
        appointmentType: args.appointmentType,
        appointmentStatus: args.appointmentStatus,
        commercialOpportunityId: args.commercialOpportunityId,
      })
    ) {
      return null;
    }

    try {
      await projectTechnicalVisitStageByUser({
        supabase,
        organizationId,
        storeId: activeStoreId,
        commercialOpportunityId: args.commercialOpportunityId!,
        appointmentId: args.appointmentId,
        source: "schedule_page",
      });
      return null;
    } catch (error) {
      if (error instanceof TechnicalVisitStageProjectionError) {
        return error.message;
      }

      return "O compromisso foi salvo, mas nao foi possivel sincronizar a opportunity comercial.";
    }
  }

  async function saveAppointmentEdit(
    completionOutcome?: "fully_completed" | "needs_followup"
  ) {
    if (!selectedItem || selectedItem.itemKind !== "appointment" || !editForm) {
      return;
    }

    if (!organizationId || !activeStoreId) {
      setSaveErrorText("Contexto da loja não encontrado.");
      return;
    }

    const startDate = new Date(editForm.scheduledStart);
    const endDate = new Date(editForm.scheduledEnd);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setSaveErrorText("Preencha um período válido.");
      return;
    }

    const originalStartIso = selectedItem.startAt
      ? new Date(selectedItem.startAt).toISOString()
      : null;
    const originalEndIso = selectedItem.endAt
      ? new Date(selectedItem.endAt).toISOString()
      : null;

    const timeChanged =
      originalStartIso !== startDate.toISOString() ||
      originalEndIso !== endDate.toISOString();

    const nextStatus =
      timeChanged && editForm.status === "scheduled"
        ? "rescheduled"
        : editForm.status;

    const isCompletingNow =
      nextStatus === "completed" && selectedItem.status !== "completed";

    if (isCompletingNow && !completionOutcome) {
      setSaveErrorText(null);
      setCompletionDecisionOpen(true);
      return;
    }

    setSavingEdit(true);
    setSaveErrorText(null);

    try {
      const payload = {
        p_appointment_id: selectedItem.itemId,
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_title: editForm.title,
        p_appointment_type: editForm.appointmentType,
        p_status: nextStatus,
        p_scheduled_start: startDate.toISOString(),
        p_scheduled_end: endDate.toISOString(),
        p_customer_name: editForm.customerName || null,
        p_customer_phone: normalizePhoneForSave(editForm.customerPhone),
        p_address_text: editForm.addressText || null,
        p_notes: editForm.notes || null,
      };

      const rpcName = isCompletingNow
        ? "complete_store_appointment_with_outcome"
        : "update_store_appointment";

      const rpcPayload = isCompletingNow
        ? {
            p_appointment_id: selectedItem.itemId,
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_completion_outcome: completionOutcome,
            p_completion_note: editForm.notes || null,
          }
        : payload;

      const { data, error } = await supabase.rpc(rpcName, rpcPayload);

      if (error) {
        if (
          isCompletingNow &&
          (error.message.includes("complete_store_appointment_with_outcome") ||
            error.message.includes("Could not find the function") ||
            error.message.includes("does not exist"))
        ) {
          setSaveErrorText(
            "Antes de concluir com essa nova regra, rode primeiro o SQL da função de conclusão com decisão final."
          );
        } else {
          setSaveErrorText(error.message);
        }
        setSavingEdit(false);
        return;
      }

      const appointmentCommercialOpportunityId = !isCompletingNow
        ? await resolveAppointmentCommercialOpportunityId(selectedItem.itemId)
        : null;
      const projectionWarning = !isCompletingNow
        ? await maybeProjectAppointmentToTechnicalVisitStage({
            appointmentId: selectedItem.itemId,
            appointmentType: editForm.appointmentType,
            appointmentStatus: nextStatus,
            commercialOpportunityId: appointmentCommercialOpportunityId,
          })
        : null;

      const updatedItem = data
        ? ({
            itemKind: "appointment",
            itemId: data.id,
            organizationId: data.organization_id,
            storeId: data.store_id,
            leadId: data.lead_id,
            conversationId: data.conversation_id,
            commercialOpportunityId:
              String(data.commercial_opportunity_id || "").trim() || appointmentCommercialOpportunityId,
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

      setCompletionDecisionOpen(false);
      setEditMode(false);
      editModeRef.current = false;

      await loadSchedule({ silent: true });
      setErrorText(projectionWarning);
      setSavingEdit(false);
    } catch (error: unknown) {
      setSaveErrorText(getErrorMessage(error, "Erro inesperado ao salvar compromisso."));
      setSavingEdit(false);
    }
  }

  async function saveBlockEdit() {
    if (!selectedItem || selectedItem.itemKind !== "block" || !blockEditForm) {
      return;
    }

    if (!organizationId || !activeStoreId) {
      setSaveErrorText("Contexto da loja não encontrado.");
      return;
    }

    setSavingEdit(true);
    setSaveErrorText(null);

    try {
      const startDate = new Date(blockEditForm.startAt);
      const endDate = new Date(blockEditForm.endAt);

      if (!blockEditForm.title.trim()) {
        setSaveErrorText("Preencha o título do bloqueio.");
        setSavingEdit(false);
        return;
      }

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setSaveErrorText("Preencha um período válido.");
        setSavingEdit(false);
        return;
      }

      const { data, error } = await supabase.rpc("update_store_schedule_block", {
        p_block_id: selectedItem.itemId,
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_title: blockEditForm.title.trim(),
        p_block_type: blockEditForm.blockType,
        p_start_at: startDate.toISOString(),
        p_end_at: endDate.toISOString(),
        p_notes: blockEditForm.notes.trim() || null,
      });

      if (error) {
        setSaveErrorText(error.message);
        setSavingEdit(false);
        return;
      }

      const updatedItem = data
        ? ({
            itemKind: "block",
            itemId: data.id,
            organizationId: data.organization_id,
            storeId: data.store_id,
            leadId: null,
            conversationId: null,
            title: data.title,
            itemType: data.block_type,
            status: "blocked",
            startAt: data.start_at,
            endAt: data.end_at,
            customerName: null,
            customerPhone: null,
            addressText: null,
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
        setBlockEditForm(createBlockFormFromItem(updatedItem));
      }

      setEditMode(false);
      editModeRef.current = false;

      await loadSchedule({ silent: true });
      setSavingEdit(false);
    } catch (error: unknown) {
      setSaveErrorText(getErrorMessage(error, "Erro inesperado ao salvar bloqueio."));
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
    } catch (error: unknown) {
      setSaveErrorText(
        getErrorMessage(error, "Erro inesperado ao cancelar compromisso.")
      );
      setSavingEdit(false);
    }
  }

  async function deleteBlock() {
    if (!selectedItem || selectedItem.itemKind !== "block") return;

    if (!organizationId || !activeStoreId) {
      setSaveErrorText("Contexto da loja não encontrado.");
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza que deseja excluir este bloqueio?"
    );

    if (!confirmed) return;

    setSavingEdit(true);
    setSaveErrorText(null);

    try {
      const { error } = await supabase.rpc("delete_store_schedule_block", {
        p_block_id: selectedItem.itemId,
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
      });

      if (error) {
        setSaveErrorText(error.message);
        setSavingEdit(false);
        return;
      }

      selectedItemRef.current = null;
      setSelectedItem(null);
      setEditMode(false);
      editModeRef.current = false;
      setEditForm(null);
      setBlockEditForm(null);
      setSaveErrorText(null);

      await loadSchedule({ silent: true });
      setSavingEdit(false);
    } catch (error: unknown) {
      setSaveErrorText(getErrorMessage(error, "Erro inesperado ao excluir bloqueio."));
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

      const { error } = await supabase.rpc("create_store_schedule_block_allow_existing_appointments", {
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
    } catch (error: unknown) {
      setBlockErrorText(getErrorMessage(error, "Erro inesperado ao criar bloqueio."));
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

      if (
        appointmentCreateForm.appointmentType === "technical_visit" &&
        appointmentCreateForm.leadId &&
        loadingLeadCommercialOpportunityOptions
      ) {
        setAppointmentCreateErrorText(
          "Aguarde o carregamento das opportunities comerciais deste lead antes de salvar."
        );
        setSavingAppointmentCreate(false);
        return;
      }

      let resolvedConversationId =
        effectiveCreateConversationId || null;

      if (appointmentCreateForm.leadId && !resolvedConversationId) {
        const { data: fallbackConversation, error: fallbackConversationError } = await supabase
          .from("conversations")
          .select("id, status, is_human_active, last_message_at")
          .eq("organization_id", organizationId)
          .eq("lead_id", appointmentCreateForm.leadId)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackConversationError) {
          setAppointmentCreateErrorText(fallbackConversationError.message);
          setSavingAppointmentCreate(false);
          return;
        }

        resolvedConversationId = fallbackConversation?.id || null;
      }

      const commercialOpportunityResolution =
        resolveCommercialOpportunityIdForAppointmentCreate({
          appointmentType: appointmentCreateForm.appointmentType,
          selectedCommercialOpportunityId:
            appointmentCreateForm.commercialOpportunityId,
          availableCommercialOpportunities: compatibleCommercialOpportunities,
        });

      if (!commercialOpportunityResolution.ok) {
        setAppointmentCreateErrorText(
          commercialOpportunityResolution.errorMessage
        );
        setSavingAppointmentCreate(false);
        return;
      }

      const commercialOpportunityId =
        commercialOpportunityResolution.commercialOpportunityId;

      const { data, error } = await supabase.rpc("create_store_appointment_with_commercial_context", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_lead_id: appointmentCreateForm.leadId || null,
        p_conversation_id: resolvedConversationId,
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
        p_commercial_opportunity_id: commercialOpportunityId,
      });

      if (error) {
        setAppointmentCreateErrorText(error.message);
        setSavingAppointmentCreate(false);
        return;
      }

      const createdAppointmentId = String(data?.id || "").trim() || null;
      const projectionWarning =
        createdAppointmentId && commercialOpportunityId
          ? await maybeProjectAppointmentToTechnicalVisitStage({
              appointmentId: createdAppointmentId,
              appointmentType: appointmentCreateForm.appointmentType,
              appointmentStatus: appointmentCreateForm.status,
              commercialOpportunityId,
            })
          : null;

      closeCreateAppointmentPanel();
      await loadSchedule({ silent: true });
      setErrorText(projectionWarning);
      setSavingAppointmentCreate(false);
    } catch (error: unknown) {
      setAppointmentCreateErrorText(
        getErrorMessage(error, "Erro inesperado ao criar compromisso.")
      );
      setSavingAppointmentCreate(false);
    }
  }

  return (
    <div className="h-[calc(100vh-151px)] overflow-hidden bg-gray-100 text-sm">
      <div className="mx-auto flex h-full min-h-0 max-w-[1600px] flex-col overflow-hidden px-2 py-1.5 lg:px-3">
        <div className="mb-2 shrink-0 rounded-xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="overflow-hidden border-b border-black/5 px-4 py-3">
            <div className="flex w-full min-w-0 items-center gap-1.5 whitespace-nowrap">
              <button
                onClick={openCreateAppointmentPanel}
                disabled={storeLoading || !organizationId || !activeStoreId}
                className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Novo compromisso
              </button>

              <button
                onClick={openCreateBlockPanel}
                disabled={storeLoading || !organizationId || !activeStoreId}
                className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Novo bloqueio
              </button>

              <div className="mx-1 hidden h-5 w-px bg-black/10 sm:block" />

              <button
                type="button"
                onClick={goToToday}
                className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
              >
                Hoje
              </button>

              <button
                type="button"
                onClick={goToPreviousPeriod}
                aria-label="Período anterior"
                title="Período anterior"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-lg font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-50"
              >
                ‹
              </button>

              <button
                type="button"
                onClick={goToNextPeriod}
                aria-label="Próximo período"
                title="Próximo período"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-lg font-semibold text-gray-700 ring-1 ring-black/10 hover:bg-gray-50"
              >
                ›
              </button>

              <div className="ml-1 mr-2 min-w-[180px] text-base font-bold text-gray-900">
                {formatPeriodLabel(viewDate, calendarView)}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <div className="flex shrink-0 rounded-lg bg-gray-100 p-0.5 ring-1 ring-black/5">
                  {(["day", "week", "month"] as CalendarView[]).map((view) => {
                    const label =
                      view === "day" ? "Dia" : view === "week" ? "Semana" : "Mês";

                    return (
                      <button
                        key={view}
                        type="button"
                        onClick={() => changeCalendarView(view)}
                        className={[
                          "rounded-md px-3.5 py-2 text-xs font-semibold transition",
                          calendarView === view
                            ? "bg-white text-gray-950 shadow-sm ring-1 ring-black/10"
                            : "text-gray-600 hover:text-gray-950",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {refreshing ? (
                  <div className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 ring-1 ring-black/10">
                    Atualizando...
                  </div>
                ) : null}

                <button
                  onClick={() => void loadSchedule()}
                  disabled={loading || storeLoading || !organizationId || !activeStoreId}
                  className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Recarregar
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {SCHEDULE_TYPE_LEGEND.map((entry) => (
                <div key={entry.value} className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700">
                  <span className={`h-3 w-3 rounded-sm ${entry.dotClass}`} />
                  {entry.label}
                </div>
              ))}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l border-black/10 pl-4 text-[11px] text-gray-600">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Status
              </span>
              <span>
                <span className="font-bold text-emerald-600">✓</span> Concluído
              </span>
              <span>
                <span className="font-bold text-amber-600">↻</span> Remarcado
              </span>
              <span className="font-medium text-slate-600">
                <span className="font-bold">⊘</span> Cancelado
              </span>
              <span className="font-semibold text-red-600">● Crítico/erro</span>
            </div>
          </div>
        </div>

        {errorText ? (
          <div className="mb-2 shrink-0 rounded-xl bg-red-50 p-3 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            {loading || storeLoading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-gray-500">
                Carregando agenda...
              </div>
            ) : calendarView === "month" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-black/10 bg-white">
                  {[
                    "Domingo",
                    "Segunda-feira",
                    "Terça-feira",
                    "Quarta-feira",
                    "Quinta-feira",
                    "Sexta-feira",
                    "Sábado",
                  ].map((label) => (
                    <div
                      key={label}
                      className="border-r border-black/10 px-3 py-2.5 text-[11px] font-semibold text-gray-600 last:border-r-0"
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="grid min-h-[780px] flex-1 grid-cols-7 grid-rows-6 border-l border-black/10">
                  {calendarDays.map((date) => {
                    const dayKey = toDateKey(date);
                    const dayItems = itemsByDate[dayKey] || [];
                    const isCurrentMonth =
                      date.getMonth() === viewDate.getMonth() &&
                      date.getFullYear() === viewDate.getFullYear();
                    const isToday = dayKey === toDateKey(new Date());
                    const isSelected = dayKey === selectedDateKey;

                    return (
                      <div
                        key={dayKey}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedDateKey(dayKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedDateKey(dayKey);
                          }
                        }}
                        className={[
                          "min-h-[126px] cursor-pointer border-b border-r border-black/10 bg-white p-2 text-left transition hover:bg-slate-50/60",
                          !isCurrentMonth ? "bg-gray-50/60 text-gray-400" : "",
                          isSelected ? "ring-2 ring-inset ring-sky-500/40" : "",
                        ].join(" ")}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className={[
                              "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                              isToday
                                ? "bg-sky-600 text-white"
                                : isCurrentMonth
                                ? "text-gray-900"
                                : "text-gray-400",
                            ].join(" ")}
                          >
                            {date.getDate()}
                          </span>
                          {dayItems.length > 0 ? (
                            <span className="text-[9px] text-gray-400">
                              {dayItems.length}
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          {dayItems.slice(0, 4).map((item) => (
                            <button
                              key={`${dayKey}-${item.itemId}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedDateKey(dayKey);
                                openItemDetails(item);
                              }}
                              className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-[10px] font-semibold leading-tight shadow-sm ${getItemChipClass(
                                item
                              )}`}
                              title={`${formatItemType(item.itemType)} · ${item.title} · ${formatClock(
                                item.startAt
                              )}`}
                            >
                              {getItemStatusPrefix(item)}
                              {formatClock(item.startAt)} {item.title || "-"}
                            </button>
                          ))}

                          {dayItems.length > 4 ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedDateKey(dayKey);
                                setViewDate(date);
                                setCalendarView("day");
                              }}
                              className="px-1 text-[9px] font-semibold text-sky-700 hover:underline"
                            >
                              +{dayItems.length - 4} mais
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="w-full min-w-0">
                    <div
                      className="sticky top-0 z-30 grid border-b border-black/10 bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)]"
                      style={{
                        gridTemplateColumns: `72px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                      }}
                    >
                      <div className="border-r border-black/10 bg-white" />
                      {visibleDays.map((date) => {
                        const dayKey = toDateKey(date);
                        const header = formatWeekHeader(date);
                        const isToday = dayKey === toDateKey(new Date());
                        const isSelected = dayKey === selectedDateKey;

                        return (
                          <button
                            key={`header-${dayKey}`}
                            type="button"
                            onClick={() => setSelectedDateKey(dayKey)}
                            className={[
                              "border-r border-black/10 px-3 py-3 text-left transition last:border-r-0 hover:bg-gray-50",
                              isSelected ? "bg-sky-50/70" : "bg-white",
                            ].join(" ")}
                          >
                            <div
                              className={[
                                "text-[11px] font-semibold capitalize",
                                isToday ? "text-sky-700" : "text-gray-500",
                              ].join(" ")}
                            >
                              {header.weekday}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span
                                className={[
                                  "inline-flex h-9 min-w-9 items-center justify-center rounded-full px-1.5 text-xl font-medium",
                                  isToday
                                    ? "bg-sky-600 text-white"
                                    : "text-gray-900",
                                ].join(" ")}
                              >
                                {header.day}
                              </span>
                              {calendarView === "day" ? (
                                <span className="text-xs capitalize text-gray-500">
                                  {date.toLocaleDateString("pt-BR", {
                                    month: "long",
                                    year: "numeric",
                                  })}
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `72px repeat(${visibleDays.length}, minmax(0, 1fr))`,
                      }}
                    >
                      <div
                        className="relative border-r border-black/10 bg-white"
                        style={{ height: `${24 * TIMELINE_HOUR_HEIGHT}px` }}
                      >
                        {TIMELINE_HOURS.map((hour) => (
                          <div
                            key={`hour-label-${hour}`}
                            className={[
                              "absolute left-0 right-0 pr-3 text-right text-[11px] font-medium text-gray-500",
                              hour === 0 ? "translate-y-0" : "-translate-y-1/2",
                            ].join(" ")}
                            style={{
                              top: `${hour === 0 ? 8 : hour * TIMELINE_HOUR_HEIGHT}px`,
                            }}
                          >
                            {`${hour.toString().padStart(2, "0")}:00`}
                          </div>
                        ))}
                      </div>

                      {visibleDays.map((date) => {
                        const dayKey = toDateKey(date);
                        const dayItems = itemsByDate[dayKey] || [];
                        const isToday = dayKey === toDateKey(new Date());
                        const isSelected = dayKey === selectedDateKey;
                        const now = new Date();
                        const nowTop =
                          ((now.getHours() * 60 + now.getMinutes()) / 60) *
                          TIMELINE_HOUR_HEIGHT;

                        return (
                          <div
                            key={`timeline-${dayKey}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedDateKey(dayKey)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedDateKey(dayKey);
                              }
                            }}
                            className={[
                              "relative border-r border-black/10 last:border-r-0",
                              isSelected ? "bg-sky-50/20" : "bg-white",
                            ].join(" ")}
                            style={{ height: `${24 * TIMELINE_HOUR_HEIGHT}px` }}
                          >
                            {TIMELINE_HOURS.map((hour) => (
                              <div
                                key={`${dayKey}-line-${hour}`}
                                className="pointer-events-none absolute left-0 right-0 border-t border-gray-200"
                                style={{ top: `${hour * TIMELINE_HOUR_HEIGHT}px` }}
                              />
                            ))}

                            {Array.from({ length: 24 }, (_, hour) => (
                              <div
                                key={`${dayKey}-half-${hour}`}
                                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-gray-100"
                                style={{
                                  top: `${
                                    hour * TIMELINE_HOUR_HEIGHT +
                                    TIMELINE_HOUR_HEIGHT / 2
                                  }px`,
                                }}
                              />
                            ))}

                            {isToday ? (
                              <div
                                className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-sky-500"
                                style={{ top: `${nowTop}px` }}
                              >
                                <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-sky-500" />
                              </div>
                            ) : null}

                            {dayItems.map((item, index) => {
                              const position = getTimelinePosition(item, date);
                              if (!position) return null;

                              return (
                                <button
                                  key={`${dayKey}-${item.itemId}`}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedDateKey(dayKey);
                                    openItemDetails(item);
                                  }}
                                  className={`absolute overflow-hidden rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold leading-tight shadow-sm transition hover:brightness-95 ${getItemChipClass(
                                    item
                                  )}`}
                                  style={{
                                    top: `${position.top}px`,
                                    height: `${position.height}px`,
                                    left: `${4 + Math.min(index, 3) * 3}px`,
                                    right: "4px",
                                    zIndex: 10 + Math.min(index, 20),
                                  }}
                                  title={`${formatItemType(item.itemType)} · ${item.title} · ${formatClock(
                                    item.startAt
                                  )}–${formatClock(item.endAt)}`}
                                >
                                  <div className="truncate">
                                    {getItemStatusPrefix(item)}
                                    {item.title || formatItemType(item.itemType)}
                                  </div>
                                  {position.height >= 36 ? (
                                    <div className="truncate text-[9px] font-medium opacity-90">
                                      {formatClock(item.startAt)}–{formatClock(item.endAt)}
                                      {calendarView === "day" && item.customerName
                                        ? ` · ${item.customerName}`
                                        : ""}
                                    </div>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

        {selectedItem ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={closeItemDetails}
          >
            <div
              className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-5 py-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500">
                    {formatItemKind(selectedItem.itemKind)}
                  </div>
                  <h3 className="mt-0.5 text-xl font-bold text-gray-900">
                    {selectedItem.title}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeItemDetails}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {saveErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {saveErrorText}
                  </div>
                ) : null}

                <div className="mb-4 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${getStatusBadgeClass(
                      selectedItem.status
                    )}`}
                  >
                    {formatStatus(selectedItem.status)}
                  </span>

                  <span className="rounded-full bg-gray-50 px-2.5 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200">
                    {formatItemType(selectedItem.itemType)}
                  </span>
                </div>

                {selectedItem.itemKind === "appointment" &&
                selectedItem.status === "rescheduled" ? (
                  <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                    Este compromisso foi remarcado. Confira abaixo o horário atualizado.
                  </div>
                ) : null}

                {selectedItem.itemKind === "appointment" &&
                selectedItem.status === "completed" ? (
                  <div className="mb-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                    Este compromisso foi concluído.
                  </div>
                ) : null}

                {selectedItem.itemKind === "appointment" && !editMode ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      onClick={startEditingSelectedItem}
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Editar
                    </button>

                    <button
                      onClick={() => void cancelAppointment()}
                      disabled={savingEdit || selectedItem.status === "cancelled"}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancelar compromisso
                    </button>

                    {buildGoogleMapsDirectionsUrl(selectedItem.addressText) ? (
                      <a
                        href={buildGoogleMapsDirectionsUrl(selectedItem.addressText) || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                      >
                        Abrir rota no Maps
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Adicione um endereço ao compromisso para abrir a rota no Maps."
                        className="cursor-not-allowed rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-400 ring-1 ring-black/5"
                      >
                        Abrir rota no Maps
                      </button>
                    )}
                  </div>
                ) : null}

                {selectedItem.itemKind === "block" && !editMode ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      onClick={startEditingSelectedItem}
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Editar bloqueio
                    </button>

                    <button
                      onClick={() => void deleteBlock()}
                      disabled={savingEdit}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Excluir bloqueio
                    </button>
                  </div>
                ) : null}

                {selectedItem.itemKind === "appointment" && editMode && editForm ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
                          Título
                        </label>
                        <input
                          value={editForm.title}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, title: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        >
                          <option value="technical_visit">Visita técnica</option>
                          <option value="installation">Instalação</option>
                          <option value="follow_up">Retorno</option>
                          <option value="meeting">Reunião</option>
                          <option value="measurement">Medição</option>
                          <option value="maintenance">Manutenção</option>
                          <option value="other">Outro</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
                          Status
                        </label>
                        <select
                          value={editForm.status}
                          onChange={(e) =>
                            setEditForm((prev) =>
                              prev ? { ...prev, status: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        >
                          <option value="scheduled">Agendado</option>
                          <option value="rescheduled">Remarcado</option>
                          <option value="completed">Concluído</option>
                          <option value="cancelled">Cancelado</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        />
                      </div>

                      <DateTimePickerField
                        label="Início"
                        dateValue={extractDatePart(editForm.scheduledStart)}
                        timeValue={extractTimePart(editForm.scheduledStart)}
                        onDateChange={(nextDate) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  scheduledStart: combineDateAndTime(
                                    nextDate,
                                    extractTimePart(prev.scheduledStart)
                                  ),
                                }
                              : prev
                          )
                        }
                        onTimeChange={(nextTime) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  scheduledStart: combineDateAndTime(
                                    extractDatePart(prev.scheduledStart),
                                    nextTime
                                  ),
                                }
                              : prev
                          )
                        }
                      />

                      <DateTimePickerField
                        label="Fim"
                        dateValue={extractDatePart(editForm.scheduledEnd)}
                        timeValue={extractTimePart(editForm.scheduledEnd)}
                        onDateChange={(nextDate) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  scheduledEnd: combineDateAndTime(
                                    nextDate,
                                    extractTimePart(prev.scheduledEnd)
                                  ),
                                }
                              : prev
                          )
                        }
                        onTimeChange={(nextTime) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  scheduledEnd: combineDateAndTime(
                                    extractDatePart(prev.scheduledEnd),
                                    nextTime
                                  ),
                                }
                              : prev
                          )
                        }
                      />

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                          className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                        className="w-full rounded-xl border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-black"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => void saveAppointmentEdit()}
                        disabled={savingEdit}
                        className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingEdit ? "Salvando..." : "Salvar alterações"}
                      </button>

                      <button
                        onClick={cancelEditingSelectedItem}
                        disabled={savingEdit}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancelar edição
                      </button>
                    </div>

                    {completionDecisionOpen &&
                    selectedItem.itemKind === "appointment" &&
                    editForm.status === "completed" ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <div className="text-sm font-semibold text-amber-900">
                          Esse atendimento terminou por completo?
                        </div>
                        <p className="mt-1 text-sm text-amber-800">
                          Se já terminou tudo, o sistema encerra também o retorno ligado a esse atendimento. Se ainda falta falar com o cliente ou acompanhar algo, o retorno continua em aberto.
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveAppointmentEdit("fully_completed")}
                            disabled={savingEdit}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Sim, terminou tudo
                          </button>

                          <button
                            type="button"
                            onClick={() => void saveAppointmentEdit("needs_followup")}
                            disabled={savingEdit}
                            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Não, ainda falta retorno
                          </button>

                          <button
                            type="button"
                            onClick={() => setCompletionDecisionOpen(false)}
                            disabled={savingEdit}
                            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Voltar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedItem.itemKind === "block" && editMode && blockEditForm ? (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Título
                      </label>
                      <input
                        value={blockEditForm.title}
                        onChange={(e) =>
                          setBlockEditForm((prev) =>
                            prev ? { ...prev, title: e.target.value } : prev
                          )
                        }
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Tipo do bloqueio
                      </label>
                      <select
                        value={blockEditForm.blockType}
                        onChange={(e) =>
                          setBlockEditForm((prev) =>
                            prev ? { ...prev, blockType: e.target.value } : prev
                          )
                        }
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                      >
                        <option value="manual_block">Bloqueio manual</option>
                        <option value="personal_unavailable">Indisponível</option>
                        <option value="team_unavailable">Equipe indisponível</option>
                        <option value="holiday">Feriado</option>
                        <option value="other">Outro</option>
                      </select>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <DateTimePickerField
                        label="Início"
                        dateValue={extractDatePart(blockEditForm.startAt)}
                        timeValue={extractTimePart(blockEditForm.startAt)}
                        onDateChange={(nextDate) =>
                          setBlockEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  startAt: combineDateAndTime(
                                    nextDate,
                                    extractTimePart(prev.startAt)
                                  ),
                                }
                              : prev
                          )
                        }
                        onTimeChange={(nextTime) =>
                          setBlockEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  startAt: combineDateAndTime(
                                    extractDatePart(prev.startAt),
                                    nextTime
                                  ),
                                }
                              : prev
                          )
                        }
                      />

                      <DateTimePickerField
                        label="Fim"
                        dateValue={extractDatePart(blockEditForm.endAt)}
                        timeValue={extractTimePart(blockEditForm.endAt)}
                        onDateChange={(nextDate) =>
                          setBlockEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  endAt: combineDateAndTime(
                                    nextDate,
                                    extractTimePart(prev.endAt)
                                  ),
                                }
                              : prev
                          )
                        }
                        onTimeChange={(nextTime) =>
                          setBlockEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  endAt: combineDateAndTime(
                                    extractDatePart(prev.endAt),
                                    nextTime
                                  ),
                                }
                              : prev
                          )
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Observações
                      </label>
                      <textarea
                        value={blockEditForm.notes}
                        onChange={(e) =>
                          setBlockEditForm((prev) =>
                            prev ? { ...prev, notes: e.target.value } : prev
                          )
                        }
                        rows={5}
                        className="w-full rounded-xl border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-black"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => void saveBlockEdit()}
                        disabled={savingEdit}
                        className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingEdit ? "Salvando..." : "Salvar bloqueio"}
                      </button>

                      <button
                        onClick={cancelEditingSelectedItem}
                        disabled={savingEdit}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancelar edição
                      </button>
                    </div>
                  </div>
                ) : null}

                {!editMode ? (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Início
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-gray-900">
                        {formatDateTime(selectedItem.startAt)}
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Fim
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-gray-900">
                        {formatDateTime(selectedItem.endAt)}
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Cliente
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-gray-900">
                        {selectedItem.customerName || "-"}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {formatPhone(selectedItem.customerPhone)}
                      </div>
                    </div>

                    {selectedItem.itemKind === "appointment" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl bg-gray-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Lead vinculado
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-gray-900">
                            {selectedItemLeadOption?.leadName || selectedItem.customerName || (selectedItem.leadId ? "Lead vinculado" : "-")}
                          </div>
                          <div className="mt-1 break-all text-xs text-gray-500">
                            {selectedItem.leadId || "Sem lead vinculado"}
                          </div>
                          {selectedItemLeadOption?.leadState ? (
                            <div className="mt-0.5 text-[11px] text-gray-500">
                              Etapa atual: {selectedItemLeadOption.leadState}
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-xl bg-gray-50 p-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Conversa vinculada
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-gray-900">
                            {selectedItem.conversationId ? "Conversa conectada" : "Sem conversa vinculada"}
                          </div>
                          <div className="mt-1 break-all text-xs text-gray-500">
                            {selectedItem.conversationId || "-"}
                          </div>
                          {selectedItem.conversationId && selectedItemLeadOption?.conversationId === selectedItem.conversationId ? (
                            <div className="mt-0.5 text-[11px] text-gray-500">
                              Status: {selectedItemLeadOption.conversationStatus || "-"}
                              {selectedItemLeadOption.isHumanActive ? " • Humano ativo" : " • IA ativa"}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Endereço
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap text-xs font-medium text-gray-900">
                        {selectedItem.addressText || "-"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Observações
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap text-xs font-medium text-gray-900">
                        {selectedItem.notes || "-"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Origem
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-gray-900">
                        {selectedItem.source || "-"}
                      </div>
                    </div>
                  </div>
                ) : null}
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
              className="flex h-full w-full max-w-[min(92vw,640px)] flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-5 py-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500">
                    Novo bloqueio
                  </div>
                  <h3 className="mt-0.5 text-xl font-bold text-gray-900">
                    Criar bloqueio manual
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeCreateBlockPanel}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {blockErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {blockErrorText}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    >
                      <option value="manual_block">Bloqueio manual</option>
                      <option value="personal_unavailable">Indisponível</option>
                      <option value="team_unavailable">Equipe indisponível</option>
                      <option value="holiday">Feriado</option>
                      <option value="other">Outro</option>
                    </select>
                  </div>

                  <div className="hidden">
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
                      Opportunity comercial
                    </label>
                    <select
                      value={appointmentCreateForm.commercialOpportunityId}
                      onChange={(e) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          commercialOpportunityId: e.target.value,
                        }))
                      }
                      disabled={
                        appointmentCreateForm.appointmentType !== "technical_visit" ||
                        !appointmentCreateForm.leadId
                      }
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-50"
                    >
                      <option value="">Sem vínculo comercial</option>
                      {commercialOpportunitySelectOptions.map((opportunity) => (
                        <option key={opportunity.value} value={opportunity.value}>
                          {opportunity.label}
                          {opportunity.stage ? ` • ${opportunity.stage}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {appointmentCreateForm.appointmentType !== "technical_visit"
                        ? "A projeção automática só se aplica a visita técnica."
                        : loadingLeadCommercialOpportunityOptions
                          ? "Carregando opportunities do lead..."
                          : appointmentCreateForm.leadId
                            ? "Seleção explícita. Nenhuma opportunity é inferida automaticamente."
                            : "Escolha primeiro o lead para selecionar uma opportunity válida."}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <DateTimePickerField
                      label="Início"
                      dateValue={extractDatePart(blockForm.startAt)}
                      timeValue={extractTimePart(blockForm.startAt)}
                      onDateChange={(nextDate) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          startAt: combineDateAndTime(
                            nextDate,
                            extractTimePart(prev.startAt)
                          ),
                        }))
                      }
                      onTimeChange={(nextTime) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          startAt: combineDateAndTime(
                            extractDatePart(prev.startAt),
                            nextTime
                          ),
                        }))
                      }
                    />

                    <DateTimePickerField
                      label="Fim"
                      dateValue={extractDatePart(blockForm.endAt)}
                      timeValue={extractTimePart(blockForm.endAt)}
                      onDateChange={(nextDate) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          endAt: combineDateAndTime(
                            nextDate,
                            extractTimePart(prev.endAt)
                          ),
                        }))
                      }
                      onTimeChange={(nextTime) =>
                        setBlockForm((prev) => ({
                          ...prev,
                          endAt: combineDateAndTime(
                            extractDatePart(prev.endAt),
                            nextTime
                          ),
                        }))
                      }
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-xl border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void saveNewBlock()}
                      disabled={savingBlock}
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingBlock ? "Salvando..." : "Salvar bloqueio"}
                    </button>

                    <button
                      onClick={closeCreateBlockPanel}
                      disabled={savingBlock}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
              className="flex h-full w-full max-w-[min(92vw,640px)] flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-black/10 px-5 py-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500">
                    Novo compromisso
                  </div>
                  <h3 className="mt-0.5 text-xl font-bold text-gray-900">
                    Criar compromisso manual
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={closeCreateAppointmentPanel}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                >
                  Fechar
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {appointmentCreateErrorText ? (
                  <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
                    {appointmentCreateErrorText}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                      >
                        <option value="technical_visit">Visita técnica</option>
                        <option value="installation">Instalação</option>
                        <option value="follow_up">Retorno</option>
                        <option value="meeting">Reunião</option>
                        <option value="measurement">Medição</option>
                        <option value="maintenance">Manutenção</option>
                        <option value="other">Outro</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                      >
                        <option value="scheduled">Agendado</option>
                        <option value="rescheduled">Remarcado</option>
                        <option value="completed">Concluído</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <DateTimePickerField
                      label="Início"
                      dateValue={extractDatePart(appointmentCreateForm.scheduledStart)}
                      timeValue={extractTimePart(appointmentCreateForm.scheduledStart)}
                      onDateChange={(nextDate) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          scheduledStart: combineDateAndTime(
                            nextDate,
                            extractTimePart(prev.scheduledStart)
                          ),
                        }))
                      }
                      onTimeChange={(nextTime) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          scheduledStart: combineDateAndTime(
                            extractDatePart(prev.scheduledStart),
                            nextTime
                          ),
                        }))
                      }
                    />

                    <DateTimePickerField
                      label="Fim"
                      dateValue={extractDatePart(appointmentCreateForm.scheduledEnd)}
                      timeValue={extractTimePart(appointmentCreateForm.scheduledEnd)}
                      onDateChange={(nextDate) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          scheduledEnd: combineDateAndTime(
                            nextDate,
                            extractTimePart(prev.scheduledEnd)
                          ),
                        }))
                      }
                      onTimeChange={(nextTime) =>
                        setAppointmentCreateForm((prev) => ({
                          ...prev,
                          scheduledEnd: combineDateAndTime(
                            extractDatePart(prev.scheduledEnd),
                            nextTime
                          ),
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Lead vinculado
                      </label>
                      <select
                        value={appointmentCreateForm.leadId}
                        onChange={(e) => handleAppointmentLeadChange(e.target.value)}
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                      >
                        <option value="">Sem vínculo manual</option>
                        {leadOptions.map((lead) => (
                          <option key={lead.leadId} value={lead.leadId}>
                            {lead.leadName}{lead.leadState ? ` • ${lead.leadState}` : ""}
                          </option>
                        ))}
                      </select>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {loadingLeadOptions
                          ? "Carregando leads da loja..."
                          : createLeadConversationState.status === "loading"
                          ? "Buscando a conversa mais recente desse lead..."
                          : selectedLeadOption
                          ? `Telefone: ${formatPhone(selectedLeadOption.leadPhone)}${createLeadConversationState.status === "resolved" ? " • Conversa conectada" : ""}`
                          : "Opcional. Ao escolher um lead, nome e telefone podem ser preenchidos automaticamente."}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Conversa vinculada
                      </label>
                      <input
                        value={effectiveCreateConversationId}
                        readOnly
                        placeholder="Será preenchida automaticamente pelo lead"
                        className="w-full rounded-lg border border-black/10 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 outline-none"
                      />
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {createLeadConversationState.status === "loading"
                          ? "Buscando a conversa mais recente desse lead..."
                          : createLeadConversationState.status === "resolved"
                          ? createLeadConversationState.isHumanActive
                            ? "Conversa conectada com humano ativo neste momento."
                            : createLeadConversationState.lastMessageAt
                            ? `Conversa conectada • Última mensagem em ${formatDateTime(createLeadConversationState.lastMessageAt)}`
                            : "Conversa conectada."
                          : ""}
                      </div>
                    </div>
                  </div>

                  {appointmentCreateForm.appointmentType === "technical_visit" ? (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-gray-700">
                        Oportunidade vinculada
                      </label>
                      <select
                        value={appointmentCreateForm.commercialOpportunityId}
                        onChange={(e) =>
                          setAppointmentCreateForm((prev) => ({
                            ...prev,
                            commercialOpportunityId: e.target.value,
                          }))
                        }
                        disabled={!appointmentCreateForm.leadId}
                        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-50"
                      >
                        <option value="">
                          Selecione a oportunidade comercial
                        </option>
                        {commercialOpportunitySelectOptions.map((opportunity) => (
                          <option
                            key={opportunity.value}
                            value={opportunity.value}
                          >
                            {opportunity.stage
                              ? `${opportunity.stage} • ${opportunity.label}`
                              : opportunity.label}
                          </option>
                        ))}
                      </select>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {!appointmentCreateForm.leadId
                          ? "Escolha primeiro o lead para listar as opportunities compatíveis."
                          : loadingLeadCommercialOpportunityOptions
                            ? "Carregando opportunities compatíveis com o lead e a conversa selecionados..."
                            : commercialOpportunitySelectOptions.length > 0
                              ? "Seleção explícita. Nenhuma opportunity é inferida automaticamente."
                              : "Nenhuma opportunity compatível encontrada para o contexto atual."}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-gray-700">
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
                      className="w-full rounded-xl border border-black/10 px-2.5 py-2 text-xs outline-none focus:border-black"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void saveNewAppointment()}
                      disabled={savingAppointmentCreate}
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingAppointmentCreate ? "Salvando..." : "Salvar compromisso"}
                    </button>

                    <button
                      onClick={closeCreateAppointmentPanel}
                      disabled={savingAppointmentCreate}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
