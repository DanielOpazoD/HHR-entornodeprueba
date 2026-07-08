import { describe, expect, it, vi } from 'vitest';

import {
  buildAuditPatientPackagePipeline,
  buildAuditPatientPackagePipelineBase,
  buildIndexedClinicalAuditPatientPackages,
  queryAuditPatientPackagePipeline,
} from '@/hooks/controllers/auditPatientPackagePipelineController';
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

const buildVolumeLogs = (): AuditLogEntry[] => [
  ...Array.from({ length: 60 }, (_, index) =>
    baseLog({
      id: `clinical-${index}`,
      timestamp: `2026-07-01T19:${String(index % 60).padStart(2, '0')}:29.000Z`,
      patientIdentifier: `CL-${index}`,
      details: {
        patientName: `Paciente Clinico ${index}`,
        rut: `CL-${index}`,
        bedId: `H${index}`,
        changes: { diagnosis: { old: '', new: index === 7 ? 'ICC Orrego' : 'Control' } },
      },
    })
  ),
  baseLog({
    id: 'view-only',
    action: 'VIEW_PATIENT',
    timestamp: '2026-07-01T20:10:29.000Z',
    patientIdentifier: 'VIEW-1',
    details: {
      patientName: 'Paciente Visualizado',
      rut: 'VIEW-1',
      bedId: 'HV1',
    },
  }),
  baseLog({
    id: 'conflict-only',
    action: 'CONFLICT_AUTO_MERGED',
    timestamp: '2026-07-01T20:20:29.000Z',
    entityType: 'dailyRecord',
    entityId: '2026-07-01',
    patientIdentifier: 'SYNC-1',
    details: {
      patientName: 'Paciente Sincronizacion',
      rut: 'SYNC-1',
      bedId: 'HS1',
    },
  }),
];

describe('auditPatientPackagePipelineController', () => {
  it('builds patient-centered packages, intent counters, filters and pagination from one pure pipeline', () => {
    const pipeline = buildAuditPatientPackagePipeline({
      sourceLogs: buildVolumeLogs(),
      searchTerm: 'orrego',
      activeFilter: 'DIAGNOSIS',
      activeIntent: 'CLINICAL_OPERATIONS',
      currentPage: 1,
      itemsPerPage: 10,
    });

    expect(pipeline.unfilteredPatientPackages).toHaveLength(62);
    expect(pipeline.patientPackageIntentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'CLINICAL_OPERATIONS', count: 60 }),
        expect.objectContaining({ id: 'VIEW_ACTIVITY', count: 1 }),
        expect.objectContaining({ id: 'SYSTEM_SYNC', count: 1 }),
      ])
    );
    expect(pipeline.patientPackageFilterOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ALL', count: 60 }),
        expect.objectContaining({ id: 'DIAGNOSIS', count: 60 }),
      ])
    );
    expect(pipeline.patientPackages.map(auditPackage => auditPackage.patientName)).toEqual([
      'Paciente Clinico 7',
    ]);
    expect(pipeline.paginatedPatientPackages).toHaveLength(1);
    expect(pipeline.totalPages).toBe(1);
  });

  it('keeps search indexes one-per-package so filtering does not rebuild normalized text repeatedly', () => {
    const basePackages = buildAuditPatientPackagePipeline({
      sourceLogs: buildVolumeLogs().slice(0, 12),
      searchTerm: '',
      activeFilter: 'ALL',
      activeIntent: 'CLINICAL_OPERATIONS',
      currentPage: 1,
      itemsPerPage: 10,
    }).unfilteredPatientPackages;
    const buildSearchIndex = vi.fn(auditPackage => `indexed:${auditPackage.id}`);

    const indexedPackages = buildIndexedClinicalAuditPatientPackages(
      basePackages,
      buildSearchIndex
    );

    expect(indexedPackages).toHaveLength(basePackages.length);
    expect(buildSearchIndex).toHaveBeenCalledTimes(basePackages.length);
    expect(new Set(indexedPackages.map(indexed => indexed.searchIndex)).size).toBe(
      basePackages.length
    );
  });

  it('reuses the source-log package build when only query state changes', () => {
    const base = buildAuditPatientPackagePipelineBase({
      sourceLogs: buildVolumeLogs().slice(0, 12),
    });

    const diagnosisQuery = queryAuditPatientPackagePipeline({
      base,
      searchTerm: 'orrego',
      activeFilter: 'DIAGNOSIS',
      activeIntent: 'CLINICAL_OPERATIONS',
      currentPage: 1,
      itemsPerPage: 10,
    });
    const nextSearchQuery = queryAuditPatientPackagePipeline({
      base,
      searchTerm: 'paciente clinico 8',
      activeFilter: 'ALL',
      activeIntent: 'CLINICAL_OPERATIONS',
      currentPage: 1,
      itemsPerPage: 10,
    });

    expect(base.unfilteredPatientPackages).toHaveLength(12);
    expect(base.indexedPatientPackages).toHaveLength(12);
    expect(diagnosisQuery.unfilteredPatientPackages).toBe(base.unfilteredPatientPackages);
    expect(nextSearchQuery.unfilteredPatientPackages).toBe(base.unfilteredPatientPackages);
    expect(diagnosisQuery.patientPackageIntentOptions).toBe(base.patientPackageIntentOptions);
    expect(nextSearchQuery.patientPackageIntentOptions).toBe(base.patientPackageIntentOptions);
    expect(diagnosisQuery.patientPackages.map(auditPackage => auditPackage.patientName)).toEqual([
      'Paciente Clinico 7',
    ]);
    expect(nextSearchQuery.patientPackages.map(auditPackage => auditPackage.patientName)).toEqual([
      'Paciente Clinico 8',
    ]);
  });
});
