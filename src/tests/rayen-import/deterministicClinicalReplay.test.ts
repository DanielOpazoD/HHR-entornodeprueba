import { describe, expect, it } from 'vitest';
import type { EgresoReportRow } from '@/features/rayen-import';
import {
  bradenHistoryEvent,
  captureFor,
  CURRENT_CLINICAL_DAY,
  emptyRecordFor,
  patientAt,
  syntheticEncounter,
  verifiedShortStayDischarge,
  vitalSignsForm,
} from './deterministicClinicalReplay.fixtures';
import { replay } from './deterministicClinicalReplay.harness';

describe('deterministic sanitized clinical replay', () => {
  it('persists vital signs despite a device-source failure, then recovers VVP without duplicate clinical facts', async () => {
    const admission = syntheticEncounter('admission');
    const census = captureFor(CURRENT_CLINICAL_DAY, [admission]);
    const formsByEpisode = {
      [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1001)],
    };
    const failed = await replay(emptyRecordFor(CURRENT_CLINICAL_DAY), census, {
      formsByEpisode,
      deviceErrorsByEpisode: { [admission.encounterId]: 'Fuente de dispositivos no disponible' },
    });

    expect(failed.terminalEvent.status).toBe('partial');
    expect(failed.clinical.errors).toEqual([
      expect.objectContaining({ source: 'devices', clinicalEpisodeId: admission.encounterId }),
    ]);
    expect(failed.record.beds.H1C1.vitalSigns).toMatchObject({ heartRate: 76, spo2: 98 });
    expect(failed.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    expect(failed.record.beds.H1C1.devices).toEqual([]);

    const recovered = await replay(failed.record, census, {
      formsByEpisode,
      devicesByEpisode: {
        [admission.encounterId]: [
          {
            name: 'Vía venosa periférica',
            location: 'Antebrazo derecho',
            installationDatetime: `${CURRENT_CLINICAL_DAY}T09:15:00-06:00`,
          },
        ],
      },
    });

    expect(recovered.terminalEvent.status).toBe('complete');
    expect(recovered.clinical.errors).toEqual([]);
    expect(recovered.record.beds.H1C1.devices).toEqual(['VVP#1']);
    expect(recovered.record.beds.H1C1.deviceInstanceHistory).toEqual([
      expect.objectContaining({
        type: 'VVP#1',
        status: 'Active',
        installationDate: CURRENT_CLINICAL_DAY,
        location: 'Antebrazo derecho',
        clinicalEpisodeId: admission.encounterId,
      }),
    ]);
    expect(recovered.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
  });

  it('retains a confirmed VVP when forms fail and adds vital signs on clinical retry', async () => {
    const admission = syntheticEncounter('admission');
    const census = captureFor(CURRENT_CLINICAL_DAY, [admission]);
    const devicesByEpisode = {
      [admission.encounterId]: [
        {
          name: 'Vía venosa periférica',
          location: 'Antebrazo izquierdo',
          installationDatetime: `${CURRENT_CLINICAL_DAY}T10:20:00-06:00`,
        },
      ],
    };
    const failed = await replay(emptyRecordFor(CURRENT_CLINICAL_DAY), census, {
      devicesByEpisode,
      formsErrorByEpisode: { [admission.encounterId]: 'Formularios no disponibles' },
    });

    expect(failed.terminalEvent.status).toBe('partial');
    expect(failed.clinical.errors.map(error => error.source)).toContain('vitals');
    expect(failed.record.beds.H1C1.devices).toEqual(['VVP#1']);
    expect(failed.record.beds.H1C1.deviceInstanceHistory).toHaveLength(1);
    expect(failed.record.beds.H1C1.vitalSigns).toBeUndefined();

    const recovered = await replay(failed.record, census, {
      devicesByEpisode,
      formsByEpisode: {
        [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1001)],
      },
    });

    expect(recovered.terminalEvent.status).toBe('complete');
    expect(recovered.record.beds.H1C1.devices).toEqual(['VVP#1']);
    expect(recovered.record.beds.H1C1.deviceInstanceHistory).toHaveLength(1);
    expect(recovered.record.beds.H1C1.vitalSigns).toMatchObject({ heartRate: 76, spo2: 98 });
    expect(recovered.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
  });

  it('enriches a new admission with vitals and Braden in its first synchronization', async () => {
    const admission = syntheticEncounter('admission');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      {
        historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(CURRENT_CLINICAL_DAY)] },
        formsByEpisode: { [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1001)] },
      }
    );

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.clinical).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(result.terminalEvent).toMatchObject({
      status: 'complete',
      coverage: { total: 1, completed: 1, errors: 0, sourceErrors: 0 },
    });
    expect(result.presentation).toEqual({
      label: 'Completa',
      detail: null,
      tone: 'success',
      unresolved: false,
    });
    expect(result.recovery).toBeNull();
    expect(result.record.rayenSync).toMatchObject({
      runId: result.terminalEvent.id,
      status: 'complete',
    });
    expect(result.record.beds.H1C1).toMatchObject({
      clinicalEpisodeId: admission.encounterId,
      vitalSigns: { systolic: 118, diastolic: 72, heartRate: 76, spo2: 98 },
      evaluationScores: { braden: { total: 17 } },
    });
  });

  it.each([
    ['D-1', '2026-08-14', 1],
    ['D-7', '2026-08-08', 7],
  ])(
    'runs the complete %s flow against its frozen historical record',
    async (_label, date, days) => {
      const admission = syntheticEncounter('admission', {
        admissionDatetime: `${date}T10:00:00-06:00`,
      });
      const result = await replay(emptyRecordFor(date), captureFor(date, [admission]), {
        historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(date)] },
        formsByEpisode: { [admission.encounterId]: [vitalSignsForm(date, 1100 + days)] },
      });

      expect(result.target).toMatchObject({ kind: 'historical', lookbackDays: days });
      expect(result.record.date).toBe(date);
      expect(result.clinical).toMatchObject({ patched: 1, errors: [] });
      expect(result.record.beds.H1C1).toMatchObject({
        clinicalEpisodeId: admission.encounterId,
        vitalSigns: { systolic: 118, diastolic: 72, heartRate: 76, spo2: 98 },
        evaluationScores: { braden: { total: 17 } },
      });
    }
  );

  it('persists a typed clinical failure and offers only the safe clinical retry', async () => {
    const admission = syntheticEncounter('admission');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      {
        formsErrorByEpisode: {
          [admission.encounterId]: 'Detalle externo deliberadamente cambiante.',
        },
      }
    );

    expect(result.terminalEvent).toMatchObject({
      status: 'partial',
      structuralReview: { structureConfirmed: true, isolatedConflicts: 0 },
      coverage: {
        total: 1,
        completed: 0,
        errors: 1,
        sourceErrors: 2,
        issues: [
          { bedId: 'H1C1', source: 'scales', reason: 'source_unavailable' },
          { bedId: 'H1C1', source: 'vitals', reason: 'source_unavailable' },
        ],
      },
    });
    expect(result.presentation).toMatchObject({
      label: 'Parcial',
      detail: '1 paciente no se pudo completar · Fuente clínica incompleta',
      tone: 'warning',
      unresolved: true,
    });
    expect(result.recovery).toMatchObject({
      title: 'Información clínica pendiente',
      action: 'retry_clinical',
      actionLabel: 'Reintentar información clínica',
    });
    expect(result.record.rayenSync).toMatchObject({
      runId: result.terminalEvent.id,
      status: 'partial',
    });
    expect(
      result.record.rayenSyncHistory?.filter(event => event.id === result.terminalEvent.id)
    ).toHaveLength(1);
    expect(JSON.stringify(result.terminalEvent)).not.toContain(
      'Detalle externo deliberadamente cambiante.'
    );
  });

  it('keeps an isolated structural conflict visible after the clinical stage settles', async () => {
    const occupant = syntheticEncounter('departing');
    const incoming = syntheticEncounter('incoming');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY, {
        beds: { H1C1: patientAt(occupant, 'H1C1') },
      }),
      captureFor(CURRENT_CLINICAL_DAY, [incoming])
    );

    expect(result.terminalEvent).toMatchObject({
      status: 'partial',
      coverage: { total: 0, completed: 0, errors: 0, sourceErrors: 0 },
      structuralReview: {
        structureConfirmed: true,
        isolatedConflicts: 1,
        issues: [{ bedId: 'H1C1', reason: 'occupied-local-bed' }],
      },
    });
    expect(result.presentation).toMatchObject({
      label: 'Parcial',
      detail: '1 cambio del censo no se aplicó',
      tone: 'warning',
      unresolved: true,
    });
    expect(result.recovery).toMatchObject({
      title: 'Censo pendiente de revisión',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
    });
  });

  it('admits a new clinicalEpisodeId when the same synthetic RUN has an older discharge', async () => {
    const readmission = syntheticEncounter('readmission', {
      encounterId: 'episode-readmission-new',
    });
    const current = emptyRecordFor(CURRENT_CLINICAL_DAY, {
      discharges: [
        {
          id: 'synthetic-old-discharge',
          movementDate: '2026-08-14',
          admissionDate: '2026-08-13',
          bedName: 'H1C1',
          bedId: 'H1C1',
          bedType: 'Cama',
          patientName: 'Caso readmission',
          rut: readmission.run,
          diagnosis: 'Diagnóstico sintético',
          time: '16:00',
          status: 'Vivo',
          clinicalEpisodeId: 'episode-readmission-old',
        },
      ],
    });
    const result = await replay(current, captureFor(CURRENT_CLINICAL_DAY, [readmission]));

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.record.beds.H1C1.clinicalEpisodeId).toBe('episode-readmission-new');
  });

  it('records a verified brief hospitalization that was already discharged before capture', async () => {
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [], [verifiedShortStayDischarge()])
    );

    expect(result.record.discharges).toEqual([
      expect.objectContaining({
        clinicalEpisodeId: 'episode-shortStay',
        status: 'Fallecido',
        admissionDate: CURRENT_CLINICAL_DAY,
        time: '16:30',
      }),
    ]);
    expect(Object.keys(result.record.beds).length).toBeGreaterThan(0);
    expect(Object.values(result.record.beds).every(patient => !patient.rut)).toBe(true);
  });

  it('keeps mother and newborn as two clinical episodes in one principal bed', async () => {
    const mother = syntheticEncounter('mother', { room: 'H5', bed: 'C1' });
    const newborn = syntheticEncounter('newborn', {
      birthDate: CURRENT_CLINICAL_DAY,
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [mother, newborn])
    );

    expect(result.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: mother.encounterId,
      clinicalCrib: { clinicalEpisodeId: newborn.encounterId, bedMode: 'Cuna' },
    });
    expect(result.clinical.total).toBe(2);
  });

  it('chains a move after discharge and safely reuses both released beds', async () => {
    const departing = syntheticEncounter('departing', { room: 'H2', bed: 'C2' });
    const moving = syntheticEncounter('moving', { room: 'H2', bed: 'C2' });
    const incoming = syntheticEncounter('incoming', { room: 'H1', bed: 'C1' });
    const current = emptyRecordFor(CURRENT_CLINICAL_DAY, {
      beds: {
        H1C1: patientAt({ ...moving, room: 'H1', bed: 'C1' }, 'H1C1'),
        H2C2: patientAt(departing, 'H2C2'),
      },
    });
    const egreso: EgresoReportRow = {
      ...verifiedShortStayDischarge(),
      run: departing.run,
      encounterId: departing.encounterId,
      patientName: 'Caso departing',
      bedLabel: 'H2C2',
      destino: 'Domicilio',
    };
    const result = await replay(
      current,
      captureFor(
        CURRENT_CLINICAL_DAY,
        [incoming, moving, { ...departing, hasMedicalDischarge: true }],
        [egreso]
      )
    );

    expect(result.structural.skipped).toEqual([]);
    expect(result.structural.applied.discharges).toBe(1);
    expect(result.record.beds.H1C1.clinicalEpisodeId).toBe(incoming.encounterId);
    expect(result.record.beds.H2C2.clinicalEpisodeId).toBe(moving.encounterId);
    expect(result.record.discharges).toContainEqual(
      expect.objectContaining({
        clinicalEpisodeId: departing.encounterId,
        status: 'Vivo',
      })
    );
  });

  it('reaches a fixed point: replaying identical evidence creates no duplicates or clinical writes', async () => {
    const admission = syntheticEncounter('admission');
    const evidence = {
      historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(CURRENT_CLINICAL_DAY)] },
      formsByEpisode: { [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1002)] },
    };
    const first = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      evidence
    );
    const second = await replay(
      first.record,
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      evidence
    );

    expect(second.structural.applied).toEqual({
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
    });
    expect(second.clinical).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(second.clinicalWrites).toBe(0);
    expect(second.terminalEvent.status).toBe('complete');
    expect(second.presentation.unresolved).toBe(false);
    expect(second.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    expect(second.record.beds.H1C1.evaluationScores?.history).toHaveLength(1);
  });
});
