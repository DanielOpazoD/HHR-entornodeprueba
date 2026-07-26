import type { RayenEncounter } from '../contracts/rayenSnapshot';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';
import { encounterWallClockInRapaNui } from '../mapping/encounterWallClock';

/** Extract a YYYY-MM-DD day from ISO or DD/MM/YYYY input. */
export const toIsoCensusDay = (raw: string | undefined): string => {
  const value = (raw ?? '').trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
};

/** Clinical nursing day that owns the encounter admission in the Rapa Nui wall clock. */
export const clinicalAdmissionDay = (encounter: RayenEncounter): string => {
  const admission = encounterWallClockInRapaNui(encounter.admissionDatetime);
  if (!admission) return '';
  const day = admission.slice(0, 10);
  const time = admission.slice(11, 16);
  return resolveClinicalDayForDateTime(day, time) ?? day;
};

/**
 * A late synchronization must not add a patient before their clinical nursing day.
 * Admissions during the next calendar day's madrugada still belong to the preceding night shift.
 */
export const admittedAfterCensusDay = (encounter: RayenEncounter, censusDay: string): boolean => {
  if (!censusDay) return false;
  const admissionDay = clinicalAdmissionDay(encounter);
  return admissionDay !== '' && admissionDay > censusDay;
};
