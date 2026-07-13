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

/** Distinct chip colors per specialty so the census reads at a glance (Tailwind utility classes). */
export const SPECIALTY_CHIP_STYLES: Record<string, string> = {
  [Specialty.MEDICINA]: 'bg-sky-50 text-sky-700 ring-sky-200',
  [Specialty.CIRUGIA]: 'bg-rose-50 text-rose-700 ring-rose-200',
  [Specialty.TRAUMATOLOGIA]: 'bg-orange-50 text-orange-700 ring-orange-200',
  [Specialty.GINECOBSTETRICIA]: 'bg-pink-50 text-pink-700 ring-pink-200',
  [Specialty.PSIQUIATRIA]: 'bg-violet-50 text-violet-700 ring-violet-200',
  [Specialty.PEDIATRIA]: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  [Specialty.ODONTOLOGIA]: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  [Specialty.OTRO]: 'bg-slate-100 text-slate-600 ring-slate-200',
};

/** Fallback style for a specialty label not in the map (e.g. a free-typed value). */
export const SPECIALTY_CHIP_FALLBACK = 'bg-slate-100 text-slate-600 ring-slate-200';

export const ADMISSION_ORIGIN_OPTIONS: string[] = ['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro'];
export type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
