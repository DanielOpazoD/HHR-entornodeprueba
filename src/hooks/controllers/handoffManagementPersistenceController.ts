import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getAttributedAuthors } from '@/services/admin/attributionService';

type HandoffShift = 'day' | 'night';

interface HandoffAuditEventPayload {
  action: 'HANDOFF_NOVEDADES_MODIFIED';
  entityType: 'dailyRecord';
  entityId: string;
  details: Record<string, unknown>;
  recordDate: string;
  authors?: string;
}

export const buildHandoffNovedadesAuditPayload = (
  record: DailyRecord,
  shift: HandoffShift,
  value: string,
  userId: string
): { authors: string; details: Record<string, unknown> } => {
  const authors = getAttributedAuthors(userId, record, shift);
  const previousValue =
    shift === 'day' ? record.handoffNovedadesDayShift : record.handoffNovedadesNightShift;

  return {
    authors: authors ?? '',
    details: {
      shift,
      content: value,
      changes: {
        novedades: { old: previousValue || '', new: value },
      },
    },
  };
};

export const buildHandoffNovedadesAuditEvent = (
  record: DailyRecord,
  shift: HandoffShift,
  value: string,
  userId: string
): HandoffAuditEventPayload => {
  const { authors, details } = buildHandoffNovedadesAuditPayload(record, shift, value, userId);
  return {
    action: 'HANDOFF_NOVEDADES_MODIFIED',
    entityType: 'dailyRecord',
    entityId: record.date,
    details,
    recordDate: record.date,
    authors,
  };
};
