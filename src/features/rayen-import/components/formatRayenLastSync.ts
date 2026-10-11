import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

/** Last-sync instant formatted in island time (Pacific/Easter), e.g. "12-07-2026 · 14:32 h". */
export const formatLastSync = (meta: RayenSyncMeta): string | null => {
  const when = new Date(meta.at);
  if (Number.isNaN(when.getTime())) return null;
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const get = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} · ${get('hour')}:${get('minute')} h`;
};
