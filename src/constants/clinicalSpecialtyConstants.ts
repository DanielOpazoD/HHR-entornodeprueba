import { Specialty, PatientStatus } from '@/types/domain/patientClassification';

export const SPECIALTY_OPTIONS = Object.values(Specialty).filter(s => s !== '');
export const STATUS_OPTIONS = Object.values(PatientStatus).filter(s => s !== '');

export const SPECIALTY_ABBREVIATIONS: Record<string, string> = {
  [Specialty.MEDICINA]: 'MI',
  [Specialty.CIRUGIA]: 'Cir',
  [Specialty.TRAUMATOLOGIA]: 'TMT',
  [Specialty.GINECOBSTETRICIA]: 'Gyn',
  [Specialty.PSIQUIATRIA]: 'PSQ',
  [Specialty.PEDIATRIA]: 'Ped',
  [Specialty.ODONTOLOGIA]: 'Odo',
  [Specialty.OTRO]: 'Otro',
};

/**
 * Chip color per specialty. All real specialties share ONE soft celeste (they are all "a specialty");
 * only the unspecified one ("Otro" / No especificado) stands out in a muted amber so it reads as
 * "still generic — consider assigning a real one". Tailwind utility classes.
 */
const SPECIALTY_CHIP_CELESTE = 'bg-sky-50 text-sky-600 ring-sky-100';
const SPECIALTY_CHIP_UNSPECIFIED = 'bg-amber-50 text-amber-600 ring-amber-200';

export const SPECIALTY_CHIP_STYLES: Record<string, string> = {
  [Specialty.MEDICINA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.CIRUGIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.TRAUMATOLOGIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.GINECOBSTETRICIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.PSIQUIATRIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.PEDIATRIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.ODONTOLOGIA]: SPECIALTY_CHIP_CELESTE,
  [Specialty.OTRO]: SPECIALTY_CHIP_UNSPECIFIED,
};

/** Fallback for a specialty label not in the map (a free-typed value is still "a specialty"). */
export const SPECIALTY_CHIP_FALLBACK = SPECIALTY_CHIP_CELESTE;

export const ADMISSION_ORIGIN_OPTIONS: string[] = ['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro'];
export type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
