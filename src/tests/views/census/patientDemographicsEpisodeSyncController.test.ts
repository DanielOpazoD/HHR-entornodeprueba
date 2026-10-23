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

  const episodePatient = (firstSeenDate: string) =>
    DataFactory.createMockPatient('R2', {
      patientName: 'Nombre Antiguo',
      firstSeenDate,
      admissionDate: firstSeenDate,
      rut: '12.345.678-9',
    });
  const dayWith = (date: string, firstSeenDate: string) =>
    DataFactory.createMockDailyRecord(date, {
      beds: {
        R4: DataFactory.createMockPatient('R4', {
          patientName: 'Nombre Antiguo',
          firstSeenDate,
          admissionDate: firstSeenDate,
          rut: '12.345.678-9',
        }),
      },
    });

  it('reads only the calendar days of the episode, never the whole census history', async () => {
    const getAvailableDates = vi.fn().mockRejectedValue(new Error('must not list all history'));
    const getForDate = vi.fn(async (date: string) =>
      // A day without a census reads as missing and is simply skipped.
      date === '2026-04-10' ? null : dayWith(date, '2026-04-09')
    );
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-04-12',
      sourcePatient: episodePatient('2026-04-09'),
      updatedFields: { patientName: 'Nombre Corregido' },
      dailyRecordReadRepository: { getAvailableDates, getForDate },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(getAvailableDates).not.toHaveBeenCalled();
    expect(getForDate.mock.calls.map(([date]) => date)).toEqual([
      '2026-04-09',
      '2026-04-10',
      '2026-04-11',
    ]);
    expect(updatePartial.mock.calls.map(([date]) => date)).toEqual(['2026-04-09', '2026-04-11']);
  });

  it.each([
    ['2026-12-30', '2027-01-02', ['2026-12-30', '2026-12-31', '2027-01-01']],
    // Across Rapa Nui's April daylight-saving change: still one read per calendar day.
    ['2026-04-03', '2026-04-07', ['2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06']],
  ])('walks %s to %s one calendar day at a time', async (firstSeenDate, currentDate, days) => {
    const getForDate = vi.fn().mockResolvedValue(null);

    await harmonizeEpisodeDemographicsHistory({
      currentDate,
      sourcePatient: episodePatient(firstSeenDate),
      updatedFields: { patientName: 'Nombre Corregido' },
      dailyRecordReadRepository: { getAvailableDates: vi.fn(), getForDate },
      dailyRecordWriteRepository: { updatePartial: vi.fn() },
    });

    expect(getForDate.mock.calls.map(([date]) => date)).toEqual(days);
  });

  it.each([
    ['a non-ISO first day', '09-04-2026', '2026-04-11'],
    ['an episode longer than a year', '2025-01-01', '2026-04-11'],
  ])('keeps the stored-day listing for %s', async (_case, firstSeenDate, currentDate) => {
    const getAvailableDates = vi.fn().mockResolvedValue([]);

    await harmonizeEpisodeDemographicsHistory({
      currentDate,
      sourcePatient: episodePatient(firstSeenDate),
      updatedFields: { patientName: 'Nombre Corregido' },
      dailyRecordReadRepository: { getAvailableDates, getForDate: vi.fn() },
      dailyRecordWriteRepository: { updatePartial: vi.fn() },
    });

    expect(getAvailableDates).toHaveBeenCalledOnce();
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
          getAvailableDates: vi.fn(),
          getForDate: vi.fn().mockRejectedValue(new Error('boom')),
        },
        dailyRecordWriteRepository: {
          updatePartial: vi.fn(),
        },
        logger,
      })
    ).not.toThrow();
  });
});
