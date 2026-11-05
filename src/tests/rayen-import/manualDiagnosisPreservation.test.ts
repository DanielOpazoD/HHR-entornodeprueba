import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildUpdatePatientPatches,
  buildClinicalCribMultipleFieldPatches,
} from '@/hooks/controllers/bedManagementPatchController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import {
  applyReviewedPatientChanges,
  diffSyncablePatientFields,
  mergeSyncablePatient,
} from '@/features/rayen-import/domain/patientSyncPolicy';

const diagnosis = {
  pathology: 'Diagnóstico manual',
  cie10Code: 'R50.9',
  cie10Description: 'Fiebre',
};
describe('diagnosis authority', () => {
  it.each([false, true])(
    'diagnosis edits win over a stale marker in either property order (stored %s)',
    initial => {
      const record = DataFactory.createMockDailyRecord('2026-11-04');
      record.beds.R1.diagnosisManualOverride = initial;
      record.beds.R1.clinicalCrib = DataFactory.createMockPatient('R1', {
        diagnosisManualOverride: initial,
      });
      for (const fields of [
        { pathology: 'Nueva edición manual', diagnosisManualOverride: false },
        { diagnosisManualOverride: false, pathology: 'Nueva edición manual' },
      ]) {
        const adult = buildUpdatePatientPatches(record, 'R1', fields);
        expect(adult['beds.R1.diagnosisManualOverride'] ?? initial).toBe(true);
        const crib = buildClinicalCribMultipleFieldPatches(record, 'R1', fields);
        expect(crib['beds.R1.clinicalCrib.diagnosisManualOverride'] ?? initial).toBe(true);
      }
    }
  );
  it('marks manual text and code edits in the same patient patch', () => {
    const record = DataFactory.createMockDailyRecord('2026-11-04');
    expect(
      bedManagementReducer(record, {
        type: 'UPDATE_PATIENT',
        bedId: 'R1',
        field: 'pathology',
        value: 'Manual',
      })
    ).toMatchObject({ 'beds.R1.pathology': 'Manual', 'beds.R1.diagnosisManualOverride': true });
    expect(
      bedManagementReducer(record, {
        type: 'UPDATE_PATIENT_MULTIPLE',
        bedId: 'R1',
        fields: diagnosis,
      })
    ).toMatchObject({ 'beds.R1.diagnosisManualOverride': true });
    expect(
      bedManagementReducer(record, {
        type: 'UPDATE_CLINICAL_CRIB',
        bedId: 'R1',
        field: 'pathology',
        value: 'Manual RN',
      })
    ).toMatchObject({ 'beds.R1.clinicalCrib.diagnosisManualOverride': true });
  });
  it('updates a source-owned diagnosis but preserves a deliberate manual blank or text', () => {
    const incoming = DataFactory.createMockPatient('R1', {
      pathology: 'Nuevo Eloísa',
      cie10Code: 'J18.9',
      cie10Description: 'Neumonía',
    });
    const old = DataFactory.createMockPatient('R1', diagnosis);
    expect(mergeSyncablePatient(old, incoming).pathology).toBe('Nuevo Eloísa');
    for (const pathology of ['', diagnosis.pathology]) {
      const manual = { ...old, pathology, diagnosisManualOverride: true };
      expect(mergeSyncablePatient(manual, incoming)).toMatchObject({ ...diagnosis, pathology });
    }
  });
  it('does not carry a manual override into a different episode', () => {
    const current = DataFactory.createMockPatient('R1', {
      ...diagnosis,
      diagnosisManualOverride: true,
      clinicalEpisodeId: 'old',
    });
    const incoming = { ...current, clinicalEpisodeId: 'new', pathology: 'Nueva hospitalización' };
    const merged = mergeSyncablePatient(current, incoming);
    expect(merged.pathology).toBe('Nueva hospitalización');
    expect(merged.diagnosisManualOverride).toBeUndefined();
    const reviewed = applyReviewedPatientChanges(
      current,
      incoming,
      diffSyncablePatientFields(current, incoming)
    );
    expect(reviewed.diagnosisManualOverride).toBeUndefined();
    expect(
      mergeSyncablePatient(reviewed, { ...incoming, pathology: 'Siguiente diagnóstico' }).pathology
    ).toBe('Siguiente diagnóstico');
  });

  it('preserves manual diagnosis when the reviewed selection excludes the episode transition', () => {
    const current = DataFactory.createMockPatient('R1', {
      ...diagnosis,
      diagnosisManualOverride: true,
      clinicalEpisodeId: 'old',
    });
    const incoming = { ...current, clinicalEpisodeId: 'new', pathology: 'Nuevo Eloísa' };
    const selected = diffSyncablePatientFields(current, incoming).filter(
      change => change.field !== 'clinicalEpisodeId'
    );
    expect(applyReviewedPatientChanges(current, incoming, selected)).toMatchObject({
      ...diagnosis,
      clinicalEpisodeId: 'old',
      diagnosisManualOverride: true,
    });
  });

  it('preserves edits made after preview when applying the reviewed changes', () => {
    const old = DataFactory.createMockPatient('R1', { pathology: 'Previo' });
    const incoming = { ...old, pathology: 'Nuevo Eloísa' };
    const changes = diffSyncablePatientFields(old, incoming);
    const manual = { ...old, ...diagnosis, diagnosisManualOverride: true };
    expect(applyReviewedPatientChanges(manual, incoming, changes)).toMatchObject(diagnosis);
  });
});
