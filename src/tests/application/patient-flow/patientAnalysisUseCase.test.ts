import { describe, expect, it, vi } from 'vitest';
import {
  executeAnalyzePatients,
  executeMigratePatients,
  executeResolvePatientConflict,
} from '@/application/patient-flow/patientAnalysisUseCase';
import type { MasterPatient } from '@/types/domain/patientMaster';

describe('patientAnalysisUseCase', () => {
  it('builds analysis from repository records', async () => {
    const repository = {
      getAvailableDates: vi.fn().mockResolvedValue(['2026-03-05']),
      getForDate: vi.fn().mockResolvedValue({
        date: '2026-03-05',
        beds: {
          R1: {
            rut: '11.111.111-1',
            patientName: 'John Doe',
            admissionDate: '2026-03-05',
          },
        },
        discharges: [],
        transfers: [],
      }),
      updatePartial: vi.fn(),
    };

    const outcome = await executeAnalyzePatients({ dailyRecordRepository: repository });
    expect(outcome.status).toBe('success');
    expect(outcome.data?.uniquePatients).toBe(1);
  });

  it('detects name conflicts and closes missing census episodes automatically', async () => {
    const records = new Map([
      [
        '2026-03-05',
        {
          date: '2026-03-05',
          beds: {
            R1: {
              rut: '11.111.111-1',
              patientName: 'John Doe',
              admissionDate: '2026-03-05',
              pathology: 'Neumonía',
            },
          },
          discharges: [],
          transfers: [],
        },
      ],
      [
        '2026-03-06',
        {
          date: '2026-03-06',
          beds: {
            R1: {
              rut: '11.111.111-1',
              patientName: 'Jon Doe',
              admissionDate: '2026-03-05',
              pathology: 'Neumonía',
            },
          },
          discharges: [],
          transfers: [],
        },
      ],
      [
        '2026-03-07',
        {
          date: '2026-03-07',
          beds: {},
          discharges: [],
          transfers: [],
        },
      ],
    ]);
    const repository = {
      getAvailableDates: vi.fn().mockResolvedValue(['2026-03-05', '2026-03-06', '2026-03-07']),
      getForDate: vi.fn().mockImplementation(async (date: string) => records.get(date) ?? null),
      updatePartial: vi.fn(),
    };

    const outcome = await executeAnalyzePatients({ dailyRecordRepository: repository });

    expect(outcome.status).toBe('success');
    expect(outcome.data?.conflicts).toEqual([
      expect.objectContaining({
        rut: '11.111.111-1',
        options: ['John Doe', 'Jon Doe'],
        records: ['2026-03-06'],
        bedMap: { '2026-03-06': 'R1' },
      }),
    ]);
    expect(outcome.data?.validPatients[0]).toEqual(
      expect.objectContaining({
        lastAdmission: '2026-03-05',
        lastDischarge: '2026-03-06',
      })
    );
    expect(outcome.data?.validPatients[0].hospitalizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'Ingreso', date: '2026-03-05' }),
        expect.objectContaining({ type: 'Egreso', date: '2026-03-06' }),
      ])
    );
  });

  it('resolves a conflict and optionally harmonizes history', async () => {
    const repository = {
      getAvailableDates: vi.fn(),
      getForDate: vi.fn(),
      updatePartial: vi.fn().mockResolvedValue(undefined),
    };
    const analysis = {
      totalRecords: 1,
      uniquePatients: 1,
      validPatients: [
        {
          rut: '11.111.111-1',
          fullName: 'Wrong Name',
          hospitalizations: [],
          vitalStatus: 'Vivo',
          createdAt: 1,
          updatedAt: 1,
        },
      ] as MasterPatient[],
      conflicts: [
        {
          rut: '11.111.111-1',
          description: 'Diferencia',
          options: ['Wrong Name', 'Correct Name'],
          records: ['2026-03-05'],
          bedMap: { '2026-03-05': 'R1' },
        },
      ],
    };

    const outcome = await executeResolvePatientConflict({
      analysis,
      rut: '11.111.111-1',
      correctName: 'Correct Name',
      harmonizeHistory: true,
      dailyRecordRepository: repository,
      auditPort: { writeEvent: vi.fn().mockResolvedValue(undefined) },
      currentUserEmail: 'test@test.com',
    });

    expect(outcome.status).toBe('success');
    expect(repository.updatePartial).toHaveBeenCalled();
    expect(outcome.data?.conflicts).toHaveLength(0);
  });

  it('harmonizes every day even when one audit write is refused', async () => {
    const repository = {
      getAvailableDates: vi.fn(),
      getForDate: vi.fn(),
      updatePartial: vi.fn().mockResolvedValue(undefined),
    };
    const days = ['2026-03-05', '2026-03-06', '2026-03-07'];
    const writeEvent = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('No se pudo guardar el evento de auditoría.'))
      .mockResolvedValueOnce(undefined);

    const outcome = await executeResolvePatientConflict({
      analysis: {
        totalRecords: 3,
        uniquePatients: 1,
        validPatients: [],
        conflicts: [
          {
            rut: '11.111.111-1',
            description: 'Diferencia',
            options: ['Wrong Name', 'Correct Name'],
            records: days,
            bedMap: Object.fromEntries(days.map(day => [day, 'R1'])),
          },
        ],
      },
      rut: '11.111.111-1',
      correctName: 'Correct Name',
      harmonizeHistory: true,
      dailyRecordRepository: repository,
      auditPort: { writeEvent },
      currentUserEmail: 'test@test.com',
    });

    expect(outcome.status).toBe('success');
    expect(writeEvent).toHaveBeenCalledTimes(3);
    expect(repository.updatePartial.mock.calls.map(([day]) => day)).toEqual(days);
  });

  it('migrates valid patients through repository port', async () => {
    const outcome = await executeMigratePatients({
      analysis: {
        totalRecords: 1,
        uniquePatients: 1,
        validPatients: [
          {
            rut: '11.111.111-1',
            fullName: 'John Doe',
            hospitalizations: [],
            vitalStatus: 'Vivo',
            createdAt: 1,
            updatedAt: 1,
          },
        ] as MasterPatient[],
        conflicts: [],
      },
      patientMasterRepository: {
        bulkUpsertPatients: vi.fn().mockResolvedValue({ successes: 1, errors: 0 }),
      },
    });

    expect(outcome.status).toBe('success');
    expect(outcome.data).toEqual({ successes: 1, errors: 0 });
  });
});
