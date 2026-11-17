/**
 * Text and Label normalization for MINSAL stats
 */
import { removeAccents } from '@/utils/stringUtils';

export function normalizeSpecialty(specialty: string | undefined): string {
  if (!specialty) return 'Sin Especialidad';

  const normalized = specialty.trim();

  // Combine legacy gynecology/obstetrics names into unified specialty
  const gynObstetricNames = [
    'Obstetricia',
    'Ginecología',
    'Ginecologia',
    'Obstetricia y Ginecología',
    'Ginecología y Obstetricia',
  ];

  if (gynObstetricNames.some(name => normalized.toLowerCase() === name.toLowerCase())) {
    return 'Ginecobstetricia';
  }

  return normalized || 'Sin Especialidad';
}

export const normalizeEvacuationMethodLabel = (value?: string): string =>
  removeAccents((value || '').trim().toLowerCase());

export const isFachEvacuationMethod = (value?: string): boolean => {
  const normalized = normalizeEvacuationMethodLabel(value);
  return normalized === 'fach' || normalized === 'avion fach';
};
