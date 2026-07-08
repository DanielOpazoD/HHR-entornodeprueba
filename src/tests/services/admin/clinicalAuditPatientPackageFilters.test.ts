import { describe, expect, it } from 'vitest';

import {
  buildClinicalAuditPatientPackageFilterOptions,
  filterClinicalAuditPatientPackages,
} from '@/services/admin/clinicalAuditPatientPackageFilters';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'user@hospital.cl',
  userDisplayName: 'Usuario Clinico',
  userUid: 'uid-123',
  ipAddress: '10.0.0.1',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H4C1',
  recordDate: '2026-07-01',
  patientIdentifier: '25DF52626',
  details: {
    patientName: 'Paciente Base',
    rut: '25DF52626',
    bedId: 'H4C1',
  },
  ...overrides,
});

const packages = buildClinicalAuditPatientPackages([
  baseLog({
    id: 'discharge',
    action: 'PATIENT_DISCHARGED',
    entityType: 'discharge',
    userDisplayName: 'Enfermera Alta',
    ipAddress: '10.0.0.10',
    details: {
      patientName: 'Bernardo Orrego Llanos',
      rut: '17.274.300-5',
      bedId: 'H2C2',
    },
  }),
  baseLog({
    id: 'transfer',
    action: 'PATIENT_TRANSFERRED',
    timestamp: '2026-07-01T19:48:29.000Z',
    entityType: 'transfer',
    details: {
      patientName: 'Paciente Traslado',
      rut: '11.111.111-1',
      sourceBed: 'H3C1',
      targetBed: 'H3C2',
    },
  }),
  baseLog({
    id: 'cma',
    action: 'PATIENT_MODIFIED',
    timestamp: '2026-07-01T20:10:29.000Z',
    details: {
      patientName: 'Paciente CMA',
      rut: '22.222.222-2',
      bedId: 'H5C1',
      changes: { specialty: { old: 'Medicina', new: 'CMA' } },
    },
  }),
  baseLog({
    id: 'conflict',
    action: 'CONFLICT_AUTO_MERGED',
    timestamp: '2026-07-01T20:30:29.000Z',
    entityType: 'dailyRecord',
    entityId: '2026-07-01',
    details: {
      patientName: 'Paciente Conflicto',
      rut: '33.333.333-3',
      bedId: 'H6C1',
    },
  }),
  baseLog({
    id: 'view',
    action: 'VIEW_PATIENT',
    timestamp: '2026-07-01T20:50:29.000Z',
    details: {
      patientName: 'Paciente Visualizado',
      rut: '44.444.444-4',
      bedId: 'H7C1',
    },
  }),
  baseLog({
    id: 'document',
    action: 'CLINICAL_DOCUMENT_EDITED',
    timestamp: '2026-07-01T21:10:29.000Z',
    entityType: 'clinicalDocument',
    details: {
      patientName: 'Paciente Documento',
      rut: '55.555.555-5',
      bedId: 'H8C1',
    },
  }),
  baseLog({
    id: 'medication',
    action: 'MEDICAL_INDICATION_RECORD_CREATED',
    timestamp: '2026-07-01T21:30:29.000Z',
    entityType: 'medicalIndicationRecord',
    details: {
      patientName: 'Paciente Indicacion',
      rut: '66.666.666-6',
      bedId: 'H9C1',
    },
  }),
]);

describe('clinicalAuditPatientPackageFilters', () => {
  it('builds quick filter counters for operational audit categories', () => {
    const options = buildClinicalAuditPatientPackageFilterOptions(packages);

    expect(options.map(option => [option.id, option.count])).toEqual([
      ['ALL', 7],
      ['CENSUS', 7],
      ['PATIENT', 7],
      ['BED', 7],
      ['DISCHARGE', 1],
      ['TRANSFER', 1],
      ['INTERNAL_MOVEMENT', 0],
      ['CMA', 1],
      ['DOCUMENTS', 1],
      ['DIAGNOSIS', 0],
      ['STATUS', 0],
      ['CONFLICT', 1],
      ['SYNC_BLOCKED', 0],
      ['SYNC_MERGED', 1],
      ['SYNC_ALREADY_APPLIED', 0],
      ['SYNC_QUEUED', 0],
      ['SYNC_REPLAYED', 0],
      ['SYNC_ACCEPTED', 5],
      ['VIEW_ACTIVITY', 1],
      ['SYSTEM', 1],
      ['MEDICATIONS', 1],
    ]);
  });

  it('separates clinical operations from view-only and system-sync packages', () => {
    expect(
      filterClinicalAuditPatientPackages(packages, {
        activeIntent: 'CLINICAL_OPERATIONS',
      } as never).map(auditPackage => auditPackage.patientName)
    ).toEqual([
      'Paciente Indicacion',
      'Paciente Documento',
      'Paciente CMA',
      'Paciente Traslado',
      'Bernardo Orrego Llanos',
    ]);

    expect(
      filterClinicalAuditPatientPackages(packages, {
        activeIntent: 'VIEW_ACTIVITY',
      } as never).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Visualizado']);

    expect(
      filterClinicalAuditPatientPackages(packages, {
        activeIntent: 'SYSTEM_SYNC',
      } as never).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Conflicto']);
  });

  it('searches patient packages by patient, RUT, bed, user, IP and module', () => {
    expect(filterClinicalAuditPatientPackages(packages, { searchTerm: 'Bernardo' })).toHaveLength(
      1
    );
    expect(
      filterClinicalAuditPatientPackages(packages, { searchTerm: '17.274.300-5' })
    ).toHaveLength(1);
    expect(filterClinicalAuditPatientPackages(packages, { searchTerm: 'H5C1' })).toHaveLength(1);
    expect(
      filterClinicalAuditPatientPackages(packages, { searchTerm: 'Enfermera Alta' })
    ).toHaveLength(1);
    expect(filterClinicalAuditPatientPackages(packages, { searchTerm: '10.0.0.10' })).toHaveLength(
      1
    );
    expect(filterClinicalAuditPatientPackages(packages, { searchTerm: 'CMA' })).toHaveLength(1);
  });

  it('filters packages by a selected quick category', () => {
    const [result] = filterClinicalAuditPatientPackages(packages, {
      activeFilter: 'MEDICATIONS',
    });

    expect(result.patientName).toBe('Paciente Indicacion');
  });

  it('filters and searches by clinical sync mutation context', () => {
    const syncPackages = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'blocked',
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Bloqueado',
          rut: '11.111.111-1',
          bedId: 'H3C1',
          mutationId: 'mut-blocked-123',
          clientId: 'pc-a',
          tabId: 'tab-a',
          resolution: 'blocked',
          changedPaths: ['beds.H3C1.pathology'],
        },
      }),
      baseLog({
        id: 'already-applied',
        action: 'CONFLICT_AUTO_MERGED',
        timestamp: '2026-07-01T19:50:29.000Z',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Idempotente',
          rut: '22.222.222-2',
          bedId: 'H3C2',
          mutationId: 'mut-idempotent-456',
          syncStatus: 'already_applied',
          changedPaths: ['beds.H3C2.status'],
        },
      }),
    ]);

    expect(
      filterClinicalAuditPatientPackages(syncPackages, {
        activeFilter: 'SYNC_BLOCKED',
      }).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Bloqueado']);
    expect(
      filterClinicalAuditPatientPackages(syncPackages, {
        activeFilter: 'SYNC_ALREADY_APPLIED',
      }).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Idempotente']);
    expect(
      filterClinicalAuditPatientPackages(syncPackages, {
        searchTerm: 'mut-blocked-123',
      }).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Bloqueado']);
  });

  it('keeps mixed conflict document and medication packages in clinical operations', () => {
    const mixedPackages = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'document-conflict',
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Documento Conflicto',
          rut: '77.777.777-7',
          bedId: 'H10C1',
        },
      }),
      baseLog({
        id: 'document-edit',
        action: 'CLINICAL_DOCUMENT_EDITED',
        timestamp: '2026-07-01T19:37:29.000Z',
        entityType: 'clinicalDocument',
        details: {
          patientName: 'Paciente Documento Conflicto',
          rut: '77.777.777-7',
          bedId: 'H10C1',
        },
      }),
      baseLog({
        id: 'medication-conflict',
        action: 'CONFLICT_AUTO_MERGED',
        timestamp: '2026-07-01T20:36:29.000Z',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Indicacion Conflicto',
          rut: '88.888.888-8',
          bedId: 'H11C1',
        },
      }),
      baseLog({
        id: 'medication-edit',
        action: 'MEDICAL_INDICATION_RECORD_CREATED',
        timestamp: '2026-07-01T20:37:29.000Z',
        entityType: 'medicalIndicationRecord',
        details: {
          patientName: 'Paciente Indicacion Conflicto',
          rut: '88.888.888-8',
          bedId: 'H11C1',
        },
      }),
    ]);

    expect(
      filterClinicalAuditPatientPackages(mixedPackages, {
        activeIntent: 'SYSTEM_SYNC',
      }).map(auditPackage => auditPackage.patientName)
    ).toEqual([]);
    expect(
      filterClinicalAuditPatientPackages(mixedPackages, {
        activeIntent: 'CLINICAL_OPERATIONS',
      }).map(auditPackage => auditPackage.patientName)
    ).toEqual(['Paciente Indicacion Conflicto', 'Paciente Documento Conflicto']);
  });
});
