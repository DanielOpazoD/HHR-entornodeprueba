import type { RayenEncounter } from '../contracts/rayenSnapshot';

/** Extract a YYYY-MM-DD day from ISO or DD/MM/YYYY input. */
export const toIsoCensusDay = (raw: string | undefined): string => {
  const value = (raw ?? '').trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
};

/** A late synchronization must not add a patient to a day before their admission. */
export const admittedAfterCensusDay = (encounter: RayenEncounter, censusDay: string): boolean => {
  if (!censusDay) return false;
  const admissionDay = toIsoCensusDay(encounter.admissionDatetime);
  return admissionDay !== '' && admissionDay > censusDay;
};
