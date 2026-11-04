import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';

/** Eloísa caps a note at 255 characters; the census keeps a bounded copy of each. */
const MAX_ALERT_TEXT = 500;
const MAX_ALERTS = 30;
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

const text = (value: unknown, max = 120): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Rapa Nui wall clock of an Eloísa instant; a stamp without its offset is not guessed. */
const rapaNuiStamp = (value: unknown): string => {
  const raw = text(value, 40);
  const instant = EXPLICIT_OFFSET.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isFinite(instant)) return '';
  const { iso, hhmm } = calendarStampInClinicalTimeZone(new Date(instant));
  return `${iso}T${hhmm}`;
};

/**
 * Active notes of Eloísa's «Alertas» panel (`entrySummary/alertEntry`). Measured 2026-11-03 in
 * Ficha Médico's own code: a note stops being active once archived, deleted or ended. Unsigned
 * drafts are not published yet and stay out. Newest first, in a stable order.
 */
export const parseClinicalAlerts = (entries: readonly unknown[]): PatientClinicalAlert[] => {
  const active = entries.flatMap((entry): PatientClinicalAlert[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (item.archived === true || item.deleted === true || item.isSigned !== true) return [];
    if (item.deletedDateTime != null || item.endDateTime != null) return [];
    const id = text(item.guid) || text(String(item.id ?? ''));
    const body = text(item.observation, MAX_ALERT_TEXT);
    const recordedAt = rapaNuiStamp(item.startDateTime);
    if (!id || !body || !recordedAt) return [];
    const author = text(item.authorHealthCarePractitionerName);
    const role = text(item.authorHealthCarePractitionerRoleName);
    return [
      {
        id,
        text: body,
        recordedAt,
        ...(author ? { author } : {}),
        ...(role ? { role } : {}),
        ...(item.visitor === true ? { visitor: true } : {}),
      },
    ];
  });
  return [...new Map(active.map(alert => [alert.id, alert])).values()]
    .sort(
      (left, right) =>
        right.recordedAt.localeCompare(left.recordedAt) || left.id.localeCompare(right.id)
    )
    .slice(0, MAX_ALERTS);
};
