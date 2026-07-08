export type DailyRecordClinicalLockKey =
  | 'diagnosis'
  | 'status'
  | 'specialty'
  | 'upc'
  | 'surgicalComplication';

export interface ParsedDailyRecordBedPatchPath {
  bedId: string;
  field?: string;
  canonicalPath?: string;
}

const CLINICAL_FIELD_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['pathology', 'cie10Code', 'cie10Description', 'diagnosisComments']),
  new Set(['status']),
  new Set(['specialty', 'secondarySpecialty']),
  new Set(['isUPC', 'upcChecklist']),
  new Set(['surgicalComplication']),
  new Set([
    'ginecobstetriciaType',
    'deliveryDate',
    'deliveryRoute',
    'deliveryCesareanLabor',
    'clinicalCrib',
  ]),
];

export const normalizeDailyRecordClinicalField = (field: string): string =>
  field.startsWith('clinicalCrib.') ? field.slice('clinicalCrib.'.length) : field;

export const parseDailyRecordBedPatchPath = (
  path: string
): ParsedDailyRecordBedPatchPath | null => {
  const bedMatch = path.match(/^beds\.([^.]+)$/);
  if (bedMatch) {
    return { bedId: bedMatch[1] };
  }

  const clinicalCribMatch = path.match(/^beds\.([^.]+)\.clinicalCrib\.([^.]+)/);
  if (clinicalCribMatch) {
    const [, bedId, field] = clinicalCribMatch;
    return {
      bedId,
      field: `clinicalCrib.${field}`,
      canonicalPath: path,
    };
  }

  const fieldMatch = path.match(/^beds\.([^.]+)\.([^.]+)/);
  if (!fieldMatch) {
    return null;
  }
  const [, bedId, field] = fieldMatch;
  return {
    bedId,
    field,
    canonicalPath: `beds.${bedId}.${field}`,
  };
};

export const resolveDailyRecordClinicalGroup = (field: string): ReadonlySet<string> | null =>
  CLINICAL_FIELD_GROUPS.find(group => group.has(normalizeDailyRecordClinicalField(field))) ?? null;

export const resolveDailyRecordClinicalLockKey = (
  field: string
): DailyRecordClinicalLockKey | null => {
  const normalizedField = normalizeDailyRecordClinicalField(field);
  if (
    ['pathology', 'cie10Code', 'cie10Description', 'diagnosisComments'].includes(normalizedField)
  ) {
    return 'diagnosis';
  }
  if (normalizedField === 'status') return 'status';
  if (normalizedField === 'specialty' || normalizedField === 'secondarySpecialty') {
    return 'specialty';
  }
  if (normalizedField === 'isUPC' || normalizedField === 'upcChecklist') return 'upc';
  if (normalizedField === 'surgicalComplication') return 'surgicalComplication';
  if (
    [
      'ginecobstetriciaType',
      'deliveryDate',
      'deliveryRoute',
      'deliveryCesareanLabor',
      'clinicalCrib',
    ].includes(normalizedField)
  ) {
    return 'diagnosis';
  }
  return null;
};
