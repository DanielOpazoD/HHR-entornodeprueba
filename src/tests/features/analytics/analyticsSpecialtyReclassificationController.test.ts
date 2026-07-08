import { describe, expect, it } from 'vitest';
import { Specialty } from '@/types/domain/patientClassification';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  applySpecialtyReclassificationChange,
  buildAnalyticsMovementReclassificationRows,
} from '@/features/analytics/controllers/analyticsSpecialtyReclassificationController';

const buildRecord = (): DailyRecord =>
  ({
    date: '2026-03-05',
    beds: {},
    discharges: [
      {
        id: 'd-1',
        patientName: 'Alta Demo',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico alta',
        specialty: 'Oftalmología',
        status: 'Vivo',
      },
    ],
    transfers: [
      {
        id: 't-1',
        patientName: 'Traslado Demo',
        rut: '22.222.222-2',
        diagnosis: 'Diagnóstico traslado',
        specialty: 'Broncopulmonar',
        receivingCenter: 'Hospital X',
      },
    ],
    cma: [
      {
        id: 'cma-1',
        patientName: 'CMA Demo',
        rut: '33.333.333-3',
        diagnosis: 'Diagnóstico CMA',
        specialty: 'Dermatología',
        interventionType: 'Cirugía Mayor Ambulatoria',
      },
    ],
  }) as DailyRecord;

describe('analyticsSpecialtyReclassificationController', () => {
  it('builds auditable movement rows for discharges, transfers and CMA', () => {
    const rows = buildAnalyticsMovementReclassificationRows(
      [buildRecord()],
      [
        {
          date: '2026-03-05',
          movementKind: 'cma',
          movementId: 'cma-1',
          specialty: Specialty.CIRUGIA,
        },
      ]
    );

    expect(rows).toEqual([
      expect.objectContaining({
        key: '2026-03-05:discharge:d-1',
        movementKind: 'discharge',
        patientName: 'Alta Demo',
        originalSpecialty: 'Oftalmología',
        reportingSpecialty: 'Oftalmología',
        reportingSpecialtySource: 'original',
      }),
      expect.objectContaining({
        key: '2026-03-05:transfer:t-1',
        movementKind: 'transfer',
        patientName: 'Traslado Demo',
        originalSpecialty: 'Broncopulmonar',
      }),
      expect.objectContaining({
        key: '2026-03-05:cma:cma-1',
        movementKind: 'cma',
        patientName: 'CMA Demo',
        originalSpecialty: 'Dermatología',
        reportingSpecialty: Specialty.CIRUGIA,
        reportingSpecialtySource: 'manual',
      }),
    ]);
  });

  it('uses legacy movement snapshots when direct discharge or transfer specialty is missing', () => {
    const legacyRecord = {
      ...buildRecord(),
      discharges: [
        {
          id: 'legacy-discharge',
          patientName: 'Alta Legacy',
          rut: '44.444.444-4',
          diagnosis: '',
          specialty: undefined,
          status: 'Vivo',
          originalData: {
            specialty: Specialty.MEDICINA,
            pathology: 'Diagnóstico histórico alta',
          },
        },
      ],
      transfers: [
        {
          id: 'legacy-transfer',
          patientName: 'Traslado Legacy',
          rut: '55.555.555-5',
          diagnosis: '',
          specialty: undefined,
          receivingCenter: 'Hospital Y',
          evacuationMethod: 'Terrestre',
          originalData: {
            specialty: Specialty.CIRUGIA,
            pathology: 'Diagnóstico histórico traslado',
          },
        },
      ],
      cma: [],
    } as unknown as DailyRecord;

    const rows = buildAnalyticsMovementReclassificationRows([legacyRecord], []);

    expect(rows).toEqual([
      expect.objectContaining({
        key: '2026-03-05:discharge:legacy-discharge',
        originalSpecialty: Specialty.MEDICINA,
        diagnosis: 'Diagnóstico histórico alta',
      }),
      expect.objectContaining({
        key: '2026-03-05:transfer:legacy-transfer',
        originalSpecialty: Specialty.CIRUGIA,
        diagnosis: 'Diagnóstico histórico traslado',
      }),
    ]);
  });

  it('adds, replaces and removes a statistical reclassification without touching clinical source fields', () => {
    const row = buildAnalyticsMovementReclassificationRows([buildRecord()], [])[0];

    const added = applySpecialtyReclassificationChange(
      [],
      row,
      Specialty.MEDICINA,
      '2026-03-05T12:00:00.000Z'
    );
    expect(added).toEqual([
      {
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        specialty: Specialty.MEDICINA,
        updatedAt: '2026-03-05T12:00:00.000Z',
      },
    ]);

    const replaced = applySpecialtyReclassificationChange(
      added,
      row,
      Specialty.TRAUMATOLOGIA,
      '2026-03-05T12:05:00.000Z'
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      specialty: Specialty.TRAUMATOLOGIA,
      updatedAt: '2026-03-05T12:05:00.000Z',
    });

    const removed = applySpecialtyReclassificationChange(
      replaced,
      row,
      '',
      '2026-03-05T12:10:00.000Z'
    );
    expect(removed).toEqual([]);
  });
});
