// @vitest-environment node
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
import { presentPatientUpdates } from '@/features/rayen-import/components/rayenImportUpdatePresentation';
import { buildRestoreEloisaDiagnosisPatch } from '@/shared/census/diagnosisManualOverridePolicy';
import { PatientDataSchema } from '@/schemas/zod/patient';

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

  it('captures the overridden Eloísa baseline once and keeps it across further manual edits', () => {
    const record = DataFactory.createMockDailyRecord('2026-11-26');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-101',
      pathology: 'Fiebre',
      cie10Code: 'R50.9',
      cie10Description: 'Fiebre',
    });

    const firstEdit = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'pathology',
      value: 'Fiebre prolongada en estudio',
    });
    expect(firstEdit).toMatchObject({
      'beds.R1.pathology': 'Fiebre prolongada en estudio',
      'beds.R1.diagnosisManualOverride': true,
      'beds.R1.diagnosisManualOverrideBase': { pathology: 'Fiebre', cie10Code: 'R50.9' },
    });

    record.beds.R1 = {
      ...record.beds.R1,
      pathology: 'Fiebre prolongada en estudio',
      cie10Code: undefined,
      cie10Description: undefined,
      diagnosisManualOverride: true,
      diagnosisManualOverrideBase: { pathology: 'Fiebre', cie10Code: 'R50.9' },
    };

    const secondEdit = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'pathology',
      value: 'Fiebre y exantema en estudio',
    });
    expect(secondEdit).toEqual({
      'beds.R1.pathology': 'Fiebre y exantema en estudio',
    });
  });

  it('keeps manual diagnosis while Eloísa repeats the baseline, then proposes updates when Eloísa records a new diagnosis', () => {
    const manual = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-102',
      pathology: 'Fiebre en estudio (HHR)',
      cie10Code: undefined,
      cie10Description: undefined,
      diagnosisManualOverride: true,
      diagnosisManualOverrideBase: { pathology: 'Fiebre', cie10Code: 'R50.9' },
    });

    // Same diagnosis (whitespace/case noise, missing code, or empty source) stays protected.
    for (const unchangedSource of [
      { pathology: '  fiebre ', cie10Code: 'r50.9', cie10Description: 'Fiebre' },
      { pathology: 'Fiebre', cie10Code: undefined, cie10Description: undefined },
      { pathology: '', cie10Code: undefined, cie10Description: undefined },
    ]) {
      const incoming = { ...manual, ...unchangedSource };
      expect(diffSyncablePatientFields(manual, incoming)).toEqual([]);
      expect(mergeSyncablePatient(manual, incoming).pathology).toBe('Fiebre en estudio (HHR)');
    }

    // Adding a CIE-10 code to the exact same uncoded baseline text does not overwrite manual text.
    const uncodedManual = {
      ...manual,
      diagnosisManualOverrideBase: { pathology: 'Fiebre' },
    };
    expect(
      diffSyncablePatientFields(uncodedManual, {
        ...uncodedManual,
        pathology: 'Fiebre',
        cie10Code: 'R50.9',
        cie10Description: 'Fiebre',
      })
    ).toEqual([]);

    // Once Eloísa records a new diagnosis, sync proposes it cleanly and clears the manual lock.
    const newerEloisa = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-102',
      pathology: 'Neumonía bacteriana',
      cie10Code: 'J15',
      cie10Description: 'Neumonía bacteriana',
    });
    const changes = diffSyncablePatientFields(manual, newerEloisa);
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: 'pathology', from: 'Fiebre en estudio (HHR)', to: 'Neumonía bacteriana' },
        { field: 'cie10Code', from: undefined, to: 'J15' },
        { field: 'diagnosisManualOverride', from: true, to: undefined },
        {
          field: 'diagnosisManualOverrideBase',
          from: { pathology: 'Fiebre', cie10Code: 'R50.9' },
          to: undefined,
        },
      ])
    );

    const presented = presentPatientUpdates([
      {
        bedId: 'R1',
        rut: manual.rut,
        patientName: manual.patientName,
        changes,
        patient: newerEloisa,
      },
    ]);
    expect(presented[0]?.visibleLabels).toEqual(['diagnóstico', 'diagnóstico CIE-10']);

    const confirmed = applyReviewedPatientChanges(manual, newerEloisa, changes);
    expect(confirmed).toMatchObject({
      pathology: 'Neumonía bacteriana',
      cie10Code: 'J15',
      cie10Description: 'Neumonía bacteriana',
    });
    expect(confirmed.diagnosisManualOverride).toBeUndefined();
    expect(confirmed.diagnosisManualOverrideBase).toBeUndefined();

    // A manual edit made AFTER opening that review still wins over the reviewed proposal.
    const editedDuringReview = {
      ...manual,
      pathology: 'Edición manual más reciente',
    };
    const preserved = applyReviewedPatientChanges(editedDuringReview, newerEloisa, changes);
    expect(preserved.pathology).toBe('Edición manual más reciente');
    expect(preserved.diagnosisManualOverride).toBe(true);
  });

  it('unlocks a legacy manual override without baseline via the explicit restore patch', () => {
    const record = DataFactory.createMockDailyRecord('2026-11-26');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-legacy',
      pathology: 'Diagnóstico previo manual',
      diagnosisManualOverride: true,
    });
    const newerEloisa = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-legacy',
      pathology: 'Diagnóstico nuevo Eloísa',
      cie10Code: 'J18.9',
      cie10Description: 'Diagnóstico nuevo Eloísa',
    });

    // Legacy override (no baseline) stays protected until explicitly unlocked.
    expect(diffSyncablePatientFields(record.beds.R1, newerEloisa)).toEqual([]);

    const unlockPatch = buildUpdatePatientPatches(record, 'R1', buildRestoreEloisaDiagnosisPatch());
    expect(unlockPatch).toEqual({ 'beds.R1.diagnosisManualOverride': undefined });

    const unlocked = { ...record.beds.R1, diagnosisManualOverride: undefined };
    const afterUnlock = mergeSyncablePatient(unlocked, newerEloisa);
    expect(afterUnlock).toMatchObject({
      pathology: 'Diagnóstico nuevo Eloísa',
      cie10Code: 'J18.9',
      cie10Description: 'Diagnóstico nuevo Eloísa',
    });
  });

  it('supports baseline supersede on clinical cribs and round-trips schema parsing', () => {
    const currentCrib = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-rn-1',
      pathology: 'Ictericia manual',
      diagnosisManualOverride: true,
      diagnosisManualOverrideBase: { pathology: 'Observación RN' },
    });
    const newerCrib = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'ep-rn-1',
      pathology: 'Hiperbilirrubinemia neonatal',
      cie10Code: 'P59.9',
      cie10Description: 'Hiperbilirrubinemia neonatal',
    });
    const parent = DataFactory.createMockPatient('R1', { clinicalCrib: currentCrib });
    const mergedCrib = mergeSyncablePatient(currentCrib, newerCrib);
    const updatedParent = applyReviewedPatientChanges(
      parent,
      { ...parent, clinicalCrib: mergedCrib },
      [{ field: 'clinicalCrib', from: currentCrib, to: mergedCrib }]
    );
    expect(updatedParent.clinicalCrib).toMatchObject({
      pathology: 'Hiperbilirrubinemia neonatal',
      cie10Code: 'P59.9',
    });
    expect(updatedParent.clinicalCrib?.diagnosisManualOverride).toBeUndefined();
    expect(updatedParent.clinicalCrib?.diagnosisManualOverrideBase).toBeUndefined();

    expect(
      PatientDataSchema.parse({
        ...currentCrib,
        diagnosisManualOverrideBase: { pathology: 'Observación RN', cie10Code: 'P59.9' },
      }).diagnosisManualOverrideBase
    ).toEqual({ pathology: 'Observación RN', cie10Code: 'P59.9' });
    expect(
      PatientDataSchema.parse({
        ...currentCrib,
        diagnosisManualOverrideBase: null,
      }).diagnosisManualOverrideBase
    ).toBeUndefined();
  });
});
