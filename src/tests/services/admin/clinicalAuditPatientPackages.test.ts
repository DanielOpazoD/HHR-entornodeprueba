import { describe, expect, it } from 'vitest';

import {
  buildClinicalAuditPatientPackages,
  resolveClinicalAuditPackageKey,
} from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'daniel.opazo@hospitalhangaroa.cl',
  userDisplayName: 'Daniel Opazo Damiani',
  userUid: 'uid-123',
  ipAddress: '148.227.67.162',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H4C1',
  recordDate: '2026-07-01',
  patientIdentifier: '25DF52626',
  details: {
    patientName: 'Anastasio Hey Riroroko',
    rut: '25DF52626',
    bedId: 'H4C1',
  },
  ...overrides,
});

describe('clinicalAuditPatientPackages', () => {
  it('groups same-patient status and diagnosis changes in one compact clinical package', () => {
    const logs: AuditLogEntry[] = [
      baseLog({
        id: 'status-1',
        action: 'PATIENT_MODIFIED',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          changes: {
            status: { old: '', new: 'Estable' },
          },
        },
      }),
      baseLog({
        id: 'diagnosis-1',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        timestamp: '2026-07-01T19:36:54.000Z',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          changes: {
            diagnosis: { old: '', new: 'ICC' },
          },
        },
      }),
    ];

    const packages = buildClinicalAuditPatientPackages(logs);

    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      patientName: 'Anastasio Hey Riroroko',
      patientRut: '25DF52626',
      recordDate: '2026-07-01',
      primaryBedLabel: 'H4C1',
      eventCount: 2,
      actions: ['PATIENT_MODIFIED', 'PATIENT_DIAGNOSIS_CHANGED'],
      modules: ['Estado', 'Diagnóstico'],
      flags: {
        diagnosis: true,
        status: true,
      },
    });
    expect(packages[0].changes).toEqual([
      { fieldLabel: 'Estado', oldValue: '', newValue: 'Estable', sourceLogId: 'status-1' },
      { fieldLabel: 'Diagnóstico', oldValue: '', newValue: 'ICC', sourceLogId: 'diagnosis-1' },
    ]);
    expect(packages[0].summary).toContain('2 eventos');
    expect(packages[0].summary).toContain('Estado');
    expect(packages[0].summary).toContain('Diagnóstico');
    expect(packages[0].rawLogs.map(log => log.id)).toEqual(['diagnosis-1', 'status-1']);
  });

  it('does not merge different patients even when user, IP and timestamp are equal', () => {
    const packages = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'patient-a',
        patientIdentifier: '11111111-1',
        details: {
          patientName: 'Paciente Uno',
          rut: '11111111-1',
          bedId: 'H1',
          changes: { diagnosis: { old: '', new: 'Neumonia' } },
        },
      }),
      baseLog({
        id: 'patient-b',
        patientIdentifier: '22222222-2',
        details: {
          patientName: 'Paciente Dos',
          rut: '22222222-2',
          bedId: 'H2',
          changes: { diagnosis: { old: '', new: 'ICC' } },
        },
      }),
    ]);

    expect(packages).toHaveLength(2);
    expect(packages.map(pkg => pkg.patientName).sort()).toEqual(['Paciente Dos', 'Paciente Uno']);
  });

  it('keeps same-patient edits from different users in one package with both actors visible', () => {
    const packages = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'nurse-edit',
        userId: 'enfermera@hospitalhangaroa.cl',
        userDisplayName: 'Enfermera Turno',
        userUid: 'uid-nurse',
        ipAddress: '10.0.0.10',
        details: {
          patientName: 'Pierre-Jean Test',
          rut: '25DF52626',
          bedId: 'H1C1',
          changes: { status: { old: 'Observacion', new: 'Estable' } },
        },
      }),
      baseLog({
        id: 'doctor-edit',
        timestamp: '2026-07-01T19:39:29.000Z',
        userId: 'medico@hospitalhangaroa.cl',
        userDisplayName: 'Medico Turno',
        userUid: 'uid-doctor',
        ipAddress: '10.0.0.11',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        details: {
          patientName: 'Pierre-Jean Test',
          rut: '25DF52626',
          bedId: 'H1C1',
          changes: { diagnosis: { old: '', new: 'Neumonia' } },
        },
      }),
    ]);

    expect(packages).toHaveLength(1);
    expect(packages[0].eventCount).toBe(2);
    expect(packages[0].actors.map(actor => actor.label)).toEqual([
      'Enfermera Turno',
      'Medico Turno',
    ]);
    expect(packages[0].ipAddresses).toEqual(['10.0.0.10', '10.0.0.11']);
  });

  it('does not merge similar patient names when RUT or episode key identify different records', () => {
    const packages = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'ana-a',
        patientIdentifier: '11.111.111-1',
        details: {
          patientName: 'Ana Maria Riro',
          rut: '11.111.111-1',
          episodeKey: 'episode-ana-a',
          bedId: 'H1C1',
          changes: { diagnosis: { old: '', new: 'Asma' } },
        },
      }),
      baseLog({
        id: 'ana-b',
        patientIdentifier: '22.222.222-2',
        details: {
          patientName: 'Ana Maria Riroko',
          rut: '22.222.222-2',
          episodeKey: 'episode-ana-b',
          bedId: 'H1C2',
          changes: { diagnosis: { old: '', new: 'EPOC' } },
        },
      }),
    ]);

    expect(packages).toHaveLength(2);
    expect(packages.map(pkg => pkg.packageKey).sort()).toEqual([
      '2026-07-01|episode:episode-ana-a',
      '2026-07-01|episode:episode-ana-b',
    ]);
  });

  it('keeps useful date, bed and patient context when a log has no RUT', () => {
    const [pkg] = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'no-rut-move',
        patientIdentifier: undefined,
        action: 'PATIENT_BED_CHANGED',
        details: {
          patientName: 'Paciente Sin Rut',
          sourceBed: 'H2C1',
          targetBed: 'H2C2',
          movementKind: 'move',
        },
      }),
    ]);

    expect(pkg).toMatchObject({
      patientName: 'Paciente Sin Rut',
      recordDate: '2026-07-01',
      primaryBedLabel: 'H2C1 -> H2C2',
      patientIdentifier: undefined,
    });
    expect(pkg.summary).toContain('Paciente Sin Rut');
    expect(pkg.summary).toContain('H2C1 -> H2C2');
    expect(pkg.modules).toContain('Movimiento interno');
  });

  it('extracts discharge, transfer, internal movement, CMA and conflict flags without losing raw logs', () => {
    const logs: AuditLogEntry[] = [
      baseLog({
        id: 'discharge-1',
        action: 'PATIENT_DISCHARGED',
        entityType: 'discharge',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          bedId: 'H2C2',
          episodeKey: 'episode-bernardo',
          diagnosis: 'EPOC',
        },
      }),
      baseLog({
        id: 'transfer-1',
        action: 'PATIENT_TRANSFERRED',
        timestamp: '2026-07-01T19:39:00.000Z',
        entityType: 'transfer',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          bedId: 'H2C2',
          episodeKey: 'episode-bernardo',
          destination: 'Hospital de referencia',
        },
      }),
      baseLog({
        id: 'move-1',
        action: 'PATIENT_BED_CHANGED',
        timestamp: '2026-07-01T19:41:00.000Z',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          episodeKey: 'episode-bernardo',
          movementKind: 'move',
          sourceBed: 'H2C2',
          targetBed: 'H3C1',
        },
      }),
      baseLog({
        id: 'cma-1',
        action: 'PATIENT_MODIFIED',
        timestamp: '2026-07-01T19:42:00.000Z',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          episodeKey: 'episode-bernardo',
          changes: {
            specialty: { old: 'Medicina', new: 'CMA' },
          },
        },
      }),
      baseLog({
        id: 'conflict-1',
        action: 'CONFLICT_AUTO_MERGED',
        timestamp: '2026-07-01T19:43:00.000Z',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          episodeKey: 'episode-bernardo',
          changedPaths: ['discharges', 'transfers', 'cma'],
        },
      }),
    ];

    const [pkg] = buildClinicalAuditPatientPackages(logs);

    expect(pkg.eventCount).toBe(5);
    expect(pkg.primaryBedLabel).toBe('H2C2 -> H3C1');
    expect(pkg.flags).toMatchObject({
      discharge: true,
      transfer: true,
      internalMovement: true,
      cma: true,
      conflict: true,
      risk: true,
    });
    expect(pkg.modules).toEqual([
      'Alta',
      'Traslado',
      'Movimiento interno',
      'Especialidad',
      'CMA',
      'Conflicto',
    ]);
    expect(pkg.rawLogs).toHaveLength(5);
  });

  it('uses a stable fallback key when patient identifiers are incomplete', () => {
    const log = baseLog({
      id: 'fallback-1',
      patientIdentifier: undefined,
      entityId: 'H5C1',
      details: {
        patientName: 'Paciente Sin Rut',
        bedId: 'H5C1',
      },
    });

    expect(resolveClinicalAuditPackageKey(log)).toBe(
      '2026-07-01|patient-name:paciente sin rut|bed:H5C1'
    );
    expect(buildClinicalAuditPatientPackages([log])).toHaveLength(1);
  });

  it('builds patient packages for a 2500-event operational window without losing identities', () => {
    const logs = Array.from({ length: 2500 }, (_, index) =>
      baseLog({
        id: `volume-${index}`,
        timestamp: `2026-07-01T${String(8 + Math.floor(index / 180)).padStart(2, '0')}:${String(
          index % 60
        ).padStart(2, '0')}:00.000Z`,
        patientIdentifier: `rut-volume-${index}`,
        entityId: `H${index % 12}C${index % 4}`,
        details: {
          patientName: `Paciente Volumen ${index}`,
          rut: `rut-volume-${index}`,
          bedId: `H${index % 12}C${index % 4}`,
          changes: { status: { old: '', new: 'Estable' } },
        },
      })
    );

    const packages = buildClinicalAuditPatientPackages(logs);

    expect(packages).toHaveLength(2500);
    expect(new Set(packages.map(pkg => pkg.packageKey)).size).toBe(2500);
    expect(packages.every(pkg => pkg.eventCount === 1)).toBe(true);
    expect(packages.every(pkg => pkg.modules.includes('Estado'))).toBe(true);
  });
});
