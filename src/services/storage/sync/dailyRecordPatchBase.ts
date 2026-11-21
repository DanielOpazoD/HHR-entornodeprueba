import type { DailyRecord } from '@/types/domain/dailyRecord';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { NOTE_FIELDS } from './dayTaskReplayGuard';

const CONTEXT_FIELDS = [
  'patientName',
  'rut',
  'documentType',
  'clinicalEpisodeId',
  'admissionDate',
  'admissionTime',
  'firstSeenDate',
  ...NOTE_FIELDS,
] as const;

/** The original day's occupants and notes, including the newborn independently of the mother. */
export const capturePatchBaseContext = (record: DailyRecord): Record<string, unknown> =>
  Object.fromEntries(
    ['medicalHandoffNovedades', 'medicalHandoffBySpecialty']
      .map(path => [path, getValueAtPath(record, path)])
      .concat(
        Object.keys(record.beds ?? {}).flatMap(bedId =>
          [`beds.${bedId}`, `beds.${bedId}.clinicalCrib`].flatMap(slot => {
            const fields = CONTEXT_FIELDS.map(field => {
              const path = `${slot}.${field}`;
              return [path, getValueAtPath(record, path)];
            });
            // Server hydration can add empty bed rows. They have no occupant or note to own.
            const hasContext = CONTEXT_FIELDS.some(field => {
              if (field === 'documentType') return false;
              const value = getValueAtPath(record, `${slot}.${field}`);
              return value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
            });
            return hasContext ? fields : [];
          })
        )
      )
  );
