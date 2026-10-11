import type { PatientData } from '../contracts/rayenDomainContracts';
import type { CensusImportDiff, FieldChange, UpdateEntry } from '../contracts/censusImportDiff';

const INTERNAL_SYNC_FIELDS = new Set<FieldChange['field']>([
  'neonatalPlacementDecision',
  'neonatalMaternalRut',
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
    for (const change of entry.changes.filter(c => c.field === 'clinicalCrib')) {
      const before = change.from as PatientData | undefined;
      const after = change.to as PatientData | undefined;
      if (
        after?.patientName &&
        (!before?.patientName || before.clinicalEpisodeId !== after.clinicalEpisodeId)
      )
        visibleLabels.push(`cuna C-${entry.bedId} · ${after.patientName}`);
    }
    return visibleLabels.length > 0 ? [{ ...entry, visibleLabels }] : [];
  });

export const updateEntryKey = (entry: CensusImportDiff['updates'][number]): string => {
  const subject = entry.source?.encounterId || entry.rut || entry.patientName;
  const fields = entry.changes.map(change => String(change.field)).sort();
  return JSON.stringify([entry.bedId, subject, fields]);
};
