import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';
import {
  buildRayenSyncCoverage,
  buildAppliedRayenSyncEvent,
  completeRayenSyncEvent,
} from '@/features/rayen-import/domain/rayenSyncHistory';

const newborn: DischargeData = {
  id: 'synthetic-rn',
  bedId: 'H5C1',
  bedName: 'H5C1',
  bedType: 'Básica',
  patientName: 'Bebe Sintetico Perez',
  rut: '',
  clinicalEpisodeId: '700002',
  admissionDate: '2026-11-08',
  movementDate: '2026-11-10',
  time: '14:10',
  diagnosis: '',
  status: 'Vivo',
  isNested: true,
};
const mother: DischargeData = {
  ...newborn,
  id: 'synthetic-mother',
  patientName: 'Madre Sintetica Perez',
  rut: '11.111.111-1',
  clinicalEpisodeId: '700001',
  admissionDate: '2026-11-07',
  isNested: false,
};
const row: EgresoReportRow = {
  run: '7654321',
  servicio: '',
  edad: '',
  motivo: '',
  patientName: newborn.patientName,
  fechaEgreso: '10-11-2026  14:10',
  bedLabel: 'Cuna H5C1',
  destino: 'Domicilio',
  exactEpisodeVerification: 'unverified',
};

async function replay(discharges: DischargeData[], rows = [row]) {
  const record = {
    date: '2026-11-10',
    beds: {},
    discharges,
    transfers: [],
    cma: [],
    activeExtraBeds: [],
  } as unknown as DailyRecord;
  const diff = await replanRayenStructure(
    record,
    {
      sourceSnapshot: {
        capturedAt: '2026-11-11T10:00:00-05:00',
        facilityId: 1342,
        isComplete: true,
        encounters: [],
      },
      egresoRows: rows,
      reportDate: record.date,
      isHistoricalDay: true,
      invalidEpisodeIds: new Set<string>(),
    },
    {
      dailyRecord: {
        getAuthoritativeForDate: async () => null,
      } as unknown as DailyRecordRepositoryPort,
      isAdmin: false,
      fetchPatientFlowReport: vi.fn(),
      fetchStatisticalDischarge: vi.fn(),
      lookupEgresos: async () => [],
    }
  );
  const structuralReview = {
    structureConfirmed: true,
    historicalCorrectionsPending: false,
    historicalCorrectionsRequireFreshCapture: false,
    snapshotComplete: diff.snapshotComplete === true,
    isolatedConflicts: diff.conflicts.length,
    issues: diff.conflicts.map(c => ({
      bedId: c.bedId,
      reason: c.code ?? ('unclassified' as const),
    })),
  };
  const event = completeRayenSyncEvent(
    buildAppliedRayenSyncEvent(
      {
        id: 'synthetic-run',
        by: 'test',
        sourceDate: record.date,
        startedAt: '2026-11-11T13:53:00Z',
      },
      diff,
      '2026-11-11T13:54:00Z'
    ),
    buildRayenSyncCoverage(0, [], '2026-11-11T13:54:00Z'),
    undefined,
    undefined,
    structuralReview
  );
  return { diff, event };
}

describe('historical recorded newborn discharge', () => {
  it('does not repeatedly require reconstruction of an already recorded newborn', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { diff, event } = await replay([mother, newborn]);
      expect(event.structuralReview?.snapshotComplete).toBe(false);
      expect(diff.conflicts).toEqual([]);
      expect(event.status).toBe('complete');
      expect(diff.discharges).toEqual([]);
    }
  });
  it('does not let a newborn discharge cover the mother', async () => {
    const { event } = await replay(
      [newborn],
      [{ ...row, run: mother.rut, patientName: mother.patientName, bedLabel: 'H5C1' }]
    );
    expect(event.status).toBe('partial');
  });
  it('keeps indistinguishable twin folios in review', async () => {
    const { event } = await replay([newborn], [row, { ...row, run: '7654322' }]);
    expect(event.status).toBe('partial');
  });
  it.each([
    ['not recorded', [mother]],
    ['wrong time', [mother, { ...newborn, time: '14:11' }]],
    ['wrong bed', [mother, { ...newborn, bedId: 'H5C2' }]],
    ['wrong date', [mother, { ...newborn, movementDate: '2026-11-09' }]],
    ['different twin', [mother, { ...newborn, patientName: 'Otro Bebe Sintetico Perez' }]],
    ['principal is not newborn', [{ ...newborn, isNested: false }]],
    ['deleted', [mother, { ...newborn, deletedAt: '2026-11-10T20:00:00Z' }]],
    ['ambiguous twins', [mother, newborn, { ...newborn, id: 'twin', clinicalEpisodeId: '700003' }]],
  ] as const)('preserves review: %s', async (_label, discharges) => {
    const { diff, event } = await replay([...discharges]);
    expect(diff.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'historical-reconstruction' })])
    );
    expect(event.status).toBe('partial');
    expect(diff.discharges).toEqual([]);
  });
});
