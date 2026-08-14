import type { StoreScheduleSettingsRow } from "./types";
import {
  addMinutesToIso,
  buildIsoFromDateAndTime,
  parseDateReferenceFromText,
  parseTimeRangeFromText,
} from "./datetime";

export function getRescheduleTargetTextSegment(text: string) {
  const raw = String(text || "");
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (
    !(
      normalized.includes("remarca") ||
      normalized.includes("remarque") ||
      normalized.includes("remarcar") ||
      normalized.includes("reagenda") ||
      normalized.includes("reagende") ||
      normalized.includes("reagendar")
    )
  ) {
    return raw;
  }

  const matches = Array.from(raw.matchAll(/\b(?:para|pra)\b/gi));
  if (!matches.length) return raw;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const markerIndex = typeof match.index === "number" ? match.index : -1;
    if (markerIndex < 0) continue;

    const afterMarker = raw.slice(markerIndex + match[0].length).trim();
    if (!afterMarker) continue;

    const hasDateCue =
      /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/.test(afterMarker) ||
      /\b(?:hoje|amanha|amanhã|depois de amanha|depois de amanhã|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i.test(
        afterMarker,
      ) ||
      /\b(?:dia|data)\s+\d{1,2}\b/i.test(afterMarker);
    const hasTimeCue =
      /\b\d{1,2}(?::\d{2})?\s*h\b/i.test(afterMarker) ||
      /\b(?:as|às)\s+\d{1,2}(?::\d{2})?\b/i.test(afterMarker) ||
      /\b\d{1,2}:\d{2}\b/.test(afterMarker);

    if (hasDateCue || hasTimeCue) return afterMarker;
  }

  return raw;
}

export function parseRescheduleTargetFromText(args: {
  text: string;
  now: Date;
  settings?: StoreScheduleSettingsRow | null;
}) {
  const targetText = getRescheduleTargetTextSegment(args.text);
  const dateParts = parseDateReferenceFromText(targetText, args.now);
  const timeRange = parseTimeRangeFromText(targetText);

  if (!dateParts || !timeRange?.startTime) {
    return {
      ok: false as const,
      targetText,
      message:
        "Para remarcar, me diga a nova data e a nova hora. Exemplo: remarca para 25/04 às 15:00.",
    };
  }

  const scheduledStart = buildIsoFromDateAndTime(
    dateParts,
    timeRange.startTime,
    args.settings || null,
  );
  const scheduledEnd = timeRange.endTime
    ? buildIsoFromDateAndTime(dateParts, timeRange.endTime, args.settings || null)
    : addMinutesToIso(scheduledStart, 60);

  return {
    ok: true as const,
    targetText,
    dateParts,
    timeRange,
    payload: {
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    },
  };
}
