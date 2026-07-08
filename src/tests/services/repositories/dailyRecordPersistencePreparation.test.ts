import { describe, expect, it } from 'vitest';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (): DailyRecord =>
  ({
    date: '2026-02-18',
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        pathology: 'Diagnostico cache antiguo',
        admissionDate: '2026-02-10',
        status: 'Estable',
        bedMode: 'Cama',
        hasCompanionCrib: false,
      },
    },
    discharges: [
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        status: 'Vivo',
        movementDate: '2026-02-18',
      },
    ],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-02-18T10:05:00.000Z',
  }) as unknown as DailyRecord;

describe('prepareDailyRecordForPersistence', () => {
  it('repairs stale active bed data when a matching discharge already exists', () => {
    const prepared = prepareDailyRecordForPersistence(makeRecord(), '2026-02-18');

    expect(prepared.discharges).toHaveLength(1);
    expect(prepared.beds.R1.patientName).toBe('');
    expect(prepared.beds.R1.rut).toBe('');
    expect(prepared.beds.R1.status).not.toBe('Estable');
  });

  it('backfills clinicalEpisodeId for active patients before persistence', () => {
    const record = makeRecord();
    record.discharges = [];

    const prepared = prepareDailyRecordForPersistence(record, '2026-02-18');

    expect(prepared.beds.R1.clinicalEpisodeId).toMatch(/^legacy_ep_/);
  });
});
