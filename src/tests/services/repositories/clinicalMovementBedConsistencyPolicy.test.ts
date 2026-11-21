// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory, asStoredDailyRecordShape } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { PatientStatus } from '@/types/domain/patientClassification';

const makeRecord = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-02-18',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) satisfies DailyRecord;

describe('clinical movement-bed consistency policy', () => {
  it('does not resurrect a discharged patient from stale local bed data during automatic merge', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: '',
        rut: '',
        pathology: '',
        admissionDate: '',
        status: 'EMPTY',
      }),
    };
    remote.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        movementDate: '2026-02-18',
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        pathology: 'Diagnostico cache antiguo',
        admissionDate: '2026-02-10',
        status: 'Vivo',
      }),
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('');
    expect(resolved.beds.R1.rut).toBe('');
    expect(resolved.beds.R1.status).not.toBe('Vivo');
  });

  it('keeps a different active patient when a prior discharge exists for the same bed', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        movementDate: '2026-02-18',
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Nuevo',
        rut: '44.444.444-4',
        pathology: 'Ingreso posterior',
        admissionDate: '2026-02-18',
        status: PatientStatus.ESTABLE,
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('Paciente Nuevo');
    expect(resolved.beds.R1.rut).toBe('44.444.444-4');
  });

  it('clears residual devices from an already available bed when a confirmed movement exists', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: '',
        rut: '',
        pathology: '',
        admissionDate: '',
        devices: [],
      },
    };
    remote.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        movementDate: '2026-02-18',
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: '',
        rut: '',
        pathology: '',
        admissionDate: '',
        devices: ['VVP#1'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-18' },
        },
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
    });

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('');
    expect(resolved.beds.R1.devices).toEqual([]);
    expect(resolved.beds.R1.deviceDetails).toBeUndefined();
  });

  it('keeps a same-day readmission for the same RUT when the prior discharge belongs to an older admission', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Reingresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        clinicalEpisodeId: 'ep_old_admission',
        status: 'Vivo',
        dischargeType: 'Fuga',
        movementDate: '2026-02-18',
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Reingresado',
        rut: '33.333.333-3',
        pathology: 'Reingreso posterior a fuga',
        admissionDate: '2026-02-18',
        clinicalEpisodeId: 'ep_new_admission',
        status: PatientStatus.ESTABLE,
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('Paciente Reingresado');
    expect(resolved.beds.R1.rut).toBe('33.333.333-3');
    expect(resolved.beds.R1.pathology).toBe('Reingreso posterior a fuga');
    expect(resolved.beds.R1.admissionDate).toBe('2026-02-18');
  });

  it('ignores tombstoned discharges when normalizing bed consistency', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-deleted',
        bedId: 'R1',
        patientName: 'Paciente Reingresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-18',
        status: 'Vivo',
        movementDate: '2026-02-18',
        deletedAt: '2026-02-18T12:00:00.000Z',
      },
    ]);

    const local = makeRecord('2026-02-18T12:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Reingresado',
        rut: '33.333.333-3',
        pathology: 'Reingreso valido',
        admissionDate: '2026-02-18',
        status: PatientStatus.ESTABLE,
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.beds.R1.patientName).toBe('Paciente Reingresado');
    expect(resolved.beds.R1.pathology).toBe('Reingreso valido');
  });

  it('does not resurrect a CMA patient from stale local bed data during automatic merge', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: '',
        rut: '',
        pathology: '',
        admissionDate: '',
        status: 'EMPTY',
      }),
    };
    remote.cma = [
      DataFactory.createMockCMA({
        id: 'cma-1',
        originalBedId: 'R1',
        bedName: 'R1',
        patientName: 'Paciente CMA',
        rut: '55.555.555-5',
        diagnosis: 'Procedimiento CMA',
        specialty: 'Cirugia',
        interventionType: 'Cirugía Mayor Ambulatoria',
      }),
    ];

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: 'Paciente CMA',
        rut: '55.555.555-5',
        pathology: 'Procedimiento CMA',
        admissionDate: '',
        status: 'Vivo',
      }),
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.cma).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('');
    expect(resolved.beds.R1.rut).toBe('');
    expect(resolved.beds.R1.status).not.toBe('Vivo');
  });

  it('does not clear a name-only CMA match when admission evidence is missing', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.cma = [
      DataFactory.createMockCMA({
        id: 'cma-name-only',
        originalBedId: 'R1',
        bedName: 'R1',
        patientName: 'Paciente Sin Rut',
        rut: '',
        diagnosis: 'Procedimiento CMA',
        specialty: 'Cirugia',
        interventionType: 'Cirugía Mayor Ambulatoria',
      }),
    ];

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Sin Rut',
        rut: '',
        pathology: 'Ingreso posterior sin RUT',
        admissionDate: '2026-02-18',
        status: PatientStatus.ESTABLE,
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.cma).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('Paciente Sin Rut');
    expect(resolved.beds.R1.pathology).toBe('Ingreso posterior sin RUT');
  });

  it('keeps a same-RUT readmission when a prior CMA entry belongs to an older admission', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.cma = asStoredDailyRecordShape<DailyRecord['cma']>([
      {
        id: 'cma-old-admission',
        originalBedId: 'R1',
        bedName: 'R1',
        patientName: 'Paciente Reingresado',
        rut: '55.555.555-5',
        diagnosis: 'Procedimiento CMA',
        specialty: 'Cirugia',
        interventionType: 'Cirugía Mayor Ambulatoria',
        clinicalEpisodeId: 'ep_old_cma',
        originalData: {
          admissionDate: '2026-02-10',
        },
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Reingresado',
        rut: '55.555.555-5',
        pathology: 'Nuevo ingreso hospitalizado',
        admissionDate: '2026-02-18',
        clinicalEpisodeId: 'ep_new_hospitalization',
        status: PatientStatus.ESTABLE,
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.cma).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('Paciente Reingresado');
    expect(resolved.beds.R1.pathology).toBe('Nuevo ingreso hospitalizado');
  });

  it('clears a name-only CMA match when original admission date confirms the same episode', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.cma = asStoredDailyRecordShape<DailyRecord['cma']>([
      {
        id: 'cma-name-and-admission',
        originalBedId: 'R1',
        bedName: 'R1',
        patientName: 'Paciente Sin Rut',
        rut: '',
        diagnosis: 'Procedimiento CMA',
        specialty: 'Cirugia',
        interventionType: 'Cirugía Mayor Ambulatoria',
        originalData: {
          admissionDate: '2026-02-10',
        },
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: 'Paciente Sin Rut',
        rut: '',
        pathology: 'Procedimiento CMA',
        admissionDate: '2026-02-10',
        status: 'Vivo',
      }),
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.cma).toHaveLength(1);
    expect(resolved.beds.R1.patientName).toBe('');
    expect(resolved.beds.R1.status).not.toBe('Vivo');
  });

  it('preserves a live clinical crib when clearing residual state from the parent bed', () => {
    const record = makeRecord('2026-02-18T10:00:00.000Z');
    record.discharges = asStoredDailyRecordShape<DailyRecord['discharges']>([
      {
        id: 'discharge-parent',
        bedId: 'R1',
        patientName: 'Madre Egresada',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        movementDate: '2026-02-18',
      },
    ]);

    record.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: '',
        rut: '',
        pathology: 'Residuo de madre egresada',
        admissionDate: '',
        hasCompanionCrib: true,
        clinicalCrib: {
          bedId: 'R1-crib',
          patientName: 'Recien Nacido Activo',
          rut: '55.555.555-5',
          pathology: 'Control neonatal',
          admissionDate: '2026-02-18',
          status: 'Estable',
        },
      }),
    };

    const { record: resolved } = normalizeMovementBedConsistency(record);

    expect(resolved.beds.R1.clinicalCrib?.patientName).toBe('Recien Nacido Activo');
    expect(resolved.beds.R1.hasCompanionCrib).toBe(true);
    expect(resolved.beds.R1.pathology).toBe('');
  });

  it('clears residual delivery and audit fields when a confirmed movement exists', () => {
    const remote = makeRecord('2026-02-18T10:00:00.000Z');
    remote.transfers = asStoredDailyRecordShape<DailyRecord['transfers']>([
      {
        id: 'transfer-parent',
        bedId: 'R1',
        patientName: 'Paciente Trasladado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        receivingCenter: 'Hospital receptor',
        movementDate: '2026-02-18',
      },
    ]);

    const local = makeRecord('2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: asStoredDailyRecordShape<DailyRecord['beds'][string]>({
        bedId: 'R1',
        patientName: '',
        rut: '',
        deliveryRoute: 'Cesarea',
        deliveryDate: '2026-02-18',
        surgicalComplication: 'Sangrado',
        medicalHandoffAudit: [{ id: 'audit-1' }],
      }),
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.deliveryRoute', 'beds.R1.medicalHandoffAudit'],
    });

    expect(resolved.beds.R1.patientName).toBe('');
    expect(resolved.beds.R1.deliveryRoute).toBeUndefined();
    expect(resolved.beds.R1.deliveryDate).toBeUndefined();
    expect(resolved.beds.R1.surgicalComplication).toBe(false);
    expect(resolved.beds.R1.medicalHandoffAudit).toBeUndefined();
  });
});
