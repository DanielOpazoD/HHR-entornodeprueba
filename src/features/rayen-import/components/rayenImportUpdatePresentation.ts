import type { FieldChange, UpdateEntry } from '../contracts/censusImportDiff';

const INTERNAL_SYNC_FIELDS = new Set<FieldChange['field']>([
  'clinicalEpisodeId',
  'clinicalCrib',
  'treatingPhysicianId',
  'treatingPhysicianName',
]);

const FIELD_LABELS: Partial<Record<FieldChange['field'], string>> = {
  patientName: 'nombre',
  firstName: 'identidad',
  lastName: 'identidad',
  secondLastName: 'identidad',
  rut: 'RUT',
  birthDate: 'fecha de nacimiento',
  age: 'edad',
  biologicalSex: 'sexo biológico',
  admissionDate: 'fecha de ingreso',
  admissionTime: 'hora de ingreso',
  pathology: 'diagnóstico',
  cie10Code: 'diagnóstico CIE-10',
  cie10Description: 'diagnóstico CIE-10',
  specialty: 'especialidad',
  isIsolated: 'aislamiento',
  isolationType: 'tipo de aislamiento',
  isolationMicroorganism: 'microorganismo',
};

export interface PresentedUpdateEntry extends UpdateEntry {
  visibleLabels: string[];
}

/**
 * Keeps technical and operational enrichment (including treating-physician catalog metadata)
 * out of the nurse-facing review while preserving the underlying update in the import plan.
 * The modal is reserved for changes that require clinical confirmation; labels are deduplicated.
 */
export const presentPatientUpdates = (updates: UpdateEntry[]): PresentedUpdateEntry[] =>
  updates.flatMap(entry => {
    const visibleLabels = Array.from(
      new Set(
        entry.changes
          .filter(change => !INTERNAL_SYNC_FIELDS.has(change.field))
          .map(change => FIELD_LABELS[change.field] ?? 'información del paciente')
      )
    );
    return visibleLabels.length > 0 ? [{ ...entry, visibleLabels }] : [];
  });
