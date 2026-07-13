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
 * Distinct — but SOFT — chip colors per specialty so the census reads at a glance without shouting
 * (very light bg, medium-tone text, hairline ring). Tailwind utility classes.
 */
export const SPECIALTY_CHIP_STYLES: Record<string, string> = {
  [Specialty.MEDICINA]: 'bg-sky-50 text-sky-600 ring-sky-100',
  [Specialty.CIRUGIA]: 'bg-rose-50 text-rose-500 ring-rose-100',
  [Specialty.TRAUMATOLOGIA]: 'bg-orange-50 text-orange-500 ring-orange-100',
  [Specialty.GINECOBSTETRICIA]: 'bg-pink-50 text-pink-500 ring-pink-100',
  [Specialty.PSIQUIATRIA]: 'bg-violet-50 text-violet-500 ring-violet-100',
  [Specialty.PEDIATRIA]: 'bg-cyan-50 text-cyan-600 ring-cyan-100',
  [Specialty.ODONTOLOGIA]: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  [Specialty.OTRO]: 'bg-slate-50 text-slate-500 ring-slate-200',
};

/** Fallback style for a specialty label not in the map (e.g. a free-typed value). */
export const SPECIALTY_CHIP_FALLBACK = 'bg-slate-50 text-slate-500 ring-slate-200';

export const ADMISSION_ORIGIN_OPTIONS: string[] = ['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro'];
export type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
