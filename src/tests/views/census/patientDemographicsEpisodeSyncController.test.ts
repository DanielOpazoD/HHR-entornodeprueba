// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  harmonizeEpisodeDemographicsHistory,
  harmonizeEpisodeDemographicsHistorySafely,
} from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientDemographicsEpisodeSyncController', () => {
  it('propagates demographic changes to previous episode days matched by rut', async () => {
    const sourcePatient = DataFactory.createMockPatient('R2', {
      patientName: 'Nombre Antiguo',
      firstSeenDate: '2026-04-09',
      admissionDate: '2026-04-09',
      rut: '12.345.678-9',
    });
    const getAvailableDates = vi.fn().mockResolvedValue(['2026-04-09', '2026-04-10', '2026-04-11']);
    const getForDate = vi
      .fn()
      .mockResolvedValueOnce(
        DataFactory.createMockDailyRecord('2026-04-09', {
          beds: {
            R5: DataFactory.createMockPatient('R5', {
              patientName: 'Nombre Antiguo',
              firstSeenDate: '2026-04-09',
              admissionDate: '2026-04-09',
              rut: '12.345.678-9',
              age: '44',
            }),
          },
        })
      )
      .mockResolvedValueOnce(
        DataFactory.createMockDailyRecord('2026-04-10', {
          beds: {
            R3: DataFactory.createMockPatient('R3', {
              patientName: 'Nombre Antiguo',
              firstSeenDate: '2026-04-09',
              admissionDate: '2026-04-09',
              rut: '12.345.678-9',
              age: '44',
            }),
          },
        })
      );
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-04-11',
      sourcePatient,
      updatedFields: {
        patientName: 'Nombre Corregido',
        age: '45',
      },
      dailyRecordReadRepository: { getAvailableDates, getForDate },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(updatePartial).toHaveBeenCalledTimes(2);
    expect(updatePartial).toHaveBeenNthCalledWith(1, '2026-04-09', {
      'beds.R5.patientName': 'Nombre Corregido',
      'beds.R5.age': '45',
    });
    expect(updatePartial).toHaveBeenNthCalledWith(2, '2026-04-10', {
      'beds.R3.patientName': 'Nombre Corregido',
      'beds.R3.age': '45',
    });
  });

  it('falls back to patientName matching when rut is missing', async () => {
    const sourcePatient = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Sin Rut',
      rut: '',
      firstSeenDate: '2026-04-09',
      admissionDate: '2026-04-09',
    });
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-04-10',
      sourcePatient,
      updatedFields: {
        patientName: 'Paciente Corregido',
      },
      dailyRecordReadRepository: {
        getAvailableDates: vi.fn().mockResolvedValue(['2026-04-09', '2026-04-10']),
        getForDate: vi.fn().mockResolvedValue(
          DataFactory.createMockDailyRecord('2026-04-09', {
            beds: {
              R1: DataFactory.createMockPatient('R1', {
                patientName: 'Paciente Sin Rut',
                rut: '',
                firstSeenDate: '2026-04-09',
              }),
            },
          })
        ),
      },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(updatePartial).toHaveBeenCalledWith('2026-04-09', {
      'beds.R1.patientName': 'Paciente Corregido',
    });
  });

  it('updates clinical crib history when the edited patient belongs to the crib', async () => {
    const sourcePatient = DataFactory.createMockPatient('C1', {
      patientName: 'RN Antiguo',
      rut: '9.876.543-2',
      firstSeenDate: '2026-04-09',
      admissionDate: '2026-04-09',
    });
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-04-10',
      sourcePatient,
      updatedFields: {
        patientName: 'RN Corregido',
      },
      isClinicalCribPatient: true,
      dailyRecordReadRepository: {
        getAvailableDates: vi.fn().mockResolvedValue(['2026-04-09', '2026-04-10']),
        getForDate: vi.fn().mockResolvedValue(
          DataFactory.createMockDailyRecord('2026-04-09', {
            beds: {
              R1: DataFactory.createMockPatient('R1', {
                patientName: 'Madre',
                rut: '1-9',
                clinicalCrib: DataFactory.createMockPatient('C1', {
                  patientName: 'RN Antiguo',
                  rut: '9.876.543-2',
                  firstSeenDate: '2026-04-09',
                }),
              }),
            },
          })
        ),
      },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(updatePartial).toHaveBeenCalledWith('2026-04-09', {
      'beds.R1.clinicalCrib.patientName': 'RN Corregido',
    });
  });

  it('skips history propagation when there is no firstSeenDate anchor', async () => {
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-04-10',
      sourcePatient: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente',
        firstSeenDate: undefined,
      }),
      updatedFields: { patientName: 'Corregido' },
      dailyRecordReadRepository: {
        getAvailableDates: vi.fn(),
        getForDate: vi.fn(),
      },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(updatePartial).not.toHaveBeenCalled();
  });

  it('wraps propagation failures without throwing to the UI', async () => {
    const logger = {
      warn: vi.fn(),
    } as unknown as Parameters<typeof harmonizeEpisodeDemographicsHistorySafely>[0]['logger'];

    expect(() =>
      harmonizeEpisodeDemographicsHistorySafely({
        currentDate: '2026-04-10',
        sourcePatient: DataFactory.createMockPatient('R1', {
          firstSeenDate: '2026-04-09',
        }),
        updatedFields: { patientName: 'Corregido' },
        dailyRecordReadRepository: {
          getAvailableDates: vi.fn().mockRejectedValue(new Error('boom')),
          getForDate: vi.fn(),
        },
        dailyRecordWriteRepository: {
          updatePartial: vi.fn(),
        },
        logger,
      })
    ).not.toThrow();
  });
});
