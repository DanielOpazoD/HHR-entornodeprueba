import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { NOTE_FIELDS, hasSameNoteValue } from './dayTaskReplayGuard';

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

/** Keep the narrow automatic lane out of identity changes, movements and handoff writes. */
export const isOrdinaryClinicalPatchPath = (path: string): boolean =>
  /^beds\.[^.]+\.(?:clinicalCrib\.)?(?:pathology|status)$/.test(path);

export const hasOriginalPatchContext = (
  context: Record<string, unknown> | undefined,
  local: DailyRecord,
  remote: DailyRecord
): boolean =>
  Boolean(
    context &&
    hasSameNoteValue(context, capturePatchBaseContext(local)) &&
    hasSameNoteValue(context, capturePatchBaseContext(remote))
  );
